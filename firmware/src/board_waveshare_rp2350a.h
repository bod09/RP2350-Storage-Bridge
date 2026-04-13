#ifndef BOARD_WAVESHARE_RP2350A_H
#define BOARD_WAVESHARE_RP2350A_H

// Waveshare RP2350-USB-A
// https://www.waveshare.com/rp2350-usb-a.htm
//
// HARDWARE NOTE: Desolder R13 (1.5k pull-up on D+) for reliable USB host
// operation.  Without this, low-speed devices won't enumerate and hot-plug
// detection won't work.

// --- GPIO ---
// No 5V enable pin — USB-A VBUS is always powered
// Onboard LED is WS2812 RGB on GPIO 16 — driven via pico_status_led library
#define BOARD_HAS_WS2812            1

// --- PIO USB Host ---
#ifndef PICO_DEFAULT_PIO_USB_DP_PIN
#define PICO_DEFAULT_PIO_USB_DP_PIN 12   // PIO USB D+ (D- is implicitly GPIO 13)
#endif
#define BOARD_TUH_RHPORT            1    // Host port number (PIO USB = port 1)

#endif // BOARD_WAVESHARE_RP2350A_H
