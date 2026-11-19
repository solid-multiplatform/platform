//! Input: SDL's events, gathered while the loop drains them and handed to
//! JavaScript once per turn as one array of plain objects.
//!
//! `__solid.input.listen(callback)` registers the one listener;
//! `callback(events, count)` gets an array whose first `count` entries are
//! this turn's events, in order. The array is the runtime's own and is reused:
//! the listener reads it and keeps nothing. A turn without events calls
//! nothing.
//!
//! Each event has a `type`:
//!
//! - `keydown`, `keyup`: `key`, `code`, `keyCode` (see `keys.rs`), `repeat`,
//!   `ctrlKey`, `shiftKey`, `altKey`, `metaKey`.
//! - `textinput`: `text`, committed by the keyboard or an input method.
//!   `textediting`: `text` being composed, with the `start` and `length` of
//!   the part the input method marks, in characters; empty text ends it.
//!   Both arrive only between `text.start` and `text.stop`.
//! - `pointerdown`, `pointermove`, `pointerup`, `pointercancel`: `pointerId`,
//!   `pointerType` (`mouse`, `touch`, `pen`), `x` and `y` in layout units,
//!   `button` (0 left, 1 middle, 2 right; -1 for a move), `buttons` (the DOM's
//!   bit set) and `pressure`. `pointerleave`: the mouse left the window.
//! - `wheel`: `x`, `y`, `deltaX`, `deltaY` in layout units, positive towards
//!   the content's end as in the DOM.
//! - `resize` (size or scale changed: read `window.size()`), `expose` (the
//!   contents were lost), `focus`, `blur`, `windowstate` (minimised, restored,
//!   maximised, fullscreen entered or left, occluded, shown or hidden: read
//!   `window.state()` and `window.chrome().state()`), `close` (the user or
//!   the system asked the app to end), `theme`, `locale`.
//! - `dropfile` (`path`), `droptext` (`text`), each with `x` and `y`.
//!
//! Runs of mouse moves and of wheel steps are merged, as are repeated resize
//! and expose events: JavaScript hears where things ended up.

use crate::keys::{self, Name};
use crate::napi::*;
use crate::runtime::invoke;
use crate::window;
use sdl3_sys::everything::*;
use std::cell::RefCell;
use std::ffi::{CStr, CString};
use std::ptr;

macro_rules! names {
    ($($ident:ident = $text:literal),* $(,)?) => {
        #[allow(non_camel_case_types, clippy::upper_case_acronyms)]
        #[derive(Clone, Copy, PartialEq)]
        #[repr(usize)]
        enum N { $($ident),* }
        const NAMES: &[&CStr] = &[$($text),*];
    };
}

// Property names and the strings events carry, made once.
names! {
    type_ = c"type", key = c"key", code = c"code", keyCode = c"keyCode", repeat = c"repeat",
    ctrlKey = c"ctrlKey", shiftKey = c"shiftKey", altKey = c"altKey", metaKey = c"metaKey",
    text = c"text", start = c"start", length = c"length", path = c"path",
    pointerId = c"pointerId", pointerType = c"pointerType", x = c"x", y = c"y",
    button = c"button", buttons = c"buttons", pressure = c"pressure",
    deltaX = c"deltaX", deltaY = c"deltaY",
    keydown = c"keydown", keyup = c"keyup", textinput = c"textinput", textediting = c"textediting",
    pointerdown = c"pointerdown", pointermove = c"pointermove", pointerup = c"pointerup",
    pointercancel = c"pointercancel", pointerleave = c"pointerleave", wheel = c"wheel",
    mouse = c"mouse", touch = c"touch", pen = c"pen",
    resize = c"resize", expose = c"expose", focus = c"focus", blur = c"blur",
    windowstate = c"windowstate", close = c"close", theme = c"theme", locale = c"locale",
    dropfile = c"dropfile", droptext = c"droptext",
}

/// One wheel notch in layout units: three 16-unit lines, the step browsers
/// on Linux and Firefox everywhere use.
const WHEEL_STEP: f64 = 48.0;
/// Pointer ids: the mouse, then touches and pens in ranges of their own.
const MOUSE_POINTER: f64 = 1.0;
const TOUCH_POINTERS: f64 = 1_000.0;
const PEN_POINTERS: f64 = 2_000_000.0;

enum Event {
    Key { down: bool, repeat: bool, scancode: SDL_Scancode, keycode: SDL_Keycode, modifiers: SDL_Keymod },
    /// `textinput`, `textediting`, `dropfile` or `droptext`; `a` and `b` are
    /// the marked range of a composition or the position of a drop.
    Text { kind: N, text: String, a: f64, b: f64 },
    Pointer { kind: N, source: N, id: f64, x: f64, y: f64, button: i32, buttons: u32, pressure: f64 },
    Wheel { x: f64, y: f64, delta_x: f64, delta_y: f64 },
    Plain(N),
}

struct Input {
    listener: Option<napi_ref>,
    /// The array handed to the listener.
    batch: napi_ref,
    names: Vec<napi_ref>,
    queue: Vec<Event>,
    /// Layout units per window coordinate and the layout size, read once per
    /// turn, when the first event that needs them arrives.
    frame: Option<(f64, f64, f64)>,
}

thread_local! {
    static INPUT: RefCell<Input> = const { RefCell::new(Input {
        listener: None,
        batch: ptr::null_mut(),
        names: Vec::new(),
        queue: Vec::new(),
        frame: None,
    }) };
}

unsafe fn text_of(text: *const std::ffi::c_char) -> String {
    if text.is_null() {
        return String::new();
    }
    CStr::from_ptr(text).to_string_lossy().into_owned()
}

/// The DOM's `buttons` bit set from SDL's, which orders middle and right the
/// other way round.
fn dom_buttons(state: u32) -> u32 {
    (state & 1) | ((state & 4) >> 1) | ((state & 2) << 1) | (state & !7)
}

/// The DOM's `button` from SDL's: left, middle, right are 0, 1, 2.
fn dom_button(button: u8) -> i32 {
    match button {
        1 => 0,
        2 => 1,
        3 => 2,
        other => other as i32 - 1,
    }
}

impl Input {
    unsafe fn frame(&mut self) -> (f64, f64, f64) {
        *self.frame.get_or_insert_with(|| {
            let metrics = window::metrics();
            (metrics.from_window, metrics.width, metrics.height)
        })
    }

    /// A position in SDL's window coordinates, in layout units.
    unsafe fn layout(&mut self, x: f32, y: f32) -> (f64, f64) {
        let (factor, _, _) = self.frame();
        (x as f64 * factor, y as f64 * factor)
    }

    fn once(&mut self, kind: N) {
        if !self.queue.iter().any(|event| matches!(event, Event::Plain(queued) if *queued == kind)) {
            self.queue.push(Event::Plain(kind));
        }
    }

    /// Queues a pointer event at `x`, `y` in layout units.
    #[allow(clippy::too_many_arguments)]
    fn pointer(&mut self, kind: N, source: N, id: f64, x: f64, y: f64, button: i32, buttons: u32, pressure: f64) {
        // A run of moves of one pointer: only the last position matters.
        if kind == N::pointermove {
            if let Some(Event::Pointer { kind: N::pointermove, id: last, x: last_x, y: last_y, buttons: last_buttons, .. }) =
                self.queue.last_mut()
            {
                if *last == id {
                    (*last_x, *last_y, *last_buttons) = (x, y, buttons);
                    return;
                }
            }
        }
        self.queue.push(Event::Pointer { kind, source, id, x, y, button, buttons, pressure });
    }

    /// Queues what `event` means to JavaScript, if anything.
    unsafe fn collect(&mut self, event: &SDL_Event) {
        let kind = SDL_EventType(event.r#type);
        match kind {
            SDL_EVENT_KEY_DOWN | SDL_EVENT_KEY_UP => {
                let key = &event.key;
                self.queue.push(Event::Key {
                    down: key.down,
                    repeat: key.repeat,
                    scancode: key.scancode,
                    keycode: key.key,
                    modifiers: key.r#mod,
                });
            }
            SDL_EVENT_TEXT_INPUT => {
                let text = text_of(event.text.text);
                if !text.is_empty() {
                    self.queue.push(Event::Text { kind: N::textinput, text, a: 0.0, b: 0.0 });
                }
            }
            SDL_EVENT_TEXT_EDITING => {
                let edit = &event.edit;
                self.queue.push(Event::Text {
                    kind: N::textediting,
                    text: text_of(edit.text),
                    a: edit.start as f64,
                    b: edit.length as f64,
                });
            }
            SDL_EVENT_MOUSE_MOTION => {
                let motion = &event.motion;
                // Touches and pens come as events of their own.
                if motion.which != SDL_TOUCH_MOUSEID && motion.which != SDL_PEN_MOUSEID {
                    let buttons = dom_buttons(motion.state.0);
                    let (x, y) = self.layout(motion.x, motion.y);
                    self.pointer(N::pointermove, N::mouse, MOUSE_POINTER, x, y, -1, buttons, 0.0);
                }
            }
            SDL_EVENT_MOUSE_BUTTON_DOWN | SDL_EVENT_MOUSE_BUTTON_UP => {
                let button = &event.button;
                if button.which != SDL_TOUCH_MOUSEID && button.which != SDL_PEN_MOUSEID {
                    let kind = if button.down { N::pointerdown } else { N::pointerup };
                    let buttons = dom_buttons(SDL_GetMouseState(ptr::null_mut(), ptr::null_mut()).0);
                    let pressure = if button.down { 0.5 } else { 0.0 };
                    let which = dom_button(button.button);
                    let (x, y) = self.layout(button.x, button.y);
                    self.pointer(kind, N::mouse, MOUSE_POINTER, x, y, which, buttons, pressure);
                }
            }
            SDL_EVENT_MOUSE_WHEEL => {
                let wheel = &event.wheel;
                let (factor, _, _) = self.frame();
                // SDL counts notches, positive away from the user and to the
                // right; a "flipped" device reports them reversed.
                let flip = if wheel.direction == SDL_MOUSEWHEEL_FLIPPED { -1.0 } else { 1.0 };
                let delta_x = wheel.x as f64 * flip * WHEEL_STEP;
                let delta_y = -(wheel.y as f64) * flip * WHEEL_STEP;
                let (x, y) = (wheel.mouse_x as f64 * factor, wheel.mouse_y as f64 * factor);
                if let Some(Event::Wheel { x: last_x, y: last_y, delta_x: sum_x, delta_y: sum_y }) = self.queue.last_mut() {
                    (*last_x, *last_y) = (x, y);
                    *sum_x += delta_x;
                    *sum_y += delta_y;
                } else {
                    self.queue.push(Event::Wheel { x, y, delta_x, delta_y });
                }
            }
            SDL_EVENT_FINGER_DOWN | SDL_EVENT_FINGER_UP | SDL_EVENT_FINGER_MOTION | SDL_EVENT_FINGER_CANCELED => {
                let finger = &event.tfinger;
                // A pen also reports as a touch device; it has its own events.
                if finger.touchID != SDL_PEN_TOUCHID {
                    let (_, width, height) = self.frame();
                    let (name, button, buttons) = match kind {
                        SDL_EVENT_FINGER_DOWN => (N::pointerdown, 0, 1),
                        SDL_EVENT_FINGER_UP => (N::pointerup, 0, 0),
                        SDL_EVENT_FINGER_MOTION => (N::pointermove, -1, 1),
                        _ => (N::pointercancel, 0, 0),
                    };
                    // Positions are fractions of the window.
                    let id = TOUCH_POINTERS + (finger.fingerID.0 % 1_000_000) as f64;
                    let (x, y) = (finger.x as f64 * width, finger.y as f64 * height);
                    self.pointer(name, N::touch, id, x, y, button, buttons, finger.pressure as f64);
                }
            }
            SDL_EVENT_PEN_DOWN | SDL_EVENT_PEN_UP => {
                let pen = &event.ptouch;
                let (name, buttons) = if pen.down { (N::pointerdown, 1) } else { (N::pointerup, 0) };
                let id = PEN_POINTERS + pen.which.0 as f64;
                let (x, y) = self.layout(pen.x, pen.y);
                self.pointer(name, N::pen, id, x, y, 0, buttons, if pen.down { 0.5 } else { 0.0 });
            }
            SDL_EVENT_PEN_MOTION => {
                let pen = &event.pmotion;
                let down = pen.pen_state.0 & SDL_PEN_INPUT_DOWN.0 != 0;
                let id = PEN_POINTERS + pen.which.0 as f64;
                let (x, y) = self.layout(pen.x, pen.y);
                self.pointer(N::pointermove, N::pen, id, x, y, -1, down as u32, if down { 0.5 } else { 0.0 });
            }
            SDL_EVENT_WINDOW_MOUSE_LEAVE => self.queue.push(Event::Plain(N::pointerleave)),
            SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED | SDL_EVENT_WINDOW_RESIZED | SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED => {
                self.frame = None;
                self.once(N::resize);
            }
            SDL_EVENT_WINDOW_EXPOSED => self.once(N::expose),
            SDL_EVENT_WINDOW_FOCUS_GAINED => self.queue.push(Event::Plain(N::focus)),
            SDL_EVENT_WINDOW_FOCUS_LOST => self.queue.push(Event::Plain(N::blur)),
            SDL_EVENT_WINDOW_MINIMIZED
            | SDL_EVENT_WINDOW_RESTORED
            | SDL_EVENT_WINDOW_MAXIMIZED
            | SDL_EVENT_WINDOW_ENTER_FULLSCREEN
            | SDL_EVENT_WINDOW_LEAVE_FULLSCREEN
            | SDL_EVENT_WINDOW_OCCLUDED
            | SDL_EVENT_WINDOW_SHOWN
            | SDL_EVENT_WINDOW_HIDDEN => self.once(N::windowstate),
            SDL_EVENT_QUIT | SDL_EVENT_WINDOW_CLOSE_REQUESTED => self.once(N::close),
            SDL_EVENT_SYSTEM_THEME_CHANGED => self.once(N::theme),
            SDL_EVENT_LOCALE_CHANGED => self.once(N::locale),
            SDL_EVENT_DROP_FILE | SDL_EVENT_DROP_TEXT => {
                let drop = &event.drop;
                let (factor, _, _) = self.frame();
                let kind = if kind == SDL_EVENT_DROP_FILE { N::dropfile } else { N::droptext };
                self.queue.push(Event::Text {
                    kind,
                    text: text_of(drop.data),
                    a: drop.x as f64 * factor,
                    b: drop.y as f64 * factor,
                });
            }
            _ => {}
        }
    }
}

/// Queues an SDL event for this turn's delivery.
pub unsafe fn collect(event: &SDL_Event) {
    INPUT.with(|input| input.borrow_mut().collect(event));
}

/// What `deliver` found.
pub enum Delivered {
    /// Nothing happened, or JavaScript heard it.
    Done,
    /// The app was asked to close and nothing listens: the loop ends it.
    CloseUnheard,
}

unsafe fn object_for(env: napi_env, names: &[napi_ref], event: &Event) -> napi_value {
    let name = |n: N| dereference(env, names[n as usize]);
    let put = |object: napi_value, n: N, value: napi_value| {
        napi_set_property(env, object, name(n), value);
    };
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    match event {
        Event::Key { down, repeat, scancode, keycode, modifiers } => {
            let translated = keys::translate(*scancode, *keycode, *modifiers);
            put(object, N::type_, name(if *down { N::keydown } else { N::keyup }));
            let key = match translated.key {
                Name::Named(text) => string(env, &text.to_string_lossy()),
                Name::Character(character) => string(env, character.encode_utf8(&mut [0; 4])),
            };
            put(object, N::key, key);
            put(object, N::code, string(env, &translated.code.to_string_lossy()));
            put(object, N::keyCode, number(env, translated.key_code as f64));
            put(object, N::repeat, boolean(env, *repeat));
            let held = |mask: SDL_Keymod| boolean(env, modifiers.0 & mask.0 != 0);
            put(object, N::ctrlKey, held(SDL_KMOD_CTRL));
            put(object, N::shiftKey, held(SDL_KMOD_SHIFT));
            put(object, N::altKey, held(SDL_KMOD_ALT));
            put(object, N::metaKey, held(SDL_KMOD_GUI));
        }
        Event::Text { kind, text, a, b } => {
            put(object, N::type_, name(*kind));
            match kind {
                N::dropfile => put(object, N::path, string(env, text)),
                _ => put(object, N::text, string(env, text)),
            }
            if *kind == N::textediting {
                put(object, N::start, number(env, *a));
                put(object, N::length, number(env, *b));
            } else if *kind != N::textinput {
                put(object, N::x, number(env, *a));
                put(object, N::y, number(env, *b));
            }
        }
        Event::Pointer { kind, source, id, x, y, button, buttons, pressure } => {
            put(object, N::type_, name(*kind));
            put(object, N::pointerId, number(env, *id));
            put(object, N::pointerType, name(*source));
            put(object, N::x, number(env, *x));
            put(object, N::y, number(env, *y));
            put(object, N::button, number(env, *button as f64));
            put(object, N::buttons, number(env, *buttons as f64));
            put(object, N::pressure, number(env, *pressure));
        }
        Event::Wheel { x, y, delta_x, delta_y } => {
            put(object, N::type_, name(N::wheel));
            put(object, N::x, number(env, *x));
            put(object, N::y, number(env, *y));
            put(object, N::deltaX, number(env, *delta_x));
            put(object, N::deltaY, number(env, *delta_y));
        }
        Event::Plain(kind) => put(object, N::type_, name(*kind)),
    }
    object
}

/// Hands this turn's events to the listener in one call. Call once per turn,
/// after the system's queue is drained.
pub unsafe fn deliver(env: napi_env) -> Delivered {
    let (queue, listener) = INPUT.with(|input| {
        let mut input = input.borrow_mut();
        input.frame = None;
        (std::mem::take(&mut input.queue), input.listener)
    });
    if queue.is_empty() {
        // Not an allocation: an empty Vec owns nothing.
        return Delivered::Done;
    }
    let Some(listener) = listener else {
        let closing = queue.iter().any(|event| matches!(event, Event::Plain(N::close)));
        INPUT.with(|input| restore(&mut input.borrow_mut(), queue));
        return if closing { Delivered::CloseUnheard } else { Delivered::Done };
    };
    let mut scope = ptr::null_mut();
    napi_open_handle_scope(env, &mut scope);
    let batch = INPUT.with(|input| {
        let input = input.borrow();
        let batch = dereference(env, input.batch);
        for (index, event) in queue.iter().enumerate() {
            napi_set_element(env, batch, index as u32, object_for(env, &input.names, event));
        }
        batch
    });
    // The borrow is released: the listener may call back into this module.
    invoke(env, dereference(env, listener), &[batch, number(env, queue.len() as f64)]);
    napi_close_handle_scope(env, scope);
    INPUT.with(|input| restore(&mut input.borrow_mut(), queue));
    Delivered::Done
}

/// Gives the emptied queue its storage back, so that a turn allocates none.
fn restore(input: &mut Input, mut queue: Vec<Event>) {
    queue.clear();
    if input.queue.is_empty() {
        input.queue = queue;
    }
}

/// `__solid.input.listen(callback)`.
unsafe extern "C" fn listen(env: napi_env, info: napi_callback_info) -> napi_value {
    let [callback] = arguments::<1>(env, info);
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, callback, &mut kind);
    let next = (kind == NAPI_FUNCTION).then(|| reference(env, callback));
    if let Some(previous) = INPUT.with(|input| std::mem::replace(&mut input.borrow_mut().listener, next)) {
        napi_delete_reference(env, previous);
    }
    undefined(env)
}

/// The purposes `text.start` knows, as the platform's editors name them.
fn input_type(purpose: &str) -> Option<SDL_TextInputType> {
    Some(match purpose {
        "text" | "search" => SDL_TEXTINPUT_TYPE_TEXT,
        "username" => SDL_TEXTINPUT_TYPE_TEXT_USERNAME,
        "email" => SDL_TEXTINPUT_TYPE_TEXT_EMAIL,
        "current-password" | "new-password" => SDL_TEXTINPUT_TYPE_TEXT_PASSWORD_HIDDEN,
        "one-time-code" => SDL_TEXTINPUT_TYPE_NUMBER,
        _ => return None,
    })
}

/// A rectangle in layout units as SDL's, in window coordinates.
unsafe fn window_rect(env: napi_env, values: [napi_value; 4]) -> Option<SDL_Rect> {
    let to_window = 1.0 / window::metrics().from_window;
    let mut numbers = [0.0f64; 4];
    for (number, value) in numbers.iter_mut().zip(values) {
        *number = number_or(env, value, f64::NAN) * to_window;
        if !number.is_finite() || number.abs() > 1e6 {
            return None;
        }
    }
    Some(SDL_Rect {
        x: numbers[0].round() as i32,
        y: numbers[1].round() as i32,
        w: numbers[2].round().max(1.0) as i32,
        h: numbers[3].round().max(1.0) as i32,
    })
}

/// `__solid.text.start(purpose, multiline)`: text typed from now on arrives
/// as `textinput` and `textediting` events, and the system's input method is
/// on. `purpose` tells the system what is being typed.
unsafe extern "C" fn text_start(env: napi_env, info: napi_callback_info) -> napi_value {
    let [purpose, multiline] = arguments::<2>(env, info);
    let Some(kind) = string_argument(env, purpose).as_deref().and_then(input_type) else {
        return throw(env, "text.start: unknown purpose");
    };
    let mut lines = false;
    napi_get_value_bool(env, multiline, &mut lines);
    let properties = SDL_CreateProperties();
    SDL_SetNumberProperty(properties, SDL_PROP_TEXTINPUT_TYPE_NUMBER, kind.0 as i64);
    SDL_SetBooleanProperty(properties, SDL_PROP_TEXTINPUT_MULTILINE_BOOLEAN, lines);
    let started = SDL_StartTextInputWithProperties(window::handle(), properties);
    SDL_DestroyProperties(properties);
    if !started {
        return throw(env, &format!("text.start: {}", CStr::from_ptr(SDL_GetError()).to_string_lossy()));
    }
    undefined(env)
}

/// `__solid.text.stop()`.
unsafe extern "C" fn text_stop(env: napi_env, _info: napi_callback_info) -> napi_value {
    SDL_StopTextInput(window::handle());
    undefined(env)
}

/// `__solid.text.active()`.
unsafe extern "C" fn text_active(env: napi_env, _info: napi_callback_info) -> napi_value {
    boolean(env, SDL_TextInputActive(window::handle()))
}

/// `__solid.text.area(x, y, width, height, caret)`: where the text being
/// edited is, in layout units, and how far into it the caret stands, so that
/// the input method puts its window beside it.
unsafe extern "C" fn text_area(env: napi_env, info: napi_callback_info) -> napi_value {
    let [x, y, width, height, caret] = arguments::<5>(env, info);
    let Some(rect) = window_rect(env, [x, y, width, height]) else {
        return throw(env, "text.area: the rectangle must be four finite numbers");
    };
    let caret = number_or(env, caret, 0.0) / window::metrics().from_window;
    let caret = if caret.is_finite() { caret.round().clamp(0.0, rect.w as f64) as i32 } else { 0 };
    SDL_SetTextInputArea(window::handle(), &rect, caret);
    undefined(env)
}

/// `__solid.text.graphemes(text)`: where each user-perceived character of
/// `text` starts, in UTF-16 units, ending with the text's length.
unsafe extern "C" fn text_graphemes(env: napi_env, info: napi_callback_info) -> napi_value {
    use unicode_segmentation::UnicodeSegmentation;
    let [text] = arguments::<1>(env, info);
    let Some(text) = string_argument(env, text) else {
        return throw(env, "text.graphemes: the text must be a string");
    };
    let mut array = ptr::null_mut();
    napi_create_array(env, &mut array);
    let (mut index, mut offset) = (0u32, 0usize);
    for grapheme in text.graphemes(true) {
        napi_set_element(env, array, index, number(env, offset as f64));
        index += 1;
        offset += grapheme.encode_utf16().count();
    }
    napi_set_element(env, array, index, number(env, offset as f64));
    array
}

/// Installs `input` and `text` on `host`. The window exists.
pub unsafe fn install(env: napi_env, host: napi_value) {
    let mut batch = ptr::null_mut();
    napi_create_array(env, &mut batch);
    let names = NAMES
        .iter()
        .map(|name| {
            let mut key = ptr::null_mut();
            node_api_create_property_key_utf8(env, name.as_ptr(), NAPI_AUTO_LENGTH, &mut key);
            reference(env, key)
        })
        .collect();
    INPUT.with(|input| {
        let mut input = input.borrow_mut();
        input.batch = reference(env, batch);
        input.names = names;
    });
    let object = define_object(env, host, c"input");
    define_function(env, object, c"listen", listen);
    let text = define_object(env, host, c"text");
    define_function(env, text, c"start", text_start);
    define_function(env, text, c"stop", text_stop);
    define_function(env, text, c"active", text_active);
    define_function(env, text, c"area", text_area);
    define_function(env, text, c"graphemes", text_graphemes);
}

/// The test interface (`testing.rs`) leaks the text of the events it pushes,
/// since SDL keeps the pointer; this keeps that in one place.
pub fn leak(text: &str) -> *const std::ffi::c_char {
    CString::new(text.replace('\0', " ")).unwrap().into_raw()
}
