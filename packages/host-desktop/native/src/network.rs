//! `__solid.network`: whether the machine is connected, as NetworkManager
//! says on the system bus, and its word when that changes.
//!
//! Nothing here polls: `watch` starts one thread that sleeps on the bus
//! until NetworkManager sends its `StateChanged` signal, and hands each
//! state to the JavaScript thread. `available()` is the one question asked
//! before an app uses the service (is NetworkManager on the bus at all), so
//! that a system without it has no `connectivity` service.

use crate::napi::*;
use crate::runtime::invoke;
use crate::worker;
use std::cell::Cell;
use std::sync::OnceLock;
use zbus::blocking::{Connection, Proxy};

const SERVICE: &str = "org.freedesktop.NetworkManager";
const PATH: &str = "/org/freedesktop/NetworkManager";
const BUS: &str = "org.freedesktop.DBus";

thread_local! {
    static LISTENER: Cell<Option<napi_ref>> = const { Cell::new(None) };
}

/// The system bus, connected to when first needed; `None` when there is
/// none. The connection's own thread sleeps on the socket.
fn system() -> Option<&'static Connection> {
    static SYSTEM: OnceLock<Option<Connection>> = OnceLock::new();
    SYSTEM.get_or_init(|| Connection::system().ok()).as_ref()
}

fn manager() -> Result<Proxy<'static>, String> {
    let bus = system().ok_or("there is no system bus")?;
    Proxy::new(bus, SERVICE, PATH, SERVICE).map_err(|reason| reason.to_string())
}

/// `network.available()`: whether NetworkManager is running.
unsafe extern "C" fn available(env: napi_env, _info: napi_callback_info) -> napi_value {
    let running = system().is_some_and(|bus| {
        bus.call_method(Some(BUS), "/org/freedesktop/DBus", Some(BUS), "NameHasOwner", &(SERVICE,))
            .and_then(|reply| reply.body().deserialize::<bool>())
            .unwrap_or(false)
    });
    boolean(env, running)
}

/// `network.state()`: NetworkManager's state now, a number (`NMState`: 70
/// is connected with the internet reachable, 20 disconnected).
unsafe extern "C" fn state(env: napi_env, _info: napi_callback_info) -> napi_value {
    match manager().and_then(|proxy| proxy.get_property::<u32>("State").map_err(|reason| reason.to_string())) {
        Ok(state) => number(env, state as f64),
        Err(reason) => throw(env, &format!("network.state: {reason}")),
    }
}

/// `network.watch(callback)`: `callback(state)` on every change of state,
/// for as long as the process lives. One listener; a later call replaces
/// it, and the thread that waits for the signal is started once.
unsafe extern "C" fn watch(env: napi_env, info: napi_callback_info) -> napi_value {
    let [callback] = arguments::<1>(env, info);
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, callback, &mut kind);
    if kind != NAPI_FUNCTION {
        return throw(env, "network.watch: the callback must be a function");
    }
    if let Some(old) = LISTENER.replace(Some(reference(env, callback))) {
        napi_delete_reference(env, old);
        return undefined(env);
    }
    // Subscribed here, before this returns, so that no change is missed
    // between the caller reading the state and the thread starting.
    let signals = match manager().and_then(|proxy| proxy.receive_signal("StateChanged").map_err(|r| r.to_string())) {
        Ok(signals) => signals,
        Err(reason) => return throw(env, &format!("network.watch: {reason}")),
    };
    let started = std::thread::Builder::new().name("solid-network".into()).spawn(move || {
        // Blocks in the bus's socket until NetworkManager says something.
        for message in signals {
            let Ok(state) = message.body().deserialize::<u32>() else { continue };
            worker::complete(Box::new(move |env| unsafe {
                let Some(listener) = LISTENER.get() else { return };
                invoke(env, dereference(env, listener), &[number(env, state as f64)]);
            }));
        }
    });
    if started.is_err() {
        return throw(env, "network.watch: cannot start a thread");
    }
    undefined(env)
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    let network = define_object(env, host, c"network");
    define_function(env, network, c"available", available);
    define_function(env, network, c"state", state);
    define_function(env, network, c"watch", watch);
}
