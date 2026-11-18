//! The event loop: one thread that blocks until an event, a timer, a finished
//! job or a requested frame gives it something to do. Nothing here polls.
//!
//! JavaScript gets `setTimeout`, `clearTimeout`, `requestAnimationFrame`,
//! `cancelAnimationFrame` and `performance.now`. A frame runs only when
//! JavaScript asked for one, at most once per display refresh, and the window
//! is presented only after a turn that drew.

use crate::napi::*;
use crate::{gl, worker};
use sdl3_sys::everything::*;
use std::cell::RefCell;
use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

struct Timer {
    id: u32,
    /// Nanoseconds on `now_ns`'s clock.
    due: u64,
    callback: napi_ref,
}

/// When the next frame may start. A presented frame is paced by the buffer
/// swap, which waits for the display; a frame that drew nothing, a display
/// without vertical sync and a loop without a window are paced by the clock,
/// so that a chain of animation frames never spins.
struct Pacing {
    /// One display refresh, in nanoseconds.
    period: u64,
    /// The swap waits for the display. Cleared for good when it evidently
    /// does not (a software rasterizer, a driver with sync forced off).
    vsync: bool,
    last_start: u64,
    last_presented: bool,
    /// Presented frames in a row that started under half a period apart.
    short: u8,
}

impl Pacing {
    fn due(&self) -> u64 {
        if self.vsync && self.last_presented {
            return 0;
        }
        self.last_start + self.period
    }

    fn started(&mut self, now: u64) {
        if self.vsync && self.last_presented {
            // With working sync two presented frames cannot start half a
            // refresh apart, let alone four times running.
            if now - self.last_start < self.period / 2 {
                self.short += 1;
                if self.short == 4 {
                    self.vsync = false;
                }
            } else {
                self.short = 0;
            }
        }
        self.last_start = now;
    }
}

pub struct Loop {
    next_id: u32,
    timers: Vec<Timer>,
    frames: Vec<(u32, napi_ref)>,
    pacing: Pacing,
    /// `__solid.window.listen`'s callback.
    window_listener: Option<napi_ref>,
    pub exit: Option<i32>,
    /// Counters the tests read: how often the loop woke and what it did.
    wakeups: u64,
    frames_run: u64,
    presents: u64,
}

thread_local! {
    pub static LOOP: RefCell<Loop> = const { RefCell::new(Loop {
        next_id: 0,
        timers: Vec::new(),
        frames: Vec::new(),
        pacing: Pacing { period: 1_000_000_000 / 60, vsync: false, last_start: 0, last_presented: false, short: 0 },
        window_listener: None,
        exit: None,
        wakeups: 0,
        frames_run: 0,
        presents: 0,
    }) };
}

static ENGINE: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());
static WINDOW: AtomicPtr<SDL_Window> = AtomicPtr::new(ptr::null_mut());

/// Nanoseconds since the runtime started, monotonic.
pub fn now_ns() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_nanos() as u64
}

fn milliseconds(ns: u64) -> f64 {
    ns as f64 / 1_000_000.0
}

/// Calls a JavaScript function, then runs the promise jobs it queued. An
/// exception is reported with its stack and does not stop the loop.
pub unsafe fn invoke(env: napi_env, function: napi_value, args: &[napi_value]) {
    let mut result = ptr::null_mut();
    if napi_call_function(env, undefined(env), function, args.len(), args.as_ptr(), &mut result) != NAPI_OK {
        if let Some(message) = take_exception(env) {
            eprintln!("Uncaught {message}");
        }
    }
    solid_engine_drain(ENGINE.load(Ordering::Relaxed));
}

/// Calls a referenced function once and releases the reference.
unsafe fn invoke_once(env: napi_env, reference: napi_ref, argument: Option<f64>) {
    let mut scope = ptr::null_mut();
    napi_open_handle_scope(env, &mut scope);
    let function = dereference(env, reference);
    match argument {
        Some(value) => invoke(env, function, &[number(env, value)]),
        None => invoke(env, function, &[]),
    }
    napi_delete_reference(env, reference);
    napi_close_handle_scope(env, scope);
}

unsafe extern "C" fn set_timeout(env: napi_env, info: napi_callback_info) -> napi_value {
    let [callback, delay] = arguments::<2>(env, info);
    let delay = number_or(env, delay, 0.0).max(0.0);
    let callback = reference(env, callback);
    let id = LOOP.with(|l| {
        let mut l = l.borrow_mut();
        l.next_id += 1;
        let id = l.next_id;
        l.timers.push(Timer { id, due: now_ns() + (delay * 1_000_000.0) as u64, callback });
        id
    });
    number(env, id as f64)
}

unsafe extern "C" fn clear_timeout(env: napi_env, info: napi_callback_info) -> napi_value {
    let [id] = arguments::<1>(env, info);
    let id = number_or(env, id, 0.0) as u32;
    let removed = LOOP.with(|l| {
        let mut l = l.borrow_mut();
        l.timers.iter().position(|t| t.id == id).map(|at| l.timers.swap_remove(at))
    });
    if let Some(timer) = removed {
        napi_delete_reference(env, timer.callback);
    }
    undefined(env)
}

unsafe extern "C" fn request_frame(env: napi_env, info: napi_callback_info) -> napi_value {
    let [callback] = arguments::<1>(env, info);
    let callback = reference(env, callback);
    let id = LOOP.with(|l| {
        let mut l = l.borrow_mut();
        l.next_id += 1;
        let id = l.next_id;
        l.frames.push((id, callback));
        id
    });
    number(env, id as f64)
}

unsafe extern "C" fn cancel_frame(env: napi_env, info: napi_callback_info) -> napi_value {
    let [id] = arguments::<1>(env, info);
    let id = number_or(env, id, 0.0) as u32;
    let removed = LOOP.with(|l| {
        let mut l = l.borrow_mut();
        l.frames.iter().position(|f| f.0 == id).map(|at| l.frames.remove(at))
    });
    if let Some((_, reference)) = removed {
        napi_delete_reference(env, reference);
    }
    undefined(env)
}

unsafe extern "C" fn performance_now(env: napi_env, _info: napi_callback_info) -> napi_value {
    number(env, milliseconds(now_ns()))
}

unsafe extern "C" fn exit(env: napi_env, info: napi_callback_info) -> napi_value {
    let [code] = arguments::<1>(env, info);
    let code = number_or(env, code, 0.0) as i32;
    LOOP.with(|l| l.borrow_mut().exit = Some(code));
    undefined(env)
}

/// What the loop has done so far, for tests: `{ wakeups, frames, presents }`.
unsafe extern "C" fn stats(env: napi_env, _info: napi_callback_info) -> napi_value {
    let (wakeups, frames, presents) = LOOP.with(|l| {
        let l = l.borrow();
        (l.wakeups, l.frames_run, l.presents)
    });
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    napi_set_named_property(env, object, c"wakeups".as_ptr(), number(env, wakeups as f64));
    napi_set_named_property(env, object, c"frames".as_ptr(), number(env, frames as f64));
    napi_set_named_property(env, object, c"presents".as_ptr(), number(env, presents as f64));
    object
}

/// `__solid.window.size()`: `{ width, height, pixelWidth, pixelHeight }`, the
/// window in layout units and its drawing buffer in pixels.
unsafe extern "C" fn window_size(env: napi_env, _info: napi_callback_info) -> napi_value {
    let [width, height, pixel_width, pixel_height] = window_metrics();
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    napi_set_named_property(env, object, c"width".as_ptr(), number(env, width));
    napi_set_named_property(env, object, c"height".as_ptr(), number(env, height));
    napi_set_named_property(env, object, c"pixelWidth".as_ptr(), number(env, pixel_width));
    napi_set_named_property(env, object, c"pixelHeight".as_ptr(), number(env, pixel_height));
    object
}

/// `__solid.window.setSize(width, height)` in layout units. The listener hears
/// `resize` once the window system has applied it.
unsafe extern "C" fn window_set_size(env: napi_env, info: napi_callback_info) -> napi_value {
    let [width, height] = arguments::<2>(env, info);
    let (width, height) = (number_or(env, width, 0.0), number_or(env, height, 0.0));
    if !(width >= 1.0 && height >= 1.0) {
        return throw(env, "window.setSize: width and height must be at least 1");
    }
    if !SDL_SetWindowSize(WINDOW.load(Ordering::Relaxed), width as i32, height as i32) {
        return throw(env, "window.setSize: the window system refused the size");
    }
    undefined(env)
}

/// `__solid.window.listen(callback)`: `callback(kind, width, height,
/// pixelWidth, pixelHeight)` for `"resize"` (the size changed) and
/// `"expose"` (the window's contents were lost and must be drawn again).
unsafe extern "C" fn window_listen(env: napi_env, info: napi_callback_info) -> napi_value {
    let [callback] = arguments::<1>(env, info);
    let callback = reference(env, callback);
    if let Some(previous) = LOOP.with(|l| l.borrow_mut().window_listener.replace(callback)) {
        napi_delete_reference(env, previous);
    }
    undefined(env)
}

unsafe fn window_metrics() -> [f64; 4] {
    let window = WINDOW.load(Ordering::Relaxed);
    let (mut width, mut height, mut pixel_width, mut pixel_height) = (0, 0, 0, 0);
    SDL_GetWindowSize(window, &mut width, &mut height);
    SDL_GetWindowSizeInPixels(window, &mut pixel_width, &mut pixel_height);
    [width as f64, height as f64, pixel_width as f64, pixel_height as f64]
}

unsafe fn notify_window(env: napi_env, kind: &str) {
    let Some(listener) = LOOP.with(|l| l.borrow().window_listener) else {
        return;
    };
    let mut scope = ptr::null_mut();
    napi_open_handle_scope(env, &mut scope);
    let [width, height, pixel_width, pixel_height] = window_metrics();
    let args = [
        string(env, kind),
        number(env, width),
        number(env, height),
        number(env, pixel_width),
        number(env, pixel_height),
    ];
    invoke(env, dereference(env, listener), &args);
    napi_close_handle_scope(env, scope);
}

/// Installs the loop's globals and the `__solid` host object, which it
/// returns. `window` is null for a loop without one.
pub unsafe fn install(env: napi_env, engine: *mut c_void, global: napi_value, window: *mut SDL_Window) -> napi_value {
    ENGINE.store(engine, Ordering::Relaxed);
    WINDOW.store(window, Ordering::Relaxed);
    define_function(env, global, c"setTimeout", set_timeout);
    define_function(env, global, c"clearTimeout", clear_timeout);
    define_function(env, global, c"requestAnimationFrame", request_frame);
    define_function(env, global, c"cancelAnimationFrame", cancel_frame);
    let performance = define_object(env, global, c"performance");
    define_function(env, performance, c"now", performance_now);
    let host = define_object(env, global, c"__solid");
    define_function(env, host, c"exit", exit);
    define_function(env, host, c"stats", stats);
    if !window.is_null() {
        let object = define_object(env, host, c"window");
        define_function(env, object, c"size", window_size);
        define_function(env, object, c"setSize", window_set_size);
        define_function(env, object, c"listen", window_listen);
        // Present on the display's refresh: this is what paces drawn frames.
        let mut interval = 0;
        let synced = SDL_GL_SetSwapInterval(1) && SDL_GL_GetSwapInterval(&mut interval) && interval != 0;
        let mode = SDL_GetCurrentDisplayMode(SDL_GetDisplayForWindow(window));
        let rate = if mode.is_null() { 0.0 } else { (*mode).refresh_rate };
        LOOP.with(|l| {
            let pacing = &mut l.borrow_mut().pacing;
            pacing.vsync = synced;
            if rate >= 1.0 {
                pacing.period = (1_000_000_000.0 / rate as f64) as u64;
            }
        });
    }
    host
}

/// Blocks until there may be something to do: forever without a deadline,
/// not at all when it has passed. Returns whether `event` holds an SDL event.
unsafe fn wait(windowed: bool, deadline: Option<u64>, event: &mut SDL_Event) -> bool {
    let remaining = deadline.map(|at| at.saturating_sub(now_ns()));
    if !windowed {
        if remaining != Some(0) {
            worker::wait_for_completion(remaining.map(Duration::from_nanos));
        }
        return false;
    }
    match remaining {
        None => SDL_WaitEvent(event),
        Some(0) => SDL_PollEvent(event),
        // Rounded up to SDL's milliseconds: waking early would only wait again.
        Some(ns) => SDL_WaitEventTimeout(event, ns.div_ceil(1_000_000).min(i32::MAX as u64) as i32),
    }
}

/// Runs until JavaScript asks to exit or the window is closed. Returns the
/// exit code.
pub unsafe fn run(env: napi_env) -> i32 {
    let window = WINDOW.load(Ordering::Relaxed);
    let mut event: SDL_Event = std::mem::zeroed();
    loop {
        if let Some(code) = LOOP.with(|l| l.borrow().exit) {
            return code;
        }
        // The next thing with a time: a requested frame or a timer. Without
        // either the loop sleeps until the system or a job wakes it.
        let (frame_at, timer_at) = LOOP.with(|l| {
            let l = l.borrow();
            ((!l.frames.is_empty()).then(|| l.pacing.due()), l.timers.iter().map(|t| t.due).min())
        });
        let deadline = match (frame_at, timer_at) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        let mut pending = wait(!window.is_null(), deadline, &mut event);
        LOOP.with(|l| l.borrow_mut().wakeups += 1);

        let (mut resized, mut exposed) = (false, false);
        while pending {
            let kind = event.r#type;
            if kind == SDL_EVENT_QUIT.0 as u32 || kind == SDL_EVENT_WINDOW_CLOSE_REQUESTED.0 as u32 {
                return 0;
            } else if kind == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED.0 as u32 || kind == SDL_EVENT_WINDOW_RESIZED.0 as u32 {
                resized = true;
            } else if kind == SDL_EVENT_WINDOW_EXPOSED.0 as u32 {
                exposed = true;
            }
            pending = SDL_PollEvent(&mut event);
        }
        // A drag sends a run of sizes: JavaScript hears the last one.
        if resized {
            notify_window(env, "resize");
        }
        if exposed {
            notify_window(env, "expose");
        }

        for completion in worker::take_completions() {
            let mut scope = ptr::null_mut();
            napi_open_handle_scope(env, &mut scope);
            completion(env);
            napi_close_handle_scope(env, scope);
        }

        // Timers that are due, oldest first.
        loop {
            let now = now_ns();
            let due = LOOP.with(|l| {
                let mut l = l.borrow_mut();
                let at = l
                    .timers
                    .iter()
                    .enumerate()
                    .filter(|(_, t)| t.due <= now)
                    .min_by_key(|(_, t)| (t.due, t.id))
                    .map(|(at, _)| at);
                at.map(|at| l.timers.swap_remove(at))
            });
            match due {
                Some(timer) => invoke_once(env, timer.callback, None),
                None => break,
            }
        }

        // One frame: the callbacks requested before it began, if it is time.
        let now = now_ns();
        let frames = LOOP.with(|l| {
            let mut l = l.borrow_mut();
            if l.frames.is_empty() || l.pacing.due() > now {
                return Vec::new();
            }
            l.pacing.started(now);
            l.frames_run += 1;
            std::mem::take(&mut l.frames)
        });
        let framed = !frames.is_empty();
        for (_, callback) in frames {
            invoke_once(env, callback, Some(milliseconds(now)));
        }

        // Whatever drew this turn reaches the screen now.
        let present = gl::take_drew() && !window.is_null();
        if present {
            SDL_GL_SwapWindow(window);
        }
        LOOP.with(|l| {
            let mut l = l.borrow_mut();
            l.presents += present as u64;
            if framed {
                l.pacing.last_presented = present;
            }
        });
    }
}
