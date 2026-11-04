/** PUB-06/07 — cart review + enquiry form. Posts to the existing /api/v1/public/enquiry only. */
import React, { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, useGet } from '../api.js';
import { useApp } from '../app-state.js';
import { Button, CheckField, TextField, Chip } from '../components.js';
import { formatPKR, BUSINESS_PROFILE } from '@zt/shared';
import { addLine, clearCart, enquiryItems, removeLine, setQty, useCart } from '../cart.js';
import { SectionHead, Eyebrow } from '../ui/cards.js';
import { Monogram } from '../ui/icons.js';
import { waLink } from './products.js';

const QTY_STEPS = [500, 1000, 2000, 5000, 10000, 25000, 50000];

export function Enquiry() {
  const { t, toast } = useApp();
  const loc = useLocation();
  const started = useRef(Date.now());
  const { lines, setLines, total } = useCart();
  const home = useGet<any>('public-home', '/api/v1/public/home');
  const b = home.data?.business;
  const [name, setName] = useState(''), [mobile, setMobile] = useState(''), [city, setCity] = useState('');
  const [message, setMessage] = useState(''), [consent, setConsent] = useState(false), [honeypot, setHoneypot] = useState('');
  const [busy, setBusy] = useState(false), [ref, setRef] = useState(''), [errors, setErrors] = useState<Record<string, string>>({});

  // A product page can hand items over directly (state.items) — merge them into the saved cart.
  React.useEffect(() => {
    const incoming = (loc.state as any)?.items;
    if (Array.isArray(incoming) && incoming.length) for (const i of incoming) addLine(i as any);
  }, []);

  const submit = async () => {
    setBusy(true); setErrors({});
    try {
      const r = await api<any>('/api/v1/public/enquiry', {
        method: 'POST',
        body: {
          customer_name: name, mobile, city, message, consent, honeypot,
          // the API rejects elapsed_ms < 1200 (TIME_TRAP); the form is never that fast.
          elapsed_ms: Date.now() - started.current, items: enquiryItems(lines),
        },
      });
      setRef(r.reference); clearCart(); setLines([]);
      toast('پیغام بھیج دیا گیا');
    } catch (e: any) {
      setErrors(e.field_errors ?? { _: e.message_ur });
      toast(e.message_ur ?? 'خرابی', 'err');
    } finally { setBusy(false); }
  };

  if (ref) return <div className="pub-container pub-with-nav">
    <div className="card center" style={{ padding: 48 }}>
      <h2>{'ہم جلد رابطہ کریں گے'}</h2>
      <p>{t('reference')}: <strong className="num">{ref}</strong></p>
      <p className="small">{t('cartNote')}</p>
      <div className="btn-row center" style={{ justifyContent: 'center' }}>
        <Link className="btn btn-primary" to="/">{t('home')}</Link>
        <Link className="btn btn-secondary" to="/products">{t('viewProducts')}</Link>
      </div>
    </div>
  </div>;

  return <div className="pub-container pub-with-nav enquiry-layout">
    <SectionHead kicker={<Eyebrow>{t('enquiry')}</Eyebrow>} title={t('enquiry')}
      action={<Chip tone="gray">{lines.length} {t('items')}</Chip>} />
    <div className="enquiry-grid">
      <section className="card">
        <h2 style={{ fontSize: 18 }}>{t('cart')}</h2>
        {!lines.length
          ? <div className="cart-empty">
            <p>{t('cartEmpty')}</p>
            <Link className="btn btn-secondary btn-sm" to="/products">{t('viewProducts')}</Link>
          </div>
          : <div className="cart-lines">{lines.map((l) => <div className="cart-line" key={l.product_id}>
            {l.img ? <img src={l.img} alt={l.alt ?? l.name_ur} loading="lazy" width={56} height={56} />
              : <span className="thumb-mono"><Monogram text={l.name_ur} /></span>}
            <div>
              <div className="cart-name">{l.name_ur}</div>
              <div className="cart-meta">{l.qty_milli / 1000} {l.unit} · {l.price_paisa != null ? formatPKR(l.price_paisa) : t('contactForPrice')}</div>
              <div className="row qty-row">
                <select className="select select-sm" aria-label={`${t('qty')} ${l.name_ur}`}
                  value={l.qty_milli} onChange={(e) => setLines(setQty(l.product_id, Number(e.target.value)))}>
                  {QTY_STEPS.map((m) => <option key={m} value={m}>{m / 1000} {l.unit}</option>)}
                </select>
                <button type="button" className="cart-remove" onClick={() => setLines(removeLine(l.product_id))}>{t('removeItem')}</button>
              </div>
            </div>
            <div className="num">{l.price_paisa != null
              ? formatPKR(Math.round((l.price_paisa * l.qty_milli) / 1000)) : '—'}</div>
          </div>)}</div>}
        {lines.length > 0 && <div className="cart-total">
          <span>{t('cartTotal')}</span>
          <span className="num">{total.priced ? formatPKR(total.paisa) : t('contactForPrice')}</span>
        </div>}
        {total.unpriced > 0 && <p className="small">{t('cartNote')}</p>}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 18 }}>{t('sendEnquiry')}</h2>
        <TextField label={t('name')} value={name} onChange={setName} required error={errors.customer_name} autoComplete="name" />
        <TextField label={t('mobile')} value={mobile} onChange={setMobile} placeholder="03XX-XXXXXXX" required
          error={errors.mobile} inputMode="tel" autoComplete="tel" />
        <TextField label={`${t('city')} / ${t('address')}`} value={city} onChange={setCity} required error={errors.city} autoComplete="address-level2" />
        <div className="field"><label htmlFor="enq-msg">{t('message')}</label>
          <textarea id="enq-msg" className="input" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} /></div>
        <div className="sr-only" aria-hidden="true"><label htmlFor="enq-hp">خالی چھوڑیں
          <input id="enq-hp" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" /></label></div>
        <CheckField label={<span>{t('consent')} — {t('privacyNotice')}</span>} checked={consent} onChange={setConsent} />
        {errors._ && <div className="err" role="alert">{errors._}</div>}
        <Button onClick={submit} loading={busy} disabled={!consent || !name || !mobile || !city}>{t('send')}</Button>
        <p className="small">{t('cartNote')}</p>
        <a className="btn btn-wa btn-sm btn-block" style={{ marginBlockStart: 10 }} target="_blank" rel="noreferrer"
          href={waLink(b?.whatsapp1, `السلام علیکم، ${lines.map((l) => l.name_ur).join(', ') || 'سامان'} کے بارے میں معلومات چاہئیں۔`)}>
          {t('askWhatsapp')}</a>
      </section>
    </div>
  </div>;
}
