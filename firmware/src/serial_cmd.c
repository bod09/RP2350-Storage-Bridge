#include "serial_cmd.h"
#include "file_ops.h"
#include "msc_host.h"
#include "base64.h"
#include "tusb.h"
#include "pico/bootrom.h"
#include "hardware/watchdog.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

static char serial_buf[32768];
static int serial_buf_len = 0;

// ---- CDC helpers ----

void cdc_send(const char* str) {
    if (!tud_mounted()) return;
    tud_cdc_write_str(str);
    tud_cdc_write_flush();
    tud_task();
}

void cdc_write_chunked(const char* data, uint32_t len) {
    if (!tud_mounted()) return;
    uint32_t sent = 0;
    while (sent < len) {
        uint32_t avail = tud_cdc_write_available();
        if (avail == 0) {
            tud_cdc_write_flush();
            watchdog_update();
            tud_task();
            tuh_task();
            continue;
        }
        uint32_t chunk = len - sent;
        if (chunk > avail) chunk = avail;
        tud_cdc_write(data + sent, chunk);
        sent += chunk;
    }
    tud_cdc_write_flush();
    tud_task();
}

// ---- Minimal JSON parsers ----

static bool json_get_string(const char* json, const char* key, char* out, int max_len) {
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char* p = strstr(json, pattern);
    if (!p) return false;
    p += strlen(pattern);
    while (*p == ' ' || *p == ':') p++;
    if (*p != '"') return false;
    p++;
    int i = 0;
    while (*p && *p != '"' && i < max_len - 1) {
        if (*p == '\\' && *(p + 1)) {
            p++;
            switch (*p) {
                case 'n': out[i++] = '\n'; break;
                case 't': out[i++] = '\t'; break;
                case '\\': out[i++] = '\\'; break;
                case '"': out[i++] = '"'; break;
                default: out[i++] = *p; break;
            }
        } else {
            out[i++] = *p;
        }
        p++;
    }
    out[i] = '\0';
    return true;
}

static bool json_get_int(const char* json, const char* key, int* out) {
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char* p = strstr(json, pattern);
    if (!p) return false;
    p += strlen(pattern);
    while (*p == ' ' || *p == ':') p++;
    if (*p == '-' || (*p >= '0' && *p <= '9')) {
        *out = atoi(p);
        return true;
    }
    return false;
}

static bool json_get_bool(const char* json, const char* key, bool* out) {
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char* p = strstr(json, pattern);
    if (!p) return false;
    p += strlen(pattern);
    while (*p == ' ' || *p == ':') p++;
    if (strncmp(p, "true", 4) == 0) { *out = true; return true; }
    if (strncmp(p, "false", 5) == 0) { *out = false; return true; }
    return false;
}

// Extract a large string value (for base64 data) — returns pointer into json
// and sets *len. Does NOT copy. Returns NULL if not found.
static const char* json_get_string_ptr(const char* json, const char* key, int* len) {
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char* p = strstr(json, pattern);
    if (!p) return NULL;
    p += strlen(pattern);
    while (*p == ' ' || *p == ':') p++;
    if (*p != '"') return NULL;
    p++;
    const char* start = p;
    while (*p && *p != '"') {
        if (*p == '\\' && *(p + 1)) p++;  // skip escaped char
        p++;
    }
    *len = (int)(p - start);
    return start;
}

// ---- Command dispatch ----

static void process_command(const char* cmd) {
    char path[256];
    char path2[256];

    // Check drive is mounted for file ops
    const DriveInfo* info = msc_get_drive_info();

    if (strstr(cmd, "\"cmd\":\"ls\"")) {
        if (!info->mounted) { cdc_send("{\"status\":\"error\",\"msg\":\"No drive\"}\n"); return; }
        path[0] = '/'; path[1] = '\0';
        json_get_string(cmd, "path", path, sizeof(path));
        file_op_ls(path);
    }
    else if (strstr(cmd, "\"cmd\":\"stat\"")) {
        if (!info->mounted) { cdc_send("{\"status\":\"error\",\"msg\":\"No drive\"}\n"); return; }
        if (!json_get_string(cmd, "path", path, sizeof(path))) {
            cdc_send("{\"status\":\"error\",\"msg\":\"Missing path\"}\n"); return;
        }
        file_op_stat(path);
    }
    else if (strstr(cmd, "\"cmd\":\"mkdir\"")) {
        if (!info->mounted) { cdc_send("{\"status\":\"error\",\"msg\":\"No drive\"}\n"); return; }
        if (!json_get_string(cmd, "path", path, sizeof(path))) {
            cdc_send("{\"status\":\"error\",\"msg\":\"Missing path\"}\n"); return;
        }
        file_op_mkdir(path);
    }
    else if (strstr(cmd, "\"cmd\":\"delete\"")) {
        if (!info->mounted) { cdc_send("{\"status\":\"error\",\"msg\":\"No drive\"}\n"); return; }
        if (!json_get_string(cmd, "path", path, sizeof(path))) {
            cdc_send("{\"status\":\"error\",\"msg\":\"Missing path\"}\n"); return;
        }
        file_op_delete(path);
    }
    else if (strstr(cmd, "\"cmd\":\"rename\"")) {
        if (!info->mounted) { cdc_send("{\"status\":\"error\",\"msg\":\"No drive\"}\n"); return; }
        if (!json_get_string(cmd, "from", path, sizeof(path)) ||
            !json_get_string(cmd, "to", path2, sizeof(path2))) {
            cdc_send("{\"status\":\"error\",\"msg\":\"Missing from/to\"}\n"); return;
        }
        file_op_rename(path, path2);
    }
    else if (strstr(cmd, "\"cmd\":\"read\"")) {
        if (!info->mounted) { cdc_send("{\"status\":\"error\",\"msg\":\"No drive\"}\n"); return; }
        if (!json_get_string(cmd, "path", path, sizeof(path))) {
            cdc_send("{\"status\":\"error\",\"msg\":\"Missing path\"}\n"); return;
        }
        int offset = 0, length = 8192;
        json_get_int(cmd, "offset", &offset);
        json_get_int(cmd, "length", &length);
        file_op_read(path, (uint32_t)offset, (uint32_t)length);
    }
    else if (strstr(cmd, "\"cmd\":\"write\"")) {
        if (!info->mounted) { cdc_send("{\"status\":\"error\",\"msg\":\"No drive\"}\n"); return; }
        if (!json_get_string(cmd, "path", path, sizeof(path))) {
            cdc_send("{\"status\":\"error\",\"msg\":\"Missing path\"}\n"); return;
        }
        int offset = 0;
        bool done = false;
        json_get_int(cmd, "offset", &offset);
        json_get_bool(cmd, "done", &done);

        // Get base64 data pointer (zero-copy from serial_buf)
        int b64_len = 0;
        const char* b64_ptr = json_get_string_ptr(cmd, "data", &b64_len);
        if (!b64_ptr || b64_len == 0) {
            cdc_send("{\"status\":\"error\",\"msg\":\"Missing data\"}\n"); return;
        }

        // Decode base64 into a static buffer
        static uint8_t write_buf[8192];
        int decoded_len = base64_decode(b64_ptr, b64_len, write_buf, sizeof(write_buf));
        if (decoded_len < 0) {
            cdc_send("{\"status\":\"error\",\"msg\":\"Base64 decode failed\"}\n"); return;
        }

        file_op_write(path, (uint32_t)offset, write_buf, (uint32_t)decoded_len, done);
    }
    else if (strstr(cmd, "\"cmd\":\"df\"")) {
        file_op_df();
    }
    else if (strstr(cmd, "\"cmd\":\"eject\"")) {
        if (msc_eject()) {
            cdc_send("{\"status\":\"ok\"}\n");
        } else {
            cdc_send("{\"status\":\"error\",\"msg\":\"No drive to eject\"}\n");
        }
    }
    else if (strstr(cmd, "\"cmd\":\"status\"")) {
        if (info->mounted) {
            char buf[256];
            snprintf(buf, sizeof(buf),
                     "{\"type\":\"drive\",\"mounted\":true,\"label\":\"%s\",\"fs\":\"%s\","
                     "\"total\":%" PRIu64 ",\"free\":%" PRIu64 "}\n",
                     info->label, info->fs_type, info->total_bytes, info->free_bytes);
            cdc_write_chunked(buf, strlen(buf));
        } else {
            cdc_send("{\"type\":\"drive\",\"mounted\":false}\n");
        }
    }
    else if (strstr(cmd, "\"cmd\":\"bootloader\"")) {
        cdc_send("{\"status\":\"rebooting\"}\n");
        tud_cdc_write_flush();
        tud_task();
        sleep_ms(50);
        watchdog_disable();
        reset_usb_boot(0, 0);
    }
    else {
        cdc_send("{\"status\":\"error\",\"msg\":\"Unknown command\"}\n");
    }
}

// ---- Main task (called from main loop) ----

void serial_cmd_task(void) {
    if (!tud_cdc_available()) return;

    // Read available data into buffer
    uint32_t avail = tud_cdc_available();
    if (avail > (uint32_t)(sizeof(serial_buf) - serial_buf_len - 1))
        avail = (uint32_t)(sizeof(serial_buf) - serial_buf_len - 1);

    if (avail == 0) {
        // Buffer full without newline — discard
        serial_buf_len = 0;
        return;
    }

    uint32_t count = tud_cdc_read(serial_buf + serial_buf_len, avail);
    serial_buf_len += count;
    serial_buf[serial_buf_len] = '\0';

    // Process complete lines
    char* nl;
    while ((nl = strchr(serial_buf, '\n')) != NULL) {
        *nl = '\0';
        if (serial_buf[0] == '{') {
            process_command(serial_buf);
        }
        // Shift remaining data
        int remaining = serial_buf_len - (int)(nl - serial_buf) - 1;
        if (remaining > 0) {
            memmove(serial_buf, nl + 1, remaining);
        }
        serial_buf_len = remaining;
        serial_buf[serial_buf_len] = '\0';
    }
}
