#ifndef FILE_OPS_H
#define FILE_OPS_H

#include <stdint.h>
#include <stdbool.h>

// All functions write their JSON response directly to serial.
// Paths are FatFS paths (e.g., "/", "/subdir/file.txt").

void file_op_ls(const char* path);
void file_op_stat(const char* path);
void file_op_mkdir(const char* path);
void file_op_delete(const char* path);
void file_op_rename(const char* from, const char* to);
void file_op_read(const char* path, uint32_t offset, uint32_t length);
void file_op_write(const char* path, uint32_t offset,
                   const uint8_t* data, uint32_t data_len, bool done);
void file_op_df(void);
void file_op_dirsize(const char* path);
void file_op_hash(const char* path);
void file_op_delete_recursive(const char* path);
void file_op_format(void);

// Escape a string for safe JSON embedding (handles untrusted filenames/labels)
int json_escape(char* dst, int max_len, const char* src);

#endif // FILE_OPS_H
