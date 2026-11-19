//! Solid Multiplatform desktop runtime.
//!
//! One executable: the Hermes JavaScript engine, an SDL3 window and a GL
//! surface for the scene. JavaScript reaches the host through Node-API, so
//! the same interface serves native plugins.

#[cfg(all(feature = "accessibility", target_os = "linux"))]
mod a11y;
mod console;
mod dialog;
mod files;
mod gl;
mod http;
mod images;
mod input;
mod intl;
mod keys;
mod napi;
#[cfg(all(feature = "connectivity", target_os = "linux"))]
mod network;
#[cfg(all(feature = "notifications", target_os = "linux"))]
mod notify;
mod runtime;
mod storage;
mod system;
mod testing;
mod window;
mod worker;

use napi::*;
use sdl3_sys::everything::*;
use std::ffi::{c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::process::exit;
use std::ptr;

const USAGE: &str = "usage: solid-desktop [--headless] [--first-frame-exit] <script.js | script.hbc> [argument...]
       solid-desktop [--headless] [--first-frame-exit] --script <script.js | script.hbc> [argument...]
       solid-desktop --compile <script.js> <script.hbc>
       solid-desktop --version | --diagnostics

A packaged app (../resources/app.hbc or app.js beside the executable's
directory) runs without naming a script; everything after the options is the
app's arguments. --first-frame-exit prints that the first frame reached the
screen and ends, for tests that must not leave a window open.";

/// Whether SDL is part of this executable or a library the system supplies.
const SDL_LINKAGE: &str = if cfg!(feature = "static-sdl") { "static" } else { "dynamic" };

/// `--diagnostics`: what this executable is made of, one fact per line. The
/// video drivers are the ones compiled into SDL, not the ones that would
/// start here: nothing is initialised.
unsafe fn diagnostics() -> ! {
    println!("solid-desktop {}", env!("CARGO_PKG_VERSION"));
    println!("target {}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let version = SDL_GetVersion();
    println!("sdl {}.{}.{} {SDL_LINKAGE}", version / 1_000_000, version / 1000 % 1000, version % 1000);
    let drivers: Vec<String> = (0..SDL_GetNumVideoDrivers())
        .map(|index| SDL_GetVideoDriver(index))
        .filter(|name| !name.is_null())
        .map(|name| CStr::from_ptr(name).to_string_lossy().into_owned())
        .collect();
    println!("video-drivers {}", drivers.join(" "));
    let accessibility = cfg!(all(feature = "accessibility", target_os = "linux"));
    println!("accessibility {}", if accessibility { "at-spi" } else { "none" });
    let notifications = cfg!(all(feature = "notifications", target_os = "linux"));
    println!("notifications {}", if notifications { "dbus" } else { "none" });
    let connectivity = cfg!(all(feature = "connectivity", target_os = "linux"));
    println!("connectivity {}", if connectivity { "networkmanager" } else { "none" });
    exit(0);
}

/// The script of a packaged app: `resources/app.hbc`, or `app.js`, beside
/// the directory this executable is in (`<app>/bin/<name>`). The executable
/// is found through the system, with links followed, so the app runs from
/// wherever its directory is put and through a link on the PATH.
/// A path without Windows' verbatim prefix. `canonicalize` on Windows
/// answers `\\?\D:\app`, and JavaScript joins such a path with forward
/// slashes; a verbatim path must use backslashes only, so the prefix is
/// dropped where it names a plain drive path.
fn plain(path: PathBuf) -> PathBuf {
    match path.to_str() {
        Some(text) => match text.strip_prefix(r"\\?\") {
            Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
            _ => path,
        },
        None => path,
    }
}

fn packaged_script() -> Option<String> {
    let executable = plain(std::env::current_exe().ok()?.canonicalize().ok()?);
    let resources = executable.parent()?.parent()?.join("resources");
    ["app.hbc", "app.js"]
        .iter()
        .map(|name| resources.join(name))
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

/// What the command line asks for: `(headless, first_frame_exit, script, the
/// app's arguments)`. A packaged app's script is its own, so every plain
/// argument is the app's (a URL it was opened with); otherwise the first one
/// names the script.
fn command_line(args: Vec<String>) -> (bool, bool, String, Vec<String>) {
    let (mut headless, mut first_frame_exit, mut script, mut rest) =
        (false, false, None, Vec::new());
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--headless" => headless = true,
            "--first-frame-exit" => first_frame_exit = true,
            "--script" => script = Some(args.next().unwrap_or_else(|| fail(USAGE))),
            "--" => rest.extend(&mut args),
            flag if flag.starts_with("--") => fail(USAGE),
            _ => rest.push(arg),
        }
    }
    let script = script.or_else(packaged_script).unwrap_or_else(|| {
        if rest.is_empty() {
            fail(USAGE);
        }
        rest.remove(0)
    });
    (headless, first_frame_exit, script, rest)
}

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
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        ["--compile", input, output] => unsafe { compile(input, output) },
        ["--version"] => {
            println!("solid-desktop {}", env!("CARGO_PKG_VERSION"));
            exit(0);
        }
        ["--diagnostics"] => unsafe { diagnostics() },
        _ => {}
    }
    let (headless, first_frame_exit, script, app_args) = command_line(args);
    if first_frame_exit {
        runtime::exit_after_first_frame();
    }
    let script = script.as_str();
    let source = read_script(script);
    let name = CString::new(script).unwrap();
    // Assets are named relative to the script: for a packaged app that is
    // its resources directory, wherever the app has been put.
    let directory = Path::new(script)
        .canonicalize()
        .ok()
        .map(plain)
        .and_then(|path| path.parent().map(|parent| parent.to_string_lossy().into_owned()))
        .unwrap_or_else(|| fail(&format!("Cannot resolve the directory of {script}")));
    unsafe {
        let mut window = ptr::null_mut();
        if !headless {
            // SDL turns the screen saver off for anything with a window unless
            // told otherwise; an app that wants the screen kept awake asks
            // (`window.allowScreenSaver`).
            SDL_SetHint(SDL_HINT_VIDEO_ALLOW_SCREENSAVER, c"1".as_ptr());
            // Nothing here opens a joystick or a sensor, and SDL must never
            // start polling for them on its own: with these on and such a
            // device open its event wait wakes every few milliseconds.
            SDL_SetHint(SDL_HINT_AUTO_UPDATE_JOYSTICKS, c"0".as_ptr());
            SDL_SetHint(SDL_HINT_AUTO_UPDATE_SENSORS, c"0".as_ptr());
            if !SDL_Init(SDL_INIT_VIDEO) {
                fail(&format!("SDL could not start a video driver: {}", CStr::from_ptr(SDL_GetError()).to_string_lossy()));
            }
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES.0 as i32);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
            // The drawing buffer has the display's pixels, not one per point.
            let flags = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
            window = SDL_CreateWindow(c"Solid".as_ptr(), 1280, 720, flags);
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
        // What the app was started with: a URL of its scheme, a file.
        let mut arguments = ptr::null_mut();
        napi_create_array(env, &mut arguments);
        for (index, argument) in app_args.iter().enumerate() {
            napi_set_element(env, arguments, index as u32, string(env, argument));
        }
        napi_set_named_property(env, host, c"args".as_ptr(), arguments);
        console::install(env, engine, global, host);
        files::install(env, host);
        images::install(env, host);
        system::install(env, host);
        storage::install(env, host);
        http::install(env, host);
        intl::install(env, host);
        #[cfg(all(feature = "notifications", target_os = "linux"))]
        notify::install(env, host);
        #[cfg(all(feature = "connectivity", target_os = "linux"))]
        network::install(env, host);
        if !window.is_null() {
            gl::install(env, host);
            window::install(env, host, window);
            input::install(env, host);
            dialog::install(env, host);
            #[cfg(all(feature = "accessibility", target_os = "linux"))]
            a11y::install(env, host, window);
            if std::env::var_os("SOLID_DESKTOP_TEST").is_some() {
                testing::install(env, host);
            }
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
