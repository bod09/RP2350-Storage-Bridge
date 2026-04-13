import * as state from '../state.js';
import * as serial from '../serial.js';
import { $ } from '../utils/dom.js';
import { formatFileSize } from '../utils/format.js';
import { showToast } from './toast.js';
import { confirm } from './dialog.js';
import { navigateTo } from './file-browser.js';
import { checkMagicBytes } from '../utils/security.js';

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
let isDirty = false;
let isEditing = false;

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

  document.addEventListener('open-file', (e) => {
    openFile(e.detail.name, e.detail.entry);
  });
}

export async function openFile(name, entry) {
  if (!viewerEl) return;

  const size = entry?.size || 0;
  if (size > LARGE_FILE_THRESHOLD) {
    const ok = await confirm('Large File', `This file is ${formatFileSize(size)}. Loading it may take a while. Continue?`);
    if (!ok) return;
  }

  currentFileName = name;
  isDirty = false;
  isEditing = false;
  cleanup();
  showViewer(true);

  const nameEl = $('#viewerFileName');
  if (nameEl) nameEl.textContent = name;

  const category = getFileCategory(name);
  updateToolbarButtons(category, false);

  contentEl.innerHTML = '<div class="viewer-loading">Loading...</div>';

  const path = state.get('currentPath');
  const fullPath = path === '/' ? '/' + name : path + '/' + name;

  try {
    const data = await serial.readFile(fullPath, size);
    renderContent(name, category, data);
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
  const maxBytes = 256;
  const slice = data.slice(0, maxBytes);
  let hex = '';
  let ascii = '';
  let lines = [];

  for (let i = 0; i < slice.length; i++) {
    if (i > 0 && i % 16 === 0) {
      lines.push(`${(i - 16).toString(16).padStart(8, '0')}  ${hex} |${ascii}|`);
      hex = '';
      ascii = '';
    }
    hex += slice[i].toString(16).padStart(2, '0') + ' ';
    ascii += (slice[i] >= 32 && slice[i] <= 126) ? String.fromCharCode(slice[i]) : '.';
  }

  if (hex) {
    const offset = Math.floor((slice.length - 1) / 16) * 16;
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(48)} |${ascii}|`);
  }

  const pre = document.createElement('pre');
  pre.className = 'viewer-hex';
  pre.textContent = lines.join('\n');

  const info = document.createElement('div');
  info.className = 'viewer-hex-info';
  info.textContent = data.length > maxBytes
    ? `Showing first ${maxBytes} of ${formatFileSize(data.length)}`
    : `${formatFileSize(data.length)} total`;

  contentEl.appendChild(info);
  contentEl.appendChild(pre);
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
  const textarea = contentEl.querySelector('.viewer-text-edit');
  if (!textarea) return;

  const path = state.get('currentPath');
  const fullPath = path === '/' ? '/' + currentFileName : path + '/' + currentFileName;
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

async function closeViewer() {
  if (isDirty) {
    const ok = await confirm('Unsaved Changes', 'Discard unsaved changes?');
    if (!ok) return;
  }
  cleanup();
  showViewer(false);
  state.set('viewerOpen', false);
  currentFileName = null;
  isDirty = false;
  isEditing = false;
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

function updateToolbarButtons(category, editing) {
  const editBtn = $('#viewerEdit');
  const saveBtn = $('#viewerSave');
  const cancelBtn = $('#viewerCancel');

  if (editBtn) editBtn.hidden = category !== 'text' || editing;
  if (saveBtn) saveBtn.hidden = !editing;
  if (cancelBtn) cancelBtn.hidden = !editing;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
