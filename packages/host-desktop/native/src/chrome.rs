//! Window chrome: the title bar mode, the window state the scene reads, the
//! framework's window requests, and the hit-test regions the scene publishes.
//!
//! The mode is chosen at startup and never changes: `native` keeps the
//! window system's decorations, `custom` and `hidden` create a borderless
//! window. For those, the scene's `<TitleBar>` and drag regions are measured
//! in JavaScript, published here in one batch, converted to window
//! coordinates once, and kept in a snapshot the SDL hit-test callback only
//! reads. The callback runs while events are drained: it must not allocate,
//! call into JavaScript or take a lock that could wait, so a snapshot being
//! replaced answers `NORMAL` for that one speculative call.
//!
//! Window state is event-driven: events update it as they are drained, and
//! `__solid.window.chrome().state()` returns that snapshot. SDL's flags are
//! read once, when the window is created, and not polled again.

use crate::napi::*;
use crate::window;
use sdl3_sys::everything::*;
use std::ffi::CStr;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;

/// The resize border around a borderless window, in scene units, and the
/// larger square at each corner.
pub const BORDER: f64 = 7.0;
pub const CORNER: f64 = 12.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Native = 0,
    Custom = 1,
    Hidden = 2,
}

impl Mode {
    pub fn parse(text: &str) -> Option<Mode> {
        match text {
            "native" => Some(Mode::Native),
            "custom" => Some(Mode::Custom),
            "hidden" => Some(Mode::Hidden),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Native => "native",
            Mode::Custom => "custom",
            Mode::Hidden => "hidden",
        }
    }

    fn from_byte(value: u8) -> Mode {
        match value {
            1 => Mode::Custom,
            2 => Mode::Hidden,
            _ => Mode::Native,
        }
    }
}

#[derive(Clone, Copy)]
pub struct State {
    pub focused: bool,
    pub minimized: bool,
    pub maximized: bool,
    pub fullscreen: bool,
    pub resizable: bool,
}

impl State {
    const fn new() -> State {
        State { focused: false, minimized: false, maximized: false, fullscreen: false, resizable: true }
    }
}

static MODE: AtomicU8 = AtomicU8::new(0);
static HIT_TEST: AtomicBool = AtomicBool::new(false);
/// The resizable state to give back when fullscreen ends.
static RESIZABLE: AtomicBool = AtomicBool::new(true);
static STATE: Mutex<State> = Mutex::new(State::new());

pub fn mode() -> Mode {
    Mode::from_byte(MODE.load(Ordering::Relaxed))
}

pub fn hit_test_installed() -> bool {
    HIT_TEST.load(Ordering::Relaxed)
}

pub fn state() -> State {
    *STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `windows`, `linux` or `macos`, as the scene names the system.
pub fn os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// `resources/app.json`, read before SDL starts: what the packaging step
/// wrote about the app. An absent or unreadable file, or an unknown value,
/// asks for nothing.
pub fn mode_from_app_json(directory: &std::path::Path) -> Option<Mode> {
    let text = std::fs::read_to_string(directory.join("app.json")).ok()?;
    // The file has one object with simple values; no parser is linked for
    // anything else, so find `"titleBar"` and the string after its colon.
    let at = text.find("\"titleBar\"")?;
    let rest = &text[at + "\"titleBar\"".len()..];
    let colon = rest.find(':')?;
    let rest = rest[colon + 1..].trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Mode::parse(&rest[..end])
}

/// Whether a test asked this failure to happen (`SOLID_DESKTOP_TEST` set and
/// `SOLID_DESKTOP_CHROME_FAIL=borderless|hit-test`). It exercises the
/// fallback before the first frame without a system that would fail on its
/// own.
fn injected(which: &str) -> bool {
    std::env::var_os("SOLID_DESKTOP_TEST").is_some()
        && std::env::var("SOLID_DESKTOP_CHROME_FAIL").ok().as_deref() == Some(which)
}

/// Creates the window in `requested` mode. A borderless window that cannot
/// be made, or whose hit test cannot be installed, is replaced by a native
/// one before anything is drawn, and the mode reported afterwards is
/// `native`.
pub unsafe fn create_window(title: &CStr, width: i32, height: i32, requested: Mode) -> Result<*mut SDL_Window, String> {
    let base = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
    let mut effective = requested;
    let mut window = ptr::null_mut();
    if requested != Mode::Native && !injected("borderless") {
        window = SDL_CreateWindow(title.as_ptr(), width, height, base | SDL_WINDOW_BORDERLESS);
    }
    if window.is_null() {
        // Either native was asked for, or the borderless window failed.
        window = SDL_CreateWindow(title.as_ptr(), width, height, base);
        effective = Mode::Native;
        if window.is_null() {
            return Err(format!("SDL could not create a window: {}", CStr::from_ptr(SDL_GetError()).to_string_lossy()));
        }
    }
    if effective != Mode::Native {
        let installed = !injected("hit-test") && SDL_SetWindowHitTest(window, Some(hit_test), ptr::null_mut());
        if installed {
            HIT_TEST.store(true, Ordering::Relaxed);
        } else {
            // Never leave a borderless window without the scene's chrome.
            SDL_DestroyWindow(window);
            window = SDL_CreateWindow(title.as_ptr(), width, height, base);
            effective = Mode::Native;
            if window.is_null() {
                return Err(format!(
                    "SDL could not create a window after hit testing failed: {}",
                    CStr::from_ptr(SDL_GetError()).to_string_lossy()
                ));
            }
        }
    }
    MODE.store(effective as u8, Ordering::Relaxed);
    init_state(window);
    Ok(window)
}

/// Reads SDL's flags once, when the window exists; from then on events keep
/// the state current.
unsafe fn init_state(window: *mut SDL_Window) {
    if window.is_null() {
        return;
    }
    let flags = SDL_GetWindowFlags(window);
    let has = |flag: SDL_WindowFlags| flags.0 & flag.0 != 0;
    let mut state = STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *state = State {
        focused: has(SDL_WINDOW_INPUT_FOCUS),
        minimized: has(SDL_WINDOW_MINIMIZED),
        maximized: has(SDL_WINDOW_MAXIMIZED),
        fullscreen: has(SDL_WINDOW_FULLSCREEN),
        resizable: has(SDL_WINDOW_RESIZABLE),
    };
    RESIZABLE.store(state.resizable, Ordering::Relaxed);
}

/// One measured region, in scene units: `drag` is true for a draggable area
/// and false for an explicit no-drag (an interactive control).
#[derive(Clone, Copy)]
pub struct SceneRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub drag: bool,
}

/// A region in SDL's window coordinates, clipped to the window.
#[derive(Clone, Copy)]
struct Rect {
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
    drag: bool,
}

impl Rect {
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x0 && x < self.x1 && y >= self.y0 && y < self.y1
    }

    fn area(&self) -> i64 {
        (self.x1 - self.x0) as i64 * (self.y1 - self.y0) as i64
    }
}

struct Snapshot {
    /// The window's size in SDL's window coordinates, which is where the
    /// hit-test point is: not the drawing buffer's pixels, which differ
    /// wherever the window system counts in points.
    width: i32,
    height: i32,
    /// The resize border and corner, in window coordinates.
    border: i32,
    corner: i32,
    regions: Vec<Rect>,
    scene: Vec<SceneRegion>,
    /// Window coordinates per scene unit: the inverse of `Metrics.from_window`.
    to_window: f64,
    resizable: bool,
    maximized: bool,
    fullscreen: bool,
}

/// The metrics the hit test needs, read when the regions are published and
/// when the size or the display's scale changes, never from the callback.
unsafe fn geometry() -> (f64, i32, i32) {
    let metrics = window::metrics();
    // `from_window` is layout units per unit of SDL's window coordinates,
    // so its inverse converts scene units the other way, and the window's
    // own size follows from the layout size the same way.
    let to_window = if metrics.from_window > 0.0 { 1.0 / metrics.from_window } else { 1.0 };
    let width = (metrics.width * to_window).round() as i32;
    let height = (metrics.height * to_window).round() as i32;
    (to_window, width, height)
}

impl Snapshot {
    const fn empty() -> Snapshot {
        Snapshot {
            width: 0,
            height: 0,
            border: 0,
            corner: 0,
            regions: Vec::new(),
            scene: Vec::new(),
            to_window: 1.0,
            resizable: false,
            maximized: false,
            fullscreen: false,
        }
    }

    fn build(scene: Vec<SceneRegion>, to_window: f64, width: i32, height: i32, resizable: bool, maximized: bool, fullscreen: bool) -> Snapshot {
        let mut snapshot = Snapshot {
            width,
            height,
            border: ((BORDER * to_window).round() as i32).max(1),
            corner: ((CORNER * to_window).round() as i32).max(1),
            regions: Vec::with_capacity(scene.len()),
            scene,
            to_window,
            resizable,
            maximized,
            fullscreen,
        };
        snapshot.rebuild();
        snapshot
    }

    /// Window rectangles from the scene rectangles. Called when the regions
    /// are published and when the size or the display's scale changes, never
    /// from the hit-test callback.
    fn rebuild(&mut self) {
        self.regions.clear();
        self.regions.reserve(self.scene.len());
        for region in &self.scene {
            let x0 = (region.x * self.to_window).round() as i32;
            let y0 = (region.y * self.to_window).round() as i32;
            let x1 = ((region.x + region.width) * self.to_window).round() as i32;
            let y1 = ((region.y + region.height) * self.to_window).round() as i32;
            // A region outside the window cannot be hit; clipping also keeps
            // a stale rectangle from claiming the whole window.
            let (x0, y0) = (x0.max(0), y0.max(0));
            let (x1, y1) = (x1.min(self.width), y1.min(self.height));
            if x1 <= x0 || y1 <= y0 {
                continue;
            }
            self.regions.push(Rect { x0, y0, x1, y1, drag: region.drag });
        }
    }
}

static SNAPSHOT: Mutex<Snapshot> = Mutex::new(Snapshot::empty());

/// Publishes the scene's regions in scene units. One call per layout turn.
pub fn publish(regions: Vec<SceneRegion>) {
    let (to_window, width, height) = unsafe { geometry() };
    let state = state();
    let mut snapshot = SNAPSHOT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *snapshot = Snapshot::build(
        regions,
        to_window,
        width,
        height,
        state.resizable,
        state.maximized,
        state.fullscreen,
    );
}

/// Recomputes the window rectangles from the same scene regions: the display
/// scale or the window size changed.
fn rescale() {
    let (to_window, width, height) = unsafe { geometry() };
    let state = state();
    let mut snapshot = SNAPSHOT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    snapshot.width = width;
    snapshot.height = height;
    snapshot.to_window = to_window;
    snapshot.border = ((BORDER * to_window).round() as i32).max(1);
    snapshot.corner = ((CORNER * to_window).round() as i32).max(1);
    snapshot.resizable = state.resizable;
    snapshot.maximized = state.maximized;
    snapshot.fullscreen = state.fullscreen;
    snapshot.rebuild();
}

/// The resolver's answer, compared by its SDL number so that tests can say
/// what they expect without SDL's type having to implement `Debug`.
#[derive(Clone, Copy)]
pub struct Hit(pub SDL_HitTestResult);

impl PartialEq for Hit {
    fn eq(&self, other: &Hit) -> bool {
        self.0.0 == other.0.0
    }
}

impl std::fmt::Debug for Hit {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(name_of(self.0))
    }
}

/// Which `SDL_HitTestResult` a point in window coordinates gets. Precedence,
/// from the design: resize edges and corners first (when there is something
/// to resize), then the deepest no-drag region, then the deepest drag
/// region, then `NORMAL`.
fn resolve(x: i32, y: i32, snapshot: &Snapshot) -> Hit {
    if snapshot.resizable && !snapshot.maximized && !snapshot.fullscreen && snapshot.width > 0 && snapshot.height > 0 {
        let (left, right) = (x < snapshot.border, x >= snapshot.width - snapshot.border);
        let (top, bottom) = (y < snapshot.border, y >= snapshot.height - snapshot.border);
        let (left_corner, right_corner) = (x < snapshot.corner, x >= snapshot.width - snapshot.corner);
        let (top_corner, bottom_corner) = (y < snapshot.corner, y >= snapshot.height - snapshot.corner);
        if top && left_corner || left && top_corner {
            return Hit(SDL_HITTEST_RESIZE_TOPLEFT);
        }
        if top && right_corner || right && top_corner {
            return Hit(SDL_HITTEST_RESIZE_TOPRIGHT);
        }
        if bottom && left_corner || left && bottom_corner {
            return Hit(SDL_HITTEST_RESIZE_BOTTOMLEFT);
        }
        if bottom && right_corner || right && bottom_corner {
            return Hit(SDL_HITTEST_RESIZE_BOTTOMRIGHT);
        }
        if top {
            return Hit(SDL_HITTEST_RESIZE_TOP);
        }
        if bottom {
            return Hit(SDL_HITTEST_RESIZE_BOTTOM);
        }
        if left {
            return Hit(SDL_HITTEST_RESIZE_LEFT);
        }
        if right {
            return Hit(SDL_HITTEST_RESIZE_RIGHT);
        }
    }
    let mut deepest: Option<&Rect> = None;
    for region in &snapshot.regions {
        if !region.contains(x, y) {
            continue;
        }
        match deepest {
            // A smaller region is deeper. At the same size a no-drag wins:
            // an interactive node keeps its click from starting a drag.
            Some(current) if current.area() < region.area() => {}
            Some(current) if current.area() == region.area() && !(region.drag == false && current.drag) => {}
            _ => deepest = Some(region),
        }
    }
    match deepest {
        Some(region) if region.drag => Hit(SDL_HITTEST_DRAGGABLE),
        _ => Hit(SDL_HITTEST_NORMAL),
    }
}

/// The SDL callback. It only reads: no JavaScript, no allocation, and no
/// waiting for the publish that may hold the lock.
unsafe extern "C" fn hit_test(_window: *mut SDL_Window, area: *const SDL_Point, _data: *mut std::ffi::c_void) -> SDL_HitTestResult {
    if area.is_null() {
        return SDL_HITTEST_NORMAL;
    }
    let Ok(snapshot) = SNAPSHOT.try_lock() else {
        return SDL_HITTEST_NORMAL;
    };
    resolve((*area).x, (*area).y, &snapshot).0
}

/// Updates the window state from an event, when the event says something
/// about it. Called while the loop drains the system's queue.
pub unsafe fn observe(event: &SDL_Event) {
    let kind = SDL_EventType(event.r#type);
    match kind {
        SDL_EVENT_WINDOW_FOCUS_GAINED => set(|state| state.focused = true),
        SDL_EVENT_WINDOW_FOCUS_LOST => set(|state| state.focused = false),
        SDL_EVENT_WINDOW_MINIMIZED => set(|state| state.minimized = true),
        SDL_EVENT_WINDOW_RESTORED => set(|state| {
            state.minimized = false;
            state.maximized = false;
        }),
        SDL_EVENT_WINDOW_MAXIMIZED => set(|state| {
            state.maximized = true;
            state.minimized = false;
        }),
        SDL_EVENT_WINDOW_ENTER_FULLSCREEN => {
            let was = state().resizable;
            RESIZABLE.store(was, Ordering::Relaxed);
            set(|state| {
                state.fullscreen = true;
                state.resizable = false;
            });
        }
        SDL_EVENT_WINDOW_LEAVE_FULLSCREEN => {
            let resizable = RESIZABLE.load(Ordering::Relaxed);
            set(|state| {
                state.fullscreen = false;
                state.resizable = resizable;
            });
        }
        SDL_EVENT_WINDOW_RESIZED | SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED | SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED => rescale(),
        SDL_EVENT_MOUSE_BUTTON_DOWN => {
            // The title bar's menu, where the system has one: a right press on
            // a draggable region. The scene never sees a right click as a
            // click anyway, and the hit test is the framework's.
            let button = &event.button;
            let (x, y) = (button.x.round() as i32, button.y.round() as i32);
            if !(button.down && button.button == 3 && hit_test_installed()) {
                return;
            }
            let Ok(snapshot) = SNAPSHOT.lock() else {
                return;
            };
            if resolve(x, y, &snapshot) == Hit(SDL_HITTEST_DRAGGABLE) {
                SDL_ShowWindowSystemMenu(window::handle(), x, y);
            }
        }
        _ => return,
    }
}

fn set(change: impl FnOnce(&mut State)) {
    let mut state = STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (resizable, maximized, fullscreen) = (state.resizable, state.maximized, state.fullscreen);
    change(&mut state);
    let changed = resizable != state.resizable || maximized != state.maximized || fullscreen != state.fullscreen;
    drop(state);
    if changed {
        rescale();
    }
}

/// `__solid.window.chrome().state()` and the actions. The booleans mean SDL
/// took the request; the next event is what the state follows.
unsafe extern "C" fn chrome_state(env: napi_env, _info: napi_callback_info) -> napi_value {
    let state = state();
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    let put = |name: &CStr, value: bool| {
        napi_set_named_property(env, object, name.as_ptr(), boolean(env, value));
    };
    put(c"focused", state.focused);
    put(c"minimized", state.minimized);
    put(c"maximized", state.maximized);
    put(c"fullscreen", state.fullscreen);
    put(c"resizable", state.resizable);
    object
}

unsafe extern "C" fn minimize(env: napi_env, _info: napi_callback_info) -> napi_value {
    boolean(env, SDL_MinimizeWindow(window::handle()))
}

unsafe extern "C" fn toggle_maximized(env: napi_env, _info: napi_callback_info) -> napi_value {
    let done = if state().maximized {
        SDL_RestoreWindow(window::handle())
    } else {
        SDL_MaximizeWindow(window::handle())
    };
    boolean(env, done)
}

unsafe extern "C" fn set_fullscreen(env: napi_env, info: napi_callback_info) -> napi_value {
    let [value] = arguments::<1>(env, info);
    let mut fullscreen = false;
    if napi_get_value_bool(env, value, &mut fullscreen) != NAPI_OK {
        return throw(env, "setFullscreen: pass true or false");
    }
    boolean(env, SDL_SetWindowFullscreen(window::handle(), fullscreen))
}

/// Ends the app the way closing the window does: the close event reaches
/// the host's listener, which disposes of the app and exits.
unsafe extern "C" fn request_close(env: napi_env, _info: napi_callback_info) -> napi_value {
    let mut event: SDL_Event = std::mem::zeroed();
    event.r#type = SDL_EVENT_WINDOW_CLOSE_REQUESTED.0;
    SDL_PushEvent(&mut event);
    undefined(env)
}

unsafe extern "C" fn show_system_menu(env: napi_env, info: napi_callback_info) -> napi_value {
    let [x, y] = arguments::<2>(env, info);
    let to_window = 1.0 / window::metrics().from_window;
    let x = number_or(env, x, 0.0) * to_window;
    let y = number_or(env, y, 0.0) * to_window;
    if !x.is_finite() || !y.is_finite() {
        return throw(env, "showSystemMenu: the position must be two numbers");
    }
    boolean(env, SDL_ShowWindowSystemMenu(window::handle(), x.round() as i32, y.round() as i32))
}

/// `__solid.window.chrome().regions([{ x, y, width, height, drag }])`: one
/// batch, in scene units. An empty array clears them (unmount).
unsafe extern "C" fn regions(env: napi_env, info: napi_callback_info) -> napi_value {
    let [list] = arguments::<1>(env, info);
    let mut is_array = false;
    if napi_is_array(env, list, &mut is_array) != NAPI_OK || !is_array {
        return throw(env, "regions: pass an array");
    }
    let mut length = 0;
    napi_get_array_length(env, list, &mut length);
    let mut measured = Vec::with_capacity(length as usize);
    for index in 0..length {
        let mut entry = ptr::null_mut();
        if napi_get_element(env, list, index, &mut entry) != NAPI_OK {
            return throw(env, "regions: every entry must be an object");
        }
        let read = |name: &CStr| -> f64 {
            let mut value = ptr::null_mut();
            if napi_get_named_property(env, entry, name.as_ptr(), &mut value) != NAPI_OK {
                return f64::NAN;
            }
            number_or(env, value, f64::NAN)
        };
        let (x, y, width, height) = (read(c"x"), read(c"y"), read(c"width"), read(c"height"));
        if ![x, y, width, height].iter().all(|value| value.is_finite()) || width <= 0.0 || height <= 0.0 {
            return throw(env, "regions: x, y, width and height must be finite, with a positive size");
        }
        let mut drag = ptr::null_mut();
        let mut is_drag = false;
        if napi_get_named_property(env, entry, c"drag".as_ptr(), &mut drag) == NAPI_OK {
            napi_get_value_bool(env, drag, &mut is_drag);
        }
        measured.push(SceneRegion { x, y, width, height, drag: is_drag });
    }
    publish(measured);
    undefined(env)
}

/// Installs the `chrome` object on `__solid.window`.
pub unsafe fn install(env: napi_env, window_object: napi_value) {
    let chrome = define_object(env, window_object, c"chrome");
    define_function(env, chrome, c"state", chrome_state);
    define_function(env, chrome, c"minimize", minimize);
    define_function(env, chrome, c"toggleMaximized", toggle_maximized);
    define_function(env, chrome, c"setFullscreen", set_fullscreen);
    define_function(env, chrome, c"requestClose", request_close);
    define_function(env, chrome, c"showSystemMenu", show_system_menu);
    define_function(env, chrome, c"regions", regions);
    napi_set_named_property(env, chrome, c"mode".as_ptr(), string(env, mode().as_str()));
    napi_set_named_property(env, chrome, c"os".as_ptr(), string(env, os()));
    napi_set_named_property(env, chrome, c"hitTestInstalled".as_ptr(), boolean(env, hit_test_installed()));
}

/// The scene regions the snapshot holds, as `(x, y, width, height, drag)`,
/// for the test interface.
pub fn scene_regions() -> Vec<(f64, f64, f64, f64, bool)> {
    let snapshot = SNAPSHOT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    snapshot.scene.iter().map(|region| (region.x, region.y, region.width, region.height, region.drag)).collect()
}

/// The test interface's native query: the resolver's classification at a
/// point in scene units, as `SDL_HitTestResult`'s own name. It is the query
/// the design asks for, not a simulation of the window system.
pub fn query(x: f64, y: f64) -> &'static str {
    let (to_window, _, _) = unsafe { geometry() };
    let snapshot = SNAPSHOT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let result = resolve((x * to_window).round() as i32, (y * to_window).round() as i32, &snapshot);
    name_of(result.0)
}

pub fn name_of(result: SDL_HitTestResult) -> &'static str {
    match result.0 {
        value if value == SDL_HITTEST_DRAGGABLE.0 => "draggable",
        value if value == SDL_HITTEST_RESIZE_TOPLEFT.0 => "resize-topleft",
        value if value == SDL_HITTEST_RESIZE_TOP.0 => "resize-top",
        value if value == SDL_HITTEST_RESIZE_TOPRIGHT.0 => "resize-topright",
        value if value == SDL_HITTEST_RESIZE_RIGHT.0 => "resize-right",
        value if value == SDL_HITTEST_RESIZE_BOTTOMRIGHT.0 => "resize-bottomright",
        value if value == SDL_HITTEST_RESIZE_BOTTOM.0 => "resize-bottom",
        value if value == SDL_HITTEST_RESIZE_BOTTOMLEFT.0 => "resize-bottomleft",
        value if value == SDL_HITTEST_RESIZE_LEFT.0 => "resize-left",
        _ => "normal",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The expectations as `Hit`s, so both sides of an assertion have `Debug`.
    const SDL_HITTEST_NORMAL: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_NORMAL);
    const SDL_HITTEST_DRAGGABLE: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_DRAGGABLE);
    const SDL_HITTEST_RESIZE_TOPLEFT: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_RESIZE_TOPLEFT);
    const SDL_HITTEST_RESIZE_TOP: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_RESIZE_TOP);
    const SDL_HITTEST_RESIZE_TOPRIGHT: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_RESIZE_TOPRIGHT);
    const SDL_HITTEST_RESIZE_RIGHT: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_RESIZE_RIGHT);
    const SDL_HITTEST_RESIZE_BOTTOMRIGHT: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_RESIZE_BOTTOMRIGHT);
    const SDL_HITTEST_RESIZE_BOTTOM: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_RESIZE_BOTTOM);
    const SDL_HITTEST_RESIZE_BOTTOMLEFT: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_RESIZE_BOTTOMLEFT);
    const SDL_HITTEST_RESIZE_LEFT: Hit = Hit(sdl3_sys::everything::SDL_HITTEST_RESIZE_LEFT);

    fn region(x: f64, y: f64, width: f64, height: f64, drag: bool) -> SceneRegion {
        SceneRegion { x, y, width, height, drag }
    }

    /// A window as `publish` holds it, named by its display scale. The X11
    /// family: SDL's window coordinates are pixels and the scale divides
    /// them into scene units, so `from_window` is 1/scale and its inverse,
    /// the conversion `publish` uses, is the scale itself.
    fn snapshot(regions: Vec<SceneRegion>, scale: f64, scene_width: i32, scene_height: i32) -> Snapshot {
        let to_window = scale;
        Snapshot::build(
            regions,
            to_window,
            (scene_width as f64 * to_window).round() as i32,
            (scene_height as f64 * to_window).round() as i32,
            true,
            false,
            false,
        )
    }

    #[test]
    fn the_resize_border_wins_over_a_title_bar_drag_region() {
        // A title bar across the top, which would otherwise be draggable.
        let s = snapshot(vec![region(0.0, 0.0, 800.0, 40.0, true)], 1.0, 800, 600);
        assert_eq!(resolve(400, 3, &s), SDL_HITTEST_RESIZE_TOP);
        assert_eq!(resolve(400, 20, &s), SDL_HITTEST_DRAGGABLE);
        assert_eq!(resolve(3, 300, &s), SDL_HITTEST_RESIZE_LEFT);
        assert_eq!(resolve(797, 300, &s), SDL_HITTEST_RESIZE_RIGHT);
        assert_eq!(resolve(400, 597, &s), SDL_HITTEST_RESIZE_BOTTOM);
        // Corners are larger than the border and own the overlap.
        assert_eq!(resolve(2, 2, &s), SDL_HITTEST_RESIZE_TOPLEFT);
        assert_eq!(resolve(798, 598, &s), SDL_HITTEST_RESIZE_BOTTOMRIGHT);
        assert_eq!(resolve(798, 2, &s), SDL_HITTEST_RESIZE_TOPRIGHT);
        assert_eq!(resolve(2, 598, &s), SDL_HITTEST_RESIZE_BOTTOMLEFT);
    }

    #[test]
    fn maximized_and_fullscreen_windows_have_no_resize_edges() {
        let regions = vec![region(0.0, 0.0, 800.0, 40.0, true)];
        for (maximized, fullscreen) in [(true, false), (false, true)] {
            let s = Snapshot::build(regions.clone(), 1.0, 800, 600, true, maximized, fullscreen);
            assert_eq!(resolve(3, 3, &s), SDL_HITTEST_DRAGGABLE);
            assert_eq!(resolve(797, 597, &s), SDL_HITTEST_NORMAL);
        }
    }

    #[test]
    fn a_deeper_no_drag_region_wins_over_the_drag_region_around_it() {
        // A title bar with a close button inside it.
        let s = snapshot(
            vec![
                region(0.0, 0.0, 800.0, 40.0, true),
                region(760.0, 4.0, 32.0, 32.0, false),
            ],
            1.0,
            800,
            600,
        );
        assert_eq!(resolve(400, 20, &s), SDL_HITTEST_DRAGGABLE);
        assert_eq!(resolve(776, 20, &s), SDL_HITTEST_NORMAL);
    }

    #[test]
    fn the_innermost_drag_region_wins() {
        let s = snapshot(
            vec![
                region(0.0, 0.0, 800.0, 400.0, true),
                region(100.0, 40.0, 200.0, 100.0, true),
            ],
            1.0,
            800,
            600,
        );
        // Both contain the point and both are draggable: the answer is the
        // same, and outside the inner one the outer one is still right.
        assert_eq!(resolve(150, 80, &s), SDL_HITTEST_DRAGGABLE);
        assert_eq!(resolve(500, 200, &s), SDL_HITTEST_DRAGGABLE);
        assert_eq!(resolve(500, 500, &s), SDL_HITTEST_NORMAL);
    }

    #[test]
    fn a_no_drag_region_that_is_not_deepest_does_not_win() {
        // A large no-drag panel with a smaller drag strip on top of it.
        let s = snapshot(
            vec![
                region(0.0, 0.0, 800.0, 400.0, false),
                region(0.0, 0.0, 800.0, 40.0, true),
            ],
            1.0,
            800,
            600,
        );
        assert_eq!(resolve(400, 20, &s), SDL_HITTEST_DRAGGABLE);
        assert_eq!(resolve(400, 200, &s), SDL_HITTEST_NORMAL);
    }

    #[test]
    fn regions_outside_the_window_are_clipped_and_never_hit() {
        let s = snapshot(vec![region(-500.0, -500.0, 100.0, 100.0, true), region(700.0, 500.0, 500.0, 500.0, false)], 1.0, 800, 600);
        // The first is entirely off the window; the second is partly on it.
        assert_eq!(resolve(10, 10, &s), SDL_HITTEST_NORMAL);
        assert_eq!(resolve(750, 550, &s), SDL_HITTEST_NORMAL);
        assert_eq!(s.regions.len(), 1);
        assert_eq!((s.regions[0].x1, s.regions[0].y1), (800, 600));
    }

    #[test]
    fn scene_units_convert_at_each_display_scale() {
        for scale in [1.0, 1.25, 2.0] {
            // The X11 family at 100, 125 and 200 %: a scene of 800 x 600
            // units fills a window of 800 x scale x 600 x scale window
            // coordinates. A point in scene units is converted the way
            // `publish` converts a region: multiplied by the scale.
            let s = snapshot(vec![region(0.0, 0.0, 800.0, 40.0, true)], scale, 800, 600);
            let at = |scene: f64| (scene * scale).round() as i32;
            assert_eq!(resolve(at(20.0), at(20.0), &s), SDL_HITTEST_DRAGGABLE, "scale {scale}");
            assert_eq!(resolve(at(20.0), at(60.0), &s), SDL_HITTEST_NORMAL, "scale {scale}");
            // The top border is the same number of scene units at every
            // scale: 7 of them, never 7 pixels.
            assert_eq!(resolve(at(20.0), at(BORDER - 3.0), &s), SDL_HITTEST_RESIZE_TOP, "scale {scale}");
            assert_eq!(resolve(at(20.0), at(BORDER + 3.0), &s), SDL_HITTEST_DRAGGABLE, "scale {scale}");
            // The corners keep the window's own edges, in its own coordinates.
            assert_eq!(resolve(at(2.0), at(2.0), &s), SDL_HITTEST_RESIZE_TOPLEFT, "scale {scale}");
            let (width, height) = (800.0 * scale, 600.0 * scale);
            assert_eq!(resolve(width as i32 - 2, height as i32 - 2, &s), SDL_HITTEST_RESIZE_BOTTOMRIGHT, "scale {scale}");
        }
    }

    #[test]
    fn a_window_that_counts_in_points_keeps_scene_sized_coordinates() {
        // The Wayland and macOS family: the scale divides the drawing
        // buffer, not the window's coordinates, so scene units and window
        // coordinates are one to one (`from_window` is 1 and so is its
        // inverse) however the display is scaled.
        let s = snapshot(vec![region(0.0, 0.0, 800.0, 40.0, true)], 1.0, 800, 600);
        assert_eq!(resolve(20, 20, &s), SDL_HITTEST_DRAGGABLE);
        assert_eq!(resolve(20, 60, &s), SDL_HITTEST_NORMAL);
        assert_eq!(resolve(2, 2, &s), SDL_HITTEST_RESIZE_TOPLEFT);
    }

    #[test]
    fn an_empty_scene_answers_normal() {
        let s = snapshot(Vec::new(), 1.0, 800, 600);
        assert_eq!(resolve(400, 300, &s), SDL_HITTEST_NORMAL);
        // Except at the resize edges, which exist whenever the window can be
        // resized: a borderless window with no scene regions is still
        // resizable from its edges.
        assert_eq!(resolve(2, 2, &s), SDL_HITTEST_RESIZE_TOPLEFT);
    }

    #[test]
    fn the_regions_replace_whole_batches() {
        // What a publish does: the previous batch is gone, so an unmounted
        // control stops being a no-drag hole at the next publish.
        let first = snapshot(vec![region(0.0, 0.0, 100.0, 40.0, true), region(10.0, 5.0, 20.0, 20.0, false)], 1.0, 800, 600);
        assert_eq!(resolve(20, 15, &first), SDL_HITTEST_NORMAL);
        let second = Snapshot::build(vec![region(0.0, 0.0, 100.0, 40.0, true)], 1.0, 800, 600, true, false, false);
        assert_eq!(resolve(20, 15, &second), SDL_HITTEST_DRAGGABLE);
        let empty = Snapshot::build(Vec::new(), 1.0, 800, 600, true, false, false);
        assert_eq!(resolve(20, 15, &empty), SDL_HITTEST_NORMAL);
    }

    #[test]
    fn a_point_on_the_edge_of_a_region_is_outside_it() {
        let s = snapshot(vec![region(0.0, 0.0, 100.0, 40.0, true)], 1.0, 800, 600);
        assert_eq!(resolve(99, 39, &s), SDL_HITTEST_DRAGGABLE);
        assert_eq!(resolve(100, 39, &s), SDL_HITTEST_NORMAL);
    }

    #[test]
    fn the_mode_names_parse_and_print() {
        for mode in [Mode::Native, Mode::Custom, Mode::Hidden] {
            assert_eq!(Mode::parse(mode.as_str()), Some(mode));
        }
        assert_eq!(Mode::parse("Native"), None);
        assert_eq!(Mode::parse(""), None);
    }
}
