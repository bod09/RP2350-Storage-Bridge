import { $ } from '../utils/dom.js';

let toastEl;
let toastTimer;

export function initToast() {
  toastEl = $('#toast');
}

export function showToast(message, type = 'info', duration = 3000) {
  if (!toastEl) return;
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = 'toast show ' + type;
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, duration);
}
