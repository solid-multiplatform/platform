//! `__solid.notifications`: the desktop's notification service
//! (`org.freedesktop.Notifications` on the session bus).
//!
//! `available()` asks the bus whether anything provides it, and is the only
//! thing here that happens before an app shows a notification: the host
//! asks once, as it starts, so that a desktop without the service has no
//! `notifications` service at all. `show` makes the call on a worker thread.
//! Nothing listens for what the user does with a notification, so nothing
//! waits on the bus.

use crate::napi::*;
use crate::runtime::invoke;
use crate::worker::{self, Callback};
use std::collections::HashMap;
use std::sync::OnceLock;
use zbus::blocking::Connection;
use zbus::zvariant::Value;

const SERVICE: &str = "org.freedesktop.Notifications";
const BUS: &str = "org.freedesktop.DBus";

/// The session bus, connected to when first needed; `None` when there is
/// none. The connection's own thread sleeps on the socket.
fn session() -> Option<&'static Connection> {
    static SESSION: OnceLock<Option<Connection>> = OnceLock::new();
    SESSION.get_or_init(|| Connection::session().ok()).as_ref()
}

/// Whether the service is running or the bus can start it.
fn provided(bus: &Connection) -> bool {
    let ask = |method: &str| bus.call_method(Some(BUS), "/org/freedesktop/DBus", Some(BUS), method, &());
    let running = bus
        .call_method(Some(BUS), "/org/freedesktop/DBus", Some(BUS), "NameHasOwner", &(SERVICE,))
        .and_then(|reply| reply.body().deserialize::<bool>())
        .unwrap_or(false);
    running
        || ask("ListActivatableNames")
            .and_then(|reply| reply.body().deserialize::<Vec<String>>())
            .is_ok_and(|names| names.iter().any(|name| name == SERVICE))
}

/// `Notify`: the notification's id, which a later call can replace.
fn notify(app: &str, title: &str, body: &str, replaces: u32) -> Result<u32, String> {
    let bus = session().ok_or("there is no session bus")?;
    let (actions, hints): (Vec<&str>, HashMap<&str, Value>) = (Vec::new(), HashMap::new());
    // No icon; the service's own time on screen (-1).
    let arguments = (app, replaces, "", title, body, actions, hints, -1i32);
    bus.call_method(Some(SERVICE), "/org/freedesktop/Notifications", Some(SERVICE), "Notify", &arguments)
        .and_then(|reply| reply.body().deserialize::<u32>())
        .map_err(|reason| reason.to_string())
}

/// `notifications.available()`: whether the session bus has the service.
unsafe extern "C" fn available(env: napi_env, _info: napi_callback_info) -> napi_value {
    boolean(env, session().is_some_and(provided))
}

/// `notifications.show(app, title, body, replaces, done)`: shows a
/// notification in the app's name, in place of the one with the id
/// `replaces` unless that is 0; `done(null, id)` or `done(Error)`.
unsafe extern "C" fn show(env: napi_env, info: napi_callback_info) -> napi_value {
    let [app, title, body, replaces, done] = arguments::<5>(env, info);
    let (Some(app), Some(title)) = (string_argument(env, app), string_argument(env, title)) else {
        return throw(env, "notifications.show: the app's name and the title must be strings");
    };
    let body = string_argument(env, body).unwrap_or_default();
    let replaces = number_or(env, replaces, 0.0) as u32;
    let done = Callback(reference(env, done));
    worker::submit_waiting(move || {
        let result = notify(&app, &title, &body, replaces);
        Box::new(move |env| {
            let done = done;
            let function = dereference(env, done.0);
            match result {
                Ok(id) => invoke(env, function, &[null(env), number(env, id as f64)]),
                Err(message) => invoke(env, function, &[error(env, &format!("Notification not shown: {message}"))]),
            }
            napi_delete_reference(env, done.0);
        })
    });
    undefined(env)
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    let notifications = define_object(env, host, c"notifications");
    define_function(env, notifications, c"available", available);
    define_function(env, notifications, c"show", show);
}
