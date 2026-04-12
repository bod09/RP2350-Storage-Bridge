#ifndef MSC_HOST_H
#define MSC_HOST_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool     mounted;
    uint8_t  dev_addr;    // TinyUSB device address (1-based)
    char     label[34];   // Volume label
    char     fs_type[8];  // "FAT12", "FAT16", "FAT32", "exFAT"
    uint64_t total_bytes;
    uint64_t free_bytes;
} DriveInfo;

// Initialize MSC host state
void msc_host_init(void);

// Call from main loop — handles deferred mount/unmount events
void msc_host_task(void);

// Get current drive info (read-only pointer, always valid)
const DriveInfo* msc_get_drive_info(void);

// Safely unmount (eject) the current drive
bool msc_eject(void);

#endif // MSC_HOST_H
