import * as state from '../state.js';
import * as serial from '../serial.js';
import { $ } from '../utils/dom.js';
import { formatFileSize } from '../utils/format.js';
import { showToast } from './toast.js';
import { confirm } from './dialog.js';
import { navigateTo } from './file-browser.js';
import { checkMagicBytes, calculateEntropy, getEntropyAssessment, parseExif, stripExif } from '../utils/security.js';

const TEXT_EXTS = new Set([
  'txt','md','json','csv','xml','yaml','yml','toml','ini','cfg','conf','log',
  'js','ts','py','c','h','cpp','hpp','java','rs','go','rb','php','sh','bat',
  'html','css','scss','less','sql','env','gitignore','dockerfile','makefile',
  'cmake','properties','gradle','sln','csproj','swift','kt','r','m','pl',
]);
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','bmp','svg','webp','ico']);
const AUDIO_EXTS = new Set(['mp3','wav','ogg','flac','aac','m4a']);
const VIDEO_EXTS = new Set(['mp4','webm','mov']);
const PDF_EXTS = new Set(['pdf']);

const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

let viewerEl, contentEl, toolbarEl;
let currentBlobUrl = null;
let currentFileName = null;
let currentCategory = null;
let currentFileData = null;
let isDirty = false;
let isEditing = false;
let zoomLevel = 1;
let hexEditData = null; // Uint8Array copy for hex editing

function getExt(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function getFileCategory(name) {
  const ext = getExt(name);
  if (TEXT_EXTS.has(ext)) return 'text';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (PDF_EXTS.has(ext)) return 'pdf';
  return 'unknown';
}

function getMimeType(name) {
  const ext = getExt(name);
  const map = {
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
    bmp:'image/bmp', svg:'image/svg+xml', webp:'image/webp', ico:'image/x-icon',
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac',
    aac:'audio/aac', m4a:'audio/mp4',
    mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
    pdf:'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

export function initFileViewer() {
  viewerEl = $('#fileViewer');
  contentEl = $('#viewerContent');
  toolbarEl = viewerEl?.querySelector('.viewer-toolbar');

  $('#viewerBack')?.addEventListener('click', closeViewer);
  $('#viewerDownload')?.addEventListener('click', handleDownload);
  $('#viewerEdit')?.addEventListener('click', startEditing);
  $('#viewerSave')?.addEventListener('click', saveFile);
  $('#viewerCancel')?.addEventListener('click', cancelEditing);
  $('#viewerZoomIn')?.addEventListener('click', () => applyZoom(zoomLevel * 1.5));
  $('#viewerZoomOut')?.addEventListener('click', () => applyZoom(zoomLevel / 1.5));
  $('#viewerFullscreen')?.addEventListener('click', toggleFullscreen);

  // Scroll-wheel zoom on images
  viewerEl?.addEventListener('wheel', (e) => {
    if (currentCategory !== 'image') return;
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.8 : 1.25;
    applyZoom(zoomLevel * delta);
  }, { passive: false });

  document.addEventListener('open-file', (e) => {
    openFile(e.detail.name, e.detail.entry);
  });

  // Hash button in viewer
  $('#viewerHash')?.addEventListener('click', handleHash);
  // EXIF strip button
  $('#viewerStripExif')?.addEventListener('click', handleStripExif);
}

export async function openFile(name, entry) {
  if (!viewerEl) return;

  const size = entry?.size || 0;
  if (size > LARGE_FILE_THRESHOLD) {
    const ok = await confirm('Large File', `This file is ${formatFileSize(size)}. Loading it may take a while. Continue?`);
    if (!ok) return;
  }

  currentFileName = name;
  currentFileData = null;
  hexEditData = null;
  isDirty = false;
  isEditing = false;
  zoomLevel = 1;
  cleanup();
  showViewer(true);

  const nameEl = $('#viewerFileName');
  if (nameEl) nameEl.textContent = name;

  currentCategory = getFileCategory(name);
  updateToolbarButtons(currentCategory, false);

  contentEl.innerHTML = '<div class="viewer-loading">Loading...</div>';

  const path = state.get('currentPath');
  const fullPath = path === '/' ? '/' + name : path + '/' + name;

  try {
    const data = await serial.readFile(fullPath, size);
    currentFileData = data;
    renderContent(name, currentCategory, data);
  } catch (e) {
    contentEl.innerHTML = `<div class="viewer-error">Failed to load file: ${escHtml(e.message)}</div>`;
  }
}

function renderContent(name, category, data) {
  contentEl.innerHTML = '';

  // Check magic bytes mismatch
  const mismatch = checkMagicBytes(data, name);
  if (mismatch) {
    const alert = document.createElement('div');
    alert.className = 'security-alert';
    alert.innerHTML = `&#9888; Extension mismatch: file extension says <strong>.${escHtml(getExt(name))}</strong> but content appears to be <strong>${escHtml(mismatch.actual)}</strong>`;
    contentEl.appendChild(alert);
  }

  // Entropy bar for binary files
  if (category !== 'text') {
    const entropy = calculateEntropy(data);
    const assessment = getEntropyAssessment(entropy);
    const entropyEl = document.createElement('div');
    entropyEl.className = `viewer-entropy entropy-${assessment.color}`;
    const pct = (entropy / 8 * 100).toFixed(1);
    entropyEl.innerHTML = `<span>Entropy: ${entropy.toFixed(2)} bits/byte (${pct}%)</span><span>${assessment.label}</span>`;
    contentEl.appendChild(entropyEl);
  }

  // EXIF info for images
  if (category === 'image') {
    const exif = parseExif(data);
    if (exif) {
      const exifEl = document.createElement('details');
      exifEl.className = 'viewer-exif';
      const entries = Object.entries(exif.tags);
      exifEl.innerHTML = `<summary>EXIF Metadata (${entries.length} tags)</summary>` +
        `<table class="exif-table">${entries.map(([k,v]) =>
          `<tr><td>${escHtml(k)}</td><td>${escHtml(String(v))}</td></tr>`
        ).join('')}</table>`;
      contentEl.appendChild(exifEl);
      // Show strip button
      const stripBtn = $('#viewerStripExif');
      if (stripBtn) stripBtn.hidden = false;
    }
  }

  switch (category) {
    case 'text': renderText(data); break;
    case 'image': renderMedia('img', name, data); break;
    case 'audio': renderMedia('audio', name, data); break;
    case 'video': renderMedia('video', name, data); break;
    case 'pdf': renderPdf(name, data); break;
    default: renderHex(data); break;
  }
}

function renderText(data) {
  const text = new TextDecoder().decode(data);
  const pre = document.createElement('pre');
  pre.className = 'viewer-text';
  pre.textContent = text;
  contentEl.appendChild(pre);
}

function renderMedia(tag, name, data) {
  const blob = new Blob([data], { type: getMimeType(name) });
  currentBlobUrl = URL.createObjectURL(blob);
  const el = document.createElement(tag);
  el.src = currentBlobUrl;
  el.className = 'viewer-media';
  if (tag === 'audio' || tag === 'video') el.controls = true;
  contentEl.appendChild(el);
}

function renderPdf(name, data) {
  const blob = new Blob([data], { type: 'application/pdf' });
  currentBlobUrl = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.src = currentBlobUrl;
  iframe.className = 'viewer-pdf';
  contentEl.appendChild(iframe);
}

function renderHex(data) {
  hexEditData = new Uint8Array(data);

  const container = document.createElement('div');
  container.className = 'hex-editor';

  const info = document.createElement('div');
  info.className = 'hex-info-bar';
  info.innerHTML = `<span>${formatFileSize(data.length)} &middot; ${data.length} bytes</span><span class="hex-cursor-pos">Offset: 0</span>`;
  container.appendChild(info);

  const table = document.createElement('div');
  table.className = 'hex-table';

  const BYTES_PER_ROW = 16;
  const totalRows = Math.ceil(data.length / BYTES_PER_ROW);

  for (let row = 0; row < totalRows; row++) {
    const offset = row * BYTES_PER_ROW;
    const line = document.createElement('div');
    line.className = 'hex-row';

    // Offset column
    const offsetEl = document.createElement('span');
    offsetEl.className = 'hex-offset';
    offsetEl.textContent = offset.toString(16).padStart(8, '0');
    line.appendChild(offsetEl);

    // Hex bytes
    const hexCells = document.createElement('span');
    hexCells.className = 'hex-cells';
    for (let col = 0; col < BYTES_PER_ROW; col++) {
      const idx = offset + col;
      const cell = document.createElement('span');
      cell.className = 'hex-cell';
      if (idx < data.length) {
        cell.textContent = hexEditData[idx].toString(16).padStart(2, '0');
        cell.dataset.offset = idx;
        cell.tabIndex = 0;
      } else {
        cell.textContent = '  ';
        cell.className = 'hex-cell hex-empty';
      }
      if (col === 7) {
        const gap = document.createElement('span');
        gap.className = 'hex-gap';
        gap.textContent = ' ';
        hexCells.appendChild(gap);
      }
      hexCells.appendChild(cell);
    }
    line.appendChild(hexCells);

    // ASCII column
    const asciiCells = document.createElement('span');
    asciiCells.className = 'hex-ascii';
    for (let col = 0; col < BYTES_PER_ROW; col++) {
      const idx = offset + col;
      const ch = document.createElement('span');
      ch.className = 'hex-ascii-char';
      if (idx < data.length) {
        const b = hexEditData[idx];
        ch.textContent = (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
        ch.dataset.offset = idx;
      } else {
        ch.textContent = ' ';
      }
      asciiCells.appendChild(ch);
    }
    line.appendChild(asciiCells);

    table.appendChild(line);
  }

  container.appendChild(table);
  contentEl.appendChild(container);

  // Hex cell editing
  let editingCell = null;
  let editNibble = 0; // 0 = high nibble, 1 = low nibble

  table.addEventListener('click', (e) => {
    const cell = e.target.closest('.hex-cell[data-offset]');
    if (!cell) return;
    selectCell(cell);
  });

  table.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.hex-cell[data-offset]');
    if (!cell) return;
    const idx = parseInt(cell.dataset.offset);

    // Hex digit input
    const hexChar = e.key.toLowerCase();
    if (/^[0-9a-f]$/.test(hexChar)) {
      e.preventDefault();
      const nibbleVal = parseInt(hexChar, 16);
      if (editNibble === 0) {
        hexEditData[idx] = (nibbleVal << 4) | (hexEditData[idx] & 0x0F);
        editNibble = 1;
      } else {
        hexEditData[idx] = (hexEditData[idx] & 0xF0) | nibbleVal;
        editNibble = 0;
        // Move to next cell
        const next = table.querySelector(`.hex-cell[data-offset="${idx + 1}"]`);
        if (next) selectCell(next);
      }
      updateCellDisplay(cell, idx);
      isDirty = true;
      return;
    }

    // Navigation
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = table.querySelector(`.hex-cell[data-offset="${idx + 1}"]`);
      if (next) selectCell(next);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (idx > 0) {
        const prev = table.querySelector(`.hex-cell[data-offset="${idx - 1}"]`);
        if (prev) selectCell(prev);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const below = table.querySelector(`.hex-cell[data-offset="${idx + 16}"]`);
      if (below) selectCell(below);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx >= 16) {
        const above = table.querySelector(`.hex-cell[data-offset="${idx - 16}"]`);
        if (above) selectCell(above);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const next = table.querySelector(`.hex-cell[data-offset="${idx + (e.shiftKey ? -1 : 1)}"]`);
      if (next) selectCell(next);
    }
  });

  function selectCell(cell) {
    if (editingCell) editingCell.classList.remove('hex-active');
    editingCell = cell;
    editNibble = 0;
    cell.classList.add('hex-active');
    cell.focus();
    const idx = parseInt(cell.dataset.offset);
    const posEl = container.querySelector('.hex-cursor-pos');
    if (posEl) posEl.textContent = `Offset: 0x${idx.toString(16).toUpperCase()} (${idx})`;
    // Highlight corresponding ASCII
    table.querySelectorAll('.hex-ascii-char.hex-active').forEach(el => el.classList.remove('hex-active'));
    const ascii = table.querySelector(`.hex-ascii-char[data-offset="${idx}"]`);
    if (ascii) ascii.classList.add('hex-active');
  }

  function updateCellDisplay(cell, idx) {
    cell.textContent = hexEditData[idx].toString(16).padStart(2, '0');
    cell.classList.add('hex-modified');
    const b = hexEditData[idx];
    const ascii = table.querySelector(`.hex-ascii-char[data-offset="${idx}"]`);
    if (ascii) {
      ascii.textContent = (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
      ascii.classList.add('hex-modified');
    }
  }
}

function startEditing() {
  const pre = contentEl.querySelector('.viewer-text');
  if (!pre) return;

  isEditing = true;
  const textarea = document.createElement('textarea');
  textarea.className = 'viewer-text-edit';
  textarea.value = pre.textContent;
  textarea.addEventListener('input', () => { isDirty = true; });

  pre.replaceWith(textarea);
  textarea.focus();
  updateToolbarButtons('text', true);
}

async function saveFile() {
  const path = state.get('currentPath');
  const fullPath = path === '/' ? '/' + currentFileName : path + '/' + currentFileName;

  // Hex editor save
  if (currentCategory === 'unknown' && hexEditData) {
    if (!isDirty) { showToast('No changes to save', 'info'); return; }
    try {
      await serial.writeFile(fullPath, hexEditData);
      isDirty = false;
      currentFileData = new Uint8Array(hexEditData);
      // Clear modified indicators
      contentEl.querySelectorAll('.hex-modified').forEach(el => el.classList.remove('hex-modified'));
      showToast(`Saved ${currentFileName}`, 'success');
    } catch (e) {
      showToast(`Save failed: ${e.message}`, 'error');
    }
    return;
  }

  // Text editor save
  const textarea = contentEl.querySelector('.viewer-text-edit');
  if (!textarea) return;

  const data = new TextEncoder().encode(textarea.value);

  try {
    await serial.writeFile(fullPath, data);
    isDirty = false;
    isEditing = false;

    // Switch back to pre view
    const pre = document.createElement('pre');
    pre.className = 'viewer-text';
    pre.textContent = textarea.value;
    textarea.replaceWith(pre);
    updateToolbarButtons('text', false);
    showToast(`Saved ${currentFileName}`, 'success');
  } catch (e) {
    showToast(`Save failed: ${e.message}`, 'error');
  }
}

function cancelEditing() {
  const textarea = contentEl.querySelector('.viewer-text-edit');
  if (!textarea) return;

  isEditing = false;
  isDirty = false;
  const pre = document.createElement('pre');
  pre.className = 'viewer-text';
  pre.textContent = textarea.value;
  textarea.replaceWith(pre);
  updateToolbarButtons('text', false);
}

async function handleHash() {
  if (!currentFileName) return;
  const path = state.get('currentPath');
  const fullPath = path === '/' ? '/' + currentFileName : path + '/' + currentFileName;
  showToast('Computing hash...', 'info');
  const hash = await serial.getFileHash(fullPath);
  if (hash) {
    await confirm('SHA-256 Hash', `${currentFileName}\n\n${hash}`);
  } else {
    showToast('Hash computation failed', 'error');
  }
}

async function handleStripExif() {
  if (!currentFileName || !currentFileData) return;
  const ok = await confirm('Strip EXIF', 'Remove all EXIF metadata from this image? This will overwrite the file.');
  if (!ok) return;

  const stripped = stripExif(currentFileData);
  if (stripped.length === currentFileData.length) {
    showToast('No EXIF data to strip', 'info');
    return;
  }

  const path = state.get('currentPath');
  const fullPath = path === '/' ? '/' + currentFileName : path + '/' + currentFileName;
  try {
    await serial.writeFile(fullPath, stripped);
    showToast(`Stripped ${formatFileSize(currentFileData.length - stripped.length)} of EXIF data`, 'success');
    // Reload the file
    currentFileData = stripped;
    cleanup();
    contentEl.innerHTML = '<div class="viewer-loading">Reloading...</div>';
    renderContent(currentFileName, currentCategory, stripped);
    updateToolbarButtons(currentCategory, false);
  } catch (e) {
    showToast(`Strip failed: ${e.message}`, 'error');
  }
}

async function closeViewer() {
  if (isDirty) {
    const ok = await confirm('Unsaved Changes', 'Discard unsaved changes?');
    if (!ok) return;
  }
  cleanup();
  showViewer(false);
  state.set('viewerOpen', false);
  currentFileName = null;
  currentCategory = null;
  currentFileData = null;
  hexEditData = null;
  isDirty = false;
  isEditing = false;
  zoomLevel = 1;
}

function handleDownload() {
  if (!currentFileName) return;
  // Re-read from content or re-use existing data
  const path = state.get('currentPath');
  const fullPath = path === '/' ? '/' + currentFileName : path + '/' + currentFileName;
  const entries = state.get('entries') || [];
  const entry = entries.find(e => e.name === currentFileName);

  serial.readFile(fullPath, entry?.size).then(data => {
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${currentFileName}`, 'success');
  }).catch(e => {
    showToast(`Download failed: ${e.message}`, 'error');
  });
}

function showViewer(visible) {
  if (viewerEl) viewerEl.hidden = !visible;
  state.set('viewerOpen', visible);
}

function cleanup() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  if (contentEl) contentEl.innerHTML = '';
}

function applyZoom(level) {
  zoomLevel = Math.max(0.1, Math.min(level, 10));
  const img = contentEl?.querySelector('img.viewer-media');
  if (!img) return;
  img.style.transform = `scale(${zoomLevel})`;
  img.style.transformOrigin = 'center center';
  const label = $('#viewerZoomLevel');
  if (label) label.textContent = Math.round(zoomLevel * 100) + '%';
}

function toggleFullscreen() {
  const media = contentEl?.querySelector('.viewer-media, .viewer-pdf');
  if (!media) return;
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    media.requestFullscreen().catch(() => {});
  }
}

function updateToolbarButtons(category, editing) {
  const editBtn = $('#viewerEdit');
  const saveBtn = $('#viewerSave');
  const cancelBtn = $('#viewerCancel');
  const zoomInBtn = $('#viewerZoomIn');
  const zoomOutBtn = $('#viewerZoomOut');
  const fullscreenBtn = $('#viewerFullscreen');
  const hashBtn = $('#viewerHash');
  const stripBtn = $('#viewerStripExif');

  const isHex = category === 'unknown';
  if (editBtn) editBtn.hidden = (category !== 'text') || editing;
  if (saveBtn) saveBtn.hidden = isHex ? false : !editing;
  if (cancelBtn) cancelBtn.hidden = isHex ? true : !editing;

  const isImage = category === 'image';
  const isMedia = ['image', 'video', 'audio', 'pdf'].includes(category);
  const zoomLabel = $('#viewerZoomLevel');
  if (zoomInBtn) zoomInBtn.hidden = !isImage;
  if (zoomLabel) { zoomLabel.hidden = !isImage; zoomLabel.textContent = '100%'; }
  if (zoomOutBtn) zoomOutBtn.hidden = !isImage;
  if (fullscreenBtn) fullscreenBtn.hidden = !isMedia;
  if (hashBtn) hashBtn.hidden = false; // Always show hash button
  if (stripBtn) stripBtn.hidden = true; // Shown only when EXIF detected
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
