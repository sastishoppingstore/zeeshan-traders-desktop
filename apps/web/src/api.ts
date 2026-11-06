/** Typed API client. Same-origin relative URLs (works behind the preview proxy). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bridge, isDesktop, type DesktopErrorBody } from './desktop.js';

export class ZtError extends Error {
  constructor(public status: number, public code: string, public message_ur: string,
    public message_en: string, public field_errors?: Record<string, string>,
    /** 409 VERSION_CONFLICT only: the row as the server has it now. */
    public current?: unknown) {
    super(message_ur || message_en);
  }
  /** A concurrent edit, not a validation failure — the UI should reload and let the shop retry. */
  get isVersionConflict(): boolean { return this.status === 409 && this.code === 'VERSION_CONFLICT'; }
}

function csrf(): string {
  const m = /(?:^|;\s*)zt_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : '';
}

/** The bridge reports failures the same way the Worker does, so both modes throw one error type. */
function toZtError(status: number, e?: DesktopErrorBody): ZtError {
  return new ZtError(status, e?.code ?? 'HTTP_ERROR', e?.message_ur ?? 'خرابی',
    e?.message_en ?? `HTTP ${status}`, e?.field_errors, e?.current);
}

/** Unwraps the `{ ok, data }` envelope only when the main process forwarded the body verbatim. */
function unwrap(data: unknown): unknown {
  if (data && typeof data === 'object' && (data as { ok?: unknown }).ok === true
    && 'data' in (data as Record<string, unknown>)) return (data as { data: unknown }).data;
  return data;
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  if (isDesktop && bridge) {
    // file:// has no origin, no cookies and no CSRF: the main process attaches its Bearer token
    // and answers reads from its own SQLite cache while offline.
    const res = await bridge.request(method, path, options.body);
    const payload = unwrap(res.data);
    if (!res.ok || (payload as { ok?: boolean })?.ok === false) {
      throw toZtError(res.status, res.error ?? (payload as { error?: DesktopErrorBody })?.error);
    }
    return payload as T;
  }
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { 'x-csrf-token': csrf() } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok || json?.ok === false) {
    const e = json?.error ?? {};
    throw new ZtError(res.status, e.code ?? 'HTTP_ERROR', e.message_ur ?? 'خرابی',
      e.message_en ?? `HTTP ${res.status}`, e.field_errors, e.current);
  }
  return (json?.data ?? json) as T;
}

export function useGet<T = any>(key: string, path: string | null, enabled = true) {
  return useQuery<T>({
    queryKey: [key, path],
    queryFn: () => api<T>(path!),
    enabled: enabled && !!path,
    retry: (count, err) => !(err instanceof ZtError && err.status < 500) && count < 1,
    staleTime: 15_000,
  });
}

export function usePost<T = any>(invalidate: string[] = []) {
  const qc = useQueryClient();
  return useMutation<T, ZtError, { path: string; body: unknown }>({
    mutationFn: ({ path, body }) => api<T>(path, { method: 'POST', body }),
    onSuccess: () => invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}

export function usePut<T = any>(invalidate: string[] = []) {
  const qc = useQueryClient();
  return useMutation<T, ZtError, { path: string; body: unknown }>({
    mutationFn: ({ path, body }) => api<T>(path, { method: 'PUT', body }),
    onSuccess: () => invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}

/** The main process reads the bytes itself: under file:// a blob URL built from a cross-origin
 *  response has nothing to save, so the bridge hands back a data URL or base64 instead. */
function desktopHref(data: unknown, filename: string): string | null {
  const o = data && typeof data === 'object' ? data as { data_url?: string; url?: string; base64?: string } : null;
  const text = typeof data === 'string' ? data : (o?.data_url ?? o?.url ?? o?.base64 ?? '');
  if (!text) return null;
  if (text.startsWith('data:')) return text;
  const mime = /\.csv$/i.test(filename) ? 'text/csv;charset=utf-8' : 'application/octet-stream';
  return `data:${mime};base64,${text}`;
}

export async function downloadCsv(path: string, filename: string) {
  if (isDesktop && bridge) {
    const res = await bridge.request('GET', path);
    if (!res.ok) {
      if (res.status === 501) throw new ZtError(501, 'EXPORT_UNAVAILABLE',
        'یہ برآمد ڈیسک ٹاپ ایپ میں ابھی دستیاب نہیں — ویب ورژن استعمال کریں',
        'This export is not wired into the desktop build yet — use the web version.');
      throw toZtError(res.status, res.error);
    }
    const href = desktopHref(res.data, filename);
    if (!href) throw new ZtError(501, 'EXPORT_UNAVAILABLE',
      'ڈیسک ٹاپ برآمد کا ڈیٹا واپس نہیں آیا', 'The desktop export returned no file data.');
    const a = document.createElement('a');
    a.href = href; a.download = filename; a.click();
    return;
  }
  const res = await fetch(path, { credentials: 'same-origin' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
