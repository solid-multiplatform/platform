//! Image decoding: PNG, JPEG and WebP to 8-bit RGBA, on a worker thread.
//!
//! A decoded image reaches JavaScript as `{ width, height, data, close() }`,
//! the shape of an `ImageBitmap` plus its pixels. `data` is a `Uint8Array`
//! over the decoder's own buffer, so nothing is copied on the way to
//! `gl.texImage2D`, and `close()` frees the pixels at once instead of when
//! the collector gets to them.

use crate::gl::BITMAP_TAG;
use crate::napi::*;
use crate::runtime::invoke;
use crate::worker::{self, Callback};
use std::cell::Cell;
use std::ptr;

struct Decoded {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

/// The part of the image to keep, as `createImageBitmap` takes it: the
/// rectangle may reach outside the image, where it is transparent.
struct Crop {
    x: i64,
    y: i64,
    width: u32,
    height: u32,
}

fn decode(encoded: &[u8], crop: Option<Crop>, premultiply: bool) -> Result<Decoded, String> {
    let image = image::load_from_memory(encoded).map_err(|reason| format!("Cannot decode the image: {reason}"))?;
    let image = image.into_rgba8();
    let (width, height) = image.dimensions();
    let mut decoded = Decoded { width, height, pixels: image.into_raw() };
    if let Some(crop) = crop {
        decoded = cut(&decoded, &crop);
    }
    if premultiply {
        for pixel in decoded.pixels.chunks_exact_mut(4) {
            let alpha = pixel[3] as u32;
            if alpha != 255 {
                for channel in &mut pixel[..3] {
                    *channel = ((*channel as u32 * alpha + 127) / 255) as u8;
                }
            }
        }
    }
    Ok(decoded)
}

fn cut(image: &Decoded, crop: &Crop) -> Decoded {
    let mut pixels = vec![0u8; crop.width as usize * crop.height as usize * 4];
    // The columns and rows of the rectangle that lie inside the image.
    let left = crop.x.clamp(0, image.width as i64);
    let right = (crop.x + crop.width as i64).clamp(0, image.width as i64);
    let top = crop.y.clamp(0, image.height as i64);
    let bottom = (crop.y + crop.height as i64).clamp(0, image.height as i64);
    let run = (right - left) as usize * 4;
    for y in top..bottom {
        let from = (y as usize * image.width as usize + left as usize) * 4;
        let to = ((y - crop.y) as usize * crop.width as usize + (left - crop.x) as usize) * 4;
        pixels[to..to + run].copy_from_slice(&image.pixels[from..from + run]);
    }
    Decoded { width: crop.width, height: crop.height, pixels }
}

thread_local! {
    /// The `close` method every decoded image shares.
    static CLOSE: Cell<napi_ref> = const { Cell::new(ptr::null_mut()) };
}

/// `image.close()`: frees the pixels. The image is empty afterwards, and an
/// upload of it throws.
unsafe extern "C" fn close(env: napi_env, info: napi_callback_info) -> napi_value {
    let mut this = ptr::null_mut();
    let mut argc = 0usize;
    napi_get_cb_info(env, info, &mut argc, ptr::null_mut(), &mut this, ptr::null_mut());
    let mut decoded = false;
    if napi_check_object_type_tag(env, this, &BITMAP_TAG, &mut decoded) != NAPI_OK || !decoded {
        return throw(env, "close: not a decoded image");
    }
    let mut key = ptr::null_mut();
    node_api_create_property_key_utf8(env, c"data".as_ptr(), NAPI_AUTO_LENGTH, &mut key);
    let (mut data, mut buffer) = (ptr::null_mut(), ptr::null_mut());
    napi_get_property(env, this, key, &mut data);
    let (mut kind, mut length) = (0, 0usize);
    if napi_get_typedarray_info(env, data, &mut kind, &mut length, ptr::null_mut(), &mut buffer, ptr::null_mut())
        == NAPI_OK
    {
        // Fails on a buffer that is detached already: a second close.
        napi_detach_arraybuffer(env, buffer);
    }
    undefined(env)
}

unsafe fn bitmap(env: napi_env, decoded: Decoded) -> napi_value {
    let length = decoded.pixels.len();
    let buffer = adopt_bytes(env, decoded.pixels);
    let mut data = ptr::null_mut();
    napi_create_typedarray(env, NAPI_UINT8_ARRAY, length, buffer, 0, &mut data);
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    napi_set_named_property(env, object, c"width".as_ptr(), number(env, decoded.width as f64));
    napi_set_named_property(env, object, c"height".as_ptr(), number(env, decoded.height as f64));
    napi_set_named_property(env, object, c"data".as_ptr(), data);
    napi_set_named_property(env, object, c"close".as_ptr(), dereference(env, CLOSE.get()));
    napi_type_tag_object(env, object, &BITMAP_TAG);
    object
}

/// `__solid.decodeImage(bytes, x, y, width, height, premultiply, done)`:
/// decodes an encoded image on a worker, then calls `done(null, image)` or
/// `done(Error)`. With numbers for the rectangle only that part is kept;
/// `premultiply` multiplies colour by alpha.
unsafe extern "C" fn decode_image(env: napi_env, info: napi_callback_info) -> napi_value {
    let [bytes, x, y, width, height, premultiply, done] = arguments::<7>(env, info);
    let Some((data, length)) = bytes_of(env, bytes) else {
        return throw(env, "decodeImage: the image must be an ArrayBuffer or a typed array");
    };
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, width, &mut kind);
    let crop = if kind == NAPI_NUMBER {
        let (width, height) = (number_or(env, width, 0.0), number_or(env, height, 0.0));
        if !(width >= 1.0 && height >= 1.0 && width * height <= (1u32 << 28) as f64) {
            return throw(env, "decodeImage: the rectangle must have a positive size");
        }
        Some(Crop {
            x: number_or(env, x, 0.0) as i64,
            y: number_or(env, y, 0.0) as i64,
            width: width as u32,
            height: height as u32,
        })
    } else {
        None
    };
    let mut multiply = false;
    napi_get_value_bool(env, premultiply, &mut multiply);
    // The one copy on this path: the worker cannot read memory the
    // collector owns.
    let encoded = std::slice::from_raw_parts(data, length).to_vec();
    let done = Callback(reference(env, done));
    worker::submit(move || {
        let result = decode(&encoded, crop, multiply);
        Box::new(move |env| {
            let done = done;
            let function = dereference(env, done.0);
            match result {
                Ok(decoded) => invoke(env, function, &[null(env), bitmap(env, decoded)]),
                Err(message) => invoke(env, function, &[error(env, &message)]),
            }
            napi_delete_reference(env, done.0);
        })
    });
    undefined(env)
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    let mut function = ptr::null_mut();
    napi_create_function(env, c"close".as_ptr(), NAPI_AUTO_LENGTH, close, ptr::null_mut(), &mut function);
    CLOSE.set(reference(env, function));
    define_function(env, host, c"decodeImage", decode_image);
}
