//! The part of Node-API the runtime uses, declared by hand: the functions
//! are exported by the Hermes libraries linked into this executable.
#![allow(non_camel_case_types)]

use std::ffi::{c_char, c_void, CStr, CString};
use std::ptr;

#[repr(C)]
pub struct napi_env__ {
    _private: [u8; 0],
}
pub type napi_env = *mut napi_env__;
pub type napi_value = *mut c_void;
pub type napi_callback_info = *mut c_void;
pub type napi_ref = *mut c_void;
pub type napi_status = i32;
pub type napi_callback = unsafe extern "C" fn(napi_env, napi_callback_info) -> napi_value;
pub type napi_finalize = unsafe extern "C" fn(napi_env, *mut c_void, *mut c_void);

pub const NAPI_OK: napi_status = 0;
pub const NAPI_AUTO_LENGTH: usize = usize::MAX;

/// `napi_valuetype`: what `typeof` distinguishes, plus null.
pub const NAPI_UNDEFINED: i32 = 0;
pub const NAPI_NULL: i32 = 1;
pub const NAPI_NUMBER: i32 = 3;
pub const NAPI_STRING: i32 = 4;

/// `napi_typedarray_type`.
pub const NAPI_UINT8_ARRAY: i32 = 1;
pub const NAPI_INT32_ARRAY: i32 = 5;
pub const NAPI_FLOAT32_ARRAY: i32 = 7;

/// `napi_property_attributes`.
pub const NAPI_ENUMERABLE: i32 = 1 << 1;

#[repr(C)]
pub struct napi_property_descriptor {
    pub utf8name: *const c_char,
    pub name: napi_value,
    pub method: Option<napi_callback>,
    pub getter: Option<napi_callback>,
    pub setter: Option<napi_callback>,
    pub value: napi_value,
    pub attributes: i32,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct napi_type_tag {
    pub lower: u64,
    pub upper: u64,
}

extern "C" {
    pub fn solid_engine_create(host: *mut c_void) -> *mut c_void;
    pub fn solid_engine_env(engine: *mut c_void) -> napi_env;
    pub fn solid_engine_run(
        engine: *mut c_void,
        source: *const u8,
        size: usize,
        name: *const c_char,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn solid_engine_run_bytecode(
        engine: *mut c_void,
        bytecode: *const u8,
        size: usize,
        name: *const c_char,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn solid_engine_compile(
        engine: *mut c_void,
        source: *const u8,
        size: usize,
        name: *const c_char,
        bytecode: *mut *mut u8,
        bytecode_size: *mut usize,
    ) -> napi_status;
    pub fn solid_engine_free_bytecode(bytecode: *mut u8);
    pub fn solid_engine_drain(engine: *mut c_void) -> bool;

    pub fn napi_create_object(env: napi_env, result: *mut napi_value) -> napi_status;
    pub fn napi_create_double(env: napi_env, value: f64, result: *mut napi_value) -> napi_status;
    pub fn napi_create_string_utf8(
        env: napi_env,
        text: *const c_char,
        length: usize,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn node_api_create_property_key_utf8(
        env: napi_env,
        text: *const c_char,
        length: usize,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_create_error(env: napi_env, code: napi_value, message: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_get_boolean(env: napi_env, value: bool, result: *mut napi_value) -> napi_status;
    pub fn napi_get_null(env: napi_env, result: *mut napi_value) -> napi_status;
    pub fn napi_get_undefined(env: napi_env, result: *mut napi_value) -> napi_status;
    pub fn napi_get_global(env: napi_env, result: *mut napi_value) -> napi_status;
    pub fn napi_typeof(env: napi_env, value: napi_value, result: *mut i32) -> napi_status;
    pub fn napi_get_value_double(env: napi_env, value: napi_value, result: *mut f64) -> napi_status;
    pub fn napi_get_value_bool(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
    pub fn napi_coerce_to_string(env: napi_env, value: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_get_value_string_utf8(
        env: napi_env,
        value: napi_value,
        buf: *mut c_char,
        bufsize: usize,
        result: *mut usize,
    ) -> napi_status;

    pub fn napi_create_reference(
        env: napi_env,
        value: napi_value,
        initial_refcount: u32,
        result: *mut napi_ref,
    ) -> napi_status;
    pub fn napi_delete_reference(env: napi_env, reference: napi_ref) -> napi_status;
    pub fn napi_get_reference_value(env: napi_env, reference: napi_ref, result: *mut napi_value) -> napi_status;
    pub fn napi_open_handle_scope(env: napi_env, result: *mut *mut c_void) -> napi_status;
    pub fn napi_close_handle_scope(env: napi_env, scope: *mut c_void) -> napi_status;

    pub fn napi_create_function(
        env: napi_env,
        utf8name: *const c_char,
        length: usize,
        cb: napi_callback,
        data: *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_call_function(
        env: napi_env,
        recv: napi_value,
        func: napi_value,
        argc: usize,
        argv: *const napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_get_cb_info(
        env: napi_env,
        cbinfo: napi_callback_info,
        argc: *mut usize,
        argv: *mut napi_value,
        this_arg: *mut napi_value,
        data: *mut *mut c_void,
    ) -> napi_status;

    pub fn napi_set_named_property(
        env: napi_env,
        object: napi_value,
        utf8name: *const c_char,
        value: napi_value,
    ) -> napi_status;
    pub fn napi_get_property(env: napi_env, object: napi_value, key: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_define_properties(
        env: napi_env,
        object: napi_value,
        count: usize,
        properties: *const napi_property_descriptor,
    ) -> napi_status;
    pub fn napi_type_tag_object(env: napi_env, value: napi_value, tag: *const napi_type_tag) -> napi_status;
    pub fn napi_check_object_type_tag(
        env: napi_env,
        value: napi_value,
        tag: *const napi_type_tag,
        result: *mut bool,
    ) -> napi_status;

    pub fn napi_create_external_arraybuffer(
        env: napi_env,
        data: *mut c_void,
        byte_length: usize,
        finalize: Option<napi_finalize>,
        hint: *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_create_arraybuffer(
        env: napi_env,
        byte_length: usize,
        data: *mut *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_get_arraybuffer_info(
        env: napi_env,
        arraybuffer: napi_value,
        data: *mut *mut c_void,
        byte_length: *mut usize,
    ) -> napi_status;
    pub fn napi_detach_arraybuffer(env: napi_env, arraybuffer: napi_value) -> napi_status;
    pub fn napi_create_typedarray(
        env: napi_env,
        kind: i32,
        length: usize,
        arraybuffer: napi_value,
        byte_offset: usize,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_get_typedarray_info(
        env: napi_env,
        typedarray: napi_value,
        kind: *mut i32,
        length: *mut usize,
        data: *mut *mut c_void,
        arraybuffer: *mut napi_value,
        byte_offset: *mut usize,
    ) -> napi_status;
    pub fn napi_get_dataview_info(
        env: napi_env,
        dataview: napi_value,
        byte_length: *mut usize,
        data: *mut *mut c_void,
        arraybuffer: *mut napi_value,
        byte_offset: *mut usize,
    ) -> napi_status;

    pub fn napi_throw_error(env: napi_env, code: *const c_char, message: *const c_char) -> napi_status;
    pub fn napi_is_exception_pending(env: napi_env, result: *mut bool) -> napi_status;
    pub fn napi_get_and_clear_last_exception(env: napi_env, result: *mut napi_value) -> napi_status;
}

/// The value converted with JavaScript's `String()`.
pub unsafe fn to_string(env: napi_env, value: napi_value) -> String {
    let mut text = ptr::null_mut();
    if napi_coerce_to_string(env, value, &mut text) != NAPI_OK {
        let mut ignored = ptr::null_mut();
        napi_get_and_clear_last_exception(env, &mut ignored);
        return String::from("<unprintable>");
    }
    let mut length = 0usize;
    napi_get_value_string_utf8(env, text, ptr::null_mut(), 0, &mut length);
    let mut buffer = vec![0u8; length + 1];
    napi_get_value_string_utf8(env, text, buffer.as_mut_ptr().cast(), length + 1, &mut length);
    buffer.truncate(length);
    String::from_utf8_lossy(&buffer).into_owned()
}

/// A string argument, or `None` when the value is not a string. Unlike
/// `to_string` this converts nothing: a number where a path belongs is a bug
/// in the caller.
pub unsafe fn string_argument(env: napi_env, value: napi_value) -> Option<String> {
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, value, &mut kind);
    (kind == NAPI_STRING).then(|| to_string(env, value))
}

pub unsafe fn string(env: napi_env, text: &str) -> napi_value {
    let mut result = ptr::null_mut();
    napi_create_string_utf8(env, text.as_ptr().cast(), text.len(), &mut result);
    result
}

/// Adds a native function to `object` under `name`.
pub unsafe fn define_function(env: napi_env, object: napi_value, name: &CStr, callback: napi_callback) {
    define_function_with(env, object, name, callback, ptr::null_mut());
}

/// Adds a native function that receives `data` through `napi_get_cb_info`.
pub unsafe fn define_function_with(
    env: napi_env,
    object: napi_value,
    name: &CStr,
    callback: napi_callback,
    data: *mut c_void,
) {
    let mut function = ptr::null_mut();
    napi_create_function(env, name.as_ptr(), NAPI_AUTO_LENGTH, callback, data, &mut function);
    napi_set_named_property(env, object, name.as_ptr(), function);
}

/// A new plain object stored on `parent` under `name`.
pub unsafe fn define_object(env: napi_env, parent: napi_value, name: &CStr) -> napi_value {
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    napi_set_named_property(env, parent, name.as_ptr(), object);
    object
}

/// The pending JavaScript exception as text with its stack trace, clearing
/// it. An exception that is not an `Error` has no stack and prints as its
/// string value.
pub unsafe fn take_exception(env: napi_env) -> Option<String> {
    let mut pending = false;
    napi_is_exception_pending(env, &mut pending);
    if !pending {
        return None;
    }
    let mut exception = ptr::null_mut();
    napi_get_and_clear_last_exception(env, &mut exception);
    let mut stack = ptr::null_mut();
    let mut key = ptr::null_mut();
    node_api_create_property_key_utf8(env, c"stack".as_ptr(), NAPI_AUTO_LENGTH, &mut key);
    if napi_get_property(env, exception, key, &mut stack) == NAPI_OK {
        if let Some(text) = string_argument(env, stack) {
            return Some(text);
        }
    } else {
        // Reading `stack` threw (a getter, or a primitive): the value itself.
        let mut ignored = ptr::null_mut();
        napi_get_and_clear_last_exception(env, &mut ignored);
    }
    Some(to_string(env, exception))
}

/// Throws a JavaScript `Error` and returns the value a native callback
/// returns when it has thrown.
pub unsafe fn throw(env: napi_env, message: &str) -> napi_value {
    let message = CString::new(message.replace('\0', " ")).unwrap();
    napi_throw_error(env, ptr::null(), message.as_ptr());
    ptr::null_mut()
}

/// A number argument, or `fallback` when it is missing or not a number.
pub unsafe fn number_or(env: napi_env, value: napi_value, fallback: f64) -> f64 {
    let mut number = fallback;
    if value.is_null() || napi_get_value_double(env, value, &mut number) != NAPI_OK {
        return fallback;
    }
    number
}

pub unsafe fn number(env: napi_env, value: f64) -> napi_value {
    let mut result = ptr::null_mut();
    napi_create_double(env, value, &mut result);
    result
}

pub unsafe fn boolean(env: napi_env, value: bool) -> napi_value {
    let mut result = ptr::null_mut();
    napi_get_boolean(env, value, &mut result);
    result
}

pub unsafe fn undefined(env: napi_env) -> napi_value {
    let mut result = ptr::null_mut();
    napi_get_undefined(env, &mut result);
    result
}

pub unsafe fn null(env: napi_env) -> napi_value {
    let mut result = ptr::null_mut();
    napi_get_null(env, &mut result);
    result
}

/// A strong reference: keeps a JavaScript value alive across calls.
pub unsafe fn reference(env: napi_env, value: napi_value) -> napi_ref {
    let mut reference = ptr::null_mut();
    napi_create_reference(env, value, 1, &mut reference);
    reference
}

pub unsafe fn dereference(env: napi_env, reference: napi_ref) -> napi_value {
    let mut value = ptr::null_mut();
    napi_get_reference_value(env, reference, &mut value);
    value
}

unsafe extern "C" fn release_bytes(_env: napi_env, data: *mut c_void, length: *mut c_void) {
    drop(Box::from_raw(ptr::slice_from_raw_parts_mut(data.cast::<u8>(), length as usize)));
}

/// An `ArrayBuffer` over `bytes`, which it takes over without copying: they
/// are freed when the buffer is collected or detached.
pub unsafe fn adopt_bytes(env: napi_env, bytes: Vec<u8>) -> napi_value {
    let mut buffer = ptr::null_mut();
    if bytes.is_empty() {
        napi_create_arraybuffer(env, 0, ptr::null_mut(), &mut buffer);
        return buffer;
    }
    let bytes = Box::into_raw(bytes.into_boxed_slice());
    napi_create_external_arraybuffer(
        env,
        bytes.cast(),
        bytes.len(),
        Some(release_bytes),
        bytes.len() as *mut c_void,
        &mut buffer,
    );
    buffer
}

/// A JavaScript `Error` with `message`.
pub unsafe fn error(env: napi_env, message: &str) -> napi_value {
    let mut result = ptr::null_mut();
    napi_create_error(env, ptr::null_mut(), string(env, message), &mut result);
    result
}

/// The bytes of a typed array, a `DataView` or an `ArrayBuffer`, in place:
/// nothing is copied. `None` for any other value. The pointer is valid until
/// JavaScript runs again.
pub unsafe fn bytes_of(env: napi_env, value: napi_value) -> Option<(*mut u8, usize)> {
    if let Some((data, length, kind)) = typed_array(env, value) {
        return Some((data, length * element_size(kind)));
    }
    let mut data = ptr::null_mut();
    let mut length = 0usize;
    if napi_get_dataview_info(env, value, &mut length, &mut data, ptr::null_mut(), ptr::null_mut()) == NAPI_OK
        || napi_get_arraybuffer_info(env, value, &mut data, &mut length) == NAPI_OK
    {
        return Some((data.cast(), if data.is_null() { 0 } else { length }));
    }
    None
}

/// A typed array's storage in place: `(data, element count, element type)`.
pub unsafe fn typed_array(env: napi_env, value: napi_value) -> Option<(*mut u8, usize, i32)> {
    let mut kind = 0;
    let mut length = 0usize;
    let mut data = ptr::null_mut();
    if value.is_null()
        || napi_get_typedarray_info(env, value, &mut kind, &mut length, &mut data, ptr::null_mut(), ptr::null_mut())
            != NAPI_OK
    {
        return None;
    }
    // A detached array still reports the length it had, with no storage.
    if data.is_null() {
        length = 0;
    }
    Some((data.cast(), length, kind))
}

/// Bytes per element of a `napi_typedarray_type`.
fn element_size(kind: i32) -> usize {
    match kind {
        0..=2 => 1,
        3 | 4 => 2,
        5..=7 => 4,
        _ => 8,
    }
}

/// The first `N` arguments of a native call and how many were passed.
pub unsafe fn arguments_given<const N: usize>(env: napi_env, info: napi_callback_info) -> ([napi_value; N], usize) {
    let mut argc = N;
    let mut argv = [ptr::null_mut(); N];
    napi_get_cb_info(env, info, &mut argc, argv.as_mut_ptr(), ptr::null_mut(), ptr::null_mut());
    (argv, argc.min(N))
}

/// The first `N` arguments of a native call; ones not passed are `undefined`.
pub unsafe fn arguments<const N: usize>(env: napi_env, info: napi_callback_info) -> [napi_value; N] {
    arguments_given::<N>(env, info).0
}
