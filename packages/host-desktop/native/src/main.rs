//! Solid Multiplatform desktop runtime.
//!
//! One executable: the Hermes JavaScript engine, an SDL3 window and a GL
//! surface for the scene. JavaScript reaches the host through Node-API, so
//! the same interface serves native plugins.

mod gl;
mod napi;
mod runtime;

use napi::*;
use sdl3_sys::everything::*;
use std::ffi::{c_void, CString};
use std::ptr;

/// `print(...values)`: writes its arguments to standard output.
unsafe extern "C" fn print(env: napi_env, info: napi_callback_info) -> napi_value {
    let (values, count) = arguments_given::<8>(env, info);
    let parts: Vec<String> = values[..count].iter().map(|value| to_string(env, *value)).collect();
    println!("{}", parts.join(" "));
    undefined(env)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut headless = false;
    let mut script = None;
    for arg in &mut args {
        match arg.as_str() {
            "--headless" => headless = true,
            _ => script = Some(arg),
        }
    }
    let script = script.expect("usage: solid-desktop [--headless] <script.js>");
    let source = std::fs::read(&script).expect("cannot read the script");
    let name = CString::new(script).unwrap();
    unsafe {
        let mut window = ptr::null_mut();
        if !headless {
            if !SDL_Init(SDL_INIT_VIDEO) {
                eprintln!("SDL could not start a video driver");
                std::process::exit(2);
            }
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES.0 as i32);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
            window = SDL_CreateWindow(c"Solid".as_ptr(), 1280, 720, SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE);
            if window.is_null() {
                eprintln!("SDL could not create a window");
                std::process::exit(2);
            }
        } else {
            SDL_Init(SDL_INIT_EVENTS);
        }

        let engine = solid_engine_create(ptr::null_mut());
        let env = solid_engine_env(engine);
        let mut scope: *mut c_void = ptr::null_mut();
        napi_open_handle_scope(env, &mut scope);
        let mut global = ptr::null_mut();
        napi_get_global(env, &mut global);
        define_function(env, global, "print", print);
        runtime::install(env, engine, global);
        if !window.is_null() && !gl::install(env, global, window) {
            eprintln!("No OpenGL ES 3 context is available");
            std::process::exit(2);
        }

        let mut result = ptr::null_mut();
        let status = solid_engine_run(engine, source.as_ptr(), source.len(), name.as_ptr(), &mut result);
        let mut code = 0;
        if status != NAPI_OK {
            eprintln!("{}", take_exception(env).unwrap_or_else(|| "script failed".into()));
            code = 1;
        }
        solid_engine_drain(engine);
        napi_close_handle_scope(env, scope);
        if code == 0 {
            code = runtime::run(env, engine, window);
        }
        solid_engine_destroy(engine);
        SDL_Quit();
        std::process::exit(code);
    }
}
