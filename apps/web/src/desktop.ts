/**
 * The Electron bridge — a desktop renderer's only door to the network, the token and the sync
 * queue. In a browser `window.desktop` is absent, so every export here is inert and the existing
 * cookie/fetch paths stay authoritative.
 */
import { useSyncExternalStore } from 'react';

export interface DesktopErrorBody {
  code: string;
  message_ur: string;
  message_en: string;
  field_errors?: Record<string, string>;
  /** 409 VERSION_CONFLICT: the row the server has now. */
  current?: unknown;
}

export interface DesktopResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: DesktopErrorBody;
}

export interface SyncStatus {
  online: boolean;
  reachable: boolean;
  syncing: boolean;
  last_synced_at: string | null;
  pending: number;
  conflicts: number;
  error: string | null;
  device_id: string;
  api_base_url: string | null;
  config_error: string | null;
}

export interface DesktopConflict {
  id: string;
  entity: string;
  row_id: string;
  local_data: unknown;
  server_data: unknown;
  reason: string;
  created_at: string;
}

export interface DesktopOutboxRow {
  id: string; type?: string; status?: string; tries?: number;
  error?: string | null; server_number?: string | null;
  local_time?: string; created_at?: string | number;
  [key: string]: unknown;
}

export interface DesktopSessionUser {
  id: string; name: string; username: string; roles: string[]; permissions: string[];
}

/** The shape cached in the vault from the last successful `GET /api/v1/auth/me`. */
export interface DesktopSessionMe {
  user: DesktopSessionUser;
  business?: unknown;
  setup_complete?: boolean;
  permissions?: string[];
}

export interface DesktopSession {
  authenticated: boolean;
  user: DesktopSessionMe | null;
  expires_at: string | null;
}

export interface DesktopBridge {
  isDesktop: true;
  appVersion: string;
  request(method: string, path: string, body?: unknown): Promise<DesktopResponse>;
  status(): Promise<SyncStatus>;
  onStatus(cb: (s: SyncStatus) => void): () => void;
  syncNow(): Promise<SyncStatus>;
  conflicts(): Promise<DesktopConflict[]>;
  resolveConflict(id: string, choice: 'keep_server' | 'reapply_mine', reason: string): Promise<{ ok: boolean; error?: string }>;
  session(): Promise<DesktopSession>;
  outbox(state?: string | null): Promise<DesktopOutboxRow[]>;
  entityList(entity: string, opts?: Record<string, unknown>): Promise<{ rows: Record<string, unknown>[]; total: number }>;
  online(): Promise<boolean>;
}

declare global { interface Window { desktop?: DesktopBridge } }

const detected = typeof window === 'undefined' ? undefined : window.desktop;
export const bridge: DesktopBridge | undefined = detected?.isDesktop === true ? detected : undefined;
export const isDesktop = bridge?.isDesktop === true;

/** One route for the desktop queue screen, so the chip, the nav and the route table cannot drift. */
export const DESKTOP_SYNC_PATH = '/erp/desktop-sync';

let snapshot: SyncStatus | null = null;
let attached = false;
const listeners = new Set<() => void>();

function publish(next: SyncStatus) {
  snapshot = next;
  listeners.forEach((l) => l());
}

/** Attached once for the life of the window: the main process owns the queue, so the subscription
 *  outlives every component that reads it. */
function attach() {
  if (!bridge || attached) return;
  attached = true;
  void bridge.status().then((s) => { if (s) publish(s); });
  bridge.onStatus((s) => { if (s) publish(s); });
}

export const syncStore = {
  get: (): SyncStatus | null => snapshot,
  subscribe(cb: () => void) {
    listeners.add(cb);
    attach();
    return () => { listeners.delete(cb); };
  },
  /** A manual bridge round trip knows the newest state before the pushed event arrives. */
  publish,
};

export const useSyncStatus = (): SyncStatus | null =>
  useSyncExternalStore(syncStore.subscribe, syncStore.get, syncStore.get);

/** Sync stamps arrive as UTC instants; the shop's clock is Asia/Karachi, like every ERP list. */
export function karachiClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' });
}
