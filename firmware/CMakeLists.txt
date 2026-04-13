cmake_minimum_required(VERSION 3.13)

# ── Board selection ──────────────────────────────────────────────────────────
set(TARGET_BOARD "waveshare_rp2350a" CACHE STRING "Target board")

if(TARGET_BOARD STREQUAL "waveshare_rp2350a")
    set(PICO_BOARD waveshare_rp2350_usb_a)
    set(PICO_PLATFORM rp2350)
else()
    message(FATAL_ERROR "Unknown TARGET_BOARD: ${TARGET_BOARD}")
endif()

# PIO USB host library
set(PICO_PIO_USB_PATH ${CMAKE_CURRENT_LIST_DIR}/Pico-PIO-USB)

set(PICO_SDK_PATH ${CMAKE_CURRENT_LIST_DIR}/pico-sdk)
include(pico_sdk_import.cmake)

project(storage_bridge C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

pico_sdk_init()

# Ensure PIO USB support target exists
if (COMMAND check_and_add_pico_pio_usb_support)
    check_and_add_pico_pio_usb_support()
endif()

# FatFS source from TinyUSB bundled copy
set(FATFS_SRC_DIR ${PICO_SDK_PATH}/lib/tinyusb/lib/fatfs/source)

add_executable(storage_bridge
    src/main.c
    src/usb_descriptors.c
    src/serial_cmd.c
    src/msc_host.c
    src/msc_diskio.c
    src/file_ops.c
    src/base64.c
    # FatFS core
    ${FATFS_SRC_DIR}/ff.c
    ${FATFS_SRC_DIR}/ffunicode.c
)

# Include paths:
# - src/ contains tusb_config.h, board.h, ffconf.h, ff.h, diskio.h
# ff.h and diskio.h are copied from FatFS source; ffconf.h is our custom config.
# We do NOT add the FatFS source dir to include paths — that would let the
# bundled ffconf.h override our settings via GCC's "same directory" search rule.
target_include_directories(storage_bridge PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/src
)

target_compile_definitions(storage_bridge PRIVATE
    PICO_DEFAULT_UART_BAUD_RATE=921600
)

# Board-specific
if(TARGET_BOARD STREQUAL "waveshare_rp2350a")
    target_compile_definitions(storage_bridge PRIVATE BOARD_WAVESHARE_RP2350A)
    target_link_libraries(storage_bridge pico_status_led)
endif()

target_link_libraries(storage_bridge
    pico_stdlib
    pico_unique_id
    tinyusb_device
    tinyusb_host
    tinyusb_board
    tinyusb_pico_pio_usb
    hardware_watchdog
    hardware_sync
)

# Disable default stdio (we use TinyUSB CDC directly)
pico_enable_stdio_usb(storage_bridge 0)
pico_enable_stdio_uart(storage_bridge 0)

# Generate UF2 output
pico_add_extra_outputs(storage_bridge)
