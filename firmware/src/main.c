#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include "pico/stdlib.h"
#include "pico/bootrom.h"
#include "hardware/clocks.h"
#include "hardware/watchdog.h"
#include "hardware/gpio.h"
#include "tusb.h"
#include "pio_usb.h"

#include "board.h"
#if BOARD_HAS_WS2812
#include "pico/status_led.h"
#endif
#include "serial_cmd.h"
#include "msc_host.h"
#include "mpu_setup.h"

// ─── SOF Timer ─────────────────���──────────────────────────────────────────────
static repeating_timer_t sof_timer_handle;
static bool sof_timer_active = false;

static bool __not_in_flash("usb_isr") sof_callback(repeating_timer_t* rt) {
    (void)rt;
    pio_usb_host_frame();
    return true;
}

static void sof_timer_start(void) {
    if (!sof_timer_active) {
        add_repeating_timer_us(-1000, sof_callback, NULL, &sof_timer_handle);
        sof_timer_active = true;
    }
}

// Busy-wait helper: services USB + watchdog while waiting
static void wait_until(absolute_time_t end) {
    while (!time_reached(end)) {
        watchdog_update();
        tud_task();
        tuh_task();
    }
}

// ─── LED ─────────────────────────────────────────���────────────────────────────
static void update_led(void) {
#if BOARD_HAS_WS2812
    static bool last_state = false;
    static bool last_blink = false;

    const DriveInfo* info = msc_get_drive_info();
    uint32_t now = to_ms_since_boot(get_absolute_time());

    if (info->mounted) {
        // Green solid = drive mounted and ready
        if (!last_state) {
            colored_status_led_set_on_with_color(
                PICO_COLORED_STATUS_LED_COLOR_FROM_RGB(0, 0x40, 0));
            last_state = true;
            last_blink = false;
        }
    } else {
        // Blue blink = no drive connected
        bool blink = (now / 500) % 2;
        if (blink != last_blink || last_state) {
            if (blink) {
                colored_status_led_set_on_with_color(
                    PICO_COLORED_STATUS_LED_COLOR_FROM_RGB(0, 0, 0x40));
            } else {
                colored_status_led_set_state(false);
            }
            last_blink = blink;
            last_state = false;
        }
    }
#endif
}

// ─── Device-level USB Host Callbacks ─────────────────────────────────────────
void tuh_mount_cb(uint8_t dev_addr) {
    (void)dev_addr;
}

void tuh_umount_cb(uint8_t dev_addr) {
    (void)dev_addr;
}

// ─── Main ───────────────────���────────────────────────��────────────────────────
int main(void) {
    // 0. Set system clock to 120 MHz — required for PIO USB bit timing
    set_sys_clock_khz(120000, true);

    // 1. GPIO / LED init
#if BOARD_HAS_WS2812
    status_led_init();
    colored_status_led_set_state(false);
#endif

    // Enable watchdog (8 second timeout)
    watchdog_enable(8000, 1);

    // 1b. Configure MPU for W^X memory protection
    //     Must be before USB init — protects against code injection via buffer overflows
    mpu_setup();

    // 2. Init subsystems
    msc_host_init();

    // 3. PIO USB host configuration (must be before tusb_init)
    pio_usb_configuration_t pio_cfg = PIO_USB_DEFAULT_CONFIG;
    pio_cfg.pin_dp = PICO_DEFAULT_PIO_USB_DP_PIN;
    pio_cfg.skip_alarm_pool = true;
    tuh_configure(BOARD_TUH_RHPORT, TUH_CFGID_RPI_PIO_USB_CONFIGURATION, &pio_cfg);

    // 4. Start SOF timer BEFORE tusb_init — PIO USB needs this clock source
    sof_timer_start();

    // 5. Init both USB stacks (device on port 0, host on port 1)
    tusb_init();

    // 6. Main event loop
    while (true) {
        watchdog_update();

        // USB tasks
        tuh_task();
        tud_task();

        // Serial commands from web app
        serial_cmd_task();

        // MSC mount/unmount (deferred from USB callbacks)
        msc_host_task();

        // LED status
        update_led();
    }

    return 0;
}
