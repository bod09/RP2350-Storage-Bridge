import * as state from '../state.js';
import { $ } from '../utils/dom.js';
import { formatFileSize, formatSpeed } from '../utils/format.js';

let overlay, fileName, progressBar, progressText, speedText;

export function initTransferProgress() {
  overlay = $('#transferOverlay');
  fileName = $('#transferFileName');
  progressBar = $('#transferBar');
  progressText = $('#transferProgress');
  speedText = $('#transferSpeed');

  state.on('activeTransfer', update);
}

function update(transfer) {
  if (!transfer) {
    overlay.classList.remove('show');
    return;
  }

  overlay.classList.add('show');

  const icon = transfer.type === 'upload' ? '\u2191' : '\u2193';
  fileName.textContent = `${icon} ${transfer.name}`;

  const pct = transfer.total > 0
    ? (transfer.progress / transfer.total * 100).toFixed(1)
    : 0;
  progressBar.style.width = pct + '%';
  progressText.textContent = transfer.total > 0
    ? `${formatFileSize(transfer.progress)} / ${formatFileSize(transfer.total)}`
    : formatFileSize(transfer.progress);
  speedText.textContent = transfer.speed > 0 ? formatSpeed(transfer.speed) : '';
}
