//! The part of Node-API the runtime uses, declared by hand: the functions
//! are exported by the Hermes libraries linked into this executable.
#![allow(non_camel_case_types)]

use std::ffi::{c_char, c_void, CString};
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

pub const NAPI_OK: napi_status = 0;
pub const NAPI_AUTO_LENGTH: usize = usize::MAX;

extern "C" {
    pub fn solid_engine_create(host: *mut c_void) -> *mut c_void;
    pub fn solid_engine_env(engine: *mut c_void) -> napi_env;
    pub fn solid_engine_destroy(engine: *mut c_void);
    pub fn solid_engine_run(
        engine: *mut c_void,
        source: *const u8,
        size: usize,
        name: *const c_char,
        result: *mut napi_value,
    ) -> napi_status;

    pub fn solid_engine_drain(engine: *mut c_void) -> bool;

    pub fn napi_create_object(env: napi_env, result: *mut napi_value) -> napi_status;
    pub fn napi_create_double(env: napi_env, value: f64, result: *mut napi_value) -> napi_status;
    pub fn napi_get_value_double(env: napi_env, value: napi_value, result: *mut f64) -> napi_status;
    pub fn napi_create_reference(
        env: napi_env,
        value: napi_value,
        initial_refcount: u32,
        result: *mut napi_ref,
    ) -> napi_status;
    pub fn napi_delete_reference(env: napi_env, reference: napi_ref) -> napi_status;
    pub fn napi_get_reference_value(env: napi_env, reference: napi_ref, result: *mut napi_value) -> napi_status;
    pub fn napi_call_function(
        env: napi_env,
        recv: napi_value,
        func: napi_value,
        argc: usize,
        argv: *const napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_open_handle_scope(env: napi_env, result: *mut *mut c_void) -> napi_status;
    pub fn napi_close_handle_scope(env: napi_env, scope: *mut c_void) -> napi_status;
    pub fn napi_get_global(env: napi_env, result: *mut napi_value) -> napi_status;
    pub fn napi_get_undefined(env: napi_env, result: *mut napi_value) -> napi_status;
    pub fn napi_create_function(
        env: napi_env,
        utf8name: *const c_char,
        length: usize,
        cb: napi_callback,
        data: *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_set_named_property(
        env: napi_env,
        object: napi_value,
        utf8name: *const c_char,
        value: napi_value,
    ) -> napi_status;
    pub fn napi_get_cb_info(
        env: napi_env,
        cbinfo: napi_callback_info,
        argc: *mut usize,
        argv: *mut napi_value,
        this_arg: *mut napi_value,
        data: *mut *mut c_void,
    ) -> napi_status;
    pub fn napi_coerce_to_string(env: napi_env, value: napi_value, result: *mut napi_value) -> napi_status;
    pub fn napi_get_value_string_utf8(
        env: napi_env,
        value: napi_value,
        buf: *mut c_char,
        bufsize: usize,
        result: *mut usize,
    ) -> napi_status;
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

/// Adds a native function to `object` under `name`.
pub unsafe fn define_function(env: napi_env, object: napi_value, name: &str, callback: napi_callback) {
    let name = CString::new(name).unwrap();
    let mut function = ptr::null_mut();
    napi_create_function(env, name.as_ptr(), NAPI_AUTO_LENGTH, callback, ptr::null_mut(), &mut function);
    napi_set_named_property(env, object, name.as_ptr(), function);
}

/// The pending JavaScript exception as text, clearing it.
pub unsafe fn take_exception(env: napi_env) -> Option<String> {
    let mut pending = false;
    napi_is_exception_pending(env, &mut pending);
    if !pending {
        return None;
    }
    let mut exception = ptr::null_mut();
    napi_get_and_clear_last_exception(env, &mut exception);
    Some(to_string(env, exception))
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

pub unsafe fn undefined(env: napi_env) -> napi_value {
    let mut result = ptr::null_mut();
    napi_get_undefined(env, &mut result);
    result
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
    let mut argc = N;
    let mut argv = [ptr::null_mut(); N];
    napi_get_cb_info(env, info, &mut argc, argv.as_mut_ptr(), ptr::null_mut(), ptr::null_mut());
    argv
}
