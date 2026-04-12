#ifndef USB_DESCRIPTORS_H
#define USB_DESCRIPTORS_H

#include <stdint.h>

// Interface numbering for CDC + HID composite
enum {
    ITF_NUM_CDC = 0,
    ITF_NUM_CDC_DATA,
    ITF_NUM_HID,        // keyboard
    ITF_NUM_TOTAL
};

#define HID_INST_KEYBOARD   0

#endif // USB_DESCRIPTORS_H
