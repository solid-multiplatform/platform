//! The event loop: one thread that blocks in SDL until an event, a timer or a
//! requested frame gives it something to do. Nothing here polls.
//!
//! JavaScript gets `setTimeout`, `clearTimeout`, `requestAnimationFrame`,
//! `cancelAnimationFrame` and `performance.now`. A frame is drawn only when
//! JavaScript asked for one, and the buffer swap paces it to the display.

use crate::napi::*;
use sdl3_sys::everything::*;
use std::cell::RefCell;
use std::ffi::c_void;
use std::ptr;

struct Timer {
    id: u32,
    due: u64,
    callback: napi_ref,
}

#[derive(Default)]
pub struct Loop {
    engine: Option<*mut c_void>,
    next_id: u32,
    timers: Vec<Timer>,
    frames: Vec<(u32, napi_ref)>,
    /// Set by a GL call that changed the back buffer.
    pub drew: bool,
    pub exit: Option<i32>,
    /// Counters the tests read: how often the loop woke and what it did.
    pub wakeups: u64,
    pub frames_run: u64,
}

thread_local! {
    pub static LOOP: RefCell<Loop> = RefCell::new(Loop::default());
}

fn now_ms() -> u64 {
    unsafe { SDL_GetTicks() }
}

unsafe extern "C" fn set_timeout(env: napi_env, info: napi_callback_info) -> napi_value {
    let [callback, delay] = arguments::<2>(env, info);
    let delay = number_or(env, delay, 0.0).max(0.0) as u64;
    let mut reference = ptr::null_mut();
    napi_create_reference(env, callback, 1, &mut reference);
    let id = LOOP.with(|l| {
        let mut l = l.borrow_mut();
        l.next_id += 1;
        let id = l.next_id;
        l.timers.push(Timer { id, due: now_ms() + delay, callback: reference });
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
    let mut reference = ptr::null_mut();
    napi_create_reference(env, callback, 1, &mut reference);
    let id = LOOP.with(|l| {
        let mut l = l.borrow_mut();
        l.next_id += 1;
        let id = l.next_id;
        l.frames.push((id, reference));
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
    number(env, SDL_GetTicksNS() as f64 / 1_000_000.0)
}

unsafe extern "C" fn exit(env: napi_env, info: napi_callback_info) -> napi_value {
    let [code] = arguments::<1>(env, info);
    let code = number_or(env, code, 0.0) as i32;
    LOOP.with(|l| l.borrow_mut().exit = Some(code));
    undefined(env)
}

/// What the loop has done so far, for tests: `{ wakeups, frames }`.
unsafe extern "C" fn stats(env: napi_env, _info: napi_callback_info) -> napi_value {
    let (wakeups, frames) = LOOP.with(|l| {
        let l = l.borrow();
        (l.wakeups, l.frames_run)
    });
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    napi_set_named_property(env, object, c"wakeups".as_ptr(), number(env, wakeups as f64));
    napi_set_named_property(env, object, c"frames".as_ptr(), number(env, frames as f64));
    object
}

pub unsafe fn install(env: napi_env, engine: *mut c_void, global: napi_value) {
    LOOP.with(|l| l.borrow_mut().engine = Some(engine));
    define_function(env, global, "setTimeout", set_timeout);
    define_function(env, global, "clearTimeout", clear_timeout);
    define_function(env, global, "requestAnimationFrame", request_frame);
    define_function(env, global, "cancelAnimationFrame", cancel_frame);
    let mut performance = ptr::null_mut();
    napi_create_object(env, &mut performance);
    define_function(env, performance, "now", performance_now);
    napi_set_named_property(env, global, c"performance".as_ptr(), performance);
    let mut host = ptr::null_mut();
    napi_create_object(env, &mut host);
    define_function(env, host, "exit", exit);
    define_function(env, host, "stats", stats);
    napi_set_named_property(env, global, c"__solid".as_ptr(), host);
}

/// Calls a referenced JavaScript function, then runs the promise jobs it
/// queued. An exception is printed and does not stop the loop.
unsafe fn call(env: napi_env, engine: *mut c_void, reference: napi_ref, argument: Option<f64>) {
    let mut scope = ptr::null_mut();
    napi_open_handle_scope(env, &mut scope);
    let mut function = ptr::null_mut();
    napi_get_reference_value(env, reference, &mut function);
    let args = [argument.map(|v| number(env, v)).unwrap_or(ptr::null_mut())];
    let mut result = ptr::null_mut();
    let argc = if argument.is_some() { 1 } else { 0 };
    if napi_call_function(env, undefined(env), function, argc, args.as_ptr(), &mut result) != NAPI_OK {
        if let Some(message) = take_exception(env) {
            eprintln!("Uncaught {message}");
        }
    }
    napi_delete_reference(env, reference);
    napi_close_handle_scope(env, scope);
    solid_engine_drain(engine);
}

/// Runs until JavaScript asks to exit or the window is closed. Returns the
/// exit code.
pub unsafe fn run(env: napi_env, engine: *mut c_void, window: *mut SDL_Window) -> i32 {
    let mut event: SDL_Event = std::mem::zeroed();
    loop {
        if let Some(code) = LOOP.with(|l| l.borrow().exit) {
            return code;
        }
        // How long may the loop sleep? Not at all with a frame pending (the
        // swap below waits for the display); until the next timer otherwise;
        // without either, until the system has an event for us.
        let (frame_pending, next_due) = LOOP.with(|l| {
            let l = l.borrow();
            (!l.frames.is_empty(), l.timers.iter().map(|t| t.due).min())
        });
        let got_event = if frame_pending {
            SDL_PollEvent(&mut event)
        } else if let Some(due) = next_due {
            let wait = due.saturating_sub(now_ms()).min(i32::MAX as u64) as i32;
            SDL_WaitEventTimeout(&mut event, wait)
        } else {
            SDL_WaitEvent(&mut event)
        };
        LOOP.with(|l| l.borrow_mut().wakeups += 1);

        let mut pending = got_event;
        while pending {
            let kind = event.r#type;
            if kind == SDL_EVENT_QUIT.0 as u32 || kind == SDL_EVENT_WINDOW_CLOSE_REQUESTED.0 as u32 {
                return 0;
            }
            pending = SDL_PollEvent(&mut event);
        }

        // Timers that are due, oldest first.
        loop {
            let now = now_ms();
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
                Some(timer) => call(env, engine, timer.callback, None),
                None => break,
            }
        }

        // One frame: the callbacks requested before it began.
        let frames = LOOP.with(|l| std::mem::take(&mut l.borrow_mut().frames));
        if !frames.is_empty() {
            let time = SDL_GetTicksNS() as f64 / 1_000_000.0;
            for (_, callback) in frames {
                call(env, engine, callback, Some(time));
            }
            let drew = LOOP.with(|l| {
                let mut l = l.borrow_mut();
                l.frames_run += 1;
                std::mem::take(&mut l.drew)
            });
            if drew && !window.is_null() {
                SDL_GL_SwapWindow(window);
            }
        }
    }
}
