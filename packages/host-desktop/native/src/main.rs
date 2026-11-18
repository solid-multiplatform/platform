//! Solid Multiplatform desktop runtime.
//!
//! One executable: the Hermes JavaScript engine, an SDL3 window and a GL
//! surface for the scene. JavaScript reaches the host through Node-API, so
//! the same interface serves native plugins.

mod console;
mod files;
mod gl;
mod images;
mod napi;
mod runtime;
mod worker;

use napi::*;
use sdl3_sys::everything::*;
use std::ffi::{c_void, CStr, CString};
use std::path::Path;
use std::process::exit;
use std::ptr;

const USAGE: &str = "usage: solid-desktop [--headless] <script.js | script.hbc>
       solid-desktop --compile <script.js> <script.hbc>";

/// The first bytes of Hermes bytecode (its magic number, little-endian).
const BYTECODE_MAGIC: [u8; 8] = 0x1F19_03C1_03BC_1FC6u64.to_le_bytes();

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    exit(2);
}

/// The script's bytes, NUL-terminated so that the engine reads source in
/// place. They live as long as the process: functions are compiled, or read
/// from bytecode, when first called.
fn read_script(path: &str) -> &'static [u8] {
    let mut bytes = std::fs::read(path).unwrap_or_else(|reason| fail(&format!("Cannot read {path}: {reason}")));
    bytes.push(0);
    bytes.leak()
}

/// `--compile`: source to optimized bytecode, which starts faster because
/// nothing is parsed at launch.
unsafe fn compile(input: &str, output: &str) -> ! {
    let source = read_script(input);
    let name = CString::new(input).unwrap();
    let engine = solid_engine_create(ptr::null_mut());
    let env = solid_engine_env(engine);
    let mut scope: *mut c_void = ptr::null_mut();
    napi_open_handle_scope(env, &mut scope);
    let (mut bytecode, mut size) = (ptr::null_mut(), 0usize);
    if solid_engine_compile(engine, source.as_ptr(), source.len(), name.as_ptr(), &mut bytecode, &mut size) != NAPI_OK {
        eprintln!("{}", take_exception(env).unwrap_or_else(|| "compilation failed".into()));
        exit(1);
    }
    if let Err(reason) = std::fs::write(output, std::slice::from_raw_parts(bytecode, size)) {
        fail(&format!("Cannot write {output}: {reason}"));
    }
    solid_engine_free_bytecode(bytecode);
    exit(0);
}

fn main() {
    // The clock starts with the process: `performance.now()` counts from here.
    runtime::now_ns();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let (headless, script) = match args[..] {
        ["--compile", input, output] => unsafe { compile(input, output) },
        ["--headless", script] => (true, script),
        [script] if !script.starts_with("--") => (false, script),
        _ => fail(USAGE),
    };
    let source = read_script(script);
    let name = CString::new(script).unwrap();
    // Assets are named relative to the script.
    let directory = Path::new(script)
        .canonicalize()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_string_lossy().into_owned()))
        .unwrap_or_else(|| fail(&format!("Cannot resolve the directory of {script}")));
    unsafe {
        let mut window = ptr::null_mut();
        if !headless {
            if !SDL_Init(SDL_INIT_VIDEO) {
                fail(&format!("SDL could not start a video driver: {}", CStr::from_ptr(SDL_GetError()).to_string_lossy()));
            }
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES.0 as i32);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
            window = SDL_CreateWindow(c"Solid".as_ptr(), 1280, 720, SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE);
            if window.is_null() {
                fail(&format!("SDL could not create a window: {}", CStr::from_ptr(SDL_GetError()).to_string_lossy()));
            }
            worker::wake_through_sdl();
        }

        let engine = solid_engine_create(ptr::null_mut());
        let env = solid_engine_env(engine);
        let mut scope: *mut c_void = ptr::null_mut();
        napi_open_handle_scope(env, &mut scope);
        let mut global = ptr::null_mut();
        napi_get_global(env, &mut global);
        if !window.is_null() {
            gl::create_context(window).unwrap_or_else(|reason| fail(&reason));
        }
        let host = runtime::install(env, engine, global, window);
        napi_set_named_property(env, host, c"appDir".as_ptr(), string(env, &directory));
        console::install(env, engine, global, host);
        files::install(env, host);
        images::install(env, host);
        if !window.is_null() {
            gl::install(env, host);
        }

        let mut result = ptr::null_mut();
        let status = if source.starts_with(&BYTECODE_MAGIC) {
            // Without the terminator: it is not part of the bytecode.
            solid_engine_run_bytecode(engine, source.as_ptr(), source.len() - 1, name.as_ptr(), &mut result)
        } else {
            solid_engine_run(engine, source.as_ptr(), source.len(), name.as_ptr(), &mut result)
        };
        let mut code = 0;
        if status != NAPI_OK {
            // A script that cannot start is fatal; so is bytecode this
            // engine cannot read, which leaves no exception behind.
            let reason = take_exception(env)
                .map(|exception| format!("Uncaught {exception}"))
                .unwrap_or_else(|| format!("{script} is not bytecode this runtime can run"));
            eprintln!("{reason}");
            code = 1;
        }
        solid_engine_drain(engine);
        napi_close_handle_scope(env, scope);
        if code == 0 {
            code = runtime::run(env);
        }
        // No teardown: the process is ending, and worker threads may still
        // hold what a tidy shutdown would free.
        exit(code);
    }
}
