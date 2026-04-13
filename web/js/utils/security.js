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

function getExt(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}
