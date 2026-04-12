import * as state from '../state.js';
import * as serial from '../serial.js';
import { $ } from '../utils/dom.js';
import { showToast } from './toast.js';
import { navigateTo } from './file-browser.js';

let dropZone;

export function initUpload() {
  dropZone = $('#dropZone');
  const mainContent = $('.main-content') || document.body;

  let dragCounter = 0;

  mainContent.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (!state.get('driveMounted')) return;
    dragCounter++;
    if (dropZone) dropZone.classList.add('show');
  });

  mainContent.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (dropZone) dropZone.classList.remove('show');
    }
  });

  mainContent.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  mainContent.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (dropZone) dropZone.classList.remove('show');

    if (!state.get('driveMounted')) {
      showToast('No drive connected', 'error');
      return;
    }

    const files = e.dataTransfer.files;
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

    navigateTo(path);
  });
}
