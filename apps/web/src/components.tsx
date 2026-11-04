/** Shared component library (Part 5.7). Every screen composes these. */
import React, { useEffect, useId, useMemo, useState } from 'react';
import { useApp, ztdb } from './app-state.js';
import { Mark } from './ui/marks.js';
import { formatPKR, fromMilli, rupeesToPaisa, paisaToRupees, toMilli } from '@zt/shared';

export function Button({ children, variant = 'primary', size, loading, className = '', ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'wa'; size?: 'sm'; loading?: boolean }) {
  return <button className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
    {loading && <span className="spinner" aria-hidden="true" />}{children}
  </button>;
}

export function Chip({ children, tone = '', className = '' }: { children: React.ReactNode; tone?: string; className?: string }) {
  return <span className={`chip ${tone} ${className}`}>{children}</span>;
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, { tone: string; ur: string }> = {
    POSTED: { tone: 'success', ur: 'پوسٹڈ' }, DRAFT: { tone: 'gray', ur: 'ڈرافٹ' },
    REVERSED: { tone: 'danger', ur: 'ریورسڈ' }, PENDING_SYNC: { tone: 'warning', ur: 'سنک باقی' },
    SYNCED: { tone: 'success', ur: 'سنک شدہ' }, CONFLICT: { tone: 'danger', ur: 'تضاد' },
    EXPIRED: { tone: 'danger', ur: 'ایکسپائری ختم' }, LOW_STOCK: { tone: 'warning', ur: 'کم اسٹاک' },
    NEW: { tone: 'info', ur: 'نیا' }, REVIEW: { tone: 'gray', ur: 'زیرِ جائزہ' },
    APPROVED: { tone: 'success', ur: 'منظور' }, REJECTED: { tone: 'danger', ur: 'مسترد' },
    CONVERTED: { tone: 'info', ur: 'تبدیل شدہ' }, OPEN: { tone: 'warning', ur: 'کھلا' },
    RESOLVED: { tone: 'success', ur: 'حل شدہ' }, ACTIVE: { tone: 'success', ur: 'فعال' },
    DISABLED: { tone: 'gray', ur: 'غیر فعال' }, PENDING: { tone: 'warning', ur: 'زیرِ التوا' },
    FAILED: { tone: 'danger', ur: 'ناکام' }, AVAILABLE: { tone: 'success', ur: 'دستیاب' },
    OUT: { tone: 'gray', ur: 'ختم' }, CALL: { tone: 'info', ur: 'کال کریں' },
  };
  const s = map[status] ?? { tone: 'gray', ur: status };
  return <Chip tone={s.tone}>{s.ur}</Chip>;
}

export function Field({ label, helper, error, children, required, htmlFor }: {
  label: string; helper?: string; error?: string; children: React.ReactNode; required?: boolean; htmlFor?: string;
}) {
  return <div className="field">
    <label htmlFor={htmlFor}>{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
    {children}
    {helper && <div className="helper">{helper}</div>}
    {error && <div className="err" role="alert"><Mark kind="warn" /> {error}</div>}
  </div>;
}

export function TextField({ label, value, onChange, error, helper, type = 'text', placeholder, required,
  inputMode, autoComplete, dir }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; helper?: string;
  type?: string; placeholder?: string; required?: boolean; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string; dir?: string;
}) {
  const id = useId();
  return <Field label={label} helper={helper} error={error} required={required} htmlFor={id}>
    <input id={id} className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} required={required} inputMode={inputMode} autoComplete={autoComplete}
      aria-invalid={!!error} dir={dir} />
  </Field>;
}

/** Money field: displays rupees, stores INTEGER PAISA (H1). */
export function MoneyField({ label, paisa, onChange, error, helper, required }: {
  label: string; paisa: number; onChange: (p: number) => void; error?: string; helper?: string; required?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(paisaToRupees(paisa || 0).replace(/\.00$/, ''));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(paisaToRupees(paisa || 0).replace(/\.00$/, '')); }, [paisa]);
  return <Field label={label} helper={helper} error={error ?? (bad ? 'رقم درست نہیں' : undefined)} required={required} htmlFor={id}>
    <div className="input-prefix"><span>Rs</span>
      <input id={id} className="input money-input" inputMode="decimal" value={text}
        aria-invalid={!!error || bad}
        onChange={(e) => {
          setText(e.target.value);
          try { onChange(rupeesToPaisa(e.target.value || '0')); setBad(false); }
          catch { setBad(true); }
        }} />
    </div>
  </Field>;
}

/** Quantity field: displays base units, stores INTEGER MILLI-UNITS. */
export function QtyField({ label, milli, onChange, unit, error, required }: {
  label: string; milli: number; onChange: (m: number) => void; unit?: string; error?: string; required?: boolean;
}) {
  const id = useId();
  return <Field label={label} error={error} required={required} helper={unit ? `یونٹ: ${unit}` : undefined} htmlFor={id}>
    <input id={id} className="input money-input" inputMode="decimal" value={milli ? fromMilli(milli) : ''}
      placeholder="0" aria-invalid={!!error}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) { onChange(0); return; }
        if (/^\d*\.?\d{0,3}$/.test(v)) { try { onChange(toMilli(v)); } catch { /* ignore partial input */ } }
      }} />
  </Field>;
}

export function SelectField({ label, value, onChange, options, error, helper, required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; error?: string; helper?: string; required?: boolean; placeholder?: string;
}) {
  const id = useId();
  return <Field label={label} helper={helper} error={error} required={required} htmlFor={id}>
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </Field>;
}

export function CheckField({ label, checked, onChange }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="checkbox"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;
}

export function StatCard({ label, value, sub, tone, onClick }: {
  label: string; value: string | number; sub?: React.ReactNode; tone?: string; onClick?: () => void;
}) {
  return <div className="stat" style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
    <div className="label">{label}</div>
    <div className="value" style={tone ? { color: tone } : undefined}>{value}</div>
    {sub && <div className="sub">{sub}</div>}
  </div>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-busy="true" aria-label="لوڈ ہو رہا ہے">{Array.from({ length: rows }).map((_, i) =>
    <div key={i} className="card" style={{ marginBlockEnd: 10 }}>
      <div className="skeleton" style={{ width: '45%', marginBlockEnd: 10 }} />
      <div className="skeleton" style={{ width: '75%' }} />
    </div>)}</div>;
}

export function EmptyState({ photo, title, action }: { photo?: string; title: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="icon" aria-hidden="true">
    {photo ? <img src={photo} alt="" width={64} height={64} /> : <Mark kind="tray" />}
  </div><p>{title}</p>{action}</div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="error-state" role="alert"><div className="icon"><Mark kind="warn" /></div>
    <p>ڈیٹا لوڈ نہیں ہو سکا: {msg}</p>
    {retry && <Button variant="secondary" onClick={retry}>دوبارہ کوشش</Button>}</div>;
}

export interface Column { key: string; label: string; render?: (row: any) => React.ReactNode; money?: boolean; qty?: boolean }

/** DataTable: sticky header, desktop table + mobile card list, footer totals, CSV/Print. */
export function DataTable({ rows, columns, loading, error, onRetry, onRow, emptyText, footer, csvName }: {
  rows: any[]; columns: Column[]; loading?: boolean; error?: unknown; onRetry?: () => void;
  onRow?: (row: any) => void; emptyText?: string; footer?: React.ReactNode; csvName?: string;
}) {
  const { t } = useApp();
  const cell = (r: any, c: Column) => c.render ? c.render(r)
    : c.money ? <span className="num">{formatPKR(r[c.key] ?? 0)}</span>
    : c.qty ? <span className="num">{fromMilli(r[c.key] ?? 0)}</span>
    : <span>{String(r[c.key] ?? '—')}</span>;
  if (loading) return <Skeleton />;
  if (error) return <ErrorState error={error} retry={onRetry} />;
  if (!rows.length) return <EmptyState title={emptyText ?? t('noResults')} />;
  const exportCsv = () => {
    const head = columns.map((c) => c.label).join(',');
    const body = rows.map((r) => columns.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + head + '\n' + body], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${csvName ?? 'export'}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <div className="btn-row no-print" style={{ marginBlockEnd: 10 }}>
      <Button variant="ghost" size="sm" onClick={exportCsv}>CSV</Button>
      <Button variant="ghost" size="sm" onClick={() => window.print()}>{t('print')}</Button>
    </div>
    <div className="table-wrap"><table className="table">
      <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id ?? i} onClick={() => onRow?.(r)} style={onRow ? { cursor: 'pointer' } : undefined}>
        {columns.map((c) => <td key={c.key} className={c.money || c.qty ? 'num-cell' : ''}>{cell(r, c)}</td>)}
      </tr>)}</tbody>
      {footer && <tfoot><tr><td colSpan={columns.length}>{footer}</td></tr></tfoot>}
    </table></div>
    <div className="card-list">{rows.map((r, i) => <div key={r.id ?? i} className="item" onClick={() => onRow?.(r)}>
      <div><div className="t1">{cell(r, columns[0])}</div><div className="t2">{cell(r, columns[1] ?? columns[0])}</div></div>
      <span>›</span>
    </div>)}</div>
  </>;
}

export function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label={title}>
    <div className="sheet"><div className="handle" aria-hidden="true" />
      <div className="between" style={{ marginBlockEnd: 16 }}><h2 style={{ margin: 0 }}>{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="بند کریں"><Mark kind="x" /></Button></div>
      {children}
    </div>
  </div>;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, reasonRequired, busy }: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void; title: string;
  reasonRequired?: boolean; busy?: boolean;
}) {
  const [reason, setReason] = useState('');
  return <Sheet open={open} onClose={onClose} title={title}>
    {reasonRequired && <TextField label="وجہ / Reason" value={reason} onChange={setReason} required />}
    <div className="btn-row">
      <Button variant="danger" loading={busy} disabled={reasonRequired && reason.trim().length < 2}
        onClick={() => onConfirm(reason)}>تصدیق</Button>
      <Button variant="ghost" onClick={onClose}>منسوخ</Button>
    </div>
  </Sheet>;
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map((x) =>
    <button key={x.id} role="tab" aria-selected={active === x.id} className={active === x.id ? 'active' : ''}
      onClick={() => onChange(x.id)}>{x.label}</button>)}</div>;
}

export function ToastHost() {
  const { toastMsg } = useApp();
  if (!toastMsg) return null;
  return <div className="toast" role="status"><span>{toastMsg.kind === 'err' ? <Mark kind="warn" /> : <Mark kind="check" />} {toastMsg.msg}</span>
    <button className="btn btn-ghost btn-sm" onClick={() => window.dispatchEvent(new Event('zt-dismiss-toast'))}><Mark kind="x" /></button></div>;
}

/** Async-safe wrapper: shows loading skeleton, error+retry, empty state, permission denied. */
export function AsyncView({ loading, error, retry, empty, rows, permission = true, children }: {
  loading?: boolean; error?: unknown; retry?: () => void; empty?: boolean; rows?: number;
  permission?: boolean; children: React.ReactNode;
}) {
  const { t } = useApp();
  if (!permission) return <div className="permission"><h2><Mark kind="ban" /> {t('permissionDenied')}</h2></div>;
  if (loading) return <Skeleton rows={rows} />;
  if (error) return <ErrorState error={error} retry={retry} />;
  if (empty) return <EmptyState title={t('noResults')} />;
  return <>{children}</>;
}

export function OfflineBanner() {
  const { online, t, pending } = useApp();
  if (online && !pending) return null;
  return <div className={`banner offline ${online ? 'info' : ''}`} role="status">
    {!online ? t('offlineBanner') : `${pending} ${t('provisionalBanner')}`}
  </div>;
}

/** Type-ahead combobox with Urdu/English search and "+ نیا شامل کریں". */
export function Combobox({ label, value, onChange, options, onCreate, placeholder, error, required }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string; sub?: string }[];
  onCreate?: (name: string) => void; placeholder?: string; error?: string; required?: boolean;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => options.filter((o) => (o.label + ' ' + (o.sub ?? '')).toLowerCase().includes(q.toLowerCase())).slice(0, 30), [options, q]);
  const id = useId();
  return <Field label={label} error={error} required={required} htmlFor={id}>
    <input id={id} className="input" value={q} placeholder={placeholder ?? 'تلاش کریں…'}
      onChange={(e) => setQ(e.target.value)} aria-invalid={!!error} />
    <div className="card pad0" style={{ marginBlockStart: 6, maxHeight: 190, overflowY: 'auto' }}>
      {filtered.map((o) => <button type="button" key={o.value} className="btn btn-ghost btn-block"
        style={{ justifyContent: 'space-between', borderRadius: 0 }}
        onClick={() => { onChange(o.value); setQ(o.label); }}>
        <span>{o.label}</span>{o.sub && <span className="small num">{o.sub}</span>}
      </button>)}
      {!filtered.length && <div className="small" style={{ padding: 12 }}>کوئی نتیجہ نہیں</div>}
      {onCreate && q.trim().length > 1 && <button type="button" className="btn btn-secondary btn-block"
        style={{ borderRadius: 0 }} onClick={() => { onCreate(q.trim()); setQ(''); }}>+ نیا شامل کریں: {q}</button>}
    </div>
  </Field>;
}

export function IncompleteBadge({ note }: { note?: string }) {
  return <span title={note ?? 'یہ خصوصیت ابھی مکمل نہیں'}><Chip tone="danger" className="INCOMPLETE">INCOMPLETE</Chip></span>;
}
