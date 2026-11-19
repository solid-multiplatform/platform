//! The WebGL methods that are more than one GL call with scalar arguments.
//! Each validates what GL would read through a pointer: a typed array that is
//! too short throws here instead of reading past its end.

use super::bind::truthy;
use super::table::*;
use super::{State, BITMAP_TAG, FRAMEBUFFER, STATE};
use crate::napi::*;
use std::ffi::{c_char, c_void, CStr};
use std::ptr;
use std::sync::atomic::Ordering;

const RGBA: u32 = 0x1908;
const UNSIGNED_BYTE: u32 = 0x1401;

// --- Objects ---------------------------------------------------------------

/// `createX()` and `deleteX(object)` over GL's generate and delete calls.
macro_rules! object {
    ($create:ident, $delete:ident, $generate:ident, $release:ident) => {
        pub unsafe extern "C" fn $create(env: napi_env, _info: napi_callback_info) -> napi_value {
            let mut name = 0u32;
            $generate(1, &mut name);
            number(env, name as f64)
        }

        pub unsafe extern "C" fn $delete(env: napi_env, info: napi_callback_info) -> napi_value {
            let [name] = arguments::<1>(env, info);
            let name = number_or(env, name, 0.0) as u32;
            $release(1, &name);
            undefined(env)
        }
    };
}

object!(create_buffer, delete_buffer, glGenBuffers, glDeleteBuffers);
object!(create_texture, delete_texture, glGenTextures, glDeleteTextures);
object!(create_vertex_array, delete_vertex_array, glGenVertexArrays, glDeleteVertexArrays);
object!(create_framebuffer, delete_framebuffer, glGenFramebuffers, glDeleteFramebuffers);

pub unsafe extern "C" fn bind_framebuffer(env: napi_env, info: napi_callback_info) -> napi_value {
    let [target, framebuffer] = arguments::<2>(env, info);
    let framebuffer = number_or(env, framebuffer, 0.0) as u32;
    glBindFramebuffer(number_or(env, target, 0.0) as u32, framebuffer);
    FRAMEBUFFER.store(framebuffer, Ordering::Relaxed);
    undefined(env)
}

/// `bufferData(target, data, usage)`, or with a number `bufferData(target,
/// size, usage)`.
pub unsafe extern "C" fn buffer_data(env: napi_env, info: napi_callback_info) -> napi_value {
    let [target, data, usage] = arguments::<3>(env, info);
    let target = number_or(env, target, 0.0) as u32;
    let usage = number_or(env, usage, 0.0) as u32;
    if let Some((bytes, length)) = bytes_of(env, data) {
        glBufferData(target, length as isize, bytes.cast(), usage);
        return undefined(env);
    }
    let mut size = 0.0;
    if napi_get_value_double(env, data, &mut size) != NAPI_OK || size.is_nan() || size < 0.0 {
        return throw(env, "gl.bufferData: expected a typed array, an ArrayBuffer or a size");
    }
    glBufferData(target, size as isize, ptr::null(), usage);
    undefined(env)
}

// --- Shaders and programs ----------------------------------------------------

pub unsafe extern "C" fn shader_source(env: napi_env, info: napi_callback_info) -> napi_value {
    let [shader, source] = arguments::<2>(env, info);
    let Some(source) = string_argument(env, source) else {
        return throw(env, "gl.shaderSource: the source must be a string");
    };
    let text: *const c_char = source.as_ptr().cast();
    let length = source.len() as i32;
    glShaderSource(number_or(env, shader, 0.0) as u32, 1, &text, &length);
    undefined(env)
}

const COMPILE_STATUS: u32 = 0x8B81;
const LINK_STATUS: u32 = 0x8B82;
const VALIDATE_STATUS: u32 = 0x8B83;
const DELETE_STATUS: u32 = 0x8B80;
const INFO_LOG_LENGTH: u32 = 0x8B84;

/// `getShaderParameter` and `getProgramParameter`: a boolean for a status,
/// a number otherwise.
macro_rules! parameter {
    ($name:ident, $query:ident) => {
        pub unsafe extern "C" fn $name(env: napi_env, info: napi_callback_info) -> napi_value {
            let [object, name] = arguments::<2>(env, info);
            let name = number_or(env, name, 0.0) as u32;
            let mut value = 0;
            $query(number_or(env, object, 0.0) as u32, name, &mut value);
            match name {
                COMPILE_STATUS | LINK_STATUS | VALIDATE_STATUS | DELETE_STATUS => boolean(env, value != 0),
                _ => number(env, value as f64),
            }
        }
    };
}

parameter!(get_shader_parameter, glGetShaderiv);
parameter!(get_program_parameter, glGetProgramiv);

macro_rules! info_log {
    ($name:ident, $query:ident, $read:ident) => {
        pub unsafe extern "C" fn $name(env: napi_env, info: napi_callback_info) -> napi_value {
            let [object] = arguments::<1>(env, info);
            let object = number_or(env, object, 0.0) as u32;
            let mut capacity = 0;
            $query(object, INFO_LOG_LENGTH, &mut capacity);
            let mut log = vec![0u8; capacity.max(1) as usize];
            let mut length = 0;
            $read(object, log.len() as i32, &mut length, log.as_mut_ptr().cast());
            string(env, &String::from_utf8_lossy(&log[..(length.max(0) as usize).min(log.len())]))
        }
    };
}

info_log!(get_shader_info_log, glGetShaderiv, glGetShaderInfoLog);
info_log!(get_program_info_log, glGetProgramiv, glGetProgramInfoLog);

/// An attribute or uniform name, NUL-terminated on the stack. `None` when it
/// is not a string or is longer than any GLSL identifier may be.
unsafe fn identifier(env: napi_env, value: napi_value, buffer: &mut [u8; 1025]) -> Option<*const c_char> {
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, value, &mut kind);
    let mut length = 0usize;
    if kind != NAPI_STRING
        || napi_get_value_string_utf8(env, value, ptr::null_mut(), 0, &mut length) != NAPI_OK
        || length >= buffer.len()
    {
        return None;
    }
    napi_get_value_string_utf8(env, value, buffer.as_mut_ptr().cast(), buffer.len(), &mut length);
    Some(buffer.as_ptr().cast())
}

pub unsafe extern "C" fn bind_attrib_location(env: napi_env, info: napi_callback_info) -> napi_value {
    let [program, index, name] = arguments::<3>(env, info);
    let mut buffer = [0u8; 1025];
    let Some(name) = identifier(env, name, &mut buffer) else {
        return throw(env, "gl.bindAttribLocation: the name must be a string of at most 1024 bytes");
    };
    glBindAttribLocation(number_or(env, program, 0.0) as u32, number_or(env, index, 0.0) as u32, name);
    undefined(env)
}

/// The attribute's index, or -1 when the program has none of that name.
pub unsafe extern "C" fn get_attrib_location(env: napi_env, info: napi_callback_info) -> napi_value {
    let [program, name] = arguments::<2>(env, info);
    let mut buffer = [0u8; 1025];
    let Some(name) = identifier(env, name, &mut buffer) else {
        return throw(env, "gl.getAttribLocation: the name must be a string of at most 1024 bytes");
    };
    number(env, glGetAttribLocation(number_or(env, program, 0.0) as u32, name) as f64)
}

/// The uniform's location, or `null` when the program has none of that name.
pub unsafe extern "C" fn get_uniform_location(env: napi_env, info: napi_callback_info) -> napi_value {
    let [program, name] = arguments::<2>(env, info);
    let mut buffer = [0u8; 1025];
    let Some(name) = identifier(env, name, &mut buffer) else {
        return throw(env, "gl.getUniformLocation: the name must be a string of at most 1024 bytes");
    };
    match glGetUniformLocation(number_or(env, program, 0.0) as u32, name) {
        -1 => null(env),
        location => number(env, location as f64),
    }
}

// --- Uniform arrays -----------------------------------------------------------

/// `uniformNfv(location, Float32Array)` and `uniformNiv(location,
/// Int32Array)`: the array is read in place.
macro_rules! uniform_vector {
    ($name:ident, $call:ident, $kind:ident, $size:expr, $js:literal, $array:literal) => {
        pub unsafe extern "C" fn $name(env: napi_env, info: napi_callback_info) -> napi_value {
            let [location, values] = arguments::<2>(env, info);
            match typed_array(env, values) {
                Some((data, length, $kind)) if length >= $size => {
                    $call(number_or(env, location, -1.0) as i32, (length / $size) as i32, data.cast());
                    undefined(env)
                }
                _ => throw(env, concat!("gl.", $js, ": expected ", $array, " of at least ", stringify!($size), " values")),
            }
        }
    };
}

uniform_vector!(uniform_1fv, glUniform1fv, NAPI_FLOAT32_ARRAY, 1, "uniform1fv", "a Float32Array");
uniform_vector!(uniform_2fv, glUniform2fv, NAPI_FLOAT32_ARRAY, 2, "uniform2fv", "a Float32Array");
uniform_vector!(uniform_3fv, glUniform3fv, NAPI_FLOAT32_ARRAY, 3, "uniform3fv", "a Float32Array");
uniform_vector!(uniform_4fv, glUniform4fv, NAPI_FLOAT32_ARRAY, 4, "uniform4fv", "a Float32Array");
uniform_vector!(uniform_1iv, glUniform1iv, NAPI_INT32_ARRAY, 1, "uniform1iv", "an Int32Array");
uniform_vector!(uniform_2iv, glUniform2iv, NAPI_INT32_ARRAY, 2, "uniform2iv", "an Int32Array");
uniform_vector!(uniform_3iv, glUniform3iv, NAPI_INT32_ARRAY, 3, "uniform3iv", "an Int32Array");
uniform_vector!(uniform_4iv, glUniform4iv, NAPI_INT32_ARRAY, 4, "uniform4iv", "an Int32Array");

/// `uniformMatrixNfv(location, transpose, Float32Array)`.
macro_rules! uniform_matrix {
    ($name:ident, $call:ident, $size:expr, $js:literal) => {
        pub unsafe extern "C" fn $name(env: napi_env, info: napi_callback_info) -> napi_value {
            let [location, transpose, values] = arguments::<3>(env, info);
            match typed_array(env, values) {
                Some((data, length, NAPI_FLOAT32_ARRAY)) if length >= $size => {
                    $call(
                        number_or(env, location, -1.0) as i32,
                        (length / $size) as i32,
                        truthy(env, transpose) as u8,
                        data.cast(),
                    );
                    undefined(env)
                }
                _ => throw(env, concat!("gl.", $js, ": expected a Float32Array of at least ", stringify!($size), " values")),
            }
        }
    };
}

uniform_matrix!(uniform_matrix_2fv, glUniformMatrix2fv, 4, "uniformMatrix2fv");
uniform_matrix!(uniform_matrix_3fv, glUniformMatrix3fv, 9, "uniformMatrix3fv");
uniform_matrix!(uniform_matrix_4fv, glUniformMatrix4fv, 16, "uniformMatrix4fv");

// --- Pixels -------------------------------------------------------------------

const UNPACK_ALIGNMENT: u32 = 0x0CF5;
const PACK_ALIGNMENT: u32 = 0x0D05;
const UNPACK_FLIP_Y_WEBGL: u32 = 0x9240;
const UNPACK_PREMULTIPLY_ALPHA_WEBGL: u32 = 0x9241;

pub unsafe extern "C" fn pixel_storei(env: napi_env, info: napi_callback_info) -> napi_value {
    let [name, value] = arguments::<2>(env, info);
    let name = number_or(env, name, 0.0) as u32;
    match name {
        UNPACK_PREMULTIPLY_ALPHA_WEBGL => STATE.with(|s| s.borrow_mut().premultiply = truthy(env, value)),
        UNPACK_FLIP_Y_WEBGL => STATE.with(|s| s.borrow_mut().flip = truthy(env, value)),
        UNPACK_ALIGNMENT | PACK_ALIGNMENT => glPixelStorei(name, number_or(env, value, 0.0) as i32),
        _ => return throw(env, &format!("gl.pixelStorei: parameter 0x{name:04x} is not implemented by the desktop runtime")),
    }
    undefined(env)
}

/// Pixels on their way into a texture.
struct Upload {
    width: i32,
    height: i32,
    /// `None` allocates without pixels, which WebGL defines as transparent
    /// black.
    data: Option<*const u8>,
    /// Whether the unpack settings apply: they do to bytes and to
    /// `ImageData`, not to a decoded image, which carries its own.
    unpack: bool,
}

/// Checks format and size, the same for every upload. Only 8-bit RGBA is
/// implemented, which is all the renderer uploads.
unsafe fn check_pixels(
    width: f64,
    height: f64,
    format: napi_value,
    kind: napi_value,
    data: Option<(*mut u8, usize)>,
    env: napi_env,
) -> Result<(i32, i32), String> {
    if number_or(env, format, 0.0) as u32 != RGBA || number_or(env, kind, 0.0) as u32 != UNSIGNED_BYTE {
        return Err("only RGBA with UNSIGNED_BYTE is implemented by the desktop runtime".into());
    }
    if !(width >= 0.0 && height >= 0.0 && width <= i32::MAX as f64 && height <= i32::MAX as f64) {
        return Err(format!("invalid size {width} x {height}"));
    }
    let (width, height) = (width as i32, height as i32);
    if let Some((_, length)) = data {
        let needed = width as usize * height as usize * 4;
        if length < needed {
            return Err(format!("{width} x {height} RGBA pixels need {needed} bytes, the source has {length}"));
        }
    }
    Ok((width, height))
}

/// The explicit form: `width, height, [border,] format, type, pixels`.
unsafe fn upload_from_bytes(
    env: napi_env,
    width: napi_value,
    height: napi_value,
    format: napi_value,
    kind: napi_value,
    pixels: napi_value,
    may_be_empty: bool,
) -> Result<Upload, String> {
    let mut value_kind = NAPI_UNDEFINED;
    napi_typeof(env, pixels, &mut value_kind);
    let data = if value_kind == NAPI_NULL || value_kind == NAPI_UNDEFINED {
        if !may_be_empty {
            return Err("pixels are required".into());
        }
        None
    } else {
        Some(bytes_of(env, pixels).ok_or("the pixels must be a typed array")?)
    };
    let (width, height) =
        check_pixels(number_or(env, width, -1.0), number_or(env, height, -1.0), format, kind, data, env)?;
    Ok(Upload { width, height, data: data.map(|(bytes, _)| bytes.cast_const()), unpack: true })
}

/// The source form: `format, type, source`, where the source is an image this
/// runtime decoded or an `ImageData`-shaped `{ width, height, data }`.
unsafe fn upload_from_source(
    env: napi_env,
    state: &State,
    format: napi_value,
    kind: napi_value,
    source: napi_value,
) -> Result<Upload, String> {
    const SHAPE: &str = "the source must be a decoded image or ImageData";
    let property = |key: napi_ref| {
        let mut value = ptr::null_mut();
        (napi_get_property(env, source, dereference(env, key), &mut value) == NAPI_OK).then_some(value)
    };
    let (Some(width), Some(height), Some(data)) =
        (property(state.key_width), property(state.key_height), property(state.key_data))
    else {
        // Reading a property of a primitive threw.
        let mut ignored = ptr::null_mut();
        napi_get_and_clear_last_exception(env, &mut ignored);
        return Err(SHAPE.into());
    };
    let data = bytes_of(env, data).ok_or(SHAPE)?;
    let (width, height) =
        check_pixels(number_or(env, width, -1.0), number_or(env, height, -1.0), format, kind, Some(data), env)?;
    let mut decoded = false;
    napi_check_object_type_tag(env, source, &BITMAP_TAG, &mut decoded);
    Ok(Upload { width, height, data: Some(data.0.cast_const()), unpack: !decoded })
}

/// The bytes GL reads for `upload`: the caller's own, unless WebGL's unpack
/// settings or its zero-filled allocation call for a rewritten copy, which
/// lands in the scratch buffer.
unsafe fn unpacked(state: &mut State, upload: &Upload) -> *const c_void {
    let length = upload.width as usize * upload.height as usize * 4;
    let Some(data) = upload.data else {
        state.scratch.clear();
        state.scratch.resize(length, 0);
        return state.scratch.as_ptr().cast();
    };
    if !upload.unpack || !(state.premultiply || state.flip) {
        return data.cast();
    }
    let source = std::slice::from_raw_parts(data, length);
    let row = upload.width as usize * 4;
    state.scratch.clear();
    if state.flip && row > 0 {
        state.scratch.extend(source.chunks_exact(row).rev().flatten());
    } else {
        state.scratch.extend_from_slice(source);
    }
    if state.premultiply {
        for pixel in state.scratch.chunks_exact_mut(4) {
            let alpha = pixel[3] as u32;
            for channel in &mut pixel[..3] {
                *channel = ((*channel as u32 * alpha + 127) / 255) as u8;
            }
        }
    }
    state.scratch.as_ptr().cast()
}

/// `texImage2D(target, level, internalformat, width, height, border, format,
/// type, pixels)` or `texImage2D(target, level, internalformat, format, type,
/// source)`.
pub unsafe extern "C" fn tex_image_2d(env: napi_env, info: napi_callback_info) -> napi_value {
    let (a, count) = arguments_given::<9>(env, info);
    STATE.with(|state| {
        let state = &mut *state.borrow_mut();
        let upload = match count {
            9 => upload_from_bytes(env, a[3], a[4], a[6], a[7], a[8], true),
            6 => upload_from_source(env, state, a[3], a[4], a[5]),
            _ => Err("expected 6 or 9 arguments".into()),
        };
        let upload = match upload {
            Ok(upload) if number_or(env, a[2], 0.0) as u32 == RGBA => upload,
            Ok(_) => return throw(env, "gl.texImage2D: only the RGBA internal format is implemented by the desktop runtime"),
            Err(reason) => return throw(env, &format!("gl.texImage2D: {reason}")),
        };
        let border = if count == 9 { number_or(env, a[5], 0.0) as i32 } else { 0 };
        glTexImage2D(
            number_or(env, a[0], 0.0) as u32,
            number_or(env, a[1], 0.0) as i32,
            RGBA as i32,
            upload.width,
            upload.height,
            border,
            RGBA,
            UNSIGNED_BYTE,
            unpacked(state, &upload),
        );
        undefined(env)
    })
}

/// `texSubImage2D(target, level, x, y, width, height, format, type, pixels)`
/// or `texSubImage2D(target, level, x, y, format, type, source)`.
pub unsafe extern "C" fn tex_sub_image_2d(env: napi_env, info: napi_callback_info) -> napi_value {
    let (a, count) = arguments_given::<9>(env, info);
    STATE.with(|state| {
        let state = &mut *state.borrow_mut();
        let upload = match count {
            9 => upload_from_bytes(env, a[4], a[5], a[6], a[7], a[8], false),
            7 => upload_from_source(env, state, a[4], a[5], a[6]),
            _ => Err("expected 7 or 9 arguments".into()),
        };
        let upload = match upload {
            Ok(upload) => upload,
            Err(reason) => return throw(env, &format!("gl.texSubImage2D: {reason}")),
        };
        glTexSubImage2D(
            number_or(env, a[0], 0.0) as u32,
            number_or(env, a[1], 0.0) as i32,
            number_or(env, a[2], 0.0) as i32,
            number_or(env, a[3], 0.0) as i32,
            upload.width,
            upload.height,
            RGBA,
            UNSIGNED_BYTE,
            unpacked(state, &upload),
        );
        undefined(env)
    })
}

/// `compressedTexImage2D(target, level, internalformat, width, height,
/// border, data)`. GL checks the size against the format; it reads no more
/// than the bytes passed.
pub unsafe extern "C" fn compressed_tex_image_2d(env: napi_env, info: napi_callback_info) -> napi_value {
    let a = arguments::<7>(env, info);
    let Some((data, length)) = bytes_of(env, a[6]) else {
        return throw(env, "gl.compressedTexImage2D: the data must be a typed array");
    };
    if length > i32::MAX as usize {
        return throw(env, "gl.compressedTexImage2D: the data is too large");
    }
    glCompressedTexImage2D(
        number_or(env, a[0], 0.0) as u32,
        number_or(env, a[1], 0.0) as i32,
        number_or(env, a[2], 0.0) as u32,
        number_or(env, a[3], 0.0) as i32,
        number_or(env, a[4], 0.0) as i32,
        number_or(env, a[5], 0.0) as i32,
        length as i32,
        data.cast(),
    );
    undefined(env)
}

/// `readPixels(x, y, width, height, format, type, pixels)`, into the array.
pub unsafe extern "C" fn read_pixels(env: napi_env, info: napi_callback_info) -> napi_value {
    let a = arguments::<7>(env, info);
    let Some(target) = bytes_of(env, a[6]) else {
        return throw(env, "gl.readPixels: the destination must be a typed array");
    };
    let (width, height) =
        match check_pixels(number_or(env, a[2], -1.0), number_or(env, a[3], -1.0), a[4], a[5], Some(target), env) {
            Ok(size) => size,
            Err(reason) => return throw(env, &format!("gl.readPixels: {reason}")),
        };
    glReadPixels(
        number_or(env, a[0], 0.0) as i32,
        number_or(env, a[1], 0.0) as i32,
        width,
        height,
        RGBA,
        UNSIGNED_BYTE,
        target.0.cast(),
    );
    undefined(env)
}

// --- Queries --------------------------------------------------------------------

/// `getParameter(name)` for the limits the renderer reads and the strings
/// that identify the driver. Any other parameter throws.
pub unsafe extern "C" fn get_parameter(env: napi_env, info: napi_callback_info) -> napi_value {
    const MAX_TEXTURE_SIZE: u32 = 0x0D33;
    const MAX_TEXTURE_IMAGE_UNITS: u32 = 0x8872;
    const VENDOR: u32 = 0x1F00;
    const RENDERER: u32 = 0x1F01;
    const VERSION: u32 = 0x1F02;
    const SHADING_LANGUAGE_VERSION: u32 = 0x8B8C;
    let [name] = arguments::<1>(env, info);
    let name = number_or(env, name, 0.0) as u32;
    match name {
        MAX_TEXTURE_SIZE | MAX_TEXTURE_IMAGE_UNITS => {
            let mut value = 0;
            glGetIntegerv(name, &mut value);
            number(env, value as f64)
        }
        VENDOR | RENDERER | VERSION | SHADING_LANGUAGE_VERSION => {
            let text = glGetString(name);
            if text.is_null() {
                return null(env);
            }
            string(env, &CStr::from_ptr(text).to_string_lossy())
        }
        _ => throw(env, &format!("gl.getParameter: parameter 0x{name:04x} is not implemented by the desktop runtime")),
    }
}

/// A WebGL extension this runtime can answer for: its WebGL name, the GL
/// extensions that provide it (none when OpenGL ES 3 has it built in) and
/// the constants its object carries.
pub struct Extension {
    name: &'static str,
    requires: &'static [&'static str],
    constants: &'static [(&'static CStr, u32)],
}

pub static EXTENSIONS: &[Extension] = &[
    Extension {
        name: "OES_standard_derivatives",
        requires: &["GL_OES_standard_derivatives"],
        constants: &[(c"FRAGMENT_SHADER_DERIVATIVE_HINT_OES", 0x8B8B)],
    },
    Extension {
        name: "WEBGL_compressed_texture_s3tc",
        requires: &["GL_EXT_texture_compression_s3tc"],
        constants: &[
            (c"COMPRESSED_RGB_S3TC_DXT1_EXT", 0x83F0),
            (c"COMPRESSED_RGBA_S3TC_DXT1_EXT", 0x83F1),
            (c"COMPRESSED_RGBA_S3TC_DXT3_EXT", 0x83F2),
            (c"COMPRESSED_RGBA_S3TC_DXT5_EXT", 0x83F3),
        ],
    },
    Extension {
        name: "WEBGL_compressed_texture_etc",
        requires: &[],
        constants: &[
            (c"COMPRESSED_R11_EAC", 0x9270),
            (c"COMPRESSED_SIGNED_R11_EAC", 0x9271),
            (c"COMPRESSED_RG11_EAC", 0x9272),
            (c"COMPRESSED_SIGNED_RG11_EAC", 0x9273),
            (c"COMPRESSED_RGB8_ETC2", 0x9274),
            (c"COMPRESSED_SRGB8_ETC2", 0x9275),
            (c"COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2", 0x9276),
            (c"COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2", 0x9277),
            (c"COMPRESSED_RGBA8_ETC2_EAC", 0x9278),
            (c"COMPRESSED_SRGB8_ALPHA8_ETC2_EAC", 0x9279),
        ],
    },
    Extension {
        name: "WEBGL_compressed_texture_etc1",
        requires: &["GL_OES_compressed_ETC1_RGB8_texture"],
        constants: &[(c"COMPRESSED_RGB_ETC1_WEBGL", 0x8D64)],
    },
];

/// `getExtension(name)`: the extension's object when the context provides it,
/// else `null`. An extension this runtime has no object for is `null` too,
/// whatever the driver lists: an object without its methods would fail later
/// and less clearly. Vertex array objects need no extension here: the
/// context has `createVertexArray` itself, as WebGL 2 does.
pub unsafe extern "C" fn get_extension(env: napi_env, info: napi_callback_info) -> napi_value {
    let [name] = arguments::<1>(env, info);
    let Some(name) = string_argument(env, name) else {
        return null(env);
    };
    let Some(index) = EXTENSIONS.iter().position(|extension| extension.name == name) else {
        return null(env);
    };
    let extension = &EXTENSIONS[index];
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        if let Some(object) = state.extension_objects[index] {
            return dereference(env, object);
        }
        let provided = |required: &&str| state.extensions.split_ascii_whitespace().any(|listed| listed == *required);
        if !extension.requires.iter().all(provided) {
            return null(env);
        }
        let mut object = ptr::null_mut();
        napi_create_object(env, &mut object);
        for (constant, value) in extension.constants {
            napi_set_named_property(env, object, constant.as_ptr(), number(env, *value as f64));
        }
        state.extension_objects[index] = Some(reference(env, object));
        object
    })
}

/// The context lives as long as the window: it is never lost.
pub unsafe extern "C" fn is_context_lost(env: napi_env, _info: napi_callback_info) -> napi_value {
    boolean(env, false)
}
