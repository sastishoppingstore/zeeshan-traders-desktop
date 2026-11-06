/** Shared API/DB types. */

export interface ApiError {
  code: string;
  message_ur: string;
  message_en: string;
  field_errors?: Record<string, string>;
  /** Present on a 409 VERSION_CONFLICT: the row as the server has it now, so the client can show
   *  the latest values and retry against its version without an extra round-trip. */
  current?: unknown;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiFail {
  ok: false;
  error: ApiError;
}

export type ApiResponse<T> = ApiOk<T> | ApiFail;

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  roles: string[];
  permissions: string[];
  device_id?: string;
  csrf: string;
}

export interface Page<T> {
  rows: T[];
  next_cursor: string | null;
  total?: number;
}

export interface DocumentSnapshot {
  template_version: string;
  document_type: string;
  number: string;
  date: string;
  business: {
    name_ur: string; name_en: string; location_ur: string; phone1: string; phone2: string;
    logo_r2_key?: string; invoice_footer?: string;
    pesticide_licence_no?: string; pesticide_licence_expiry?: string;
  };
  party: { name: string; phone?: string; address?: string; cnic_masked?: string };
  title_ur: string;
  lines: { label: string; qty: string; rate: string; amount_paisa: number; batch?: string }[];
  subtotal_paisa: number;
  extras: { label: string; amount_paisa: number }[];
  total_paisa: number;
  paid_paisa: number;
  due_paisa: number;
  payment_method: string;
  note?: string;
  book_code?: string;
  provisional?: boolean;
  arithmetic?: string[];
  /** Server document ULID (`documents.id`). Present only on posted documents; it is the capability
   *  the printed QR encodes (`/verify/<doc_id>`). Absent on client-side provisional snapshots, in
   *  which case no QR is printed (graceful degradation, never a fabricated code). */
  doc_id?: string;
}

export const TEMPLATE_VERSION = 'zt-print-1.0';

export interface UsageMeter {
  day: string;
  rows_read: number;
  rows_written: number;
  free_read_cap: number;
  free_write_cap: number;
  read_pct: number;
  write_pct: number;
  note_ur: string;
}

/** Feature status used by the UI status page and handover checklist. */
export type FeatureState = 'COMPLETE' | 'INCOMPLETE' | 'PARTIAL';
export interface FeatureStatus {
  id: string;
  ur: string;
  en: string;
  state: FeatureState;
  note_ur?: string;
}
