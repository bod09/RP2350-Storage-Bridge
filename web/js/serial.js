import * as state from './state.js';
import { USB_VENDOR_ID, USB_PRODUCT_ID, BAUD_RATE, CHUNK_SIZE, CMD_TIMEOUT_MS } from './utils/constants.js';
import { bytesToBase64, base64ToBytes } from './utils/base64.js';
import { showToast } from './components/toast.js';

let serialReader = null;
let serialLineBuffer = '';
let pendingResolve = null;
let pendingTimeout = null;

export async function sendRaw(text) {
  const writable = state.get('serialWritable');
  if (!writable) return;
  const writer = writable.getWriter();
  await writer.write(new TextEncoder().encode(text));
  writer.releaseLock();
}

export function sendCommand(cmd) {
  return new Promise((resolve) => {
    if (pendingResolve) pendingResolve(null);
    clearTimeout(pendingTimeout);
    pendingResolve = resolve;
    pendingTimeout = setTimeout(() => {
      if (pendingResolve === resolve) {
        pendingResolve = null;
        resolve(null);
      }
    }, CMD_TIMEOUT_MS);
    sendRaw(JSON.stringify(cmd) + '\n').catch(() => {
      pendingResolve = null;
      clearTimeout(pendingTimeout);
      resolve(null);
    });
  });
}

function handleMessage(msg) {
  if (!msg || msg.length === 0) return;
  let data;
  try {
    data = JSON.parse(msg);
  } catch {
    return;
  }

  // Drive status (unsolicited or in response to status command)
  if (data.type === 'drive') {
    // Resolve pending first (before dispatching events that may issue new commands)
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      clearTimeout(pendingTimeout);
      r(data);
    }
    if (data.mounted) {
      state.batch({
        driveMounted: true,
        driveLabel: data.label || '',
        driveFsType: data.fs || '',
        driveTotal: data.total || 0,
        driveFree: data.free || 0,
      });
      document.dispatchEvent(new CustomEvent('drive-mounted'));
    } else {
      state.batch({
        driveMounted: false,
        driveLabel: '',
        driveFsType: '',
        driveTotal: 0,
        driveFree: 0,
        entries: [],
        currentPath: '/',
      });
      if (data.error) {
        showToast(data.error, 'error');
      }
      document.dispatchEvent(new CustomEvent('drive-unmounted'));
    }
    return;
  }

  // All other responses resolve the pending promise
  if (pendingResolve) {
    const r = pendingResolve;
    pendingResolve = null;
    clearTimeout(pendingTimeout);
    r(data);
  }
}

async function startSerialReader() {
  const port = state.get('port');
  if (!port?.readable) return;

  const decoder = new TextDecoder();
  try {
    serialReader = port.readable.getReader();
    while (true) {
      const { value, done } = await serialReader.read();
      if (done) break;
      serialLineBuffer += decoder.decode(value, { stream: true });

      let nlIdx;
      while ((nlIdx = serialLineBuffer.indexOf('\n')) !== -1) {
        const line = serialLineBuffer.substring(0, nlIdx).trim();
        serialLineBuffer = serialLineBuffer.substring(nlIdx + 1);
        handleMessage(line);
      }
    }
  } catch (e) {
    if (e.name !== 'NetworkError') {
      console.warn('Serial reader error:', e);
    }
  } finally {
    serialReader = null;
  }
}

export async function connect() {
  try {
    const port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: USB_VENDOR_ID, usbProductId: USB_PRODUCT_ID }]
    });

    await port.open({ baudRate: BAUD_RATE });

    state.batch({
      port,
      serialWritable: port.writable,
      connected: true,
    });

    startSerialReader();

    // Small delay for device to settle, then request status
    await new Promise(r => setTimeout(r, 200));
    await sendRaw('{"cmd":"status"}\n');

    showToast('Device connected', 'success');
    document.dispatchEvent(new CustomEvent('device-ready'));
  } catch (e) {
    if (e.name !== 'NotFoundError') {
      showToast('Connection failed: ' + e.message, 'error');
    }
  }
}

export async function disconnect() {
  try {
    if (serialReader) {
      await serialReader.cancel();
      serialReader = null;
    }
    const port = state.get('port');
    if (port) {
      await port.close();
    }
  } catch (e) {
    console.warn('Disconnect error:', e);
  }
  state.resetState();
  serialLineBuffer = '';
  showToast('Device disconnected', 'info');
}

// ---- File Transfer Operations ----

export async function getDirSize(path) {
  const resp = await sendCommand({ cmd: 'dirsize', path });
  if (resp?.type === 'dirsize') {
    return { size: resp.size, files: resp.files, dirs: resp.dirs };
  }
  return null;
}

export async function getFileHash(path) {
  const resp = await sendCommand({ cmd: 'hash', path });
  if (resp?.status === 'ok') return resp.hash;
  return null;
}

export async function deleteRecursive(path) {
  return await sendCommand({ cmd: 'rmdir', path });
}

export async function formatDrive() {
  return await sendCommand({ cmd: 'format' });
}

export async function listDirectory(path) {
  const resp = await sendCommand({ cmd: 'ls', path });
  if (resp?.type === 'ls') {
    state.batch({
      currentPath: resp.path,
      entries: resp.entries || [],
      selectedFiles: [],
    });
    return resp.entries;
  }
  if (resp?.status === 'error') {
    showToast(resp.msg, 'error');
  }
  return null;
}

export async function readFile(path, totalSize) {
  const chunks = [];
  let offset = 0;
  const startTime = Date.now();

  while (true) {
    const resp = await sendCommand({ cmd: 'read', path, offset, length: CHUNK_SIZE });
    if (!resp || resp.status === 'error') {
      state.set('activeTransfer', null);
      throw new Error(resp?.msg || 'Read failed');
    }

    const decoded = base64ToBytes(resp.data);
    chunks.push(decoded);
    offset += decoded.length;

    const elapsed = (Date.now() - startTime) / 1000;
    state.set('activeTransfer', {
      type: 'download',
      name: path.split('/').pop(),
      progress: offset,
      total: resp.size || totalSize || 0,
      speed: elapsed > 0 ? offset / elapsed : 0,
    });

    if (resp.eof) break;
  }

  state.set('activeTransfer', null);

  // Concatenate chunks
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

export async function writeFile(path, data) {
  let offset = 0;
  const startTime = Date.now();

  while (offset < data.length) {
    const end = Math.min(offset + CHUNK_SIZE, data.length);
    const chunk = data.slice(offset, end);
    const b64 = bytesToBase64(chunk);
    const done = (end >= data.length);

    const resp = await sendCommand({
      cmd: 'write', path, offset,
      length: chunk.length, data: b64, done
    });

    if (!resp || resp.status === 'error') {
      state.set('activeTransfer', null);
      throw new Error(resp?.msg || 'Write failed');
    }

    offset = end;

    const elapsed = (Date.now() - startTime) / 1000;
    state.set('activeTransfer', {
      type: 'upload',
      name: path.split('/').pop(),
      progress: offset,
      total: data.length,
      speed: elapsed > 0 ? offset / elapsed : 0,
    });
  }

  state.set('activeTransfer', null);
}

// Monitor for disconnect
if (navigator.serial) {
  navigator.serial.addEventListener('disconnect', (e) => {
    const port = state.get('port');
    if (port && e.target === port) {
      state.resetState();
      serialLineBuffer = '';
      showToast('Device disconnected', 'info');
    }
  });
}
