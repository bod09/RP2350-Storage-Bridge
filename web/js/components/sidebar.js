import * as state from '../state.js';
import * as serial from '../serial.js';
import { $ } from '../utils/dom.js';
import { formatFileSize } from '../utils/format.js';

let connectBtn, driveStatus, driveLabel, driveCap, driveBar, driveFs;

export function initSidebar() {
  connectBtn = $('#connectBtn');
  driveStatus = $('#driveStatus');
  driveLabel = $('#driveLabel');
  driveCap = $('#driveCap');
  driveBar = $('#driveBar');
  driveFs = $('#driveFs');

  connectBtn.addEventListener('click', async () => {
    if (state.get('connected')) {
      await serial.disconnect();
    } else {
      await serial.connect();
    }
  });

  state.on('connected', updateConnectBtn);
  state.on('driveMounted', updateDriveStatus);
  state.on('driveFree', updateDriveStatus);

  updateConnectBtn(false);
  updateDriveStatus(false);
}

function updateConnectBtn(connected) {
  connected = state.get('connected');
  connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
  connectBtn.classList.toggle('connected', connected);
}

function updateDriveStatus() {
  const mounted = state.get('driveMounted');
  driveStatus.classList.toggle('mounted', mounted);

  if (mounted) {
    const label = state.get('driveLabel') || 'USB Drive';
    const fs = state.get('driveFsType');
    const total = state.get('driveTotal');
    const free = state.get('driveFree');
    const used = total - free;
    const pct = total > 0 ? (used / total * 100) : 0;

    driveLabel.textContent = label;
    driveFs.textContent = fs;
    driveCap.textContent = `${formatFileSize(free)} free of ${formatFileSize(total)}`;
    driveBar.style.width = pct.toFixed(1) + '%';
    driveBar.className = 'bar-fill' + (pct > 90 ? ' critical' : pct > 75 ? ' warn' : '');
  } else {
    driveLabel.textContent = 'No drive';
    driveFs.textContent = '';
    driveCap.textContent = 'Connect a USB storage device';
    driveBar.style.width = '0%';
  }
}

export function initTheme() {
  const saved = localStorage.getItem('sb-theme') || 'system';
  applyTheme(saved);

  const themeBtn = $('#themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
      applyTheme(next);
      localStorage.setItem('sb-theme', next);
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}
