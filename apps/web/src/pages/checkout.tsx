/**
 * PUB-08 — checkout. The cart becomes a real order only after an admin approves it, so this page
 * never claims a sale: it POSTs /api/v1/public/checkout (server-priced), then hands the customer a
 * one-time token for uploading a payment proof. Prices are never read from the client.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useGet } from '../api.js';
import { useApp } from '../app-state.js';
import { formatPKR } from '@zt/shared';
import { clearCart, removeLine, setQty, useCart, type CartLine } from '../cart.js';
import { Button, CheckField, Chip, TextField } from '../components.js';
import { Eyebrow, SectionHead, TiltCard } from '../ui/cards.js';
import { Monogram } from '../ui/icons.js';
import { shrinkImage } from '../image-input.js';
import { waLink } from './products.js';

const QTY_STEPS = [500, 1000, 2000, 5000, 10000, 25000, 50000];
const TOKEN_KEY = 'zt_order_tokens_v1';
const KIND_UR: Record<string, string> = {
  BANK: 'بینک اکاؤنٹ', EASYPAISA: 'ایزی پیسہ', JAZZCASH: 'جازی کیش', WALLET: 'والٹ', CASH: 'کیش / دکان پر',
};

type Saved = Record<string, string>;
function savedTokens(): Saved {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? '{}'); } catch { return {}; }
}
function rememberToken(number: string, token: string) {
  const all = savedTokens();
  all[number] = token;
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

const STEP_META = [
  { id: 'cart', ur: 'سامان', en: 'Items' },
  { id: 'pay', ur: 'ادائیگی', en: 'Payment' },
  { id: 'proof', ur: 'رسید', en: 'Proof' },
];

function StepRail({ step }: { step: number }) {
  const { lang } = useApp();
  return <ol className="ck-rail" aria-label="Checkout steps">
    {STEP_META.map((s, i) => <li key={s.id} className={`ck-rail-item${i === step ? ' is-now' : ''}${i < step ? ' is-done' : ''}`}
      aria-current={i === step ? 'step' : undefined}>
      <span className="ck-rail-dot num" aria-hidden="true">{i < step ? '✓' : i + 1}</span>
      <span className="ck-rail-label">{lang === 'ur' ? s.ur : s.en}</span>
    </li>)}
  </ol>;
}

/** 3D product card — the same tilt language as the catalogue, but editable. */
function CheckoutCard({ line, onChange, onRemove }: { line: CartLine; onChange: (q: number) => void; onRemove: () => void }) {
  const { t, lang } = useApp();
  const name = lang === 'ur' ? line.name_ur : (line.name_en || line.name_ur);
  return <TiltCard className="ck-card" tone={line.price_paisa == null ? 'pink' : 'default'}>
    <div className="ck-card-media">
      {line.img ? <img src={line.img} alt={line.alt ?? name} loading="lazy" decoding="async" width={220} height={220} />
        : <span className="thumb-mono"><Monogram text={line.name_ur} /></span>}
    </div>
    <div className="ck-card-body">
      <div className="ck-card-name">{name}</div>
      <div className="ck-card-rate num">
        {line.price_paisa != null ? `${formatPKR(line.price_paisa)} / ${line.unit}` : t('contactForPrice')}
      </div>
      <div className="ck-card-row">
        <select className="select select-sm" aria-label={`${t('qty')} ${name}`} value={line.qty_milli}
          onChange={(e) => onChange(Number(e.target.value))}>
          {QTY_STEPS.map((m) => <option key={m} value={m}>{m / 1000} {line.unit}</option>)}
        </select>
        <span className="ck-card-total num">
          {line.price_paisa != null ? formatPKR(Math.round((line.price_paisa * line.qty_milli) / 1000)) : '—'}
        </span>
      </div>
      <button type="button" className="ck-card-remove" onClick={onRemove}>{t('removeItem')}</button>
    </div>
  </TiltCard>;
}

function MethodCard({ m, active, onSelect }: { m: any; active: boolean; onSelect: () => void }) {
  const { t } = useApp();
  return <button type="button" className={`ck-method${active ? ' ck-method-on' : ''}`}
    aria-pressed={active} onClick={onSelect}>
    <span className="ck-method-mark" data-kind={m.kind} aria-hidden="true" />
    <span className="ck-method-text">
      <strong>{m.title_ur}</strong>
      <small>{KIND_UR[m.kind] ?? m.kind}{m.bank_name ? ` — ${m.bank_name}` : ''}</small>
      {!!m.iban && <small className="num">{m.iban}</small>}
      {!!m.mobile_number && <small className="num">{m.mobile_number}</small>}
    </span>
    {active && <span className="ck-method-check" aria-hidden="true" />}
  </button>;
}

function MethodDetails({ m }: { m: any }) {
  const { t } = useApp();
  if (!m) return null;
  return <div className="ck-method-panel">
    {m.qr_url && <div className="ck-qr"><img src={m.qr_url} alt={`${m.title_ur} QR`} loading="lazy" decoding="async" width={220} height={220} /></div>}
    <div className="ck-method-info">
      <h3>{m.title_ur}</h3>
      {!!m.account_title && <p><span>{t('account')}:</span> <strong>{m.account_title}</strong></p>}
      {!!m.bank_name && <p><span>{KIND_UR.BANK}:</span> <strong>{m.bank_name}</strong></p>}
      {!!m.account_number && <p><span>{t('reference')}:</span> <strong className="num">{m.account_number}</strong></p>}
      {!!m.iban && <p><span>IBAN:</span> <strong className="num">{m.iban}</strong></p>}
      {!!m.mobile_number && <p><span>{t('mobile')}:</span> <strong className="num">{m.mobile_number}</strong></p>}
      {!!m.instructions_ur && <p className="ck-instructions">{m.instructions_ur}</p>}
    </div>
  </div>;
}

const STATUS_TONE: Record<string, string> = {
  NEW: 'gray', UNDER_REVIEW: 'info', APPROVED: 'success', REJECTED: 'err', CANCELLED: 'gray',
};
const STATUS_UR: Record<string, string> = {
  NEW: 'نیا — رسید کا انتظار', UNDER_REVIEW: 'جائزہ جاری ہے', APPROVED: 'منظور شدہ', REJECTED: 'مسترد', CANCELLED: 'منسوخ',
};

function ProofDrop({ order, onDone }: { order: { number: string; token: string; total_paisa: number; method: string }; onDone: () => void }) {
  const { t, toast, lang } = useApp();
  const started = useRef(Date.now());
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [trx, setTrx] = useState(''), [amount, setAmount] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');

  const pick = async (file?: File) => {
    setErr(''); setPreview(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('صرف تصویر کی فائل'); return; }
    try {
      const shrunk = await shrinkImage(file, 1100);
      setPreview(shrunk.data_url);
    } catch { setErr('تصویر تیار نہیں ہو سکی'); }
  };

  const upload = async () => {
    if (!preview) return;
    setBusy(true); setErr('');
    try {
      const paisa = Math.round((Number(amount.replace(/[^\d.]/g, '')) || 0) * 100);
      await api('/api/v1/public/order/proof', {
        method: 'POST',
        body: {
          token: order.token, method: order.method, sender_reference: trx,
          amount_paisa: paisa > 0 ? paisa : order.total_paisa,
          data_url: preview, honeypot: '', elapsed_ms: Date.now() - started.current,
        },
      });
      toast(t('success'));
      setPreview(null); setTrx(''); setAmount('');
      onDone();
    } catch (e: any) { setErr(e.message_ur ?? t('error')); }
    finally { setBusy(false); }
  };

  return <div className="ck-proof">
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" id="ck-proof-file"
        onChange={(e) => pick(e.target.files?.[0])} />
      <Button variant="secondary" onClick={() => fileRef.current?.click()}>{t('choosePhoto')}</Button>
      {preview && <Chip tone="gray">{t('paymentProof')}</Chip>}
    </div>
    {preview && <div className="ck-proof-preview"><img src={preview} alt={t('paymentProof')} /></div>}
    <TextField label={t('senderReference')} value={trx} onChange={setTrx} placeholder="TRX / TT ID" inputMode="text" />
    <div className="field"><label htmlFor="ck-amt">{t('amount')} (Rs)</label>
      <input id="ck-amt" className="input num" type="text" inputMode="decimal" value={amount}
        placeholder={(order.total_paisa / 100).toFixed(0)} onChange={(e) => setAmount(e.target.value)} />
      <span className="small">{lang === 'ur' ? 'خالی چھوڑیں تو مکمل رقم درج ہوگی' : 'Leave blank to send the full order total'}</span></div>
    {err && <div className="err" role="alert">{err}</div>}
    <Button onClick={upload} loading={busy} disabled={!preview}>{t('uploadProof')}</Button>
  </div>;
}

function OrderStatus({ number, token, onChange }: { number: string; token: string; onChange: () => void }) {
  const { t, lang } = useApp();
  const { data } = useGet<any>(`public-order-${number}-${token}`, `/api/v1/public/order/${encodeURIComponent(number)}?token=${encodeURIComponent(token)}`);
  if (!data) return <p className="small">{t('loadingState')}</p>;
  const st = String(data.status ?? 'NEW');
  return <div className="ck-status">
    <div className="ck-status-head">
      <div>
        <h3 className="num">{data.number}</h3>
        <p className="small">{data.customer_name} · {data.city}</p>
      </div>
      <Chip tone={STATUS_TONE[st] ?? 'gray'}>{lang === 'ur' ? (STATUS_UR[st] ?? st) : st}</Chip>
    </div>
    <div className="ck-status-line"><span>{t('cartTotal')}</span><strong className="num">{formatPKR(data.total_paisa ?? 0)}</strong></div>
    {!!data.payment_method && <div className="ck-status-line"><span>{t('paymentMethod')}</span><strong>{data.payment_method}</strong></div>}
    {!!data.reject_reason && <div className="err" role="alert">{data.reject_reason}</div>}
    {!!(data.proofs?.length) && <ul className="ck-proofs">
      {data.proofs.map((p: any) => <li key={p.id}>
        {p.url && <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={t('paymentProof')} loading="lazy" width={72} height={72} /></a>}
        <span>
          <strong className="num">{formatPKR(p.amount_paisa)}</strong>
          <small>{p.method || t('paymentProof')} · {p.status}</small>
        </span>
      </li>)}
    </ul>}
    {['NEW', 'UNDER_REVIEW'].includes(st) && <button type="button" className="btn btn-ghost btn-sm" onClick={onChange}>{t('uploadProof')}</button>}
    <p className="small">{t('cartNote')}</p>
  </div>;
}

export function Checkout() {
  const { t, toast, lang } = useApp();
  const started = useRef(Date.now());
  const { lines, setLines, total } = useCart();
  const home = useGet<any>('public-home', '/api/v1/public/home');
  const b = home.data?.business;
  const methodsQ = useGet<any[]>('public-payment-methods', '/api/v1/public/payment-methods');
  const methods = useMemo(() => methodsQ.data ?? [], [methodsQ.data]);

  const [name, setName] = useState(''), [mobile, setMobile] = useState(''), [city, setCity] = useState('');
  const [address, setAddress] = useState(''), [notes, setNotes] = useState(''), [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [methodId, setMethodId] = useState('');
  const [busy, setBusy] = useState(false), [errors, setErrors] = useState<Record<string, string>>({});
  const [placed, setPlaced] = useState<{ number: string; token: string; total_paisa: number; method: string } | null>(null);
  const [lookup, setLookup] = useState<{ number: string; token: string } | null>(null);

  const pricedLines = lines.filter((l) => l.price_paisa != null);
  const unpriced = lines.filter((l) => l.price_paisa == null);
  const method = methods.find((m) => m.id === methodId);
  const step = placed ? 2 : (lines.length ? (methodId ? 1 : 0) : 0);

  useEffect(() => {
    if (!methodId && methods.length) setMethodId(methods[0].id);
  }, [methods, methodId]);

  // Returning customers: the token was shown once, so it lives only in this device's storage.
  const submit = async () => {
    setBusy(true); setErrors({});
    try {
      const r = await api<any>('/api/v1/public/checkout', {
        method: 'POST',
        body: {
          customer_name: name, mobile, city, address, notes,
          payment_method_id: methodId, consent, honeypot,
          elapsed_ms: Date.now() - started.current,
          items: pricedLines.map((l) => ({ product_id: l.product_id, qty_milli: l.qty_milli })),
        },
      });
      rememberToken(r.reference, r.token);
      clearCart(); setLines([]);
      setPlaced({ number: r.reference, token: r.token, total_paisa: r.total_paisa, method: method?.title_ur ?? '' });
      toast(t('orderPlaced'));
    } catch (e: any) {
      setErrors(e.field_errors ?? { _: e.message_ur ?? t('error') });
      toast(e.message_ur ?? t('error'), 'err');
    } finally { setBusy(false); }
  };

  if (placed) return <div className="pub-container pub-with-nav ck-wrap">
    <SectionHead kicker={<Eyebrow>{t('checkout')}</Eyebrow>} title={t('orderPlaced')}
      action={<Chip tone="gray" className="num">{placed.number}</Chip>} />
    <StepRail step={2} />
    <div className="ck-panel card">
      <h2 style={{ fontSize: 18 }}>{t('paymentProof')}</h2>
      <p className="small">{lang === 'ur'
        ? 'اپنے منتخب کردہ طریقے پر رقم بھیجیں، پھر رسید کی تصویر اپ لوڈ کریں۔ مالک منظوری کے بعد سامان کٹتا ہے اور انوائز بنتا ہے۔'
        : 'Send the amount using your chosen method, then upload a photo of the receipt. Stock and the invoice are only created after the owner approves.'}</p>
      <div className="ck-token">
        <label htmlFor="ck-tok">{t('token')}</label>
        <input id="ck-tok" className="input num" readOnly value={placed.token} onFocus={(e) => e.target.select()} />
        <p className="small">{t('orderTokenNotice')}</p>
      </div>
      <MethodDetails m={method} />
      <ProofDrop order={placed} onDone={() => setLookup({ number: placed.number, token: placed.token })} />
    </div>
    <div className="ck-panel card">
      <OrderStatus number={placed.number} token={placed.token} onChange={() => { /* proof stays on screen */ }} />
    </div>
    <div className="btn-row center" style={{ justifyContent: 'center', marginBlockStart: 16 }}>
      <Link className="btn btn-secondary" to="/products">{t('viewProducts')}</Link>
      <Link className="btn btn-primary" to="/">{t('home')}</Link>
    </div>
  </div>;

  return <div className="pub-container pub-with-nav ck-wrap">
    <SectionHead kicker={<Eyebrow>{t('checkout')}</Eyebrow>} title={t('checkout')}
      action={<Chip tone="gray">{lines.length} {t('items')}</Chip>} />
    <StepRail step={step} />

    {!lines.length
      ? <div className="card ck-panel center">
        <p>{t('cartEmpty')}</p>
        <div className="btn-row center" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-secondary" to="/products">{t('viewProducts')}</Link>
          <Link className="btn btn-primary" to="/enquiry">{t('sendEnquiry')}</Link>
        </div>
      </div>
      : <>
        <div className="ck-grid">
          <div className="ck-cards">{lines.map((l) => <CheckoutCard key={l.product_id} line={l}
            onChange={(q) => setLines(setQty(l.product_id, q))} onRemove={() => setLines(removeLine(l.product_id))} />)}
            {!!unpriced.length && <p className="small ck-warn">
              {lang === 'ur'
                ? `${unpriced.length} چیز کی قیمت فون پر ہے — وہ آن لائن آرڈر میں شامل نہیں ہوگی، ان کے لیے پوچھ گچھ یا واٹس ایپ استعمال کریں۔`
                : `${unpriced.length} item(s) are price-on-call and are left out of the online order — use enquiry or WhatsApp for them.`}
              {' '}<a className="btn btn-wa btn-sm" target="_blank" rel="noreferrer"
                href={waLink(b?.whatsapp1, `السلام علیکم، ${unpriced.map((l) => l.name_ur).join(', ')} کے بارے میں معلومات چاہئیں۔`)}
                style={{ display: 'inline-block', marginInlineStart: 8 }}>{t('askWhatsapp')}</a>
            </p>}
          </div>
          <aside className="card ck-summary">
            <h2 style={{ fontSize: 18 }}>{t('cartTotal')}</h2>
            <div className="ck-status-line"><span>{t('items')}</span><strong className="num">{pricedLines.length}</strong></div>
            <div className="ck-status-line ck-grand"><span>{t('total')}</span><strong className="num">{total.priced ? formatPKR(total.paisa) : '—'}</strong></div>
            <p className="small">{lang === 'ur' ? 'قیمتیں کیٹلاگ سے لگتی ہیں؛ منظوری کے بعد اصل انوائز بنتا ہے۔' : 'The shop prices every line from the catalogue; approval is what creates the invoice.'}</p>
          </aside>
        </div>

        <div className="card ck-panel">
          <h2 style={{ fontSize: 18 }}>{t('paymentMethod')}</h2>
          {!methods.length
            ? <p className="small">{methodsQ.isLoading ? t('loadingState') : t('checkoutNeeds')}</p>
            : <div className="ck-methods">{methods.map((m) => <MethodCard key={m.id} m={m} active={m.id === methodId} onSelect={() => setMethodId(m.id)} />)}</div>}
          <MethodDetails m={method} />
        </div>

        <div className="card ck-panel">
          <h2 style={{ fontSize: 18 }}>{t('details')}</h2>
          <div className="ck-form">
            <TextField label={t('name')} value={name} onChange={setName} required error={errors.customer_name} autoComplete="name" />
            <TextField label={t('mobile')} value={mobile} onChange={setMobile} placeholder="03XX-XXXXXXX" required
              error={errors.mobile} inputMode="tel" autoComplete="tel" />
            <TextField label={t('city')} value={city} onChange={setCity} required error={errors.city} autoComplete="address-level2" />
            <TextField label={t('address')} value={address} onChange={setAddress} error={errors.address} autoComplete="street-address" />
            <div className="field"><label htmlFor="ck-notes">{t('note')}</label>
              <textarea id="ck-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></div>
          </div>
          <div className="sr-only" aria-hidden="true"><label htmlFor="ck-hp">خالی چھوڑیں
            <input id="ck-hp" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" /></label></div>
          <CheckField label={<span>{t('consent')} — {t('privacyNotice')}</span>} checked={consent} onChange={setConsent} />
          {errors._ && <div className="err" role="alert">{errors._}</div>}
          <Button onClick={submit} loading={busy}
            disabled={!consent || !name || !mobile || !city || !methodId || !pricedLines.length}>{t('placeOrder')}</Button>
          <p className="small">{t('cartNote')}</p>
        </div>
      </>}

    <div className="card ck-panel">
      <h2 style={{ fontSize: 18 }}>{t('checkOrder')}</h2>
      <div className="ck-form">
        <TextField label={t('reference')} value={lookup?.number ?? ''} onChange={(v) => setLookup({ number: v, token: lookup?.token ?? savedTokens()[v] ?? '' })}
          placeholder="OD-2026-000001" />
        <TextField label={t('token')} value={lookup?.token ?? ''} onChange={(v) => setLookup({ number: lookup?.number ?? '', token: v })} />
      </div>
      {lookup?.number && lookup.token
        ? <OrderStatus number={lookup.number} token={lookup.token} onChange={() => setPlaced({ number: lookup.number, token: lookup.token, total_paisa: 0, method: method?.title_ur ?? '' })} />
        : lookup?.number
          ? <OrderStatusLite number={lookup.number} />
          : <p className="small">{lang === 'ur' ? 'آرڈر نمبر اور ٹوکن دونوں درج کریں۔' : 'Enter both the order number and the token you were shown.'}</p>}
    </div>
  </div>;
}

/** Status without a token: the shop deliberately reveals only where the order stands. */
function OrderStatusLite({ number }: { number: string }) {
  const { t, lang } = useApp();
  const { data } = useGet<any>(`public-order-${number}`, `/api/v1/public/order/${encodeURIComponent(number)}`);
  if (!data) return <p className="small">{t('loadingState')}</p>;
  const st = String(data.status ?? 'NEW');
  return <div className="ck-status">
    <div className="ck-status-head">
      <h3 className="num">{data.number}</h3>
      <Chip tone={STATUS_TONE[st] ?? 'gray'}>{lang === 'ur' ? (STATUS_UR[st] ?? st) : st}</Chip>
    </div>
    <div className="ck-status-line"><span>{t('cartTotal')}</span><strong className="num">{formatPKR(data.total_paisa ?? 0)}</strong></div>
    {!!data.payment_method && <div className="ck-status-line"><span>{t('paymentMethod')}</span><strong>{data.payment_method}</strong></div>}
    {!!data.reject_reason && <div className="err" role="alert">{data.reject_reason}</div>}
    <p className="small">{lang === 'ur' ? 'رسید دیکھنے کے لیے اپ لوڈ والا ٹوکن درکار ہے۔' : 'The upload token is required to see receipts.'}</p>
  </div>;
}
