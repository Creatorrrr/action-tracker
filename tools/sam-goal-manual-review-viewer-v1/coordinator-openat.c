#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int32_t napi_status;
typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);

extern napi_status napi_create_function(napi_env env, const char *utf8name, size_t length, napi_callback cb, void *data, napi_value *result);
extern napi_status napi_create_int32(napi_env env, int32_t value, napi_value *result);
extern napi_status napi_get_cb_info(napi_env env, napi_callback_info info, size_t *argc, napi_value *argv, napi_value *this_arg, void **data);
extern napi_status napi_get_value_double(napi_env env, napi_value value, double *result);
extern napi_status napi_get_value_string_utf8(napi_env env, napi_value value, char *buf, size_t bufsize, size_t *result);
extern napi_status napi_set_named_property(napi_env env, napi_value object, const char *utf8name, napi_value value);
extern napi_status napi_throw_error(napi_env env, const char *code, const char *message);

static napi_value throw_code(napi_env env, const char *code) {
  napi_throw_error(env, code, code);
  return NULL;
}

static bool read_string(napi_env env, napi_value value, char *buffer, size_t capacity, size_t *length) {
  size_t needed = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &needed) != 0 || needed + 1 > capacity) return false;
  if (napi_get_value_string_utf8(env, value, buffer, capacity, length) != 0 || *length != needed) return false;
  return true;
}

static napi_value openat_read_only(napi_env env, napi_callback_info info) {
  napi_value argv[6]; size_t argc = 6;
  double dirfd_value = -1; double mode_value = -1; double uid_value = -1; double gid_value = -1;
  char name[256]; size_t name_length = 0; char expected_type[16]; size_t type_length = 0;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != 0 || argc != 6 ||
      napi_get_value_double(env, argv[0], &dirfd_value) != 0 || !isfinite(dirfd_value) || floor(dirfd_value) != dirfd_value || dirfd_value < 0 || dirfd_value > INT32_MAX ||
      !read_string(env, argv[1], name, sizeof(name), &name_length) || name_length == 0 ||
      !read_string(env, argv[2], expected_type, sizeof(expected_type), &type_length) ||
      napi_get_value_double(env, argv[3], &mode_value) != 0 || !isfinite(mode_value) || floor(mode_value) != mode_value || mode_value < 0 || mode_value > 07777 ||
      napi_get_value_double(env, argv[4], &uid_value) != 0 || !isfinite(uid_value) || floor(uid_value) != uid_value || uid_value < 0 || uid_value > UINT32_MAX ||
      napi_get_value_double(env, argv[5], &gid_value) != 0 || !isfinite(gid_value) || floor(gid_value) != gid_value || gid_value < 0 || gid_value > UINT32_MAX) return throw_code(env, "coordinator_openat_arguments_invalid");
  int32_t dirfd = (int32_t)dirfd_value; uint32_t expected_mode = (uint32_t)mode_value; uint32_t expected_uid = (uint32_t)uid_value; uint32_t expected_gid = (uint32_t)gid_value;
  if ((name_length == 1 && name[0] == '.') || (name_length == 2 && name[0] == '.' && name[1] == '.') ||
      memchr(name, '/', name_length) != NULL || memchr(name, '\\', name_length) != NULL || memchr(name, '\0', name_length) != NULL) return throw_code(env, "coordinator_openat_name_invalid");
  if (memchr(expected_type, '\0', type_length) != NULL) return throw_code(env, "coordinator_openat_type_invalid");
  bool want_regular = type_length == 7 && memcmp(expected_type, "regular", 7) == 0; bool want_directory = type_length == 9 && memcmp(expected_type, "directory", 9) == 0;
  if (!want_regular && !want_directory) return throw_code(env, "coordinator_openat_type_invalid");
  struct stat parent;
  if (fstat(dirfd, &parent) != 0 || !S_ISDIR(parent.st_mode)) return throw_code(env, "coordinator_openat_parent_invalid");
  int flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC;
#ifdef O_NONBLOCK
  flags |= O_NONBLOCK;
#endif
#ifdef O_DIRECTORY
  if (want_directory) flags |= O_DIRECTORY;
#endif
  int fd = openat(dirfd, name, flags);
  if (fd < 0) return throw_code(env, errno == ELOOP ? "coordinator_openat_symlink_forbidden" : "coordinator_openat_failed");
  struct stat held;
  if (fstat(fd, &held) != 0 || (want_regular && (!S_ISREG(held.st_mode) || held.st_nlink != 1)) ||
      (want_directory && !S_ISDIR(held.st_mode)) || (held.st_mode & 07777) != expected_mode ||
      held.st_uid != expected_uid || held.st_gid != expected_gid) {
    close(fd); return throw_code(env, "coordinator_openat_descriptor_invalid");
  }
  napi_value result;
  if (napi_create_int32(env, fd, &result) != 0) { close(fd); return throw_code(env, "coordinator_openat_result_failed"); }
  return result;
}

__attribute__((visibility("default")))
int32_t node_api_module_get_api_version_v1(void) { return 10; }

__attribute__((visibility("default")))
napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value function;
  if (napi_create_function(env, "openatReadOnly", 14, openat_read_only, NULL, &function) != 0 ||
      napi_set_named_property(env, exports, "openatReadOnly", function) != 0) return throw_code(env, "coordinator_openat_registration_failed");
  return exports;
}
