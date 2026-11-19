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
    println!("cargo:rerun-if-changed=src/prelude.js");

    // The glue includes Hermes' own VM headers, so it must be compiled with
    // the flags Hermes was built with: they decide the layout of VM classes.
    // These match a default Release configuration of the static_h branch.
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let mut glue = cc::Build::new();
    // Hermes' CMake (`CMakeLists.txt`, `CMAKE_CXX_COMPILER_ID MATCHES
    // "MSVC"`) builds the VM as C++20 on MSVC because its headers use
    // designated initializers and C compound literals. C++17 is what the
    // other compilers use.
    glue.cpp(true)
        .std(if target_env == "msvc" { "c++20" } else { "c++17" })
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
        ("HERMESVM_LOG_HEAP_SEGMENT_SIZE", Some("22")),
    ] {
        glue.define(name, value);
    }
    // Hermes turns its threaded interpreter on only where the compiler has
    // computed goto: GCC and Clang do, MSVC does not. The define decides how
    // the interpreter is embedded in VM headers, so the glue must agree with
    // the Hermes build it is linked against.
    if target_env != "msvc" {
        glue.define("HERMESVM_INDIRECT_THREADING", None);
    }
    // The definitions Hermes' own CMake adds to every Windows translation
    // unit. `_WINDOWS` is the one that matters: Hermes' headers test it
    // rather than `_WIN32` (MSVC does not predefine the former), and without
    // it `hermes/Support/OSCompat.h` includes `<unistd.h>`. The `_CRT_*` and
    // `_SCL_*` ones silence MSVC's deprecation warnings, as in Hermes.
    if target_os == "windows" {
        for name in [
            "_WINDOWS",
            "_CRT_SECURE_NO_DEPRECATE",
            "_CRT_SECURE_NO_WARNINGS",
            "_CRT_NONSTDC_NO_DEPRECATE",
            "_CRT_NONSTDC_NO_WARNINGS",
            "_SCL_SECURE_NO_DEPRECATE",
            "_SCL_SECURE_NO_WARNINGS",
        ] {
            glue.define(name, None);
        }
        // Hermes' headers use C compound literals (`(SHLegacyValue){...}`),
        // which cl.exe 19.44 rejects as error C4576 even with /permissive.
        // clang-cl shares the MSVC ABI and accepts them as a Clang
        // extension; use it for the glue when it is installed (the Visual
        // Studio "C++ Clang tools" component, present on the CI runners).
        if std::process::Command::new("clang-cl").arg("--version").output().is_ok() {
            glue.compiler("clang-cl");
        }
    }
    for dir in ["include", "API", "public", "external", "external/llvh/include", "external/llvh/gen/include"] {
        glue.include(src.join(dir));
    }
    for dir in ["include", "lib/config", "external/llvh/include"] {
        glue.include(build.join(dir));
    }
    // Hermes builds its source-to-bytecode entry point (`--compile`) as a
    // separate library that the documented build does not produce, so its one
    // file is compiled here, against the same headers.
    glue.include(src.join("API/napi"));
    glue.file("src/glue.cpp")
        .file(src.join("API/napi/hermes_napi_compile.cpp"))
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
    match target_os.as_str() {
        "linux" => {
            for lib in ["stdc++", "pthread", "dl", "m"] {
                println!("cargo:rustc-link-lib={lib}");
            }
        }
        "macos" => {
            // libc++ and the two frameworks Hermes' platform layer uses
            // (CMakeLists.txt `find_library(CORE_FOUNDATION ...)`).
            for lib in ["c++", "c++abi"] {
                println!("cargo:rustc-link-lib={lib}");
            }
            for framework in ["CoreFoundation", "Foundation"] {
                println!("cargo:rustc-link-lib=framework={framework}");
            }
            // Rust links with `-nodefaultlibs`, so clang does not add
            // compiler-rt. SDL's Cocoa code uses `@available`, whose runtime
            // helper `___isPlatformVersionAtLeast` lives in clang's builtins
            // archive. Ask that same compiler where its archive is and add
            // it last, after the objects that refer to the symbol.
            let compiler = env::var("CC").unwrap_or_else(|_| "cc".to_owned());
            if let Ok(output) = std::process::Command::new(compiler).arg("--print-libgcc-file-name").output() {
                let archive = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                if let Some(directory) = std::path::Path::new(&archive).parent() {
                    println!("cargo:rustc-link-arg=-L{}", directory.display());
                    println!("cargo:rustc-link-arg=-lclang_rt.osx");
                }
            }
        }
        "windows" => {
            // The C++ standard library: Rust's MSVC target links the C
            // runtime, not this. The rest are what Hermes calls into
            // directly (`winmm` for the sampling profiler, `psapi` for
            // memory stats) or through LLVM's Windows support code.
            for lib in ["msvcprt", "winmm", "psapi", "dbghelp", "advapi32", "user32", "shell32", "ole32", "ws2_32"] {
                println!("cargo:rustc-link-lib={lib}");
            }
        }
        _ => {}
    }
}
