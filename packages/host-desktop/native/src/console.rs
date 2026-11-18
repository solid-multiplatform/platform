//! Output: `print`, and the `write` under `console`, which `prelude.js`
//! defines along with the report of unhandled promise rejections.

use crate::napi::*;
use std::io::Write;
use std::ptr;

/// `print(...values)`: writes its arguments to standard output.
unsafe extern "C" fn print(env: napi_env, info: napi_callback_info) -> napi_value {
    let (values, count) = arguments_given::<8>(env, info);
    let parts: Vec<String> = values[..count].iter().map(|value| to_string(env, *value)).collect();
    println!("{}", parts.join(" "));
    undefined(env)
}

/// `__solid.write(stream, text)`: 1 is standard output, anything else
/// standard error. A closed stream is not an error the script can act on.
unsafe extern "C" fn write(env: napi_env, info: napi_callback_info) -> napi_value {
    let [stream, text] = arguments::<2>(env, info);
    let text = to_string(env, text);
    if number_or(env, stream, 2.0) == 1.0 {
        let _ = std::io::stdout().write_all(text.as_bytes());
    } else {
        let _ = std::io::stderr().write_all(text.as_bytes());
    }
    undefined(env)
}

/// Installs `print` and `__solid.write`, then runs the prelude.
pub unsafe fn install(env: napi_env, engine: *mut std::ffi::c_void, global: napi_value, host: napi_value) {
    define_function(env, global, c"print", print);
    define_function(env, host, c"write", write);
    // NUL-terminated, as the engine reads source in place.
    static PRELUDE: &str = concat!(include_str!("prelude.js"), "\0");
    let mut result = ptr::null_mut();
    if solid_engine_run(engine, PRELUDE.as_ptr(), PRELUDE.len(), c"solid:prelude".as_ptr(), &mut result) != NAPI_OK {
        panic!("the prelude failed: {}", take_exception(env).unwrap_or_default());
    }
}
