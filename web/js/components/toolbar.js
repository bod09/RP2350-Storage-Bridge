import * as state from '../state.js';
import * as serial from '../serial.js';
import { $ } from '../utils/dom.js';
import { showToast } from './toast.js';
import { confirm, prompt } from './dialog.js';
import { navigateTo } from './file-browser.js';
import { getSuspiciousFiles, getSeverity, calculateEntropy, getEntropyAssessment, generateScanReport } from '../utils/security.js';
import { createZip } from '../utils/zip.js';

let uploadInput;

export function initToolbar() {
  uploadInput = $('#uploadInput');

  $('#btnNewFolder')?.addEventListener('click', handleNewFolder);
  $('#btnUpload')?.addEventListener('click', () => uploadInput?.click());
  $('#btnDownload')?.addEventListener('click', handleDownload);
  $('#btnDelete')?.addEventListener('click', handleDelete);
  $('#btnRename')?.addEventListener('click', handleRename);
  $('#btnEject')?.addEventListener('click', handleEject);
  $('#btnRefresh')?.addEventListener('click', handleRefresh);
  $('#btnScan')?.addEventListener('click', handleScan);
  $('#btnViewMode')?.addEventListener('click', () => {
    const current = state.get('viewMode');
    state.set('viewMode', current === 'grid' ? 'list' : 'grid');
  });

  uploadInput?.addEventListener('change', handleUploadFiles);
  $('#btnFormat')?.addEventListener('click', handleFormat);

  document.addEventListener('download-file', (e) => {
    downloadFile(e.detail);
  });

  // Update button states
  state.on('selectedFiles', updateButtons);
  state.on('driveMounted', updateButtons);
  updateButtons();
}

function updateButtons() {
  const mounted = state.get('driveMounted');
  const selected = state.get('selectedFiles') || [];
  const hasSelection = selected.length > 0;

  const toggle = (id, enabled) => {
    const btn = $(`#${id}`);
    if (btn) btn.disabled = !enabled;
  };

  toggle('btnNewFolder', mounted);
  toggle('btnUpload', mounted);
  toggle('btnDownload', mounted && hasSelection);
  toggle('btnDelete', mounted && hasSelection);
  toggle('btnRename', mounted && selected.length === 1);
  toggle('btnEject', mounted);
  toggle('btnRefresh', mounted);
  toggle('btnScan', mounted);
  toggle('btnViewMode', mounted);
}

async function handleNewFolder() {
  const name = await prompt('New Folder', 'Enter folder name:', 'New Folder');
  if (!name) return;
  const path = state.get('currentPath');
  const fullPath = path === '/' ? '/' + name : path + '/' + name;
  const resp = await serial.sendCommand({ cmd: 'mkdir', path: fullPath });
  if (resp?.status === 'ok') {
    showToast('Folder created', 'success');
    navigateTo(path);
  } else {
    showToast(resp?.msg || 'Failed to create folder', 'error');
  }
}

async function handleDelete() {
  const selected = state.get('selectedFiles') || [];
  if (selected.length === 0) return;
  const ok = await confirm('Delete', `Delete ${selected.length} item(s)?`);
  if (!ok) return;

  const path = state.get('currentPath');
  const entries = state.get('entries') || [];
  let errors = 0;
  for (const name of selected) {
    const fullPath = path === '/' ? '/' + name : path + '/' + name;
    const entry = entries.find(e => e.name === name);
    const cmd = entry?.type === 'd' ? 'rmdir' : 'delete';
    const resp = await serial.sendCommand({ cmd, path: fullPath });
    if (resp?.status !== 'ok') errors++;
  }

  if (errors > 0) showToast(`${errors} item(s) failed to delete`, 'error');
  else showToast('Deleted', 'success');
  navigateTo(path);
}

async function handleRename() {
  const selected = state.get('selectedFiles') || [];
  if (selected.length !== 1) return;
  const oldName = selected[0];
  const newName = await prompt('Rename', 'Enter new name:', oldName);
  if (!newName || newName === oldName) return;

  const path = state.get('currentPath');
  const fromPath = path === '/' ? '/' + oldName : path + '/' + oldName;
  const toPath = path === '/' ? '/' + newName : path + '/' + newName;
  const resp = await serial.sendCommand({ cmd: 'rename', from: fromPath, to: toPath });
  if (resp?.status === 'ok') {
    showToast('Renamed', 'success');
    navigateTo(path);
  } else {
    showToast(resp?.msg || 'Rename failed', 'error');
  }
}

async function handleDownload() {
  const selected = state.get('selectedFiles') || [];
  const entries = state.get('entries') || [];
  const path = state.get('currentPath');

  // Filter to files only
  const files = selected.filter(name => {
    const entry = entries.find(e => e.name === name);
    return entry && entry.type !== 'd';
  });

  if (files.length === 0) return;

  // Single file: download directly
  if (files.length === 1) {
    const entry = entries.find(e => e.name === files[0]);
    await downloadFile(files[0], entry?.size);
    return;
  }

  // Multiple files: bundle as ZIP
  showToast(`Downloading ${files.length} files...`, 'info');
  const zipFiles = [];
  for (const name of files) {
    const entry = entries.find(e => e.name === name);
    const fullPath = path === '/' ? '/' + name : path + '/' + name;
    try {
      const data = await serial.readFile(fullPath, entry?.size);
      zipFiles.push({ name, data });
    } catch (e) {
      showToast(`Failed to read ${name}: ${e.message}`, 'error');
    }
  }

  if (zipFiles.length === 0) return;

  const zipData = createZip(zipFiles);
  const blob = new Blob([zipData], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `files-${new Date().toISOString().slice(0,10)}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${zipFiles.length} files as ZIP`, 'success');
}

async function downloadFile(name, size) {
  const path = state.get('currentPath');
  const fullPath = path === '/' ? '/' + name : path + '/' + name;
  try {
    const data = await serial.readFile(fullPath, size);
    // Trigger browser download
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${name}`, 'success');
  } catch (e) {
    showToast(`Download failed: ${e.message}`, 'error');
  }
}

async function handleUploadFiles(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  const path = state.get('currentPath');

  for (const file of files) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const fullPath = path === '/' ? '/' + file.name : path + '/' + file.name;
      await serial.writeFile(fullPath, data);
      showToast(`Uploaded ${file.name}`, 'success');
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, 'error');
    }
  }

  // Reset input so same file can be re-uploaded
  uploadInput.value = '';
  navigateTo(path);
}

async function handleEject() {
  const ok = await confirm('Eject Drive', 'Safely remove the USB drive?');
  if (!ok) return;
  const resp = await serial.sendCommand({ cmd: 'eject' });
  if (resp?.status === 'ok') {
    showToast('Drive ejected safely', 'success');
  } else {
    showToast(resp?.msg || 'Eject failed', 'error');
  }
}

async function handleRefresh() {
  navigateTo(state.get('currentPath'));
}

async function handleFormat() {
  if (!state.get('driveMounted')) {
    showToast('No drive connected', 'error');
    return;
  }
  const ok = await confirm('Format Drive',
    'WARNING: This will erase ALL data on the drive. This cannot be undone.\n\nAre you sure you want to format?');
  if (!ok) return;
  const ok2 = await confirm('Confirm Format', 'Type-confirm: Are you absolutely sure?');
  if (!ok2) return;

  showToast('Formatting drive...', 'info');
  const resp = await serial.sendCommand({ cmd: 'format' });
  if (resp?.status === 'ok') {
    showToast('Drive formatted successfully', 'success');
    navigateTo('/');
  } else {
    showToast(resp?.msg || 'Format failed', 'error');
  }
}

async function handleScan() {
  const doRecursive = await confirm('Security Scan', 'Scan current directory and all subdirectories?');

  showToast('Scanning...', 'info');
  const path = state.get('currentPath');
  const findings = [];
  let totalFiles = 0;

  if (doRecursive) {
    await scanDirectory(path, findings, { totalFiles: 0 });
    totalFiles = findings._totalFiles || 0;
    // Restore current directory listing
    navigateTo(path);
  } else {
    const entries = state.get('entries') || [];
    totalFiles = entries.filter(e => e.type !== 'd').length;
    const suspicious = getSuspiciousFiles(entries);
    for (const s of suspicious) {
      findings.push({
        path: (path === '/' ? '/' : path + '/') + s.name,
        severity: getSeverity(s.name),
        reason: s.reason,
      });
    }
  }

  // Show results
  if (findings.length === 0) {
    const ok = await confirm('Security Scan', `Scanned ${totalFiles} file(s). No suspicious files found.`);
  } else {
    const list = findings.map(f =>
      `[${f.severity.toUpperCase()}] ${f.path}\n  ${f.reason}`
    ).join('\n\n');

    await confirm('Security Scan',
      `Found ${findings.length} suspicious file(s) across ${totalFiles} scanned:\n\n${list}`);

    // Offer export
    const doExport = await confirm('Export Report', 'Download scan report as text file?');
    if (doExport) {
      const label = state.get('driveLabel') || 'Unknown Drive';
      const report = generateScanReport({ findings, totalFiles }, label);
      const blob = new Blob([report], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scan-report-${new Date().toISOString().slice(0,10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Report exported', 'success');
    }
  }
}

async function scanDirectory(path, findings, counter) {
  // Use sendCommand directly to avoid mutating state during recursive scan
  const resp = await serial.sendCommand({ cmd: 'ls', path });
  if (!resp || resp.type !== 'ls') return;

  const currentEntries = resp.entries || [];
  counter.totalFiles = (counter.totalFiles || 0) + currentEntries.filter(e => e.type !== 'd').length;
  findings._totalFiles = counter.totalFiles;

  const suspicious = getSuspiciousFiles(currentEntries);
  for (const s of suspicious) {
    const fullPath = (path === '/' ? '/' : path + '/') + s.name;
    findings.push({
      path: fullPath,
      severity: getSeverity(s.name),
      reason: s.reason,
    });
  }

  // Recurse into subdirectories
  const dirs = currentEntries.filter(e => e.type === 'd');
  for (const dir of dirs) {
    const dirPath = path === '/' ? '/' + dir.name : path + '/' + dir.name;
    await scanDirectory(dirPath, findings, counter);
  }
}
