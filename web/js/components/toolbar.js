import * as state from '../state.js';
import * as serial from '../serial.js';
import { $ } from '../utils/dom.js';
import { showToast } from './toast.js';
import { confirm, prompt } from './dialog.js';
import { navigateTo } from './file-browser.js';
import { openFile } from './file-viewer.js';
import { getSuspiciousFiles } from '../utils/security.js';

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

  uploadInput?.addEventListener('change', handleUploadFiles);

  document.addEventListener('download-file', (e) => {
    downloadFile(e.detail);
  });

  document.addEventListener('open-file', (e) => {
    openFile(e.detail.name, e.detail.entry);
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
  let errors = 0;
  for (const name of selected) {
    const fullPath = path === '/' ? '/' + name : path + '/' + name;
    const resp = await serial.sendCommand({ cmd: 'delete', path: fullPath });
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

  for (const name of selected) {
    const entry = entries.find(e => e.name === name);
    if (!entry || entry.type === 'd') continue;
    await downloadFile(name, entry.size);
  }
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

async function handleScan() {
  const entries = state.get('entries') || [];
  const suspicious = getSuspiciousFiles(entries);
  if (suspicious.length === 0) {
    await confirm('Security Scan', 'No suspicious files found in current directory.');
  } else {
    const list = suspicious.map(s => `\u2022 ${s.name}: ${s.reason}`).join('\n');
    await confirm('Security Scan',
      `Found ${suspicious.length} suspicious file(s):\n\n${list}`);
  }
}
