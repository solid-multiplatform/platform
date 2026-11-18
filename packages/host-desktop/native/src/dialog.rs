//! `__solid.dialog`: the system's file dialogs.
//!
//! `dialog.open(filters, multiple, done)` lets the user choose files to read;
//! `done(null, files)` gets `{ path, size }` for each, none if the user
//! cancelled. `dialog.save(name, filters, data, done)` lets the user choose
//! where to save and writes `data` there; `done(null, path)`, or
//! `done(null, null)` if the user cancelled. `filters` is a flat array of
//! names and patterns (`"Images"`, `"png;jpg"`); `"*"` is every file.
//!
//! SDL shows the dialog without blocking and reports through a callback
//! that may run on a thread of its own, so the callback only hands the
//! result to the event loop.

use crate::napi::*;
use crate::runtime::invoke;
use crate::window;
use crate::worker::{self, Callback};
use sdl3_sys::everything::*;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::ptr;

/// What a dialog needs kept alive until its callback: SDL reads the filters
/// until then.
struct Pending {
    done: Callback,
    /// The strings `filters` points into.
    _texts: Vec<CString>,
    filters: Vec<SDL_DialogFileFilter>,
    /// The bytes a save dialog writes where the user says.
    data: Option<Vec<u8>>,
}

// The raw pointers in `filters` point into `_texts`, which moves with them.
unsafe impl Send for Pending {}

/// The user's choice: `None` when the dialog failed, with SDL's reason.
type Chosen = Result<Vec<String>, String>;

unsafe extern "C" fn chosen(userdata: *mut c_void, files: *const *const c_char, _filter: c_int) {
    // Runs on any thread: nothing here touches JavaScript.
    let pending = Box::from_raw(userdata.cast::<Pending>());
    let choice: Chosen = if files.is_null() {
        Err(CStr::from_ptr(SDL_GetError()).to_string_lossy().into_owned())
    } else {
        let mut paths = Vec::new();
        let mut at = files;
        while !(*at).is_null() {
            // A dialog program that printed nothing gives one empty name.
            let path = CStr::from_ptr(*at).to_string_lossy();
            if !path.is_empty() {
                paths.push(path.into_owned());
            }
            at = at.add(1);
        }
        Ok(paths)
    };
    // Reading sizes and writing the file wait on the disk: not on the
    // system's thread and not on JavaScript's.
    worker::submit_waiting(move || {
        let Pending { done, data, .. } = *pending;
        let outcome = choice.and_then(|paths| match data {
            None => Ok(Outcome::Opened(
                paths
                    .into_iter()
                    .map(|path| {
                        let size = std::fs::metadata(&path).map_or(0, |metadata| metadata.len());
                        (path, size)
                    })
                    .collect(),
            )),
            Some(bytes) => match paths.into_iter().next() {
                None => Ok(Outcome::Saved(None)),
                Some(path) => std::fs::write(&path, bytes)
                    .map(|()| Outcome::Saved(Some(path.clone())))
                    .map_err(|reason| format!("Cannot write {path}: {reason}")),
            },
        });
        Box::new(move |env| {
            let done = done;
            let function = dereference(env, done.0);
            match outcome {
                Ok(Outcome::Opened(files)) => {
                    let mut array = ptr::null_mut();
                    napi_create_array(env, &mut array);
                    for (index, (path, size)) in files.iter().enumerate() {
                        let mut object = ptr::null_mut();
                        napi_create_object(env, &mut object);
                        napi_set_named_property(env, object, c"path".as_ptr(), string(env, path));
                        napi_set_named_property(env, object, c"size".as_ptr(), number(env, *size as f64));
                        napi_set_element(env, array, index as u32, object);
                    }
                    invoke(env, function, &[null(env), array]);
                }
                Ok(Outcome::Saved(path)) => {
                    let path = path.map_or(null(env), |path| string(env, &path));
                    invoke(env, function, &[null(env), path]);
                }
                Err(message) => invoke(env, function, &[error(env, &format!("The file dialog failed: {message}"))]),
            }
            napi_delete_reference(env, done.0);
        })
    });
}

enum Outcome {
    Opened(Vec<(String, u64)>),
    Saved(Option<String>),
}

/// A flat JavaScript array of names and patterns as SDL's filters.
unsafe fn filters(env: napi_env, array: napi_value) -> Option<(Vec<CString>, Vec<SDL_DialogFileFilter>)> {
    let mut is_array = false;
    napi_is_array(env, array, &mut is_array);
    if !is_array {
        return None;
    }
    let mut length = 0u32;
    napi_get_array_length(env, array, &mut length);
    if length % 2 != 0 || length > 64 {
        return None;
    }
    let mut texts = Vec::with_capacity(length as usize);
    for index in 0..length {
        let mut item = ptr::null_mut();
        napi_get_element(env, array, index, &mut item);
        texts.push(CString::new(string_argument(env, item)?).ok()?);
    }
    // A CString's buffer is on the heap: moving the Vec does not move it.
    let list = texts.chunks_exact(2).map(|pair| SDL_DialogFileFilter { name: pair[0].as_ptr(), pattern: pair[1].as_ptr() }).collect();
    Some((texts, list))
}

/// The list as SDL takes it: no pointer at all for no filters.
fn filter_list(filters: &[SDL_DialogFileFilter]) -> (*const SDL_DialogFileFilter, c_int) {
    if filters.is_empty() {
        (ptr::null(), 0)
    } else {
        (filters.as_ptr(), filters.len() as c_int)
    }
}

unsafe fn callback(env: napi_env, done: napi_value) -> Option<Callback> {
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, done, &mut kind);
    (kind == NAPI_FUNCTION).then(|| Callback(reference(env, done)))
}

/// `dialog.open(filters, multiple, done)`.
unsafe extern "C" fn open(env: napi_env, info: napi_callback_info) -> napi_value {
    let [list, multiple, done] = arguments::<3>(env, info);
    let Some((texts, list)) = filters(env, list) else {
        return throw(env, "dialog.open: the filters must be an array of names and patterns");
    };
    let mut many = false;
    napi_get_value_bool(env, multiple, &mut many);
    let Some(done) = callback(env, done) else {
        return throw(env, "dialog.open: the last argument must be a callback");
    };
    let pending = Box::into_raw(Box::new(Pending { done, _texts: texts, filters: list, data: None }));
    let (filters, count) = filter_list(&(*pending).filters);
    SDL_ShowOpenFileDialog(Some(chosen), pending.cast(), window::handle(), filters, count, ptr::null(), many);
    undefined(env)
}

/// `dialog.save(name, filters, data, done)`.
unsafe extern "C" fn save(env: napi_env, info: napi_callback_info) -> napi_value {
    let [name, list, data, done] = arguments::<4>(env, info);
    // The suggested name is a file name, not a path into somewhere.
    let name = string_argument(env, name)
        .filter(|name| !name.is_empty() && !name.contains(['/', '\\', '\0']) && name != "." && name != "..")
        .and_then(|name| CString::new(name).ok());
    let Some(name) = name else {
        return throw(env, "dialog.save: the name must be a file name without a directory");
    };
    let Some((texts, list)) = filters(env, list) else {
        return throw(env, "dialog.save: the filters must be an array of names and patterns");
    };
    let bytes = match string_argument(env, data) {
        Some(text) => Some(text.into_bytes()),
        // A null pointer comes only with a length of 0.
        None => bytes_of(env, data).map(|(pointer, length)| {
            if length == 0 { Vec::new() } else { std::slice::from_raw_parts(pointer, length).to_vec() }
        }),
    };
    let Some(bytes) = bytes else {
        return throw(env, "dialog.save: the data must be a string, a typed array or an ArrayBuffer");
    };
    let Some(done) = callback(env, done) else {
        return throw(env, "dialog.save: the last argument must be a callback");
    };
    let pending = Box::into_raw(Box::new(Pending { done, _texts: texts, filters: list, data: Some(bytes) }));
    let (filters, count) = filter_list(&(*pending).filters);
    SDL_ShowSaveFileDialog(Some(chosen), pending.cast(), window::handle(), filters, count, name.as_ptr());
    undefined(env)
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    let object = define_object(env, host, c"dialog");
    define_function(env, object, c"open", open);
    define_function(env, object, c"save", save);
}
