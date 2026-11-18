// The only C++ in the runtime: Hermes exposes its VM as a C++ class, so
// creating and destroying it happens here. Everything else goes through
// Node-API, which is plain C.
#include "hermes/Public/RuntimeConfig.h"
#include "hermes/VM/Runtime.h"
#include "napi/hermes_napi.h"

#include "llvh/Support/raw_ostream.h"

#include <memory>

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

void solid_engine_destroy(SolidEngine *engine) {
  // The environment belongs to the runtime and goes with it.
  delete engine;
}

napi_status solid_engine_run(
    SolidEngine *engine,
    const uint8_t *source,
    size_t size,
    const char *name,
    napi_value *result) {
  hermes_run_script_flags flags{};
  flags.struct_size = sizeof(flags);
  return hermes_run_script(
      engine->env, source, size, nullptr, nullptr, name, &flags, result);
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
