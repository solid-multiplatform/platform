//! Local files for the app: its assets, read off the JavaScript thread.

use crate::napi::*;
use std::path::PathBuf;
use crate::runtime::invoke;
use crate::worker::{self, Callback};

/// `__solid.readFile(path, done)`: reads the whole file on a worker, then
/// calls `done(null, ArrayBuffer)` or `done(Error)`.
/// The path to read. A verbatim Windows path (`\\?\D:\app\a.png`) must
/// not carry forward slashes, which is what a JavaScript caller produces
/// when it joins a canonical directory with `/`.
fn readable(path: &str) -> PathBuf {
    match path.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => {
            PathBuf::from(rest.replace('/', "\\"))
        }
        _ => PathBuf::from(path),
    }
}

unsafe extern "C" fn read_file(env: napi_env, info: napi_callback_info) -> napi_value {
    let [path, done] = arguments::<2>(env, info);
    let Some(path) = string_argument(env, path) else {
        return throw(env, "readFile: the path must be a string");
    };
    let done = Callback(reference(env, done));
    worker::submit(move || {
        let result = std::fs::read(readable(&path))
            .map_err(|reason| format!("Cannot read {path}: {reason}"));
        Box::new(move |env| {
            let done = done;
            let function = dereference(env, done.0);
            match result {
                Ok(bytes) => invoke(env, function, &[null(env), adopt_bytes(env, bytes)]),
                Err(message) => invoke(env, function, &[error(env, &message)]),
            }
            napi_delete_reference(env, done.0);
        })
    });
    undefined(env)
}

/// `__solid.readText(path, done)`: the file as a string, decoded from UTF-8
/// on the worker (Hermes has no `TextDecoder`); `done(null, string)` or
/// `done(Error)`. Bytes that are not UTF-8 fail the read.
unsafe extern "C" fn read_text(env: napi_env, info: napi_callback_info) -> napi_value {
    let [path, done] = arguments::<2>(env, info);
    let Some(path) = string_argument(env, path) else {
        return throw(env, "readText: the path must be a string");
    };
    let done = Callback(reference(env, done));
    worker::submit(move || {
        let result = std::fs::read(readable(&path))
            .map_err(|reason| format!("Cannot read {path}: {reason}"))
            .and_then(|bytes| String::from_utf8(bytes).map_err(|_| format!("{path} is not UTF-8 text")));
        Box::new(move |env| {
            let done = done;
            let function = dereference(env, done.0);
            match result {
                // A byte order mark is not part of the text.
                Ok(text) => invoke(env, function, &[null(env), string(env, text.trim_start_matches('\u{feff}'))]),
                Err(message) => invoke(env, function, &[error(env, &message)]),
            }
            napi_delete_reference(env, done.0);
        })
    });
    undefined(env)
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    define_function(env, host, c"readFile", read_file);
    define_function(env, host, c"readText", read_text);
}
