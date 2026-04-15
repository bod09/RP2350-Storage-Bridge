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

# ── FatFS setup ──────────────────────────────────────────────────────────────
# Copy FatFS sources + headers to build dir, replacing ffconf.h with our custom
# config. This is necessary because GCC's #include "..." searches the source
# file's own directory first, so the bundled ffconf.h always wins over -I paths.
set(FATFS_SRC_DIR ${PICO_SDK_PATH}/lib/tinyusb/lib/fatfs/source)
set(FATFS_BUILD_DIR ${CMAKE_CURRENT_BINARY_DIR}/fatfs)
file(MAKE_DIRECTORY ${FATFS_BUILD_DIR})

configure_file(${FATFS_SRC_DIR}/ff.c ${FATFS_BUILD_DIR}/ff.c COPYONLY)
configure_file(${FATFS_SRC_DIR}/ffunicode.c ${FATFS_BUILD_DIR}/ffunicode.c COPYONLY)
configure_file(${FATFS_SRC_DIR}/ff.h ${FATFS_BUILD_DIR}/ff.h COPYONLY)
configure_file(${FATFS_SRC_DIR}/diskio.h ${FATFS_BUILD_DIR}/diskio.h COPYONLY)
# Our custom ffconf.h replaces the bundled default
configure_file(${CMAKE_CURRENT_LIST_DIR}/src/ffconf.h ${FATFS_BUILD_DIR}/ffconf.h COPYONLY)

add_executable(storage_bridge
    src/main.c
    src/usb_descriptors.c
    src/serial_cmd.c
    src/msc_host.c
    src/msc_diskio.c
    src/file_ops.c
    src/base64.c
    src/sha256.c
    src/mpu_setup.c
    # FatFS core — compiled from build dir copy that has our ffconf.h
    ${FATFS_BUILD_DIR}/ff.c
    ${FATFS_BUILD_DIR}/ffunicode.c
)

# Include paths:
# - src/ for tusb_config.h, board.h, and project headers
# - FATFS_BUILD_DIR for ff.h, diskio.h, ffconf.h (our custom config)
target_include_directories(storage_bridge PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/src
    ${FATFS_BUILD_DIR}
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
