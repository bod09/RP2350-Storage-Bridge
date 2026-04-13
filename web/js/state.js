// Lightweight reactive state store
const listeners = {};

const state = {
  // Connection
  connected: false,
  port: null,
  serialWritable: null,

  // Drive
  driveMounted: false,
  driveLabel: '',
  driveFsType: '',
  driveTotal: 0,
  driveFree: 0,

  // File browser
  currentPath: '/',
  entries: [],
  selectedFiles: [],
  sortBy: 'name',
  sortAsc: true,
  viewMode: 'list',
  searchFilter: '',

  // Transfers
  activeTransfer: null, // {type, name, progress, total}

  // UI
  loading: false,
  viewerOpen: false,
};

export function get(key) {
  return state[key];
}

export function set(key, value) {
  if (state[key] === value) return;
  state[key] = value;
  if (listeners[key]) {
    listeners[key].forEach(fn => fn(value));
  }
}

export function batch(updates) {
  for (const [key, value] of Object.entries(updates)) {
    state[key] = value;
  }
  for (const key of Object.keys(updates)) {
    if (listeners[key]) {
      listeners[key].forEach(fn => fn(state[key]));
    }
  }
}

export function on(key, fn) {
  if (!listeners[key]) listeners[key] = [];
  listeners[key].push(fn);
  return () => {
    listeners[key] = listeners[key].filter(f => f !== fn);
  };
}

export function resetState() {
  set('connected', false);
  set('port', null);
  set('serialWritable', null);
  set('driveMounted', false);
  set('driveLabel', '');
  set('driveFsType', '');
  set('driveTotal', 0);
  set('driveFree', 0);
  set('currentPath', '/');
  set('entries', []);
  set('selectedFiles', []);
  set('activeTransfer', null);
  set('loading', false);
  set('viewerOpen', false);
}
