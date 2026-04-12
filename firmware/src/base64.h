#ifndef BASE64_H
#define BASE64_H

#include <stdint.h>

// Encode binary data to base64. Returns number of bytes written to out
// (not including NUL terminator). out is always NUL-terminated.
int base64_encode(const uint8_t* in, int in_len, char* out, int out_max);

// Decode base64 to binary data. Returns number of bytes written to out,
// or -1 on error.
int base64_decode(const char* in, int in_len, uint8_t* out, int out_max);

// Calculate the output size needed for base64 encoding (including NUL)
#define BASE64_ENCODE_SIZE(n) (((n) + 2) / 3 * 4 + 1)

#endif // BASE64_H
