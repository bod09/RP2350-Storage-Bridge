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
| **Content inspection** | Built-in file preview (text, images, audio, video, PDF, hex editor) lets you examine contents without downloading. Magic bytes mismatch detection flags files where the extension doesn't match the actual content |
| **Suspicious file detection** | Known dangerous extensions (.exe, .bat, .ps1, .vbs, .scr, autorun.inf, etc.) are flagged with warning icons. Recursive security scan with exportable reports |
| **Entropy analysis** | Shannon entropy calculation flags encrypted, compressed, or packed files that may be obfuscated malware |
| **File hashing** | On-device SHA-256 hashing — verify file integrity without downloading |
| **EXIF metadata** | View and strip EXIF metadata from JPEG images — remove GPS coordinates, camera info, and other identifying data before downloading |
| **Firmware integrity** | `Verify Firmware` button computes SHA-256 of the flash image — compare against known-good hash from the build to detect tampering |
| **Input sanitization** | All data from the untrusted drive (filenames, volume labels) is JSON-escaped before transmission to prevent protocol injection |
| **Device validation** | Block size and capacity reported by USB devices are validated before mounting — rejects devices reporting impossible geometry |
| **I/O timeouts** | Disk operations have a 5-second timeout — a malicious device that stalls transfers triggers a timeout instead of hanging the firmware |
| **Memory protection (MPU)** | ARM Cortex-M33 MPU enforces W^X — flash is read-only+executable, data buffers and stack are non-executable. Buffer overflows can't inject runnable shellcode |
| **Browser sandbox** | All file rendering happens inside the browser's sandboxed environment — even if you preview a malicious file, it can't escape the browser sandbox |

### Firmware Security

The RP2350 processes USB packets from untrusted drives. Here's the realistic risk assessment:

**Can a malicious drive infect the RP2350?** It's extremely unlikely but not theoretically impossible. The attack surface is the TinyUSB USB host stack (device descriptors, MSC protocol) and FatFS (filesystem parsing of FAT/exFAT structures). Both are widely-used libraries, but all code has bugs.

**What happens if it did?** The firmware runs from flash. A power cycle always returns to the firmware image stored in flash. An attacker who achieved code execution would need to additionally call the Pico SDK flash write APIs to persist — a multi-stage attack.

**Mitigations in place:**
- 8-second watchdog timer resets the device on hangs (e.g., malicious cluster loops)
- 5-second I/O timeout on all USB transfers prevents device-side stalling
- Block size/capacity validation rejects devices with impossible geometry
- Firmware integrity check lets you verify flash hasn't been modified
- All untrusted strings (filenames, labels) are escaped before serial output
- File I/O bounds checking prevents reads beyond file/chunk boundaries
- No dynamic memory allocation (no heap exploits)
- No state from USB drives is persisted to flash
- MPU enforces W^X (Write XOR Execute) — flash is read-only+executable, BSS/heap/stack are read-write but non-executable, preventing injected shellcode from running

**What's NOT currently enabled** (available in RP2350 hardware but not yet configured):
- ARM TrustZone / SAU (Secure/Non-Secure memory partitioning)
- Secure Boot (OTP-based firmware signature verification)
- JTAG lock (debug port is accessible on board)
- Glitch detection hardware

### Limitations

- The RP2350 firmware processes USB packets and filesystem data from untrusted drives. A sufficiently crafted drive could theoretically exploit the TinyUSB host stack or FatFS parser. This is not antivirus.
- Only FAT12/16/32 and exFAT filesystems are supported. NTFS, ext4, HFS+, etc. drives will not be readable.
- Magic bytes detection covers common file types but is not exhaustive. It's a best-effort heuristic, not a signature scanner.
- File preview renders content in the browser. While sandboxed, previewing untrusted HTML/SVG/JS files means executing that code in your browser's renderer.

## Features

- **File browser** — Navigate directories with list or grid view, sortable columns (name, size, date), real-time search filter
- **File selection** — Click, Shift+click range select, Ctrl+click multi-select, Ctrl+A select all
- **File preview & edit** — Text editor with save, image viewer with zoom percentage, audio/video player, PDF viewer, fullscreen mode
- **Hex editor** — Full byte-level editor with nibble editing, arrow/tab navigation, save changes back to drive
- **Drag-and-drop upload** — Drop files onto the browser, or paste from clipboard
- **Multi-file ZIP download** — Select multiple files and download as a single ZIP archive
- **Transfer progress** — Real-time progress bar with speed display for uploads and downloads
- **Folder sizes** — Directories show total recursive size (calculated on-device)
- **SHA-256 hashing** — Compute file hashes on-device for integrity verification
- **Security scanning** — Recursive threat scan with warning icons, entropy analysis, magic bytes mismatch detection, exportable scan reports
- **EXIF viewer & stripper** — Inspect camera, GPS, and metadata tags; strip EXIF from JPEGs before downloading
- **Recursive delete** — Delete directories and all their contents in one operation
- **Format drive** — Reformat the drive from the settings page (double confirmation)
- **Firmware management** — Verify firmware integrity (SHA-256), reboot to UF2 bootloader
- **Keyboard shortcuts** — Arrow keys, Enter, Delete, Ctrl+A, Backspace, Escape navigation
- **Theme toggle** — Light, dark, and system theme with persistence
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
| `{"cmd":"stat","path":"/file.txt"}` | File/directory info (size, type, modified) |
| `{"cmd":"read","path":"/file.txt","offset":0,"length":8192}` | Read file chunk (base64) |
| `{"cmd":"write","path":"/file.txt","offset":0,"data":"...","done":true}` | Write file chunk (base64) |
| `{"cmd":"mkdir","path":"/dir"}` | Create directory |
| `{"cmd":"delete","path":"/file.txt"}` | Delete file/directory |
| `{"cmd":"rename","from":"/old","to":"/new"}` | Rename/move |
| `{"cmd":"dirsize","path":"/dir"}` | Recursive directory size |
| `{"cmd":"hash","path":"/file.txt"}` | SHA-256 file hash |
| `{"cmd":"rmdir","path":"/dir"}` | Recursive directory delete |
| `{"cmd":"format"}` | Format drive |
| `{"cmd":"df"}` | Disk free space |
| `{"cmd":"eject"}` | Safe unmount |
| `{"cmd":"status"}` | Drive status |
| `{"cmd":"fwcheck"}` | SHA-256 hash of firmware flash image |
| `{"cmd":"bootloader"}` | Reboot to UF2 bootloader |
