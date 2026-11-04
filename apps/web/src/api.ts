/** Typed API client. Same-origin relative URLs (works behind the preview proxy). */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export class ZtError extends Error {
  constructor(public status: number, public code: string, public message_ur: string,
    public message_en: string, public field_errors?: Record<string, string>) {
    super(message_ur || message_en);
  }
}

function csrf(): string {
  const m = /(?:^|;\s*)zt_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : '';
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? 'GET';
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
      e.message_en ?? `HTTP ${res.status}`, e.field_errors);
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

export async function downloadCsv(path: string, filename: string) {
  const res = await fetch(path, { credentials: 'same-origin' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
