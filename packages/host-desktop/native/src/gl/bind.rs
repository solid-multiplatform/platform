//! Turns the table in `table.rs` into code: for every entry the slot its GL
//! entry point is loaded into, and for a `direct` entry the function
//! JavaScript calls, which converts each argument and makes the call.

use crate::napi::*;

/// How one JavaScript argument becomes what the GL entry point takes. A value
/// of the wrong type converts as WebGL converts it, never by allocating.
pub trait Argument {
    type Native: Copy;
    unsafe fn read(env: napi_env, value: napi_value) -> Self::Native;
}

/// A signed integer; anything that is not a number is 0.
impl Argument for i32 {
    type Native = i32;
    #[inline(always)]
    unsafe fn read(env: napi_env, value: napi_value) -> i32 {
        number_or(env, value, 0.0) as i32
    }
}

/// An enum, a bit mask or an object name. `null` is 0, which is how WebGL
/// spells "unbind".
impl Argument for u32 {
    type Native = u32;
    #[inline(always)]
    unsafe fn read(env: napi_env, value: napi_value) -> u32 {
        number_or(env, value, 0.0) as u32
    }
}

impl Argument for f32 {
    type Native = f32;
    #[inline(always)]
    unsafe fn read(env: napi_env, value: napi_value) -> f32 {
        number_or(env, value, 0.0) as f32
    }
}

/// A `GLboolean`; a number counts as true unless it is 0.
impl Argument for bool {
    type Native = u8;
    #[inline(always)]
    unsafe fn read(env: napi_env, value: napi_value) -> u8 {
        truthy(env, value) as u8
    }
}

/// A uniform location. `null`, what `getUniformLocation` answers for a
/// uniform the program does not have, is -1, which GL ignores as WebGL does.
pub struct Location;
impl Argument for Location {
    type Native = i32;
    #[inline(always)]
    unsafe fn read(env: napi_env, value: napi_value) -> i32 {
        number_or(env, value, -1.0) as i32
    }
}

/// A byte offset into the bound buffer, which GL takes in a pointer.
pub struct Offset;
impl Argument for Offset {
    type Native = usize;
    #[inline(always)]
    unsafe fn read(env: napi_env, value: napi_value) -> usize {
        number_or(env, value, 0.0) as usize
    }
}

pub unsafe fn truthy(env: napi_env, value: napi_value) -> bool {
    let mut flag = false;
    if napi_get_value_bool(env, value, &mut flag) == NAPI_OK {
        return flag;
    }
    number_or(env, value, 0.0) != 0.0
}

/// What a GL entry point returned, as a JavaScript value.
pub trait Returned {
    unsafe fn write(self, env: napi_env) -> napi_value;
}

impl Returned for () {
    #[inline(always)]
    unsafe fn write(self, env: napi_env) -> napi_value {
        undefined(env)
    }
}

impl Returned for u32 {
    #[inline(always)]
    unsafe fn write(self, env: napi_env) -> napi_value {
        number(env, self as f64)
    }
}

macro_rules! gl_table {
    (
        raw { $( fn $raw:ident ( $( $raw_arg:ident : $raw_ty:ty ),* ) $( -> $raw_ret:ty )? ; )* }
        direct { $( $( #[$draws:ident] )? fn $js:ident = $gl:ident ( $( $arg:ident : $ty:ty ),* ) $( -> $ret:ty )? ; )* }
        custom { $( fn $custom_js:ident = $handler:path ; )* }
        unimplemented { $( $missing:ident )* }
        constants { $( $constant:ident = $value:expr ; )* }
    ) => {
        $( gl_table!(@import $raw ( $( $raw_arg : $raw_ty ),* ) $( -> $raw_ret )?); )*
        $(
            gl_table!(@import $gl ( $( $arg : <$ty as Argument>::Native ),* ) $( -> $ret )?);

            #[allow(non_snake_case)]
            unsafe extern "C" fn $js(env: napi_env, info: napi_callback_info) -> napi_value {
                let [ $( $arg ),* ] = arguments::<{ 0 $( + gl_table!(@one $arg) )* }>(env, info);
                let result = $gl( $( <$ty as Argument>::read(env, $arg) ),* );
                $( gl_table!(@flag $draws); )?
                Returned::write(result, env)
            }
        )*

        /// Loads every GL entry point the table names. `Err` names the first
        /// one the context does not have.
        pub unsafe fn load(resolve: impl Fn(&CStr) -> *const c_void) -> Result<(), &'static CStr> {
            $( gl_table!(@load resolve $raw); )*
            $( gl_table!(@load resolve $gl); )*
            Ok(())
        }

        /// Every method bound on `gl`, by its WebGL name.
        pub static FUNCTIONS: &[(&CStr, napi_callback)] = &[
            $( (gl_table!(@name $js), $js), )*
            $( (gl_table!(@name $custom_js), $handler), )*
        ];

        /// WebGL 1 methods this runtime does not implement: calling one throws
        /// with its name.
        pub static UNIMPLEMENTED: &[&CStr] = &[ $( gl_table!(@name $missing), )* ];

        pub static CONSTANTS: &[(&CStr, u32)] = &[ $( (gl_table!(@name $constant), $value), )* ];
    };

    (@import $name:ident ( $( $arg:ident : $ty:ty ),* ) $( -> $ret:ty )?) => {
        #[allow(non_snake_case)]
        mod $name {
            pub static mut ENTRY: *const std::ffi::c_void = std::ptr::null();
        }
        #[allow(non_snake_case, clippy::too_many_arguments, clippy::missing_transmute_annotations)]
        #[inline(always)]
        pub unsafe fn $name( $( $arg : $ty ),* ) $( -> $ret )? {
            let entry: unsafe extern "C" fn( $( $ty ),* ) $( -> $ret )? = std::mem::transmute($name::ENTRY);
            entry( $( $arg ),* )
        }
    };
    (@load $resolve:ident $name:ident) => {
        let name = gl_table!(@name $name);
        let entry = $resolve(name);
        if entry.is_null() {
            return Err(name);
        }
        $name::ENTRY = entry;
    };
    (@name $name:ident) => {
        // SAFETY: the literal ends in its only NUL.
        unsafe { CStr::from_bytes_with_nul_unchecked(concat!(stringify!($name), "\0").as_bytes()) }
    };
    (@one $arg:ident) => { 1 };
    (@flag draws) => { mark_drawn() };
}
