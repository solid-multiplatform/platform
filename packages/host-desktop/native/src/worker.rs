//! Work that must not run on the JavaScript thread: reading files and
//! decoding images. A job runs on a pool thread and returns a completion,
//! which the event loop runs on the JavaScript thread.
//!
//! Nothing here polls. Pool threads block on the job queue, and a finished
//! job wakes the event loop: with an SDL user event when there is a window,
//! through a condition variable when there is none.

use crate::napi::*;
use sdl3_sys::everything::*;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

/// Runs on the JavaScript thread with the result of a job.
pub type Completion = Box<dyn FnOnce(napi_env) + Send>;
type Job = Box<dyn FnOnce() -> Completion + Send>;

/// Decodes are CPU-bound and a scene loads many images at once, but a pool
/// as wide as the machine would starve the frame of cores.
const MAX_THREADS: usize = 4;

struct Queue {
    jobs: VecDeque<Job>,
    threads: usize,
    idle: usize,
}

static QUEUE: Mutex<Queue> = Mutex::new(Queue { jobs: VecDeque::new(), threads: 0, idle: 0 });
static HAS_JOB: Condvar = Condvar::new();
static DONE: Mutex<Vec<Completion>> = Mutex::new(Vec::new());
static HAS_DONE: Condvar = Condvar::new();
/// The SDL event type that wakes a windowed loop; 0 without a window.
static WAKE_EVENT: AtomicU32 = AtomicU32::new(0);

/// A JavaScript reference a job carries to its completion. Only the
/// JavaScript thread may use it; the pool thread just holds the pointer.
pub struct Callback(pub napi_ref);
unsafe impl Send for Callback {}

/// Makes completions wake the loop through SDL. Call once SDL's event system
/// is up; without it the loop waits in `wait_for_completion`.
pub unsafe fn wake_through_sdl() {
    WAKE_EVENT.store(SDL_RegisterEvents(1), Ordering::Relaxed);
}

/// Queues `job` for a pool thread. Threads start on demand, up to the limit,
/// and then live for the process, blocked while the queue is empty.
pub fn submit(job: impl FnOnce() -> Completion + Send + 'static) {
    let mut queue = QUEUE.lock().unwrap();
    queue.jobs.push_back(Box::new(job));
    let limit = std::thread::available_parallelism().map_or(1, |n| n.get()).clamp(1, MAX_THREADS);
    let start = queue.jobs.len() > queue.idle && queue.threads < limit;
    if start {
        queue.threads += 1;
    }
    drop(queue);
    if start {
        std::thread::Builder::new().name("solid-worker".into()).spawn(work).expect("cannot start a worker thread");
    } else {
        HAS_JOB.notify_one();
    }
}

fn work() {
    loop {
        let job = {
            let mut queue = QUEUE.lock().unwrap();
            loop {
                if let Some(job) = queue.jobs.pop_front() {
                    break job;
                }
                queue.idle += 1;
                queue = HAS_JOB.wait(queue).unwrap();
                queue.idle -= 1;
            }
        };
        let completion = job();
        let mut done = DONE.lock().unwrap();
        // One wake announces every completion queued before the loop gets to
        // them, so a burst of decodes wakes the loop once.
        let announce = done.is_empty();
        done.push(completion);
        drop(done);
        if !announce {
            continue;
        }
        let event_type = WAKE_EVENT.load(Ordering::Relaxed);
        if event_type == 0 {
            HAS_DONE.notify_one();
        } else {
            unsafe {
                let mut event: SDL_Event = std::mem::zeroed();
                event.r#type = event_type;
                SDL_PushEvent(&mut event);
            }
        }
    }
}

/// Blocks a loop without a window until a job completes or `timeout` passes
/// (forever without one).
pub fn wait_for_completion(timeout: Option<Duration>) {
    let done = DONE.lock().unwrap();
    if !done.is_empty() {
        return;
    }
    match timeout {
        Some(timeout) => drop(HAS_DONE.wait_timeout(done, timeout).unwrap()),
        None => drop(HAS_DONE.wait(done).unwrap()),
    }
}

/// The completions queued so far. The event loop calls this every time it
/// wakes.
pub fn take_completions() -> Vec<Completion> {
    std::mem::take(&mut *DONE.lock().unwrap())
}
