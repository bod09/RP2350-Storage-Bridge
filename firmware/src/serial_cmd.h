#ifndef SERIAL_CMD_H
#define SERIAL_CMD_H

#include <stdint.h>

// Call from main loop — reads CDC data, dispatches commands
void serial_cmd_task(void);

// Send a NUL-terminated string over CDC (simple, may drop if TX full)
void cdc_send(const char* str);

// Send data over CDC in chunks with backpressure handling (safe for large payloads)
void cdc_write_chunked(const char* data, uint32_t len);

#endif // SERIAL_CMD_H
