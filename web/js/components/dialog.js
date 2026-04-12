import { $ } from '../utils/dom.js';

let modalEl, titleEl, messageEl, inputEl, inputGroup, btnOk, btnCancel;
let resolvePromise = null;

export function initDialog() {
  modalEl = $('#dialogModal');
  titleEl = $('#dialogTitle');
  messageEl = $('#dialogMessage');
  inputEl = $('#dialogInput');
  inputGroup = $('#dialogInputGroup');
  btnOk = $('#dialogOk');
  btnCancel = $('#dialogCancel');

  btnOk.addEventListener('click', () => close(inputGroup.hidden ? true : inputEl.value));
  btnCancel.addEventListener('click', () => close(null));
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) close(null); });
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnOk.click(); });
}

function close(value) {
  modalEl.classList.remove('show');
  if (resolvePromise) {
    resolvePromise(value);
    resolvePromise = null;
  }
}

export function confirm(title, message) {
  return new Promise(resolve => {
    resolvePromise = resolve;
    titleEl.textContent = title;
    messageEl.textContent = message;
    inputGroup.hidden = true;
    btnOk.textContent = 'OK';
    modalEl.classList.add('show');
  });
}

export function prompt(title, message, defaultValue = '') {
  return new Promise(resolve => {
    resolvePromise = resolve;
    titleEl.textContent = title;
    messageEl.textContent = message;
    inputGroup.hidden = false;
    inputEl.value = defaultValue;
    btnOk.textContent = 'OK';
    modalEl.classList.add('show');
    setTimeout(() => { inputEl.focus(); inputEl.select(); }, 50);
  });
}
