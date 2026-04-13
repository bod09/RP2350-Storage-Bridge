import * as state from '../state.js';
import * as serial from '../serial.js';
import { $, $$ } from '../utils/dom.js';
import { formatFileSize, formatDate } from '../utils/format.js';
import { isSuspiciousFile, getSeverity } from '../utils/security.js';

let fileList, breadcrumb, emptyState, searchInput;

const FILE_ICONS = {
  folder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2 6h-2v2h2v2h-2v2h-2v-2h2v-2h-2v-2h2v-2h-2V8h2v2h2v2z"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6zm2-5h8v2H8v-2zm0-3h8v2H8v-2z"/></svg>',
};

const EXT_MAP = {
  png:'image', jpg:'image', jpeg:'image', gif:'image', bmp:'image', svg:'image', webp:'image', ico:'image',
  mp3:'audio', wav:'audio', flac:'audio', ogg:'audio', aac:'audio', m4a:'audio', wma:'audio',
  mp4:'video', avi:'video', mkv:'video', mov:'video', wmv:'video', flv:'video', webm:'video',
  js:'code', ts:'code', py:'code', c:'code', h:'code', cpp:'code', java:'code', rs:'code',
  html:'code', css:'code', json:'code', xml:'code', yaml:'code', yml:'code', toml:'code',
  zip:'archive', tar:'archive', gz:'archive', '7z':'archive', rar:'archive', bz2:'archive',
  txt:'text', md:'text', log:'text', csv:'text', ini:'text', cfg:'text', conf:'text',
};

function getIcon(entry) {
  if (entry.type === 'd') return FILE_ICONS.folder;
  const ext = (entry.name.split('.').pop() || '').toLowerCase();
  return FILE_ICONS[EXT_MAP[ext]] || FILE_ICONS.file;
}

export function initFileBrowser() {
  fileList = $('#fileList');
  breadcrumb = $('#breadcrumb');
  emptyState = $('#emptyState');
  searchInput = $('#fileSearch');

  state.on('entries', () => renderFileList());
  state.on('currentPath', renderBreadcrumb);
  state.on('selectedFiles', updateSelection);
  state.on('searchFilter', () => renderFileList());
  state.on('sortBy', () => renderFileList());
  state.on('sortAsc', () => renderFileList());

  document.addEventListener('drive-mounted', () => navigateTo('/'));
  document.addEventListener('drive-unmounted', () => renderEmpty());

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.set('searchFilter', searchInput.value);
    });
  }

  // Column header sorting
  document.addEventListener('click', (e) => {
    const header = e.target.closest('[data-sort]');
    if (header) {
      const col = header.dataset.sort;
      if (state.get('sortBy') === col) {
        state.set('sortAsc', !state.get('sortAsc'));
      } else {
        state.batch({ sortBy: col, sortAsc: true });
      }
    }
  });

  // File row clicks
  fileList?.addEventListener('click', (e) => {
    const row = e.target.closest('.file-row');
    if (!row) return;
    const name = row.dataset.name;
    const type = row.dataset.type;

    if (type === 'd') {
      // Navigate into directory
      const path = state.get('currentPath');
      const newPath = path === '/' ? '/' + name : path + '/' + name;
      navigateTo(newPath);
      return;
    }

    // File selection
    const selected = [...state.get('selectedFiles')];
    if (e.ctrlKey || e.metaKey) {
      const idx = selected.indexOf(name);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(name);
    } else if (e.shiftKey && selected.length > 0) {
      const entries = getSortedFiltered();
      const names = entries.map(e => e.name);
      const lastIdx = names.indexOf(selected[selected.length - 1]);
      const curIdx = names.indexOf(name);
      const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
      for (let i = start; i <= end; i++) {
        if (!selected.includes(names[i])) selected.push(names[i]);
      }
    } else {
      selected.length = 0;
      selected.push(name);
    }
    state.set('selectedFiles', selected);
  });

  // Double-click to open/preview file
  fileList?.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.file-row');
    if (!row || row.dataset.type === 'd') return;
    const name = row.dataset.name;
    const entries = state.get('entries') || [];
    const entry = entries.find(en => en.name === name);
    document.dispatchEvent(new CustomEvent('open-file', { detail: { name, entry } }));
  });

  renderEmpty();
}

export async function navigateTo(path) {
  state.set('loading', true);
  const entries = await serial.listDirectory(path);
  state.set('loading', false);
  if (!entries) return;
  renderBreadcrumb(path);
  resolveFolderSizes(path, entries);
}

async function resolveFolderSizes(path, entries) {
  const dirs = entries.filter(e => e.type === 'd');
  for (const dir of dirs) {
    // Check user hasn't navigated away
    if (state.get('currentPath') !== path) return;
    const dirPath = path === '/' ? '/' + dir.name : path + '/' + dir.name;
    const result = await serial.getDirSize(dirPath);
    if (!result) continue;
    // Check again after async
    if (state.get('currentPath') !== path) return;
    const current = state.get('entries') || [];
    const updated = current.map(e =>
      e.name === dir.name && e.type === 'd'
        ? { ...e, size: result.size, sizeResolved: true }
        : e
    );
    state.set('entries', updated);
  }
}

function getSortedFiltered() {
  let entries = [...(state.get('entries') || [])];
  const filter = (state.get('searchFilter') || '').toLowerCase();
  if (filter) {
    entries = entries.filter(e => e.name.toLowerCase().includes(filter));
  }

  const sortBy = state.get('sortBy');
  const asc = state.get('sortAsc');

  // Dirs first, then sort
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'd' ? -1 : 1;
    let cmp = 0;
    if (sortBy === 'name') cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    else if (sortBy === 'size') cmp = (a.size || 0) - (b.size || 0);
    else if (sortBy === 'date') cmp = (a.modified || 0) - (b.modified || 0);
    return asc ? cmp : -cmp;
  });

  return entries;
}

function renderFileList() {
  if (!fileList) return;
  const mounted = state.get('driveMounted');
  if (!mounted) { renderEmpty(); return; }

  const entries = getSortedFiltered();

  if (entries.length === 0) {
    fileList.innerHTML = '';
    if (emptyState) {
      emptyState.hidden = false;
      emptyState.textContent = state.get('searchFilter')
        ? 'No matching files'
        : 'This folder is empty';
    }
    return;
  }

  if (emptyState) emptyState.hidden = true;

  const selected = state.get('selectedFiles') || [];

  fileList.innerHTML = entries.map(entry => {
    const icon = getIcon(entry);
    const sel = selected.includes(entry.name) ? ' selected' : '';
    let size;
    if (entry.type === 'd') {
      size = entry.sizeResolved ? formatFileSize(entry.size || 0)
        : '<span class="size-loading">...</span>';
    } else {
      size = formatFileSize(entry.size || 0);
    }
    const date = formatDate(entry.modified);
    const warn = (entry.type !== 'd' && isSuspiciousFile(entry.name))
      ? `<span class="security-warn severity-${getSeverity(entry.name)}" title="Potentially suspicious file">&#9888;</span>`
      : '';

    return `<div class="file-row${sel}" data-name="${escHtml(entry.name)}" data-type="${entry.type}">
      <div class="file-icon">${icon}</div>
      <div class="file-name">${warn}${escHtml(entry.name)}</div>
      <div class="file-size">${size}</div>
      <div class="file-date">${date}</div>
    </div>`;
  }).join('');
}

function renderBreadcrumb(path) {
  if (!breadcrumb) return;
  path = path || state.get('currentPath') || '/';
  const parts = path.split('/').filter(Boolean);

  let html = `<span class="crumb" data-path="/">/</span>`;
  let cumulative = '';
  for (const part of parts) {
    cumulative += '/' + part;
    html += `<span class="crumb-sep">/</span><span class="crumb" data-path="${escHtml(cumulative)}">${escHtml(part)}</span>`;
  }

  breadcrumb.innerHTML = html;

  // Attach click handlers
  breadcrumb.querySelectorAll('.crumb').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.path));
  });
}

function updateSelection() {
  if (!fileList) return;
  const selected = state.get('selectedFiles') || [];
  fileList.querySelectorAll('.file-row').forEach(row => {
    row.classList.toggle('selected', selected.includes(row.dataset.name));
  });
}

function renderEmpty() {
  if (fileList) fileList.innerHTML = '';
  if (emptyState) {
    emptyState.hidden = false;
    emptyState.textContent = state.get('driveMounted')
      ? 'This folder is empty'
      : 'No drive connected';
  }
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
