// FatFS disk I/O layer — bridges to TinyUSB MSC host API
// Based on TinyUSB's msc_file_explorer example

#include "tusb.h"
#include "ff.h"
#include "diskio.h"
#include "msc_host.h"
#include "hardware/watchdog.h"

// Defined in msc_host.c
extern volatile bool msc_disk_busy;
extern bool msc_disk_io_complete(uint8_t dev_addr, tuh_msc_complete_data_t const* cb_data);

static void wait_for_disk_io(void) {
    while (msc_disk_busy) {
        tuh_task();
        tud_task();
        watchdog_update();
    }
}

DSTATUS disk_status(BYTE pdrv) {
    (void)pdrv;
    const DriveInfo* info = msc_get_drive_info();
    uint8_t dev_addr = info->dev_addr;
    return (dev_addr && tuh_msc_mounted(dev_addr)) ? 0 : STA_NODISK;
}

DSTATUS disk_initialize(BYTE pdrv) {
    (void)pdrv;
    return 0;  // Already initialized by USB enumeration
}

DRESULT disk_read(BYTE pdrv, BYTE* buff, LBA_t sector, UINT count) {
    (void)pdrv;
    const DriveInfo* info = msc_get_drive_info();
    uint8_t dev_addr = info->dev_addr;
    if (!dev_addr) return RES_NOTRDY;

    msc_disk_busy = true;
    tuh_msc_read10(dev_addr, 0, buff, sector, (uint16_t)count, msc_disk_io_complete, 0);
    wait_for_disk_io();
    return RES_OK;
}

#if FF_FS_READONLY == 0
DRESULT disk_write(BYTE pdrv, const BYTE* buff, LBA_t sector, UINT count) {
    (void)pdrv;
    const DriveInfo* info = msc_get_drive_info();
    uint8_t dev_addr = info->dev_addr;
    if (!dev_addr) return RES_NOTRDY;

    msc_disk_busy = true;
    tuh_msc_write10(dev_addr, 0, buff, sector, (uint16_t)count, msc_disk_io_complete, 0);
    wait_for_disk_io();
    return RES_OK;
}
#endif

DRESULT disk_ioctl(BYTE pdrv, BYTE cmd, void* buff) {
    (void)pdrv;
    const DriveInfo* info = msc_get_drive_info();
    uint8_t dev_addr = info->dev_addr;
    if (!dev_addr) return RES_NOTRDY;

    switch (cmd) {
        case CTRL_SYNC:
            return RES_OK;  // Blocking I/O, always synced

        case GET_SECTOR_COUNT:
            *((DWORD*)buff) = (DWORD)tuh_msc_get_block_count(dev_addr, 0);
            return RES_OK;

        case GET_SECTOR_SIZE:
            *((WORD*)buff) = (WORD)tuh_msc_get_block_size(dev_addr, 0);
            return RES_OK;

        case GET_BLOCK_SIZE:
            *((DWORD*)buff) = 1;  // Erase block in sector units
            return RES_OK;

        default:
            return RES_PARERR;
    }
}
