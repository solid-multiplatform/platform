//! `__solid.secrets`: an app's secrets in the desktop's keyring, the
//! freedesktop Secret Service (`org.freedesktop.secrets` on the session bus).
//!
//! `available()` asks the bus whether anything provides the service, and is
//! the only thing here that happens before an app uses it: the host asks
//! once, as it starts, so that a desktop without the service has no
//! `secureStorage` service at all. Everything else - opening a session,
//! finding the `default` collection, searching, reading and writing - runs on
//! a worker thread and calls back. A value is handed to the service and
//! returned from it; it is never written to a file here and never logged.
//!
//! Items are found by three attributes: `service=solid-platform`,
//! `app=<namespace>` and `account=<key>`, so one app's keys cannot collide
//! with another's. A collection that is locked, or a service that wants the
//! user to confirm something at a prompt, is reported as an error: this host
//! shows no keyring prompt.

use crate::napi::*;
use crate::runtime::invoke;
use crate::worker::{self, Callback};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use zbus::blocking::Connection;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

const SERVICE: &str = "org.freedesktop.secrets";
const SERVICE_PATH: &str = "/org/freedesktop/secrets";
const SERVICE_IFACE: &str = "org.freedesktop.Secret.Service";
const COLLECTION_IFACE: &str = "org.freedesktop.Secret.Collection";
const ITEM_IFACE: &str = "org.freedesktop.Secret.Item";
const BUS: &str = "org.freedesktop.DBus";

/// The attributes every item this host writes carries.
const ATTRIBUTE_SERVICE: &str = "solid-platform";

/// The session the service gave us, opened on the first use of the service.
static SESSION: Mutex<Option<OwnedObjectPath>> = Mutex::new(None);

/// The session bus, connected to when first needed; `None` when there is
/// none. The connection's own thread sleeps on the socket.
fn bus() -> Option<&'static Connection> {
    static BUS: OnceLock<Option<Connection>> = OnceLock::new();
    BUS.get_or_init(|| Connection::session().ok()).as_ref()
}

/// Whether the service is running or the bus can start it.
fn provided(connection: &Connection) -> bool {
    let running = connection
        .call_method(Some(BUS), "/org/freedesktop/DBus", Some(BUS), "NameHasOwner", &(SERVICE,))
        .and_then(|reply| reply.body().deserialize::<bool>())
        .unwrap_or(false);
    running
        || connection
            .call_method(Some(BUS), "/org/freedesktop/DBus", Some(BUS), "ListActivatableNames", &())
            .and_then(|reply| reply.body().deserialize::<Vec<String>>())
            .is_ok_and(|names| names.iter().any(|name| name == SERVICE))
}

/// The attributes that name one app's key.
fn attributes<'a>(namespace: &'a str, key: &'a str) -> HashMap<&'a str, &'a str> {
    HashMap::from([
        ("service", ATTRIBUTE_SERVICE),
        ("app", namespace),
        ("account", key),
    ])
}

/// Opens the plain session once, and reuses it: a session carries no secrets
/// itself, only the agreement under which they are passed.
fn session(connection: &Connection) -> Result<OwnedObjectPath, String> {
    let mut opened = SESSION.lock().unwrap();
    if let Some(path) = opened.as_ref() {
        return Ok(path.clone());
    }
    let reply = connection
        .call_method(Some(SERVICE), SERVICE_PATH, Some(SERVICE_IFACE), "OpenSession", &("plain", Value::from("")))
        .map_err(|reason| format!("OpenSession: {reason}"))?;
    let (_output, path): (OwnedValue, OwnedObjectPath) =
        reply.body().deserialize().map_err(|reason| format!("OpenSession: {reason}"))?;
    *opened = Some(path.clone());
    Ok(path)
}

/// The `default` collection, created when the service has none. A service
/// that wants a prompt for that is refused: nothing here shows a prompt.
fn collection(connection: &Connection) -> Result<OwnedObjectPath, String> {
    let reply = connection
        .call_method(Some(SERVICE), SERVICE_PATH, Some(SERVICE_IFACE), "ReadAlias", &("default",))
        .map_err(|reason| format!("ReadAlias: {reason}"))?;
    let path: OwnedObjectPath = reply.body().deserialize().map_err(|reason| format!("ReadAlias: {reason}"))?;
    if path.as_str() != "/" {
        return Ok(path);
    }
    let properties: HashMap<&str, Value<'_>> =
        HashMap::from([("org.freedesktop.Secret.Collection.Label", Value::from("Default"))]);
    let reply = connection
        .call_method(Some(SERVICE), SERVICE_PATH, Some(SERVICE_IFACE), "CreateCollection", &(properties, "default"))
        .map_err(|reason| format!("CreateCollection: {reason}"))?;
    let (collection, prompt): (OwnedObjectPath, OwnedObjectPath) =
        reply.body().deserialize().map_err(|reason| format!("CreateCollection: {reason}"))?;
    if prompt.as_str() != "/" {
        return Err("the keyring asks for a prompt to create its collection".into());
    }
    Ok(collection)
}

/// The item with this app's attributes for `key`, when there is one. An item
/// the collection reports as locked is an error, not a miss.
fn item(
    connection: &Connection,
    collection: &OwnedObjectPath,
    namespace: &str,
    key: &str,
) -> Result<Option<OwnedObjectPath>, String> {
    let reply = connection
        .call_method(
            Some(SERVICE),
            collection.as_str(),
            Some(COLLECTION_IFACE),
            "SearchItems",
            &attributes(namespace, key),
        )
        .map_err(|reason| format!("SearchItems: {reason}"))?;
    let (unlocked, locked): (Vec<OwnedObjectPath>, Vec<OwnedObjectPath>) =
        reply.body().deserialize().map_err(|reason| format!("SearchItems: {reason}"))?;
    if let Some(path) = unlocked.into_iter().next() {
        return Ok(Some(path));
    }
    if !locked.is_empty() {
        return Err(format!("the item for {key} is locked"));
    }
    Ok(None)
}

/// A value as the service carries it: the session it belongs to, no
/// parameters (the plain session needs none), the bytes and their type.
fn secret<'a>(
    session: &'a OwnedObjectPath,
    value: &'a str,
) -> (&'a OwnedObjectPath, Vec<u8>, Vec<u8>, &'static str) {
    (session, Vec::new(), value.as_bytes().to_vec(), "text/plain")
}

fn read(namespace: &str, key: &str) -> Result<Option<String>, String> {
    let connection = bus().ok_or("there is no session bus")?;
    let session = session(connection)?;
    let collection = collection(connection)?;
    let Some(item) = item(connection, &collection, namespace, key)? else {
        return Ok(None);
    };
    let reply = connection
        .call_method(Some(SERVICE), item.as_str(), Some(ITEM_IFACE), "GetSecret", &(&session,))
        .map_err(|reason| format!("GetSecret: {reason}"))?;
    let (_session, _parameters, value, content_type): (OwnedObjectPath, Vec<u8>, Vec<u8>, String) =
        reply.body().deserialize().map_err(|reason| format!("GetSecret: {reason}"))?;
    if !content_type.is_empty() && content_type != "text/plain" {
        return Err(format!("the secret for {key} is {content_type}, not text"));
    }
    String::from_utf8(value)
        .map(Some)
        .map_err(|_| format!("the secret for {key} is not UTF-8 text"))
}

fn write(namespace: &str, key: &str, value: &str) -> Result<(), String> {
    let connection = bus().ok_or("there is no session bus")?;
    let session = session(connection)?;
    let collection = collection(connection)?;
    let secret = secret(&session, value);
    if let Some(item) = item(connection, &collection, namespace, key)? {
        connection
            // The one argument is the struct itself: a tuple of one tuple,
            // because zbus takes a top-level tuple's signature as the body.
            .call_method(Some(SERVICE), item.as_str(), Some(ITEM_IFACE), "SetSecret", &(secret,))
            .map_err(|reason| format!("SetSecret: {reason}"))?;
        return Ok(());
    }
    let properties: HashMap<&str, Value<'_>> = HashMap::from([
        ("org.freedesktop.Secret.Item.Label", Value::from(key)),
        ("org.freedesktop.Secret.Item.Attributes", Value::from(attributes(namespace, key))),
    ]);
    let reply = connection
        .call_method(
            Some(SERVICE),
            collection.as_str(),
            Some(COLLECTION_IFACE),
            "CreateItem",
            &(properties, secret, true),
        )
        .map_err(|reason| format!("CreateItem: {reason}"))?;
    let (_item, prompt): (OwnedObjectPath, OwnedObjectPath) =
        reply.body().deserialize().map_err(|reason| format!("CreateItem: {reason}"))?;
    if prompt.as_str() != "/" {
        return Err("the keyring asks for a prompt to store a secret".into());
    }
    Ok(())
}

fn remove(namespace: &str, key: &str) -> Result<(), String> {
    let connection = bus().ok_or("there is no session bus")?;
    let collection = collection(connection)?;
    let Some(item) = item(connection, &collection, namespace, key)? else {
        return Ok(());
    };
    let reply = connection
        .call_method(Some(SERVICE), item.as_str(), Some(ITEM_IFACE), "Delete", &())
        .map_err(|reason| format!("Delete: {reason}"))?;
    let prompt: OwnedObjectPath = reply.body().deserialize().map_err(|reason| format!("Delete: {reason}"))?;
    if prompt.as_str() != "/" {
        return Err("the keyring asks for a prompt to delete a secret".into());
    }
    Ok(())
}

/// Runs `job` on a worker and calls `done(error)` or `done(null, value)`,
/// where `value` is a string, `null`, or nothing.
unsafe fn run(env: napi_env, done: napi_value, job: impl FnOnce() -> Result<Option<String>, String> + Send + 'static) -> napi_value {
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, done, &mut kind);
    if kind != NAPI_FUNCTION {
        return throw(env, "secrets: the last argument must be a callback");
    }
    let done = Callback(reference(env, done));
    worker::submit_waiting(move || {
        let result = job();
        Box::new(move |env| {
            let done = done;
            let function = dereference(env, done.0);
            match result {
                Ok(Some(value)) => invoke(env, function, &[null(env), string(env, &value)]),
                Ok(None) => invoke(env, function, &[null(env), null(env)]),
                Err(message) => invoke(env, function, &[error(env, &format!("Secret not available: {message}"))]),
            }
            napi_delete_reference(env, done.0);
        })
    });
    undefined(env)
}

/// `secrets.available()`: whether the session bus has the service.
unsafe extern "C" fn available(env: napi_env, _info: napi_callback_info) -> napi_value {
    boolean(env, bus().is_some_and(provided))
}

/// `secrets.get(app, key, done)`: the value, or `null` when nothing is
/// stored under that app and key.
unsafe extern "C" fn get(env: napi_env, info: napi_callback_info) -> napi_value {
    let [app, key, done] = arguments::<3>(env, info);
    let (Some(app), Some(key)) = (string_argument(env, app), string_argument(env, key)) else {
        return throw(env, "secrets.get: the app and key must be strings");
    };
    run(env, done, move || read(&app, &key))
}

/// `secrets.set(app, key, value, done)`: stores the value.
unsafe extern "C" fn set(env: napi_env, info: napi_callback_info) -> napi_value {
    let [app, key, value, done] = arguments::<4>(env, info);
    let (Some(app), Some(key), Some(value)) =
        (string_argument(env, app), string_argument(env, key), string_argument(env, value))
    else {
        return throw(env, "secrets.set: the app, key and value must be strings");
    };
    run(env, done, move || write(&app, &key, &value).map(|()| None))
}

/// `secrets.remove(app, key, done)`: removes the value; removing what is not
/// there succeeds.
unsafe extern "C" fn remove_item(env: napi_env, info: napi_callback_info) -> napi_value {
    let [app, key, done] = arguments::<3>(env, info);
    let (Some(app), Some(key)) = (string_argument(env, app), string_argument(env, key)) else {
        return throw(env, "secrets.remove: the app and key must be strings");
    };
    run(env, done, move || remove(&app, &key).map(|()| None))
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    let secrets = define_object(env, host, c"secrets");
    define_function(env, secrets, c"available", available);
    define_function(env, secrets, c"get", get);
    define_function(env, secrets, c"set", set);
    define_function(env, secrets, c"remove", remove_item);
}
