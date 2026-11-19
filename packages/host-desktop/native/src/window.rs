//! The window: its size in the units the scene is laid out in, its state,
//! and what the system says through it (theme, locales, screen saver).
//!
//! Three sizes are involved. SDL's window coordinates are what the window
//! system counts in; the drawing buffer is in pixels; the scene is laid out
//! in units of which `scale` make one pixel, where `scale` is the display's
//! scale as the system reports it (2 on a "200 %" display, whether the
//! window system counts in points, as macOS and Wayland do, or in pixels, as
//! X11 does). So `width = pixelWidth / scale` on every system, and pointer
//! positions are converted the same way.

use crate::napi::*;
use sdl3_sys::everything::*;
use std::ffi::CStr;
use std::ptr;
use std::sync::atomic::{AtomicPtr, AtomicU32, Ordering};

static WINDOW: AtomicPtr<SDL_Window> = AtomicPtr::new(ptr::null_mut());
/// A scale that stands in for the display's, as `f32` bits; 0 for none.
/// Only the test interface sets it.
static SCALE_OVERRIDE: AtomicU32 = AtomicU32::new(0);

pub fn handle() -> *mut SDL_Window {
    WINDOW.load(Ordering::Relaxed)
}

pub fn override_scale(scale: f32) {
    SCALE_OVERRIDE.store(scale.to_bits(), Ordering::Relaxed);
}

pub struct Metrics {
    /// Layout units.
    pub width: f64,
    pub height: f64,
    /// The drawing buffer.
    pub pixel_width: f64,
    pub pixel_height: f64,
    /// Pixels per layout unit.
    pub scale: f64,
    /// Layout units per unit of SDL's window coordinates.
    pub from_window: f64,
}

pub unsafe fn metrics() -> Metrics {
    let window = handle();
    let (mut width, mut height, mut pixel_width, mut pixel_height) = (0, 0, 0, 0);
    SDL_GetWindowSize(window, &mut width, &mut height);
    SDL_GetWindowSizeInPixels(window, &mut pixel_width, &mut pixel_height);
    let forced = f32::from_bits(SCALE_OVERRIDE.load(Ordering::Relaxed));
    let reported = if forced > 0.0 { forced } else { SDL_GetWindowDisplayScale(window) };
    // SDL reports 0 when it cannot tell.
    let scale = if reported.is_finite() && reported > 0.0 { reported as f64 } else { 1.0 };
    let density = if width > 0 { pixel_width as f64 / width as f64 } else { 1.0 };
    Metrics {
        width: pixel_width as f64 / scale,
        height: pixel_height as f64 / scale,
        pixel_width: pixel_width as f64,
        pixel_height: pixel_height as f64,
        scale,
        from_window: density / scale,
    }
}

unsafe fn set(env: napi_env, object: napi_value, name: &CStr, value: napi_value) {
    napi_set_named_property(env, object, name.as_ptr(), value);
}

/// `__solid.window.size()`: `{ width, height, pixelWidth, pixelHeight, scale }`.
unsafe extern "C" fn size(env: napi_env, _info: napi_callback_info) -> napi_value {
    let metrics = metrics();
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    set(env, object, c"width", number(env, metrics.width));
    set(env, object, c"height", number(env, metrics.height));
    set(env, object, c"pixelWidth", number(env, metrics.pixel_width));
    set(env, object, c"pixelHeight", number(env, metrics.pixel_height));
    set(env, object, c"scale", number(env, metrics.scale));
    object
}

/// `__solid.window.setSize(width, height)` in layout units. A `resize` event
/// follows once the window system has applied it.
unsafe extern "C" fn set_size(env: napi_env, info: napi_callback_info) -> napi_value {
    let [width, height] = arguments::<2>(env, info);
    let (width, height) = (number_or(env, width, 0.0), number_or(env, height, 0.0));
    if !(width >= 1.0 && height >= 1.0 && width <= 65535.0 && height <= 65535.0) {
        return throw(env, "window.setSize: width and height must be between 1 and 65535");
    }
    let to_window = 1.0 / metrics().from_window;
    if !SDL_SetWindowSize(handle(), (width * to_window).round() as i32, (height * to_window).round() as i32) {
        return throw(env, "window.setSize: the window system refused the size");
    }
    undefined(env)
}

/// `__solid.window.setTitle(text)`.
unsafe extern "C" fn set_title(env: napi_env, info: napi_callback_info) -> napi_value {
    let [title] = arguments::<1>(env, info);
    let Some(title) = string_argument(env, title).and_then(|text| std::ffi::CString::new(text).ok()) else {
        return throw(env, "window.setTitle: the title must be a string without NUL");
    };
    SDL_SetWindowTitle(handle(), title.as_ptr());
    undefined(env)
}

/// `__solid.window.state()`: `{ focused, minimized, occluded, hidden }`.
unsafe extern "C" fn state(env: napi_env, _info: napi_callback_info) -> napi_value {
    let flags = SDL_GetWindowFlags(handle());
    let has = |flag: SDL_WindowFlags| flags.0 & flag.0 != 0;
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    set(env, object, c"focused", boolean(env, has(SDL_WINDOW_INPUT_FOCUS)));
    set(env, object, c"minimized", boolean(env, has(SDL_WINDOW_MINIMIZED)));
    set(env, object, c"occluded", boolean(env, has(SDL_WINDOW_OCCLUDED)));
    set(env, object, c"hidden", boolean(env, has(SDL_WINDOW_HIDDEN)));
    object
}

/// `__solid.window.hasTouch()`: whether a touch device is attached now.
unsafe extern "C" fn has_touch(env: napi_env, _info: napi_callback_info) -> napi_value {
    let mut count = 0;
    let devices = SDL_GetTouchDevices(&mut count);
    if !devices.is_null() {
        SDL_free(devices.cast());
    }
    boolean(env, count > 0)
}

/// `__solid.window.theme()`: `"light"`, `"dark"`, or `"unknown"` when the
/// system does not say.
unsafe extern "C" fn theme(env: napi_env, _info: napi_callback_info) -> napi_value {
    let name = match SDL_GetSystemTheme() {
        SDL_SYSTEM_THEME_DARK => "dark",
        SDL_SYSTEM_THEME_LIGHT => "light",
        _ => "unknown",
    };
    string(env, name)
}

/// `__solid.window.allowScreenSaver(allow)`: lets the screen blank and lock
/// as the user set it up (`true`, how the runtime starts), or keeps it awake.
/// Returns whether the system took the request.
unsafe extern "C" fn allow_screen_saver(env: napi_env, info: napi_callback_info) -> napi_value {
    let [allow] = arguments::<1>(env, info);
    let mut value = true;
    if napi_get_value_bool(env, allow, &mut value) != NAPI_OK {
        return throw(env, "window.allowScreenSaver: pass true or false");
    }
    let done = if value { SDL_EnableScreenSaver() } else { SDL_DisableScreenSaver() };
    boolean(env, done)
}

/// `__solid.window.screenSaverAllowed()`.
unsafe extern "C" fn screen_saver_allowed(env: napi_env, _info: napi_callback_info) -> napi_value {
    boolean(env, SDL_ScreenSaverEnabled())
}

/// `__solid.clipboard.read()`: the clipboard's text, empty when it has none.
unsafe extern "C" fn clipboard_read(env: napi_env, _info: napi_callback_info) -> napi_value {
    let text = SDL_GetClipboardText();
    if text.is_null() {
        return string(env, "");
    }
    let mut result = ptr::null_mut();
    napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &mut result);
    SDL_free(text.cast());
    result
}

/// `__solid.clipboard.write(text)`.
unsafe extern "C" fn clipboard_write(env: napi_env, info: napi_callback_info) -> napi_value {
    let [text] = arguments::<1>(env, info);
    let Some(text) = string_argument(env, text) else {
        return throw(env, "clipboard.write: the text must be a string");
    };
    // The clipboard holds C strings: text ends at a NUL.
    let Ok(text) = std::ffi::CString::new(text) else {
        return throw(env, "clipboard.write: the text contains a NUL character");
    };
    if !SDL_SetClipboardText(text.as_ptr()) {
        return throw(env, &format!("clipboard.write: {}", CStr::from_ptr(SDL_GetError()).to_string_lossy()));
    }
    undefined(env)
}

/// Installs `window` and `clipboard` on `host` for `window`.
pub unsafe fn install(env: napi_env, host: napi_value, window: *mut SDL_Window) {
    WINDOW.store(window, Ordering::Relaxed);
    let object = define_object(env, host, c"window");
    define_function(env, object, c"size", size);
    define_function(env, object, c"setSize", set_size);
    define_function(env, object, c"setTitle", set_title);
    define_function(env, object, c"state", state);
    define_function(env, object, c"hasTouch", has_touch);
    define_function(env, object, c"theme", theme);
    define_function(env, object, c"allowScreenSaver", allow_screen_saver);
    define_function(env, object, c"screenSaverAllowed", screen_saver_allowed);
    // The chrome object exists in every mode; in native mode it reports the
    // mode and the state and its controls are never drawn by the scene.
    crate::chrome::install(env, object);
    let clipboard = define_object(env, host, c"clipboard");
    define_function(env, clipboard, c"read", clipboard_read);
    define_function(env, clipboard, c"write", clipboard_write);
}
