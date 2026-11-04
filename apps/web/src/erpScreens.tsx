/** ERP screens ERP-01..38. Each screen reads a real Worker endpoint and has loading/empty/error/offline states. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useGet, api, downloadCsv } from './api.js';
import { useApp, ztdb } from './app-state.js';
import { passkeysSupported, registerPasskey, revokePasskey } from './passkeys.js';
import { usePinState, enablePin, disablePin, lockPin, PIN_ITERATIONS } from './offline-security.js';
import {
  Button, TextField, MoneyField, QtyField, SelectField, CheckField, Field, Chip, StatusChip,
  DataTable, StatCard, Tabs, Sheet, ConfirmDialog, AsyncView, EmptyState, ErrorState,
  Skeleton, IncompleteBadge, type Column,
} from './components.js';
import { PrintActions } from './print.js';
import { Mark } from './ui/marks.js';
import { NavIcon } from './ui/icons.js';
import { TiltCard } from './ui/cards.js';
import { shrinkImage } from './image-input.js';
import { Reveal } from './ui/motion.js';
import {
  formatPKR, fromMilli, toMilli, rupeesToPaisa, paisaToRupees, BOOKS, BOOK_MAP,
  CROP_CODES, GOODS_CODES, MONEY_ACCOUNTS, CHART_OF_ACCOUNTS, EXPENSE_CATEGORIES,
  type DocumentSnapshot,
} from '@zt/shared';

const TODAY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const MONTH_START = () => TODAY().slice(0, 8) + '01';
const money = (v: any) => <span className="num">{formatPKR(v ?? 0)}</span>;

function RangePicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const { lang } = useApp();
  return <div className="row toolbar no-print">
    <TextField label={lang === 'ur' ? 'از تاریخ' : 'From Date'} value={from} onChange={setFrom} type="date" />
    <TextField label={lang === 'ur' ? 'تا تاریخ' : 'To Date'} value={to} onChange={setTo} type="date" />
  </div>;
}
function useRange(start = MONTH_START()) {
  const [from, setFrom] = useState(start), [to, setTo] = useState(TODAY());
  return { from, to, setFrom, setTo, qs: `from=${from}&to=${to}` };
}

// --------------------------------- Generic list ------------------------------
export function GenericList({ config }: { config: any }) {
  const { t, can, toast, lang } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState(''), [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false), [createVals, setCreateVals] = useState<Record<string, string>>({});
  const [createErr, setCreateErr] = useState(''), [createBusy, setCreateBusy] = useState(false);
  const range = useRange('2020-01-01');
  const [cursor, setCursor] = useState('');
  const sep = config.endpoint.includes('?') ? '&' : '?';
  const path = `${config.endpoint}${sep}q=${encodeURIComponent(q)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const { data, isLoading, error, refetch } = useGet<any>(path, path);
  const rows = Array.isArray(data) ? data : (data?.rows ?? []);
  const perm = config.endpoint.includes('products') ? 'products.read' : config.endpoint.includes('parties') ? 'parties.read'
    : config.endpoint.includes('expenses') ? 'expenses.read' : config.endpoint.includes('sales') ? 'sales.read'
    : config.endpoint.includes('purchases') ? 'purchases.read' : 'catalogue.read';
  const title = lang === 'ur' ? config.title : (config.title_en || config.title);
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1>{title}</h1>
      </div>
      <div className="btn-row no-print">
        {(config.actions ?? []).map((a: any) => <Link key={a.to} className="btn btn-secondary btn-sm" to={a.to}>{lang === 'ur' ? a.label : (a.label_en || a.label)}</Link>)}
        {config.create && <Button size="sm" onClick={() => setCreateOpen(true)}>{lang === 'ur' ? '+ نیا' : '+ New'}</Button>}
        {config.endpoint.includes('products') && <Button variant="ghost" size="sm" onClick={() => downloadCsv('/api/v1/catalogue/export', 'zt-products.csv')}>{lang === 'ur' ? 'CSV برآمد' : 'Export CSV'}</Button>}
        <Button variant="ghost" size="sm" onClick={() => window.print()} aria-label={lang === 'ur' ? 'پرنٹ' : 'Print'}><Mark kind="print" /></Button>
      </div></div>
    <div className="toolbar no-print">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === 'ur' ? 'تلاش…' : 'Search…'} aria-label={lang === 'ur' ? 'تلاش' : 'Search'} />
      <SelectField label="" value={status} onChange={setStatus} placeholder={lang === 'ur' ? 'تمام حالتیں' : 'All Statuses'}
        options={[{ value: 'POSTED', label: lang === 'ur' ? 'پوسٹڈ' : 'Posted' }, { value: 'DRAFT', label: lang === 'ur' ? 'ڈرافٹ' : 'Draft' }, { value: 'REVERSED', label: lang === 'ur' ? 'ریورسڈ' : 'Reversed' }]} />
      <Button variant="ghost" size="sm" onClick={() => refetch()} aria-label={lang === 'ur' ? 'دوبارہ لوڈ' : 'Reload'}><Mark kind="sync" /></Button>
    </div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!rows.length} permission={can(perm)} rows={5}>
      <DataTable rows={rows} columns={[
        ...config.columns.map((c: any) => ({
          ...c,
          label: lang === 'ur' ? c.label : (c.label_en || c.label),
          render: c.key === 'status' ? (r: any) => <StatusChip status={r.status} /> : c.render
        })),
      ] as Column[]}
        onRow={config.detail ? (r) => nav(config.detail(r)) : undefined}
        csvName={title} footer={<div className="small">{rows.length} {lang === 'ur' ? 'قطاریں — مزید کے لیے تلاش کو محدود کریں' : 'rows — refine search for more'}</div>} />
      {data?.next_cursor && <div className="center" style={{ marginBlock: 16 }}>
        <Button variant="secondary" onClick={() => setCursor(data.next_cursor)}>{t('loadMore')}</Button></div>}
    </AsyncView>
    {config.create && <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title={`+ ${title}`}>
      {(config.create.fields as { name: string; label: string; label_en?: string; type?: string }[]).map((f) =>
        <TextField key={f.name} label={lang === 'ur' ? f.label : (f.label_en || f.label)} value={createVals[f.name] ?? ''}
          onChange={(v) => setCreateVals({ ...createVals, [f.name]: v })} inputMode={f.type === 'number' ? 'numeric' : undefined} required={f.name === 'name_ur' || f.name === 'code'} />)}
      {createErr && <div className="err"><Mark kind="warn" /> {createErr}</div>}
      <Button loading={createBusy} onClick={async () => {
        setCreateBusy(true); setCreateErr('');
        try {
          const body: any = { ...createVals };
          for (const f of config.create.fields) if (f.type === 'number') body[f.name] = Number(body[f.name] || 0);
          if (config.create.slugFromName && !body.slug) body.slug = String(body.name_ur ?? '').trim().toLowerCase().replace(/\s+/g, '-');
          if (config.create.extra) Object.assign(body, config.create.extra);
          await api(config.create.endpoint, { method: 'POST', body });
          toast(lang === 'ur' ? 'شامل ہو گیا' : 'Added'); setCreateOpen(false); setCreateVals({}); refetch();
        } catch (e: any) { setCreateErr(e.message_ur ?? String(e)); } finally { setCreateBusy(false); }
      }}>{lang === 'ur' ? 'محفوظ کریں' : 'Save'}</Button>
    </Sheet>}
  </div>;
}

/** ERP-02 quick actions — the only place the dashboard gets 3D depth (forms stay flat). */
const DASH_QUICK: { to: string; ur: string; en: string; icon: string }[] = [
  { to: '/erp/fertilizer/sale/new?quick=1', ur: 'کھاد فروخت', en: 'Fertilizer Sale', icon: 'sales' },
  { to: '/erp/fertilizer/purchase/new?quick=1', ur: 'کھاد خرید', en: 'Fertilizer Purchase', icon: 'purchases' },
  { to: '/erp/grains', ur: 'اجناس', en: 'Grains', icon: 'grains' },
  { to: '/erp/receipts/new', ur: 'رقم وصول', en: 'Receive Money', icon: 'khata' },
  { to: '/erp/payments/new', ur: 'رقم ادا', en: 'Pay Money', icon: 'accounts' },
  { to: '/erp/expenses/new', ur: 'خرچہ', en: 'Expense', icon: 'expenses' },
];

// ---------------------------------- Dashboard --------------------------------
export function Dashboard() {
  const { t, online, pending, conflicts, syncNow, can, lang } = useApp();
  const [from, setFrom] = useState(TODAY()), [to, setTo] = useState(TODAY());
  const { data, isLoading, error, refetch } = useGet<any>('dashboard', `/api/v1/dashboard?from=${from}&to=${to}`);
  if (!can('dashboard.view')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  if (isLoading) return <Skeleton rows={8} />;
  if (error) return <ErrorState error={error} retry={() => refetch()} />;
  const d = data;
  const cash = (d?.accounts ?? []).filter((a: any) => ['1000', '1010', '1020', '1030'].includes(a.code)).reduce((a: number, x: any) => a + x.balance_paisa, 0);
  const chartPoints = (d?.charts ?? []).filter((x: any) => x.metric === 'SALE').map((x: any) => x.paisa);
  const max = Math.max(1, ...chartPoints);
  return <div>
    <div className="between"><h1 className="head-icon"><NavIcon icon="dashboard" label={lang === 'ur' ? 'ڈیش بورڈ' : 'Dashboard'} size={34} />{lang === 'ur' ? 'ڈیش بورڈ' : 'Dashboard'}</h1>
      <div className="row no-print"><TextField label={lang === 'ur' ? 'از تاریخ' : 'From Date'} value={from} onChange={setFrom} type="date" />
        <TextField label={lang === 'ur' ? 'تا تاریخ' : 'To Date'} value={to} onChange={setTo} type="date" /></div></div>
    <div className="stats-grid">
      <StatCard label={lang === 'ur' ? 'آج کی فروخت' : "Today's Sales"} value={formatPKR(d?.today?.sales_paisa ?? 0)} tone="var(--primary)" />
      <StatCard label={lang === 'ur' ? 'آج کی خرید' : "Today's Purchases"} value={formatPKR(d?.today?.purchases_paisa ?? 0)} />
      <StatCard label={lang === 'ur' ? 'وصولیاں' : 'Collections'} value={formatPKR(d?.today?.collections_paisa ?? 0)} />
      <StatCard label={lang === 'ur' ? 'ادائیگیاں' : 'Payments'} value={formatPKR(d?.today?.payments_paisa ?? 0)} />
      <StatCard label={lang === 'ur' ? 'اخراجات' : 'Expenses'} value={formatPKR(d?.today?.expenses_paisa ?? 0)} tone="var(--danger)" />
      <StatCard label={lang === 'ur' ? 'مجموعی منافع' : 'Gross Profit'} value={formatPKR(d?.today?.gross_profit_paisa ?? 0)} tone="var(--success)" />
      <StatCard label={lang === 'ur' ? 'قابلِ وصول' : 'Receivables'} value={formatPKR(d?.credit?.receivable_paisa ?? 0)} />
      <StatCard label={lang === 'ur' ? 'قابلِ ادا' : 'Payables'} value={formatPKR(d?.credit?.payable_paisa ?? 0)} />
      <StatCard label={lang === 'ur' ? 'نقد + بینک' : 'Cash + Bank'} value={formatPKR(cash)} />
    </div>
    <Reveal className="quick-grid" as="div">{DASH_QUICK.map((q) =>
      <TiltCard key={q.to} href={q.to} tone="emerald"><NavIcon icon={q.icon} label={lang === 'ur' ? q.ur : q.en} size={40} /><strong>{lang === 'ur' ? q.ur : q.en}</strong></TiltCard>)}</Reveal>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', marginBlock: 16 }}>
      <div className="card glass"><h2>{lang === 'ur' ? 'کھاتہ جات (17)' : 'Business Ledgers (17)'}</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {(d?.books ?? []).map((b: any) => <Link key={b.code} to={b.code === 'FERT' ? '/erp/fertilizer' : b.code === 'PEST' ? '/erp/pesticide'
            : (CROP_CODES as readonly string[]).includes(b.code) ? `/erp/grains/${b.code}` : `/erp/goods/${b.code}`}
            className="chip success" style={{ textDecoration: 'none' }}>{lang === 'ur' ? b.ur : (b.en || b.ur)}: {formatPKR(b.today_sale_paisa)}</Link>)}
        </div></div>
      <div className="card glass"><h2>{lang === 'ur' ? 'الرٹس' : 'Alerts'}</h2>
        {(d?.alerts ?? []).length ? (d.alerts as any[]).map((a, i) => <div key={i} className="item">
          <div><div className="t1">{lang === 'ur' ? (a.title_ur ?? a.name_ur) : (a.title_en ?? a.name_en ?? a.title_ur ?? a.name_ur)}</div><div className="t2">{a.type}{a.expiry_date ? ` — ${a.expiry_date}` : ''}</div></div>
          <StatusChip status={a.type} /></div>) : <div className="notice success">{lang === 'ur' ? 'کوئی الرٹ نہیں — کوئی فرضی ڈیٹا نہیں دکھایا گیا۔' : 'No alerts.'}</div>}
        <div className="small" style={{ marginBlockStart: 12 }}>{lang === 'ur' ? `نئی پوچھ گچھ: ${d?.counts?.pending_enquiries ?? 0} · سنک باقی: ${d?.counts?.pending_sync ?? 0} · تضادات: ${d?.counts?.conflicts ?? 0}` : `New Enquiries: ${d?.counts?.pending_enquiries ?? 0} · Pending Sync: ${d?.counts?.pending_sync ?? 0} · Conflicts: ${d?.counts?.conflicts ?? 0}`}</div>
      </div>
      <div className="card glass"><h2>{lang === 'ur' ? '30 دن کی فروخت' : '30-Day Sales'}</h2>
        {chartPoints.length ? <div className="chart-cols" role="img"
          aria-label={lang === 'ur' ? `۳۰ دن کی فروخت، سب سے زیادہ روزانہ ${formatPKR(max)}` : `30-day sales, peak daily ${formatPKR(max)}`}>
          {chartPoints.map((v: number, i: number) => <span key={i} className="chart-col"
            style={{ height: `${Math.max(3, Math.round((v / max) * 100))}%` }} />)}
        </div> : <div className="notice info small">{lang === 'ur' ? 'ابھی کوئی فروخت نہیں — اصل ڈیٹا درج ہونے پر گراف بنے گا۔' : 'No sales yet — graph will appear once transactions are recorded.'}</div>}
      </div>
    </div>
    <div className="card"><div className="between"><h2>{lang === 'ur' ? 'حالیہ دستاویزات' : 'Recent Documents'}</h2><Link to="/erp/documents">{lang === 'ur' ? 'سب دیکھیں ›' : 'View all ›'}</Link></div>
      <DataTable rows={d?.recent ?? []} columns={[
        { key: 'number', label: lang === 'ur' ? 'نمبر' : 'Number' }, { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' },
        { key: 'kind', label: lang === 'ur' ? 'قسم' : 'Type' }, { key: 'amount_paisa', label: lang === 'ur' ? 'رقم' : 'Amount', render: (r: any) => money(r.amount_paisa) },
      ] as Column[]} emptyText={lang === 'ur' ? 'ابھی کوئی دستاویز نہیں' : 'No documents yet'} />
    </div>
    <div className="card" style={{ marginBlock: 16 }}>
      <h2>{lang === 'ur' ? 'سنک' : 'Sync'}</h2>
      <div className="kv">
        <span className="k">{lang === 'ur' ? 'نیٹ ورک' : 'Network'}</span>
        <span className="v">{online ? (lang === 'ur' ? 'آن لائن' : 'Online') : (lang === 'ur' ? 'آف لائن' : 'Offline')}</span>
        <span className="k">{lang === 'ur' ? 'مقامی قطار' : 'Local Queue'}</span>
        <span className="v">{pending}</span>
        <span className="k">{lang === 'ur' ? 'تضادات' : 'Conflicts'}</span>
        <span className="v">{conflicts}</span>
      </div>
      <div className="btn-row" style={{ marginBlockStart: 12 }}>
        <Button size="sm" onClick={() => void syncNow()}>{lang === 'ur' ? 'ابھی سنک کریں' : 'Sync Now'}</Button>
        <Link className="btn btn-ghost btn-sm" to="/erp/sync">{lang === 'ur' ? 'سنک سینٹر' : 'Sync Centre'}</Link>
      </div>
    </div>
  </div>;
}

// -------------------------------- Product form -------------------------------
const PRODUCT_DEFAULT: any = {
  name_ur: '', name_en: '', category_id: '', brand_id: null, sku: '', barcode: '', slug: '',
  description_ur: '', description_en: '', base_unit: 'kg', purchase_unit: 'kg', sale_unit: 'kg',
  conversion_ratio_milli: 1000, grams_per_base_unit: 0, track_batch: false, track_expiry: false,
  is_pesticide: false, reorder_level_milli: 0, purchase_rate_paisa: 0, sale_rate_paisa: 0,
  tax_pct_milli: 0, show_public_price: false, public_price_paisa: 0, availability_mode: 'AUTO',
  is_published: false, is_featured: false, is_active: true, seo_title: '', seo_description: '', season: 'NONE',
};
export function ProductForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, toast, t, lang } = useApp();
  const [tab, setTab] = useState('basic');
  const [p, setP] = useState<any>(PRODUCT_DEFAULT);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [saved, setSaved] = useState(false);
  const cats = useGet<any[]>('categories-ref', '/api/v1/categories');
  const brands = useGet<any[]>('brands-ref', '/api/v1/brands');
  const existing = useGet<any>('product', id ? `/api/v1/products/${id}` : null);
  const [uploadBusy, setUploadBusy] = useState(false);
  useEffect(() => { if (existing.data) setP({ ...PRODUCT_DEFAULT, ...existing.data }); }, [existing.data]);
  const set = (k: string, v: any) => { setP((x: any) => ({ ...x, [k]: v })); setSaved(false); };
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body: any = { ...p };
      if (!body.name_ur || !body.category_id || !body.base_unit || !body.purchase_unit || !body.sale_unit || body.conversion_ratio_milli <= 0) {
        throw new Error(lang === 'ur' ? 'نام، زمرہ، یونٹس اور کنورژن لازمی ہیں' : 'Name, category, units and conversion ratio are required');
      }
      if (id) await api(`/api/v1/products/${id}`, { method: 'PUT', body });
      else await api('/api/v1/products', { method: 'POST', body });
      toast(lang === 'ur' ? 'محفوظ ہو گیا' : 'Saved successfully'); setSaved(true); nav('/erp/products');
    } catch (e: any) { setErr(e.message_ur ?? e.message ?? String(e)); } finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    if (!id) { setErr(lang === 'ur' ? 'تصویر شامل کرنے سے پہلے مصنوعات محفوظ کریں' : 'Save product before uploading image'); return; }
    setUploadBusy(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
      await api('/api/v1/images', { method: 'POST', body: { product_id: id, data_url: dataUrl, alt_ur: p.name_ur } });
      toast(lang === 'ur' ? 'تصویر محفوظ' : 'Image saved'); existing.refetch();
    } catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setUploadBusy(false); }
  };
  if (!can('products.write')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  if (id && existing.isLoading) return <Skeleton rows={5} />;
  const tabs = [
    { id: 'basic', label: lang === 'ur' ? 'بنیادی' : 'Basic' },
    { id: 'pricing', label: lang === 'ur' ? 'قیمتیں' : 'Pricing' },
    { id: 'stock', label: lang === 'ur' ? 'اسٹاک' : 'Stock' },
    { id: 'web', label: lang === 'ur' ? 'ویب / SEO' : 'Web / SEO' },
    { id: 'images', label: lang === 'ur' ? 'تصاویر' : 'Images' }
  ];
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav('/erp/products')}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1>{id ? (lang === 'ur' ? `مصنوعات: ${p.name_ur || ''}` : `Product: ${p.name_en || p.name_ur || ''}`) : (lang === 'ur' ? 'نئی مصنوعات' : 'New Product')}</h1>
      </div>
    </div>
    <Tabs tabs={tabs} active={tab} onChange={setTab} />
    <div className="card">
      {tab === 'basic' && <div className="grid g2">
        <TextField label={lang === 'ur' ? 'نام (اردو)' : 'Name (Urdu)'} value={p.name_ur} onChange={(v) => set('name_ur', v)} required />
        <TextField label={lang === 'ur' ? 'نام (English)' : 'Name (English)'} value={p.name_en} onChange={(v) => set('name_en', v)} dir="ltr" />
        <SelectField label={lang === 'ur' ? 'زمرہ' : 'Category'} value={p.category_id} onChange={(v) => set('category_id', v)} required placeholder={lang === 'ur' ? 'منتخب کریں' : 'Select Category'}
          options={(cats.data ?? []).map((c: any) => ({ value: c.id, label: `${lang === 'ur' ? c.name_ur : (c.name_en || c.name_ur)} (${c.code})` }))} />
        <SelectField label={lang === 'ur' ? 'برانڈ' : 'Brand'} value={p.brand_id ?? ''} onChange={(v) => set('brand_id', v || null)} placeholder="—"
          options={(brands.data ?? []).map((b: any) => ({ value: b.id, label: lang === 'ur' ? b.name_ur : (b.name_en || b.name_ur) }))} />
        <TextField label="SKU" value={p.sku} onChange={(v) => set('sku', v)} />
        <TextField label={lang === 'ur' ? 'بار کوڈ' : 'Barcode'} value={p.barcode} onChange={(v) => set('barcode', v)} />
        <TextField label="Slug" value={p.slug} onChange={(v) => set('slug', v)} dir="ltr" helper={lang === 'ur' ? 'خالی چھوڑیں تو نام سے بنے گا' : 'Leave empty to auto-generate from name'} />
        <SelectField label={lang === 'ur' ? 'سیزن' : 'Season'} value={p.season} onChange={(v) => set('season', v)}
          options={[{ value: 'NONE', label: '—' }, { value: 'KHARIF', label: lang === 'ur' ? 'خریف' : 'Kharif' }, { value: 'RABI', label: lang === 'ur' ? 'ربی' : 'Rabi' }]} />
        <Field label={lang === 'ur' ? 'تفصیل (اردو)' : 'Description (Urdu)'}><textarea className="input" aria-label={lang === 'ur' ? 'تفصیل (اردو)' : 'Description (Urdu)'} value={p.description_ur} onChange={(e) => set('description_ur', e.target.value)} /></Field>
      </div>}
      {tab === 'pricing' && <div className="grid g2">
        <MoneyField label={lang === 'ur' ? 'خرید ریٹ' : 'Purchase Rate'} paisa={p.purchase_rate_paisa} onChange={(v) => set('purchase_rate_paisa', v)} />
        <MoneyField label={lang === 'ur' ? 'فروخت ریٹ' : 'Sale Rate'} paisa={p.sale_rate_paisa} onChange={(v) => set('sale_rate_paisa', v)} />
        <MoneyField label={lang === 'ur' ? 'عوامی قیمت' : 'Public Price'} paisa={p.public_price_paisa} onChange={(v) => set('public_price_paisa', v)} />
        <TextField label={lang === 'ur' ? 'ٹیکس % (1000 = 1%)' : 'Tax % (1000 = 1%)'} value={String(p.tax_pct_milli)} onChange={(v) => set('tax_pct_milli', Number(v) || 0)} inputMode="numeric" />
        <CheckField label={lang === 'ur' ? 'ویب پر قیمت دکھائیں' : 'Show Price on Public Web'} checked={p.show_public_price} onChange={(v) => set('show_public_price', v)} />
        <div className="notice small">{lang === 'ur' ? 'عوامی API کبھی لاگت، مارجن، سپلائر یا اندرونی نوٹ نہیں بھیجتا (H6)۔' : 'Public API never leaks purchase cost, margins, suppliers, or internal notes (H6).'}</div>
      </div>}
      {tab === 'stock' && <div className="grid g2">
        <TextField label={lang === 'ur' ? 'بنیادی یونٹ' : 'Base Unit'} value={p.base_unit} onChange={(v) => set('base_unit', v)} required />
        <TextField label={lang === 'ur' ? 'خرید یونٹ' : 'Purchase Unit'} value={p.purchase_unit} onChange={(v) => set('purchase_unit', v)} required />
        <TextField label={lang === 'ur' ? 'فروخت یونٹ' : 'Sale Unit'} value={p.sale_unit} onChange={(v) => set('sale_unit', v)} required />
        <TextField label={lang === 'ur' ? 'تبدیلی (milli; 1000 = 1:1)' : 'Conversion Ratio (milli; 1000 = 1:1)'} value={fromMilli(p.conversion_ratio_milli)} onChange={(v) => { try { set('conversion_ratio_milli', toMilli(v)); } catch { /* ignore */ } }} />
        <QtyField label={lang === 'ur' ? 'کم اسٹاک حد' : 'Reorder Alert Level'} milli={p.reorder_level_milli} onChange={(v) => set('reorder_level_milli', v)} />
        <CheckField label={lang === 'ur' ? 'بیچ ٹریکنگ' : 'Batch Tracking'} checked={p.track_batch} onChange={(v) => set('track_batch', v)} />
        <CheckField label={lang === 'ur' ? 'ایکسپائری ٹریکنگ' : 'Expiry Tracking'} checked={p.track_expiry} onChange={(v) => set('track_expiry', v)} />
        <CheckField label={lang === 'ur' ? 'پیسٹی سائیڈ (بیچ + ایکسپائری لازمی)' : 'Pesticide (Mandatory Batch + Expiry)'} checked={p.is_pesticide} onChange={(v) => { set('is_pesticide', v); if (v) { set('track_batch', true); set('track_expiry', true); } }} />
        <div className="notice small">{lang === 'ur' ? 'موجودہ اسٹاک: ' : 'Current Stock: '}<span className="num">{fromMilli(p.stock_milli ?? 0)}</span> — {lang === 'ur' ? 'صرف پوسٹڈ دستاویزات سے بدلتا ہے۔' : 'Updates exclusively via posted documents.'}</div>
      </div>}
      {tab === 'web' && <div className="grid g2">
        <CheckField label={lang === 'ur' ? 'ویب پر شائع کریں' : 'Publish to Web'} checked={p.is_published} onChange={(v) => set('is_published', v)} />
        <CheckField label={lang === 'ur' ? 'نمایاں' : 'Featured Product'} checked={p.is_featured} onChange={(v) => set('is_featured', v)} />
        <CheckField label={lang === 'ur' ? 'فعال' : 'Active'} checked={p.is_active} onChange={(v) => set('is_active', v)} />
        <SelectField label={lang === 'ur' ? 'دستیابی' : 'Availability Mode'} value={p.availability_mode} onChange={(v) => set('availability_mode', v)}
          options={[{ value: 'AUTO', label: lang === 'ur' ? 'اسٹاک کے مطابق' : 'Auto (based on stock)' }, { value: 'ALWAYS', label: lang === 'ur' ? 'ہمیشہ دستیاب' : 'Always Available' }, { value: 'CALL', label: lang === 'ur' ? 'کال کریں' : 'Call for Availability' }]} />
        <TextField label={lang === 'ur' ? 'SEO عنوان' : 'SEO Title'} value={p.seo_title} onChange={(v) => set('seo_title', v)} />
        <TextField label={lang === 'ur' ? 'SEO تفصیل' : 'SEO Description'} value={p.seo_description} onChange={(v) => set('seo_description', v)} />
        <div className="notice info small">{lang === 'ur' ? 'شائع کرنے پر سرور عوامی کیش صاف کرتا ہے (60–300 سیکنڈ)۔' : 'Publishing triggers public edge cache purge within 60-300 seconds.'}</div>
      </div>}
      {tab === 'images' && <div>
        <p>{lang === 'ur' ? 'تصاویر مقامی پیش نظارہ / پرائیویٹ R2 میں محفوظ ہوتی ہیں؛ عوامی API صرف تصویری URL بھیجتا ہے۔' : 'Images are stored in private R2 storage; public API serves cached URLs.'}</p>
        <input className="input" type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} aria-label={lang === 'ur' ? 'تصویر اپ لوڈ' : 'Upload Image'} />
        {uploadBusy && <Skeleton rows={1} />}
        <div className="row" style={{ flexWrap: 'wrap', marginBlockStart: 12 }}>
          {(p.images ?? []).map((i: any) => <div key={i.id} className="card" style={{ padding: 8 }}>
            <img src={`/media/${i.r2_key}`} alt={i.alt_ur} width={120} height={120} />
            <div className="small">{i.alt_ur}</div></div>)}
          {!(p.images ?? []).length && <EmptyState title={lang === 'ur' ? 'ابھی کوئی تصویر نہیں' : 'No images yet'} />}
        </div>
        <div className="small">{lang === 'ur' ? 'پیداوار میں R2 بائنڈنگ لازمی ہے' : 'Production requires R2 binding'} <IncompleteBadge note="Production R2 binding not configured" /></div>
      </div>}
      {err && <div className="err" role="alert"><Mark kind="warn" /> {err}</div>}
      <div className="btn-row" style={{ marginBlockStart: 16 }}>
        <Button onClick={save} loading={busy}>{lang === 'ur' ? 'محفوظ کریں' : 'Save'}</Button>
        {id && <Button variant="secondary" onClick={async () => {
          await api(`/api/v1/products/${id}/publish`, { method: 'POST', body: { published: !p.is_published } });
          set('is_published', !p.is_published); toast(lang === 'ur' ? 'کیش صاف کر دی گئی' : 'Cache purged');
        }}>{p.is_published ? (lang === 'ur' ? 'ان پبلش' : 'Unpublish') : (lang === 'ur' ? 'پبلش + کیش صاف' : 'Publish & Purge')}</Button>}
        {saved && <Chip tone="success">{lang === 'ur' ? 'محفوظ' : 'Saved'}</Chip>}
      </div>
    </div>
  </div>;
}

// -------------------------------- CSV import ---------------------------------
export function ProductImport() {
  const { toast, can, t, lang } = useApp();
  const nav = useNavigate();
  const [stage, setStage] = useState(0), [rows, setRows] = useState<any[]>([]), [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [result, setResult] = useState<any>(null);
  const [mode, setMode] = useState('SKIP');
  const parse = (text: string) => {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((x) => x.trim());
    if (!lines.length) return [];
    const head = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map((line) => {
      const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
    });
  };
  if (!can('products.import')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  const stages = [
    lang === 'ur' ? 'فائل' : 'File',
    lang === 'ur' ? 'جائزہ' : 'Preview',
    lang === 'ur' ? 'تصدیق' : 'Verify',
    lang === 'ur' ? 'نتیجہ' : 'Result'
  ];
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav('/erp/products')}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1>{lang === 'ur' ? 'CSV درآمد — مصنوعات' : 'CSV Import — Products'}</h1>
      </div>
    </div>
    <div className="row" style={{ flexWrap: 'wrap' }}>{stages.map((s, i) =>
      <Chip key={s} tone={i <= stage ? 'success' : 'gray'}>{i + 1}. {s}</Chip>)}</div>
    {stage === 0 && <div className="card" style={{ marginBlockStart: 14 }}>
      <p>{lang === 'ur' ? 'ٹیمپلیٹ:' : 'Template:'} <code>name_ur,name_en,category_code,sku,base_unit,purchase_rate,sale_rate,conversion_ratio</code></p>
      <Button variant="secondary" size="sm" onClick={() => {
        const blob = new Blob(['\uFEFFname_ur,name_en,category_code,sku,base_unit,purchase_rate,sale_rate,conversion_ratio\n'], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'zt-products-template.csv'; a.click();
      }}>{lang === 'ur' ? 'خالی ٹیمپلیٹ ڈاؤن لوڈ' : 'Download Sample CSV'}</Button>
      <input className="input" type="file" accept=".csv,text/csv" aria-label="CSV فائل" onChange={(e) => {
        const f = e.target.files?.[0]; if (!f) return;
        f.text().then((txt) => { setRows(parse(txt)); setStage(1); });
      }} />
      <div className="notice small">{lang === 'ur' ? 'نمونے کی قطار شامل نہیں — پیداواری کیٹلاگ خالی رہتا ہے جب تک مالک ڈیٹا درآمد نہ کرے۔' : 'Clean template without mock rows — catalog populates strictly from owner data.'}</div>
    </div>}
    {stage === 1 && <div className="card"><p>{rows.length} {lang === 'ur' ? 'قطاریں ملیں' : 'rows parsed'}</p>
      <DataTable rows={rows.slice(0, 20)} columns={Object.keys(rows[0] ?? {}).slice(0, 6).map((k) => ({ key: k, label: k }))} csvName="preview" />
      <Button onClick={async () => {
        setBusy(true); setErr('');
        try { setReport(await api('/api/v1/import/products/preview', { method: 'POST', body: { rows } })); setStage(2); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }} loading={busy}>{lang === 'ur' ? 'سرسری جانچ (بغیر محفوظ کیے)' : 'Validate Preview (Dry-run)'}</Button>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
    </div>}
    {stage === 2 && report && <div className="card"><h2>{lang === 'ur' ? 'پیش منظر' : 'Preview Report'}</h2>
      <p>{lang === 'ur' ? `درست: ${report.valid} · ڈپلیکیٹ: ${report.duplicates} · غلط: ${report.rows.length - report.valid}` : `Valid: ${report.valid} · Duplicates: ${report.duplicates} · Errors: ${report.rows.length - report.valid}`}</p>
      <SelectField label={lang === 'ur' ? 'ڈپلیکیٹ پالیسی' : 'Duplicate Policy'} value={mode} onChange={setMode}
        options={[{ value: 'SKIP', label: lang === 'ur' ? 'چھوڑ دیں' : 'Skip' }, { value: 'UPDATE', label: lang === 'ur' ? 'اپ ڈیٹ کریں' : 'Update existing' }]} />
      <DataTable rows={report.rows} columns={[
        { key: 'row', label: '#' },
        { key: 'name_ur', label: lang === 'ur' ? 'نام' : 'Name' },
        { key: 'category', label: lang === 'ur' ? 'زمرہ' : 'Category' },
        { key: 'duplicate_id', label: lang === 'ur' ? 'ڈپلیکیٹ' : 'Duplicate' },
        { key: 'errors', label: lang === 'ur' ? 'غلطیاں' : 'Errors', render: (r: any) => r.errors?.length ? <Chip tone="danger">{r.errors.join(', ')}</Chip> : <Chip tone="success">OK</Chip> },
      ] as Column[]} csvName="import-report" />
      <Button onClick={async () => {
        setBusy(true); setErr('');
        try { setResult(await api('/api/v1/import/products/confirm', { method: 'POST', body: { rows: report.rows, mode } })); setStage(3); toast(lang === 'ur' ? 'درآمد مکمل' : 'Import completed'); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }} loading={busy}>{lang === 'ur' ? 'ایک ایٹمی بیچ میں محفوظ کریں' : 'Commit in Atomic Batch'}</Button>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
    </div>}
    {stage === 3 && result && <div className="card"><h2><Mark kind="check-circle" /> {lang === 'ur' ? 'نتیجہ' : 'Import Summary'}</h2>
      <div className="kv"><span className="k">{lang === 'ur' ? 'بنائی گئیں' : 'Created'}</span><span className="v">{result.created}</span>
        <span className="k">{lang === 'ur' ? 'اپ ڈیٹ' : 'Updated'}</span><span className="v">{result.updated}</span>
        <span className="k">{lang === 'ur' ? 'چھوڑی گئیں' : 'Skipped'}</span><span className="v">{result.skipped}</span></div>
      <Link className="btn btn-primary" to="/erp/products">{lang === 'ur' ? 'مصنوعات دیکھیں' : 'View Products'}</Link></div>}
  </div>;
}

// ---------------------------- Business book hubs ------------------------------
export function HubScreen({ book }: { book: string }) {
  const { t, can, lang } = useApp();
  const nav = useNavigate();
  const def = BOOK_MAP[book];
  const range = useRange();
  const sales = useGet<any>('hub-sales', `/api/v1/sales?from=${range.from}&to=${range.to}&limit=100`);
  const mayPurchases = can('purchases.read');
  const purchases = useGet<any>('hub-purchases', `/api/v1/purchases?from=${range.from}&to=${range.to}&limit=100`, mayPurchases);
  const stock = useGet<any[]>('hub-stock', '/api/v1/stock');
  const [tab, setTab] = useState('overview');
  const base = book === 'FERT' ? '/erp/fertilizer' : book === 'PEST' ? '/erp/pesticide' : `/erp/goods/${book}`;
  const sRows = Array.isArray(sales.data) ? sales.data : [];
  const pRows = Array.isArray(purchases.data) ? purchases.data : [];
  const stockRows = (stock.data ?? []).filter((r: any) => !r.book_code || r.book_code === book);
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1>{lang === 'ur' ? (def?.ur ?? book) : (def?.en ?? def?.ur ?? book)}</h1>
      </div>
      <div className="btn-row no-print">
        {can('purchases.post') && <Link className="btn btn-secondary btn-sm" to={`${base}/purchase/new`}>{lang === 'ur' ? '+ خرید' : '+ Purchase'}</Link>}
        {can('sales.post') && <Link className="btn btn-primary btn-sm" to={`${base}/sale/new`}>{lang === 'ur' ? '+ فروخت' : '+ Sale'}</Link>}
      </div>
    </div>
    <Tabs tabs={[{ id: 'overview', label: lang === 'ur' ? 'جائزہ' : 'Overview' }, { id: 'sales', label: lang === 'ur' ? 'فروخت' : 'Sales' }, ...(mayPurchases ? [{ id: 'purchases', label: lang === 'ur' ? 'خرید' : 'Purchases' }] : []),
      { id: 'stock', label: lang === 'ur' ? 'اسٹاک' : 'Stock' }, ...(book === 'PEST' ? [{ id: 'register', label: lang === 'ur' ? 'قانونی رجسٹر' : 'Legal Register' }] : [])]} active={tab} onChange={setTab} />
    {tab === 'overview' && <div><div className="stats-grid">
      <StatCard label={lang === 'ur' ? 'فروخت' : 'Sales'} value={formatPKR(sRows.reduce((a: number, r: any) => a + r.total_paisa, 0))} />
      {mayPurchases && <StatCard label={lang === 'ur' ? 'خرید' : 'Purchases'} value={formatPKR(pRows.reduce((a: number, r: any) => a + r.total_paisa, 0))} />}
      <StatCard label={lang === 'ur' ? 'فروخت دستاویزات' : 'Sales Documents'} value={sRows.length} />
      {mayPurchases && <StatCard label={lang === 'ur' ? 'خرید دستاویزات' : 'Purchase Documents'} value={pRows.length} />}
    </div>
      <div className="notice info">{lang === 'ur' ? 'یہ کھاتہ الگ لیجر رکھتا ہے؛ تمام پوسٹنگ ایک ایٹمی db.batch() میں ہوتی ہے۔' : 'This ledger maintains distinct books; all postings commit inside an atomic db.batch().'}</div>
      {book === 'FERT' && <div className="btn-row" style={{ marginTop: 10 }}><Link className="btn btn-secondary btn-sm" to="/erp/reports?report=fertilizer-register">{lang === 'ur' ? 'کھاد فروخت رجسٹر' : 'Fertilizer Sales Register'}</Link>
        <Link className="btn btn-secondary btn-sm" to="/erp/reports?report=expiry">{lang === 'ur' ? 'ایکسپائری رپورٹ' : 'Expiry Report'}</Link></div>}
      {book === 'PEST' && <div className="notice" style={{ marginTop: 10 }}>{lang === 'ur' ? 'پیسٹی سائیڈ فروخت میں خریدار کا نام، موبائل اور پتہ لازمی ہیں؛ ایکسپائری ختم / قرنطینہ بیچ بلاک ہے۔ لائسنس نمبر صرف مالک ترتیبات میں درج کرے گا۔' : 'Pesticide sales strictly require buyer name, phone, and address. Expired batches are blocked. License numbers are configured in settings.'}</div>}
    </div>}
    {tab === 'sales' && <AsyncView loading={sales.isLoading} error={sales.error} retry={() => sales.refetch()} empty={!sRows.length}>
      <DataTable rows={sRows} csvName={`${book}-sales`} columns={[
        { key: 'number', label: lang === 'ur' ? 'نمبر' : 'Number' }, { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' },
        { key: 'total_paisa', label: lang === 'ur' ? 'کل' : 'Total', render: (r: any) => money(r.total_paisa) },
        { key: 'due_paisa', label: lang === 'ur' ? 'بقایا' : 'Due', render: (r: any) => money(r.due_paisa) },
        { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status', render: (r: any) => <StatusChip status={r.status} /> },
      ] as Column[]} /></AsyncView>}
    {tab === 'purchases' && <AsyncView loading={purchases.isLoading} error={purchases.error} retry={() => purchases.refetch()} empty={!pRows.length}>
      <DataTable rows={pRows} csvName={`${book}-purchases`} columns={[
        { key: 'number', label: lang === 'ur' ? 'نمبر' : 'Number' }, { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' },
        { key: 'total_paisa', label: lang === 'ur' ? 'کل' : 'Total', render: (r: any) => money(r.total_paisa) },
        { key: 'due_paisa', label: lang === 'ur' ? 'بقایا' : 'Due', render: (r: any) => money(r.due_paisa) },
      ] as Column[]} /></AsyncView>}
    {tab === 'stock' && <AsyncView loading={stock.isLoading} error={stock.error} retry={() => stock.refetch()} empty={!stockRows.length}>
      <DataTable rows={stockRows} csvName={`${book}-stock`} columns={[
        { key: 'name_ur', label: lang === 'ur' ? 'مصنوعات' : 'Product' }, { key: 'qty_milli', label: lang === 'ur' ? 'تعداد' : 'Quantity', render: (r: any) => <span className="num">{fromMilli(r.qty_milli)}</span> },
        { key: 'value_paisa', label: lang === 'ur' ? 'مالیت' : 'Value', render: (r: any) => money(r.value_paisa) },
      ] as Column[]} /></AsyncView>}
    {tab === 'register' && <PesticideRegister />}
  </div>;
}
function PesticideRegister() {
  const { data, isLoading, error, refetch } = useGet<any>('pesticide-register', '/api/v1/reports/pesticide-register');
  const { lang } = useApp();
  return <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!data?.rows?.length}>
    <div className="notice">{lang === 'ur' ? 'یہ سافٹ ویئر صرف ریکارڈ/ایکسپورٹ رکھتا ہے؛ کسی سرکاری پورٹل پر فائلنگ کا دعویٰ نہیں۔ ضابطہ مالک ضلع زراعت دفتر لیہ سے تصدیق کرے۔' : 'This module maintains internal trade records and exports; no direct filing to government portals is claimed.'}</div>
    <DataTable rows={data?.rows ?? []} csvName="pesticide-register" columns={[
      { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'number', label: lang === 'ur' ? 'رسید' : 'Receipt' }, { key: 'buyer', label: lang === 'ur' ? 'خریدار' : 'Buyer' },
      { key: 'product', label: lang === 'ur' ? 'مصنوعات' : 'Product' }, { key: 'batch', label: lang === 'ur' ? 'بیچ' : 'Batch' },
      { key: 'qty', label: lang === 'ur' ? 'تعداد' : 'Quantity' }, { key: 'amount_paisa', label: lang === 'ur' ? 'رقم' : 'Amount', render: (r: any) => money(r.amount_paisa) },
    ] as Column[]} />
  </AsyncView>;
}

// --------------------------------- Crop page ---------------------------------
export function CropPage() {
  const { crop = 'WHEAT' } = useParams();
  const { can, t, lang } = useApp();
  const nav = useNavigate();
  const range = useRange();
  const lots = useGet<any[]>('grain-lots', `/api/v1/grains/lots?crop=${crop}`, can('grains.read'));
  const settings = useGet<any>('settings', '/api/v1/settings', can('settings.read'));
  const docs = useGet<any[]>('crop-docs', `/api/v1/documents?from=${range.from}&to=${range.to}&q=${crop}`, can('documents.read'));
  const maundKg = settings.data?.maund_kg ?? 0;
  const [tab, setTab] = useState('lots');
  const def = BOOK_MAP[crop];
  if (!can('grains.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon={crop} label={lang === 'ur' ? (def?.ur ?? crop) : (def?.en ?? crop)} size={34} />{lang === 'ur' ? (def?.ur ?? crop) : (def?.en ?? crop)}</h1>
      </div>
      <div className="btn-row no-print">
        {can('grains.post') && <Link className="btn btn-secondary btn-sm" to={`/erp/grains/${crop}/purchase/new`}>{lang === 'ur' ? '+ خرید (وزن)' : '+ Purchase (Weight)'}</Link>}
        {can('grains.post') && <Link className="btn btn-primary btn-sm" to={`/erp/grains/${crop}/sale/new`}>{lang === 'ur' ? '+ فروخت' : '+ Sale'}</Link>}
      </div>
    </div>
    {settings.data && !maundKg && <div className="notice"><Mark kind="warn" /> {lang === 'ur' ? '«ایک من = کتنے کلو» مالک نے تصدیق نہیں کی — فی من ریٹ بلاک ہے۔' : 'Maund conversion (kg per maund) unconfirmed — per-maund pricing is disabled until verified in Settings.'}</div>}
    <Tabs tabs={[{ id: 'lots', label: lang === 'ur' ? 'لاٹس' : 'Lots' }, { id: 'docs', label: lang === 'ur' ? 'دستاویزات' : 'Documents' }, { id: 'recon', label: lang === 'ur' ? 'لاٹ مفاہمت' : 'Lot Recon' }]} active={tab} onChange={setTab} />
    {tab === 'lots' && <AsyncView loading={lots.isLoading} error={lots.error} retry={() => lots.refetch()} empty={!(lots.data ?? []).length}>
      <DataTable rows={lots.data ?? []} csvName={`${crop}-lots`} columns={[
        { key: 'lot_no', label: lang === 'ur' ? 'لاٹ' : 'Lot No' },
        { key: 'grade', label: lang === 'ur' ? 'گریڈ' : 'Grade' },
        { key: 'balance_grams', label: lang === 'ur' ? 'بیلنس (کلو)' : 'Balance (kg)', render: (r: any) => <span className="num">{(r.balance_grams / 1000).toFixed(3)}</span> },
        { key: 'opened_at', label: lang === 'ur' ? 'تاریخ' : 'Date' },
      ] as Column[]} /></AsyncView>}
    {tab === 'docs' && <AsyncView loading={docs.isLoading} error={docs.error} retry={() => docs.refetch()} empty={!(docs.data ?? []).length}>
      <DataTable rows={docs.data ?? []} csvName={`${crop}-docs`} columns={[
        { key: 'number', label: lang === 'ur' ? 'نمبر' : 'Number' },
        { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' },
        { key: 'type', label: lang === 'ur' ? 'قسم' : 'Type' },
        { key: 'amount_paisa', label: lang === 'ur' ? 'رقم' : 'Amount', render: (r: any) => money(r.amount_paisa) },
      ] as Column[]} /></AsyncView>}
    {tab === 'recon' && <div className="card"><h2>{lang === 'ur' ? 'لاٹ مفاہمت' : 'Lot Reconciliation'}</h2>
      <p className="small">{lang === 'ur' ? 'ہر لاٹ: کچا وزن − ٹیر − کٹوتیاں = خالص وزن؛ خرید − فروخت − ایڈجسٹمنٹ = بقیہ۔' : 'Each lot: Gross weight − Tare − Deductions = Net Weight; Purchases − Sales − Adjustments = Remaining Lot Balance.'}</p>
      <DataTable rows={lots.data ?? []} csvName={`${crop}-recon`} columns={[
        { key: 'lot_no', label: lang === 'ur' ? 'لاٹ' : 'Lot No' },
        { key: 'purchased_grams', label: lang === 'ur' ? 'خرید (کلو)' : 'Purchased (kg)', render: (r: any) => <span className="num">{((r.purchased_grams ?? 0) / 1000).toFixed(3)}</span> },
        { key: 'sold_grams', label: lang === 'ur' ? 'فروخت (کلو)' : 'Sold (kg)', render: (r: any) => <span className="num">{((r.sold_grams ?? 0) / 1000).toFixed(3)}</span> },
        { key: 'balance_grams', label: lang === 'ur' ? 'بقیہ' : 'Remaining (kg)', render: (r: any) => <span className="num">{(r.balance_grams / 1000).toFixed(3)}</span> },
      ] as Column[]} />
    </div>}
  </div>;
}

// --------------------------------- Khata centre ------------------------------
export function KhataCentre() {
  const { can, t, lang } = useApp();
  const nav = useNavigate();
  const range = useRange();
  const [book, setBook] = useState('');
  const [party, setParty] = useState('');
  const parties = useGet<any[]>('parties-ref', '/api/v1/parties?limit=100');
  const books = useGet<any>('khata-books', '/api/v1/khata/books');
  const ageing = useGet<any>('khata-ageing', '/api/v1/khata/ageing');
  const q = `/api/v1/khata?from=${range.from}&to=${range.to}&book=${encodeURIComponent(book)}&party=${encodeURIComponent(party)}`;
  const khata = useGet<any>(q, q);
  const [statement, setStatement] = useState<DocumentSnapshot | null>(null);
  const cols: Column[] = [
    { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'description_ur', label: lang === 'ur' ? 'تفصیل' : 'Description' },
    { key: 'ref_type', label: lang === 'ur' ? 'حوالہ' : 'Ref' },
    { key: 'debit_paisa', label: lang === 'ur' ? 'ڈیبٹ' : 'Debit', render: (r: any) => money(r.debit_paisa ?? (r.direction === 'IN' ? r.amount_paisa : 0)) },
    { key: 'credit_paisa', label: lang === 'ur' ? 'کریڈٹ' : 'Credit', render: (r: any) => money(r.credit_paisa ?? (r.direction === 'OUT' ? r.amount_paisa : 0)) },
    { key: 'running_paisa', label: lang === 'ur' ? 'بیلنس' : 'Balance', render: (r: any) => money(r.running_paisa) },
  ];
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="khata" label={lang === 'ur' ? 'کھاتہ سینٹر' : 'Khata Centre'} size={34} />{lang === 'ur' ? 'کھاتہ سینٹر' : 'Khata Centre'}</h1>
      </div>
      <div className="btn-row no-print">
        <Link className="btn btn-secondary btn-sm" to="/erp/receipts/new">{lang === 'ur' ? '+ رسید' : '+ Receipt'}</Link>
        <Link className="btn btn-secondary btn-sm" to="/erp/payments/new">{lang === 'ur' ? '+ ادائیگی' : '+ Payment'}</Link>
      </div>
    </div>
    <div className="grid g2">
      <div className="card"><h2>{lang === 'ur' ? 'تمام کھاتہ جات' : 'All Ledgers'}</h2>
        <DataTable rows={[...(books.data?.books ?? []), ...(books.data?.money_books ?? [])]} csvName="khata-books" columns={[
          { key: 'book_code', label: lang === 'ur' ? 'کھاتہ' : 'Ledger' }, { key: 'debit_paisa', label: lang === 'ur' ? 'ڈیبٹ' : 'Debit', money: true },
          { key: 'credit_paisa', label: lang === 'ur' ? 'کریڈٹ' : 'Credit', money: true }, { key: 'balance_paisa', label: lang === 'ur' ? 'بیلنس' : 'Balance', money: true },
        ] as Column[]} /></div>
      <div className="card"><h2>{lang === 'ur' ? 'وصولی عمر (Ageing)' : 'Receivables Ageing'}</h2>
        {(ageing.data?.debtors ?? []).length ? <DataTable rows={ageing.data.debtors} csvName="ageing" columns={[
          { key: 'name_ur', label: lang === 'ur' ? 'فریق' : 'Party' }, { key: 'bucket', label: lang === 'ur' ? 'مدت' : 'Bucket' },
          { key: 'balance_paisa', label: lang === 'ur' ? 'بقایا' : 'Due', money: true },
        ] as Column[]} /> : <EmptyState title={lang === 'ur' ? 'کوئی بقایا نہیں' : 'No balance due'} />}
        <div className="small">{JSON.stringify(ageing.data?.buckets ?? {})}</div></div>
    </div>
    <div className="card" style={{ marginBlockStart: 16 }}><div className="between"><h2>{lang === 'ur' ? 'لیجر' : 'Ledger'}</h2>
      <div className="btn-row"><SelectField label="" value={book} onChange={setBook} placeholder={lang === 'ur' ? 'تمام کھاتہ جات' : 'All Ledgers'}
        options={BOOKS.map((b) => ({ value: b.code, label: lang === 'ur' ? b.ur : (b.en || b.ur) }))} />
        <SelectField label="" value={party} onChange={setParty} placeholder={lang === 'ur' ? 'تمام فریق' : 'All Parties'}
          options={(parties.data ?? []).map((p: any) => ({ value: p.id, label: p.name_ur }))} />
        <Button variant="ghost" size="sm" onClick={async () => {
          const r = await api<any>(`/api/v1/statements?from=${range.from}&to=${range.to}&book=${book}&party_id=${party}`);
          setStatement(r.snapshot);
        }}>{lang === 'ur' ? 'اسٹیٹمنٹ' : 'Statement'}</Button></div></div>
      <AsyncView loading={khata.isLoading} error={khata.error} retry={() => khata.refetch()} empty={!(khata.data?.withBalance ?? []).length}>
        <div className="kv"><span className="k">{lang === 'ur' ? 'ابتدائی' : 'Opening'}</span><span className="v num">{formatPKR(khata.data?.opening_paisa ?? 0)}</span>
          <span className="k">{lang === 'ur' ? 'ڈیبٹ' : 'Debit'}</span><span className="v num">{formatPKR(khata.data?.debit_paisa ?? 0)}</span>
          <span className="k">{lang === 'ur' ? 'کریڈٹ' : 'Credit'}</span><span className="v num">{formatPKR(khata.data?.credit_paisa ?? 0)}</span>
          <span className="k">{lang === 'ur' ? 'اختتامی' : 'Closing'}</span><span className="v num">{formatPKR(khata.data?.closing_balance_paisa ?? 0)}</span></div>
        <DataTable rows={khata.data?.withBalance ?? []} columns={cols} csvName="khata-ledger" />
      </AsyncView>
    </div>
    {statement && <Sheet open={!!statement} onClose={() => setStatement(null)} title={lang === 'ur' ? 'کھاتہ اسٹیٹمنٹ' : 'Ledger Statement'}>
      <PrintActions snapshot={statement} /></Sheet>}
  </div>;
}

export function PartyKhata() {
  const { id } = useParams();
  const { lang } = useApp();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useGet<any>('party', `/api/v1/parties/${id}`);
  const range = useRange();
  const [statement, setStatement] = useState<DocumentSnapshot | null>(null);
  return <div><AsyncView loading={isLoading} error={error} retry={() => refetch()}>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="parties" label={data?.name_ur ?? ''} size={34} />{lang === 'ur' ? data?.name_ur : (data?.name_en || data?.name_ur)}</h1>
      </div>
      <div className="btn-row no-print">
        <Link className="btn btn-secondary btn-sm" to="/erp/receipts/new">{lang === 'ur' ? '+ رسید' : '+ Receipt'}</Link>
        <Link className="btn btn-secondary btn-sm" to="/erp/payments/new">{lang === 'ur' ? '+ ادائیگی' : '+ Payment'}</Link>
      </div>
    </div>
    <div className="stats-grid">
      <StatCard label={lang === 'ur' ? 'بیلنس' : 'Balance'} value={formatPKR(data?.balance_paisa ?? 0)} />
      <StatCard label={lang === 'ur' ? 'قسم' : 'Type'} value={data?.type ?? ''} />
      <StatCard label={lang === 'ur' ? 'موبائل' : 'Phone'} value={data?.phone ?? '—'} />
      <StatCard label={lang === 'ur' ? 'کریڈٹ حد' : 'Credit Limit'} value={formatPKR(data?.credit_limit_paisa ?? 0)} />
    </div>
    <div className="card" style={{ marginBlock: 16 }}><div className="between"><h2>{lang === 'ur' ? 'لین دین' : 'Transactions'}</h2>
      <Button size="sm" variant="ghost" onClick={async () => {
        const r = await api<any>(`/api/v1/statements?from=${range.from}&to=${range.to}&party_id=${id}`);
        setStatement(r.snapshot);
      }}>{lang === 'ur' ? 'پرنٹ / PDF' : 'Print / PDF'}</Button></div>
      <DataTable rows={data?.ledger ?? []} csvName="party-ledger" columns={[
        { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'description_ur', label: lang === 'ur' ? 'تفصیل' : 'Description' },
        { key: 'debit_paisa', label: lang === 'ur' ? 'ڈیبٹ' : 'Debit', money: true }, { key: 'credit_paisa', label: lang === 'ur' ? 'کریڈٹ' : 'Credit', money: true },
      ] as Column[]} />
      {!!data?.allocations?.length && <><h3>{lang === 'ur' ? 'الاٹمنٹ' : 'Allocations'}</h3><DataTable rows={data.allocations} columns={[
        { key: 'receipt_id', label: lang === 'ur' ? 'رسید' : 'Receipt' }, { key: 'invoice_id', label: lang === 'ur' ? 'انوائس' : 'Invoice' },
        { key: 'amount_paisa', label: lang === 'ur' ? 'رقم' : 'Amount', money: true },
      ] as Column[]} csvName="allocations" /></>}
    </div>
    {statement && <Sheet open={!!statement} onClose={() => setStatement(null)} title={lang === 'ur' ? 'فریق کھاتہ' : 'Party Statement'}><PrintActions snapshot={statement} /></Sheet>}
  </AsyncView></div>;
}

// -------------------------------- Reports gallery ----------------------------
const REPORTS = [
  { id: 'trial-balance', ur: 'ٹرائل بیلنس', en: 'Trial balance' }, { id: 'pnl', ur: 'نفع و نقصان', en: 'P&L' },
  { id: 'balance-sheet', ur: 'بیلنس شیٹ', en: 'Balance sheet' }, { id: 'daybook', ur: 'روزنامچہ', en: 'Daybook' },
  { id: 'cashbook', ur: 'کیش بک', en: 'Cashbook' }, { id: 'stock', ur: 'اسٹاک رپورٹ', en: 'Stock' },
  { id: 'expiry', ur: 'ایکسپائری', en: 'Expiry' }, { id: 'pesticide-register', ur: 'پیسٹی رجسٹر', en: 'Pesticide register' },
  { id: 'fertilizer-register', ur: 'کھاد رجسٹر', en: 'Fertilizer register' },
  { id: 'reconcile', ur: 'مفاہمت', en: 'Reconciliation' }, { id: 'khata-ageing', ur: 'عمرِ بقایا', en: 'Ageing' },
  { id: 'grain-summary', ur: 'اجناس خلاصہ', en: 'Grain summary' },
];
export function ReportsGallery() {
  const { lang } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const active = params.get('report') ?? 'trial-balance';
  const range = useRange();
  const [book, setBook] = useState('');
  const path = active === 'khata-ageing' ? '/api/v1/khata/ageing'
    : active === 'grain-summary' ? '/api/v1/grains/summary'
    : `/api/v1/reports/${active}?from=${range.from}&to=${range.to}&book=${book}`;
  const { data, isLoading, error, refetch } = useGet<any>(active, path);
  const rows = Array.isArray(data) ? data : (data?.rows ?? data?.debtors ?? data?.per_book ?? []);
  const cols: Column[] = rows.length ? Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object').slice(0, 7).map((k) => ({
    key: k, label: k.replace(/_paisa$/, ' (Rs)').replace(/_milli$/, ''),
    render: k.endsWith('_paisa') ? (r: any) => money(r[k]) : k.endsWith('_milli') ? (r: any) => <span className="num">{fromMilli(r[k])}</span> : undefined,
  })) : [];
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="reports" label={lang === 'ur' ? 'رپورٹس گیلری' : 'Reports Gallery'} size={34} />{lang === 'ur' ? 'رپورٹس گیلری' : 'Reports Gallery'}</h1>
      </div>
    </div>
    <div className="tile-grid">{REPORTS.map((r) => <button key={r.id} className={`tile ${active === r.id ? 'active' : ''}`}
      onClick={() => setParams({ report: r.id })}><NavIcon icon="reports" label={lang === 'ur' ? r.ur : r.en} size={44} /><strong>{lang === 'ur' ? r.ur : r.en}</strong><span className="small">{lang === 'ur' ? r.en : r.ur}</span></button>)}</div>
    <div className="card" style={{ marginBlockStart: 16 }}>
      <div className="between"><h2>{lang === 'ur' ? (REPORTS.find((r) => r.id === active)?.ur) : (REPORTS.find((r) => r.id === active)?.en || REPORTS.find((r) => r.id === active)?.ur)}</h2>
        <div className="btn-row"><SelectField label="" value={book} onChange={setBook} placeholder={lang === 'ur' ? 'تمام کھاتہ جات' : 'All Ledgers'}
          options={BOOKS.map((b) => ({ value: b.code, label: lang === 'ur' ? b.ur : (b.en || b.ur) }))} />
          <Button variant="ghost" size="sm" onClick={() => window.print()}><Mark kind="print" /> PDF</Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()} aria-label={lang === 'ur' ? 'دوبارہ لوڈ' : 'Reload'}><Mark kind="sync" /></Button></div></div>
      <RangePicker from={range.from} to={range.to} setFrom={range.setFrom} setTo={range.setTo} />
      {active === 'trial-balance' && data && <div className={`notice ${data.balanced ? 'success' : ''}`}>
        {data.balanced ? <><Mark kind="check" /> {lang === 'ur' ? 'ڈیبٹ = کریڈٹ (H4)' : 'Debit = Credit (Balanced)'}</> : <><Mark kind="warn" /> {lang === 'ur' ? 'جرنل غیر متوازن' : 'Journal Unbalanced'}</>} — {lang === 'ur' ? 'ڈیبٹ' : 'Debit'} {formatPKR(data.totals?.debit_paisa ?? 0)} / {lang === 'ur' ? 'کریڈٹ' : 'Credit'} {formatPKR(data.totals?.credit_paisa ?? 0)}</div>}
      {active === 'pnl' && data && <div className="kv"><span className="k">{lang === 'ur' ? 'آمدنی' : 'Income'}</span><span className="v num">{formatPKR(data.income_paisa)}</span>
        <span className="k">{lang === 'ur' ? 'اخراجات' : 'Expenses'}</span><span className="v num">{formatPKR(data.expenses_paisa)}</span>
        <span className="k">{lang === 'ur' ? 'خالص منافع' : 'Net Profit'}</span><span className="v num">{formatPKR(data.net_profit_paisa)}</span></div>}
      <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!rows.length}>
        <DataTable rows={rows} columns={cols} csvName={active} footer={<span className="num">{rows.length} {lang === 'ur' ? 'قطاریں' : 'rows'}</span>} />
      </AsyncView>
      <div className="notice info small">{lang === 'ur' ? 'رپورٹس براہِ راست D1 پری اگریگیٹ / جرنل لائنز سے پڑھی جاتی ہیں؛ کوئی فرضی اعداد نہیں۔' : 'Reports read directly from verified D1 journal lines and pre-aggregates; zero mock data.'}</div>
    </div>
  </div>;
}

// ------------------------------ Documents centre -----------------------------
export function DocumentsCentre() {
  const { t, lang } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const range = useRange('2020-01-01');
  const [q, setQ] = useState(params.get('q') ?? ''), [type, setType] = useState(params.get('type') ?? '');
  const [selected, setSelected] = useState<any>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const path = `/api/v1/documents?from=${range.from}&to=${range.to}&q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`;
  const { data, isLoading, error, refetch } = useGet<any[]>(path, path);
  const open = async (row: any) => {
    setBusy(true); setErr('');
    try { setSelected(await api<any>(`/api/v1/documents/${row.id}`)); }
    catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
  };
  const pick = (id: string) => { const row = (data ?? []).find((r) => r.id === id); if (row) void open(row); };
  /** Legacy rows were posted before snapshots carried doc_id; the row id IS the document ULID,
   *  so it is the correct fallback for printing/verification. */
  const snapshot = selected ? { ...selected.snapshot, doc_id: selected.snapshot?.doc_id ?? selected.id } : null;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="documents" label={lang === 'ur' ? 'دستاویزات سینٹر' : 'Documents Centre'} size={34} />{lang === 'ur' ? 'دستاویزات سینٹر' : 'Documents Centre'}</h1>
      </div>
      <div className="btn-row no-print">
        <Link className="btn btn-primary btn-sm" to="/erp/create">{lang === 'ur' ? '+ نیا اندراج / انوائس' : '+ New Invoice / Entry'}</Link>
      </div>
    </div>
    <div className="toolbar no-print"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === 'ur' ? 'نمبر / نام تلاش کریں' : 'Search number / name'} />
      <SelectField label="" value={type} onChange={setType} placeholder={lang === 'ur' ? 'تمام اقسام' : 'All Types'}
        options={['SALE', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'EXPENSE', 'GRAIN_PURCHASE', 'GRAIN_SALE', 'RETURN', 'PAYROLL', 'TRANSFER'].map((x) => ({ value: x, label: x }))} />
      <SelectField label={t('invoices')} value={selected?.id ?? ''} onChange={pick} placeholder={t('selectInvoice')}
        options={(data ?? []).map((r: any) => ({ value: r.id, label: `${r.number} — ${r.date}` }))} />
      <Button variant="ghost" size="sm" onClick={() => refetch()} aria-label={lang === 'ur' ? 'دوبارہ لوڈ' : 'Reload'}><Mark kind="sync" /></Button></div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <DataTable rows={data ?? []} csvName="documents" onRow={open} columns={[
        { key: 'number', label: lang === 'ur' ? 'نمبر' : 'Number' }, { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'type', label: lang === 'ur' ? 'قسم' : 'Type' },
        { key: 'book_code', label: lang === 'ur' ? 'کتاب / کھاتہ' : 'Ledger' },
        { key: 'amount_paisa', label: lang === 'ur' ? 'رقم' : 'Amount', render: (r: any) => money(r.amount_paisa) },
        { key: 'template_version', label: lang === 'ur' ? 'ٹیمپلیٹ' : 'Template' },
      ] as Column[]} />
    </AsyncView>
    {err && <div className="err"><Mark kind="warn" /> {err}</div>}
    {busy && <Skeleton rows={2} />}
    <Sheet open={!!selected} onClose={() => setSelected(null)} title={`دستاویز ${selected?.number ?? ''}`}>
      {selected && snapshot && <>
        <div className="notice info small">{t('snapshotHeading')} · {t('printTemplateNote')} <code>{selected.template_version}</code></div>
        {/* The invoice selector lives in the sheet too, so a different document can be picked
            without closing the preview. */}
        <SelectField label={t('selectInvoice')} value={selected.id ?? ''} onChange={pick}
          options={(data ?? []).map((r: any) => ({ value: r.id, label: `${r.number} — ${r.date}` }))} />
        <div className="card">
          <h3>{t('docSummary')}</h3>
          <div className="kv">
            <span className="k">{t('reference')}</span><span className="v num">{selected.number}</span>
            <span className="k">{t('date')}</span><span className="v num">{selected.date}</span>
            <span className="k">{t('party')}</span><span className="v">{snapshot.party?.name || '—'}</span>
            <span className="k">{t('total')}</span><span className="v num">{formatPKR(snapshot.total_paisa ?? selected.amount_paisa ?? 0)}</span>
            <span className="k">{t('paid')}</span><span className="v num">{formatPKR(snapshot.paid_paisa ?? 0)}</span>
            <span className="k">{t('due')}</span><span className="v num">{formatPKR(snapshot.due_paisa ?? 0)}</span>
            <span className="k">{t('linesCount')}</span><span className="v num">{(snapshot.lines ?? []).length}</span>
            <span className="k">{t('verificationCode')}</span><span className="v num"><code>{snapshot.doc_id}</code></span>
          </div>
        </div>
        <PrintActions snapshot={snapshot} />
        {/* Developer detail stays available, but folded away instead of dominating the screen. */}
        <details className="card">
          <summary className="small">{t('rawJson')}</summary>
          <pre style={{ whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'start' }}>{JSON.stringify(snapshot, null, 2)}</pre>
        </details>
        <div className="notice info small">{lang === 'ur'
          ? 'ریورس / ترمیم: پوسٹڈ ریکارڈ کبھی ایڈٹ نہیں ہوتا — وجہ، صارف اور ٹائم اسٹیمپ کے ساتھ ریورس + نیا ریکارڈ بنتا ہے (H2)۔'
          : 'Reversal / edit: a posted record is never edited — a reversal plus a new record is created with the reason, user and timestamp (H2).'}</div>
      </>}
    </Sheet>
  </div>;
}

// --------------------------------- Sync centre -------------------------------
export function SyncCentre() {
  const { syncNow, syncing, pending, conflicts, online, lastSync, toast, lang } = useApp();
  const nav = useNavigate();
  const ops = useGet<any[]>('sync-ops', '/api/v1/sync/operations');
  const serverConflicts = useGet<any[]>('sync-conflicts', '/api/v1/sync/conflicts');
  const [localOps, setLocalOps] = useState<any[]>([]);
  const [resolve, setResolve] = useState<any>(null), [reason, setReason] = useState('');
  useEffect(() => { void ztdb.outbox.orderBy('created_at').reverse().limit(100).toArray().then(setLocalOps); }, [pending, conflicts]);
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="sync" label={lang === 'ur' ? 'سنک سینٹر' : 'Sync Centre'} size={34} />{lang === 'ur' ? 'سنک سینٹر' : 'Sync Centre'}</h1>
      </div>
      <Button onClick={async () => { const r = await syncNow(); toast(`${r.sent} ${lang === 'ur' ? 'کامیاب' : 'sent'}, ${r.conflicts} ${lang === 'ur' ? 'تضاد' : 'conflicts'}`); ops.refetch(); setLocalOps(await ztdb.outbox.orderBy('created_at').reverse().limit(100).toArray()); }} loading={syncing}>{lang === 'ur' ? 'ابھی سنک کریں' : 'Sync Now'}</Button>
    </div>
    <div className="stats-grid">
      <StatCard label={lang === 'ur' ? 'نیٹ ورک' : 'Network'} value={online ? (lang === 'ur' ? 'آن لائن' : 'Online') : (lang === 'ur' ? 'آف لائن' : 'Offline')} />
      <StatCard label={lang === 'ur' ? 'مقامی قطار' : 'Local Queue'} value={pending} />
      <StatCard label={lang === 'ur' ? 'مقامی تضادات' : 'Local Conflicts'} value={conflicts} tone={conflicts ? 'var(--danger)' : undefined} />
      <StatCard label={lang === 'ur' ? 'آخری سنک' : 'Last Sync'} value={lastSync ?? '—'} /></div>
    <div className="notice info small">{lang === 'ur' ? 'Background Sync کافی نہیں: ایپ کھلنے، online ایونٹ، نظر آتے وقت 60 سیکنڈ ٹائمر اور دستی «ابھی سنک کریں» — چاروں triggers فعال ہیں۔ ہر آپریشن کا idempotency_key منفرد ہے؛ دو آلات پر آخری اسٹاک بیچنے پر خاموش اوور رائٹ نہیں، بلکہ CONFLICT فلیگ بنتا ہے۔' : 'Multi-trigger sync: on-open, online event, 60s visible poll, and manual trigger. Every operation carries a unique idempotency key.'}</div>
    <div className="card"><h2>{lang === 'ur' ? 'مقامی آؤٹ باکس (IndexedDB)' : 'Local Outbox (IndexedDB)'}</h2>
      <DataTable rows={localOps} csvName="local-outbox" columns={[
        { key: 'type', label: lang === 'ur' ? 'قسم' : 'Type' }, { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status', render: (r: any) => <StatusChip status={r.status} /> },
        { key: 'tries', label: lang === 'ur' ? 'کوششیں' : 'Tries' }, { key: 'server_number', label: lang === 'ur' ? 'سرور نمبر' : 'Server Number' },
        { key: 'error', label: lang === 'ur' ? 'خرابی' : 'Error' },
      ] as Column[]} /></div>
    <div className="card" style={{ marginBlock: 16 }}><h2>{lang === 'ur' ? 'سرور آپریشنز' : 'Server Operations'}</h2>
      <AsyncView loading={ops.isLoading} error={ops.error} retry={() => ops.refetch()} empty={!(ops.data ?? []).length}>
        <DataTable rows={ops.data ?? []} csvName="server-sync" columns={[
          { key: 'type', label: lang === 'ur' ? 'قسم' : 'Type' }, { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status', render: (r: any) => <StatusChip status={r.status} /> },
          { key: 'device_id', label: lang === 'ur' ? 'ڈیوائس' : 'Device' }, { key: 'error', label: lang === 'ur' ? 'خرابی' : 'Error' },
        ] as Column[]} /></AsyncView></div>
    <div className="card"><h2>{lang === 'ur' ? 'تضادات' : 'Conflicts'}</h2>
      <AsyncView loading={serverConflicts.isLoading} error={serverConflicts.error} retry={() => serverConflicts.refetch()} empty={!(serverConflicts.data ?? []).length}>
        <DataTable rows={serverConflicts.data ?? []} csvName="conflicts" onRow={(r) => setResolve(r)} columns={[
          { key: 'code', label: lang === 'ur' ? 'کوڈ' : 'Code' }, { key: 'message_ur', label: lang === 'ur' ? 'پیغام' : 'Message' },
          { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status', render: (r: any) => <StatusChip status={r.status} /> },
        ] as Column[]} /></AsyncView>
      <div className="small">{lang === 'ur' ? 'وجہ درج کر کے ACCEPT (دوبارہ پوسٹ) یا REJECT منتخب کریں — دونوں آڈٹ ہوتے ہیں۔' : 'Audit-logged conflict resolution: select Accept or Reject with a recorded reason.'}</div>
    </div>
    <ConfirmDialog open={!!resolve} onClose={() => setResolve(null)} reasonRequired title={lang === 'ur' ? 'تضاد حل کریں' : 'Resolve Conflict'}
      onConfirm={async (r) => {
        try {
          await api(`/api/v1/sync/resolve/${resolve.id}`, { method: 'POST', body: { action: 'REJECT', reason: r } });
          toast(lang === 'ur' ? 'تضاد مسترد / حل' : 'Conflict resolved'); setResolve(null); serverConflicts.refetch();
        } catch (e: any) { toast(e.message_ur ?? String(e), 'err'); }
      }} />
    <div className="notice small" style={{ marginBlockStart: 16 }}>{lang === 'ur' ? 'PIN سے کیش انکرپشن' : 'Cache encryption with PIN'} <Chip tone="success">COMPLETE</Chip> — PBKDF2 310,000 → AES-256-GCM</div>
  </div>;
}

// ----------------------------------- Backup ----------------------------------
export function BackupScreen() {
  const { toast, lang } = useApp();
  const nav = useNavigate();
  const logs = useGet<any[]>('backup-logs', '/api/v1/backup');
  const jobs = useGet<any[]>('ops-jobs', '/api/v1/ops/jobs');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="backup" label={lang === 'ur' ? 'بیک اپ اور بحالی' : 'Backup & Restore'} size={34} />{lang === 'ur' ? 'بیک اپ اور بحالی' : 'Backup & Restore'}</h1>
      </div>
      <div className="btn-row no-print">
        <Button onClick={async () => {
          setBusy(true); setErr('');
          try { const r = await api<any>('/api/v1/backup/run', { method: 'POST', body: {} }); toast(`بیک اپ: ${r.status ?? 'OK'}`); logs.refetch(); }
          catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
        }} loading={busy}>{lang === 'ur' ? 'ابھی بیک اپ چلائیں' : 'Run Backup Now'}</Button>
        <Button variant="secondary" onClick={() => void downloadCsv('/api/v1/backup/download', 'zt-backup.bin')}>{lang === 'ur' ? 'آخری بیک اپ ڈاؤن لوڈ' : 'Download Backup'}</Button>
      </div>
    </div>
    <div className="notice"><Mark kind="warn" /> {lang === 'ur' ? 'بیک اپ صرف اسی وقت «درست» مانا جاتا ہے جب scripts/restore.ts کے ذریعے staging پر بحالی ٹیسٹ پاس ہو۔ D1 Time Travel محفوظ جال ہے، مگر رات کا انکرپٹڈ R2 بیک اپ لازمی ہے۔' : 'Backup is only certified after staging restore test. D1 Time Travel safety net plus nightly encrypted R2 backups.'}</div>
    {err && <div className="err"><Mark kind="warn" /> {err}</div>}
    <div className="card"><h2>{lang === 'ur' ? 'بیک اپ لاگ' : 'Backup Log'}</h2>
      <AsyncView loading={logs.isLoading} error={logs.error} retry={() => logs.refetch()} empty={!(logs.data ?? []).length}>
        <DataTable rows={logs.data ?? []} csvName="backup-logs" columns={[
          { key: 'at', label: lang === 'ur' ? 'وقت' : 'Time' }, { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status' }, { key: 'kind', label: lang === 'ur' ? 'قسم' : 'Type' },
          { key: 'details_json', label: lang === 'ur' ? 'تفصیل' : 'Details' },
        ] as Column[]} /></AsyncView></div>
    <div className="card" style={{ marginBlock: 16 }}><h2>{lang === 'ur' ? 'کران / جاب لاگ' : 'Cron / Jobs Log'}</h2>
      <DataTable rows={jobs.data ?? []} csvName="jobs" columns={[
        { key: 'at', label: lang === 'ur' ? 'وقت' : 'Time' }, { key: 'kind', label: lang === 'ur' ? 'کام' : 'Task' }, { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status' },
      ] as Column[]} /></div>
    <div className="notice info small">NDJSON chunks → gzip → AES-GCM → <code>backups/</code>; retention managed via settings.</div>
  </div>;
}

// ---------------------------------- Settings ---------------------------------
export function SettingsScreen() {
  const { toast, theme, setTheme, lang, setLang, can, t } = useApp();
  const nav = useNavigate();
  const pin = usePinState();
  const [pinValue, setPinValue] = useState(''), [pinErr, setPinErr] = useState(''), [pinBusy, setPinBusy] = useState(false);
  const { data, isLoading, error, refetch } = useGet<any>('settings', '/api/v1/settings');
  const [key, setKey] = useState('maund_kg'), [value, setValue] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const editable = ['business', 'maund_kg', 'maund_confirmed', 'fiscal_year', 'numbering_prefixes', 'print_size',
    'invoice_footer', 'cnic_enabled', 'privacy_cnic', 'negative_stock_allowed', 'near_expiry_days',
    'grain_rate_basis', 'pesticide_licence_no', 'pesticide_licence_expiry', 'fertilizer_authorisation_no',
    'opening_hours', 'hero_tagline', 'theme', 'language', 'period_lock', 'backup_retention'];
  if (!can('settings.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="settings" label={lang === 'ur' ? 'ترتیبات' : 'Settings'} size={34} />{lang === 'ur' ? 'ترتیبات' : 'Settings'}</h1>
      </div>
    </div>
    <div className="grid g2">
      <div className="card"><h2>{lang === 'ur' ? 'کاروباری پروفائل (لاک شدہ حقائق)' : 'Business Profile (Locked Facts)'}</h2>
        <div className="kv"><span className="k">{lang === 'ur' ? 'نام' : 'Name'}</span><span className="v">{lang === 'ur' ? 'ذیشان ٹریڈرز' : 'Zeeshan Traders'}</span>
          <span className="k">{lang === 'ur' ? 'پتہ' : 'Address'}</span><span className="v">{lang === 'ur' ? 'مقصود چوک، ضلع لیہ، پنجاب، پاکستان' : 'Maqsood Chowk, Layyah District, Punjab, Pakistan'}</span>
          <span className="k">{lang === 'ur' ? 'فون' : 'Phone'}</span><span className="v num">0307-7864722 · 0345-4654722</span>
          <span className="k">{lang === 'ur' ? 'کرنسی / ٹائم زون' : 'Currency / TZ'}</span><span className="v">PKR · Asia/Karachi</span>
          <span className="k">{lang === 'ur' ? 'مالی سال' : 'Fiscal Year'}</span><span className="v">{lang === 'ur' ? 'جولائی – جون · ہفتہ سے آغاز' : 'July - June (Starts Saturday)'}</span></div>
        <div className="notice small">{lang === 'ur' ? 'قیمتیں، اسٹاک، بیلنس، لائسنس، ای میل، اوقات اور تبصرے کبھی خودکار طور پر نہیں بنائے گئے۔' : 'Prices, stock, balances, licenses and timings reflect verified owner inputs.'}</div></div>
      <div className="card"><h2>{lang === 'ur' ? 'مالک کی تصدیق / ریگولیٹری' : 'Owner Verification & Regulatory'}</h2>
        <div className="kv"><span className="k">{lang === 'ur' ? 'من (کلو)' : 'Maund (kg)'}</span><span className="v">{data?.maund_kg ?? (lang === 'ur' ? 'تصدیق باقی' : 'Pending Verification')}</span>
          <span className="k">{lang === 'ur' ? 'تصدیق' : 'Confirmed'}</span><span className="v">{data?.maund_confirmed ? <Mark kind="check" /> : <Mark kind="x" />}</span>
          <span className="k">{lang === 'ur' ? 'پیسٹی لائسنس' : 'Pesticide License'}</span><span className="v">{data?.pesticide_licence_no ?? (lang === 'ur' ? 'درج نہیں' : 'Not entered')}</span>
          <span className="k">{lang === 'ur' ? 'میعاد' : 'Expiry'}</span><span className="v">{data?.pesticide_licence_expiry ?? (lang === 'ur' ? 'درج نہیں' : 'Not entered')}</span></div>
        <div className="notice small">{lang === 'ur' ? 'مالک سے درکار: من کا کلو، لائسنس نمبر/تاریخ، ابتدائی بیلنس، ڈومین، Cloudflare رسائی۔' : 'Configurable fields: maund kg, license number/expiry, opening balances, domain.'}</div></div>
      <div className="card"><h2>{lang === 'ur' ? 'ترتیب بدلیں' : 'Change Setting'}</h2>
        <SelectField label={lang === 'ur' ? 'کلید' : 'Key'} value={key} onChange={(v) => { setKey(v); setValue(''); }} options={editable.map((k) => ({ value: k, label: k }))} />
        <TextField label={lang === 'ur' ? 'قدر (JSON یا سادہ متن)' : 'Value (JSON or plain text)'} value={value} onChange={setValue} dir="ltr" helper={lang === 'ur' ? 'موجودہ قدر نیچے جدول میں دیکھیں' : 'See current value in table below'} />
        <Button onClick={async () => {
          setBusy(true); setErr('');
          try {
            let v: any = value;
            try { v = JSON.parse(value); } catch { /* plain string */ }
            await api('/api/v1/settings', { method: 'PUT', body: { key, value: v } });
            toast(lang === 'ur' ? 'محفوظ + عوامی کیش صاف' : 'Saved & cache purged'); refetch();
          } catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
        }} loading={busy}>{lang === 'ur' ? 'محفوظ کریں' : 'Save'}</Button>
        {err && <div className="err"><Mark kind="warn" /> {err}</div>}</div>
      <div className="card"><h2>{lang === 'ur' ? 'آف لائن PIN / کیش انکرپشن' : 'Offline PIN & Cache Encryption'}</h2>
        <div className="kv"><span className="k">{lang === 'ur' ? 'حالت' : 'Status'}</span><span className="v">{pin.enabled ? (pin.unlocked ? (lang === 'ur' ? 'فعال — کھلا' : 'Enabled — Unlocked') : (lang === 'ur' ? 'فعال — مقفل' : 'Enabled — Locked')) : (lang === 'ur' ? 'غیر فعال' : 'Disabled')}</span>
          <span className="k">{lang === 'ur' ? 'الگورتھم' : 'Algorithm'}</span><span className="v">PBKDF2-SHA256 {PIN_ITERATIONS.toLocaleString('en-PK')} → AES-256-GCM</span></div>
        <TextField label={pin.enabled ? (lang === 'ur' ? 'موجودہ PIN (غیر فعال/لاک کے لیے)' : 'Current PIN') : (lang === 'ur' ? 'نیا PIN (4–12 ہندسے)' : 'New PIN (4-12 digits)')} value={pinValue}
          onChange={setPinValue} type="password" inputMode="numeric" autoComplete="off" />
        {pinErr && <div className="err"><Mark kind="warn" /> {pinErr}</div>}
        <div className="btn-row">
          {!pin.enabled && <Button size="sm" loading={pinBusy} onClick={async () => {
            setPinBusy(true); setPinErr('');
            try { await enablePin(pinValue); toast(lang === 'ur' ? 'PIN فعال — کیش انکرپٹ ہو گیا' : 'PIN enabled — cache encrypted'); setPinValue(''); }
            catch (e: any) { setPinErr(String(e.message ?? e)); } finally { setPinBusy(false); }
          }}>{lang === 'ur' ? 'PIN فعال کریں' : 'Enable PIN'}</Button>}
          {pin.enabled && pin.unlocked && <Button size="sm" variant="secondary" onClick={() => { lockPin(); toast(lang === 'ur' ? 'کیش مقفل' : 'Cache locked'); }}>{lang === 'ur' ? 'ابھی مقفل کریں' : 'Lock Now'}</Button>}
          {pin.enabled && <Button size="sm" variant="danger" loading={pinBusy} onClick={async () => {
            setPinBusy(true); setPinErr('');
            try { await disablePin(pinValue); toast(lang === 'ur' ? 'PIN غیر فعال — کیش ڈی کرپٹ' : 'PIN disabled'); setPinValue(''); }
            catch (e: any) { setPinErr(String(e.message ?? e)); } finally { setPinBusy(false); }
          }}>{lang === 'ur' ? 'PIN ہٹائیں' : 'Disable PIN'}</Button>}
        </div>
      </div>
      <div className="card"><h2>{lang === 'ur' ? 'ظاہری شکل' : 'Appearance'}</h2>
        <SelectField label={lang === 'ur' ? 'تھیم' : 'Theme'} value={theme} onChange={setTheme}
          options={[{ value: 'system', label: lang === 'ur' ? 'سسٹم' : 'System' }, { value: 'light', label: lang === 'ur' ? 'روشن' : 'Light' }, { value: 'dark', label: lang === 'ur' ? 'تاریک' : 'Dark' }]} />
        <SelectField label={lang === 'ur' ? 'زبان' : 'Language'} value={lang} onChange={(v) => setLang(v as any)}
          options={[{ value: 'ur', label: 'اردو (Urdu)' }, { value: 'en', label: 'English' }]} />
        <div className="small">{lang === 'ur' ? 'پرنٹ سائز: ' : 'Print Size: '}{String(data?.print_size ?? 'A4')}</div></div>
    </div>
    <div className="card" style={{ marginBlock: 16 }}><h2>{lang === 'ur' ? 'تمام ترتیبات (D1)' : 'All Settings (D1 Database)'}</h2>
      <AsyncView loading={isLoading} error={error} retry={() => refetch()}>
        <DataTable rows={Object.entries(data ?? {}).map(([k, v]) => ({ id: k, key: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) }))}
          csvName="settings" columns={[{ key: 'key', label: lang === 'ur' ? 'کلید' : 'Key' }, { key: 'value', label: lang === 'ur' ? 'قدر' : 'Value' }] as Column[]} /></AsyncView></div>
  </div>;
}

// ----------------------------------- Audit -----------------------------------
export function AuditScreen() {
  const { lang } = useApp();
  const nav = useNavigate();
  const range = useRange('2020-01-01');
  const { data, isLoading, error, refetch } = useGet<any[]>('audit', `/api/v1/audit?from=${range.from}&to=${range.to}`);
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="audit" label={lang === 'ur' ? 'آڈٹ لاگ' : 'Audit Log'} size={34} />{lang === 'ur' ? 'آڈٹ لاگ' : 'Audit Log'}</h1>
      </div>
    </div>
    <div className="notice info small">{lang === 'ur' ? 'ہر حساس عمل (پوسٹنگ، ریورس، سیٹنگز، لاگ ان، ڈیوائس ریووک، برآمد، تضاد حل) صارف، وقت، IP اور قبل/بعد کے ساتھ محفوظ۔' : 'Every sensitive action (postings, reversals, settings changes, logins, device revokes, exports, conflict resolution) is logged with user, timestamp, IP, and diffs.'}</div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <DataTable rows={data ?? []} csvName="audit" columns={[
        { key: 'at', label: lang === 'ur' ? 'وقت' : 'Time' }, { key: 'action', label: lang === 'ur' ? 'عمل' : 'Action' }, { key: 'entity', label: lang === 'ur' ? 'جدول' : 'Entity' },
        { key: 'entity_id', label: 'ID' }, { key: 'user_id', label: lang === 'ur' ? 'صارف' : 'User' }, { key: 'ip', label: 'IP' },
      ] as Column[]} /></AsyncView>
  </div>;
}

// ----------------------------- Feature status --------------------------------
export function StatusScreen() {
  const { lang } = useApp();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useGet<any>('features', '/api/v1/features');
  const byState: Record<string, any[]> = {};
  for (const f of data?.features ?? []) (byState[f.state] ??= []).push(f);
  const tone: Record<string, string> = { COMPLETE: 'success', PARTIAL: 'warning', INCOMPLETE: 'danger' };
  const title = lang === 'ur' ? 'سسٹم کی حالت — مستند اور شفاف فہرست' : 'System Status — Verified & Transparent List';
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="status" label={title} size={34} />{title}</h1>
      </div>
    </div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()}>
      <div className="stats-grid">
        {['COMPLETE', 'PARTIAL', 'INCOMPLETE'].map((s) => <StatCard key={s} label={s} value={byState[s]?.length ?? 0} tone={tone[s] === 'danger' ? 'var(--danger)' : undefined} />)}
        <StatCard label={lang === 'ur' ? 'انٹیگرٹی' : 'Integrity'} value={data?.integrity?.ok ? (lang === 'ur' ? 'متوازن' : 'Balanced') : (lang === 'ur' ? 'جانچ درکار' : 'Check required')}
        tone={data?.integrity?.ok ? 'var(--brand-600)' : 'var(--warning)'} />
      </div>
      <div className="card"><h2>{lang === 'ur' ? 'تمام اسکرین IDs' : 'All Feature IDs'}</h2>
        <DataTable rows={data?.features ?? []} csvName="feature-checklist" columns={[
          { key: 'id', label: 'ID' }, { key: 'ur', label: lang === 'ur' ? 'اسکرین' : 'Screen (Urdu)' }, { key: 'en', label: 'English' },
          { key: 'state', label: lang === 'ur' ? 'حالت' : 'State', render: (r: any) => <Chip tone={tone[r.state]}>{r.state}</Chip> },
          { key: 'note_ur', label: lang === 'ur' ? 'نوٹ' : 'Note' },
        ] as Column[]} /></div>
      <div className="card" style={{ marginBlock: 16 }}><h2>{lang === 'ur' ? 'انٹیگرٹی چیک' : 'Integrity Check'}</h2>
        <pre style={{ whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'start' }}>{JSON.stringify(data?.integrity, null, 2)}</pre></div>
    </AsyncView>
  </div>;
}

// -------------------------------- Website CMS --------------------------------
export function WebsiteCms() {
  const { toast, can, t, lang } = useApp();
  const nav = useNavigate();
  const pages = useGet<any[]>('cms-pages', '/api/v1/website/pages');
  const banners = useGet<any[]>('cms-banners', '/api/v1/website/banners');
  const anns = useGet<any[]>('cms-ann', '/api/v1/website/announcements');
  const [slug, setSlug] = useState('about'), [title, setTitle] = useState(''), [body, setBody] = useState(''), [status, setStatus] = useState('REVIEW_REQUIRED');
  const [annTitle, setAnnTitle] = useState(''), [annBody, setAnnBody] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  useEffect(() => {
    const p = (pages.data ?? []).find((x: any) => x.slug === slug);
    if (p) { setTitle(p.title_ur); setBody(p.body_ur); setStatus(p.status); }
  }, [pages.data, slug]);
  if (!can('cms.write')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="website" label={lang === 'ur' ? 'ویب سائٹ CMS' : 'Website CMS'} size={34} />{lang === 'ur' ? 'ویب سائٹ CMS' : 'Website CMS'}</h1>
      </div>
      <Button variant="secondary" size="sm" onClick={async () => { await api('/api/v1/website/publish', { method: 'POST', body: {} }); toast(lang === 'ur' ? 'شائع + کیش صاف' : 'Published & cache purged'); }}>{lang === 'ur' ? 'شائع کریں / کیش صاف' : 'Publish & Purge Cache'}</Button>
    </div>
    <div className="grid g2">
      <div className="card"><h2>{lang === 'ur' ? 'صفحات' : 'Static Pages'}</h2>
        <SelectField label={lang === 'ur' ? 'صفحہ' : 'Page'} value={slug} onChange={setSlug} options={[
          { value: 'about', label: lang === 'ur' ? 'ہمارے بارے میں' : 'About Us' }, { value: 'privacy', label: lang === 'ur' ? 'رازداری' : 'Privacy' }, { value: 'terms', label: lang === 'ur' ? 'شرائط' : 'Terms' }]} />
        <TextField label={lang === 'ur' ? 'عنوان' : 'Title'} value={title} onChange={setTitle} />
        <Field label={lang === 'ur' ? 'متن (HTML، سرور سینیٹائز کرتا ہے)' : 'Body (Sanitized HTML)'}><textarea className="input" aria-label={lang === 'ur' ? 'متن (HTML)' : 'Body HTML'} value={body} onChange={(e) => setBody(e.target.value)} rows={7} /></Field>
        <SelectField label={lang === 'ur' ? 'حالت' : 'Status'} value={status} onChange={setStatus} options={[
          { value: 'DRAFT', label: lang === 'ur' ? 'ڈرافٹ' : 'Draft' }, { value: 'REVIEW_REQUIRED', label: lang === 'ur' ? 'مالک کا جائزہ' : 'Review Required' }, { value: 'PUBLISHED', label: lang === 'ur' ? 'شائع' : 'Published' }]} />
        <Button loading={busy} onClick={async () => {
          setBusy(true); setErr('');
          try { await api(`/api/v1/website/pages/${slug}`, { method: 'PUT', body: { slug, title_ur: title, title_en: '', body_ur: body, body_en: '', status } }); toast(lang === 'ur' ? 'محفوظ' : 'Saved'); pages.refetch(); }
          catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
        }}>{lang === 'ur' ? 'محفوظ کریں' : 'Save'}</Button>
        {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      </div>
      <div className="card"><h2>{lang === 'ur' ? 'اعلانات' : 'Announcements'}</h2>
        <TextField label={lang === 'ur' ? 'عنوان' : 'Title'} value={annTitle} onChange={setAnnTitle} />
        <Field label={lang === 'ur' ? 'متن' : 'Content'}><textarea className="input" aria-label={lang === 'ur' ? 'متن' : 'Content'} value={annBody} onChange={(e) => setAnnBody(e.target.value)} /></Field>
        <Button size="sm" variant="secondary" onClick={async () => {
          try { await api('/api/v1/website/announcements', { method: 'POST', body: { title_ur: annTitle, body_ur: annBody, publish_at: TODAY(), is_active: true } }); toast(lang === 'ur' ? 'اعلان شامل' : 'Announcement added'); anns.refetch(); setAnnTitle(''); setAnnBody(''); }
          catch (e: any) { setErr(e.message_ur ?? String(e)); }
        }}>{lang === 'ur' ? '+ نیا اعلان' : '+ Add Announcement'}</Button>
        <DataTable rows={anns.data ?? []} csvName="announcements" columns={[
          { key: 'publish_at', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'title_ur', label: lang === 'ur' ? 'عنوان' : 'Title' },
        ] as Column[]} />
        <h3>{lang === 'ur' ? 'بینرز' : 'Banners'}</h3>
        <DataTable rows={banners.data ?? []} csvName="banners" columns={[
          { key: 'title_ur', label: lang === 'ur' ? 'عنوان' : 'Title' }, { key: 'image_r2_key', label: 'R2 Key' },
        ] as Column[]} />
      </div>
    </div>
    <div className="card" style={{ marginBlock: 16 }}><h2>{lang === 'ur' ? 'موجودہ صفحات (D1)' : 'Current Pages (D1 Database)'}</h2>
      <DataTable rows={pages.data ?? []} csvName="cms-pages" columns={[
        { key: 'slug', label: 'Slug' }, { key: 'title_ur', label: lang === 'ur' ? 'عنوان' : 'Title' },
        { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status', render: (r: any) => <StatusChip status={r.status} /> },
      ] as Column[]} /></div>
  </div>;
}

// ------------------------------- Enquiries inbox -----------------------------
export function EnquiriesInbox() {
  const { toast, can, t, lang } = useApp();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useGet<any[]>('enquiries', '/api/v1/enquiries');
  const [sel, setSel] = useState<any>(null), [reason, setReason] = useState('');
  if (!can('enquiries.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="enquiries" label={lang === 'ur' ? 'پوچھ گچھ ان باکس' : 'Enquiries Inbox'} size={34} />{lang === 'ur' ? 'پوچھ گچھ ان باکس' : 'Enquiries Inbox'}</h1>
      </div>
    </div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <DataTable rows={data ?? []} csvName="enquiries" onRow={setSel} columns={[
        { key: 'number', label: lang === 'ur' ? 'حوالہ' : 'Ref' }, { key: 'customer_name', label: lang === 'ur' ? 'نام' : 'Name' }, { key: 'mobile', label: lang === 'ur' ? 'موبائل' : 'Phone' },
        { key: 'city', label: lang === 'ur' ? 'شہر' : 'City' }, { key: 'created_at', label: lang === 'ur' ? 'وقت' : 'Time' },
        { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status', render: (r: any) => <StatusChip status={r.status} /> },
      ] as Column[]} /></AsyncView>
    <Sheet open={!!sel} onClose={() => setSel(null)} title={`${lang === 'ur' ? 'پوچھ گچھ' : 'Enquiry'} ${sel?.number ?? ''}`}>
      {sel && <div className="card"><div className="kv"><span className="k">{lang === 'ur' ? 'نام' : 'Name'}</span><span className="v">{sel.customer_name}</span>
        <span className="k">{lang === 'ur' ? 'موبائل' : 'Phone'}</span><span className="v num">{sel.mobile}</span>
        <span className="k">{lang === 'ur' ? 'شہر' : 'City'}</span><span className="v">{sel.city}</span></div>
        <p>{sel.message}</p>
        <div className="small">{lang === 'ur' ? 'مصنوعات: ' : 'Products: '}{(sel.items ?? []).map((i: any) => i.unit).join('، ') || '—'}</div>
        <TextField label={lang === 'ur' ? 'مسترد کرنے کی وجہ' : 'Rejection Reason'} value={reason} onChange={setReason} />
        <div className="btn-row">
          <Button size="sm" onClick={async () => { await api(`/api/v1/enquiries/${sel.id}/status`, { method: 'POST', body: { status: 'APPROVED' } }); toast(lang === 'ur' ? 'منظور' : 'Approved'); refetch(); setSel(null); }}>{lang === 'ur' ? 'منظور' : 'Approve'}</Button>
          <Button size="sm" variant="danger" disabled={!reason} onClick={async () => { await api(`/api/v1/enquiries/${sel.id}/status`, { method: 'POST', body: { status: 'REJECTED', reason } }); toast(lang === 'ur' ? 'مسترد' : 'Rejected'); refetch(); setSel(null); }}>{lang === 'ur' ? 'مسترد' : 'Reject'}</Button>
          <Button size="sm" variant="secondary" onClick={async () => { const r = await api<any>(`/api/v1/enquiries/${sel.id}/quotation`, { method: 'POST', body: {} }); toast(`Quotation ${r.number}`); refetch(); setSel(null); }}>{lang === 'ur' ? 'کوٹیشن بنائیں' : 'Create Quotation'}</Button>
          <a className="btn btn-wa btn-sm" href={`https://wa.me/92${sel.mobile.replace(/^0/, '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{lang === 'ur' ? 'واٹس ایپ جواب' : 'WhatsApp'}</a>
        </div>
      </div>}
    </Sheet>
  </div>;
}

// -------------------------------- Accounting ---------------------------------
export function AccountingScreen() {
  const { toast, can, t, lang } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState('chart');
  const chart = useGet<any[]>('coa', '/api/v1/accounting/chart');
  const journals = useGet<any[]>('journals', '/api/v1/accounting/journals');
  const integrity = useGet<any>('integrity', '/api/v1/integrity');
  const [memo, setMemo] = useState(''), [reason, setReason] = useState(''), [lines, setLines] = useState<any[]>([
    { account_code: '1000', debit_paisa: 0, credit_paisa: 0 }, { account_code: '3900', debit_paisa: 0, credit_paisa: 0 }]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [period, setPeriod] = useState(''), [lockReason, setLockReason] = useState('');
  const debit = lines.reduce((a, l) => a + l.debit_paisa, 0), credit = lines.reduce((a, l) => a + l.credit_paisa, 0);
  if (!can('accounting.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="accounting" label={lang === 'ur' ? 'اکاؤنٹنگ' : 'Accounting'} size={34} />{lang === 'ur' ? 'اکاؤنٹنگ' : 'Accounting'}</h1>
      </div>
    </div>
    <div className={`notice ${integrity.data?.ok ? 'success' : ''}`}>{lang === 'ur' ? 'انٹیگرٹی: ' : 'Integrity: '}{integrity.data?.ok ? <><Mark kind="check" /> {lang === 'ur' ? 'تمام جرنل متوازن، اسٹاک/اکاؤنٹ/پارٹی بیلنس ہم آہنگ' : 'All journals balanced, stock/accounts/khata in sync'}</> : JSON.stringify(integrity.data)}</div>
    <Tabs tabs={[
      { id: 'chart', label: lang === 'ur' ? 'چارٹ آف اکاؤنٹس' : 'Chart of Accounts' },
      { id: 'journals', label: lang === 'ur' ? 'جرنل' : 'General Journal' },
      { id: 'manual', label: lang === 'ur' ? 'دستی جرنل' : 'Manual Journal Entry' },
      { id: 'close', label: lang === 'ur' ? 'پیریڈ لاک' : 'Period Lock' }
    ]} active={tab} onChange={setTab} />
    {tab === 'chart' && <DataTable rows={chart.data ?? []} csvName="chart-of-accounts" columns={[
      { key: 'code', label: lang === 'ur' ? 'کوڈ' : 'Code' }, { key: 'name_ur', label: lang === 'ur' ? 'نام' : 'Name' }, { key: 'type', label: lang === 'ur' ? 'قسم' : 'Type' },
    ] as Column[]} />}
    {tab === 'journals' && <AsyncView loading={journals.isLoading} error={journals.error} retry={() => journals.refetch()} empty={!(journals.data ?? []).length}>
      <DataTable rows={journals.data ?? []} csvName="journals" columns={[
        { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'memo_ur', label: lang === 'ur' ? 'تفصیل' : 'Memo' }, { key: 'ref_type', label: lang === 'ur' ? 'حوالہ' : 'Ref' },
      ] as Column[]} /></AsyncView>}
    {tab === 'manual' && <div className="card"><h2>{lang === 'ur' ? 'متوازن دستی جرنل' : 'Balanced Manual Journal Entry'}</h2>
      <TextField label={lang === 'ur' ? 'تفصیل' : 'Memo'} value={memo} onChange={setMemo} required />
      <TextField label={lang === 'ur' ? 'وجہ' : 'Reason'} value={reason} onChange={setReason} required />
      {lines.map((l, i) => <div key={i} className="grid g2 card" style={{ background: 'var(--bg)', marginBlockEnd: 8 }}>
        <SelectField label={lang === 'ur' ? 'اکاؤنٹ' : 'Account'} value={l.account_code} onChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, account_code: v } : x))}
          options={CHART_OF_ACCOUNTS.map((a: any) => ({ value: a.code, label: `${a.code} — ${a.name_ur ?? a.ur ?? a.en ?? ''}` }))} />
        <MoneyField label={lang === 'ur' ? 'ڈیبٹ' : 'Debit'} paisa={l.debit_paisa} onChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, debit_paisa: v, credit_paisa: 0 } : x))} />
        <MoneyField label={lang === 'ur' ? 'کریڈٹ' : 'Credit'} paisa={l.credit_paisa} onChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, credit_paisa: v, debit_paisa: 0 } : x))} />
        <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>{lang === 'ur' ? 'حذف' : 'Delete'}</Button>
      </div>)}
      <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { account_code: '1000', debit_paisa: 0, credit_paisa: 0 }])}>{lang === 'ur' ? '+ لائن شامل کریں' : '+ Add Line'}</Button>
      <div className="kv"><span className="k">{lang === 'ur' ? 'ڈیبٹ' : 'Debit'}</span><span className="v num">{formatPKR(debit)}</span>
        <span className="k">{lang === 'ur' ? 'کریڈٹ' : 'Credit'}</span><span className="v num">{formatPKR(credit)}</span></div>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button loading={busy} disabled={debit !== credit || debit === 0 || !memo || !reason} onClick={async () => {
        setBusy(true); setErr('');
        try { await api('/api/v1/accounting/journal', { method: 'POST', body: { date: TODAY(), memo_ur: memo, reason, lines } }); toast(lang === 'ur' ? 'جرنل پوسٹ ہو گیا' : 'Journal entry posted'); journals.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }}>{lang === 'ur' ? 'پوسٹ کریں' : 'Post Journal'}</Button>
    </div>}
    {tab === 'close' && <div className="card"><h2>{lang === 'ur' ? 'پیریڈ لاک' : 'Period Lock'}</h2>
      <TextField label={lang === 'ur' ? 'ماہ (YYYY-MM)' : 'Month (YYYY-MM)'} value={period} onChange={setPeriod} dir="ltr" required />
      <TextField label={lang === 'ur' ? 'وجہ' : 'Reason'} value={lockReason} onChange={setLockReason} required />
      <Button variant="danger" onClick={async () => {
        try { await api('/api/v1/accounting/period-close', { method: 'POST', body: { period, reason: lockReason } }); toast(lang === 'ur' ? 'پیریڈ بند کر دیا گیا' : 'Period closed'); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }}>{lang === 'ur' ? 'بند کریں' : 'Lock Period'}</Button>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
    </div>}
  </div>;
}

// ----------------------------------- Users -----------------------------------
export function UsersScreen() {
  const { toast, can, t, lang } = useApp();
  const nav = useNavigate();
  const users = useGet<any[]>('users', '/api/v1/users');
  const roles = useGet<any>('roles', '/api/v1/roles');
  const roleList: any[] = Array.isArray(roles.data) ? roles.data : (roles.data?.roles ?? []);
  const devices = useGet<any[]>('devices', '/api/v1/devices');
  const passkeys = useGet<any[]>('passkeys', '/api/v1/auth/passkeys');
  const [pkBusy, setPkBusy] = useState(false);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [username, setUsername] = useState(''), [pw, setPw] = useState(''), [name, setName] = useState(''),
    [mobile, setMobile] = useState(''), [roleCodes, setRoleCodes] = useState<string[]>(['AUDITOR']);
  if (!can('users.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="users" label={lang === 'ur' ? 'صارفین، کردار اور ڈیوائسز' : 'Users, Roles & Devices'} size={34} />{lang === 'ur' ? 'صارفین، کردار اور ڈیوائسز' : 'Users, Roles & Devices'}</h1>
      </div>
      <Button size="sm" onClick={() => setOpen(true)}>{lang === 'ur' ? '+ نیا صارف' : '+ New User'}</Button>
    </div>
    <div className="card"><h2>{lang === 'ur' ? 'صارفین' : 'Users'}</h2>
      <DataTable rows={users.data ?? []} csvName="users" columns={[
        { key: 'username', label: lang === 'ur' ? 'صارف نام' : 'Username' }, { key: 'display_name', label: lang === 'ur' ? 'نام' : 'Display Name' },
        { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status', render: (r: any) => <StatusChip status={r.status} /> },
        { key: 'id', label: lang === 'ur' ? 'عمل' : 'Action', render: (r: any) => <Button variant="ghost" size="sm" onClick={async () => {
          await api(`/api/v1/users/${r.id}/disable`, { method: 'POST', body: {} }); toast(lang === 'ur' ? 'بند' : 'Disabled'); users.refetch();
        }}>{lang === 'ur' ? 'غیر فعال' : 'Disable'}</Button> },
      ] as Column[]} /></div>
    <div className="grid g2" style={{ marginBlock: 16 }}>
      <div className="card"><h2>{lang === 'ur' ? 'کردار / اجازت میٹرکس' : 'Roles & Permissions Matrix'}</h2>
        <DataTable rows={roleList} csvName="roles" columns={[
          { key: 'code', label: lang === 'ur' ? 'کوڈ' : 'Code' }, { key: 'ur', label: lang === 'ur' ? 'نام' : 'Name', render: (r: any) => lang === 'ur' ? (r.ur ?? r.name_ur ?? r.code) : (r.en ?? r.code) },
          { key: 'perms', label: lang === 'ur' ? 'اجازتیں' : 'Permissions', render: (r: any) => <span className="small">{(Array.isArray(r.perms) ? r.perms.join(', ') : String(r.perms ?? '')).slice(0, 60)}</span> },
        ] as Column[]} /></div>
      <div className="card"><h2>{lang === 'ur' ? 'ڈیوائسز' : 'Trusted Devices'}</h2>
        <DataTable rows={devices.data ?? []} csvName="devices" columns={[
          { key: 'id', label: 'ID' }, { key: 'revoked_at', label: lang === 'ur' ? 'ریووک' : 'Revoked' },
          { key: 'action', label: '', render: (r: any) => <Button variant="ghost" size="sm" onClick={async () => {
            await api(`/api/v1/devices/${r.id}/revoke`, { method: 'POST', body: {} }); toast(lang === 'ur' ? 'ریووک — مقامی کیش صاف' : 'Revoked — cache purged'); devices.refetch();
          }}>{lang === 'ur' ? 'ریووک' : 'Revoke'}</Button> },
        ] as Column[]} />
        <div className="btn-row" style={{ marginBlockStart: 8 }}>
          <Button size="sm" loading={pkBusy} disabled={!passkeysSupported()} onClick={async () => {
            setPkBusy(true);
            try { const r = await registerPasskey(); toast(lang === 'ur' ? `پاس کی رجسٹر ہو گئی (${r.credential_id.slice(0, 8)}…)` : `Passkey registered (${r.credential_id.slice(0, 8)}…)`); passkeys.refetch(); }
            catch (e: any) { toast(e.message_ur ?? String(e), 'err'); }
            finally { setPkBusy(false); }
          }}>{lang === 'ur' ? '+ اپنی پاس کی رجسٹر کریں' : '+ Register WebAuthn Passkey'}</Button>
        </div>
        <DataTable rows={passkeys.data ?? []} csvName="passkeys" columns={[
          { key: 'credential_id', label: lang === 'ur' ? 'پاس کی' : 'Passkey ID', render: (r: any) => <span className="num">{String(r.credential_id).slice(0, 12)}…</span> },
          { key: 'created_at', label: lang === 'ur' ? 'رجسٹرڈ' : 'Registered' },
          { key: 'revoked_at', label: lang === 'ur' ? 'حالت' : 'Status', render: (r: any) => r.revoked_at ? <Chip tone="danger">{lang === 'ur' ? 'ریووک' : 'Revoked'}</Chip> : <Chip tone="success">{lang === 'ur' ? 'فعال' : 'Active'}</Chip> },
          { key: 'id', label: '', render: (r: any) => r.revoked_at ? null : <Button variant="danger" size="sm" onClick={async () => {
            await revokePasskey(r.id); toast(lang === 'ur' ? 'پاس کی ریووک' : 'Passkey revoked'); passkeys.refetch();
          }}>{lang === 'ur' ? 'ریووک' : 'Revoke'}</Button> },
        ] as Column[]} />
      </div>
    </div>
    <Sheet open={open} onClose={() => setOpen(false)} title={lang === 'ur' ? 'نیا صارف' : 'New User'}>
      <TextField label={lang === 'ur' ? 'صارف نام' : 'Username'} value={username} onChange={setUsername} required />
      <TextField label={lang === 'ur' ? 'نام' : 'Display Name'} value={name} onChange={setName} required />
      <TextField label={lang === 'ur' ? 'موبائل' : 'Phone'} value={mobile} onChange={setMobile} />
      <TextField label={lang === 'ur' ? 'پاس ورڈ (10+)' : 'Password (10+ chars)'} value={pw} onChange={setPw} type="password" required />
      <div className="field"><label>{lang === 'ur' ? 'کردار' : 'Roles'}</label>
        {roleList.map((r: any) => <CheckField key={r.code} label={`${lang === 'ur' ? (r.ur ?? r.name_ur ?? r.code) : (r.en ?? r.code)} (${r.code})`} checked={roleCodes.includes(r.code)}
          onChange={(v) => setRoleCodes(v ? [...roleCodes, r.code] : roleCodes.filter((x) => x !== r.code))} />)}</div>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button loading={busy} onClick={async () => {
        setBusy(true); setErr('');
        try { await api('/api/v1/users', { method: 'POST', body: { username, password: pw, name, mobile, role_codes: roleCodes } }); toast(lang === 'ur' ? 'صارف بن گیا' : 'User created'); users.refetch(); setOpen(false); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }}>{lang === 'ur' ? 'بنائیں' : 'Create'}</Button>
    </Sheet>
  </div>;
}

// --------------------------------- Inventory ---------------------------------
export function InventoryScreen() {
  const { can, t, toast, lang } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState('stock');
  const stock = useGet<any[]>('stock', '/api/v1/stock');
  const ledger = useGet<any[]>('stock-ledger', '/api/v1/stock/ledger');
  const batches = useGet<any[]>('stock-batches', '/api/v1/stock/batches');
  const products = useGet<any>('products-ref', '/api/v1/products?limit=100');
  const [productId, setProductId] = useState(''), [delta, setDelta] = useState(0), [reason, setReason] = useState('');
  const [openingQty, setOpeningQty] = useState(0), [openingCost, setOpeningCost] = useState(0);
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [err, setErr] = useState('');
  if (!can('stock.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="inventory" label={lang === 'ur' ? 'انوینٹری / اسٹاک' : 'Inventory & Stock'} size={34} />{lang === 'ur' ? 'انوینٹری / اسٹاک' : 'Inventory & Stock'}</h1>
      </div>
      <div className="btn-row no-print">
        <Link className="btn btn-secondary btn-sm" to="/erp/products/new">{lang === 'ur' ? '+ نئی پروڈکٹ' : '+ New Product'}</Link>
        <Link className="btn btn-primary btn-sm" to="/erp/purchases/new">{lang === 'ur' ? '+ نئی خریداری (مال اندر)' : '+ Purchase / Stock In'}</Link>
        <Button variant="ghost" size="sm" onClick={() => setTab('opening')}>{lang === 'ur' ? '+ اوپننگ اسٹاک' : '+ Opening Stock'}</Button>
        <Button variant="ghost" size="sm" onClick={() => setTab('adjust')}>{lang === 'ur' ? '+ ایڈجسٹمنٹ' : '+ Adjustment'}</Button>
        <Button variant="ghost" size="sm" onClick={() => downloadCsv('/api/v1/stock/export', 'zt-stock.csv')}>{lang === 'ur' ? 'CSV برآمد' : 'Export CSV'}</Button>
      </div>
    </div>
    <Tabs tabs={[
      { id: 'stock', label: lang === 'ur' ? 'اسٹاک' : 'Current Stock' },
      { id: 'ledger', label: lang === 'ur' ? 'لیجر' : 'Stock Ledger' },
      { id: 'batches', label: lang === 'ur' ? 'بیچ / FEFO' : 'Batches & FEFO' },
      { id: 'opening', label: lang === 'ur' ? 'اوپننگ' : 'Opening Stock' },
      { id: 'adjust', label: lang === 'ur' ? 'ایڈجسٹمنٹ' : 'Adjustment' },
      { id: 'count', label: lang === 'ur' ? 'فزیکل کاؤنٹ' : 'Physical Count' }
    ]} active={tab} onChange={setTab} />
    {tab === 'stock' && <DataTable rows={stock.data ?? []} csvName="stock" columns={[
      { key: 'name_ur', label: lang === 'ur' ? 'مصنوعات' : 'Product' },
      { key: 'qty_milli', label: lang === 'ur' ? 'تعداد' : 'Quantity', render: (r: any) => <span className="num">{fromMilli(r.qty_milli ?? 0)}</span> },
      { key: 'value_paisa', label: lang === 'ur' ? 'مالیت' : 'Value', render: (r: any) => money(r.value_paisa) },
    ] as Column[]} />}
    {tab === 'ledger' && <DataTable rows={ledger.data ?? []} csvName="stock-ledger" columns={[
      { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' },
      { key: 'product_id', label: lang === 'ur' ? 'مصنوعات' : 'Product' },
      { key: 'direction', label: lang === 'ur' ? 'سمت' : 'Direction' },
      { key: 'qty_milli', label: lang === 'ur' ? 'تعداد' : 'Quantity', render: (r: any) => <span className="num">{fromMilli(r.qty_milli ?? 0)}</span> },
      { key: 'ref_type', label: lang === 'ur' ? 'حوالہ' : 'Reference' },
    ] as Column[]} />}
    {tab === 'batches' && <><div className="notice info small">
      {lang === 'ur' ? 'FEFO: ایکسپائری پہلے والا بیچ پہلے۔ ایکسپائری ختم / قرنطینہ بیچ کی فروخت سرور بلاک کرتا ہے۔' : 'FEFO (First-Expiry-First-Out): Expired or quarantined batches are strictly blocked by the server.'}
    </div>
      <DataTable rows={batches.data ?? []} csvName="batches" columns={[
        { key: 'batch_no', label: lang === 'ur' ? 'بیچ' : 'Batch' },
        { key: 'product_id', label: lang === 'ur' ? 'مصنوعات' : 'Product' },
        { key: 'mfg_date', label: 'MFG' },
        { key: 'expiry_date', label: lang === 'ur' ? 'ایکسپائری' : 'Expiry' },
        { key: 'qty_milli', label: lang === 'ur' ? 'تعداد' : 'Quantity', qty: true },
        { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status', render: (r: any) => <StatusChip status={r.status ?? 'POSTED'} /> },
      ] as Column[]} /></>}
    {tab === 'opening' && <div className="card"><h2>{lang === 'ur' ? 'ابتدائی اسٹاک (مالک ان پٹ)' : 'Opening Stock (Owner Input)'}</h2>
      <SelectField label={lang === 'ur' ? 'مصنوعات' : 'Product'} value={productId} onChange={setProductId} placeholder={lang === 'ur' ? 'منتخب کریں' : 'Select Product'}
        options={(products.data?.rows ?? []).map((p: any) => ({ value: p.id, label: lang === 'ur' ? p.name_ur : (p.name_en || p.name_ur) }))} />
      <QtyField label={lang === 'ur' ? 'تعداد' : 'Quantity'} milli={openingQty} onChange={setOpeningQty} required />
      <MoneyField label={lang === 'ur' ? 'فی یونٹ لاگت' : 'Unit Cost'} paisa={openingCost} onChange={setOpeningCost} />
      <Button onClick={async () => {
        try { await api('/api/v1/stock/opening', { method: 'POST', body: { date: TODAY(), product_id: productId, qty_milli: openingQty, unit_cost_paisa: openingCost, reason } }); toast(lang === 'ur' ? 'اوپننگ پوسٹ ہو گئی' : 'Opening stock posted'); stock.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }}>{lang === 'ur' ? 'پوسٹ کریں' : 'Post'}</Button></div>}
    {tab === 'adjust' && <div className="card"><h2>{lang === 'ur' ? 'ایڈجسٹمنٹ (وجہ لازمی)' : 'Stock Adjustment (Reason Required)'}</h2>
      <SelectField label={lang === 'ur' ? 'مصنوعات' : 'Product'} value={productId} onChange={setProductId} placeholder={lang === 'ur' ? 'منتخب کریں' : 'Select Product'}
        options={(products.data?.rows ?? []).map((p: any) => ({ value: p.id, label: lang === 'ur' ? p.name_ur : (p.name_en || p.name_ur) }))} />
      <QtyField label={lang === 'ur' ? 'فرق (+/-)' : 'Delta (+/-)'} milli={delta} onChange={setDelta} />
      <TextField label={lang === 'ur' ? 'وجہ' : 'Reason'} value={reason} onChange={setReason} required />
      <Button variant="danger" disabled={!reason || !productId || !delta} onClick={async () => {
        try { await api('/api/v1/stock/adjustment', { method: 'POST', body: { date: TODAY(), product_id: productId, delta_milli: delta, reason, unit_cost_paisa: 0 } }); toast(lang === 'ur' ? 'ایڈجسٹمنٹ پوسٹ ہو گئی' : 'Adjustment posted'); stock.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }}>{lang === 'ur' ? 'پوسٹ کریں' : 'Post'}</Button></div>}
    {tab === 'count' && <div className="card"><h2>{lang === 'ur' ? 'فزیکل کاؤنٹ' : 'Physical Count'}</h2>
      <p className="small">{lang === 'ur' ? 'ہر مصنوعات کی گنتی درج کریں؛ فرق خودکار ایڈجسٹمنٹ + آڈٹ کے ساتھ پوسٹ ہوتا ہے (H2)۔' : 'Enter physical count for each product. Variance posts as automated adjustment with full audit.'}</p>
      <DataTable rows={products.data?.rows ?? []} csvName="count-sheet" columns={[
        { key: 'name_ur', label: lang === 'ur' ? 'مصنوعات' : 'Product' },
        { key: 'stock_milli', label: lang === 'ur' ? 'سسٹم' : 'System', qty: true },
        { key: 'counted_milli', label: lang === 'ur' ? 'اصل گنتی' : 'Counted', render: (r: any) => <QtyField label="" milli={counted[r.id] ?? r.stock_milli ?? 0}
          onChange={(v) => setCounted({ ...counted, [r.id]: v })} /> },
      ] as Column[]} />
      <TextField label={lang === 'ur' ? 'وجہ' : 'Reason'} value={reason} onChange={setReason} required />
      <Button onClick={async () => {
        const rowsAll = products.data?.rows ?? [];
        const lines = rowsAll.map((p: any) => ({ product_id: p.id, counted_milli: counted[p.id] ?? p.stock_milli ?? 0 }));
        try { const r = await api<any>('/api/v1/stock/count', { method: 'POST', body: { date: TODAY(), reason: reason || 'فزیکل گنتی', lines } }); toast(lang === 'ur' ? `کاؤنٹ مکمل: ${JSON.stringify(r)}` : `Count completed: ${JSON.stringify(r)}`); stock.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }} disabled={!reason || !(products.data?.rows ?? []).length}>{lang === 'ur' ? 'کاؤنٹ پوسٹ کریں' : 'Post Count'}</Button>
    </div>}
    {err && <div className="err"><Mark kind="warn" /> {err}</div>}
  </div>;
}

// -------------------------------- Money accounts -----------------------------
export function AccountsHub() {
  const { data, isLoading, error, refetch } = useGet<any[]>('accounts', '/api/v1/accounts');
  const { lang } = useApp();
  const nav = useNavigate();
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="accounts" label={lang === 'ur' ? 'رقم کے اکاؤنٹس' : 'Money Accounts'} size={34} />{lang === 'ur' ? 'رقم کے اکاؤنٹس' : 'Money Accounts'}</h1>
      </div>
      <div className="btn-row no-print">
        <Link className="btn btn-secondary btn-sm" to="/erp/accounts/transfer">{lang === 'ur' ? '↔ منتقلی' : '↔ Transfer'}</Link>
        <Link className="btn btn-secondary btn-sm" to="/erp/receipts/new">{lang === 'ur' ? '+ رسید' : '+ Receipt'}</Link>
      </div>
    </div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <div className="stats-grid">{(data ?? []).map((a: any) => <StatCard key={a.id} label={lang === 'ur' ? a.name_ur : (a.name_en || a.name_ur)} value={formatPKR(a.balance_paisa ?? 0)}
        sub={a.code} onClick={() => nav(`/erp/accounts/${a.id}`)} />)}</div>
      <DataTable rows={data ?? []} csvName="accounts" columns={[
        { key: 'code', label: lang === 'ur' ? 'کوڈ' : 'Code' }, { key: 'name_ur', label: lang === 'ur' ? 'نام' : 'Name', render: (r: any) => lang === 'ur' ? r.name_ur : (r.name_en || r.name_ur) },
        { key: 'balance_paisa', label: lang === 'ur' ? 'بیلنس' : 'Balance', money: true }, { key: 'type', label: lang === 'ur' ? 'قسم' : 'Type' },
      ] as Column[]} />
    </AsyncView>
    <div className="notice info small">{lang === 'ur' ? 'JazzCash / بینک صرف اندرونی کتابیں ہیں — کسی بینک، JazzCash API یا سرکاری پورٹل سے انٹیگریشن کا دعویٰ نہیں۔' : 'JazzCash / Bank accounts represent internal ledgers — no direct API linkage is claimed.'}</div>
  </div>;
}

export function AccountPage() {
  const { id } = useParams();
  const { lang } = useApp();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useGet<any>('account', `/api/v1/accounts/${id}`);
  const title = data?.account?.name_ur ? (lang === 'ur' ? data.account.name_ur : (data.account.name_en || data.account.name_ur)) : id;
  return <div><AsyncView loading={isLoading} error={error} retry={() => refetch()}>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav('/erp/accounts')}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="accounts" label={title ?? ''} size={34} />{title}</h1>
      </div>
    </div>
    <div className="stats-grid">
      <StatCard label={lang === 'ur' ? 'بیلنس' : 'Balance'} value={formatPKR(data?.account?.balance_paisa ?? 0)} />
      <StatCard label={lang === 'ur' ? 'اندر' : 'Cash In'} value={formatPKR(data?.in_paisa ?? 0)} />
      <StatCard label={lang === 'ur' ? 'باہر' : 'Cash Out'} value={formatPKR(data?.out_paisa ?? 0)} />
    </div>
    <div className="card" style={{ marginBlock: 16 }}><h2>{lang === 'ur' ? 'لین دین' : 'Transactions'}</h2>
      <DataTable rows={data?.transactions ?? data?.rows ?? []} csvName="account-transactions" columns={[
        { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'direction', label: lang === 'ur' ? 'سمت' : 'Direction' },
        { key: 'amount_paisa', label: lang === 'ur' ? 'رقم' : 'Amount', money: true }, { key: 'ref_type', label: lang === 'ur' ? 'حوالہ' : 'Ref' },
        { key: 'note', label: lang === 'ur' ? 'نوٹ' : 'Note' },
      ] as Column[]} /></div>
  </AsyncView></div>;
}

// --------------------------------- Employees ---------------------------------
export function EmployeesScreen({ payroll = false }: { payroll?: boolean }) {
  const { ym } = useParams();
  const { toast, can, t, lang } = useApp();
  const nav = useNavigate();
  const period = ym ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit' }).format(new Date());
  const employees = useGet<any[]>('employees', '/api/v1/employees');
  const advances = useGet<any[]>('advances', '/api/v1/advances');
  const payrollData = useGet<any>('payroll', `/api/v1/payroll/${period}`);
  const [rows, setRows] = useState<any[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  useEffect(() => { if (employees.data) setRows(employees.data.map((e: any) => ({ employee_id: e.id, name: e.name, gross_paisa: e.base_salary_paisa ?? 0, advance_recovered_paisa: 0, deductions_paisa: 0 }))); }, [employees.data]);
  if (!can('employees.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="employees" label={lang === 'ur' ? 'ملازمین / تنخواہ' : 'Employees & Payroll'} size={34} />{lang === 'ur' ? 'ملازمین / تنخواہ' : 'Employees & Payroll'} — {period}</h1>
      </div>
      <div className="btn-row no-print">
        <Link className="btn btn-secondary btn-sm" to="/erp/employees/new">{lang === 'ur' ? '+ ملازم' : '+ New Employee'}</Link>
        <Link className="btn btn-secondary btn-sm" to="/erp/expenses/new">{lang === 'ur' ? '+ ایڈوانس / خرچہ' : '+ Advance / Expense'}</Link>
      </div>
    </div>
    {payroll && <div className="card"><h2>{lang === 'ur' ? 'تنخواہ رن' : 'Payroll Run'}</h2>
      <div className="small">{lang === 'ur' ? 'ہر ملازم: gross − ایڈوانس − کٹوتیاں = خالص؛ ایک ایٹمی بیچ میں تمام SL نمبر محفوظ (reserveNumbers)۔' : 'Each employee: Gross − Advance − Deductions = Net Pay. Reserved SL sequence in atomic batch.'}</div>
      <DataTable rows={rows} csvName="payroll-rows" columns={[
        { key: 'name', label: lang === 'ur' ? 'ملازم' : 'Employee' },
        { key: 'gross_paisa', label: lang === 'ur' ? 'تنخواہ' : 'Gross Salary', render: (r: any) => <MoneyField label="" paisa={r.gross_paisa} onChange={(v) => setRows(rows.map((x) => x.employee_id === r.employee_id ? { ...x, gross_paisa: v } : x))} /> },
        { key: 'advance_recovered_paisa', label: lang === 'ur' ? 'ایڈوانس کٹوتی' : 'Advance Recovery', render: (r: any) => <MoneyField label="" paisa={r.advance_recovered_paisa} onChange={(v) => setRows(rows.map((x) => x.employee_id === r.employee_id ? { ...x, advance_recovered_paisa: v } : x))} /> },
        { key: 'deductions_paisa', label: lang === 'ur' ? 'دیگر کٹوتی' : 'Deductions', render: (r: any) => <MoneyField label="" paisa={r.deductions_paisa} onChange={(v) => setRows(rows.map((x) => x.employee_id === r.employee_id ? { ...x, deductions_paisa: v } : x))} /> },
      ] as Column[]} />
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button loading={busy} disabled={!rows.length} onClick={async () => {
        setBusy(true); setErr('');
        try { const r = await api<any>('/api/v1/payroll', { method: 'POST', body: { ym: period, pay_date: TODAY(), account_id: 'acct-cash', rows } }); toast(lang === 'ur' ? `تنخواہ پوسٹ: ${JSON.stringify(r)}` : 'Payroll posted successfully'); payrollData.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }}>{lang === 'ur' ? 'تنخواہ پوسٹ کریں' : 'Post Payroll'}</Button></div>}
    <div className="card" style={{ marginBlock: 16 }}><h2>{lang === 'ur' ? 'ملازمین' : 'Employees'}</h2>
      <DataTable rows={employees.data ?? []} csvName="employees" columns={[
        { key: 'name', label: lang === 'ur' ? 'نام' : 'Name' }, { key: 'role', label: lang === 'ur' ? 'عہدہ' : 'Role' },
        { key: 'base_salary_paisa', label: lang === 'ur' ? 'تنخواہ' : 'Base Salary', money: true }, { key: 'status', label: lang === 'ur' ? 'حالت' : 'Status' },
      ] as Column[]} /></div>
    <div className="card"><h2>{lang === 'ur' ? 'ایڈوانسز' : 'Advances'}</h2>
      <DataTable rows={advances.data ?? []} csvName="advances" columns={[
        { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'employee_id', label: lang === 'ur' ? 'ملازم' : 'Employee' },
        { key: 'amount_paisa', label: lang === 'ur' ? 'رقم' : 'Amount', money: true },
      ] as Column[]} /></div>
  </div>;
}

// ---------------------------------- Returns ----------------------------------
export function ReturnsScreen() {
  const { toast, can, t, lang } = useApp();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useGet<any>('returns', '/api/v1/returns');
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [err, setErr] = useState('');
  const [type, setType] = useState('SALE'), [originalId, setOriginalId] = useState(''), [lineId, setLineId] = useState(''), [qty, setQty] = useState(0);
  const docs = useGet<{ rows?: any[] }>('return-docs', `/api/v1/${type === 'SALE' ? 'sales' : 'purchases'}`);
  if (!can('returns.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="returns" label={lang === 'ur' ? 'واپسی / ریورس' : 'Returns & Reversals'} size={34} />{lang === 'ur' ? 'واپسی / ریورس' : 'Returns & Reversals'}</h1>
      </div>
      <Button size="sm" onClick={() => setOpen(true)}>{lang === 'ur' ? '+ نئی واپسی' : '+ New Return'}</Button>
    </div>
    <div className="notice info small">{lang === 'ur' ? 'پوسٹڈ مالی ریکارڈ کبھی ایڈٹ نہیں ہوتا: واپسی = ریورس + متبادل ریکارڈ، وجہ/صارف/ٹائم اسٹیمپ کے ساتھ۔' : 'Posted financial records are never mutated: return creates a reversal + replacement with timestamp and reason.'}</div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data?.sales_returns ?? []).length && !(data?.purchase_returns ?? []).length}>
      <div className="card"><h2>{lang === 'ur' ? 'فروخت واپسی' : 'Sales Returns'}</h2><DataTable rows={data?.sales_returns ?? []} csvName="sale-returns" columns={[
        { key: 'number', label: lang === 'ur' ? 'نمبر' : 'Number' }, { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'reason', label: lang === 'ur' ? 'وجہ' : 'Reason' },
        { key: 'total_paisa', label: lang === 'ur' ? 'رقم' : 'Amount', money: true },
      ] as Column[]} /></div>
      <div className="card" style={{ marginBlock: 16 }}><h2>{lang === 'ur' ? 'خرید واپسی' : 'Purchase Returns'}</h2><DataTable rows={data?.purchase_returns ?? []} csvName="purchase-returns" columns={[
        { key: 'number', label: lang === 'ur' ? 'نمبر' : 'Number' }, { key: 'date', label: lang === 'ur' ? 'تاریخ' : 'Date' }, { key: 'reason', label: lang === 'ur' ? 'وجہ' : 'Reason' },
        { key: 'total_paisa', label: lang === 'ur' ? 'رقم' : 'Amount', money: true },
      ] as Column[]} /></div>
    </AsyncView>
    <Sheet open={open} onClose={() => setOpen(false)} title={lang === 'ur' ? 'نئی واپسی' : 'New Return'}>
      <SelectField label={lang === 'ur' ? 'قسم' : 'Type'} value={type} onChange={setType} options={[{ value: 'SALE', label: lang === 'ur' ? 'فروخت واپسی' : 'Sale Return' }, { value: 'PURCHASE', label: lang === 'ur' ? 'خرید واپسی' : 'Purchase Return' }]} />
      <SelectField label={lang === 'ur' ? 'اصل دستاویز' : 'Original Document'} value={originalId} onChange={setOriginalId} placeholder={lang === 'ur' ? 'منتخب کریں' : 'Select'}
        options={(docs.data?.rows ?? []).map((d: any) => ({ value: d.id, label: d.number }))} />
      <TextField label={lang === 'ur' ? 'لائن ID' : 'Line ID'} value={lineId} onChange={setLineId} required dir="ltr" />
      <QtyField label={lang === 'ur' ? 'واپس تعداد' : 'Return Quantity'} milli={qty} onChange={setQty} required />
      <TextField label={lang === 'ur' ? 'وجہ' : 'Reason'} value={reason} onChange={setReason} required />
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button onClick={async () => {
        try { await api('/api/v1/returns', { method: 'POST', body: { type, original_id: originalId, date: TODAY(), reason, refund_method: 'KHATA', lines: [{ line_id: lineId, qty_milli: qty }] } }); toast(lang === 'ur' ? 'واپسی پوسٹ ہو گئی' : 'Return posted'); refetch(); setOpen(false); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }}>{lang === 'ur' ? 'پوسٹ کریں' : 'Post'}</Button>
    </Sheet>
  </div>;
}

// -------------------------------- Online orders ------------------------------
export function OrdersScreen() {
  const { toast, can, t, lang } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState('');
  const { data, isLoading, error, refetch } = useGet<any[]>('orders', `/api/v1/orders${tab ? `?status=${tab}` : ''}`);
  const [sel, setSel] = useState<any>(null);
  const [paid, setPaid] = useState(true), [note, setNote] = useState(''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const ready = useGet<any>('checkout-ready', '/api/v1/orders-meta/checkout-ready');
  const review = can('orders.review');

  const ORDER_TABS = [
    { id: '', label: lang === 'ur' ? 'تمام' : 'All' },
    { id: 'NEW', label: lang === 'ur' ? 'نئے' : 'New' },
    { id: 'UNDER_REVIEW', label: lang === 'ur' ? 'جائزے میں' : 'Under Review' },
    { id: 'APPROVED', label: lang === 'ur' ? 'منظور' : 'Approved' },
    { id: 'REJECTED', label: lang === 'ur' ? 'مسترد' : 'Rejected' },
  ];
  const ORDER_STATUS_MAP: Record<string, string> = {
    NEW: lang === 'ur' ? 'نیا' : 'New',
    UNDER_REVIEW: lang === 'ur' ? 'جائزہ' : 'Review',
    APPROVED: lang === 'ur' ? 'منظور' : 'Approved',
    REJECTED: lang === 'ur' ? 'مسترد' : 'Rejected',
    CANCELLED: lang === 'ur' ? 'منسوخ' : 'Cancelled',
  };

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true); setErr('');
    try { await fn(); toast(msg); setSel(null); refetch(); }
    catch (e: any) { setErr(e.message_ur ?? String(e)); }
    finally { setBusy(false); }
  };

  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="orders" label={t('orders')} size={34} />{t('orders')}</h1>
      </div>
    </div>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      {ready.data && <>
        <Chip tone={ready.data.payment_methods ? 'success' : 'warning'}>{t('paymentMethods')}: <span className="num">{ready.data.payment_methods}</span></Chip>
        <Chip tone={ready.data.priced_products ? 'success' : 'warning'}>{lang === 'ur' ? 'قیمت والی مصنوعات: ' : 'Priced Products: '}<span className="num">{ready.data.priced_products}</span></Chip>
        <Chip tone={ready.data.pending_orders ? 'info' : 'gray'}>{lang === 'ur' ? 'زیرِ جائزہ: ' : 'Under Review: '}<span className="num">{ready.data.pending_orders}</span></Chip>
      </>}
    </div>
    <Tabs tabs={ORDER_TABS} active={tab} onChange={setTab} />
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <DataTable rows={data ?? []} csvName="orders" onRow={(r) => { setSel(r); setErr(''); setReason(''); setNote(''); }} columns={[
        { key: 'number', label: lang === 'ur' ? 'حوالہ' : 'Ref' },
        { key: 'customer_name', label: lang === 'ur' ? 'نام' : 'Customer' },
        { key: 'mobile', label: lang === 'ur' ? 'موبائل' : 'Phone' },
        { key: 'city', label: lang === 'ur' ? 'شہر' : 'City' },
        { key: 'payment_method', label: t('paymentMethod') },
        { key: 'total_paisa', label: t('total'), money: true },
        { key: 'proofs', label: lang === 'ur' ? 'رسیدیں' : 'Proofs', render: (r: any) => <span className="num">{(r.proofs ?? []).length}</span> },
        { key: 'status', label: t('status'), render: (r: any) => <Chip tone={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'danger' : r.status === 'UNDER_REVIEW' ? 'info' : 'gray'}>{ORDER_STATUS_MAP[r.status] ?? r.status}</Chip> },
      ] as Column[]} />
    </AsyncView>

    <Sheet open={!!sel} onClose={() => setSel(null)} title={`${lang === 'ur' ? 'آرڈر' : 'Order'} ${sel?.number ?? ''}`}>
      {sel && <div className="card">
        <div className="kv">
          <span className="k">{lang === 'ur' ? 'نام' : 'Name'}</span><span className="v">{sel.customer_name}</span>
          <span className="k">{lang === 'ur' ? 'موبائل' : 'Phone'}</span><span className="v num">{sel.mobile}</span>
          <span className="k">{lang === 'ur' ? 'شہر' : 'City'}</span><span className="v">{sel.city}</span>
          <span className="k">{lang === 'ur' ? 'پتہ' : 'Address'}</span><span className="v">{sel.address || '—'}</span>
          <span className="k">{lang === 'ur' ? 'طریقہ' : 'Method'}</span><span className="v">{sel.payment_method}</span>
          <span className="k">{lang === 'ur' ? 'کل' : 'Total'}</span><span className="v num">{formatPKR(sel.total_paisa)}</span>
        </div>
        {!!sel.notes && <p className="small">{lang === 'ur' ? 'نوٹ: ' : 'Note: '}{sel.notes}</p>}
        <table className="table"><thead><tr><th>{lang === 'ur' ? 'مصنوعات' : 'Product'}</th><th>{lang === 'ur' ? 'تعداد' : 'Qty'}</th><th>{lang === 'ur' ? 'ریٹ' : 'Rate'}</th><th>{lang === 'ur' ? 'رقم' : 'Total'}</th></tr></thead>
          <tbody>{(sel.items ?? []).map((i: any) => <tr key={i.name_ur + i.qty_milli}>
            <td>{lang === 'ur' ? i.name_ur : (i.name_en || i.name_ur)}</td>
            <td className="num">{fromMilli(i.qty_milli)} {i.unit}</td>
            <td className="num">{formatPKR(i.rate_paisa)}</td>
            <td className="num">{formatPKR(i.line_total_paisa)}</td>
          </tr>)}</tbody></table>

        {(sel.proofs ?? []).length > 0 && <>
          <h2 style={{ fontSize: 16, margin: '14px 0 8px' }}>{t('paymentProofs')}</h2>
          <div className="order-proofs">{sel.proofs.map((p: any) => <div className="order-proof" key={p.id}>
            {p.url ? <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={t('paymentProof')} loading="lazy" width={140} height={140} /></a>
              : <div className="order-proof-empty">{t('paymentProof')}</div>}
            <div className="small num">{formatPKR(p.amount_paisa)} · {p.status}</div>
            {p.sender_reference && <div className="small num">{p.sender_reference}</div>}
            {review && <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(
                () => api(`/api/v1/orders/${sel.id}/proofs/${p.id}/status`, { method: 'POST', body: { status: 'ACCEPTED' } }), lang === 'ur' ? 'رسید منظور' : 'Proof accepted')}>{lang === 'ur' ? 'منظور' : 'Approve'}</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(
                () => api(`/api/v1/orders/${sel.id}/proofs/${p.id}/status`, { method: 'POST', body: { status: 'REJECTED' } }), lang === 'ur' ? 'رسید مسترد' : 'Proof rejected')}>{lang === 'ur' ? 'مسترد' : 'Reject'}</button>
            </div>}
          </div>)}</div>
        </>}

        {sel.status === 'APPROVED' && <div className="notice info small">{lang === 'ur' ? `یہ آرڈر فروخت میں تبدیل ہو چکا ہے: ${(sel.sale_ids ?? []).length} دستاویز۔ اسٹاک و کھاتہ بدل چکا ہے۔` : 'Order approved and posted to Sales. Inventory and accounts updated.'}</div>}
        {!!sel.reject_reason && <div className="err"><Mark kind="warn" /> {sel.reject_reason}</div>}

        {review && !['APPROVED', 'REJECTED', 'CANCELLED'].includes(sel.status) && <>
          <CheckField label={t('markPaid')} checked={paid} onChange={setPaid} />
          <TextField label={lang === 'ur' ? 'نوٹ (اختیاری)' : 'Note (optional)'} value={note} onChange={setNote} />
          {err && <div className="err"><Mark kind="warn" /> {err}</div>}
          <div className="btn-row">
            <Button loading={busy} onClick={() => act(
              () => api(`/api/v1/orders/${sel.id}/approve`, { method: 'POST', body: { paid, mark_proof_accepted: true, note, idempotency_key: `ORD:${sel.id}:UI:${Date.now()}` } }),
              lang === 'ur' ? 'آرڈر فروخت بن گیا' : 'Order approved & posted')}>{t('approveOrder')}</Button>
            <Button variant="danger" disabled={!reason || busy} loading={busy} onClick={() => act(
              () => api(`/api/v1/orders/${sel.id}/reject`, { method: 'POST', body: { reason } }), lang === 'ur' ? 'آرڈر مسترد' : 'Order rejected')}>{t('rejectOrder')}</Button>
          </div>
        </>}
      </div>}
    </Sheet>
  </div>;
}

// ------------------------------ Payment methods ------------------------------
export function PaymentMethodsScreen() {
  const { toast, can, t, lang } = useApp();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useGet<any[]>('payment-methods', '/api/v1/payment-methods');
  const accounts = useGet<any[]>('accounts', '/api/v1/accounts');
  const write = can('payments.methods.write');
  const [sel, setSel] = useState<any>(null);
  const [isNew, setIsNew] = useState(false);
  const BLANK_METHOD = {
    kind: 'BANK', title_ur: '', title_en: '', bank_name: '', account_title: '', account_number: '',
    iban: '', mobile_number: '', instructions_ur: '', account_id: '', is_active: true, sort: 0,
  };
  const [form, setForm] = useState<any>(BLANK_METHOD);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const METHOD_KINDS = [
    { value: 'BANK', label: lang === 'ur' ? 'بینک اکاؤنٹ' : 'Bank Account' },
    { value: 'EASYPAISA', label: lang === 'ur' ? 'ایزی پیسہ' : 'Easypaisa' },
    { value: 'JAZZCASH', label: lang === 'ur' ? 'جاز کیش' : 'JazzCash' },
    { value: 'WALLET', label: lang === 'ur' ? 'والٹ' : 'Wallet' },
    { value: 'CASH', label: lang === 'ur' ? 'نقد / دکان' : 'Cash on Delivery' },
  ];

  const open = (m?: any) => {
    setErr('');
    setIsNew(!m);
    setForm(m ? { ...BLANK_METHOD, ...m, account_id: m.account_id ?? '' } : { ...BLANK_METHOD, sort: (data ?? []).length * 10 });
    setSel(m ?? { id: '' });
  };
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { ...form, account_id: form.account_id || null, is_active: !!form.is_active, sort: Number(form.sort) || 0 };
      await api(isNew ? '/api/v1/payment-methods' : `/api/v1/payment-methods/${body.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(t('saved')); refetch(); setSel(null);
    } catch (e: any) { setErr(e.message_ur ?? String(e)); }
    finally { setBusy(false); }
  };

  const remove = async (m: any) => {
    setBusy(true);
    try { const r = await api<any>(`/api/v1/payment-methods/${m.id}`, { method: 'DELETE' }); toast(r.deactivated ? (lang === 'ur' ? 'غیر فعال کر دیا' : 'Deactivated') : (lang === 'ur' ? 'حذف کر دیا' : 'Deleted')); refetch(); }
    catch (e: any) { toast(e.message_ur ?? String(e), 'err'); }
    finally { setBusy(false); }
  };

  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="payments" label={t('paymentMethods')} size={34} />{t('paymentMethods')}</h1>
      </div>
      {write && <div className="btn-row no-print"><Button size="sm" onClick={() => open()}>{t('newPaymentMethod')}</Button></div>}
    </div>
    <p className="small">{t('paymentMethodsNote')}</p>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <div className="method-grid">{(data ?? []).map((m) => <TiltCard key={m.id} className="method-card" tone={m.is_active ? 'default' : 'pink'}>
        <div className="method-card-head">
          <span className={`method-badge`} data-kind={m.kind} aria-hidden="true" />
          <div><strong>{lang === 'ur' ? m.title_ur : (m.title_en || m.title_ur)}</strong><div className="small">{METHOD_KINDS.find((k) => k.value === m.kind)?.label ?? m.kind}</div></div>
          <Chip tone={m.is_active ? 'success' : 'gray'} className="method-state">{m.is_active ? (lang === 'ur' ? 'فعال' : 'Active') : (lang === 'ur' ? 'بند' : 'Inactive')}</Chip>
        </div>
        {m.qr_url && <div className="method-qr"><img src={m.qr_url} alt={`${m.title_ur} QR`} loading="lazy" width={160} height={160} /></div>}
        <div className="small">{m.bank_name || m.account_title || m.mobile_number || '—'}</div>
        {!!m.account_number && <div className="small num">{m.account_number}</div>}
        {!!m.iban && <div className="small num">{m.iban}</div>}
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          {write && <Button size="sm" variant="secondary" onClick={() => open(m)}>{t('edit')}</Button>}
          {write && <Button size="sm" variant="secondary" onClick={() => remove(m)} loading={busy}>{t('delete')}</Button>}
        </div>
      </TiltCard>)}</div>
    </AsyncView>

    <Sheet open={!!sel} onClose={() => setSel(null)} title={isNew ? t('newPaymentMethod') : t('edit')}>
      <SelectField label={t('paymentMethod')} value={form.kind} onChange={(v) => set('kind', v)} options={METHOD_KINDS} />
      <TextField label={`${t('name')} (اردو)`} value={form.title_ur} onChange={(v) => set('title_ur', v)} required />
      <TextField label={`${t('name')} (English)`} value={form.title_en} onChange={(v) => set('title_en', v)} dir="ltr" />
      {form.kind === 'BANK' && <>
        <TextField label={lang === 'ur' ? 'بینک نام' : 'Bank Name'} value={form.bank_name} onChange={(v) => set('bank_name', v)} />
        <TextField label={lang === 'ur' ? 'اکاؤنٹ ٹائٹل' : 'Account Title'} value={form.account_title} onChange={(v) => set('account_title', v)} />
        <TextField label={lang === 'ur' ? 'اکاؤنٹ نمبر' : 'Account Number'} value={form.account_number} onChange={(v) => set('account_number', v)} dir="ltr" inputMode="numeric" />
        <TextField label="IBAN" value={form.iban} onChange={(v) => set('iban', v)} dir="ltr" />
      </>}
      {(form.kind === 'EASYPAISA' || form.kind === 'JAZZCASH' || form.kind === 'WALLET') &&
        <TextField label={t('mobile')} value={form.mobile_number} onChange={(v) => set('mobile_number', v)} dir="ltr" inputMode="tel" />}
      <SelectField label={t('linkedAccount')} value={form.account_id} onChange={(v) => set('account_id', v)} placeholder={lang === 'ur' ? 'نجی' : 'Private'}
        options={(accounts.data ?? []).map((a: any) => ({ value: a.id, label: `${lang === 'ur' ? a.name_ur : (a.name_en || a.name_ur)} (${a.code ?? ''})` }))} />
      <div className="field"><label htmlFor="pm-inst">{t('note')}</label>
        <textarea id="pm-inst" className="input" rows={3} value={form.instructions_ur} onChange={(e) => set('instructions_ur', e.target.value)} /></div>
      <CheckField label={lang === 'ur' ? 'فعال' : 'Active'} checked={!!form.is_active} onChange={(v) => set('is_active', v)} />
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button onClick={save} loading={busy} disabled={!form.title_ur}>{t('save')}</Button>
    </Sheet>
  </div>;
}

// ------------------------- Universal Create / Invoice Creator ----------------
export function UniversalCreateScreen() {
  const { lang, can } = useApp();
  const nav = useNavigate();
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const entries = [
    { id: 'fert_sale', cat: 'sales', perm: 'sales.post', ur: 'کھاد فروخت انوائس', en: 'Fertilizer Sale Invoice', desc_ur: 'یوریا، ڈی اے پی، این پی و دیگر کھاد کی فروخت', desc_en: 'Sell Urea, DAP, NP and all fertilizers', to: '/erp/fertilizer/sale/new', icon: 'FERT', badge: 'FERT' },
    { id: 'pest_sale', cat: 'sales', perm: 'sales.post', ur: 'پیسٹی سائیڈ فروخت انوائس', en: 'Pesticide Sale Invoice', desc_ur: 'سپرے و ادویات برائے فصل (بیچ اور ایکسپائری لازمی)', desc_en: 'Sell pesticides with batch & expiry tracking', to: '/erp/pesticide/sale/new', icon: 'PEST', badge: 'PEST' },
    { id: 'general_sale', cat: 'sales', perm: 'sales.post', ur: 'عام فروخت بل', en: 'General Sale Bill', desc_ur: 'چوکر، ونڈا، سیمنٹ، بیج و دیگر اشیاء کی فروخت', desc_en: 'Sale invoice for feed, seed, cement & goods', to: '/erp/sales/new', icon: 'sales', badge: 'SALE' },
    { id: 'fert_purch', cat: 'purchases', perm: 'purchases.post', ur: 'کھاد خریداری بل', en: 'Fertilizer Purchase Bill', desc_ur: 'سپلائر سے کھاد کی خریداری اور گودام میں مال اندر', desc_en: 'Purchase fertilizers from suppliers into stock', to: '/erp/fertilizer/purchase/new', icon: 'FERT', badge: 'PURCHASE' },
    { id: 'pest_purch', cat: 'purchases', perm: 'purchases.post', ur: 'پیسٹی سائیڈ خریداری بل', en: 'Pesticide Purchase Bill', desc_ur: 'پیسٹی سائیڈ مال اندر مع بیچ نمبر اور میعاد', desc_en: 'Purchase pesticides with batch & expiry tracking', to: '/erp/pesticide/purchase/new', icon: 'PEST', badge: 'PURCHASE' },
    { id: 'general_purch', cat: 'purchases', perm: 'purchases.post', ur: 'عام خریداری بل (اسٹاک اندر)', en: 'General Purchase Bill', desc_ur: 'چوکر، ونڈا، بیج وغیرہ کی خریداری اور اسٹاک میں اضافہ', desc_en: 'Purchase general goods & feed into warehouse', to: '/erp/purchases/new', icon: 'purchases', badge: 'PURCHASE' },
    { id: 'grain_purch', cat: 'purchases', perm: 'grains.post', ur: 'اجناس / غلہ خریداری واؤچر', en: 'Grain Lot Purchase (Weight)', desc_ur: 'گندم، دھان، مکئی خریداری (خام وزن، ٹیر، خالص وزن)', desc_en: 'Buy grain at mandi scale: gross, tare, net weight', to: '/erp/grains/WHEAT/purchase/new', icon: 'WHEAT', badge: 'GRAIN' },
    { id: 'grain_sale', cat: 'sales', perm: 'grains.post', ur: 'اجناس / غلہ فروخت واؤچر', en: 'Grain Lot Sale', desc_ur: 'گندم، دھان، مکئی کی ملوں یا خریداروں کو فروخت', desc_en: 'Sell grain lots to mills or mandi merchants', to: '/erp/grains/WHEAT/sale/new', icon: 'WHEAT', badge: 'GRAIN' },
    { id: 'payroll_run', cat: 'payroll', perm: 'employees.read', ur: 'ملازم تنخواہ واؤچر', en: 'Salary / Payroll Voucher', desc_ur: 'ماہانہ تنخواہ سلپ، ایڈوانس کٹوتی اور خالص تنخواہ ادائیگی', desc_en: 'Process monthly salaries, deductions & net payroll', to: '/erp/employees', icon: 'employees', badge: 'PAYROLL' },
    { id: 'salary_adv', cat: 'payroll', perm: 'expenses.post', ur: 'تنخواہ ایڈوانس / ملازم ادھار', en: 'Salary Advance Voucher', desc_ur: 'ملازمین کو پیشگی تنخواہ یا ایڈوانس ادائیگی', desc_en: 'Advance payment to employees before month end', to: '/erp/expenses/new', icon: 'employees', badge: 'ADVANCE' },
    { id: 'expense_v', cat: 'payroll', perm: 'expenses.post', ur: 'دکان خرچہ واؤچر', en: 'Shop Expense Voucher', desc_ur: 'بجلی بل، کرایہ، گاڑی کا کرایہ، چائے پانی، مرمت وغیرہ', desc_en: 'Shop rent, electricity, freight, refreshments, tea', to: '/erp/expenses/new', icon: 'expenses', badge: 'EXPENSE' },
    { id: 'receipt_v', cat: 'money', perm: 'receipts.post', ur: 'رقم وصولی رسید (کیش / بینک)', en: 'Cash / Bank Receipt Voucher', desc_ur: 'گاہک یا کاشتکار سے رقم وصول کر کے کھاتے میں جمع', desc_en: 'Receive money into cash drawer or bank accounts', to: '/erp/receipts/new', icon: 'accounts', badge: 'RECEIPT' },
    { id: 'payment_v', cat: 'money', perm: 'payments.post', ur: 'رقم ادائیگی واؤچر (سپلائر / کاشتکار)', en: 'Cash / Bank Payment Voucher', desc_ur: 'سپلائر یا کاشتکار کو نقد یا بینک کے ذریعے ادائیگی', desc_en: 'Pay suppliers, farmers, vendors from cash or bank', to: '/erp/payments/new', icon: 'accounts', badge: 'PAYMENT' },
    { id: 'transfer_v', cat: 'money', perm: 'accounts.read', ur: 'کھاتہ فنڈ منتقلی (کیش ↔ بینک)', en: 'Bank / Cash Fund Transfer', desc_ur: 'کیش سے بینک میں جمع یا بینک سے کیش نکالنا', desc_en: 'Transfer funds between cash drawer and bank accounts', to: '/erp/accounts/transfer', icon: 'accounts', badge: 'TRANSFER' },
    { id: 'party_new', cat: 'money', perm: 'parties.read', ur: 'نیا کھاتہ دار / فریق بنائیں', en: 'New Party / Customer / Vendor', desc_ur: 'نیا گاہک، سپلائر، کاشتکار یا ملازم کھاتہ درج کریں', desc_en: 'Register a new customer, supplier, farmer, or worker', to: '/erp/parties/new', icon: 'parties', badge: 'KHATA' },
    { id: 'prod_new', cat: 'stock', perm: 'products.read', ur: 'نئی پروڈکٹ شامل کریں', en: 'New Product Entry', desc_ur: 'کیٹلاگ میں نیا سامان، کھاد، پیسٹی سائیڈ یا آئٹم بنائیں', desc_en: 'Add new goods, fertilizer or pesticide item', to: '/erp/products/new', icon: 'products', badge: 'PRODUCT' },
    { id: 'opening_stk', cat: 'stock', perm: 'stock.read', ur: 'ابتدائی اسٹاک واؤچر', en: 'Opening Stock Entry', desc_ur: 'گودام میں موجود مال کا افتتاحی وزن اور لاگت درج کریں', desc_en: 'Record verified initial stock quantities and costs', to: '/erp/inventory', icon: 'inventory', badge: 'OPENING' },
    { id: 'stock_adj', cat: 'stock', perm: 'stock.read', ur: 'اسٹاک ایڈجسٹمنٹ واؤچر', en: 'Stock Adjustment', desc_ur: 'کمی بیشی، نقصان یا فزیکل کاؤنٹ کے فرق کا اندراج', desc_en: 'Adjust inventory counts with audit trail & reasons', to: '/erp/inventory', icon: 'inventory', badge: 'ADJUST' },
    { id: 'return_v', cat: 'sales', perm: 'returns.read', ur: 'واپسی واؤچر (سیل / پرچیز ریٹرن)', en: 'Sales / Purchase Return', desc_ur: 'گاہک کی مال واپسی یا سپلائر کو واپسی', desc_en: 'Customer sale returns or supplier purchase returns', to: '/erp/returns', icon: 'returns', badge: 'RETURN' },
  ];

  const filtered = entries.filter((e) => {
    if (e.perm && !can(e.perm)) return false;
    if (filter !== 'ALL' && e.cat !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return e.ur.toLowerCase().includes(q) || e.en.toLowerCase().includes(q) || e.desc_ur.toLowerCase().includes(q) || e.desc_en.toLowerCase().includes(q);
    }
    return true;
  });

  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
          <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
        </button>
        <h1 className="head-icon"><NavIcon icon="documents" label={lang === 'ur' ? 'نیا واؤچر / انوائس بنائیں' : 'Create Voucher / Invoice'} size={34} />{lang === 'ur' ? 'نیا واؤچر / انوائس بنائیں' : 'Create Voucher / Invoice'}</h1>
      </div>
    </div>

    <div className="toolbar no-print" style={{ marginBlock: '12px 16px' }}>
      <input className="input" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder={lang === 'ur' ? 'واؤچر یا انوائس کی قسم تلاش کریں…' : 'Search voucher or invoice type…'}
        aria-label={lang === 'ur' ? 'تلاش' : 'Search'} style={{ maxWidth: 360 }} />
      <div className="btn-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button type="button" className={`btn btn-sm ${filter === 'ALL' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('ALL')}>{lang === 'ur' ? 'تمام' : 'All'}</button>
        <button type="button" className={`btn btn-sm ${filter === 'sales' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('sales')}>{lang === 'ur' ? 'فروخت و بل' : 'Sales'}</button>
        <button type="button" className={`btn btn-sm ${filter === 'purchases' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('purchases')}>{lang === 'ur' ? 'خریداری' : 'Purchases'}</button>
        <button type="button" className={`btn btn-sm ${filter === 'payroll' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('payroll')}>{lang === 'ur' ? 'تنخواہ و اخراجات' : 'Payroll & Expenses'}</button>
        <button type="button" className={`btn btn-sm ${filter === 'money' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('money')}>{lang === 'ur' ? 'رقم و کھاتہ' : 'Money & Khata'}</button>
        <button type="button" className={`btn btn-sm ${filter === 'stock' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('stock')}>{lang === 'ur' ? 'اسٹاک و پروڈکٹس' : 'Stock & Items'}</button>
      </div>
    </div>

    <div className="quick-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
      {filtered.map((item) => (
        <TiltCard key={item.id} href={item.to} tone="default" className="create-voucher-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <NavIcon icon={item.icon} label={lang === 'ur' ? item.ur : item.en} size={36} />
            <Chip tone="success">{item.badge}</Chip>
          </div>
          <strong style={{ fontSize: '1.05rem', color: 'var(--text-bright)' }}>{lang === 'ur' ? item.ur : item.en}</strong>
          <p className="small" style={{ color: 'var(--text-dim)', margin: 0, lineHeight: 1.4 }}>{lang === 'ur' ? item.desc_ur : item.desc_en}</p>
        </TiltCard>
      ))}
    </div>
    {!filtered.length && <EmptyState title={lang === 'ur' ? 'کوئی اندراج نہیں ملا' : 'No matching voucher type found'} />}
  </div>;
}
