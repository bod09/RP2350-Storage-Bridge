#include "msc_host.h"
#include "serial_cmd.h"
#include "file_ops.h"
#include "tusb.h"
#include "ff.h"
#include "diskio.h"
#include "hardware/watchdog.h"
#include <stdio.h>
#include <string.h>

// ---- State ----
static DriveInfo drive_info;
static FATFS fatfs;

// Deferred mount/unmount (callbacks run in USB context, FatFS in main loop)
static volatile bool mount_pending = false;
static volatile bool unmount_pending = false;
static volatile uint8_t pending_dev_addr = 0;

// DiskIO busy flag (used by msc_diskio.c)
volatile bool msc_disk_busy = false;

void msc_host_init(void) {
    memset(&drive_info, 0, sizeof(drive_info));
}

const DriveInfo* msc_get_drive_info(void) {
    return &drive_info;
}

// ---- TinyUSB MSC Host Callbacks ----

void tuh_msc_mount_cb(uint8_t dev_addr) {
    pending_dev_addr = dev_addr;
    mount_pending = true;
}

void tuh_msc_umount_cb(uint8_t dev_addr) {
    (void)dev_addr;
    unmount_pending = true;
}

// ---- DiskIO completion callback ----
bool msc_disk_io_complete(uint8_t dev_addr, tuh_msc_complete_data_t const* cb_data) {
    (void)dev_addr;
    (void)cb_data;
    msc_disk_busy = false;
    return true;
}

// ---- Deferred Mount/Unmount (called from main loop) ----

static void do_mount(uint8_t dev_addr) {
    drive_info.dev_addr = dev_addr;

    // Get and validate disk geometry from untrusted device
    uint32_t block_count = tuh_msc_get_block_count(dev_addr, 0);
    uint32_t block_size = tuh_msc_get_block_size(dev_addr, 0);

    // Sanity check: block size must be 512, 1024, 2048, or 4096
    if (block_size < 512 || block_size > 4096 || (block_size & (block_size - 1)) != 0) {
        cdc_send("{\"type\":\"drive\",\"mounted\":false,\"error\":\"Invalid block size reported by device\"}\n");
        drive_info.dev_addr = 0;
        return;
    }

    // Sanity check: block count should be reasonable (max ~2TB at 512-byte sectors)
    if (block_count == 0 || block_count > 0xFFFFFFFF / block_size) {
        cdc_send("{\"type\":\"drive\",\"mounted\":false,\"error\":\"Invalid capacity reported by device\"}\n");
        drive_info.dev_addr = 0;
        return;
    }

    // Mount FatFS
    FRESULT res = f_mount(&fatfs, "", 1);
    if (res != FR_OK) {
        char buf[128];
        snprintf(buf, sizeof(buf),
                 "{\"type\":\"drive\",\"mounted\":false,\"error\":\"Mount failed (err %d) — unsupported filesystem\"}\n",
                 (int)res);
        cdc_send(buf);
        drive_info.dev_addr = 0;
        return;
    }

    // Read volume label
    drive_info.label[0] = '\0';
    f_getlabel("", drive_info.label, NULL);

    // Determine FS type string
    switch (fatfs.fs_type) {
        case FS_FAT12: strcpy(drive_info.fs_type, "FAT12"); break;
        case FS_FAT16: strcpy(drive_info.fs_type, "FAT16"); break;
        case FS_FAT32: strcpy(drive_info.fs_type, "FAT32"); break;
#if FF_FS_EXFAT
        case FS_EXFAT: strcpy(drive_info.fs_type, "exFAT"); break;
#endif
        default:       strcpy(drive_info.fs_type, "???");   break;
    }

    // Calculate free space
    DWORD free_clusters = 0;
    FATFS* fs_ptr = NULL;
    if (f_getfree("", &free_clusters, &fs_ptr) == FR_OK) {
        uint64_t cluster_size = (uint64_t)fs_ptr->csize * block_size;
        drive_info.free_bytes = (uint64_t)free_clusters * cluster_size;
        drive_info.total_bytes = (uint64_t)(fs_ptr->n_fatent - 2) * cluster_size;
    } else {
        drive_info.total_bytes = (uint64_t)block_count * block_size;
        drive_info.free_bytes = 0;
    }

    drive_info.mounted = true;

    // Notify web app (escape label — it comes from untrusted drive)
    char safe_label[72];
    json_escape(safe_label, sizeof(safe_label), drive_info.label);

    char buf[320];
    snprintf(buf, sizeof(buf),
             "{\"type\":\"drive\",\"mounted\":true,\"label\":\"%s\",\"fs\":\"%s\","
             "\"total\":%" PRIu64 ",\"free\":%" PRIu64 "}\n",
             safe_label, drive_info.fs_type,
             drive_info.total_bytes, drive_info.free_bytes);
    cdc_write_chunked(buf, strlen(buf));
}

static void do_unmount(void) {
    f_mount(NULL, "", 0);
    memset(&drive_info, 0, sizeof(drive_info));
    cdc_send("{\"type\":\"drive\",\"mounted\":false}\n");
}

void msc_host_task(void) {
    if (unmount_pending) {
        unmount_pending = false;
        mount_pending = false;
        do_unmount();
    }
    if (mount_pending) {
        mount_pending = false;
        uint8_t addr = pending_dev_addr;
        do_mount(addr);
    }
}

bool msc_eject(void) {
    if (!drive_info.mounted) return false;
    do_unmount();
    return true;
}
