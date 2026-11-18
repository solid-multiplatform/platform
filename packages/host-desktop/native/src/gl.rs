//! The scene surface: a GL context exposed to JavaScript with WebGL names.
//! Only what the first frame needs is here; the full binding is generated.

use crate::napi::*;
use crate::runtime::LOOP;
use sdl3_sys::everything::*;
use std::ffi::c_void;
use std::ptr;

type ClearColor = unsafe extern "C" fn(f32, f32, f32, f32);
type Clear = unsafe extern "C" fn(u32);
type ReadPixels = unsafe extern "C" fn(i32, i32, i32, i32, u32, u32, *mut c_void);

static mut CLEAR_COLOR: Option<ClearColor> = None;
static mut CLEAR: Option<Clear> = None;
static mut READ_PIXELS: Option<ReadPixels> = None;

unsafe extern "C" fn clear_color(env: napi_env, info: napi_callback_info) -> napi_value {
    let [r, g, b, a] = arguments::<4>(env, info);
    if let Some(call) = CLEAR_COLOR {
        call(
            number_or(env, r, 0.0) as f32,
            number_or(env, g, 0.0) as f32,
            number_or(env, b, 0.0) as f32,
            number_or(env, a, 1.0) as f32,
        );
    }
    undefined(env)
}

unsafe extern "C" fn clear(env: napi_env, info: napi_callback_info) -> napi_value {
    let [mask] = arguments::<1>(env, info);
    if let Some(call) = CLEAR {
        call(number_or(env, mask, 0.0) as u32);
        LOOP.with(|l| l.borrow_mut().drew = true);
    }
    undefined(env)
}

/// `gl.readPixel(x, y)`: the back buffer's colour there as 0xRRGGBBAA.
unsafe extern "C" fn read_pixel(env: napi_env, info: napi_callback_info) -> napi_value {
    let [x, y] = arguments::<2>(env, info);
    let mut pixel = [0u8; 4];
    if let Some(call) = READ_PIXELS {
        const RGBA: u32 = 0x1908;
        const UNSIGNED_BYTE: u32 = 0x1401;
        call(number_or(env, x, 0.0) as i32, number_or(env, y, 0.0) as i32, 1, 1, RGBA, UNSIGNED_BYTE, pixel.as_mut_ptr().cast());
    }
    number(env, u32::from_be_bytes(pixel) as f64)
}

/// Creates the GL context for `window` and installs `gl` on `global`.
pub unsafe fn install(env: napi_env, global: napi_value, window: *mut SDL_Window) -> bool {
    let context = SDL_GL_CreateContext(window);
    if context.is_null() {
        return false;
    }
    // Present on the display's refresh: this is what paces frames.
    SDL_GL_SetSwapInterval(1);
    CLEAR_COLOR = std::mem::transmute(SDL_GL_GetProcAddress(c"glClearColor".as_ptr()));
    CLEAR = std::mem::transmute(SDL_GL_GetProcAddress(c"glClear".as_ptr()));
    READ_PIXELS = std::mem::transmute(SDL_GL_GetProcAddress(c"glReadPixels".as_ptr()));
    let mut gl = ptr::null_mut();
    napi_create_object(env, &mut gl);
    define_function(env, gl, "clearColor", clear_color);
    define_function(env, gl, "clear", clear);
    define_function(env, gl, "readPixel", read_pixel);
    napi_set_named_property(env, gl, c"COLOR_BUFFER_BIT".as_ptr(), number(env, 0x4000 as f64));
    napi_set_named_property(env, global, c"gl".as_ptr(), gl);
    true
}
