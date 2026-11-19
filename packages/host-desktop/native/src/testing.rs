//! `__solid.test`: input made up by a test, put on SDL's own queue with
//! `SDL_PushEvent` so that it takes the path real input takes from there on.
//! Installed only when `SOLID_DESKTOP_TEST` is set in the environment.
//!
//! What this cannot show is SDL's translation of the window system's events;
//! `tests/input` drives real X events with `xdotool` for that.

use crate::input::leak;
use crate::napi::*;
use crate::window;
use sdl3_sys::everything::*;
use std::ptr;

unsafe fn push(mut event: SDL_Event) {
    SDL_PushEvent(&mut event);
}

unsafe fn flag(env: napi_env, value: napi_value) -> bool {
    let mut result = false;
    napi_get_value_bool(env, value, &mut result);
    result
}

/// `test.key(down, scancode, keycode, modifiers, repeat)`, in SDL's numbers.
unsafe extern "C" fn key(env: napi_env, info: napi_callback_info) -> napi_value {
    let [down, scancode, keycode, modifiers, repeat] = arguments::<5>(env, info);
    let down = flag(env, down);
    let mut event: SDL_Event = std::mem::zeroed();
    event.key.r#type = if down { SDL_EVENT_KEY_DOWN } else { SDL_EVENT_KEY_UP };
    event.key.scancode = SDL_Scancode(number_or(env, scancode, 0.0) as i32);
    event.key.key = SDL_Keycode(number_or(env, keycode, 0.0) as u32);
    event.key.r#mod = SDL_Keymod(number_or(env, modifiers, 0.0) as u16);
    event.key.down = down;
    event.key.repeat = flag(env, repeat);
    push(event);
    undefined(env)
}

/// `test.text(text)`: committed text. `test.text(text, start, length)`: a
/// composition in progress.
unsafe extern "C" fn text(env: napi_env, info: napi_callback_info) -> napi_value {
    let ([text, start, length], given) = arguments_given::<3>(env, info);
    let Some(text) = string_argument(env, text) else {
        return throw(env, "test.text: the text must be a string");
    };
    let mut event: SDL_Event = std::mem::zeroed();
    if given == 1 {
        event.text.r#type = SDL_EVENT_TEXT_INPUT;
        event.text.text = leak(&text);
    } else {
        event.edit.r#type = SDL_EVENT_TEXT_EDITING;
        event.edit.text = leak(&text);
        event.edit.start = number_or(env, start, 0.0) as i32;
        event.edit.length = number_or(env, length, 0.0) as i32;
    }
    push(event);
    undefined(env)
}

/// Layout units as SDL's window coordinates.
unsafe fn window_point(env: napi_env, x: napi_value, y: napi_value) -> (f32, f32) {
    let to_window = 1.0 / window::metrics().from_window;
    ((number_or(env, x, 0.0) * to_window) as f32, (number_or(env, y, 0.0) * to_window) as f32)
}

/// `test.mouse(kind, x, y, button, a, b)`: `kind` is `"move"`, `"down"`,
/// `"up"` or `"wheel"`; `button` is SDL's (1 left, 2 middle, 3 right); a
/// wheel's `a`, `b` are its notches right and away from the user.
unsafe extern "C" fn mouse(env: napi_env, info: napi_callback_info) -> napi_value {
    let [kind, x, y, button, a, b] = arguments::<6>(env, info);
    let kind = string_argument(env, kind).unwrap_or_default();
    let (x, y) = window_point(env, x, y);
    let mut event: SDL_Event = std::mem::zeroed();
    match kind.as_str() {
        "move" => {
            event.motion.r#type = SDL_EVENT_MOUSE_MOTION;
            (event.motion.x, event.motion.y) = (x, y);
            event.motion.state = SDL_MouseButtonFlags(number_or(env, button, 0.0) as u32);
        }
        "down" | "up" => {
            let down = kind == "down";
            event.button.r#type = if down { SDL_EVENT_MOUSE_BUTTON_DOWN } else { SDL_EVENT_MOUSE_BUTTON_UP };
            event.button.button = number_or(env, button, 1.0) as u8;
            event.button.down = down;
            (event.button.x, event.button.y) = (x, y);
        }
        "wheel" => {
            event.wheel.r#type = SDL_EVENT_MOUSE_WHEEL;
            (event.wheel.mouse_x, event.wheel.mouse_y) = (x, y);
            event.wheel.x = number_or(env, a, 0.0) as f32;
            event.wheel.y = number_or(env, b, 0.0) as f32;
        }
        _ => return throw(env, "test.mouse: unknown kind"),
    }
    push(event);
    undefined(env)
}

/// `test.finger(kind, id, x, y)`: a touch at a position in layout units;
/// `kind` is `"down"`, `"move"`, `"up"` or `"cancel"`.
unsafe extern "C" fn finger(env: napi_env, info: napi_callback_info) -> napi_value {
    let [kind, id, x, y] = arguments::<4>(env, info);
    let kind = match string_argument(env, kind).unwrap_or_default().as_str() {
        "down" => SDL_EVENT_FINGER_DOWN,
        "move" => SDL_EVENT_FINGER_MOTION,
        "up" => SDL_EVENT_FINGER_UP,
        "cancel" => SDL_EVENT_FINGER_CANCELED,
        _ => return throw(env, "test.finger: unknown kind"),
    };
    let metrics = window::metrics();
    let mut event: SDL_Event = std::mem::zeroed();
    event.tfinger.r#type = kind;
    event.tfinger.touchID = SDL_TouchID(1);
    event.tfinger.fingerID = SDL_FingerID(number_or(env, id, 1.0) as u64);
    event.tfinger.x = (number_or(env, x, 0.0) / metrics.width) as f32;
    event.tfinger.y = (number_or(env, y, 0.0) / metrics.height) as f32;
    event.tfinger.pressure = if kind == SDL_EVENT_FINGER_UP { 0.0 } else { 1.0 };
    push(event);
    undefined(env)
}

/// `test.window(kind)`: an event of the window or the system, by name.
unsafe extern "C" fn window_event(env: napi_env, info: napi_callback_info) -> napi_value {
    let [kind] = arguments::<1>(env, info);
    let kind = match string_argument(env, kind).unwrap_or_default().as_str() {
        "close" => SDL_EVENT_WINDOW_CLOSE_REQUESTED,
        "quit" => SDL_EVENT_QUIT,
        "focus" => SDL_EVENT_WINDOW_FOCUS_GAINED,
        "blur" => SDL_EVENT_WINDOW_FOCUS_LOST,
        "leave" => SDL_EVENT_WINDOW_MOUSE_LEAVE,
        "minimized" => SDL_EVENT_WINDOW_MINIMIZED,
        "restored" => SDL_EVENT_WINDOW_RESTORED,
        "theme" => SDL_EVENT_SYSTEM_THEME_CHANGED,
        "locale" => SDL_EVENT_LOCALE_CHANGED,
        _ => return throw(env, "test.window: unknown kind"),
    };
    let mut event: SDL_Event = std::mem::zeroed();
    event.r#type = kind.0;
    push(event);
    undefined(env)
}

/// `test.drop(kind, data, x, y)`: `kind` is `"file"` or `"text"`.
unsafe extern "C" fn drop_event(env: napi_env, info: napi_callback_info) -> napi_value {
    let [kind, data, x, y] = arguments::<4>(env, info);
    let file = string_argument(env, kind).as_deref() == Some("file");
    let Some(data) = string_argument(env, data) else {
        return throw(env, "test.drop: the data must be a string");
    };
    let mut event: SDL_Event = std::mem::zeroed();
    event.drop.r#type = if file { SDL_EVENT_DROP_FILE } else { SDL_EVENT_DROP_TEXT };
    event.drop.data = leak(&data);
    (event.drop.x, event.drop.y) = window_point(env, x, y);
    push(event);
    undefined(env)
}

/// `test.setScale(scale)`: stands in for the display's scale, as if the
/// window had moved to a display with another one. 0 removes the stand-in.
unsafe extern "C" fn set_scale(env: napi_env, info: napi_callback_info) -> napi_value {
    let [scale] = arguments::<1>(env, info);
    let scale = number_or(env, scale, 0.0);
    if !(0.0..=16.0).contains(&scale) {
        return throw(env, "test.setScale: the scale must be between 0 and 16");
    }
    window::override_scale(scale as f32);
    let mut event: SDL_Event = std::mem::zeroed();
    event.r#type = SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED.0;
    push(event);
    undefined(env)
}

/// `test.hitTest(x, y)`: what the resolver answers at a point in scene
/// units, as SDL's own names (`draggable`, `resize-top`, `normal`, ...).
/// This is the classifier the window system asks, not a simulation of its
/// move or resize.
unsafe extern "C" fn hit_test(env: napi_env, info: napi_callback_info) -> napi_value {
    let [x, y] = arguments::<2>(env, info);
    let (x, y) = (number_or(env, x, f64::NAN), number_or(env, y, f64::NAN));
    if !x.is_finite() || !y.is_finite() {
        return throw(env, "test.hitTest: the position must be two numbers");
    }
    string(env, crate::chrome::query(x, y))
}

/// `test.regions()`: the scene's published hit-test regions, in scene units,
/// as `{ x, y, width, height, drag }`. For checking what the primitives
/// measured, not for the window system.
unsafe extern "C" fn regions(env: napi_env, _info: napi_callback_info) -> napi_value {
    let mut array = ptr::null_mut();
    napi_create_array(env, &mut array);
    for (index, (x, y, width, height, drag)) in crate::chrome::scene_regions().into_iter().enumerate() {
        let mut entry = ptr::null_mut();
        napi_create_object(env, &mut entry);
        napi_set_named_property(env, entry, c"x".as_ptr(), number(env, x));
        napi_set_named_property(env, entry, c"y".as_ptr(), number(env, y));
        napi_set_named_property(env, entry, c"width".as_ptr(), number(env, width));
        napi_set_named_property(env, entry, c"height".as_ptr(), number(env, height));
        napi_set_named_property(env, entry, c"drag".as_ptr(), boolean(env, drag));
        napi_set_element(env, array, index as u32, entry);
    }
    array
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    let test = define_object(env, host, c"test");
    define_function(env, test, c"key", key);
    define_function(env, test, c"text", text);
    define_function(env, test, c"mouse", mouse);
    define_function(env, test, c"finger", finger);
    define_function(env, test, c"window", window_event);
    define_function(env, test, c"drop", drop_event);
    define_function(env, test, c"setScale", set_scale);
    define_function(env, test, c"hitTest", hit_test);
    define_function(env, test, c"regions", regions);
}
