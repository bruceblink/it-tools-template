#include <stdint.h>

#define REQUEST_CAPACITY (16u * 1024u)
#define RESULT_CAPACITY 256u
#define MAX_INPUT_VALUE 1000000u

// 请求和结果使用独立的固定缓冲区，避免在模块中导入分配器或其他宿主函数。
static uint8_t request_buffer[REQUEST_CAPACITY];
static uint8_t result_buffer[RESULT_CAPACITY];

static int read_number(const uint8_t *request, uint32_t length, uint32_t *value);
static int is_json_space(uint8_t value);
static uint32_t append_literal(uint8_t *target, uint32_t offset, const char *literal, uint32_t length);
static uint32_t append_integer(uint8_t *target, uint32_t offset, uint32_t value);
static uint64_t make_result(const char *result, uint32_t length);
static uint64_t pack_result(uint32_t pointer, uint32_t length);

// 宿主每次执行都会新建模块实例，因此固定缓冲区足以支持单次命令调用。
uint32_t alloc(uint32_t size) {
  if (size == 0u || size > REQUEST_CAPACITY) {
    return UINT32_MAX;
  }
  return (uint32_t)(uintptr_t)request_buffer;
}

// 固定缓冲区不需要回收；保留该导出以满足公开 ABI。
void free(uint32_t pointer, uint32_t length) {
  (void)pointer;
  (void)length;
}

// 读取封装请求中的 number 整数，并返回宿主工作台接受的 JSON 命令结果。
uint64_t execute(uint32_t pointer, uint32_t length) {
  if (pointer != (uint32_t)(uintptr_t)request_buffer || length > REQUEST_CAPACITY) {
    static const char invalid_request[] = "{\"kind\":\"json\",\"value\":{\"error\":\"Invalid request buffer.\"}}";
    return make_result(invalid_request, (uint32_t)(sizeof(invalid_request) - 1u));
  }

  uint32_t value = 0u;
  if (!read_number(request_buffer, length, &value)) {
    static const char error_result[] =
      "{\"kind\":\"json\",\"value\":{\"error\":\"Input number must be an integer from 0 to 1000000.\"}}";
    return make_result(error_result, (uint32_t)(sizeof(error_result) - 1u));
  }

  uint32_t offset = 0u;
  static const char prefix[] = "{\"kind\":\"json\",\"value\":{\"input\":";
  static const char middle[] = ",\"doubled\":";
  static const char suffix[] = "}}";
  offset = append_literal(result_buffer, offset, prefix, (uint32_t)(sizeof(prefix) - 1u));
  offset = append_integer(result_buffer, offset, value);
  offset = append_literal(result_buffer, offset, middle, (uint32_t)(sizeof(middle) - 1u));
  offset = append_integer(result_buffer, offset, value * 2u);
  offset = append_literal(result_buffer, offset, suffix, (uint32_t)(sizeof(suffix) - 1u));
  return pack_result((uint32_t)(uintptr_t)result_buffer, offset);
}

static int read_number(const uint8_t *request, uint32_t length, uint32_t *value) {
  static const uint8_t key[] = "\"number\":";
  const uint32_t key_length = (uint32_t)(sizeof(key) - 1u);

  for (uint32_t start = 0u; start + key_length <= length; start += 1u) {
    uint32_t matched = 0u;
    while (matched < key_length && request[start + matched] == key[matched]) {
      matched += 1u;
    }
    if (matched != key_length) {
      continue;
    }

    uint32_t cursor = start + key_length;
    while (cursor < length && is_json_space(request[cursor])) {
      cursor += 1u;
    }
    if (cursor >= length || request[cursor] < '0' || request[cursor] > '9') {
      return 0;
    }

    uint32_t parsed = 0u;
    while (cursor < length && request[cursor] >= '0' && request[cursor] <= '9') {
      const uint32_t digit = (uint32_t)(request[cursor] - '0');
      if (parsed > (MAX_INPUT_VALUE - digit) / 10u) {
        return 0;
      }
      parsed = parsed * 10u + digit;
      cursor += 1u;
    }
    if (cursor < length
      && !is_json_space(request[cursor])
      && request[cursor] != ','
      && request[cursor] != '}') {
      return 0;
    }

    *value = parsed;
    return 1;
  }
  return 0;
}

static int is_json_space(uint8_t value) {
  return value == ' ' || value == '\n' || value == '\r' || value == '\t';
}

static uint32_t append_literal(uint8_t *target, uint32_t offset, const char *literal, uint32_t length) {
  for (uint32_t index = 0u; index < length; index += 1u) {
    target[offset + index] = (uint8_t)literal[index];
  }
  return offset + length;
}

static uint32_t append_integer(uint8_t *target, uint32_t offset, uint32_t value) {
  char digits[10];
  uint32_t count = 0u;
  do {
    digits[count] = (char)('0' + value % 10u);
    count += 1u;
    value /= 10u;
  } while (value != 0u);

  while (count > 0u) {
    count -= 1u;
    target[offset] = (uint8_t)digits[count];
    offset += 1u;
  }
  return offset;
}

static uint64_t make_result(const char *result, uint32_t length) {
  const uint32_t offset = append_literal(result_buffer, 0u, result, length);
  return pack_result((uint32_t)(uintptr_t)result_buffer, offset);
}

// ABI 将结果指针放入高 32 位，将 UTF-8 JSON 字节数放入低 32 位。
static uint64_t pack_result(uint32_t pointer, uint32_t length) {
  return ((uint64_t)pointer << 32u) | (uint64_t)length;
}
