# RP2350 Storage Bridge

USB storage device file browser powered by Waveshare RP2350-USB-A and Web Serial.

## What It Does

Plug the RP2350-USB-A into a computer — it appears as a generic USB keyboard (no drivers needed). Plug a USB flash drive into the RP2350's USB-A host port. Open the web app and connect via Web Serial to get a full file browser for the attached drive.

**Supported filesystems:** FAT12, FAT16, FAT32, exFAT

## Hardware

- **Board:** [Waveshare RP2350-USB-A](https://www.waveshare.com/rp2350-usb-a.htm)
- **Chip:** RP2350 (dual-core Cortex-M33), 520KB SRAM, 2MB flash
- **Native USB (Port 0):** Device mode to PC — composite HID keyboard + CDC serial
- **PIO USB (Port 1, GPIO 12/13):** Host mode — accepts USB mass storage devices

**Note:** Desolder R13 (1.5k pull-up on D+) for reliable USB host operation.

## Architecture

```
[USB Flash Drive] --USB-A--> [RP2350-USB-A] --USB--> [PC]
                              PIO USB Host            Native USB Device
                              FatFS filesystem         CDC Serial + HID Keyboard
                                                         |
                                                    [Web Browser]
                                                    Web Serial API
                                                    File Browser UI
```

## Building Firmware

```bash
cd firmware
mkdir build && cd build
cmake ..
make -j$(nproc)
# Flash storage_bridge.uf2 to device
```

**Requirements:** ARM GCC toolchain, CMake 3.13+, Pico SDK (included as submodule)

```bash
# First time: init submodules
git submodule update --init --recursive
```

## Web App

The web app is static HTML/JS/CSS — no build step required. Serve from any web server or open `web/index.html` directly.

```bash
cd web
python3 -m http.server 8080
# Open http://localhost:8080 in Chrome/Edge
```

**Browser requirement:** Chrome or Edge (Web Serial API support)

## Serial Protocol

Newline-delimited JSON over CDC serial. Commands:

| Command | Description |
|---------|-------------|
| `{"cmd":"ls","path":"/"}` | List directory |
| `{"cmd":"read","path":"/file.txt","offset":0,"length":8192}` | Read file chunk (base64) |
| `{"cmd":"write","path":"/file.txt","offset":0,"data":"...","done":true}` | Write file chunk (base64) |
| `{"cmd":"mkdir","path":"/dir"}` | Create directory |
| `{"cmd":"delete","path":"/file.txt"}` | Delete file/directory |
| `{"cmd":"rename","from":"/old","to":"/new"}` | Rename/move |
| `{"cmd":"df"}` | Disk free space |
| `{"cmd":"eject"}` | Safe unmount |
| `{"cmd":"status"}` | Drive status |
| `{"cmd":"bootloader"}` | Reboot to UF2 bootloader |
