//! `__solid.system`: what the machine and the system say about themselves,
//! and the one thing asked of the system, opening a URL. None of it needs a
//! window, and none of it runs until JavaScript calls it.

use crate::napi::*;
use sdl3_sys::everything::*;
use std::ffi::{CStr, CString};
use std::ptr;

unsafe fn set(env: napi_env, object: napi_value, name: &CStr, value: napi_value) {
    napi_set_named_property(env, object, name.as_ptr(), value);
}

fn first_line(path: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| line.to_owned())
}

/// The system's version as its own files give it.
fn os_version() -> Option<String> {
    if cfg!(target_os = "linux") {
        // The distribution's name and version, then the kernel's.
        let release = std::fs::read_to_string("/etc/os-release").ok().and_then(|text| {
            text.lines()
                .find_map(|line| line.strip_prefix("PRETTY_NAME="))
                .map(|name| name.trim_matches('"').to_owned())
        });
        let kernel = first_line("/proc/sys/kernel/osrelease").map(|version| format!("Linux {version}"));
        match (release, kernel) {
            (Some(release), Some(kernel)) => Some(format!("{release} ({kernel})")),
            (release, kernel) => release.or(kernel),
        }
    } else if cfg!(target_os = "macos") {
        // A property list: the string after the ProductVersion key.
        let text = std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist").ok()?;
        let after = text.split("<key>ProductVersion</key>").nth(1)?;
        let version = after.split("<string>").nth(1)?.split("</string>").next()?;
        Some(format!("macOS {version}"))
    } else {
        // Windows gives its version only through its API, which nothing
        // here links yet.
        None
    }
}

/// The machine's model, where the firmware names it.
fn model() -> Option<String> {
    if cfg!(target_os = "linux") {
        let name = first_line("/sys/devices/virtual/dmi/id/product_name")?;
        // What boards without a name say.
        let placeholder = ["System Product Name", "To Be Filled By O.E.M.", "Default string", "None"];
        (!placeholder.contains(&name.as_str())).then_some(name)
    } else {
        None
    }
}

/// `system.info()`: `{ os, arch, osVersion?, model?, memoryMb }`. `os` is
/// `linux`, `windows` or `macos`.
unsafe extern "C" fn info(env: napi_env, _info: napi_callback_info) -> napi_value {
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    set(env, object, c"os", string(env, std::env::consts::OS));
    set(env, object, c"arch", string(env, std::env::consts::ARCH));
    if let Some(version) = os_version() {
        set(env, object, c"osVersion", string(env, &version));
    }
    if let Some(model) = model() {
        set(env, object, c"model", string(env, &model));
    }
    set(env, object, c"memoryMb", number(env, SDL_GetSystemRAM() as f64));
    object
}

/// `system.power()`: `{ state, percent?, seconds? }`. `state` is `battery`,
/// `charging`, `charged`, `none` (a machine without a battery) or `unknown`
/// (the system does not say).
unsafe extern "C" fn power(env: napi_env, _info: napi_callback_info) -> napi_value {
    let (mut seconds, mut percent) = (-1, -1);
    let state = match SDL_GetPowerInfo(&mut seconds, &mut percent) {
        SDL_POWERSTATE_ON_BATTERY => "battery",
        SDL_POWERSTATE_CHARGING => "charging",
        SDL_POWERSTATE_CHARGED => "charged",
        SDL_POWERSTATE_NO_BATTERY => "none",
        _ => "unknown",
    };
    let mut object = ptr::null_mut();
    napi_create_object(env, &mut object);
    set(env, object, c"state", string(env, state));
    if percent >= 0 {
        set(env, object, c"percent", number(env, percent as f64));
    }
    if seconds >= 0 {
        set(env, object, c"seconds", number(env, seconds as f64));
    }
    object
}

/// `system.locales()`: the user's languages in order of preference, as
/// BCP 47 tags (`en-GB`). Empty when the system does not say.
unsafe extern "C" fn locales(env: napi_env, _info: napi_callback_info) -> napi_value {
    let mut array = ptr::null_mut();
    napi_create_array(env, &mut array);
    let mut count = 0;
    let list = SDL_GetPreferredLocales(&mut count);
    if list.is_null() {
        return array;
    }
    let mut index = 0u32;
    for at in 0..count.max(0) as usize {
        let locale = *list.add(at);
        if locale.is_null() || (*locale).language.is_null() {
            continue;
        }
        let mut tag = CStr::from_ptr((*locale).language).to_string_lossy().into_owned();
        if !(*locale).country.is_null() {
            tag.push('-');
            tag.push_str(&CStr::from_ptr((*locale).country).to_string_lossy());
        }
        napi_set_element(env, array, index, string(env, &tag));
        index += 1;
    }
    SDL_free(list.cast());
    array
}

/// `system.openURL(url)`: hands the URL to the system (its browser, its mail
/// program). Only `http:`, `https:` and `mailto:` are passed on: a `file:`
/// URL or a program's own scheme would let a page of text start anything.
unsafe extern "C" fn open_url(env: napi_env, info: napi_callback_info) -> napi_value {
    let [url] = arguments::<1>(env, info);
    let Some(url) = string_argument(env, url) else {
        return throw(env, "openURL: the URL must be a string");
    };
    let scheme = url.split(':').next().unwrap_or_default().to_ascii_lowercase();
    if !["http", "https", "mailto"].contains(&scheme.as_str()) || url.chars().any(char::is_control) {
        return throw(env, "openURL: only http:, https: and mailto: URLs are opened");
    }
    let Ok(url) = CString::new(url) else {
        return throw(env, "openURL: the URL contains a NUL character");
    };
    if !SDL_OpenURL(url.as_ptr()) {
        return throw(env, &format!("openURL: {}", CStr::from_ptr(SDL_GetError()).to_string_lossy()));
    }
    undefined(env)
}

pub unsafe fn install(env: napi_env, host: napi_value) {
    let system = define_object(env, host, c"system");
    define_function(env, system, c"info", info);
    define_function(env, system, c"power", power);
    define_function(env, system, c"locales", locales);
    define_function(env, system, c"openURL", open_url);
}
