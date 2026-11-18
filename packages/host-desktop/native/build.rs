// Compiles the C++ glue and links the Hermes libraries.
//
// HERMES_SRC is a Hermes source checkout and HERMES_BUILD its CMake build
// directory (a Release build of the `hermesvm` and `hermesNapi` targets).
use std::env;
use std::path::PathBuf;

fn main() {
    let src = PathBuf::from(env::var("HERMES_SRC").expect("set HERMES_SRC to a Hermes checkout"));
    let build = PathBuf::from(env::var("HERMES_BUILD").expect("set HERMES_BUILD to its build directory"));
    println!("cargo:rerun-if-env-changed=HERMES_SRC");
    println!("cargo:rerun-if-env-changed=HERMES_BUILD");
    println!("cargo:rerun-if-changed=src/glue.cpp");

    // The glue includes Hermes' own VM headers, so it must be compiled with
    // the flags Hermes was built with: they decide the layout of VM classes.
    // These match a default Release configuration of the static_h branch.
    let mut glue = cc::Build::new();
    glue.cpp(true)
        .std("c++17")
        .flag_if_supported("-fno-exceptions")
        .flag_if_supported("-fno-rtti")
        .flag_if_supported("-fno-strict-aliasing")
        .flag_if_supported("-w");
    for (name, value) in [
        ("NAPI_VERSION", Some("10")),
        ("NDEBUG", None),
        ("STATIC_HERMES", None),
        ("HERMES_CHECK_NATIVE_STACK", None),
        ("HERMES_ENABLE_UNICODE_REGEXP_PROPERTY_ESCAPES", None),
        ("HERMES_USE_BOOST_CONTEXT", Some("1")),
        ("HERMESVM_ALLOW_CONCURRENT_GC", None),
        ("HERMESVM_ALLOW_INLINE_ASM", None),
        ("HERMESVM_INDIRECT_THREADING", None),
        ("HERMESVM_LOG_HEAP_SEGMENT_SIZE", Some("22")),
    ] {
        glue.define(name, value);
    }
    for dir in ["include", "API", "public", "external", "external/llvh/include", "external/llvh/gen/include"] {
        glue.include(src.join(dir));
    }
    for dir in ["include", "lib/config", "external/llvh/include"] {
        glue.include(build.join(dir));
    }
    glue
        .file("src/glue.cpp")
        .compile("solid_glue");

    for dir in [
        "API/napi",
        "lib",
        "public/hermes/Public",
        "external/boost/boost_1_86_0/libs/context",
    ] {
        println!("cargo:rustc-link-search=native={}", build.join(dir).display());
    }
    for lib in ["hermesNapi", "hermesvm_a", "hermesPublic", "boost_context"] {
        println!("cargo:rustc-link-lib=static={lib}");
    }
    let target = env::var("CARGO_CFG_TARGET_OS").unwrap();
    match target.as_str() {
        "linux" => {
            for lib in ["stdc++", "pthread", "dl", "m"] {
                println!("cargo:rustc-link-lib={lib}");
            }
        }
        "macos" => {
            println!("cargo:rustc-link-lib=c++");
            println!("cargo:rustc-link-lib=framework=CoreFoundation");
        }
        _ => {}
    }
}
