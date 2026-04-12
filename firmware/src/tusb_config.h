#ifndef TUSB_CONFIG_H
#define TUSB_CONFIG_H

#include "board.h"

// ---- Device Side (Port 0: native USB to PC) ----
#define CFG_TUSB_RHPORT0_MODE       (OPT_MODE_DEVICE | OPT_MODE_FULL_SPEED)
#define CFG_TUD_ENDPOINT0_SIZE      64

// CDC (serial for web app) + HID (keyboard — just enough to be recognized)
#define CFG_TUD_CDC                 1
#define CFG_TUD_HID                 1
#define CFG_TUD_MSC                 0
#define CFG_TUD_MIDI                0
#define CFG_TUD_VENDOR              0

#define CFG_TUD_CDC_RX_BUFSIZE      512
#define CFG_TUD_CDC_TX_BUFSIZE      512
#define CFG_TUD_HID_EP_BUFSIZE      16

// ---- Host Side (Port 1: PIO USB — accepts USB mass storage devices) ----
#define CFG_TUSB_RHPORT1_MODE       (OPT_MODE_HOST | OPT_MODE_FULL_SPEED)

#define CFG_TUH_ENUMERATION_BUFSIZE 512
#define CFG_TUH_HUB                 1   // support USB hubs (drives behind hubs)
#define CFG_TUH_HID                 0
#define CFG_TUH_CDC                 0
#define CFG_TUH_MSC                 1   // USB mass storage host
#define CFG_TUH_VENDOR              0
#define CFG_TUH_DEVICE_MAX          4
#define CFG_TUH_MSC_MAXLUN          1

// PIO-based USB host
#define CFG_TUH_RPI_PIO_USB         1

// Memory alignment
#define CFG_TUSB_MEM_SECTION
#define CFG_TUSB_MEM_ALIGN          __attribute__((aligned(4)))

#endif // TUSB_CONFIG_H
