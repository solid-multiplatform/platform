//! `__solid.store` and `__solid.fs`: an app's settings file and its own
//! directories.
//!
//! An app is named by an id (`com.example.player`). Under the system's place
//! for per-user application data (`SDL_GetPrefPath`) it gets
//! `<id>/settings.json` and `<id>/data/`; under the system's cache directory
//! `<id>/`; under the user's documents `<id>/`. `fs.dirs(id)` returns the
//! three directories and from then on the `fs` functions work inside them and
//! nowhere else: a path is refused unless, with every symbolic link in it
//! followed, it lies in one of them. `..` is refused outright.
//!
//! Every operation runs on a worker thread and calls back with
//! `done(error)` or `done(null, result)`. Files are written whole, to a
//! temporary file in the same directory that then takes the name, so a crash
//! leaves the old contents or the new, never part of each.

use crate::napi::*;
use crate::runtime::invoke;
use crate::worker::{self, Callback};
use sdl3_sys::everything::*;
use std::ffi::{CStr, CString};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// The directories `fs.dirs` has handed out, with links resolved.
static ROOTS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// An id is a directory name on every system: letters, digits, `.`, `_` and
/// `-`, not starting with a dot.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with('.')
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// `<the system's application data>/<id>/`, created.
unsafe fn pref_path(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("\"{id}\" is not an application id: use letters, digits, \".\", \"_\" and \"-\""));
    }
    let name = CString::new(id).unwrap();
    let path = SDL_GetPrefPath(ptr::null(), name.as_ptr());
    if path.is_null() {
        return Err(format!("No directory for application data: {}", CStr::from_ptr(SDL_GetError()).to_string_lossy()));
    }
    let result = PathBuf::from(CStr::from_ptr(path).to_string_lossy().into_owned());
    SDL_free(path.cast());
    Ok(result)
}

/// The system's directory for files that can be made again.
fn cache_home() -> Option<PathBuf> {
    let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty()).map(PathBuf::from);
    if cfg!(target_os = "windows") {
        var("LOCALAPPDATA").map(|path| path.join("Cache"))
    } else if cfg!(target_os = "macos") {
        var("HOME").map(|home| home.join("Library/Caches"))
    } else {
        var("XDG_CACHE_HOME").filter(|path| path.is_absolute()).or_else(|| var("HOME").map(|home| home.join(".cache")))
    }
}

/// `path` with every symbolic link in the part of it that exists followed.
/// The part that does not exist yet has no links to follow, and no `..`:
/// the caller has refused those.
fn resolve(path: &Path) -> std::io::Result<PathBuf> {
    let mut existing = path;
    let mut rest = Vec::new();
    loop {
        match existing.canonicalize() {
            Ok(resolved) => return Ok(rest.iter().rev().fold(resolved, |path, name| path.join(name))),
            Err(reason) => {
                let (Some(parent), Some(name)) = (existing.parent(), existing.file_name()) else {
                    return Err(reason);
                };
                rest.push(name.to_owned());
                existing = parent;
            }
        }
    }
}

/// The file `path` names, if it lies in a directory `fs.dirs` handed out.
fn confine(path: &str) -> Result<PathBuf, String> {
    let refused = || format!("{path} is outside the app's directories");
    let path = Path::new(path);
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err(refused());
    }
    let resolved = resolve(path).map_err(|_| refused())?;
    let roots = ROOTS.lock().unwrap();
    if roots.iter().any(|root| resolved.starts_with(root)) {
        Ok(resolved)
    } else {
        Err(refused())
    }
}

/// Like `confine`, for an operation that must not act on a directory handed
/// out itself (removing it, writing a file over it).
fn confine_inside(path: &str) -> Result<PathBuf, String> {
    let resolved = confine(path)?;
    if ROOTS.lock().unwrap().iter().any(|root| *root == resolved) {
        return Err(format!("{path} is one of the app's directories, not a file in one"));
    }
    Ok(resolved)
}

/// Writes `bytes` as the whole of `path`: to a temporary file beside it,
/// flushed to the disk, which is then renamed over it.
fn write_whole(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let directory = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    std::fs::create_dir_all(directory)?;
    let mut name = path.file_name().ok_or(std::io::ErrorKind::InvalidInput)?.to_owned();
    name.push(format!(".{}-{}.tmp", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
    let temporary = directory.join(name);
    let written = (|| {
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    written
}

/// What a job produced, to be turned into a JavaScript value on its thread.
enum Value {
    Nothing,
    Null,
    Text(String),
    Bytes(Vec<u8>),
    Entry(Entry),
    Entries(Vec<Entry>),
}

struct Entry {
    name: String,
    size: u64,
    /// Milliseconds since 1970, when the file system records it.
    modified: Option<f64>,
    directory: bool,
}

fn entry(name: String, metadata: &std::fs::Metadata) -> Entry {
    let modified = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok());
    Entry {
        name,
        size: metadata.len(),
        modified: modified.map(|since| since.as_secs_f64() * 1000.0),
        directory: metadata.is_dir(),
    }
}

unsafe fn entry_object(env: napi_env, entry: &Entry) -> napi_value {
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    napi_set_named_property(env, object, c"name".as_ptr(), string(env, &entry.name));
    napi_set_named_property(env, object, c"size".as_ptr(), number(env, entry.size as f64));
    if let Some(modified) = entry.modified {
        napi_set_named_property(env, object, c"modified".as_ptr(), number(env, modified));
    }
    napi_set_named_property(env, object, c"directory".as_ptr(), boolean(env, entry.directory));
    object
}

unsafe fn to_js(env: napi_env, value: Value) -> napi_value {
    match value {
        Value::Nothing => undefined(env),
        Value::Null => null(env),
        Value::Text(text) => string(env, text.trim_start_matches('\u{feff}')),
        Value::Bytes(bytes) => adopt_bytes(env, bytes),
        Value::Entry(entry) => entry_object(env, &entry),
        Value::Entries(entries) => {
            let mut array = ptr::null_mut();
            napi_create_array(env, &mut array);
            for (index, entry) in entries.iter().enumerate() {
                napi_set_element(env, array, index as u32, entry_object(env, entry));
            }
            array
        }
    }
}

/// Runs `job` on a worker and calls `done(error)` or `done(null, result)`.
unsafe fn run(env: napi_env, done: napi_value, job: impl FnOnce() -> Result<Value, String> + Send + 'static) -> napi_value {
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, done, &mut kind);
    if kind != NAPI_FUNCTION {
        return throw(env, "The last argument must be a callback");
    }
    let done = Callback(reference(env, done));
    worker::submit_waiting(move || {
        let result = job();
        Box::new(move |env| {
            let done = done;
            let function = dereference(env, done.0);
            match result {
                Ok(value) => invoke(env, function, &[null(env), to_js(env, value)]),
                Err(message) => invoke(env, function, &[error(env, &message)]),
            }
            napi_delete_reference(env, done.0);
        })
    });
    undefined(env)
}

fn failed(action: &str, path: &Path, reason: std::io::Error) -> String {
    format!("Cannot {action} {}: {reason}", path.display())
}

/// The bytes to write: a string as UTF-8, or the contents of a typed array
/// or an `ArrayBuffer`, copied so that the worker owns them.
unsafe fn payload(env: napi_env, data: napi_value) -> Option<Vec<u8>> {
    if let Some(text) = string_argument(env, data) {
        return Some(text.into_bytes());
    }
    let (pointer, length) = bytes_of(env, data)?;
    if length == 0 {
        return Some(Vec::new());
    }
    // `bytes_of` gives a null pointer only with a length of 0.
    Some(std::slice::from_raw_parts(pointer, length).to_vec())
}

/// `fs.dirs(id)`: `{ data, cache?, documents? }`, absolute, without a
/// trailing separator. `data` and `cache` exist afterwards; `documents` is
/// created by the first write into it.
unsafe extern "C" fn dirs(env: napi_env, info: napi_callback_info) -> napi_value {
    let [id] = arguments::<1>(env, info);
    let Some(id) = string_argument(env, id) else {
        return throw(env, "fs.dirs: the application id must be a string");
    };
    let data = match pref_path(&id) {
        Ok(path) => path.join("data"),
        Err(message) => return throw(env, &message),
    };
    let cache = cache_home().map(|home| home.join(&id));
    let documents = {
        let folder = SDL_GetUserFolder(SDL_FOLDER_DOCUMENTS);
        (!folder.is_null()).then(|| PathBuf::from(CStr::from_ptr(folder).to_string_lossy().into_owned()).join(&id))
    };
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    let mut roots = ROOTS.lock().unwrap();
    for (name, directory, create) in
        [(c"data", Some(data), true), (c"cache", cache, true), (c"documents", documents, false)]
    {
        let Some(directory) = directory else { continue };
        if create && std::fs::create_dir_all(&directory).is_err() {
            continue;
        }
        let Ok(resolved) = resolve(&directory) else { continue };
        napi_set_named_property(env, object, name.as_ptr(), string(env, &resolved.to_string_lossy()));
        if !roots.contains(&resolved) {
            roots.push(resolved);
        }
    }
    object
}

/// `fs.read(path, asText, done)`: an `ArrayBuffer`, or a string decoded
/// from UTF-8.
unsafe extern "C" fn read(env: napi_env, info: napi_callback_info) -> napi_value {
    let [path, as_text, done] = arguments::<3>(env, info);
    let Some(path) = string_argument(env, path) else {
        return throw(env, "fs.read: the path must be a string");
    };
    let mut text = false;
    napi_get_value_bool(env, as_text, &mut text);
    run(env, done, move || {
        let file = confine(&path)?;
        let bytes = std::fs::read(&file).map_err(|reason| failed("read", &file, reason))?;
        if !text {
            return Ok(Value::Bytes(bytes));
        }
        String::from_utf8(bytes).map(Value::Text).map_err(|_| format!("{} is not UTF-8 text", file.display()))
    })
}

/// `fs.write(path, data, done)`: `data` (a string, a typed array or an
/// `ArrayBuffer`) becomes the whole file. Missing directories are made.
unsafe extern "C" fn write(env: napi_env, info: napi_callback_info) -> napi_value {
    let [path, data, done] = arguments::<3>(env, info);
    let Some(path) = string_argument(env, path) else {
        return throw(env, "fs.write: the path must be a string");
    };
    let Some(bytes) = payload(env, data) else {
        return throw(env, "fs.write: the data must be a string, a typed array or an ArrayBuffer");
    };
    run(env, done, move || {
        let file = confine_inside(&path)?;
        write_whole(&file, &bytes).map_err(|reason| failed("write", &file, reason))?;
        Ok(Value::Nothing)
    })
}

/// `fs.stat(path, done)`: `{ name, size, modified?, directory }`, or `null`
/// when nothing is there.
unsafe extern "C" fn stat(env: napi_env, info: napi_callback_info) -> napi_value {
    let [path, done] = arguments::<2>(env, info);
    let Some(path) = string_argument(env, path) else {
        return throw(env, "fs.stat: the path must be a string");
    };
    run(env, done, move || {
        let file = confine(&path)?;
        match std::fs::metadata(&file) {
            Ok(metadata) => {
                let name = file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                Ok(Value::Entry(entry(name, &metadata)))
            }
            Err(reason) if reason.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
            Err(reason) => Err(failed("read", &file, reason)),
        }
    })
}

/// `fs.list(path, done)`: the directory's entries, by name. A directory that
/// does not exist has none.
unsafe extern "C" fn list(env: napi_env, info: napi_callback_info) -> napi_value {
    let [path, done] = arguments::<2>(env, info);
    let Some(path) = string_argument(env, path) else {
        return throw(env, "fs.list: the path must be a string");
    };
    run(env, done, move || {
        let directory = confine(&path)?;
        let reader = match std::fs::read_dir(&directory) {
            Ok(reader) => reader,
            Err(reason) if reason.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Entries(Vec::new())),
            Err(reason) => return Err(failed("list", &directory, reason)),
        };
        let mut entries = Vec::new();
        for item in reader {
            let item = item.map_err(|reason| failed("list", &directory, reason))?;
            // A link is listed as what it points at; one that points at
            // nothing is left out.
            if let Ok(metadata) = std::fs::metadata(item.path()) {
                entries.push(entry(item.file_name().to_string_lossy().into_owned(), &metadata));
            }
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(Value::Entries(entries))
    })
}

/// `fs.remove(path, done)`: removes the file, or the directory with all in
/// it. Removing what is not there succeeds.
unsafe extern "C" fn remove(env: napi_env, info: napi_callback_info) -> napi_value {
    let [path, done] = arguments::<2>(env, info);
    let Some(path) = string_argument(env, path) else {
        return throw(env, "fs.remove: the path must be a string");
    };
    run(env, done, move || {
        let file = confine_inside(&path)?;
        let removed = match std::fs::symlink_metadata(&file) {
            Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(&file),
            Ok(_) => std::fs::remove_file(&file),
            Err(reason) => Err(reason),
        };
        match removed {
            Err(reason) if reason.kind() != std::io::ErrorKind::NotFound => Err(failed("remove", &file, reason)),
            _ => Ok(Value::Nothing),
        }
    })
}

/// `store.load(id, done)`: the text of the app's settings file, or `null`
/// before anything was saved.
unsafe extern "C" fn load(env: napi_env, info: napi_callback_info) -> napi_value {
    let [id, done] = arguments::<2>(env, info);
    let file = match string_argument(env, id).ok_or_else(|| "store.load: the id must be a string".to_owned()) {
        Ok(id) => pref_path(&id).map(|path| path.join("settings.json")),
        Err(message) => Err(message),
    };
    let file = match file {
        Ok(file) => file,
        Err(message) => return throw(env, &message),
    };
    run(env, done, move || match std::fs::read(&file) {
        Ok(bytes) => {
            String::from_utf8(bytes).map(Value::Text).map_err(|_| format!("{} is not UTF-8 text", file.display()))
        }
        Err(reason) if reason.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(reason) => Err(failed("read", &file, reason)),
    })
}

/// `store.save(id, text, done)`: `text` becomes the app's settings file.
unsafe extern "C" fn save(env: napi_env, info: napi_callback_info) -> napi_value {
    let [id, text, done] = arguments::<3>(env, info);
    let (Some(id), Some(text)) = (string_argument(env, id), string_argument(env, text)) else {
        return throw(env, "store.save: the id and the text must be strings");
    };
    let file = match pref_path(&id) {
        Ok(path) => path.join("settings.json"),
        Err(message) => return throw(env, &message),
    };
    run(env, done, move || {
        write_whole(&file, text.as_bytes()).map_err(|reason| failed("write", &file, reason))?;
        Ok(Value::Nothing)
    })
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    let fs = define_object(env, host, c"fs");
    define_function(env, fs, c"dirs", dirs);
    define_function(env, fs, c"read", read);
    define_function(env, fs, c"write", write);
    define_function(env, fs, c"stat", stat);
    define_function(env, fs, c"list", list);
    define_function(env, fs, c"remove", remove);
    let store = define_object(env, host, c"store");
    define_function(env, store, c"load", load);
    define_function(env, store, c"save", save);
}
