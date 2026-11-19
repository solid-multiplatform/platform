//! The scene surface: an OpenGL ES 3 context exposed to JavaScript as a
//! WebGL-shaped object, `__solid.gl`.
//!
//! The context is ES 3 on every system, so a WebGL shader (GLSL ES 1.00)
//! compiles as written. GL objects are their GL names, plain numbers, and a
//! uniform location is its index; `null` stands for "none" as in WebGL.

#[macro_use]
mod bind;
mod calls;
mod table;

use crate::napi::*;
use sdl3_sys::everything::*;
use std::cell::RefCell;
use std::ffi::{c_void, CStr};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};

/// Set by a call that changed the window's frame; the loop presents and
/// clears it.
static DREW: AtomicBool = AtomicBool::new(false);
/// The bound framebuffer: drawing into one of the scene's own is not a frame.
static FRAMEBUFFER: AtomicU32 = AtomicU32::new(0);
static WINDOW: AtomicPtr<SDL_Window> = AtomicPtr::new(ptr::null_mut());

#[inline(always)]
fn mark_drawn() {
    if FRAMEBUFFER.load(Ordering::Relaxed) == 0 {
        DREW.store(true, Ordering::Relaxed);
    }
}

/// Whether anything drew since the last call.
pub fn take_drew() -> bool {
    DREW.swap(false, Ordering::Relaxed)
}

/// What the hand-written calls keep between calls.
struct State {
    /// `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and `UNPACK_FLIP_Y_WEBGL`, which GL
    /// does not have: uploads apply them on the way in.
    premultiply: bool,
    flip: bool,
    /// Reused for uploads that must be rewritten or zero-filled.
    scratch: Vec<u8>,
    /// `GL_EXTENSIONS`, read once.
    extensions: String,
    /// The objects `getExtension` handed out, one per entry of
    /// `calls::EXTENSIONS`: WebGL returns the same object every time.
    extension_objects: Vec<Option<napi_ref>>,
    /// Property keys of an image source, made once so that an upload looks
    /// nothing up by string.
    key_width: napi_ref,
    key_height: napi_ref,
    key_data: napi_ref,
}

thread_local! {
    static STATE: RefCell<State> = const { RefCell::new(State {
        premultiply: false,
        flip: false,
        scratch: Vec::new(),
        extensions: String::new(),
        extension_objects: Vec::new(),
        key_width: ptr::null_mut(),
        key_height: ptr::null_mut(),
        key_data: ptr::null_mut(),
    }) };
}

/// Marks the objects `images.rs` makes: an image whose pixels this runtime
/// decoded, as opposed to an `ImageData`-shaped object from JavaScript.
pub const BITMAP_TAG: napi_type_tag = napi_type_tag { lower: 0x736f_6c69_645f_6269, upper: 0x746d_6170_5f76_3031 };

unsafe extern "C" fn unimplemented(env: napi_env, info: napi_callback_info) -> napi_value {
    let mut name: *mut c_void = ptr::null_mut();
    let mut argc = 0usize;
    napi_get_cb_info(env, info, &mut argc, ptr::null_mut(), ptr::null_mut(), &mut name);
    let name = CStr::from_ptr(name.cast()).to_string_lossy();
    throw(env, &format!("gl.{name} is not implemented by the desktop runtime"))
}

unsafe extern "C" fn drawing_buffer_width(env: napi_env, _info: napi_callback_info) -> napi_value {
    let (mut width, mut height) = (0, 0);
    SDL_GetWindowSizeInPixels(WINDOW.load(Ordering::Relaxed), &mut width, &mut height);
    number(env, width as f64)
}

unsafe extern "C" fn drawing_buffer_height(env: napi_env, _info: napi_callback_info) -> napi_value {
    let (mut width, mut height) = (0, 0);
    SDL_GetWindowSizeInPixels(WINDOW.load(Ordering::Relaxed), &mut width, &mut height);
    number(env, height as f64)
}

unsafe fn property_key(env: napi_env, name: &CStr) -> napi_ref {
    let mut key = ptr::null_mut();
    node_api_create_property_key_utf8(env, name.as_ptr(), NAPI_AUTO_LENGTH, &mut key);
    reference(env, key)
}

/// Creates the GL context for `window` and loads the entry points the
/// binding uses.
pub unsafe fn create_context(window: *mut SDL_Window) -> Result<(), String> {
    if SDL_GL_CreateContext(window).is_null() {
        let reason = CStr::from_ptr(SDL_GetError()).to_string_lossy();
        // macOS has no OpenGL ES of its own: SDL reaches it through EGL,
        // and the system supplies no EGL library. Say what is missing
        // rather than only what SDL said.
        let hint = if cfg!(target_os = "macos") {
            "\nmacOS has no OpenGL ES driver of its own: the scene needs an EGL implementation \
             (ANGLE) that SDL can load (SDL_VIDEO_EGL_DRIVER). Run --headless for everything but drawing."
        } else {
            ""
        };
        return Err(format!("No OpenGL ES 3 context: {reason}{hint}"));
    }
    WINDOW.store(window, Ordering::Relaxed);
    table::load(|name| SDL_GL_GetProcAddress(name.as_ptr()).map_or(ptr::null(), |entry| entry as *const c_void))
        .map_err(|name| format!("The OpenGL ES 3 context lacks {}", name.to_string_lossy()))
}

/// Installs `gl` on `host`. The context exists.
pub unsafe fn install(env: napi_env, host: napi_value) {
    const EXTENSIONS: u32 = 0x1F03;
    let extensions = table::glGetString(EXTENSIONS);
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        if !extensions.is_null() {
            state.extensions = CStr::from_ptr(extensions).to_string_lossy().into_owned();
        }
        state.extension_objects = vec![None; calls::EXTENSIONS.len()];
        state.key_width = property_key(env, c"width");
        state.key_height = property_key(env, c"height");
        state.key_data = property_key(env, c"data");
    });

    let gl = define_object(env, host, c"gl");
    for (name, callback) in table::FUNCTIONS {
        define_function(env, gl, name, *callback);
    }
    for name in table::UNIMPLEMENTED {
        define_function_with(env, gl, name, unimplemented, name.as_ptr() as *mut c_void);
    }
    for (name, value) in table::CONSTANTS {
        napi_set_named_property(env, gl, name.as_ptr(), number(env, *value as f64));
    }
    let size = |name: &'static CStr, getter: napi_callback| napi_property_descriptor {
        utf8name: name.as_ptr(),
        name: ptr::null_mut(),
        method: None,
        getter: Some(getter),
        setter: None,
        value: ptr::null_mut(),
        attributes: NAPI_ENUMERABLE,
        data: ptr::null_mut(),
    };
    let properties =
        [size(c"drawingBufferWidth", drawing_buffer_width), size(c"drawingBufferHeight", drawing_buffer_height)];
    napi_define_properties(env, gl, properties.len(), properties.as_ptr());
}
