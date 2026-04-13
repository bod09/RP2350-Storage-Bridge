#include "file_ops.h"
#include "serial_cmd.h"
#include "base64.h"
#include "msc_host.h"
#include "ff.h"
#include "tusb.h"
#include "hardware/watchdog.h"
#include <stdio.h>
#include <string.h>
#include <inttypes.h>

// Shared work buffer for file I/O and base64 encoding.
// 8KB raw data + base64 overhead + JSON framing fits within serial_buf limits.
#define FILE_CHUNK_SIZE  8192
static uint8_t file_buf[FILE_CHUNK_SIZE];
static char b64_buf[BASE64_ENCODE_SIZE(FILE_CHUNK_SIZE)];

// FatFS error to string
static const char* fresult_str(FRESULT r) {
    switch (r) {
        case FR_OK:             return NULL;
        case FR_NO_FILE:
        case FR_NO_PATH:        return "File not found";
        case FR_DENIED:         return "Access denied";
        case FR_EXIST:          return "Already exists";
        case FR_WRITE_PROTECTED: return "Write protected";
        case FR_DISK_ERR:       return "Disk error";
        case FR_NOT_READY:      return "Drive not ready";
        case FR_INVALID_NAME:   return "Invalid name";
        case FR_NOT_ENOUGH_CORE: return "Out of memory";
        case FR_TOO_MANY_OPEN_FILES: return "Too many open files";
        default:                return "Unknown error";
    }
}

static void send_error(FRESULT r) {
    const char* msg = fresult_str(r);
    if (!msg) msg = "Unknown error";
    char buf[128];
    snprintf(buf, sizeof(buf), "{\"status\":\"error\",\"msg\":\"%s\"}\n", msg);
    cdc_send(buf);
}

// Convert FatFS date/time to Unix-ish timestamp (seconds since 2000-01-01)
// Good enough for sorting in the webapp
static uint32_t fattime_to_epoch(WORD fdate, WORD ftime) {
    // FatFS date: bits 15-9=year(0=1980), 8-5=month, 4-0=day
    // FatFS time: bits 15-11=hour, 10-5=min, 4-0=sec/2
    uint32_t year = ((fdate >> 9) & 0x7F) + 1980;
    uint32_t month = (fdate >> 5) & 0x0F;
    uint32_t day = fdate & 0x1F;
    uint32_t hour = (ftime >> 11) & 0x1F;
    uint32_t min = (ftime >> 5) & 0x3F;
    uint32_t sec = (ftime & 0x1F) * 2;

    // Rough Unix timestamp (not leap-second-accurate, but fine for sorting)
    static const uint16_t mdays[] = {0,31,59,90,120,151,181,212,243,273,304,334};
    uint32_t days = (year - 1970) * 365 + (year - 1969) / 4;
    if (month >= 1 && month <= 12) days += mdays[month - 1];
    days += day - 1;
    if (month > 2 && (year % 4 == 0)) days++;  // leap year adjustment
    return days * 86400 + hour * 3600 + min * 60 + sec;
}

void file_op_ls(const char* path) {
    DIR dir;
    FRESULT res = f_opendir(&dir, path);
    if (res != FR_OK) { send_error(res); return; }

    // Start JSON response
    char hdr[320];
    // Escape the path for JSON
    snprintf(hdr, sizeof(hdr), "{\"type\":\"ls\",\"path\":\"%s\",\"entries\":[", path);
    cdc_write_chunked(hdr, strlen(hdr));

    FILINFO fno;
    bool first = true;
    while (f_readdir(&dir, &fno) == FR_OK && fno.fname[0] != '\0') {
        if (fno.fname[0] == '.') continue;  // skip . and ..

        char entry[384];
        uint32_t ts = fattime_to_epoch(fno.fdate, fno.ftime);
        const char* type = (fno.fattrib & AM_DIR) ? "d" : "f";

        int len = snprintf(entry, sizeof(entry),
                           "%s{\"name\":\"%s\",\"size\":%" PRIu32 ",\"type\":\"%s\",\"modified\":%" PRIu32 "}",
                           first ? "" : ",",
                           fno.fname, (uint32_t)fno.fsize, type, ts);
        cdc_write_chunked(entry, len);
        first = false;
    }

    f_closedir(&dir);
    cdc_write_chunked("]}\n", 3);
}

void file_op_stat(const char* path) {
    FILINFO fno;
    FRESULT res = f_stat(path, &fno);
    if (res != FR_OK) { send_error(res); return; }

    uint32_t ts = fattime_to_epoch(fno.fdate, fno.ftime);
    const char* type = (fno.fattrib & AM_DIR) ? "d" : "f";

    char buf[384];
    int len = snprintf(buf, sizeof(buf),
                       "{\"type\":\"stat\",\"name\":\"%s\",\"size\":%" PRIu32 ","
                       "\"ftype\":\"%s\",\"modified\":%" PRIu32 "}\n",
                       fno.fname, (uint32_t)fno.fsize, type, ts);
    cdc_write_chunked(buf, len);
}

void file_op_mkdir(const char* path) {
    FRESULT res = f_mkdir(path);
    if (res != FR_OK) { send_error(res); return; }
    cdc_send("{\"status\":\"ok\"}\n");
}

void file_op_delete(const char* path) {
    // Try unlink first (files + empty dirs)
    FRESULT res = f_unlink(path);
    if (res != FR_OK) { send_error(res); return; }
    cdc_send("{\"status\":\"ok\"}\n");
}

void file_op_rename(const char* from, const char* to) {
    FRESULT res = f_rename(from, to);
    if (res != FR_OK) { send_error(res); return; }
    cdc_send("{\"status\":\"ok\"}\n");
}

void file_op_read(const char* path, uint32_t offset, uint32_t length) {
    FIL fil;
    FRESULT res = f_open(&fil, path, FA_READ);
    if (res != FR_OK) { send_error(res); return; }

    uint32_t fsize = f_size(&fil);

    // Clamp
    if (offset >= fsize) {
        f_close(&fil);
        char buf[128];
        snprintf(buf, sizeof(buf),
                 "{\"type\":\"read\",\"offset\":%" PRIu32 ",\"length\":0,\"data\":\"\",\"eof\":true,\"size\":%" PRIu32 "}\n",
                 offset, fsize);
        cdc_write_chunked(buf, strlen(buf));
        return;
    }

    if (length > FILE_CHUNK_SIZE) length = FILE_CHUNK_SIZE;
    if (offset + length > fsize) length = fsize - offset;

    f_lseek(&fil, offset);

    UINT bytes_read = 0;
    res = f_read(&fil, file_buf, length, &bytes_read);
    f_close(&fil);

    if (res != FR_OK) { send_error(res); return; }

    // Base64 encode
    int b64_len = base64_encode(file_buf, (int)bytes_read, b64_buf, sizeof(b64_buf));

    bool eof = (offset + bytes_read >= fsize);

    // Build response header
    char hdr[256];
    int hdr_len = snprintf(hdr, sizeof(hdr),
                           "{\"type\":\"read\",\"offset\":%" PRIu32 ",\"length\":%" PRIu32
                           ",\"eof\":%s,\"size\":%" PRIu32 ",\"data\":\"",
                           offset, (uint32_t)bytes_read,
                           eof ? "true" : "false", fsize);
    cdc_write_chunked(hdr, hdr_len);
    cdc_write_chunked(b64_buf, b64_len);
    cdc_write_chunked("\"}\n", 3);
}

void file_op_write(const char* path, uint32_t offset,
                   const uint8_t* data, uint32_t data_len, bool done) {
    // Open file: create if offset == 0, otherwise open existing
    BYTE mode = FA_WRITE;
    if (offset == 0)
        mode |= FA_CREATE_ALWAYS;
    else
        mode |= FA_OPEN_EXISTING;

    FIL fil;
    FRESULT res = f_open(&fil, path, mode);
    if (res != FR_OK) { send_error(res); return; }

    if (offset > 0) {
        res = f_lseek(&fil, offset);
        if (res != FR_OK) { f_close(&fil); send_error(res); return; }
    }

    UINT written = 0;
    res = f_write(&fil, data, data_len, &written);
    f_close(&fil);

    if (res != FR_OK) { send_error(res); return; }

    char buf[96];
    snprintf(buf, sizeof(buf),
             "{\"status\":\"ok\",\"written\":%" PRIu32 "}\n", (uint32_t)written);
    cdc_send(buf);
}

void file_op_df(void) {
    const DriveInfo* info = msc_get_drive_info();
    if (!info->mounted) {
        cdc_send("{\"status\":\"error\",\"msg\":\"No drive mounted\"}\n");
        return;
    }

    char buf[256];
    int len = snprintf(buf, sizeof(buf),
                       "{\"type\":\"df\",\"label\":\"%s\",\"fs\":\"%s\","
                       "\"total\":%" PRIu64 ",\"free\":%" PRIu64 "}\n",
                       info->label, info->fs_type,
                       info->total_bytes, info->free_bytes);
    cdc_write_chunked(buf, len);
}

#define DIRSIZE_MAX_DEPTH 8

void file_op_dirsize(const char* path) {
    DIR dir_stack[DIRSIZE_MAX_DEPTH];
    int depth = 0;
    FILINFO fno;
    char pathbuf[256];
    uint64_t total_size = 0;
    uint32_t file_count = 0;
    uint32_t dir_count = 0;
    uint32_t tick = 0;

    strncpy(pathbuf, path, sizeof(pathbuf) - 1);
    pathbuf[sizeof(pathbuf) - 1] = '\0';

    FRESULT res = f_opendir(&dir_stack[0], pathbuf);
    if (res != FR_OK) { send_error(res); return; }

    while (depth >= 0) {
        res = f_readdir(&dir_stack[depth], &fno);
        if (res != FR_OK || fno.fname[0] == '\0') {
            // End of this directory — pop
            f_closedir(&dir_stack[depth]);
            // Remove last path component
            if (depth > 0) {
                char* slash = strrchr(pathbuf, '/');
                if (slash && slash != pathbuf) *slash = '\0';
                else if (slash == pathbuf) pathbuf[1] = '\0';
            }
            depth--;
            continue;
        }

        if (fno.fname[0] == '.') continue;

        // Keep USB alive during long traversals
        if (++tick % 50 == 0) {
            watchdog_update();
            tud_task();
            tuh_task();
        }

        if (fno.fattrib & AM_DIR) {
            dir_count++;
            if (depth + 1 < DIRSIZE_MAX_DEPTH) {
                // Build child path
                size_t plen = strlen(pathbuf);
                bool needs_slash = (plen > 0 && pathbuf[plen - 1] != '/');
                int written = snprintf(pathbuf + plen, sizeof(pathbuf) - plen,
                                       "%s%s", needs_slash ? "/" : "", fno.fname);
                if (plen + written >= sizeof(pathbuf)) {
                    // Path too long, skip this subdirectory
                    continue;
                }

                depth++;
                res = f_opendir(&dir_stack[depth], pathbuf);
                if (res != FR_OK) {
                    // Can't open — undo path extension and pop
                    pathbuf[plen] = '\0';
                    depth--;
                }
            }
            // else: too deep, skip
        } else {
            total_size += (uint64_t)fno.fsize;
            file_count++;
        }
    }

    char buf[256];
    int len = snprintf(buf, sizeof(buf),
                       "{\"type\":\"dirsize\",\"path\":\"%s\",\"size\":%" PRIu64
                       ",\"files\":%" PRIu32 ",\"dirs\":%" PRIu32 "}\n",
                       path, total_size, file_count, dir_count);
    cdc_write_chunked(buf, len);
}
