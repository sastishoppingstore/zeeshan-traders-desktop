/**
 * The preload — the only thing the desktop renderer can see of the machine it runs on.
 *
 * contextBridge and nothing else: no `fs`, no `sqlite`, no token, no `ipcRenderer` handed over
 * wholesale (a renderer that can call an arbitrary channel can call one that does not exist yet). Each
 * function below names one channel, shapes one payload, and returns exactly the fields the ERP was
 * written against. `electron/main.cjs` owns the behaviour; this file owns the boundary.
 *
 * The shape mirrors apps/web/src/desktop.ts, which is the renderer's half of the same contract.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Version arrives as a renderer argv: an exposed primitive must exist at expose time, and `invoke`
 *  is a promise the header chip cannot await. */
function readVersion() {
  for (const arg of process.argv ?? []) {
    const m = /^--zt-version=(.+)$/.exec(String(arg));
    if (m) return m[1];
  }
  return 'dev';
}

const bridge = {
  isDesktop: true,
  appVersion: readVersion(),

  /** The single data call. The main process decides local-or-remote; the renderer never asks. */
  request: (method, path, body) => ipcRenderer.invoke('zt:request', { method, path, body }),

  status: () => ipcRenderer.invoke('zt:status'),
  syncNow: () => ipcRenderer.invoke('zt:sync-now'),
  conflicts: () => ipcRenderer.invoke('zt:conflicts', { limit: 200 }),
  resolveConflict: (id, choice, reason) => ipcRenderer.invoke('zt:resolve-conflict', { id, choice, reason }),
  session: () => ipcRenderer.invoke('zt:session'),
  outbox: (state) => ipcRenderer.invoke('zt:outbox', { state: state ?? null, limit: 300 }),
  entityList: (entity, opts) => ipcRenderer.invoke('zt:entity-list', { entity, opts: opts ?? {} }),
  entityGet: (entity, id) => ipcRenderer.invoke('zt:entity-get', { entity, id }),
  online: () => ipcRenderer.invoke('zt:online'),
  appInfo: () => ipcRenderer.invoke('zt:app-info'),

  /** The engine pushes status; this is the one channel the renderer may listen on. */
  onStatus(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('zt:status', listener);
    return () => ipcRenderer.removeListener('zt:status', listener);
  },

  /** The renderer knows about connectivity flips before the main process does; this wakes the queue. */
  notifyNet: (online) => { ipcRenderer.send('zt:net', !!online); },
};

contextBridge.exposeInMainWorld('desktop', bridge);
