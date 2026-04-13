import { initRouter } from './router.js';
import { initSidebar, initTheme } from './components/sidebar.js';
import { initFileBrowser } from './components/file-browser.js';
import { initToolbar } from './components/toolbar.js';
import { initFileViewer } from './components/file-viewer.js';
import { initUpload } from './components/upload.js';
import { initTransferProgress } from './components/transfer-progress.js';
import { initToast } from './components/toast.js';
import { initDialog } from './components/dialog.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initToast();
  initDialog();
  initRouter();
  initSidebar();
  initFileBrowser();
  initToolbar();
  initFileViewer();
  initUpload();
  initTransferProgress();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
