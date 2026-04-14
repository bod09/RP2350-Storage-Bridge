// Magic bytes signatures for common file types
const MAGIC_BYTES = [
  { sig: [0x89, 0x50, 0x4E, 0x47], ext: ['png'], desc: 'PNG image' },
  { sig: [0xFF, 0xD8, 0xFF], ext: ['jpg', 'jpeg'], desc: 'JPEG image' },
  { sig: [0x47, 0x49, 0x46, 0x38], ext: ['gif'], desc: 'GIF image' },
  { sig: [0x25, 0x50, 0x44, 0x46], ext: ['pdf'], desc: 'PDF document' },
  { sig: [0x50, 0x4B, 0x03, 0x04], ext: ['zip', 'docx', 'xlsx', 'pptx', 'jar', 'apk'], desc: 'ZIP archive' },
  { sig: [0x4D, 0x5A], ext: ['exe', 'dll', 'sys', 'scr', 'com'], desc: 'Windows executable' },
  { sig: [0x52, 0x61, 0x72, 0x21], ext: ['rar'], desc: 'RAR archive' },
  { sig: [0x37, 0x7A, 0xBC, 0xAF], ext: ['7z'], desc: '7-Zip archive' },
  { sig: [0x49, 0x44, 0x33], ext: ['mp3'], desc: 'MP3 audio' },
  { sig: [0xFF, 0xFB], ext: ['mp3'], desc: 'MP3 audio' },
  { sig: [0x52, 0x49, 0x46, 0x46], ext: ['wav', 'avi', 'webp'], desc: 'RIFF container' },
  { sig: [0x42, 0x4D], ext: ['bmp'], desc: 'BMP image' },
  { sig: [0x1A, 0x45, 0xDF, 0xA3], ext: ['mkv', 'webm'], desc: 'Matroska/WebM' },
  { sig: [0x66, 0x74, 0x79, 0x70], ext: ['mp4', 'mov', 'm4a'], desc: 'MP4/MOV', offset: 4 },
  { sig: [0x7F, 0x45, 0x4C, 0x46], ext: ['elf', 'so', 'o'], desc: 'ELF executable' },
];

// Extensions that are potentially dangerous
const SUSPICIOUS_HIGH = new Set([
  'exe', 'scr', 'pif', 'com', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'msi', 'hta',
]);

const SUSPICIOUS_MEDIUM = new Set([
  'dll', 'sys', 'cpl', 'ocx', 'inf', 'reg', 'lnk',
]);

const AUTORUN_FILES = new Set([
  'autorun.inf', 'autoplay.inf', 'desktop.ini',
]);

export function isSuspiciousFile(name) {
  const lower = name.toLowerCase();
  if (AUTORUN_FILES.has(lower)) return true;
  const ext = getExt(lower);
  return SUSPICIOUS_HIGH.has(ext) || SUSPICIOUS_MEDIUM.has(ext);
}

export function getSeverity(name) {
  const lower = name.toLowerCase();
  if (AUTORUN_FILES.has(lower)) return 'high';
  const ext = getExt(lower);
  if (SUSPICIOUS_HIGH.has(ext)) return 'high';
  if (SUSPICIOUS_MEDIUM.has(ext)) return 'medium';
  return 'low';
}

export function checkMagicBytes(data, filename) {
  if (!data || data.length < 2) return null;
  const ext = getExt(filename.toLowerCase());
  if (!ext) return null;

  // Find what the content actually is
  let detectedType = null;
  for (const entry of MAGIC_BYTES) {
    const offset = entry.offset || 0;
    if (data.length < offset + entry.sig.length) continue;
    let match = true;
    for (let i = 0; i < entry.sig.length; i++) {
      if (data[offset + i] !== entry.sig[i]) { match = false; break; }
    }
    if (match) {
      detectedType = entry;
      break;
    }
  }

  if (!detectedType) return null;

  // Check if the extension matches the detected type
  if (detectedType.ext.includes(ext)) return null;

  // Find what extensions the file claims to be
  const claimedType = MAGIC_BYTES.find(e => e.ext.includes(ext));

  // Only flag if the extension claims a different known type
  // or if content is an executable but extension is not
  const isExecutable = detectedType.desc.includes('executable');
  if (isExecutable || claimedType) {
    return {
      mismatch: true,
      expected: claimedType ? claimedType.desc : ext.toUpperCase() + ' file',
      actual: detectedType.desc,
    };
  }

  return null;
}

export function getSuspiciousFiles(entries) {
  const results = [];
  for (const entry of entries) {
    if (entry.type === 'd') continue;
    const lower = entry.name.toLowerCase();
    if (AUTORUN_FILES.has(lower)) {
      results.push({ name: entry.name, reason: 'Autorun file - may execute automatically on some systems' });
    } else if (isSuspiciousFile(entry.name)) {
      const severity = getSeverity(entry.name);
      const reasons = {
        high: 'Executable/script file - could contain malware',
        medium: 'System file - could be used for exploitation',
      };
      results.push({ name: entry.name, reason: reasons[severity] || 'Potentially suspicious file type' });
    }
  }
  return results;
}

// Shannon entropy calculation (0-8 bits per byte)
export function calculateEntropy(data) {
  if (!data || data.length === 0) return 0;
  const freq = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) freq[data[i]]++;
  let entropy = 0;
  const len = data.length;
  for (let i = 0; i < 256; i++) {
    if (freq[i] === 0) continue;
    const p = freq[i] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function getEntropyAssessment(entropy) {
  if (entropy > 7.5) return { level: 'high', label: 'Encrypted/compressed', color: 'warning' };
  if (entropy > 6.0) return { level: 'medium', label: 'Possibly packed', color: 'info' };
  return { level: 'low', label: 'Normal', color: 'ok' };
}

// Basic EXIF parser for JPEG files
export function parseExif(data) {
  if (!data || data.length < 12) return null;
  // Check JPEG SOI
  if (data[0] !== 0xFF || data[1] !== 0xD8) return null;

  let offset = 2;
  while (offset < data.length - 4) {
    if (data[offset] !== 0xFF) break;
    const marker = data[offset + 1];
    if (marker === 0xE1) {
      // APP1 — potential EXIF
      const segLen = (data[offset + 2] << 8) | data[offset + 3];
      const segData = data.slice(offset + 4, offset + 2 + segLen);
      // Check for "Exif\0\0"
      if (segData[0] === 0x45 && segData[1] === 0x78 && segData[2] === 0x69 &&
          segData[3] === 0x66 && segData[4] === 0x00 && segData[5] === 0x00) {
        return parseExifData(segData.slice(6), offset, segLen);
      }
    }
    const len = (data[offset + 2] << 8) | data[offset + 3];
    offset += 2 + len;
  }
  return null;
}

function parseExifData(tiff, app1Offset, app1Len) {
  if (tiff.length < 8) return null;
  const le = (tiff[0] === 0x49 && tiff[1] === 0x49); // Little-endian (II)
  const r16 = (o) => le ? (tiff[o] | (tiff[o+1] << 8)) : ((tiff[o] << 8) | tiff[o+1]);
  const r32 = (o) => le
    ? (tiff[o] | (tiff[o+1] << 8) | (tiff[o+2] << 16) | ((tiff[o+3] << 24) >>> 0))
    : (((tiff[o] << 24) >>> 0) | (tiff[o+1] << 16) | (tiff[o+2] << 8) | tiff[o+3]);

  if (r16(2) !== 0x002A) return null; // TIFF magic
  const ifdOffset = r32(4);

  const tags = {};
  const TAG_NAMES = {
    0x010F: 'Make', 0x0110: 'Model', 0x0112: 'Orientation',
    0x011A: 'XResolution', 0x011B: 'YResolution',
    0x0131: 'Software', 0x0132: 'DateTime',
    0x013B: 'Artist', 0x8298: 'Copyright',
    0xA002: 'ImageWidth', 0xA003: 'ImageHeight',
    0xA420: 'ImageUniqueID', 0x9003: 'DateTimeOriginal',
    0x9004: 'DateTimeDigitized', 0x920A: 'FocalLength',
    0x829A: 'ExposureTime', 0x829D: 'FNumber',
    0x8827: 'ISO', 0xA405: 'FocalLengthIn35mm',
    0x0100: 'ImageWidth', 0x0101: 'ImageHeight',
  };

  function readIFD(offset) {
    if (offset + 2 > tiff.length) return;
    const count = r16(offset);
    for (let i = 0; i < count; i++) {
      const entryOff = offset + 2 + i * 12;
      if (entryOff + 12 > tiff.length) break;
      const tag = r16(entryOff);
      const type = r16(entryOff + 2);
      const cnt = r32(entryOff + 4);
      const valOff = entryOff + 8;
      const name = TAG_NAMES[tag];
      if (!name) continue;

      if (type === 2) { // ASCII
        let strOff = cnt > 4 ? r32(valOff) : valOff;
        if (strOff + cnt <= tiff.length) {
          let str = '';
          for (let j = 0; j < cnt - 1 && (strOff + j) < tiff.length; j++) {
            str += String.fromCharCode(tiff[strOff + j]);
          }
          tags[name] = str;
        }
      } else if (type === 3) { // SHORT
        tags[name] = r16(valOff);
      } else if (type === 4) { // LONG
        tags[name] = r32(valOff);
      } else if (type === 5) { // RATIONAL
        const ratOff = r32(valOff);
        if (ratOff + 8 <= tiff.length) {
          tags[name] = r32(ratOff) + '/' + r32(ratOff + 4);
        }
      }
    }
    // Check for EXIF sub-IFD
    for (let i = 0; i < count; i++) {
      const entryOff = offset + 2 + i * 12;
      if (entryOff + 12 > tiff.length) break;
      const tag = r16(entryOff);
      if (tag === 0x8769) { // ExifIFD pointer
        readIFD(r32(entryOff + 8));
      }
    }
  }

  readIFD(ifdOffset);

  return Object.keys(tags).length > 0
    ? { tags, app1Offset, app1Len }
    : null;
}

// Strip EXIF from JPEG — returns new Uint8Array without APP1 segment
export function stripExif(data) {
  if (!data || data.length < 4) return data;
  if (data[0] !== 0xFF || data[1] !== 0xD8) return data;

  const parts = [new Uint8Array([0xFF, 0xD8])];
  let offset = 2;

  while (offset < data.length - 1) {
    if (data[offset] !== 0xFF) break;
    const marker = data[offset + 1];

    // SOS marker — rest is image data
    if (marker === 0xDA) {
      parts.push(data.slice(offset));
      break;
    }

    const segLen = (data[offset + 2] << 8) | data[offset + 3];

    // Skip APP1 (EXIF) segments
    if (marker === 0xE1) {
      offset += 2 + segLen;
      continue;
    }

    parts.push(data.slice(offset, offset + 2 + segLen));
    offset += 2 + segLen;
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}

// Generate scan report text
export function generateScanReport(results, driveName) {
  const now = new Date().toISOString();
  let report = `Storage Bridge Security Scan Report\n`;
  report += `${'='.repeat(40)}\n`;
  report += `Drive: ${driveName}\n`;
  report += `Date: ${now}\n`;
  report += `Total files scanned: ${results.totalFiles}\n`;
  report += `Suspicious files found: ${results.findings.length}\n\n`;

  if (results.findings.length === 0) {
    report += `No suspicious files detected.\n`;
  } else {
    for (const f of results.findings) {
      report += `[${f.severity.toUpperCase()}] ${f.path}\n`;
      report += `  Reason: ${f.reason}\n`;
      if (f.entropy !== undefined) {
        report += `  Entropy: ${f.entropy.toFixed(2)} bits/byte\n`;
      }
      if (f.hash) {
        report += `  SHA-256: ${f.hash}\n`;
      }
      report += `\n`;
    }
  }

  return report;
}

function getExt(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}
