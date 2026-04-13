# RP2350 Storage Bridge

**Safely inspect USB drives without exposing your computer to them.**

Plug an untrusted USB flash drive into the RP2350 — not your PC. The RP2350 reads the drive's filesystem and streams file listings, previews, and downloads to your browser over a serial connection. Your computer never mounts the drive, never runs its filesystem driver, and never sees raw USB traffic from the device.

Built for incident response, security research, air-gapped environments, and anyone who wants to look before they plug in.

## Security Model

| Threat | How Storage Bridge mitigates it |
|--------|-------------------------------|
| **Autorun / malware execution** | Drive is never mounted by your PC — no autorun, no shell extensions, no thumbnail handlers |
| **Filesystem driver exploits** | Your OS filesystem drivers (NTFS, exFAT, etc.) never touch the drive. FatFS on the RP2350 parses the filesystem in an isolated environment |
| **Malicious USB device attacks** | The drive connects to the RP2350's USB host port, not your PC. Your PC only sees a standard HID keyboard + CDC serial device |
| **Content inspection** | Built-in file preview (text, images, audio, video, PDF) lets you examine contents without downloading. Magic bytes mismatch detection flags files where the extension doesn't match the actual content |
| **Suspicious file detection** | Known dangerous extensions (.exe, .bat, .ps1, .vbs, .scr, autorun.inf, etc.) are flagged with warning icons. Security scan summarizes threats in the current directory |
| **Browser sandbox** | All file rendering happens inside the browser's sandboxed environment — even if you preview a malicious file, it can't escape the browser sandbox |

### Limitations

- The RP2350 firmware itself processes USB packets and filesystem data from the untrusted drive. A sufficiently crafted drive could theoretically exploit the firmware (TinyUSB USB host stack, FatFS parser). This is not antivirus.
- Only FAT12/16/32 and exFAT filesystems are supported. NTFS, ext4, HFS+, etc. drives will not be readable.
- Magic bytes detection covers common file types but is not exhaustive. It's a best-effort heuristic, not a signature scanner.
- File preview renders content in the browser. While sandboxed, previewing untrusted HTML/SVG/JS files means executing that code in your browser's renderer.

## Features

- **File browser** — Navigate directories, upload, download, rename, delete files on the USB drive
- **File preview & edit** — Open files directly in the browser: text (with editing), images, audio, video, PDF, and hex dump for unknown formats
- **Folder sizes** — Directories show total recursive size (calculated on-device)
- **Security scanning** — Warning icons on suspicious files, magic bytes mismatch detection, one-click threat scan
- **Air-gap indicator** — Visual confirmation that the drive is accessed through the RP2350, not directly by your PC
- **PWA support** — Installable as a standalone app with offline caching

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
                                                    Content Preview
                                                    Security Scanning
```

The RP2350 acts as a hardware firewall between the untrusted USB drive and your computer. Your PC only communicates with the RP2350 over a standard serial protocol — it never has direct USB access to the drive.

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
| `{"cmd":"dirsize","path":"/dir"}` | Recursive directory size |
| `{"cmd":"df"}` | Disk free space |
| `{"cmd":"eject"}` | Safe unmount |
| `{"cmd":"status"}` | Drive status |
| `{"cmd":"bootloader"}` | Reboot to UF2 bootloader |
