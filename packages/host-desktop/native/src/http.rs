//! `__solid.http`: HTTP and HTTPS requests, each on a worker thread that
//! blocks in the socket. No thread exists before the first request and none
//! runs between requests.
//!
//! `http.send(method, url, headers, body, follow, done)` starts a request
//! and returns its id. `headers` is a flat array of names and values, `body`
//! bytes or `undefined`, `follow` whether redirects are followed (up to 20,
//! as `fetch` does) or the redirect itself is the response. Later:
//! `done(error)` or `done(null, status, statusText, url, redirected,
//! headers, body)`, with the whole body in an `ArrayBuffer`, decompressed.
//!
//! `http.abort(id)`: `done` is never called. The thread stops reading the
//! body at the next chunk; a request still waiting for its response is
//! abandoned and ends when the server answers or a timeout passes, since a
//! blocking socket cannot be interrupted from outside.
//!
//! TLS is rustls with Mozilla's root certificates compiled in: no system
//! library, the same on every system, but a certificate authority that only
//! the machine's own store trusts is not trusted here.

use crate::napi::*;
use crate::runtime::invoke;
use crate::worker::{self, Callback};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Read;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use ureq::http;
use ureq::ResponseExt;

/// As `fetch` limits them.
const MAX_REDIRECTS: u32 = 20;
/// A response is held in memory whole: one larger than this is an error
/// rather than an exhausted machine.
const MAX_BODY: usize = 1 << 30;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a server may take to start answering.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(120);

thread_local! {
    /// Requests in flight, by id: the flag that abandons one.
    static PENDING: RefCell<(u32, HashMap<u32, Arc<AtomicBool>>)> = RefCell::new((0, HashMap::new()));
}

/// One agent for all requests: it keeps connections open for reuse, in a
/// pool that is only looked at when a request is made.
fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            // 4xx and 5xx are responses, as in `fetch`.
            .http_status_as_error(false)
            .max_redirects(MAX_REDIRECTS)
            .save_redirect_history(true)
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_recv_response(Some(RESPONSE_TIMEOUT))
            .user_agent(concat!("solid-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .into()
    })
}

struct Request {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
    follow: bool,
}

struct Response {
    status: u16,
    reason: &'static str,
    url: String,
    redirected: bool,
    headers: Vec<(String, Vec<u8>)>,
    body: Vec<u8>,
}

fn perform(request: Request, abandoned: &AtomicBool) -> Result<Response, String> {
    let method = http::Method::from_bytes(request.method.as_bytes()).map_err(|_| "invalid method".to_owned())?;
    let mut builder = http::Request::builder().method(method).uri(&request.url);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    let with_body = builder.body(request.body.unwrap_or_default()).map_err(|reason| reason.to_string())?;
    let mut configured = agent().configure_request(with_body);
    if !request.follow {
        // The redirect itself is the response.
        configured = configured.max_redirects(0).max_redirects_will_error(false);
    }
    let mut response = agent().run(configured.build()).map_err(|reason| reason.to_string())?;

    let url = response.get_uri().to_string();
    let redirected = response.get_redirect_history().is_some_and(|history| history.len() > 1);
    let status = response.status();
    let headers = response.headers().iter().map(|(name, value)| (name.as_str().to_owned(), value.as_bytes().to_vec())).collect();

    // In chunks, so that an abandoned request stops downloading.
    let mut body = Vec::new();
    let mut reader = response.body_mut().as_reader();
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        if abandoned.load(Ordering::Relaxed) {
            return Err("aborted".to_owned());
        }
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                if body.len() + read > MAX_BODY {
                    return Err("the response is larger than 1 GiB".to_owned());
                }
                body.extend_from_slice(&chunk[..read]);
            }
            Err(reason) if reason.kind() == std::io::ErrorKind::Interrupted => {}
            Err(reason) => return Err(reason.to_string()),
        }
    }
    Ok(Response { status: status.as_u16(), reason: status.canonical_reason().unwrap_or(""), url, redirected, headers, body })
}

/// The strings of a JavaScript array, or `None` if it is not an array of
/// strings.
unsafe fn strings(env: napi_env, array: napi_value) -> Option<Vec<String>> {
    let mut is_array = false;
    napi_is_array(env, array, &mut is_array);
    if !is_array {
        return None;
    }
    let mut length = 0u32;
    napi_get_array_length(env, array, &mut length);
    let mut result = Vec::with_capacity(length as usize);
    for index in 0..length {
        let mut item = ptr::null_mut();
        napi_get_element(env, array, index, &mut item);
        result.push(string_argument(env, item)?);
    }
    Some(result)
}

/// `http.send(method, url, headers, body, follow, done)`.
unsafe extern "C" fn send(env: napi_env, info: napi_callback_info) -> napi_value {
    let [method, url, headers, body, follow, done] = arguments::<6>(env, info);
    let (Some(method), Some(url)) = (string_argument(env, method), string_argument(env, url)) else {
        return throw(env, "http.send: the method and the URL must be strings");
    };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return throw(env, "http.send: only http: and https: URLs are requested");
    }
    let Some(flat) = strings(env, headers).filter(|flat| flat.len() % 2 == 0) else {
        return throw(env, "http.send: the headers must be an array of names and values");
    };
    let mut pairs = flat.into_iter();
    let mut headers = Vec::new();
    while let (Some(name), Some(value)) = (pairs.next(), pairs.next()) {
        headers.push((name, value));
    }
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, body, &mut kind);
    let body = if kind == NAPI_UNDEFINED || kind == NAPI_NULL {
        None
    } else {
        let Some((data, length)) = bytes_of(env, body) else {
            return throw(env, "http.send: the body must be a typed array or an ArrayBuffer");
        };
        // The worker cannot read memory the collector owns: copied. A null
        // pointer comes only with a length of 0.
        Some(if length == 0 { Vec::new() } else { std::slice::from_raw_parts(data, length).to_vec() })
    };
    let mut follows = true;
    napi_get_value_bool(env, follow, &mut follows);
    napi_typeof(env, done, &mut kind);
    if kind != NAPI_FUNCTION {
        return throw(env, "http.send: the last argument must be a callback");
    }

    let abandoned = Arc::new(AtomicBool::new(false));
    let id = PENDING.with(|pending| {
        let mut pending = pending.borrow_mut();
        pending.0 = pending.0.wrapping_add(1).max(1);
        let id = pending.0;
        pending.1.insert(id, abandoned.clone());
        id
    });
    let done = Callback(reference(env, done));
    let request = Request { method, url, headers, body, follow: follows };
    worker::submit_request(move || {
        let result = perform(request, &abandoned);
        Box::new(move |env| {
            let done = done;
            PENDING.with(|pending| pending.borrow_mut().1.remove(&id));
            // Aborted: JavaScript has its answer already.
            if !abandoned.load(Ordering::Relaxed) {
                let function = dereference(env, done.0);
                match result {
                    Ok(response) => {
                        let mut headers = ptr::null_mut();
                        napi_create_array(env, &mut headers);
                        for (index, (name, value)) in response.headers.iter().enumerate() {
                            // Header values are bytes; anything that is not
                            // UTF-8 is read as Latin-1, as `fetch` does.
                            let value = match std::str::from_utf8(value) {
                                Ok(text) => text.to_owned(),
                                Err(_) => value.iter().map(|&byte| byte as char).collect(),
                            };
                            napi_set_element(env, headers, index as u32 * 2, string(env, name));
                            napi_set_element(env, headers, index as u32 * 2 + 1, string(env, &value));
                        }
                        let arguments = [
                            null(env),
                            number(env, response.status as f64),
                            string(env, response.reason),
                            string(env, &response.url),
                            boolean(env, response.redirected),
                            headers,
                            adopt_bytes(env, response.body),
                        ];
                        invoke(env, function, &arguments);
                    }
                    Err(message) => invoke(env, function, &[error(env, &message)]),
                }
            }
            napi_delete_reference(env, done.0);
        })
    });
    number(env, id as f64)
}

/// `http.abort(id)`.
unsafe extern "C" fn abort(env: napi_env, info: napi_callback_info) -> napi_value {
    let [id] = arguments::<1>(env, info);
    let id = number_or(env, id, 0.0) as u32;
    PENDING.with(|pending| {
        if let Some(abandoned) = pending.borrow().1.get(&id) {
            abandoned.store(true, Ordering::Relaxed);
        }
    });
    undefined(env)
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    let object = define_object(env, host, c"http");
    define_function(env, object, c"send", send);
    define_function(env, object, c"abort", abort);
}
