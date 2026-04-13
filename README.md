# RP2350 Storage Bridge

USB storage device file browser powered by Waveshare RP2350-USB-A and Web Serial.

## What It Does

Plug the RP2350-USB-A into a computer — it appears as a generic USB keyboard (no drivers needed). Plug a USB flash drive into the RP2350's USB-A host port. Open the web app and connect via Web Serial to get a full file browser for the attached drive.

**Supported filesystems:** FAT12, FAT16, FAT32, exFAT

## How to Access the Web App

Two options — both use the same Web Serial protocol:

1. **Hosted:** Visit the [GitHub Pages site](https://bod09.github.io/RP2350-Storage-Bridge) — works with PWA offline caching after first load.
2. **Air-gapped / restricted:** Download `storage-bridge.html` from [Actions](../../actions) artifacts and open it locally in Chrome. Works from `file://` with no internet.

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
# First time: init submodules
git submodule update --init --recursive

cd firmware
mkdir build && cd build
cmake ..
make -j$(nproc)
# Flash storage_bridge.uf2 to device
```

Pre-built UF2 files are also available from [GitHub Actions](../../actions) artifacts.

**Requirements:** ARM GCC toolchain, CMake 3.13+

## Web App

### Development (multi-file, ES modules)

```bash
cd web
python3 -m http.server 8080
# Open http://localhost:8080 in Chrome/Edge
```

### Bundled single-file (for releases / offline use)

```bash
# Requires esbuild: npm i -g esbuild
python3 tools/bundle.py
# Output: web/dist/storage-bridge.html (~37 KB)
```

**Browser requirement:** Chrome or Edge (Web Serial API support)

## CI/CD

GitHub Actions runs two independent workflows:

- **Build Firmware** (`firmware/**` changes): Compiles firmware, uploads `.uf2` and bundled web app as artifacts
- **Deploy Web App** (`web/**` changes): Deploys web app to GitHub Pages

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
