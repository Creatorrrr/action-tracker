#include <dlfcn.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef int32_t napi_status;

extern napi_status napi_get_boolean(napi_env env, bool value, napi_value *result);
extern napi_status napi_create_string_utf8(napi_env env, const char *str, size_t length, napi_value *result);
extern napi_status napi_set_named_property(napi_env env, napi_value object, const char *utf8name, napi_value value);
extern napi_status napi_throw_error(napi_env env, const char *code, const char *message);

typedef int (*sandbox_init_fn)(const char *profile, uint64_t flags, char **errorbuf);
typedef void (*sandbox_free_error_fn)(char *errorbuf);

static const char SANDBOX_PROFILE[] =
  "(version 1)\n"
  "(deny default)\n"
  "(allow file*)\n"
  "(allow mach*)\n"
  "(allow sysctl*)\n"
  "(allow signal)\n"
  "(allow network-bind (local ip \"localhost:*\"))\n"
  "(allow network-inbound (local ip \"localhost:*\"))\n";

static const char PROFILE_SHA256[] = "3590d5c646ed3ca0e1769927797a87ae49bb1ce3920e40218a547d480beef481";

__attribute__((visibility("default")))
int32_t node_api_module_get_api_version_v1(void) {
  return 10;
}

__attribute__((visibility("default")))
napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  sandbox_init_fn sandbox_init_ptr = (sandbox_init_fn)dlsym(RTLD_DEFAULT, "sandbox_init");
  sandbox_free_error_fn sandbox_free_error_ptr = (sandbox_free_error_fn)dlsym(RTLD_DEFAULT, "sandbox_free_error");
  if (sandbox_init_ptr == NULL || sandbox_free_error_ptr == NULL) {
    napi_throw_error(env, "sandbox_symbol_unavailable", "macOS sandbox symbols unavailable");
    return NULL;
  }
  char *errorbuf = NULL;
  int rc = sandbox_init_ptr(SANDBOX_PROFILE, 0, &errorbuf);
  if (rc != 0) {
    if (errorbuf != NULL) sandbox_free_error_ptr(errorbuf);
    napi_throw_error(env, "sandbox_init_failed", "fixed deny-default sandbox profile failed");
    return NULL;
  }
  if (errorbuf != NULL) sandbox_free_error_ptr(errorbuf);
  napi_value active;
  napi_value profile_hash;
  if (napi_get_boolean(env, true, &active) != 0 ||
      napi_create_string_utf8(env, PROFILE_SHA256, 64, &profile_hash) != 0 ||
      napi_set_named_property(env, exports, "active", active) != 0 ||
      napi_set_named_property(env, exports, "profileSha256", profile_hash) != 0) {
    napi_throw_error(env, "sandbox_marker_failed", "sandbox marker creation failed");
    return NULL;
  }
  return exports;
}
