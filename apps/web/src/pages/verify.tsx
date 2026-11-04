/**
 * PUB-10 — public invoice verification. A customer (or a shopkeeper) scans the QR printed on an
 * A4 / 80 mm invoice and lands here. It reads `/api/v1/public/invoice/:id`, which is a strict
 * whitelist: no cost, margin, stock, supplier or party phone/address/CNIC ever reaches this page.
 * Four honest states — loading / success / not-found / empty — and nothing is editable.
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatPKR } from '@zt/shared';
import { useGet, ZtError } from '../api.js';
import { useApp } from '../app-state.js';
import { Chip, Skeleton } from '../components.js';
import { SectionHead, Eyebrow } from '../ui/cards.js';

const LONG_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function InvoiceVerify() {
  const { id = '' } = useParams();
  const { t, lang, bi } = useApp();
  const valid = LONG_ID.test(id);
  const { data, isLoading, error, refetch } = useGet<any>(
    `public-invoice-${id}`,
    valid ? `/api/v1/public/invoice/${encodeURIComponent(id)}` : null,
  );

  const shell = (children: React.ReactNode) => (
    <div className="pub-container pub-with-nav verify-wrap" dir={lang === 'ur' ? 'rtl' : 'ltr'}>
      <SectionHead kicker={<Eyebrow>{t('verifyInvoice')}</Eyebrow>} title={t('verifyInvoice')} />
      {children}
      <div className="btn-row center" style={{ justifyContent: 'center', marginBlockStart: 16 }}>
        <Link className="btn btn-primary" to="/">{t('home')}</Link>
        <Link className="btn btn-secondary" to="/products">{t('viewProducts')}</Link>
      </div>
      <p className="small center verify-trust">{t('verifyTrustNote')}</p>
    </div>
  );

  // --- empty: no / malformed code in the URL -------------------------------------------------
  if (!valid) {
    return shell(
      <div className="card verify-card verify-empty" role="status">
        <span className="verify-mark" aria-hidden="true">?</span>
        <h2>{t('verifyInvalid')}</h2>
        <p className="small">{lang === 'ur'
          ? 'QR کوڈ دوبارہ اسکین کریں یا تصدیقی کوڈ کے ساتھ صفحہ کھولیں۔'
          : 'Scan the QR code again, or open the page with its verification code.'}</p>
      </div>,
    );
  }

  // --- loading: a skeleton card, shape-stable so there is no layout jump ---------------------
  if (isLoading) {
    return shell(
      <div className="card verify-card" aria-busy="true" aria-live="polite">
        <p className="small">{t('loadingState')}</p>
        <Skeleton rows={4} />
      </div>,
    );
  }

  // --- error: 404 is a real answer (no such invoice), anything else is a load failure ---------
  if (error || !data) {
    const notFound = error instanceof ZtError && error.status === 404;
    return shell(
      <div className={`card verify-card ${notFound ? 'verify-empty' : 'verify-error'}`} role="alert">
        <span className="verify-mark" aria-hidden="true">{notFound ? '✕' : '!'}</span>
        <h2>{notFound ? t('invoiceNotFound') : t('loadError')}</h2>
        {!notFound && <button type="button" className="btn btn-secondary btn-sm" onClick={() => refetch()}>{t('retry')}</button>}
      </div>,
    );
  }

  // --- success: read-only verification card ---------------------------------------------------
  const business = bi(data.business_name_ur, data.business_name_en) || t('appName');
  const lines: any[] = Array.isArray(data.lines) ? data.lines : [];
  const issued = typeof data.issued_at === 'string' ? data.issued_at.slice(0, 16).replace('T', ' ') : '';
  return shell(
    <div className="card verify-card verify-ok">
      <div className="verify-head">
        <div className="verify-badge" aria-hidden="true">✓</div>
        <div>
          <h2>{t('invoiceFound')}</h2>
          <p className="small">{t('verifiedNotice')}</p>
        </div>
        <Chip tone="success">{t('verified')}</Chip>
      </div>

      <div className="kv verify-kv">
        <div><span className="k">{t('reference')}</span><span className="v num">{data.number}</span></div>
        <div><span className="k">{t('date')}</span><span className="v num">{data.date}</span></div>
        <div><span className="k">{t('party')}</span><span className="v">{data.party_name || '—'}</span></div>
        {data.book_code && <div><span className="k">{t('stock')}</span><span className="v num">{data.book_code}</span></div>}
      </div>

      <table className="verify-table">
        <thead><tr><th>{t('description')}</th><th>{t('qty')}</th><th>{t('rate')}</th><th>{t('amount')}</th></tr></thead>
        <tbody>
          {lines.length
            ? lines.map((l, i) => <tr key={i}>
              <td>{l.label}</td>
              <td className="num">{l.qty}</td>
              <td className="num">{l.rate}</td>
              <td className="num">{l.amount_paisa != null ? formatPKR(l.amount_paisa) : '—'}</td>
            </tr>)
            : <tr><td colSpan={4} className="small">{data.title_ur || t('emptyProducts')}</td></tr>}
        </tbody>
        <tfoot>
          <tr><td colSpan={3}>{t('total')}</td><td className="num">{formatPKR(data.total_paisa ?? data.amount_paisa ?? 0)}</td></tr>
          {data.paid_paisa != null && <tr><td colSpan={3}>{t('paid')}</td><td className="num">{formatPKR(data.paid_paisa)}</td></tr>}
          {data.due_paisa != null && <tr><td colSpan={3}>{t('due')}</td><td className="num">{formatPKR(data.due_paisa)}</td></tr>}
        </tfoot>
      </table>

      <div className="verify-foot small">
        <span>{business}{data.business_location ? ` — ${data.business_location}` : ''}</span>
        {data.payment_method && <span>{data.payment_method}</span>}
      </div>
      <p className="small verify-code num">
        {t('verificationCode')}: <code>{data.id}</code>
        {issued && <> · {t('issuedAt')} <span className="num">{issued}</span></>}
      </p>
    </div>,
  );
}
