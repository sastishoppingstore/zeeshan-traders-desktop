/** Dexie/IndexedDB schema shared by app state and the PIN-based offline encryption layer.
 *  Kept in its own module so both can import it without a circular dependency. */
import Dexie, { type EntityTable } from 'dexie';

export interface OutboxOp {
  id: string;                 // uuid = idempotency_key
  device_id: string;
  type: 'SALE' | 'PURCHASE' | 'GRAIN_PURCHASE' | 'GRAIN_SALE' | 'RECEIPT' | 'PAYMENT' | 'EXPENSE' | 'PARTY';
  payload: Record<string, unknown>;
  local_time: string;
  status: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'FAILED';
  tries: number;
  error?: string;
  server_number?: string;
  created_at: number;
}
export interface RefRow { key: string; kind: string; data: unknown }
export interface DraftRow { key: string; data: unknown }

class ZtDb extends Dexie {
  outbox!: EntityTable<OutboxOp, 'id'>;
  refs!: EntityTable<RefRow, 'key'>;
  drafts!: EntityTable<DraftRow, 'key'>;
  constructor() {
    super('zeeshan-traders');
    this.version(1).stores({ outbox: 'id, status, created_at', refs: 'key, kind', drafts: 'key' });
  }
}
export const ztdb = new ZtDb();

export function deviceId(): string {
  let id = localStorage.getItem('zt_device_id');
  if (!id) { id = 'dev-' + crypto.randomUUID().slice(0, 12); localStorage.setItem('zt_device_id', id); }
  return id;
}
