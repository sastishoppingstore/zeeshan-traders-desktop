/** Real posting forms: purchase/sale (all 12 goods+grain-independent books), grain weighment, simple vouchers. */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useGet, api } from './api.js';
import { useApp } from './app-state.js';
import { Mark } from './ui/marks.js';
import { saveDraft } from './offline-security.js';
import {
  Button, TextField, MoneyField, QtyField, SelectField, CheckField, Combobox, Field, Chip,
  AsyncView, IncompleteBadge, StatusChip,
} from './components.js';
import { PrintActions } from './print.js';
import {
  lineAmount, fromMilli, toMilli, netWeight, formatMaund, ratePerMaundToRatePerKg,
  formatPKR, rupeesToPaisa, paisaToRupees, BOOK_MAP, MONEY_ACCOUNTS,
  type DocumentSnapshot,
} from '@zt/shared';

const TODAY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const accOptions = MONEY_ACCOUNTS.map((a) => ({ value: `acct-${a.code.toLowerCase()}`, label: a.ur, sub: a.en }));

interface Line {
  product_id: string; qty_milli: number; rate_paisa: number; discount_paisa: number;
  batch_id: string | null; batch_no: string; mfg_date: string; expiry_date: string;
  manufacturer: string; bags: number; weight_per_bag_grams: number;
}
const emptyLine = (): Line => ({ product_id: '', qty_milli: 0, rate_paisa: 0, discount_paisa: 0,
  batch_id: null, batch_no: '', mfg_date: '', expiry_date: '', manufacturer: '', bags: 0, weight_per_bag_grams: 0 });

interface PayPart { account_id: string; amount_paisa: number }
const emptyPay = (): PayPart => ({ account_id: 'acct-cash', amount_paisa: 0 });

export function DocumentForm({ kind, book }: { kind: 'purchase' | 'sale'; book: string }) {
  const { t, online, enqueue, toast, can, session } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const quick = params.get('quick') === '1';
  const bookDef = BOOK_MAP[book];
  const products = useGet<any>('products-ref', '/api/v1/products?limit=100');
  const parties = useGet<any[]>('parties-ref', '/api/v1/parties?limit=100');
  const categories = useGet<any[]>('categories-ref', '/api/v1/categories');
  const [date, setDate] = useState(TODAY());
  const [partyId, setPartyId] = useState(''), [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState(''), [partyAddress, setPartyAddress] = useState('');
  const [cnic, setCnic] = useState(''), [season, setSeason] = useState('NONE');
  const [supplierInvoice, setSupplierInvoice] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [discount, setDiscount] = useState(0), [freight, setFreight] = useState(0);
  const [loadingC, setLoading] = useState(0), [other, setOther] = useState(0);
  const [payments, setPayments] = useState<PayPart[]>([emptyPay()]);
  const [note, setNote] = useState(''), [credit, setCredit] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null), [snapshot, setSnapshot] = useState<DocumentSnapshot | null>(null);
  const [dirty, setDirty] = useState(false);

  const bookCategoryIds = new Set((categories.data ?? []).filter((c: any) => c.book_code === book ||
    c.id === `cat-${book.toLowerCase()}`).map((c: any) => c.id));
  const productRows = (products.data?.rows ?? []).filter((p: any) => bookCategoryIds.size === 0 || bookCategoryIds.has(p.category_id));
  const productOptions = productRows.map((p: any) => ({ value: p.id, label: `${p.name_ur} ${p.name_en ? '(' + p.name_en + ')' : ''}`,
    sub: `اسٹاک ${fromMilli(p.stock_milli ?? 0)} ${p.base_unit}` }));
  const partyOptions = (parties.data ?? []).map((p: any) => ({ value: p.id, label: p.name_ur, sub: p.phone }));
  useEffect(() => { if (credit) setPayments([{ account_id: 'acct-cash', amount_paisa: 0 }]); }, [credit]);

  const subtotal = lines.reduce((a, l) => a + lineAmount(l.qty_milli, l.rate_paisa) - l.discount_paisa, 0);
  const extras = kind === 'purchase' ? freight + loadingC + other - discount : -discount;
  const total = subtotal + extras;
  const paid = payments.reduce((a, p) => a + p.amount_paisa, 0);
  const due = Math.max(0, total - paid);
  const balanceWarning = partyId && due > 0 ? (parties.data ?? []).find((p: any) => p.id === partyId)?.credit_limit_paisa : 0;

  const setLine = (i: number, patch: Partial<Line>) => { setDirty(true); setLines((ls) => ls.map((l, j) => j === i ? { ...l, ...patch } : l)); };
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);

  const buildPayload = () => ({
    date, book_code: book, party_id: partyId || null,
    party_name: partyId ? undefined : partyName, party_phone: partyPhone || undefined,
    party_address: partyAddress || undefined, cnic: cnic || undefined,
    season, supplier_invoice_no: supplierInvoice || undefined,
    lines: lines.filter((l) => l.product_id && l.qty_milli > 0).map((l) => ({
      product_id: l.product_id, qty_milli: l.qty_milli, rate_paisa: l.rate_paisa,
      discount_paisa: l.discount_paisa, batch_id: l.batch_id || undefined,
      ...(l.batch_no ? { batch_no: l.batch_no } : {}), ...(l.mfg_date ? { mfg_date: l.mfg_date } : {}),
      ...(l.expiry_date ? { expiry_date: l.expiry_date } : {}), ...(l.manufacturer ? { manufacturer: l.manufacturer } : {}),
      bags: l.bags || undefined, weight_per_bag_grams: l.weight_per_bag_grams || undefined,
    })),
    discount_paisa: discount, freight_paisa: freight, loading_paisa: loadingC, other_paisa: other,
    payments: paid > 0 ? payments.filter((p) => p.amount_paisa > 0).map((p) => ({ account_id: p.account_id, amount_paisa: p.amount_paisa })) : [],
    note, quick,
  });

  const loadSnapshot = async (number: string) => {
    try {
      const docs = await api<any[]>(`/api/v1/documents?q=${encodeURIComponent(number)}&from=${date}&to=${date}`);
      const d = docs.find((x: any) => x.number === number);
      if (d) setSnapshot(await api<DocumentSnapshot>(`/api/v1/documents/${d.id}`).then((r: any) => r.snapshot));
    } catch { /* keep result visible */ }
  };

  const submit = async (mode: 'post' | 'draft' | 'new') => {
    setErr(''); setFieldErrors({});
    if (!partyId && partyName.trim().length < 2) { setErr('فریق کا نام درکار ہے'); return; }
    if (!lines.some((l) => l.product_id && l.qty_milli > 0)) { setErr('کم از کم ایک لائن درکار ہے'); return; }
    if (paid > total) { setErr('ادا شدہ رقم کل سے زیادہ ہے'); return; }
    if (kind === 'sale' && book === 'PEST' && (!partyPhone || !partyAddress)) { setErr('پیسٹی سائیڈ کے لیے موبائل اور پتہ لازمی ہے'); return; }
    if (kind === 'purchase' && book === 'PEST' && lines.some((l) => !l.batch_no || !l.mfg_date || !l.expiry_date || !l.manufacturer)) {
      setErr('پیسٹی سائیڈ خرید میں بیچ، MFG، ایکسپائری اور مینوفیکچرر لازمی ہیں'); return;
    }
    if (mode === 'draft') {
      await saveDraft(`${kind}-${book}-${Date.now()}`, { ...buildPayload(), saved_at: new Date().toISOString() });
      toast('ڈرافٹ محفوظ ہو گیا (مقامی)'); setDirty(false); return;
    }
    setBusy(true);
    try {
      const payload = buildPayload();
      if (!online) {
        const op = await enqueue(kind === 'sale' ? 'SALE' : 'PURCHASE', payload as any);
        setResult({ number: `D${op.device_id}-${op.id.slice(0, 6)}`, provisional: true, id: op.id });
      } else {
        const r = await api<any>(kind === 'sale' ? '/api/v1/sales' : '/api/v1/purchases', { method: 'POST', body: payload });
        setResult(r); toast(`${kind === 'sale' ? 'فروخت' : 'خرید'} پوسٹ ہو گئی: ${r.number}`);
        await loadSnapshot(r.number);
      }
      setDirty(false);
      if (mode === 'new') { setLines([emptyLine()]); setPayments([emptyPay()]); setResult(null); setSnapshot(null); setPartyId(''); setPartyName(''); }
    } catch (e: any) { setErr(e.message_ur ?? String(e)); setFieldErrors(e.field_errors ?? {}); }
    finally { setBusy(false); }
  };

  if (!can(kind === 'sale' ? 'sales.post' : 'purchases.post')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;

  return <div>
    <div className="between"><h1>{kind === 'sale' ? 'فروخت' : 'خرید'} — {bookDef?.ur ?? book}</h1>
      <div className="row"><Chip tone={quick ? 'warning' : 'gray'}>{quick ? 'تیز اندراج' : 'تفصیلی فارم'}</Chip>
        {!online && <Chip tone="warning">آف لائن — PROVISIONAL</Chip>}</div></div>
    {quick && <div className="notice info small">تیز اندراج میں صرف نام، تعداد، رقم اور نقد/ادھار درج کریں۔
      <Link to={`/erp/${book === 'FERT' ? 'fertilizer' : book === 'PEST' ? 'pesticide' : `goods/${book}`}/${kind}/new`}> تفصیلی فارم </Link></div>}

    {!result ? <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
      <div className="card">
        <h2>بنیادی معلومات</h2>
        <div className="grid g2">
          <TextField label="تاریخ" value={date} onChange={(v) => { setDate(v); setDirty(true); }} type="date" required />
          <SelectField label="سیزن" value={season} onChange={setSeason} options={[
            { value: 'NONE', label: '—' }, { value: 'KHARIF', label: 'خریف (Apr–Sep)' }, { value: 'RABI', label: 'ربی (Oct–Mar)' }]} />
        </div>
        <Combobox label={kind === 'sale' ? 'خریدار' : 'سپلائر'} value={partyId} onChange={(v) => { setPartyId(v); setDirty(true); }}
          options={partyOptions} onCreate={(n) => { setPartyName(n); setPartyId(''); }} placeholder="نام تلاش کریں یا نیا لکھیں" required error={fieldErrors.party_name} />
        {!partyId && partyName && <Chip tone="success">نیا فریق: {partyName}</Chip>}
        <div className="grid g2">
          <TextField label="موبائل" value={partyPhone} onChange={setPartyPhone} placeholder="03XX-XXXXXXX"
            error={fieldErrors.party_phone} required={kind === 'sale' && book === 'PEST'} />
          <TextField label="پتہ / گاؤں" value={partyAddress} onChange={setPartyAddress}
            required={kind === 'sale' && book === 'PEST'} />
        </div>
        {kind === 'purchase' && <TextField label="سپلائر انوائس نمبر" value={supplierInvoice} onChange={setSupplierInvoice} />}
        {kind === 'sale' && book === 'FERT' && <TextField label="CNIC (اختیاری، انکرپٹڈ)" value={cnic} onChange={setCnic} />}
      </div>

      <div className="card"><h2>لائنیں</h2>
        {lines.map((l, i) => <div key={i} className="card" style={{ marginBlockEnd: 12, background: 'var(--bg)' }}>
          <div className="between"><strong>لائن {i + 1}</strong>
            {lines.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="لائن ہٹائیں"><Mark kind="x" /></Button>}</div>
          <Combobox label="مصنوعات" value={l.product_id} onChange={(v) => {
            const p = productRows.find((x: any) => x.id === v);
            setLine(i, { product_id: v, rate_paisa: p ? (kind === 'sale' ? p.sale_rate_paisa : p.purchase_rate_paisa) : 0 });
          }} options={productOptions} placeholder="اردو یا انگریزی نام / SKU" required />
          <div className="grid g2">
            <QtyField label="تعداد" milli={l.qty_milli} onChange={(v) => setLine(i, { qty_milli: v })}
              unit={productRows.find((p: any) => p.id === l.product_id)?.base_unit} required />
            <MoneyField label="ریٹ (فی بنیادی یونٹ)" paisa={l.rate_paisa} onChange={(v) => setLine(i, { rate_paisa: v })} required />
          </div>
          {quick && <MoneyField label="رقم (کل)" paisa={0} onChange={(v) => {
            if (l.qty_milli > 0) setLine(i, { rate_paisa: Math.round(v * 1000 / l.qty_milli) });
          }} helper="رقم درج کریں؛ ریٹ خود بخود نکلا جائے گا" />}
          {!quick && <div className="grid g2">
            <MoneyField label="رعایت" paisa={l.discount_paisa} onChange={(v) => setLine(i, { discount_paisa: v })} />
            <div className="card" style={{ padding: 12 }}><div className="small">لائن کل</div>
              <div className="num">{formatPKR(lineAmount(l.qty_milli, l.rate_paisa) - l.discount_paisa)}</div></div>
          </div>}
          {(book === 'PEST' || productRows.find((p: any) => p.id === l.product_id)?.track_expiry) && !quick &&
            <div className="grid g2">
              <TextField label="بیچ نمبر" value={l.batch_no} onChange={(v) => setLine(i, { batch_no: v })} required={kind === 'purchase'} />
              <TextField label="مینوفیکچرر" value={l.manufacturer} onChange={(v) => setLine(i, { manufacturer: v })} required={kind === 'purchase'} />
              <TextField label="تاریخِ تیاری" value={l.mfg_date} onChange={(v) => setLine(i, { mfg_date: v })} type="date" required={kind === 'purchase'} />
              <TextField label="ایکسپائری" value={l.expiry_date} onChange={(v) => setLine(i, { expiry_date: v })} type="date" required={kind === 'purchase'} />
            </div>}
          {!quick && book === 'FERT' && <div className="grid g2">
            <TextField label="بوریوں کی تعداد" value={String(l.bags || '')} onChange={(v) => setLine(i, { bags: Number(v) || 0 })} inputMode="numeric" />
            <TextField label="وزن فی بوری (گرام)" value={String(l.weight_per_bag_grams || '')}
              onChange={(v) => setLine(i, { weight_per_bag_grams: Number(v) || 0 })} inputMode="numeric" />
          </div>}
        </div>)}
        <Button variant="secondary" size="sm" onClick={addLine}>+ لائن شامل کریں</Button>
      </div>

      {!quick && <div className="card"><h2>اضافی اخراجات</h2><div className="grid g2">
        <MoneyField label="رعایت" paisa={discount} onChange={setDiscount} />
        {kind === 'purchase' && <><MoneyField label="مال برداری" paisa={freight} onChange={setFreight} />
          <MoneyField label="لوڈنگ / ان لوڈنگ" paisa={loadingC} onChange={setLoading} />
          <MoneyField label="دیگر" paisa={other} onChange={setOther} /></>}
      </div></div>}

      <div className="card"><h2>ادائیگی</h2>
        <CheckField label="ادھار (بقایا بعد میں وصول/ادا ہوگا)" checked={credit} onChange={setCredit} />
        {!credit && payments.map((p, i) => <div key={i} className="grid g2" style={{ alignItems: 'end' }}>
          <SelectField label="اکاؤنٹ" value={p.account_id} onChange={(v) => setPayments(payments.map((x, j) => j === i ? { ...x, account_id: v } : x))}
            options={accOptions} />
          <MoneyField label="رقم" paisa={p.amount_paisa} onChange={(v) => setPayments(payments.map((x, j) => j === i ? { ...x, amount_paisa: v } : x))} />
        </div>)}
        {!credit && payments.length < 4 && <Button variant="ghost" size="sm" onClick={() => setPayments([...payments, emptyPay()])}>+ اکاؤنٹ شامل کریں (تقسیم)</Button>}
        <div className="kv" style={{ marginBlockStart: 16 }}>
          <span className="k">ذیلی کل</span><span className="v num">{formatPKR(subtotal)}</span>
          <span className="k">اضافی / رعایت</span><span className="v num">{formatPKR(extras)}</span>
          <span className="k">کل</span><span className="v num">{formatPKR(total)}</span>
          <span className="k">ادا شدہ</span><span className="v num">{formatPKR(paid)}</span>
          <span className="k">بقایا (ادھار)</span><span className="v num" style={{ color: due > 0 ? 'var(--danger)' : undefined }}>{formatPKR(due)}</span>
        </div>
        {balanceWarning > 0 && due > balanceWarning && <div className="notice"><Mark kind="warn" /> کریڈٹ حد سے تجاوز</div>}
      </div>

      <div className="card"><TextField label="نوٹ" value={note} onChange={setNote} />
        {err && <div className="err" role="alert"><Mark kind="warn" /> {err}</div>}
        {Object.keys(fieldErrors).length > 0 && <pre>{JSON.stringify(fieldErrors, null, 2)}</pre>}
        <div className="btn-row">
          <Button onClick={() => submit('post')} loading={busy}>محفوظ کریں اور پوسٹ کریں</Button>
          <Button variant="secondary" onClick={() => submit('new')} loading={busy}>محفوظ کریں اور نیا</Button>
          <Button variant="ghost" onClick={() => submit('draft')}>ڈرافٹ محفوظ کریں</Button>
          <Button variant="ghost" onClick={() => { if (!dirty || confirm('تبدیلیاں ضائع ہوں گی؟')) nav(-1); }}>منسوخ</Button>
        </div>
      </div>
    </div> : <div className="card">
      <h2><Mark kind="check-circle" /> {kind === 'sale' ? 'فروخت' : 'خرید'} پوسٹ ہو گئی</h2>
      <p>نمبر: <strong className="num">{result.number}</strong> {result.provisional && <Chip tone="warning">PROVISIONAL</Chip>}</p>
      <p>کل: <span className="num">{formatPKR(result.total_paisa ?? total)}</span> · بقایا: <span className="num">{formatPKR(result.due_paisa ?? due)}</span></p>
      {!!result.warnings?.length && <div className="notice">{result.warnings.join(' · ')}</div>}
      {snapshot && <PrintActions snapshot={snapshot} />}
      {!snapshot && !result.provisional && <div className="small">دستاویز «دستاویزات سینٹر» سے بھی پرنٹ ہو سکتی ہے۔</div>}
      <div className="btn-row">
        <Link className="btn btn-secondary" to="/erp/receipts/new">+ رقم وصول</Link>
        <Button variant="ghost" onClick={() => { setResult(null); setSnapshot(null); }}>نیا اندراج</Button>
        <Link className="btn btn-ghost" to="/erp/documents">دستاویزات</Link>
      </div>
    </div>}
  </div>;
}

// --------------------------------- Grain forms ------------------------------
export function GrainForm({ kind }: { kind: 'purchase' | 'sale' }) {
  const { crop = 'WHEAT' } = useParams();
  const { online, enqueue, toast, can, t, session } = useApp();
  const nav = useNavigate();
  const [date, setDate] = useState(TODAY());
  const [partyName, setPartyName] = useState(''), [partyId, setPartyId] = useState('');
  const [phone, setPhone] = useState(''), [village, setVillage] = useState(''), [grade, setGrade] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [grossKg, setGrossKg] = useState(''), [bags, setBags] = useState(''), [tareKg, setTareKg] = useState('');
  const [deductions, setDeductions] = useState<{ type: string; basis: string; value: string; note: string }[]>([]);
  const [rateBasis, setRateBasis] = useState('PER_MAUND'), [rate, setRate] = useState(0);
  const [commission, setCommission] = useState(0), [labour, setLabour] = useState(0), [transport, setTransport] = useState(0);
  const [netGrams, setNetGrams] = useState('');
  const [lotId, setLotId] = useState(''), [payAccount, setPayAccount] = useState('acct-cash'), [paid, setPaid] = useState(0);
  const [deductionsPaisa, setDeductionsPaisa] = useState(0), [expensesPaisa, setExpensesPaisa] = useState(0);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [result, setResult] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<DocumentSnapshot | null>(null);
  const parties = useGet<any[]>('parties-ref', '/api/v1/parties?limit=100');
  const lots = useGet<any[]>('grain-lots', `/api/v1/grains/lots?crop=${crop}`);
  const settings = useGet<any>('settings', '/api/v1/settings');

  const grossGrams = Math.round(Number(grossKg || 0) * 1000);
  const tarePerBag = Math.round(Number(tareKg || 0) * 1000);
  const computed = useMemo(() => {
    if (kind !== 'purchase' || grossGrams <= 0) return null;
    try { return netWeight({ grossGrams, bags: Number(bags) || 0, tarePerBagGrams: tarePerBag,
      deductions: deductions.map((d) => ({ type: d.type as any, basis: d.basis as any, value: Number(d.value) || 0, note: d.note })) }); }
    catch (e: any) { return { error: String(e.message) }; }
  }, [kind, grossGrams, bags, tarePerBag, deductions]);
  const netG = kind === 'purchase' ? (computed as any)?.netGrams ?? 0 : Math.round(Number(netGrams) * 1000);
  const maundKg = settings.data?.maund_kg ?? 0;
  const perKg = rateBasis === 'PER_MAUND' && maundKg > 0 ? ratePerMaundToRatePerKg(rate, maundKg) : rate;
  const goods = netG ? lineAmount(netG, perKg) : 0;
  const total = kind === 'purchase' ? goods + commission + labour + transport : goods - deductionsPaisa - expensesPaisa;
  const due = Math.max(0, total - paid);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const path = `/api/v1/grains/${crop}/${kind}`;
      const payload: any = kind === 'purchase' ? {
        date, party_id: partyId || null, party_name: partyId ? undefined : partyName,
        party_phone: phone || undefined, village: village || undefined, grade, lot_no: lotNo || undefined,
        gross_grams: grossGrams, bags: Number(bags) || 0, tare_per_bag_grams: tarePerBag,
        deductions: deductions.map((d) => ({ type: d.type, basis: d.basis, value: Number(d.value) || 0, note: d.note })),
        rate_basis: rateBasis, rate_paisa: rate, commission_paisa: commission, labour_paisa: labour,
        transport_paisa: transport, payments: paid ? [{ account_id: payAccount, amount_paisa: paid }] : [], note: '',
      } : {
        date, party_id: partyId || null, party_name: partyId ? undefined : partyName,
        lot_id: lotId, grade, net_grams: netG, rate_basis: rateBasis, rate_paisa: rate,
        deductions_paisa: deductionsPaisa, expenses_paisa: expensesPaisa,
        payments: paid ? [{ account_id: payAccount, amount_paisa: paid }] : [], note: '',
      };
      if (!online) {
        const op = await enqueue(kind === 'purchase' ? 'GRAIN_PURCHASE' : 'GRAIN_SALE', payload);
        setResult({ number: `D${op.device_id}-${op.id.slice(0, 6)}`, provisional: true });
      } else {
        const r = await api<any>(path, { method: 'POST', body: payload });
        setResult(r); toast(`اجناس ${kind === 'purchase' ? 'خرید' : 'فروخت'} پوسٹ ہو گئی: ${r.number}`);
        try {
          const docs = await api<any[]>(`/api/v1/documents?q=${encodeURIComponent(r.number)}&from=${date}&to=${date}`);
          const d = docs.find((x: any) => x.number === r.number);
          if (d) setSnapshot((await api<any>(`/api/v1/documents/${d.id}`)).snapshot);
        } catch { /* no snapshot available */ }
      }
    } catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
  };

  if (!can('grains.post')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  const cropUr = BOOK_MAP[crop]?.ur ?? crop;
  return <div><h1>{cropUr} — {kind === 'purchase' ? 'خرید از کاشتکار' : 'فروخت'}</h1>
    {!result ? <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
      {rateBasis === 'PER_MAUND' && !maundKg && <div className="notice"><Mark kind="warn" /> من کے کلو کی تصدیق ترتیبات میں باقی ہے (مالک ان پٹ درکار)۔</div>}
      <div className="card"><h2>بنیادی</h2>
        <TextField label="تاریخ" value={date} onChange={setDate} type="date" required />
        <Combobox label={kind === 'purchase' ? 'کاشتکار' : 'خریدار'} value={partyId} onChange={setPartyId}
          options={(parties.data ?? []).map((p: any) => ({ value: p.id, label: p.name_ur, sub: p.phone }))}
          onCreate={(n) => { setPartyName(n); setPartyId(''); }} placeholder="نام تلاش کریں یا نیا لکھیں" required />
        {!partyId && partyName && <Chip tone="success">نیا: {partyName}</Chip>}
        <div className="grid g2"><TextField label="موبائل" value={phone} onChange={setPhone} />
          <TextField label="گاؤں" value={village} onChange={setVillage} />
          <TextField label="گریڈ / کوالٹی" value={grade} onChange={setGrade} /></div>
        {kind === 'purchase' ? <TextField label="لاٹ نمبر (خالی چھوڑیں تو خودکار)" value={lotNo} onChange={setLotNo} /> :
          <SelectField label="لاٹ" value={lotId} onChange={setLotId} required
            options={(lots.data ?? []).map((l: any) => ({ value: l.id, label: `${l.lot_no} — ${formatMaund(l.balance_grams, maundKg || 40)}` }))}
            placeholder="لاٹ منتخب کریں" />}
      </div>
      {kind === 'purchase' ? <div className="card"><h2>وزن — شفاف حساب</h2>
        <div className="grid g2">
          <TextField label="کچا وزن (کلو)" value={grossKg} onChange={setGrossKg} inputMode="decimal" required />
          <TextField label="بوریاں" value={bags} onChange={setBags} inputMode="numeric" />
          <TextField label="بوری کا وزن (کلو)" value={tareKg} onChange={setTareKg} inputMode="decimal" />
        </div>
        <h3>کٹوتیاں</h3>
        {deductions.map((d, i) => <div key={i} className="grid g2 card" style={{ background: 'var(--bg)', marginBlockEnd: 8 }}>
          <SelectField label="قسم" value={d.type} onChange={(v) => setDeductions(deductions.map((x, j) => j === i ? { ...x, type: v } : x))}
            options={[{ value: 'MOISTURE', label: 'نمی' }, { value: 'CLEANING', label: 'صفائی' }, { value: 'OTHER', label: 'دیگر' }]} />
          <SelectField label="بنیاد" value={d.basis} onChange={(v) => setDeductions(deductions.map((x, j) => j === i ? { ...x, basis: v } : x))}
            options={[{ value: 'weight_grams', label: 'گرام' }, { value: 'percent_milli', label: 'فیصد (1000 = 1%)' }]} />
          <TextField label="قدر" value={d.value} onChange={(v) => setDeductions(deductions.map((x, j) => j === i ? { ...x, value: v } : x))} inputMode="decimal" />
          <TextField label="نوٹ" value={d.note} onChange={(v) => setDeductions(deductions.map((x, j) => j === i ? { ...x, note: v } : x))} />
          <Button variant="ghost" size="sm" onClick={() => setDeductions(deductions.filter((_, j) => j !== i))}>حذف</Button>
        </div>)}
        <Button variant="secondary" size="sm" onClick={() => setDeductions([...deductions, { type: 'MOISTURE', basis: 'weight_grams', value: '', note: '' }])}>+ کٹوتی</Button>
        {computed && <div className="card" style={{ marginBlockStart: 12 }}>
          <strong>خالص وزن: <span className="num">{formatMaund((computed as any).netGrams ?? 0, maundKg || 40)}</span></strong>
          <pre>{(computed as any).arithmetic?.join('\n') ?? (computed as any).error}</pre>
        </div>}
      </div> : <div className="card"><h2>وزن</h2>
        <TextField label="خالص وزن (کلو)" value={netGrams} onChange={setNetGrams} inputMode="decimal" required />
        <div className="small">لاٹ بیلنس سے زیادہ فروخت بلاک ہے (سرور چیک)۔</div>
      </div>}
      <div className="card"><h2>ریٹ اور رقم</h2>
        <div className="grid g2">
          <SelectField label="ریٹ کی بنیاد" value={rateBasis} onChange={setRateBasis}
            options={[{ value: 'PER_MAUND', label: 'فی من' }, { value: 'PER_KG', label: 'فی کلو' }]} />
          <MoneyField label={rateBasis === 'PER_MAUND' ? 'ریٹ فی من' : 'ریٹ فی کلو'} paisa={rate} onChange={setRate} required />
        </div>
        {kind === 'purchase' ? <div className="grid g2">
          <MoneyField label="کمیشن" paisa={commission} onChange={setCommission} />
          <MoneyField label="مزدوری" paisa={labour} onChange={setLabour} />
          <MoneyField label="ٹرانسپورٹ" paisa={transport} onChange={setTransport} />
        </div> : <div className="grid g2">
          <MoneyField label="کٹوتیاں" paisa={deductionsPaisa} onChange={setDeductionsPaisa} />
          <MoneyField label="اخراجات" paisa={expensesPaisa} onChange={setExpensesPaisa} />
        </div>}
        <div className="kv"><span className="k">مال کی قیمت</span><span className="v num">{formatPKR(goods)}</span>
          <span className="k">کل قابلِ ادائیگی</span><span className="v num">{formatPKR(total)}</span>
          <span className="k">بقایا</span><span className="v num">{formatPKR(due)}</span></div>
      </div>
      <div className="card"><h2>ادائیگی</h2><div className="grid g2">
        <SelectField label="اکاؤنٹ" value={payAccount} onChange={setPayAccount} options={accOptions} />
        <MoneyField label="ابھی ادا" paisa={paid} onChange={setPaid} />
      </div>
        {err && <div className="err" role="alert"><Mark kind="warn" /> {err}</div>}
        <div className="btn-row"><Button onClick={submit} loading={busy}>محفوظ کریں اور پوسٹ کریں</Button>
          <Button variant="ghost" onClick={() => nav(-1)}>منسوخ</Button></div>
      </div>
    </div> : <div className="card"><h2><Mark kind="check-circle" /> پوسٹ ہو گیا</h2>
      <p>نمبر: <strong className="num">{result.number}</strong> {result.provisional && <Chip tone="warning">PROVISIONAL</Chip>}</p>
      {result.arithmetic && <pre>{result.arithmetic.join('\n')}</pre>}
      {kind === 'sale' && result.margin_paisa !== undefined && <p>مارجن: <span className="num">{formatPKR(result.margin_paisa)}</span></p>}
      {snapshot && <PrintActions snapshot={snapshot} />}
      <Button variant="ghost" onClick={() => setResult(null)}>نیا اندراج</Button></div>}
  </div>;
}

// ------------------------------- Generic vouchers ----------------------------
export function SimpleForm({ config }: { config: any }) {
  const { t, online, enqueue, toast, can } = useApp();
  const nav = useNavigate();
  const [values, setValues] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = { date: TODAY(), allocate: 'AUTO', payee_type: 'SUPPLIER',
      opening_direction: 'RECEIVABLE', type: 'CUSTOMER', status: 'ACTIVE' };
    for (const f of config.fields) if (f.type === 'money' || f.type === 'qty') init[f.name] = 0;
    return init;
  });
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [result, setResult] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<DocumentSnapshot | null>(null);
  const parties = useGet<any[]>('parties-ref', '/api/v1/parties?limit=100');
  const categories = useGet<any[]>('expense-categories', '/api/v1/expense-categories');
  const set = (name: string, v: any) => setValues((s) => ({ ...s, [name]: v }));
  const offlineType = config.endpoint.includes('receipts') ? 'RECEIPT' : config.endpoint.includes('payments') ? 'PAYMENT'
    : config.endpoint.includes('expenses') ? 'EXPENSE' : config.endpoint.includes('parties') ? 'PARTY' : null;

  const submit = async () => {
    setErr(''); setBusy(true);
    for (const f of config.fields) if (f.required && !values[f.name] && values[f.name] !== false) {
      setErr(`${f.label} درکار ہے`); setBusy(false); return;
    }
    try {
      if (!online && offlineType) {
        const op = await enqueue(offlineType as any, values);
        setResult({ number: `D${op.device_id}-${op.id.slice(0, 6)}`, provisional: true });
      } else {
        const r = await api<any>(config.endpoint, { method: 'POST', body: values });
        setResult(r); toast('محفوظ ہو گیا');
        if (r.number) {
          try {
            const docs = await api<any[]>(`/api/v1/documents?q=${encodeURIComponent(r.number)}&from=${values.date}&to=${values.date}`);
            const d = docs.find((x: any) => x.number === r.number);
            if (d) setSnapshot((await api<any>(`/api/v1/documents/${d.id}`)).snapshot);
          } catch { /* no snapshot */ }
        }
      }
    } catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
  };
  const perm = config.endpoint.includes('parties') ? 'parties.write' : config.endpoint.includes('employees') ? 'employees.write'
    : config.endpoint.includes('expenses') ? 'expenses.post' : config.endpoint.includes('receipts') ? 'receipts.post'
    : config.endpoint.includes('payments') ? 'payments.post' : 'accounts.write';
  if (!can(perm)) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;

  return <div><h1>{config.title}</h1>
    {!result ? <div className="card" style={{ maxWidth: 720 }}>
      {config.fields.map((f: any) => {
        const v = values[f.name];
        if (f.type === 'money') return <MoneyField key={f.name} label={f.label} paisa={v ?? 0} onChange={(x) => set(f.name, x)} required={f.required} helper={f.helper} />;
        if (f.type === 'qty') return <QtyField key={f.name} label={f.label} milli={v ?? 0} onChange={(x) => set(f.name, x)} required={f.required} />;
        if (f.type === 'date') return <TextField key={f.name} label={f.label} value={v ?? TODAY()} onChange={(x) => set(f.name, x)} type="date" required={f.required} />;
        if (f.type === 'textarea') return <Field key={f.name} label={f.label}><textarea className="input" aria-label={f.label} value={v ?? ''} onChange={(e) => set(f.name, e.target.value)} /></Field>;
        if (f.type === 'select') return <SelectField key={f.name} label={f.label} value={v ?? f.options[0].value} onChange={(x) => set(f.name, x)} options={f.options} required={f.required} />;
        if (f.type === 'account') return <SelectField key={f.name} label={f.label} value={v ?? 'acct-cash'} onChange={(x) => set(f.name, x)} options={accOptions} required={f.required} />;
        if (f.type === 'party') return <Combobox key={f.name} label={f.label} value={v ?? ''} onChange={(x) => set(f.name, x)}
          options={(parties.data ?? []).map((p: any) => ({ value: p.id, label: p.name_ur, sub: p.phone }))}
          placeholder="فریق تلاش کریں" required={f.required} />;
        if (f.type === 'expenseCategory') return <SelectField key={f.name} label={f.label} value={v ?? 'OTHER'} onChange={(x) => set(f.name, x)}
          options={(categories.data ?? []).map((c: any) => ({ value: c.code, label: c.name_ur }))} required={f.required} />;
        return <TextField key={f.name} label={f.label} value={v ?? ''} onChange={(x) => set(f.name, x)} required={f.required} helper={f.helper} />;
      })}
      {!online && offlineType && <Chip tone="warning">آف لائن — قطار میں محفوظ ہوگا</Chip>}
      {err && <div className="err" role="alert"><Mark kind="warn" /> {err}</div>}
      <div className="btn-row"><Button onClick={submit} loading={busy}>محفوظ کریں</Button>
        <Button variant="ghost" onClick={() => nav(config.back ?? -1)}>منسوخ</Button></div>
    </div> : <div className="card"><h2><Mark kind="check-circle" /> محفوظ</h2>
      {result.number && <p>نمبر: <strong className="num">{result.number}</strong> {result.provisional && <Chip tone="warning">PROVISIONAL</Chip>}</p>}
      {snapshot && <PrintActions snapshot={snapshot} />}
      <div className="btn-row"><Button variant="ghost" onClick={() => setResult(null)}>نیا</Button>
        <Link className="btn btn-secondary" to={config.back ?? '/erp'}>واپس</Link></div></div>}
  </div>;
}
