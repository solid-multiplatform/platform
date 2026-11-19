// The only C++ in the runtime: Hermes exposes its VM as a C++ class, so
// creating it happens here, as do the two entry points Hermes
// declares with C++ linkage. Everything else goes through Node-API, which is
// plain C.
#include "hermes/Public/RuntimeConfig.h"
#include "hermes/VM/Runtime.h"
#include "napi/hermes_napi.h"
#include "napi/hermes_napi_compile.h"

#include "llvh/Support/raw_ostream.h"

#include <memory>

// Lives until the process exits, which is what frees it.
struct SolidEngine {
  std::shared_ptr<hermes::vm::Runtime> runtime;
  napi_env env;
};

extern "C" {

SolidEngine *solid_engine_create(hermes_napi_host *host) {
  auto config = hermes::vm::RuntimeConfig::Builder().build();
  auto *engine = new SolidEngine{hermes::vm::Runtime::create(config), nullptr};
  engine->env = hermes_napi_create_env(engine->runtime.get(), host);
  return engine;
}

napi_env solid_engine_env(SolidEngine *engine) {
  return engine->env;
}

// Runs JavaScript source. `source[size - 1]` must be NUL: Hermes then reads
// the buffer in place, which must stay alive until the engine is destroyed.
napi_status solid_engine_run(
    SolidEngine *engine,
    const uint8_t *source,
    size_t size,
    const char *name,
    napi_value *result) {
  hermes_run_script_flags flags{};
  flags.struct_size = sizeof(flags);
  flags.persistent = true;
  return hermes_run_script(
      engine->env, source, size, nullptr, nullptr, name, &flags, result);
}

// Runs bytecode made by solid_engine_compile. The buffer must stay alive until
// the engine is destroyed: functions are read from it when first called.
napi_status solid_engine_run_bytecode(
    SolidEngine *engine,
    const uint8_t *bytecode,
    size_t size,
    const char *name,
    napi_value *result) {
  hermes_bytecode_flags flags{};
  flags.struct_size = sizeof(flags);
  flags.persistent = true;
  return hermes_run_bytecode(
      engine->env, bytecode, size, nullptr, nullptr, name, &flags, result);
}

// Compiles source (NUL-terminated, as for solid_engine_run) to optimized
// bytecode. Free the result with solid_engine_free_bytecode.
napi_status solid_engine_compile(
    SolidEngine *engine,
    const uint8_t *source,
    size_t size,
    const char *name,
    uint8_t **bytecode,
    size_t *bytecode_size) {
  hermes_compile_flags flags{};
  flags.struct_size = sizeof(flags);
  flags.optimize = true;
  return hermes_compile_to_bytecode(
      engine->env, source, size, name, &flags, bytecode, bytecode_size);
}

void solid_engine_free_bytecode(uint8_t *bytecode) {
  hermes_free_bytecode(bytecode);
}

// Runs queued promise jobs. Hermes leaves this to the host: it must be called
// after every entry into JavaScript. Returns false if a job threw; the
// exception is printed, since nothing in JavaScript is left to catch it.
bool solid_engine_drain(SolidEngine *engine) {
  auto &runtime = *engine->runtime;
  if (runtime.drainJobs() != hermes::vm::ExecutionStatus::EXCEPTION)
    return true;
  hermes::vm::GCScope scope{runtime};
  runtime.printException(
      llvh::errs(), runtime.makeHandle(runtime.getThrownValue()));
  runtime.clearThrownValue();
  return false;
}

} // extern "C"
