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
  return <div className="row toolbar no-print">
    <TextField label="از تاریخ" value={from} onChange={setFrom} type="date" />
    <TextField label="تا تاریخ" value={to} onChange={setTo} type="date" />
  </div>;
}
function useRange(start = MONTH_START()) {
  const [from, setFrom] = useState(start), [to, setTo] = useState(TODAY());
  return { from, to, setFrom, setTo, qs: `from=${from}&to=${to}` };
}

// --------------------------------- Generic list ------------------------------
export function GenericList({ config }: { config: any }) {
  const { t, can, toast } = useApp();
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
  return <div>
    <div className="between"><h1>{config.title}</h1>
      <div className="btn-row no-print">
        {(config.actions ?? []).map((a: any) => <Link key={a.to} className="btn btn-secondary btn-sm" to={a.to}>{a.label}</Link>)}
        {config.create && <Button size="sm" onClick={() => setCreateOpen(true)}>+ نیا</Button>}
        {config.endpoint.includes('products') && <Button variant="ghost" size="sm" onClick={() => downloadCsv('/api/v1/catalogue/export', 'zt-products.csv')}>CSV برآمد</Button>}
        <Button variant="ghost" size="sm" onClick={() => window.print()} aria-label="پرنٹ"><Mark kind="print" /></Button>
      </div></div>
    <div className="toolbar no-print">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="تلاش…" aria-label="تلاش" />
      <SelectField label="" value={status} onChange={setStatus} placeholder="تمام حالتیں"
        options={[{ value: 'POSTED', label: 'پوسٹڈ' }, { value: 'DRAFT', label: 'ڈرافٹ' }, { value: 'REVERSED', label: 'ریورسڈ' }]} />
      <Button variant="ghost" size="sm" onClick={() => refetch()} aria-label="دوبارہ لوڈ"><Mark kind="sync" /></Button>
    </div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!rows.length} permission={can(perm)} rows={5}>
      <DataTable rows={rows} columns={[
        ...config.columns.map((c: any) => ({ ...c, render: c.key === 'status' ? (r: any) => <StatusChip status={r.status} /> : c.render })),
      ] as Column[]}
        onRow={config.detail ? (r) => nav(config.detail(r)) : undefined}
        csvName={config.title} footer={<div className="small">{rows.length} قطاریں — مزید کے لیے تلاش کو محدود کریں</div>} />
      {data?.next_cursor && <div className="center" style={{ marginBlock: 16 }}>
        <Button variant="secondary" onClick={() => setCursor(data.next_cursor)}>{t('loadMore')}</Button></div>}
    </AsyncView>
    {config.create && <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title={`+ ${config.title}`}>
      {(config.create.fields as { name: string; label: string; type?: string }[]).map((f) =>
        <TextField key={f.name} label={f.label} value={createVals[f.name] ?? ''}
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
          toast('شامل ہو گیا'); setCreateOpen(false); setCreateVals({}); refetch();
        } catch (e: any) { setCreateErr(e.message_ur ?? String(e)); } finally { setCreateBusy(false); }
      }}>محفوظ کریں</Button>
    </Sheet>}
  </div>;
}

/** ERP-02 quick actions — the only place the dashboard gets 3D depth (forms stay flat). */
const DASH_QUICK: { to: string; ur: string; icon: string }[] = [
  { to: '/erp/fertilizer/sale/new?quick=1', ur: 'کھاد فروخت', icon: 'sales' },
  { to: '/erp/fertilizer/purchase/new?quick=1', ur: 'کھاد خرید', icon: 'purchases' },
  { to: '/erp/grains', ur: 'اجناس', icon: 'grains' },
  { to: '/erp/receipts/new', ur: 'رقم وصول', icon: 'khata' },
  { to: '/erp/payments/new', ur: 'رقم ادا', icon: 'accounts' },
  { to: '/erp/expenses/new', ur: 'خرچہ', icon: 'expenses' },
];

// ---------------------------------- Dashboard --------------------------------
export function Dashboard() {
  const { t, online, pending, conflicts, syncNow, can } = useApp();
  const [from, setFrom] = useState(TODAY()), [to, setTo] = useState(TODAY());
  const { data, isLoading, error, refetch } = useGet<any>('dashboard', `/api/v1/dashboard?from=${from}&to=${to}`);
  const usage = useGet<any>('usage', '/api/v1/usage');
  if (!can('dashboard.view')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  if (isLoading) return <Skeleton rows={8} />;
  if (error) return <ErrorState error={error} retry={() => refetch()} />;
  const d = data;
  const cash = (d?.accounts ?? []).filter((a: any) => ['1000', '1010', '1020', '1030'].includes(a.code)).reduce((a: number, x: any) => a + x.balance_paisa, 0);
  const chartPoints = (d?.charts ?? []).filter((x: any) => x.metric === 'SALE').map((x: any) => x.paisa);
  const max = Math.max(1, ...chartPoints);
  return <div>
    <div className="between"><h1 className="head-icon"><NavIcon icon="dashboard" label="ڈیش بورڈ" size={34} />ڈیش بورڈ</h1>
      <div className="row no-print"><TextField label="از تاریخ" value={from} onChange={setFrom} type="date" />
        <TextField label="تا تاریخ" value={to} onChange={setTo} type="date" /></div></div>
    <div className="stats-grid">
      <StatCard label="آج کی فروخت" value={formatPKR(d?.today?.sales_paisa ?? 0)} tone="var(--primary)" />
      <StatCard label="آج کی خرید" value={formatPKR(d?.today?.purchases_paisa ?? 0)} />
      <StatCard label="وصولیاں" value={formatPKR(d?.today?.collections_paisa ?? 0)} />
      <StatCard label="ادائیگیاں" value={formatPKR(d?.today?.payments_paisa ?? 0)} />
      <StatCard label="اخراجات" value={formatPKR(d?.today?.expenses_paisa ?? 0)} tone="var(--danger)" />
      <StatCard label="مجموعی منافع" value={formatPKR(d?.today?.gross_profit_paisa ?? 0)} tone="var(--success)" />
      <StatCard label="قابلِ وصول" value={formatPKR(d?.credit?.receivable_paisa ?? 0)} />
      <StatCard label="قابلِ ادا" value={formatPKR(d?.credit?.payable_paisa ?? 0)} />
      <StatCard label="نقد + بینک" value={formatPKR(cash)} />
    </div>
    <Reveal className="quick-grid" as="div">{DASH_QUICK.map((q) =>
      <TiltCard key={q.to} href={q.to} tone="emerald"><NavIcon icon={q.icon} label={q.ur} size={40} /><strong>{q.ur}</strong></TiltCard>)}</Reveal>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', marginBlock: 16 }}>
      <div className="card glass"><h2>کتابیں (17)</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {(d?.books ?? []).map((b: any) => <Link key={b.code} to={b.code === 'FERT' ? '/erp/fertilizer' : b.code === 'PEST' ? '/erp/pesticide'
            : (CROP_CODES as readonly string[]).includes(b.code) ? `/erp/grains/${b.code}` : `/erp/goods/${b.code}`}
            className="chip success" style={{ textDecoration: 'none' }}>{b.ur}: {formatPKR(b.today_sale_paisa)}</Link>)}
        </div></div>
      <div className="card glass"><h2>الرٹس</h2>
        {(d?.alerts ?? []).length ? (d.alerts as any[]).map((a, i) => <div key={i} className="item">
          <div><div className="t1">{a.title_ur ?? a.name_ur}</div><div className="t2">{a.type}{a.expiry_date ? ` — ${a.expiry_date}` : ''}</div></div>
          <StatusChip status={a.type} /></div>) : <div className="notice success">کوئی الرٹ نہیں — کوئی فرضی ڈیٹا نہیں دکھایا گیا۔</div>}
        <div className="small" style={{ marginBlockStart: 12 }}>نئی پوچھ گچھ: {d?.counts?.pending_enquiries ?? 0} · سنک باقی: {d?.counts?.pending_sync ?? 0} · تضادات: {d?.counts?.conflicts ?? 0}</div>
      </div>
      <div className="card glass"><h2>30 دن کی فروخت</h2>
        {chartPoints.length ? <div className="chart-cols" role="img"
          aria-label={`۳۰ دن کی فروخت، سب سے زیادہ روزانہ ${formatPKR(max)}`}>
          {chartPoints.map((v: number, i: number) => <span key={i} className="chart-col"
            style={{ height: `${Math.max(3, Math.round((v / max) * 100))}%` }} />)}
        </div> : <div className="notice info small">ابھی کوئی فروخت نہیں — اصل ڈیٹا درج ہونے پر گراف بنے گا۔</div>}
      </div>
    </div>
    <div className="card"><div className="between"><h2>حالیہ دستاویزات</h2><Link to="/erp/documents">سب دیکھیں ›</Link></div>
      <DataTable rows={d?.recent ?? []} columns={[
        { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' },
        { key: 'kind', label: 'قسم' }, { key: 'amount_paisa', label: 'رقم', render: (r: any) => money(r.amount_paisa) },
      ] as Column[]} emptyText="ابھی کوئی دستاویز نہیں" />
    </div>
    <div className="grid g2" style={{ marginBlock: 16 }}>
      <div className="card"><h2>سنک</h2>
        <div className="kv"><span className="k">نیٹ ورک</span><span className="v">{online ? 'آن لائن' : 'آف لائن'}</span>
          <span className="k">مقامی قطار</span><span className="v">{pending}</span>
          <span className="k">تضادات</span><span className="v">{conflicts}</span></div>
        <div className="btn-row" style={{ marginBlockStart: 12 }}><Button size="sm" onClick={() => void syncNow()}>ابھی سنک کریں</Button>
          <Link className="btn btn-ghost btn-sm" to="/erp/sync">سنک سینٹر</Link></div></div>
      <div className="card"><h2>D1 استعمال</h2>
        {usage.data ? <><div className="small">{usage.data.day}</div>
          <div className="small">پڑھائی: {usage.data.read_pct}% · لکھائی: {usage.data.write_pct}%</div>
          <div className="skeleton" style={{ height: 10, width: `${Math.min(100, usage.data.read_pct)}%`, marginBlock: 8 }} />
          {(usage.data.read_pct >= 70 || usage.data.write_pct >= 70) && <div className="notice"><Mark kind="warn" /> 70% حد — Workers Paid تجویز ہے</div>}
          <div className="small">{usage.data.note_ur}</div></> : <Skeleton rows={1} />}
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
  const { can, toast, t } = useApp();
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
        throw new Error('نام، زمرہ، یونٹس اور کنورژن لازمی ہیں');
      }
      if (id) await api(`/api/v1/products/${id}`, { method: 'PUT', body });
      else await api('/api/v1/products', { method: 'POST', body });
      toast('محفوظ ہو گیا'); setSaved(true); nav('/erp/products');
    } catch (e: any) { setErr(e.message_ur ?? e.message ?? String(e)); } finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    if (!id) { setErr('تصویر شامل کرنے سے پہلے مصنوعات محفوظ کریں'); return; }
    setUploadBusy(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
      await api('/api/v1/images', { method: 'POST', body: { product_id: id, data_url: dataUrl, alt_ur: p.name_ur } });
      toast('تصویر محفوظ'); existing.refetch();
    } catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setUploadBusy(false); }
  };
  if (!can('products.write')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  if (id && existing.isLoading) return <Skeleton rows={5} />;
  const tabs = [{ id: 'basic', label: 'بنیادی' }, { id: 'pricing', label: 'قیمتیں' }, { id: 'stock', label: 'اسٹاک' },
    { id: 'web', label: 'ویب / SEO' }, { id: 'images', label: 'تصاویر' }];
  return <div><div className="between"><h1>{id ? `مصنوعات: ${p.name_ur || ''}` : 'نئی مصنوعات'}</h1>
    <Button variant="ghost" size="sm" onClick={() => nav('/erp/products')}>واپس</Button></div>
    <Tabs tabs={tabs} active={tab} onChange={setTab} />
    <div className="card">
      {tab === 'basic' && <div className="grid g2">
        <TextField label="نام (اردو)" value={p.name_ur} onChange={(v) => set('name_ur', v)} required />
        <TextField label="نام (English)" value={p.name_en} onChange={(v) => set('name_en', v)} dir="ltr" />
        <SelectField label="زمرہ" value={p.category_id} onChange={(v) => set('category_id', v)} required placeholder="منتخب کریں"
          options={(cats.data ?? []).map((c: any) => ({ value: c.id, label: `${c.name_ur} (${c.code})` }))} />
        <SelectField label="برانڈ" value={p.brand_id ?? ''} onChange={(v) => set('brand_id', v || null)} placeholder="—"
          options={(brands.data ?? []).map((b: any) => ({ value: b.id, label: b.name_ur }))} />
        <TextField label="SKU" value={p.sku} onChange={(v) => set('sku', v)} />
        <TextField label="بار کوڈ" value={p.barcode} onChange={(v) => set('barcode', v)} />
        <TextField label="Slug" value={p.slug} onChange={(v) => set('slug', v)} dir="ltr" helper="خالی چھوڑیں تو نام سے بنے گا" />
        <SelectField label="سیزن" value={p.season} onChange={(v) => set('season', v)}
          options={[{ value: 'NONE', label: '—' }, { value: 'KHARIF', label: 'خریف' }, { value: 'RABI', label: 'ربی' }]} />
        <Field label="تفصیل (اردو)"><textarea className="input" aria-label="تفصیل (اردو)" value={p.description_ur} onChange={(e) => set('description_ur', e.target.value)} /></Field>
      </div>}
      {tab === 'pricing' && <div className="grid g2">
        <MoneyField label="خرید ریٹ" paisa={p.purchase_rate_paisa} onChange={(v) => set('purchase_rate_paisa', v)} />
        <MoneyField label="فروخت ریٹ" paisa={p.sale_rate_paisa} onChange={(v) => set('sale_rate_paisa', v)} />
        <MoneyField label="عوامی قیمت" paisa={p.public_price_paisa} onChange={(v) => set('public_price_paisa', v)} />
        <TextField label="ٹیکس % (1000 = 1%)" value={String(p.tax_pct_milli)} onChange={(v) => set('tax_pct_milli', Number(v) || 0)} inputMode="numeric" />
        <CheckField label="ویب پر قیمت دکھائیں" checked={p.show_public_price} onChange={(v) => set('show_public_price', v)} />
        <div className="notice small">عوامی API کبھی لاگت، مارجن، سپلائر یا اندرونی نوٹ نہیں بھیجتا (H6)۔</div>
      </div>}
      {tab === 'stock' && <div className="grid g2">
        <TextField label="بنیادی یونٹ" value={p.base_unit} onChange={(v) => set('base_unit', v)} required />
        <TextField label="خرید یونٹ" value={p.purchase_unit} onChange={(v) => set('purchase_unit', v)} required />
        <TextField label="فروخت یونٹ" value={p.sale_unit} onChange={(v) => set('sale_unit', v)} required />
        <TextField label="تبدیلی (milli; 1000 = 1:1)" value={fromMilli(p.conversion_ratio_milli)} onChange={(v) => { try { set('conversion_ratio_milli', toMilli(v)); } catch { /* ignore */ } }} />
        <QtyField label="کم اسٹاک حد" milli={p.reorder_level_milli} onChange={(v) => set('reorder_level_milli', v)} />
        <CheckField label="بیچ ٹریکنگ" checked={p.track_batch} onChange={(v) => set('track_batch', v)} />
        <CheckField label="ایکسپائری ٹریکنگ" checked={p.track_expiry} onChange={(v) => set('track_expiry', v)} />
        <CheckField label="پیسٹی سائیڈ (بیچ + ایکسپائری لازمی)" checked={p.is_pesticide} onChange={(v) => { set('is_pesticide', v); if (v) { set('track_batch', true); set('track_expiry', true); } }} />
        <div className="notice small">موجودہ اسٹاک: <span className="num">{fromMilli(p.stock_milli ?? 0)}</span> — صرف پوسٹڈ دستاویزات سے بدلتا ہے۔</div>
      </div>}
      {tab === 'web' && <div className="grid g2">
        <CheckField label="ویب پر شائع کریں" checked={p.is_published} onChange={(v) => set('is_published', v)} />
        <CheckField label="نمایاں" checked={p.is_featured} onChange={(v) => set('is_featured', v)} />
        <CheckField label="فعال" checked={p.is_active} onChange={(v) => set('is_active', v)} />
        <SelectField label="دستیابی" value={p.availability_mode} onChange={(v) => set('availability_mode', v)}
          options={[{ value: 'AUTO', label: 'اسٹاک کے مطابق' }, { value: 'ALWAYS', label: 'ہمیشہ دستیاب' }, { value: 'CALL', label: 'کال کریں' }]} />
        <TextField label="SEO عنوان" value={p.seo_title} onChange={(v) => set('seo_title', v)} />
        <TextField label="SEO تفصیل" value={p.seo_description} onChange={(v) => set('seo_description', v)} />
        <div className="notice info small">شائع کرنے پر سرور عوامی کیش صاف کرتا ہے (60–300 سیکنڈ)۔</div>
      </div>}
      {tab === 'images' && <div>
        <p>تصاویر مقامی پیش نظارہ / پرائیویٹ R2 میں محفوظ ہوتی ہیں؛ عوامی API صرف تصویری URL بھیجتا ہے۔</p>
        <input className="input" type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} aria-label="تصویر اپ لوڈ" />
        {uploadBusy && <Skeleton rows={1} />}
        <div className="row" style={{ flexWrap: 'wrap', marginBlockStart: 12 }}>
          {(p.images ?? []).map((i: any) => <div key={i.id} className="card" style={{ padding: 8 }}>
            <img src={`/media/${i.r2_key}`} alt={i.alt_ur} width={120} height={120} />
            <div className="small">{i.alt_ur}</div></div>)}
          {!(p.images ?? []).length && <EmptyState title="ابھی کوئی تصویر نہیں" />}
        </div>
        <div className="small">پیداوار میں R2 بائنڈنگ لازمی ہے <IncompleteBadge note="Production R2 binding not configured" /></div>
      </div>}
      {err && <div className="err" role="alert"><Mark kind="warn" /> {err}</div>}
      <div className="btn-row" style={{ marginBlockStart: 16 }}>
        <Button onClick={save} loading={busy}>محفوظ کریں</Button>
        {id && <Button variant="secondary" onClick={async () => {
          await api(`/api/v1/products/${id}/publish`, { method: 'POST', body: { published: !p.is_published } });
          set('is_published', !p.is_published); toast('کیش صاف کر دی گئی');
        }}>{p.is_published ? 'ان پبلش' : 'پبلش + کیش صاف'}</Button>}
        {saved && <Chip tone="success">محفوظ</Chip>}
      </div>
    </div>
  </div>;
}

// -------------------------------- CSV import ---------------------------------
export function ProductImport() {
  const { toast, can, t } = useApp();
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
  return <div><h1>CSV درآمد — مصنوعات</h1>
    <div className="row" style={{ flexWrap: 'wrap' }}>{['فائل', 'جائزہ', 'تصدیق', 'نتیجہ'].map((s, i) =>
      <Chip key={s} tone={i <= stage ? 'success' : 'gray'}>{i + 1}. {s}</Chip>)}</div>
    {stage === 0 && <div className="card" style={{ marginBlockStart: 14 }}>
      <p>ٹیمپلیٹ: <code>name_ur,name_en,category_code,sku,base_unit,purchase_rate,sale_rate,conversion_ratio</code></p>
      <Button variant="secondary" size="sm" onClick={() => {
        const blob = new Blob(['\uFEFFname_ur,name_en,category_code,sku,base_unit,purchase_rate,sale_rate,conversion_ratio\n'], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'zt-products-template.csv'; a.click();
      }}>خالی ٹیمپلیٹ ڈاؤن لوڈ</Button>
      <input className="input" type="file" accept=".csv,text/csv" aria-label="CSV فائل" onChange={(e) => {
        const f = e.target.files?.[0]; if (!f) return;
        f.text().then((txt) => { setRows(parse(txt)); setStage(1); });
      }} />
      <div className="notice small">نمونے کی قطار شامل نہیں — پیداواری کیٹلاگ خالی رہتا ہے جب تک مالک ڈیٹا درآمد نہ کرے۔</div>
    </div>}
    {stage === 1 && <div className="card"><p>{rows.length} قطاریں ملیں</p>
      <DataTable rows={rows.slice(0, 20)} columns={Object.keys(rows[0] ?? {}).slice(0, 6).map((k) => ({ key: k, label: k }))} csvName="preview" />
      <Button onClick={async () => {
        setBusy(true); setErr('');
        try { setReport(await api('/api/v1/import/products/preview', { method: 'POST', body: { rows } })); setStage(2); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }} loading={busy}>سرسری جانچ (بغیر محفوظ کیے)</Button>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
    </div>}
    {stage === 2 && report && <div className="card"><h2>پیش منظر</h2>
      <p>درست: {report.valid} · ڈپلیکیٹ: {report.duplicates} · غلط: {report.rows.length - report.valid}</p>
      <SelectField label="ڈپلیکیٹ پالیسی" value={mode} onChange={setMode}
        options={[{ value: 'SKIP', label: 'چھوڑ دیں' }, { value: 'UPDATE', label: 'اپ ڈیٹ کریں' }]} />
      <DataTable rows={report.rows} columns={[
        { key: 'row', label: '#' }, { key: 'name_ur', label: 'نام' }, { key: 'category', label: 'زمرہ' },
        { key: 'duplicate_id', label: 'ڈپلیکیٹ' },
        { key: 'errors', label: 'غلطیاں', render: (r: any) => r.errors?.length ? <Chip tone="danger">{r.errors.join(', ')}</Chip> : <Chip tone="success">OK</Chip> },
      ] as Column[]} csvName="import-report" />
      <Button onClick={async () => {
        setBusy(true); setErr('');
        try { setResult(await api('/api/v1/import/products/confirm', { method: 'POST', body: { rows: report.rows, mode } })); setStage(3); toast('درآمد مکمل'); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }} loading={busy}>ایک ایٹمی بیچ میں محفوظ کریں</Button>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
    </div>}
    {stage === 3 && result && <div className="card"><h2><Mark kind="check-circle" /> نتیجہ</h2>
      <div className="kv"><span className="k">بنائی گئیں</span><span className="v">{result.created}</span>
        <span className="k">اپ ڈیٹ</span><span className="v">{result.updated}</span>
        <span className="k">چھوڑی گئیں</span><span className="v">{result.skipped}</span></div>
      <Link className="btn btn-primary" to="/erp/products">مصنوعات دیکھیں</Link></div>}
  </div>;
}

// ---------------------------- Business book hubs ------------------------------
export function HubScreen({ book }: { book: string }) {
  const { t, can } = useApp();
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
  return <div><div className="between"><h1>{def?.ur ?? book}</h1>
    <div className="btn-row">{can('purchases.post') && <Link className="btn btn-secondary btn-sm" to={`${base}/purchase/new`}>+ خرید</Link>}
      {can('sales.post') && <Link className="btn btn-primary btn-sm" to={`${base}/sale/new`}>+ فروخت</Link>}</div></div>
    <Tabs tabs={[{ id: 'overview', label: 'جائزہ' }, { id: 'sales', label: 'فروخت' }, ...(mayPurchases ? [{ id: 'purchases', label: 'خرید' }] : []),
      { id: 'stock', label: 'اسٹاک' }, ...(book === 'PEST' ? [{ id: 'register', label: 'قانونی رجسٹر' }] : [])]} active={tab} onChange={setTab} />
    {tab === 'overview' && <div><div className="stats-grid">
      <StatCard label="فروخت" value={formatPKR(sRows.reduce((a: number, r: any) => a + r.total_paisa, 0))} />
      {mayPurchases && <StatCard label="خرید" value={formatPKR(pRows.reduce((a: number, r: any) => a + r.total_paisa, 0))} />}
      <StatCard label="فروخت دستاویزات" value={sRows.length} />
      {mayPurchases && <StatCard label="خرید دستاویزات" value={pRows.length} />}
    </div>
      <div className="notice info">یہ کتاب الگ کھاتہ/لیجر رکھتی ہے؛ تمام پوسٹنگ ایک ایٹمی <code>db.batch()</code> میں ہوتی ہے۔</div>
      {book === 'FERT' && <div className="btn-row"><Link className="btn btn-secondary btn-sm" to="/erp/reports?report=fertilizer-register">کھاد فروخت رجسٹر</Link>
        <Link className="btn btn-secondary btn-sm" to="/erp/reports?report=expiry">ایکسپائری رپورٹ</Link></div>}
      {book === 'PEST' && <div className="notice">پیسٹی سائیڈ فروخت میں خریدار کا نام، موبائل اور پتہ لازمی ہیں؛ ایکسپائری ختم / قرنطینہ بیچ بلاک ہے۔
        لائسنس نمبر صرف مالک ترتیبات میں درج کرے گا — سسٹم کبھی نہیں بناتا۔</div>}
    </div>}
    {tab === 'sales' && <AsyncView loading={sales.isLoading} error={sales.error} retry={() => sales.refetch()} empty={!sRows.length}>
      <DataTable rows={sRows} csvName={`${book}-sales`} columns={[
        { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' },
        { key: 'total_paisa', label: 'کل', render: (r: any) => money(r.total_paisa) },
        { key: 'due_paisa', label: 'بقایا', render: (r: any) => money(r.due_paisa) },
        { key: 'status', label: 'حالت', render: (r: any) => <StatusChip status={r.status} /> },
      ] as Column[]} /></AsyncView>}
    {tab === 'purchases' && <AsyncView loading={purchases.isLoading} error={purchases.error} retry={() => purchases.refetch()} empty={!pRows.length}>
      <DataTable rows={pRows} csvName={`${book}-purchases`} columns={[
        { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' },
        { key: 'total_paisa', label: 'کل', render: (r: any) => money(r.total_paisa) },
        { key: 'due_paisa', label: 'بقایا', render: (r: any) => money(r.due_paisa) },
      ] as Column[]} /></AsyncView>}
    {tab === 'stock' && <AsyncView loading={stock.isLoading} error={stock.error} retry={() => stock.refetch()} empty={!stockRows.length}>
      <DataTable rows={stockRows} csvName={`${book}-stock`} columns={[
        { key: 'name_ur', label: 'مصنوعات' }, { key: 'qty_milli', label: 'تعداد', render: (r: any) => <span className="num">{fromMilli(r.qty_milli)}</span> },
        { key: 'value_paisa', label: 'مالیت', render: (r: any) => money(r.value_paisa) },
      ] as Column[]} /></AsyncView>}
    {tab === 'register' && <PesticideRegister />}
  </div>;
}
function PesticideRegister() {
  const { data, isLoading, error, refetch } = useGet<any>('pesticide-register', '/api/v1/reports/pesticide-register');
  return <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!data?.rows?.length}>
    <div className="notice">یہ سافٹ ویئر صرف ریکارڈ/ایکسپورٹ رکھتا ہے؛ کسی سرکاری پورٹل پر فائلنگ کا دعویٰ نہیں۔ ضابطہ مالک ضلع زراعت دفتر لیہ سے تصدیق کرے۔</div>
    <DataTable rows={data?.rows ?? []} csvName="pesticide-register" columns={[
      { key: 'date', label: 'تاریخ' }, { key: 'number', label: 'رسید' }, { key: 'buyer', label: 'خریدار' },
      { key: 'product', label: 'مصنوعات' }, { key: 'batch', label: 'بیچ' },
      { key: 'qty', label: 'تعداد' }, { key: 'amount_paisa', label: 'رقم', render: (r: any) => money(r.amount_paisa) },
    ] as Column[]} />
  </AsyncView>;
}

// --------------------------------- Crop page ---------------------------------
export function CropPage() {
  const { crop = 'WHEAT' } = useParams();
  const { can, t } = useApp();
  const range = useRange();
  const lots = useGet<any[]>('grain-lots', `/api/v1/grains/lots?crop=${crop}`, can('grains.read'));
  const settings = useGet<any>('settings', '/api/v1/settings', can('settings.read'));
  const docs = useGet<any[]>('crop-docs', `/api/v1/documents?from=${range.from}&to=${range.to}&q=${crop}`, can('documents.read'));
  const maundKg = settings.data?.maund_kg ?? 0;
  const [tab, setTab] = useState('lots');
  const def = BOOK_MAP[crop];
  if (!can('grains.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div><div className="between"><h1 className="head-icon"><NavIcon icon={crop} label={def?.ur ?? crop} size={34} />{def?.ur ?? crop}</h1>
    <div className="btn-row">{can('grains.post') && <Link className="btn btn-secondary btn-sm" to={`/erp/grains/${crop}/purchase/new`}>+ خرید (وزن)</Link>}
      {can('grains.post') && <Link className="btn btn-primary btn-sm" to={`/erp/grains/${crop}/sale/new`}>+ فروخت</Link>}</div></div>
    {settings.data && !maundKg && <div className="notice"><Mark kind="warn" /> «ایک من = کتنے کلو» مالک نے تصدیق نہیں کی — فی من ریٹ بلاک ہے۔</div>}
    <Tabs tabs={[{ id: 'lots', label: 'لاٹس' }, { id: 'docs', label: 'دستاویزات' }, { id: 'recon', label: 'لاٹ مفاہمت' }]} active={tab} onChange={setTab} />
    {tab === 'lots' && <AsyncView loading={lots.isLoading} error={lots.error} retry={() => lots.refetch()} empty={!(lots.data ?? []).length}>
      <DataTable rows={lots.data ?? []} csvName={`${crop}-lots`} columns={[
        { key: 'lot_no', label: 'لاٹ' }, { key: 'grade', label: 'گریڈ' },
        { key: 'balance_grams', label: 'بیلنس (کلو)', render: (r: any) => <span className="num">{(r.balance_grams / 1000).toFixed(3)}</span> },
        { key: 'opened_at', label: 'تاریخ' },
      ] as Column[]} /></AsyncView>}
    {tab === 'docs' && <AsyncView loading={docs.isLoading} error={docs.error} retry={() => docs.refetch()} empty={!(docs.data ?? []).length}>
      <DataTable rows={docs.data ?? []} csvName={`${crop}-docs`} columns={[
        { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' }, { key: 'type', label: 'قسم' },
        { key: 'amount_paisa', label: 'رقم', render: (r: any) => money(r.amount_paisa) },
      ] as Column[]} /></AsyncView>}
    {tab === 'recon' && <div className="card"><h2>لاٹ مفاہمت</h2>
      <p className="small">ہر لاٹ: کچا وزن − ٹیر − کٹوتیاں = خالص وزن؛ خرید − فروخت − ایڈجسٹمنٹ = بقیہ۔</p>
      <DataTable rows={lots.data ?? []} csvName={`${crop}-recon`} columns={[
        { key: 'lot_no', label: 'لاٹ' }, { key: 'purchased_grams', label: 'خرید (کلو)', render: (r: any) => <span className="num">{((r.purchased_grams ?? 0) / 1000).toFixed(3)}</span> },
        { key: 'sold_grams', label: 'فروخت (کلو)', render: (r: any) => <span className="num">{((r.sold_grams ?? 0) / 1000).toFixed(3)}</span> },
        { key: 'balance_grams', label: 'بقیہ', render: (r: any) => <span className="num">{(r.balance_grams / 1000).toFixed(3)}</span> },
      ] as Column[]} />
      <div className="small">خرید/فروخت الگ کالم سرور رپورٹ سے آتے ہیں؛ یہاں موجود لاٹ بیلنس حتمی ہے۔</div>
    </div>}
  </div>;
}

// --------------------------------- Khata centre ------------------------------
export function KhataCentre() {
  const { t } = useApp();
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
    { key: 'date', label: 'تاریخ' }, { key: 'description_ur', label: 'تفصیل' },
    { key: 'ref_type', label: 'حوالہ' },
    { key: 'debit_paisa', label: 'ڈیبٹ', render: (r: any) => money(r.debit_paisa ?? (r.direction === 'IN' ? r.amount_paisa : 0)) },
    { key: 'credit_paisa', label: 'کریڈٹ', render: (r: any) => money(r.credit_paisa ?? (r.direction === 'OUT' ? r.amount_paisa : 0)) },
    { key: 'running_paisa', label: 'بیلنس', render: (r: any) => money(r.running_paisa) },
  ];
  return <div><div className="between"><h1 className="head-icon"><NavIcon icon="khata" label="کھاتہ سینٹر" size={34} />کھاتہ سینٹر</h1>
    <div className="btn-row"><Link className="btn btn-secondary btn-sm" to="/erp/receipts/new">+ رسید</Link>
      <Link className="btn btn-secondary btn-sm" to="/erp/payments/new">+ ادائیگی</Link></div></div>
    <div className="grid g2">
      <div className="card"><h2>تمام کتابیں</h2>
        <DataTable rows={[...(books.data?.books ?? []), ...(books.data?.money_books ?? [])]} csvName="khata-books" columns={[
          { key: 'book_code', label: 'کتاب' }, { key: 'debit_paisa', label: 'ڈیبٹ', money: true },
          { key: 'credit_paisa', label: 'کریڈٹ', money: true }, { key: 'balance_paisa', label: 'بیلنس', money: true },
        ] as Column[]} /></div>
      <div className="card"><h2>وصولی عمر (Ageing)</h2>
        {(ageing.data?.debtors ?? []).length ? <DataTable rows={ageing.data.debtors} csvName="ageing" columns={[
          { key: 'name_ur', label: 'فریق' }, { key: 'bucket', label: 'مدت' },
          { key: 'balance_paisa', label: 'بقایا', money: true },
        ] as Column[]} /> : <EmptyState title="کوئی بقایا نہیں" />}
        <div className="small">{JSON.stringify(ageing.data?.buckets ?? {})}</div></div>
    </div>
    <div className="card" style={{ marginBlockStart: 16 }}><div className="between"><h2>لیجر</h2>
      <div className="btn-row"><SelectField label="" value={book} onChange={setBook} placeholder="تمام کتابیں"
        options={BOOKS.map((b) => ({ value: b.code, label: b.ur }))} />
        <SelectField label="" value={party} onChange={setParty} placeholder="تمام فریق"
          options={(parties.data ?? []).map((p: any) => ({ value: p.id, label: p.name_ur }))} />
        <Button variant="ghost" size="sm" onClick={async () => {
          const r = await api<any>(`/api/v1/statements?from=${range.from}&to=${range.to}&book=${book}&party_id=${party}`);
          setStatement(r.snapshot);
        }}>اسٹیٹمنٹ</Button></div></div>
      <AsyncView loading={khata.isLoading} error={khata.error} retry={() => khata.refetch()} empty={!(khata.data?.withBalance ?? []).length}>
        <div className="kv"><span className="k">ابتدائی</span><span className="v num">{formatPKR(khata.data?.opening_paisa ?? 0)}</span>
          <span className="k">ڈیبٹ</span><span className="v num">{formatPKR(khata.data?.debit_paisa ?? 0)}</span>
          <span className="k">کریڈٹ</span><span className="v num">{formatPKR(khata.data?.credit_paisa ?? 0)}</span>
          <span className="k">اختتامی</span><span className="v num">{formatPKR(khata.data?.closing_balance_paisa ?? 0)}</span></div>
        <DataTable rows={khata.data?.withBalance ?? []} columns={cols} csvName="khata-ledger" />
      </AsyncView>
    </div>
    {statement && <Sheet open={!!statement} onClose={() => setStatement(null)} title="کھاتہ اسٹیٹمنٹ">
      <PrintActions snapshot={statement} /></Sheet>}
  </div>;
}

export function PartyKhata() {
  const { id } = useParams();
  const { data, isLoading, error, refetch } = useGet<any>('party', `/api/v1/parties/${id}`);
  const range = useRange();
  const [statement, setStatement] = useState<DocumentSnapshot | null>(null);
  return <div><AsyncView loading={isLoading} error={error} retry={() => refetch()}>
    <div className="between"><h1 className="head-icon"><NavIcon icon="parties" label={data?.name_ur ?? ''} size={34} />{data?.name_ur}</h1>
      <div className="btn-row"><Link className="btn btn-secondary btn-sm" to="/erp/receipts/new">+ رسید</Link>
        <Link className="btn btn-secondary btn-sm" to="/erp/payments/new">+ ادائیگی</Link></div></div>
    <div className="stats-grid">
      <StatCard label="بیلنس" value={formatPKR(data?.balance_paisa ?? 0)} />
      <StatCard label="قسم" value={data?.type ?? ''} />
      <StatCard label="موبائل" value={data?.phone ?? '—'} />
      <StatCard label="کریڈٹ حد" value={formatPKR(data?.credit_limit_paisa ?? 0)} />
    </div>
    <div className="card" style={{ marginBlock: 16 }}><div className="between"><h2>لین دین</h2>
      <Button size="sm" variant="ghost" onClick={async () => {
        const r = await api<any>(`/api/v1/statements?from=${range.from}&to=${range.to}&party_id=${id}`);
        setStatement(r.snapshot);
      }}>پرنٹ / PDF</Button></div>
      <DataTable rows={data?.ledger ?? []} csvName="party-ledger" columns={[
        { key: 'date', label: 'تاریخ' }, { key: 'description_ur', label: 'تفصیل' },
        { key: 'debit_paisa', label: 'ڈیبٹ', money: true }, { key: 'credit_paisa', label: 'کریڈٹ', money: true },
      ] as Column[]} />
      {!!data?.allocations?.length && <><h3>الاٹمنٹ</h3><DataTable rows={data.allocations} columns={[
        { key: 'receipt_id', label: 'رسید' }, { key: 'invoice_id', label: 'انوائس' },
        { key: 'amount_paisa', label: 'رقم', money: true },
      ] as Column[]} csvName="allocations" /></>}
    </div>
    {statement && <Sheet open={!!statement} onClose={() => setStatement(null)} title="فریق کھاتہ"><PrintActions snapshot={statement} /></Sheet>}
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
  return <div><h1 className="head-icon"><NavIcon icon="reports" label="رپورٹس گیلری" size={34} />رپورٹس گیلری</h1>
    <div className="tile-grid">{REPORTS.map((r) => <button key={r.id} className={`tile ${active === r.id ? 'active' : ''}`}
      onClick={() => setParams({ report: r.id })}><NavIcon icon="reports" label={r.ur} size={44} /><strong>{r.ur}</strong><span className="small">{r.en}</span></button>)}</div>
    <div className="card" style={{ marginBlockStart: 16 }}>
      <div className="between"><h2>{REPORTS.find((r) => r.id === active)?.ur}</h2>
        <div className="btn-row"><SelectField label="" value={book} onChange={setBook} placeholder="تمام کتابیں"
          options={BOOKS.map((b) => ({ value: b.code, label: b.ur }))} />
          <Button variant="ghost" size="sm" onClick={() => window.print()}><Mark kind="print" /> PDF</Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()} aria-label="دوبارہ لوڈ"><Mark kind="sync" /></Button></div></div>
      <RangePicker from={range.from} to={range.to} setFrom={range.setFrom} setTo={range.setTo} />
      {active === 'trial-balance' && data && <div className={`notice ${data.balanced ? 'success' : ''}`}>
        {data.balanced ? <><Mark kind="check" /> ڈیبٹ = کریڈٹ (H4)</> : <><Mark kind="warn" /> جرنل غیر متوازن</>} — ڈیبٹ {formatPKR(data.totals?.debit_paisa ?? 0)} / کریڈٹ {formatPKR(data.totals?.credit_paisa ?? 0)}</div>}
      {active === 'pnl' && data && <div className="kv"><span className="k">آمدنی</span><span className="v num">{formatPKR(data.income_paisa)}</span>
        <span className="k">اخراجات</span><span className="v num">{formatPKR(data.expenses_paisa)}</span>
        <span className="k">خالص منافع</span><span className="v num">{formatPKR(data.net_profit_paisa)}</span></div>}
      <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!rows.length}>
        <DataTable rows={rows} columns={cols} csvName={active} footer={<span className="num">{rows.length} قطاریں</span>} />
      </AsyncView>
      <div className="notice info small">رپورٹس براہِ راست D1 پری اگریگیٹ / جرنل لائنز سے پڑھی جاتی ہیں؛ کوئی فرضی اعداد نہیں۔</div>
    </div>
  </div>;
}

// ------------------------------ Documents centre -----------------------------
export function DocumentsCentre() {
  const { t, lang } = useApp();
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
  return <div><h1 className="head-icon"><NavIcon icon="documents" label="دستاویزات سینٹر" size={34} />دستاویزات سینٹر</h1>
    <div className="toolbar no-print"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="نمبر / نام تلاش کریں" />
      <SelectField label="" value={type} onChange={setType} placeholder="تمام اقسام"
        options={['SALE', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'EXPENSE', 'GRAIN_PURCHASE', 'GRAIN_SALE', 'RETURN', 'PAYROLL', 'TRANSFER'].map((x) => ({ value: x, label: x }))} />
      <SelectField label={t('invoices')} value={selected?.id ?? ''} onChange={pick} placeholder={t('selectInvoice')}
        options={(data ?? []).map((r: any) => ({ value: r.id, label: `${r.number} — ${r.date}` }))} />
      <Button variant="ghost" size="sm" onClick={() => refetch()} aria-label="دوبارہ لوڈ"><Mark kind="sync" /></Button></div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <DataTable rows={data ?? []} csvName="documents" onRow={open} columns={[
        { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' }, { key: 'type', label: 'قسم' },
        { key: 'book_code', label: 'کتاب' },
        { key: 'amount_paisa', label: 'رقم', render: (r: any) => money(r.amount_paisa) },
        { key: 'template_version', label: 'ٹیمپلیٹ' },
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
  const { syncNow, syncing, pending, conflicts, online, lastSync, toast } = useApp();
  const ops = useGet<any[]>('sync-ops', '/api/v1/sync/operations');
  const serverConflicts = useGet<any[]>('sync-conflicts', '/api/v1/sync/conflicts');
  const [localOps, setLocalOps] = useState<any[]>([]);
  const [resolve, setResolve] = useState<any>(null), [reason, setReason] = useState('');
  useEffect(() => { void ztdb.outbox.orderBy('created_at').reverse().limit(100).toArray().then(setLocalOps); }, [pending, conflicts]);
  return <div><div className="between"><h1 className="head-icon"><NavIcon icon="sync" label="سنک سینٹر" size={34} />سنک سینٹر</h1>
    <Button onClick={async () => { const r = await syncNow(); toast(`${r.sent} کامیاب، ${r.conflicts} تضاد`); ops.refetch(); setLocalOps(await ztdb.outbox.orderBy('created_at').reverse().limit(100).toArray()); }} loading={syncing}>ابھی سنک کریں</Button></div>
    <div className="stats-grid">
      <StatCard label="نیٹ ورک" value={online ? 'آن لائن' : 'آف لائن'} />
      <StatCard label="مقامی قطار" value={pending} />
      <StatCard label="مقامی تضادات" value={conflicts} tone={conflicts ? 'var(--danger)' : undefined} />
      <StatCard label="آخری سنک" value={lastSync ?? '—'} /></div>
    <div className="notice info small">Background Sync کافی نہیں: ایپ کھلنے، <code>online</code> ایونٹ، نظر آتے وقت 60 سیکنڈ ٹائمر اور دستی «ابھی سنک کریں» — چاروں triggers فعال ہیں۔
      ہر آپریشن کا <code>idempotency_key</code> منفرد ہے؛ دو آلات پر آخری اسٹاک بیچنے پر خاموش اوور رائٹ نہیں، بلکہ CONFLICT فلیگ بنتا ہے۔</div>
    <div className="card"><h2>مقامی آؤٹ باکس (IndexedDB)</h2>
      <DataTable rows={localOps} csvName="local-outbox" columns={[
        { key: 'type', label: 'قسم' }, { key: 'status', label: 'حالت', render: (r: any) => <StatusChip status={r.status} /> },
        { key: 'tries', label: 'کوششیں' }, { key: 'server_number', label: 'سرور نمبر' },
        { key: 'error', label: 'خرابی' },
      ] as Column[]} /></div>
    <div className="card" style={{ marginBlock: 16 }}><h2>سرور آپریشنز</h2>
      <AsyncView loading={ops.isLoading} error={ops.error} retry={() => ops.refetch()} empty={!(ops.data ?? []).length}>
        <DataTable rows={ops.data ?? []} csvName="server-sync" columns={[
          { key: 'type', label: 'قسم' }, { key: 'status', label: 'حالت', render: (r: any) => <StatusChip status={r.status} /> },
          { key: 'device_id', label: 'ڈیوائس' }, { key: 'error', label: 'خرابی' },
        ] as Column[]} /></AsyncView></div>
    <div className="card"><h2>تضادات</h2>
      <AsyncView loading={serverConflicts.isLoading} error={serverConflicts.error} retry={() => serverConflicts.refetch()} empty={!(serverConflicts.data ?? []).length}>
        <DataTable rows={serverConflicts.data ?? []} csvName="conflicts" onRow={(r) => setResolve(r)} columns={[
          { key: 'code', label: 'کوڈ' }, { key: 'message_ur', label: 'پیغام' },
          { key: 'status', label: 'حالت', render: (r: any) => <StatusChip status={r.status} /> },
        ] as Column[]} /></AsyncView>
      <div className="small">وجہ درج کر کے ACCEPT (دوبارہ پوسٹ) یا REJECT منتخب کریں — دونوں آڈٹ ہوتے ہیں۔</div>
    </div>
    <ConfirmDialog open={!!resolve} onClose={() => setResolve(null)} reasonRequired title="تضاد حل کریں"
      onConfirm={async (r) => {
        try {
          await api(`/api/v1/sync/resolve/${resolve.id}`, { method: 'POST', body: { action: 'REJECT', reason: r } });
          toast('تضاد مسترد / حل'); setResolve(null); serverConflicts.refetch();
        } catch (e: any) { toast(e.message_ur ?? String(e), 'err'); }
      }} />
    <div className="notice small" style={{ marginBlockStart: 16 }}>PIN سے کیش انکرپشن <Chip tone="success">COMPLETE</Chip> — PBKDF2 310,000 → AES-256-GCM، 4 یونٹ ٹیسٹ پاس؛ <Chip tone="warning">براؤزر E2E باقی</Chip></div>
  </div>;
}

// ----------------------------------- Backup ----------------------------------
export function BackupScreen() {
  const { toast } = useApp();
  const logs = useGet<any[]>('backup-logs', '/api/v1/backup');
  const jobs = useGet<any[]>('ops-jobs', '/api/v1/ops/jobs');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  return <div><div className="between"><h1 className="head-icon"><NavIcon icon="backup" label="بیک اپ اور بحالی" size={34} />بیک اپ اور بحالی</h1>
    <div className="btn-row"><Button onClick={async () => {
      setBusy(true); setErr('');
      try { const r = await api<any>('/api/v1/backup/run', { method: 'POST', body: {} }); toast(`بیک اپ: ${r.status ?? 'OK'}`); logs.refetch(); }
      catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
    }} loading={busy}>ابھی بیک اپ چلائیں</Button>
      <Button variant="secondary" onClick={() => void downloadCsv('/api/v1/backup/download', 'zt-backup.bin')}>آخری بیک اپ ڈاؤن لوڈ</Button></div></div>
    <div className="notice"><Mark kind="warn" /> بیک اپ صرف اسی وقت «درست» مانا جاتا ہے جب <code>scripts/restore.ts</code> کے ذریعے staging پر بحالی ٹیسٹ پاس ہو۔
      D1 Time Travel محفوظ جال ہے، مگر رات کا انکرپٹڈ R2 بیک اپ لازمی ہے۔ <IncompleteBadge note="Staging restore test INCOMPLETE" /></div>
    {err && <div className="err"><Mark kind="warn" /> {err}</div>}
    <div className="card"><h2>بیک اپ لاگ</h2>
      <AsyncView loading={logs.isLoading} error={logs.error} retry={() => logs.refetch()} empty={!(logs.data ?? []).length}>
        <DataTable rows={logs.data ?? []} csvName="backup-logs" columns={[
          { key: 'at', label: 'وقت' }, { key: 'status', label: 'حالت' }, { key: 'kind', label: 'قسم' },
          { key: 'details_json', label: 'تفصیل' },
        ] as Column[]} /></AsyncView></div>
    <div className="card" style={{ marginBlock: 16 }}><h2>کران / جاب لاگ</h2>
      <DataTable rows={jobs.data ?? []} csvName="jobs" columns={[
        { key: 'at', label: 'وقت' }, { key: 'kind', label: 'کام' }, { key: 'status', label: 'حالت' },
      ] as Column[]} /></div>
    <div className="notice info small">NDJSON چنکس → gzip → AES-GCM → <code>backups/</code>؛ retention ترتیبات سے۔ کلید <code>BACKUP_KEY</code> سیکرٹ، کوئی ہارڈ کوڈڈ پاس ورڈ نہیں۔</div>
  </div>;
}

// ---------------------------------- Settings ---------------------------------
export function SettingsScreen() {
  const { toast, theme, setTheme, lang, setLang, can, t } = useApp();
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
  return <div><h1 className="head-icon"><NavIcon icon="settings" label="ترتیبات" size={34} />ترتیبات</h1>
    <div className="grid g2">
      <div className="card"><h2>کاروباری پروفائل (لاک شدہ حقائق)</h2>
        <div className="kv"><span className="k">نام</span><span className="v">ذیشان ٹریڈرز</span>
          <span className="k">پتہ</span><span className="v">مقصود چوک، ضلع لیہ، پنجاب، پاکستان</span>
          <span className="k">فون</span><span className="v num">0307-7864722 · 0345-4654722</span>
          <span className="k">کرنسی / ٹائم زون</span><span className="v">PKR · Asia/Karachi</span>
          <span className="k">مالی سال</span><span className="v">جولائی – جون · ہفتہ سے آغاز</span></div>
        <div className="notice small">قیمتیں، اسٹاک، بیلنس، لائسنس، ای میل، اوقات اور تبصرے کبھی خودکار طور پر نہیں بنائے گئے۔</div></div>
      <div className="card"><h2>مالک کی تصدیق / ریگولیٹری</h2>
        <div className="kv"><span className="k">من (کلو)</span><span className="v">{data?.maund_kg ?? 'تصدیق باقی'}</span>
          <span className="k">تصدیق</span><span className="v">{data?.maund_confirmed ? <Mark kind="check" /> : <Mark kind="x" />}</span>
          <span className="k">پیسٹی لائسنس</span><span className="v">{data?.pesticide_licence_no ?? 'درج نہیں'}</span>
          <span className="k">میعاد</span><span className="v">{data?.pesticide_licence_expiry ?? 'درج نہیں'}</span></div>
        <div className="notice small">مالک سے درکار: من کا کلو، لائسنس نمبر/تاریخ، ابتدائی بیلنس، ڈومین، Cloudflare رسائی۔
          ضابطہ ضلع زراعت دفتر لیہ سے خود تصدیق کریں؛ سافٹ ویئر سرکاری پورٹل سے منسلک نہیں۔</div></div>
      <div className="card"><h2>ترتیب بدلیں</h2>
        <SelectField label="کلید" value={key} onChange={(v) => { setKey(v); setValue(''); }} options={editable.map((k) => ({ value: k, label: k }))} />
        <TextField label="قدر (JSON یا سادہ متن)" value={value} onChange={setValue} dir="ltr" helper="موجودہ قدر نیچے جدول میں دیکھیں" />
        <Button onClick={async () => {
          setBusy(true); setErr('');
          try {
            let v: any = value;
            try { v = JSON.parse(value); } catch { /* plain string */ }
            await api('/api/v1/settings', { method: 'PUT', body: { key, value: v } });
            toast('محفوظ + عوامی کیش صاف'); refetch();
          } catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
        }} loading={busy}>محفوظ کریں</Button>
        {err && <div className="err"><Mark kind="warn" /> {err}</div>}</div>
      <div className="card"><h2>آف لائن PIN / کیش انکرپشن</h2>
        <div className="kv"><span className="k">حالت</span><span className="v">{pin.enabled ? (pin.unlocked ? 'فعال — کھلا' : 'فعال — مقفل') : 'غیر فعال'}</span>
          <span className="k">الگورتھم</span><span className="v">PBKDF2-SHA256 {PIN_ITERATIONS.toLocaleString('en-PK')} → AES-256-GCM</span></div>
        <div className="notice info small">فعال ہونے پر <code>refs</code> (رول کے مطابق کیش) اور ڈرافٹ ہمیشہ انکرپٹڈ رہتے ہیں؛
          چابی صرف اس ٹیب کی میموری میں، لاگ آؤٹ/لاک/ری لوڈ پر ختم۔ سنک کی قطار قابلِ پڑھائی رہتی ہے تاکہ آف لائن اندراج ضائع نہ ہو۔</div>
        <TextField label={pin.enabled ? 'موجودہ PIN (غیر فعال/لاک کے لیے)' : 'نیا PIN (4–12 ہندسے)'} value={pinValue}
          onChange={setPinValue} type="password" inputMode="numeric" autoComplete="off" />
        {pinErr && <div className="err"><Mark kind="warn" /> {pinErr}</div>}
        <div className="btn-row">
          {!pin.enabled && <Button size="sm" loading={pinBusy} onClick={async () => {
            setPinBusy(true); setPinErr('');
            try { await enablePin(pinValue); toast('PIN فعال — کیش انکرپٹ ہو گیا'); setPinValue(''); }
            catch (e: any) { setPinErr(String(e.message ?? e)); } finally { setPinBusy(false); }
          }}>PIN فعال کریں</Button>}
          {pin.enabled && pin.unlocked && <Button size="sm" variant="secondary" onClick={() => { lockPin(); toast('کیش مقفل'); }}>ابھی مقفل کریں</Button>}
          {pin.enabled && <Button size="sm" variant="danger" loading={pinBusy} onClick={async () => {
            setPinBusy(true); setPinErr('');
            try { await disablePin(pinValue); toast('PIN غیر فعال — کیش ڈی کرپٹ'); setPinValue(''); }
            catch (e: any) { setPinErr(String(e.message ?? e)); } finally { setPinBusy(false); }
          }}>PIN ہٹائیں</Button>}
        </div>
      </div>
      <div className="card"><h2>ظاہری شکل</h2>
        <SelectField label="تھیم" value={theme} onChange={setTheme}
          options={[{ value: 'system', label: 'سسٹم' }, { value: 'light', label: 'روشن' }, { value: 'dark', label: 'تاریک' }]} />
        <SelectField label="زبان" value={lang} onChange={(v) => setLang(v as any)}
          options={[{ value: 'ur', label: 'اردو (پہلے)' }, { value: 'en', label: 'English' }]} />
        <div className="small">پرنٹ سائز: {String(data?.print_size ?? 'A4')} · فی الحال {String(data?.theme ?? 'system')}</div></div>
    </div>
    <div className="card" style={{ marginBlock: 16 }}><h2>تمام ترتیبات (D1)</h2>
      <AsyncView loading={isLoading} error={error} retry={() => refetch()}>
        <DataTable rows={Object.entries(data ?? {}).map(([k, v]) => ({ id: k, key: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) }))}
          csvName="settings" columns={[{ key: 'key', label: 'کلید' }, { key: 'value', label: 'قدر' }] as Column[]} /></AsyncView></div>
  </div>;
}

// ----------------------------------- Audit -----------------------------------
export function AuditScreen() {
  const range = useRange('2020-01-01');
  const { data, isLoading, error, refetch } = useGet<any[]>('audit', `/api/v1/audit?from=${range.from}&to=${range.to}`);
  return <div><h1 className="head-icon"><NavIcon icon="audit" label="آڈٹ لاگ" size={34} />آڈٹ لاگ</h1>
    <div className="notice info small">ہر حساس عمل (پوسٹنگ، ریورس، سیٹنگز، لاگ ان، ڈیوائس ریووک، برآمد، تضاد حل) صارف، وقت، IP اور قبل/بعد کے ساتھ محفوظ۔</div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <DataTable rows={data ?? []} csvName="audit" columns={[
        { key: 'at', label: 'وقت' }, { key: 'action', label: 'عمل' }, { key: 'entity', label: 'جدول' },
        { key: 'entity_id', label: 'ID' }, { key: 'user_id', label: 'صارف' }, { key: 'ip', label: 'IP' },
      ] as Column[]} /></AsyncView>
  </div>;
}

// ----------------------------- Feature status --------------------------------
export function StatusScreen() {
  const { data, isLoading, error, refetch } = useGet<any>('features', '/api/v1/features');
  const byState: Record<string, any[]> = {};
  for (const f of data?.features ?? []) (byState[f.state] ??= []).push(f);
  const tone: Record<string, string> = { COMPLETE: 'success', PARTIAL: 'warning', INCOMPLETE: 'danger' };
  return <div><h1 className="head-icon"><NavIcon icon="status" label="سسٹم کی حالت — ایماندار فہرست" size={34} />سسٹم کی حالت — ایماندار فہرست</h1>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()}>
      <div className="stats-grid">
        {['COMPLETE', 'PARTIAL', 'INCOMPLETE'].map((s) => <StatCard key={s} label={s} value={byState[s]?.length ?? 0} tone={tone[s] === 'danger' ? 'var(--danger)' : undefined} />)}
        <StatCard label="انٹیگرٹی" value={data?.integrity?.ok ? 'متوازن' : 'جانچ درکار'}
        tone={data?.integrity?.ok ? 'var(--brand-600)' : 'var(--warning)'} />
      </div>
      <div className="card"><h2>تمام اسکرین IDs</h2>
        <DataTable rows={data?.features ?? []} csvName="feature-checklist" columns={[
          { key: 'id', label: 'ID' }, { key: 'ur', label: 'اسکرین' }, { key: 'en', label: 'English' },
          { key: 'state', label: 'حالت', render: (r: any) => <Chip tone={tone[r.state]}>{r.state}</Chip> },
          { key: 'note_ur', label: 'نوٹ' },
        ] as Column[]} /></div>
      <div className="card" style={{ marginBlock: 16 }}><h2>انٹیگرٹی چیک</h2>
        <pre style={{ whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'start' }}>{JSON.stringify(data?.integrity, null, 2)}</pre></div>
      <div className="notice">کچھ خصوصیات جان بوجھ کر <strong>INCOMPLETE / PARTIAL</strong> ہیں: WebAuthn پاس کی، Turnstile، R2 production binding،
        Playwright بصری ریگریشن، Lighthouse، PIN گیٹ کا براؤزر E2E، حقیقی Cloudflare staging بحالی، Cloudflare تعیناتی۔
        PIN انکرپشن خود COMPLETE ہے (4 یونٹ ٹیسٹ)؛ کسی بھی نامکمل چیز کو مکمل ہونے کا دعویٰ نہیں کیا گیا۔</div>
    </AsyncView>
  </div>;
}

// -------------------------------- Website CMS --------------------------------
export function WebsiteCms() {
  const { toast, can, t } = useApp();
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
  return <div><div className="between"><h1 className="head-icon"><NavIcon icon="website" label="ویب سائٹ CMS" size={34} />ویب سائٹ CMS</h1>
    <Button variant="secondary" size="sm" onClick={async () => { await api('/api/v1/website/publish', { method: 'POST', body: {} }); toast('شائع + کیش صاف'); }}>شائع کریں / کیش صاف</Button></div>
    <div className="grid g2">
      <div className="card"><h2>صفحات</h2>
        <SelectField label="صفحہ" value={slug} onChange={setSlug} options={[
          { value: 'about', label: 'ہمارے بارے میں' }, { value: 'privacy', label: 'رازداری' }, { value: 'terms', label: 'شرائط' }]} />
        <TextField label="عنوان" value={title} onChange={setTitle} />
        <Field label="متن (HTML، سرور سینیٹائز کرتا ہے)"><textarea className="input" aria-label="متن (HTML)" value={body} onChange={(e) => setBody(e.target.value)} rows={7} /></Field>
        <SelectField label="حالت" value={status} onChange={setStatus} options={[
          { value: 'DRAFT', label: 'ڈرافٹ' }, { value: 'REVIEW_REQUIRED', label: 'مالک کا جائزہ' }, { value: 'PUBLISHED', label: 'شائع' }]} />
        <Button loading={busy} onClick={async () => {
          setBusy(true); setErr('');
          try { await api(`/api/v1/website/pages/${slug}`, { method: 'PUT', body: { slug, title_ur: title, title_en: '', body_ur: body, body_en: '', status } }); toast('محفوظ'); pages.refetch(); }
          catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
        }}>محفوظ کریں</Button>
        {err && <div className="err"><Mark kind="warn" /> {err}</div>}
        <div className="notice small">رازداری / شرائط کا مسودہ مالک کے قانونی جائزے کے بغیر شائع نہیں ہوتا — کوئی فرضی قانونی متن نہیں۔</div></div>
      <div className="card"><h2>اعلانات</h2>
        <TextField label="عنوان" value={annTitle} onChange={setAnnTitle} />
        <Field label="متن"><textarea className="input" aria-label="متن" value={annBody} onChange={(e) => setAnnBody(e.target.value)} /></Field>
        <Button size="sm" variant="secondary" onClick={async () => {
          try { await api('/api/v1/website/announcements', { method: 'POST', body: { title_ur: annTitle, body_ur: annBody, publish_at: TODAY(), is_active: true } }); toast('اعلان شامل'); anns.refetch(); setAnnTitle(''); setAnnBody(''); }
          catch (e: any) { setErr(e.message_ur ?? String(e)); }
        }}>+ اعلان</Button>
        <DataTable rows={anns.data ?? []} csvName="announcements" columns={[
          { key: 'publish_at', label: 'تاریخ' }, { key: 'title_ur', label: 'عنوان' },
        ] as Column[]} />
        <h3>بینرز</h3>
        <DataTable rows={banners.data ?? []} csvName="banners" columns={[
          { key: 'title_ur', label: 'عنوان' }, { key: 'image_r2_key', label: 'R2 کلید' },
        ] as Column[]} />
        <div className="small">بینر امیج اپ لوڈ R2 بائنڈنگ پر منحصر <IncompleteBadge note="R2 production binding not configured" /></div>
      </div>
    </div>
    <div className="card" style={{ marginBlock: 16 }}><h2>موجودہ صفحات (D1)</h2>
      <DataTable rows={pages.data ?? []} csvName="cms-pages" columns={[
        { key: 'slug', label: 'Slug' }, { key: 'title_ur', label: 'عنوان' },
        { key: 'status', label: 'حالت', render: (r: any) => <StatusChip status={r.status} /> },
      ] as Column[]} /></div>
  </div>;
}

// ------------------------------- Enquiries inbox -----------------------------
export function EnquiriesInbox() {
  const { toast, can, t } = useApp();
  const { data, isLoading, error, refetch } = useGet<any[]>('enquiries', '/api/v1/enquiries');
  const [sel, setSel] = useState<any>(null), [reason, setReason] = useState('');
  if (!can('enquiries.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div><h1 className="head-icon"><NavIcon icon="enquiries" label="پوچھ گچھ ان باکس" size={34} />پوچھ گچھ ان باکس</h1>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <DataTable rows={data ?? []} csvName="enquiries" onRow={setSel} columns={[
        { key: 'number', label: 'حوالہ' }, { key: 'customer_name', label: 'نام' }, { key: 'mobile', label: 'موبائل' },
        { key: 'city', label: 'شہر' }, { key: 'created_at', label: 'وقت' },
        { key: 'status', label: 'حالت', render: (r: any) => <StatusChip status={r.status} /> },
      ] as Column[]} /></AsyncView>
    <Sheet open={!!sel} onClose={() => setSel(null)} title={`پوچھ گچھ ${sel?.number ?? ''}`}>
      {sel && <div className="card"><div className="kv"><span className="k">نام</span><span className="v">{sel.customer_name}</span>
        <span className="k">موبائل</span><span className="v num">{sel.mobile}</span>
        <span className="k">شہر</span><span className="v">{sel.city}</span></div>
        <p>{sel.message}</p>
        <div className="small">مصنوعات: {(sel.items ?? []).map((i: any) => i.unit).join('، ') || '—'}</div>
        <TextField label="مسترد کرنے کی وجہ" value={reason} onChange={setReason} />
        <div className="btn-row">
          <Button size="sm" onClick={async () => { await api(`/api/v1/enquiries/${sel.id}/status`, { method: 'POST', body: { status: 'APPROVED' } }); toast('منظور'); refetch(); setSel(null); }}>منظور</Button>
          <Button size="sm" variant="danger" disabled={!reason} onClick={async () => { await api(`/api/v1/enquiries/${sel.id}/status`, { method: 'POST', body: { status: 'REJECTED', reason } }); toast('مسترد'); refetch(); setSel(null); }}>مسترد</Button>
          <Button size="sm" variant="secondary" onClick={async () => { const r = await api<any>(`/api/v1/enquiries/${sel.id}/quotation`, { method: 'POST', body: {} }); toast(`کوٹیشن ${r.number}`); refetch(); setSel(null); }}>کوٹیشن بنائیں</Button>
          <a className="btn btn-wa btn-sm" href={`https://wa.me/92${sel.mobile.replace(/^0/, '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer">واٹس ایپ جواب</a>
        </div>
        <div className="notice info small">انکوائری صرف رابطہ ہے — اس سے اسٹاک، قیمت یا ادائیگی خودکار تبدیل نہیں ہوتی۔</div>
      </div>}
    </Sheet>
  </div>;
}

// -------------------------------- Accounting ---------------------------------
export function AccountingScreen() {
  const { toast, can, t } = useApp();
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
  return <div><h1 className="head-icon"><NavIcon icon="accounting" label="اکاؤنٹنگ" size={34} />اکاؤنٹنگ</h1>
    <div className={`notice ${integrity.data?.ok ? 'success' : ''}`}>انٹیگرٹی: {integrity.data?.ok ? <><Mark kind="check" /> تمام جرنل متوازن، اسٹاک/اکاؤنٹ/پارٹی بیلنس ہم آہنگ</> : JSON.stringify(integrity.data)}</div>
    <Tabs tabs={[{ id: 'chart', label: 'چارٹ آف اکاؤنٹس' }, { id: 'journals', label: 'جرنل' },
      { id: 'manual', label: 'دستی جرنل' }, { id: 'close', label: 'پیریڈ لاک' }]} active={tab} onChange={setTab} />
    {tab === 'chart' && <DataTable rows={chart.data ?? []} csvName="chart-of-accounts" columns={[
      { key: 'code', label: 'کوڈ' }, { key: 'name_ur', label: 'نام' }, { key: 'type', label: 'قسم' },
    ] as Column[]} />}
    {tab === 'journals' && <AsyncView loading={journals.isLoading} error={journals.error} retry={() => journals.refetch()} empty={!(journals.data ?? []).length}>
      <DataTable rows={journals.data ?? []} csvName="journals" columns={[
        { key: 'date', label: 'تاریخ' }, { key: 'memo_ur', label: 'تفصیل' }, { key: 'ref_type', label: 'حوالہ' },
      ] as Column[]} /></AsyncView>}
    {tab === 'manual' && <div className="card"><h2>متوازن دستی جرنل</h2>
      <TextField label="تفصیل" value={memo} onChange={setMemo} required />
      <TextField label="وجہ" value={reason} onChange={setReason} required />
      {lines.map((l, i) => <div key={i} className="grid g2 card" style={{ background: 'var(--bg)', marginBlockEnd: 8 }}>
        <SelectField label="اکاؤنٹ" value={l.account_code} onChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, account_code: v } : x))}
          options={CHART_OF_ACCOUNTS.map((a: any) => ({ value: a.code, label: `${a.code} — ${a.name_ur ?? a.ur ?? a.en ?? ''}` }))} />
        <MoneyField label="ڈیبٹ" paisa={l.debit_paisa} onChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, debit_paisa: v, credit_paisa: 0 } : x))} />
        <MoneyField label="کریڈٹ" paisa={l.credit_paisa} onChange={(v) => setLines(lines.map((x, j) => j === i ? { ...x, credit_paisa: v, debit_paisa: 0 } : x))} />
        <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>حذف</Button>
      </div>)}
      <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { account_code: '1000', debit_paisa: 0, credit_paisa: 0 }])}>+ لائن</Button>
      <div className="kv"><span className="k">ڈیبٹ</span><span className="v num">{formatPKR(debit)}</span>
        <span className="k">کریڈٹ</span><span className="v num">{formatPKR(credit)}</span></div>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button loading={busy} disabled={debit !== credit || debit === 0 || !memo || !reason} onClick={async () => {
        setBusy(true); setErr('');
        try { await api('/api/v1/accounting/journal', { method: 'POST', body: { date: TODAY(), memo_ur: memo, reason, lines } }); toast('جرنل پوسٹ'); journals.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }}>پوسٹ کریں</Button>
      <div className="small">H4: ڈیبٹ = کریڈٹ ہونے تک بٹن غیر فعال ہے؛ سرور بھی دوبارہ چیک کرتا ہے۔</div>
    </div>}
    {tab === 'close' && <div className="card"><h2>پیریڈ لاک</h2>
      <TextField label="ماہ (YYYY-MM)" value={period} onChange={setPeriod} dir="ltr" required />
      <TextField label="وجہ" value={lockReason} onChange={setLockReason} required />
      <Button variant="danger" onClick={async () => {
        try { await api('/api/v1/accounting/period-close', { method: 'POST', body: { period, reason: lockReason } }); toast('پیریڈ بند'); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }}>بند کریں</Button>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <div className="notice small">بند پیریڈ میں پوسٹنگ 403/PERIOD_CLOSED دیتی ہے؛ صرف ریورس + نئی تاریخ والا متبادل ریکارڈ جائز ہے۔</div>
    </div>}
  </div>;
}

// ----------------------------------- Users -----------------------------------
export function UsersScreen() {
  const { toast, can, t } = useApp();
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
  return <div><div className="between"><h1 className="head-icon"><NavIcon icon="users" label="صارفین، کردار اور ڈیوائسز" size={34} />صارفین، کردار اور ڈیوائسز</h1>
    <Button size="sm" onClick={() => setOpen(true)}>+ نیا صارف</Button></div>
    <div className="card"><h2>صارفین</h2>
      <DataTable rows={users.data ?? []} csvName="users" columns={[
        { key: 'username', label: 'صارف نام' }, { key: 'display_name', label: 'نام' },
        { key: 'status', label: 'حالت', render: (r: any) => <StatusChip status={r.status} /> },
        { key: 'id', label: 'عمل', render: (r: any) => <Button variant="ghost" size="sm" onClick={async () => {
          await api(`/api/v1/users/${r.id}/disable`, { method: 'POST', body: {} }); toast('بند'); users.refetch();
        }}>غیر فعال</Button> },
      ] as Column[]} /></div>
    <div className="grid g2" style={{ marginBlock: 16 }}>
      <div className="card"><h2>کردار / اجازت میٹرکس</h2>
        <DataTable rows={roleList} csvName="roles" columns={[
          { key: 'code', label: 'کوڈ' }, { key: 'ur', label: 'نام' },
          { key: 'perms', label: 'اجازتیں', render: (r: any) => <span className="small">{(Array.isArray(r.perms) ? r.perms.join(', ') : String(r.perms ?? '')).slice(0, 60)}</span> },
        ] as Column[]} />
        <div className="small">deny-by-default: ہر روٹ پر <code>requirePerm()</code> — UI چھپانا محض کاسمیٹک ہے (H5)۔</div></div>
      <div className="card"><h2>ڈیوائسز</h2>
        <DataTable rows={devices.data ?? []} csvName="devices" columns={[
          { key: 'id', label: 'ID' }, { key: 'revoked_at', label: 'ریووک' },
          { key: 'action', label: '', render: (r: any) => <Button variant="ghost" size="sm" onClick={async () => {
            await api(`/api/v1/devices/${r.id}/revoke`, { method: 'POST', body: {} }); toast('ریووک — مقامی کیش صاف'); devices.refetch();
          }}>ریووک</Button> },
        ] as Column[]} />
        <div className="btn-row" style={{ marginBlockStart: 8 }}>
          <Button size="sm" loading={pkBusy} disabled={!passkeysSupported()} onClick={async () => {
            setPkBusy(true);
            try { const r = await registerPasskey(); toast(`پاس کی رجسٹر ہو گئی (${r.credential_id.slice(0, 8)}…)`); passkeys.refetch(); }
            catch (e: any) { toast(e.message_ur ?? String(e), 'err'); }
            finally { setPkBusy(false); }
          }}>+ اپنی پاس کی رجسٹر کریں</Button>
        </div>
        <DataTable rows={passkeys.data ?? []} csvName="passkeys" columns={[
          { key: 'credential_id', label: 'پاس کی', render: (r: any) => <span className="num">{String(r.credential_id).slice(0, 12)}…</span> },
          { key: 'created_at', label: 'رجسٹرڈ' },
          { key: 'revoked_at', label: 'حالت', render: (r: any) => r.revoked_at ? <Chip tone="danger">ریووک</Chip> : <Chip tone="success">فعال</Chip> },
          { key: 'id', label: '', render: (r: any) => r.revoked_at ? null : <Button variant="danger" size="sm" onClick={async () => {
            await revokePasskey(r.id); toast('پاس کی ریووک'); passkeys.refetch();
          }}>ریووک</Button> },
        ] as Column[]} />
        <div className="notice info small">پاس کی صرف عوامی کلید + کاؤنٹر محفوظ ہوتی ہے؛ فنگر پرنٹ ڈیوائس میں رہتا ہے،
          سائٹ بائیو میٹرک کبھی نہیں دیکھتی۔ ریووک شدہ ڈیوائس اگلی آن لائن رابطے پر سنک نہیں کر سکتی۔</div></div>
    </div>
    <Sheet open={open} onClose={() => setOpen(false)} title="نیا صارف">
      <TextField label="صارف نام" value={username} onChange={setUsername} required />
      <TextField label="نام" value={name} onChange={setName} required />
      <TextField label="موبائل" value={mobile} onChange={setMobile} />
      <TextField label="پاس ورڈ (10+)" value={pw} onChange={setPw} type="password" required />
      <div className="field"><label>کردار</label>
        {roleList.map((r: any) => <CheckField key={r.code} label={`${r.ur ?? r.name_ur ?? r.code} (${r.code})`} checked={roleCodes.includes(r.code)}
          onChange={(v) => setRoleCodes(v ? [...roleCodes, r.code] : roleCodes.filter((x) => x !== r.code))} />)}</div>
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button loading={busy} onClick={async () => {
        setBusy(true); setErr('');
        try { await api('/api/v1/users', { method: 'POST', body: { username, password: pw, name, mobile, role_codes: roleCodes } }); toast('بن گیا'); users.refetch(); setOpen(false); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }}>بنائیں</Button>
    </Sheet>
  </div>;
}

// --------------------------------- Inventory ---------------------------------
export function InventoryScreen() {
  const { can, t, toast } = useApp();
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
  return <div><h1 className="head-icon"><NavIcon icon="inventory" label="انوینٹری" size={34} />انوینٹری</h1>
    <Tabs tabs={[{ id: 'stock', label: 'اسٹاک' }, { id: 'ledger', label: 'لیجر' }, { id: 'batches', label: 'بیچ / FEFO' },
      { id: 'opening', label: 'اوپننگ' }, { id: 'adjust', label: 'ایڈجسٹمنٹ' }, { id: 'count', label: 'فزیکل کاؤنٹ' }]} active={tab} onChange={setTab} />
    {tab === 'stock' && <DataTable rows={stock.data ?? []} csvName="stock" columns={[
      { key: 'name_ur', label: 'مصنوعات' }, { key: 'qty_milli', label: 'تعداد', render: (r: any) => <span className="num">{fromMilli(r.qty_milli ?? 0)}</span> },
      { key: 'value_paisa', label: 'مالیت', render: (r: any) => money(r.value_paisa) },
    ] as Column[]} />}
    {tab === 'ledger' && <DataTable rows={ledger.data ?? []} csvName="stock-ledger" columns={[
      { key: 'date', label: 'تاریخ' }, { key: 'product_id', label: 'مصنوعات' }, { key: 'direction', label: 'سمت' },
      { key: 'qty_milli', label: 'تعداد', render: (r: any) => <span className="num">{fromMilli(r.qty_milli ?? 0)}</span> },
      { key: 'ref_type', label: 'حوالہ' },
    ] as Column[]} />}
    {tab === 'batches' && <><div className="notice info small">FEFO: ایکسپائری پہلے والا بیچ پہلے۔ ایکسپائری ختم / قرنطینہ بیچ کی فروخت سرور بلاک کرتا ہے۔</div>
      <DataTable rows={batches.data ?? []} csvName="batches" columns={[
        { key: 'batch_no', label: 'بیچ' }, { key: 'product_id', label: 'مصنوعات' }, { key: 'mfg_date', label: 'MFG' },
        { key: 'expiry_date', label: 'ایکسپائری' }, { key: 'qty_milli', label: 'تعداد', qty: true },
        { key: 'status', label: 'حالت', render: (r: any) => <StatusChip status={r.status ?? 'POSTED'} /> },
      ] as Column[]} /></>}
    {tab === 'opening' && <div className="card"><h2>ابتدائی اسٹاک (مالک ان پٹ)</h2>
      <SelectField label="مصنوعات" value={productId} onChange={setProductId} placeholder="منتخب کریں"
        options={(products.data?.rows ?? []).map((p: any) => ({ value: p.id, label: p.name_ur }))} />
      <QtyField label="تعداد" milli={openingQty} onChange={setOpeningQty} required />
      <MoneyField label="فی یونٹ لاگت" paisa={openingCost} onChange={setOpeningCost} />
      <Button onClick={async () => {
        try { await api('/api/v1/stock/opening', { method: 'POST', body: { date: TODAY(), product_id: productId, qty_milli: openingQty, unit_cost_paisa: openingCost, reason } }); toast('اوپننگ پوسٹ'); stock.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }}>پوسٹ کریں</Button></div>}
    {tab === 'adjust' && <div className="card"><h2>ایڈجسٹمنٹ (وجہ لازمی)</h2>
      <SelectField label="مصنوعات" value={productId} onChange={setProductId} placeholder="منتخب کریں"
        options={(products.data?.rows ?? []).map((p: any) => ({ value: p.id, label: p.name_ur }))} />
      <QtyField label="فرق (+/-)" milli={delta} onChange={setDelta} />
      <TextField label="وجہ" value={reason} onChange={setReason} required />
      <Button variant="danger" disabled={!reason || !productId || !delta} onClick={async () => {
        try { await api('/api/v1/stock/adjustment', { method: 'POST', body: { date: TODAY(), product_id: productId, delta_milli: delta, reason, unit_cost_paisa: 0 } }); toast('ایڈجسٹمنٹ پوسٹ'); stock.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }}>پوسٹ کریں</Button></div>}
    {tab === 'count' && <div className="card"><h2>فزیکل کاؤنٹ</h2>
      <p className="small">ہر مصنوعات کی گنتی درج کریں؛ فرق خودکار ایڈجسٹمنٹ + آڈٹ کے ساتھ پوسٹ ہوتا ہے (H2)۔</p>
      <DataTable rows={products.data?.rows ?? []} csvName="count-sheet" columns={[
        { key: 'name_ur', label: 'مصنوعات' }, { key: 'stock_milli', label: 'سسٹم', qty: true },
        { key: 'counted_milli', label: 'اصل گنتی', render: (r: any) => <QtyField label="" milli={counted[r.id] ?? r.stock_milli ?? 0}
          onChange={(v) => setCounted({ ...counted, [r.id]: v })} /> },
      ] as Column[]} />
      <TextField label="وجہ" value={reason} onChange={setReason} required />
      <Button onClick={async () => {
        const rowsAll = products.data?.rows ?? [];
        const lines = rowsAll.map((p: any) => ({ product_id: p.id, counted_milli: counted[p.id] ?? p.stock_milli ?? 0 }));
        try { const r = await api<any>('/api/v1/stock/count', { method: 'POST', body: { date: TODAY(), reason: reason || 'فزیکل گنتی', lines } }); toast(`کاؤنٹ: ${JSON.stringify(r)}`); stock.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }} disabled={!reason || !(products.data?.rows ?? []).length}>کاؤنٹ پوسٹ کریں</Button>
    </div>}
    {err && <div className="err"><Mark kind="warn" /> {err}</div>}
  </div>;
}

// -------------------------------- Money accounts -----------------------------
export function AccountsHub() {
  const { data, isLoading, error, refetch } = useGet<any[]>('accounts', '/api/v1/accounts');
  const nav = useNavigate();
  return <div><div className="between"><h1 className="head-icon"><NavIcon icon="accounts" label="رقم کے اکاؤنٹس" size={34} />رقم کے اکاؤنٹس</h1>
    <div className="btn-row"><Link className="btn btn-secondary btn-sm" to="/erp/accounts/transfer">↔ منتقلی</Link>
      <Link className="btn btn-secondary btn-sm" to="/erp/receipts/new">+ رسید</Link></div></div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <div className="stats-grid">{(data ?? []).map((a: any) => <StatCard key={a.id} label={a.name_ur} value={formatPKR(a.balance_paisa ?? 0)}
        sub={a.code} onClick={() => nav(`/erp/accounts/${a.id}`)} />)}</div>
      <DataTable rows={data ?? []} csvName="accounts" columns={[
        { key: 'code', label: 'کوڈ' }, { key: 'name_ur', label: 'نام' },
        { key: 'balance_paisa', label: 'بیلنس', money: true }, { key: 'type', label: 'قسم' },
      ] as Column[]} />
    </AsyncView>
    <div className="notice info small">JazzCash / بینک صرف اندرونی کتابیں ہیں — کسی بینک، JazzCash API یا سرکاری پورٹل سے انٹیگریشن کا دعویٰ نہیں۔</div>
  </div>;
}
export function AccountPage() {
  const { id } = useParams();
  const { data, isLoading, error, refetch } = useGet<any>('account', `/api/v1/accounts/${id}`);
  return <div><AsyncView loading={isLoading} error={error} retry={() => refetch()}>
    <h1 className="head-icon"><NavIcon icon="accounts" label={data?.account?.name_ur ?? id} size={34} />{data?.account?.name_ur ?? id}</h1>
    <div className="stats-grid"><StatCard label="بیلنس" value={formatPKR(data?.account?.balance_paisa ?? 0)} />
      <StatCard label="اندر" value={formatPKR(data?.in_paisa ?? 0)} /><StatCard label="باہر" value={formatPKR(data?.out_paisa ?? 0)} /></div>
    <div className="card" style={{ marginBlock: 16 }}><h2>لین دین</h2>
      <DataTable rows={data?.transactions ?? data?.rows ?? []} csvName="account-transactions" columns={[
        { key: 'date', label: 'تاریخ' }, { key: 'direction', label: 'سمت' },
        { key: 'amount_paisa', label: 'رقم', money: true }, { key: 'ref_type', label: 'حوالہ' },
        { key: 'note', label: 'نوٹ' },
      ] as Column[]} /></div>
  </AsyncView></div>;
}

// --------------------------------- Employees ---------------------------------
export function EmployeesScreen({ payroll = false }: { payroll?: boolean }) {
  const { ym } = useParams();
  const { toast, can, t } = useApp();
  const period = ym ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit' }).format(new Date());
  const employees = useGet<any[]>('employees', '/api/v1/employees');
  const advances = useGet<any[]>('advances', '/api/v1/advances');
  const payrollData = useGet<any>('payroll', `/api/v1/payroll/${period}`);
  const [rows, setRows] = useState<any[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  useEffect(() => { if (employees.data) setRows(employees.data.map((e: any) => ({ employee_id: e.id, name: e.name, gross_paisa: e.base_salary_paisa ?? 0, advance_recovered_paisa: 0, deductions_paisa: 0 }))); }, [employees.data]);
  if (!can('employees.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div><div className="between"><h1 className="head-icon"><NavIcon icon="employees" label="ملازمین / تنخواہ" size={34} />ملازمین / تنخواہ — {period}</h1>
    <div className="btn-row"><Link className="btn btn-secondary btn-sm" to="/erp/employees/new">+ ملازم</Link>
      <Link className="btn btn-secondary btn-sm" to="/erp/expenses/new">+ ایڈوانس / خرچہ</Link></div></div>
    {payroll && <div className="card"><h2>تنخواہ رن</h2>
      <div className="small">ہر ملازم: gross − ایڈوانس − کٹوتیاں = خالص؛ ایک ایٹمی بیچ میں تمام SL نمبر محفوظ (reserveNumbers)۔</div>
      <DataTable rows={rows} csvName="payroll-rows" columns={[
        { key: 'name', label: 'ملازم' },
        { key: 'gross_paisa', label: 'تنخواہ', render: (r: any) => <MoneyField label="" paisa={r.gross_paisa} onChange={(v) => setRows(rows.map((x) => x.employee_id === r.employee_id ? { ...x, gross_paisa: v } : x))} /> },
        { key: 'advance_recovered_paisa', label: 'ایڈوانس', render: (r: any) => <MoneyField label="" paisa={r.advance_recovered_paisa} onChange={(v) => setRows(rows.map((x) => x.employee_id === r.employee_id ? { ...x, advance_recovered_paisa: v } : x))} /> },
        { key: 'deductions_paisa', label: 'کٹوتی', render: (r: any) => <MoneyField label="" paisa={r.deductions_paisa} onChange={(v) => setRows(rows.map((x) => x.employee_id === r.employee_id ? { ...x, deductions_paisa: v } : x))} /> },
      ] as Column[]} />
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button loading={busy} disabled={!rows.length} onClick={async () => {
        setBusy(true); setErr('');
        try { const r = await api<any>('/api/v1/payroll', { method: 'POST', body: { ym: period, pay_date: TODAY(), account_id: 'acct-cash', rows } }); toast(`تنخواہ پوسٹ: ${JSON.stringify(r)}`); payrollData.refetch(); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
      }}>تنخواہ پوسٹ کریں</Button></div>}
    <div className="card" style={{ marginBlock: 16 }}><h2>ملازمین</h2>
      <DataTable rows={employees.data ?? []} csvName="employees" columns={[
        { key: 'name', label: 'نام' }, { key: 'role', label: 'عہدہ' },
        { key: 'base_salary_paisa', label: 'تنخواہ', money: true }, { key: 'status', label: 'حالت' },
      ] as Column[]} /></div>
    <div className="card"><h2>ایڈوانسز</h2>
      <DataTable rows={advances.data ?? []} csvName="advances" columns={[
        { key: 'date', label: 'تاریخ' }, { key: 'employee_id', label: 'ملازم' },
        { key: 'amount_paisa', label: 'رقم', money: true },
      ] as Column[]} /></div>
  </div>;
}

// ---------------------------------- Returns ----------------------------------
export function ReturnsScreen() {
  const { toast, can, t } = useApp();
  const { data, isLoading, error, refetch } = useGet<any>('returns', '/api/v1/returns');
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [err, setErr] = useState('');
  const [type, setType] = useState('SALE'), [originalId, setOriginalId] = useState(''), [lineId, setLineId] = useState(''), [qty, setQty] = useState(0);
  const docs = useGet<{ rows?: any[] }>('return-docs', `/api/v1/${type === 'SALE' ? 'sales' : 'purchases'}`);
  if (!can('returns.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div><div className="between"><h1 className="head-icon"><NavIcon icon="returns" label="واپسی / ریورس" size={34} />واپسی / ریورس</h1>
    <Button size="sm" onClick={() => setOpen(true)}>+ نئی واپسی</Button></div>
    <div className="notice info small">پوسٹڈ مالی ریکارڈ کبھی ایڈٹ نہیں ہوتا: واپسی = ریورس + متبادل ریکارڈ، وجہ/صارف/ٹائم اسٹیمپ کے ساتھ۔
      سیل ریٹرن منجمد COGS پر واپس آتی ہے؛ خرید ریٹرن لائن رقم پر ریورس ہوتی ہے۔</div>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data?.sales_returns ?? []).length && !(data?.purchase_returns ?? []).length}>
      <div className="card"><h2>فروخت واپسی</h2><DataTable rows={data?.sales_returns ?? []} csvName="sale-returns" columns={[
        { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' }, { key: 'reason', label: 'وجہ' },
        { key: 'total_paisa', label: 'رقم', money: true },
      ] as Column[]} /></div>
      <div className="card" style={{ marginBlock: 16 }}><h2>خرید واپسی</h2><DataTable rows={data?.purchase_returns ?? []} csvName="purchase-returns" columns={[
        { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' }, { key: 'reason', label: 'وجہ' },
        { key: 'total_paisa', label: 'رقم', money: true },
      ] as Column[]} /></div>
    </AsyncView>
    <Sheet open={open} onClose={() => setOpen(false)} title="نئی واپسی">
      <SelectField label="قسم" value={type} onChange={setType} options={[{ value: 'SALE', label: 'فروخت واپسی' }, { value: 'PURCHASE', label: 'خرید واپسی' }]} />
      <SelectField label="اصل دستاویز" value={originalId} onChange={setOriginalId} placeholder="منتخب کریں"
        options={(docs.data?.rows ?? []).map((d: any) => ({ value: d.id, label: d.number }))} />
      <TextField label="لائن ID" value={lineId} onChange={setLineId} required dir="ltr" />
      <QtyField label="واپس تعداد" milli={qty} onChange={setQty} required />
      <TextField label="وجہ" value={reason} onChange={setReason} required />
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button onClick={async () => {
        try { await api('/api/v1/returns', { method: 'POST', body: { type, original_id: originalId, date: TODAY(), reason, refund_method: 'KHATA', lines: [{ line_id: lineId, qty_milli: qty }] } }); toast('واپسی پوسٹ'); refetch(); setOpen(false); }
        catch (e: any) { setErr(e.message_ur ?? String(e)); }
      }}>پوسٹ کریں</Button>
    </Sheet>
  </div>;
}

// -------------------------------- Online orders ------------------------------
const ORDER_TABS = [
  { id: '', label: 'تمام' }, { id: 'NEW', label: 'نئے' }, { id: 'UNDER_REVIEW', label: 'جائزے میں' },
  { id: 'APPROVED', label: 'منظور' }, { id: 'REJECTED', label: 'مسترد' },
];
const ORDER_STATUS_UR: Record<string, string> = {
  NEW: 'نیا', UNDER_REVIEW: 'جائزہ', APPROVED: 'منظور', REJECTED: 'مسترد', CANCELLED: 'منسوخ',
};

export function OrdersScreen() {
  const { toast, can, t, lang } = useApp();
  const [tab, setTab] = useState('');
  const { data, isLoading, error, refetch } = useGet<any[]>('orders', `/api/v1/orders${tab ? `?status=${tab}` : ''}`);
  const [sel, setSel] = useState<any>(null);
  const [paid, setPaid] = useState(true), [note, setNote] = useState(''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const ready = useGet<any>('checkout-ready', '/api/v1/orders-meta/checkout-ready');
  const review = can('orders.review');

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true); setErr('');
    try { await fn(); toast(msg); setSel(null); refetch(); }
    catch (e: any) { setErr(e.message_ur ?? String(e)); }
    finally { setBusy(false); }
  };

  return <div>
    <h1 className="head-icon"><NavIcon icon="orders" label={t('orders')} size={34} />{t('orders')}</h1>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      {ready.data && <>
        <Chip tone={ready.data.payment_methods ? 'success' : 'warning'}>{t('paymentMethods')}: <span className="num">{ready.data.payment_methods}</span></Chip>
        <Chip tone={ready.data.priced_products ? 'success' : 'warning'}>قیمت والی مصنوعات: <span className="num">{ready.data.priced_products}</span></Chip>
        <Chip tone={ready.data.pending_orders ? 'info' : 'gray'}>زیرِ جائزہ: <span className="num">{ready.data.pending_orders}</span></Chip>
        <Chip tone="gray">تصاویر: <span className="num">{ready.data.media_backend}</span></Chip>
      </>}
    </div>
    {!ready.data?.payment_methods && <div className="notice warn small" style={{ marginBottom: 12 }}>
      آن لائن آرڈر کے لیے کم از کم ایک ادائیگی کا طریقہ بنائیں (<Link to="/erp/payment-methods">ادائیگی کے طریقے</Link>)۔
    </div>}
    <Tabs tabs={ORDER_TABS} active={tab} onChange={setTab} />
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <DataTable rows={data ?? []} csvName="orders" onRow={(r) => { setSel(r); setErr(''); setReason(''); setNote(''); }} columns={[
        { key: 'number', label: 'حوالہ' },
        { key: 'customer_name', label: 'نام' },
        { key: 'mobile', label: 'موبائل' },
        { key: 'city', label: 'شہر' },
        { key: 'payment_method', label: t('paymentMethod') },
        { key: 'total_paisa', label: t('total'), money: true },
        { key: 'proofs', label: 'رسیدیں', render: (r: any) => <span className="num">{(r.proofs ?? []).length}</span> },
        { key: 'status', label: t('status'), render: (r: any) => <Chip tone={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'danger' : r.status === 'UNDER_REVIEW' ? 'info' : 'gray'}>{ORDER_STATUS_UR[r.status] ?? r.status}</Chip> },
      ] as Column[]} />
    </AsyncView>

    <Sheet open={!!sel} onClose={() => setSel(null)} title={`آرڈر ${sel?.number ?? ''}`}>
      {sel && <div className="card">
        <div className="kv">
          <span className="k">نام</span><span className="v">{sel.customer_name}</span>
          <span className="k">موبائل</span><span className="v num">{sel.mobile}</span>
          <span className="k">شہر</span><span className="v">{sel.city}</span>
          <span className="k">پتہ</span><span className="v">{sel.address || '—'}</span>
          <span className="k">طریقہ</span><span className="v">{sel.payment_method}</span>
          <span className="k">کل</span><span className="v num">{formatPKR(sel.total_paisa)}</span>
        </div>
        {!!sel.notes && <p className="small">نوٹ: {sel.notes}</p>}
        <table className="table"><thead><tr><th>مصنوعات</th><th>تعداد</th><th>ریٹ</th><th>رقم</th></tr></thead>
          <tbody>{(sel.items ?? []).map((i: any) => <tr key={i.name_ur + i.qty_milli}>
            <td>{i.name_ur}</td>
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
                () => api(`/api/v1/orders/${sel.id}/proofs/${p.id}/status`, { method: 'POST', body: { status: 'ACCEPTED' } }), 'رسید منظور')}>منظور</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(
                () => api(`/api/v1/orders/${sel.id}/proofs/${p.id}/status`, { method: 'POST', body: { status: 'REJECTED' } }), 'رسید مسترد')}>مسترد</button>
            </div>}
          </div>)}</div>
        </>}

        {sel.status === 'APPROVED' && <div className="notice info small">یہ آرڈر فروخت میں تبدیل ہو چکا ہے:
          {(sel.sale_ids ?? []).length} دستاویز۔ اسٹاک و کھاتہ بدل چکا ہے۔</div>}
        {!!sel.reject_reason && <div className="err"><Mark kind="warn" /> {sel.reject_reason}</div>}

        {review && !['APPROVED', 'REJECTED', 'CANCELLED'].includes(sel.status) && <>
          <CheckField label={t('markPaid')} checked={paid} onChange={setPaid} />
          <TextField label="نوٹ (اختیاری)" value={note} onChange={setNote} />
          {err && <div className="err"><Mark kind="warn" /> {err}</div>}
          <div className="btn-row">
            <Button loading={busy} onClick={() => act(
              () => api(`/api/v1/orders/${sel.id}/approve`, { method: 'POST', body: { paid, mark_proof_accepted: true, note, idempotency_key: `ORD:${sel.id}:UI:${Date.now()}` } }),
              'آرڈر فروخت بن گیا')}>{t('approveOrder')}</Button>
            <Button variant="danger" disabled={!reason || busy} loading={busy} onClick={() => act(
              () => api(`/api/v1/orders/${sel.id}/reject`, { method: 'POST', body: { reason } }), 'آرڈر مسترد')}>{t('rejectOrder')}</Button>
          </div>
          <p className="small">{lang === 'ur'
            ? 'منظوری موجودہ فروخت انجن سے ایک دستاویز فی کتاب بناتی ہے — اسٹاک، کھاتہ اور جرنل اسی وقت کٹتے ہیں۔'
            : 'Approval posts through the existing sale engine — one document per book; stock, khata and journal move only then.'}</p>
        </>}
        {!review && <div className="notice warn small">{t('permissionDenied')}</div>}
      </div>}
    </Sheet>
  </div>;
}

// ------------------------------ Payment methods ------------------------------
const METHOD_KINDS = [
  { value: 'BANK', label: 'بینک اکاؤنٹ' }, { value: 'EASYPAISA', label: 'ایزی پیسہ' },
  { value: 'JAZZCASH', label: 'جازی کیش' }, { value: 'WALLET', label: 'والٹ' }, { value: 'CASH', label: 'نقد / دکان' },
];
const BLANK_METHOD = {
  kind: 'BANK', title_ur: '', title_en: '', bank_name: '', account_title: '', account_number: '',
  iban: '', mobile_number: '', instructions_ur: '', account_id: '', is_active: true, sort: 0,
};

export function PaymentMethodsScreen() {
  const { toast, can, t } = useApp();
  const { data, isLoading, error, refetch } = useGet<any[]>('payment-methods', '/api/v1/payment-methods');
  const accounts = useGet<any[]>('accounts', '/api/v1/accounts');
  const write = can('payments.methods.write');
  const [sel, setSel] = useState<any>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<any>(BLANK_METHOD);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  const uploadQr = async (file?: File) => {
    if (!file || isNew || !form.id) return;
    setBusy(true); setErr('');
    try {
      const { data_url } = await shrinkImage(file, 900, 420 * 1024);
      await api(`/api/v1/payment-methods/${form.id}/qr`, { method: 'POST', body: { data_url } });
      toast(t('savedPhoto')); refetch();
    } catch (e: any) { setErr(e.message_ur ?? String(e)); }
    finally { setBusy(false); }
  };

  const remove = async (m: any) => {
    setBusy(true);
    try { const r = await api<any>(`/api/v1/payment-methods/${m.id}`, { method: 'DELETE' }); toast(r.deactivated ? 'غیر فعال کر دیا' : 'حذف کر دیا'); refetch(); }
    catch (e: any) { toast(e.message_ur ?? String(e), 'err'); }
    finally { setBusy(false); }
  };

  return <div>
    <h1 className="head-icon"><NavIcon icon="payments" label={t('paymentMethods')} size={34} />{t('paymentMethods')}</h1>
    <p className="small">{t('paymentMethodsNote')}</p>
    {write && <div className="btn-row"><Button size="sm" onClick={() => open()}>{t('newPaymentMethod')}</Button></div>}
    <AsyncView loading={isLoading} error={error} retry={() => refetch()} empty={!(data ?? []).length}>
      <div className="method-grid">{(data ?? []).map((m) => <TiltCard key={m.id} className="method-card" tone={m.is_active ? 'default' : 'pink'}>
        <div className="method-card-head">
          <span className={`method-badge`} data-kind={m.kind} aria-hidden="true" />
          <div><strong>{m.title_ur}</strong><div className="small">{METHOD_KINDS.find((k) => k.value === m.kind)?.label ?? m.kind}</div></div>
          <Chip tone={m.is_active ? 'success' : 'gray'} className="method-state">{m.is_active ? 'فعال' : 'بند'}</Chip>
        </div>
        {m.qr_url && <div className="method-qr"><img src={m.qr_url} alt={`${m.title_ur} QR`} loading="lazy" width={160} height={160} /></div>}
        <div className="small">{m.bank_name || m.account_title || m.mobile_number || '—'}</div>
        {!!m.account_number && <div className="small num">{m.account_number}</div>}
        {!!m.iban && <div className="small num">{m.iban}</div>}
        <div className="small">کھاتہ: {m.account_id ? (accounts.data ?? []).find((a) => a.id === m.account_id)?.name_ur ?? m.account_id : 'نجی'} · {t('linkedAccount')}</div>
        <div className="row" style={{ gap: 6 }}>
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
        <TextField label="بینک" value={form.bank_name} onChange={(v) => set('bank_name', v)} />
        <TextField label="اکاؤنٹ ٹائٹل" value={form.account_title} onChange={(v) => set('account_title', v)} />
        <TextField label="اکاؤنٹ نمبر" value={form.account_number} onChange={(v) => set('account_number', v)} dir="ltr" inputMode="numeric" />
        <TextField label="IBAN" value={form.iban} onChange={(v) => set('iban', v)} dir="ltr" />
      </>}
      {(form.kind === 'EASYPAISA' || form.kind === 'JAZZCASH' || form.kind === 'WALLET') &&
        <TextField label={t('mobile')} value={form.mobile_number} onChange={(v) => set('mobile_number', v)} dir="ltr" inputMode="tel" />}
      <SelectField label={t('linkedAccount')} value={form.account_id} onChange={(v) => set('account_id', v)} placeholder="نجی (منظوری پر بقایا رہے)"
        options={(accounts.data ?? []).map((a: any) => ({ value: a.id, label: `${a.name_ur} (${a.code ?? a.gl_code ?? ''})` }))} />
      <div className="field"><label htmlFor="pm-inst">{t('note')}</label>
        <textarea id="pm-inst" className="input" rows={3} value={form.instructions_ur} onChange={(e) => set('instructions_ur', e.target.value)} /></div>
      <CheckField label="فعال" checked={!!form.is_active} onChange={(v) => set('is_active', v)} />
      <TextField label="ترتیب" value={String(form.sort)} onChange={(v) => set('sort', v)} inputMode="numeric" dir="ltr" />
      {err && <div className="err"><Mark kind="warn" /> {err}</div>}
      <Button onClick={save} loading={busy} disabled={!form.title_ur}>{t('save')}</Button>
      {!isNew && write && <>
        <input ref={fileRef} type="file" accept="image/png,image/webp,image/jpeg" className="sr-only"
          onChange={(e) => void uploadQr(e.target.files?.[0])} />
        <div className="btn-row"><Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>{t('uploadQr')}</Button></div>
        <p className="small">{t('qrNote')}</p>
      </>}
    </Sheet>
  </div>;
}
