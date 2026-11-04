/** The three shipped print formats. Pure markup: no app state, no network, no side effects,
 *  so scripts/print-proof.tsx can render them to real HTML+CSS in a browser. */
import React from 'react';
import { formatPKR, qrDataUrl, tr, type DocumentSnapshot } from '@zt/shared';

type Snap = DocumentSnapshot;

/** Absolute origin baked into every printed QR. `renderToStaticMarkup` (the print proof) has no
 *  `window`, so the target must be a constant — and a physical receipt should verify against the
 *  production Worker. Overridable via a global so a staging symbol can be rendered in tests. */
export const VERIFY_BASE: string = (globalThis as any).__ZT_VERIFY_BASE__
  ?? 'https://zt-v2.sastishopping-store.workers.dev';

/** The scan-to-verify block. Rendered only when the snapshot carries a real server `doc_id`;
 *  a client-provisional snapshot has none, so no QR is printed (never a fabricated code). */
function VerifyQr({ docId, size = 84 }: { docId?: string; size?: number }) {
  if (!docId) return null;
  return <div className="zt-qr">
    <img src={qrDataUrl(`${VERIFY_BASE}/verify/${docId}`, { scale: 4, quiet: 4 })}
      width={size} height={size} alt="Verify this invoice" />
    <p>{tr('scanQrHint', 'ur')}</p>
  </div>;
}

/** The owner's uploaded logo when the snapshot carries one, otherwise the bundled brand mark. */
const logoSrc = (b: any) => (b.logo_r2_key
  ? `/media/${String(b.logo_r2_key).replace(/[^\w./-]/g, '')}` : '/brand/logo-96.png');

/** A4 — full premium ledger. */
function FullDoc({ s }: { s: Snap }) {
  const b = s.business;
  return <div className="print-doc print-a4" dir="rtl" lang="ur">
    <div className="p-mast">
      <div className="p-brand"><img className="p-logo" src={logoSrc(b)} alt="" width={48} height={48} />
        <div>
          <div className="p-name">{b.name_ur}</div>
          <div className="small">{b.name_en} — {b.location_ur}</div>
          <div className="small num">{b.phone1}{b.phone2 ? ` · ${b.phone2}` : ''}</div>
        </div>
      </div>
      <div className="p-mast-side">
        {b.pesticide_licence_no && <div className="p-lic">لائسنس <span className="num">{b.pesticide_licence_no}</span>
          {b.pesticide_licence_expiry && <> · میعاد <span className="num">{b.pesticide_licence_expiry}</span></>}</div>}
        <div className="p-chip"><span>نمبر</span><b className="num">{s.number}</b></div>
        <div className="p-chip"><span>تاریخ</span><b className="num">{s.date}</b></div>
        {s.book_code && <div className="p-chip"><span>کھاتہ</span><b className="num">{s.book_code}</b></div>}
      </div>
    </div>
    <div className="p-titlebar">
      <h2 className="p-title">{s.title_ur}</h2>
      {s.provisional && <span className="provisional-stamp">PROVISIONAL — عارضی</span>}
    </div>
    <div className="p-party">
      <div><strong>فریق:</strong> {s.party.name}
        {s.party.phone && <div className="small num">{s.party.phone}</div>}
        {s.party.address && <div className="small">{s.party.address}</div>}
      </div>
      {s.party.cnic_masked && <div className="small">قومی شناختی کارڈ: <span className="num">{s.party.cnic_masked}</span></div>}
    </div>
    <table>
      <thead><tr><th>#</th><th>تفصیل</th><th>تعداد</th><th>ریٹ</th><th>رقم</th></tr></thead>
      <tbody>{s.lines.map((l, i) => <tr key={i}>
        <td className="num">{i + 1}</td>
        <td>{l.label}{l.batch && <div className="small">بیچ: <span className="num">{l.batch}</span></div>}</td>
        <td className="num">{l.qty}</td>
        <td className="num">{l.rate}</td>
        <td className="num">{formatPKR(l.amount_paisa)}</td>
      </tr>)}</tbody>
      <tfoot>
        <tr><td colSpan={4}>ذیلی کل</td><td className="num">{formatPKR(s.subtotal_paisa)}</td></tr>
        {s.extras.map((x, i) => <tr key={i}><td colSpan={4}>{x.label}</td><td className="num">{formatPKR(x.amount_paisa)}</td></tr>)}
      </tfoot>
    </table>
    {s.arithmetic?.length ? <div className="p-arith">
      <strong>وزن کی تفصیل:</strong>
      <pre dir="ltr">{s.arithmetic.join('\n')}</pre>
    </div> : null}
    <div className="p-total"><span>کل رقم</span><span className="num">{formatPKR(s.total_paisa)}</span></div>
    <div className="p-settle">
      <div className="p-settle-card"><span>ادا شدہ</span><b className="num">{formatPKR(s.paid_paisa)}</b></div>
      <div className="p-settle-card p-settle-due"><span>بقایا</span><b className="num">{formatPKR(s.due_paisa)}</b></div>
      <div className="p-settle-card"><span>طریقہ</span><b>{s.payment_method}</b></div>
    </div>
    {s.note && <div className="small">نوٹ: {s.note}</div>}
    <div className="p-sign"><div>____________________<br />خریدار</div><div>____________________<br />فروخت کنندہ</div></div>
    <div className="p-rule" />
    <VerifyQr docId={s.doc_id} />
    <div className="p-foot">{b.invoice_footer || `${b.name_ur} — ${b.location_ur} — شکریہ`}</div>
  </div>;
}

/** A5 — compact counter format: no line numbers, one signature line. */
function CompactDoc({ s }: { s: Snap }) {
  const b = s.business;
  return <div className="print-doc print-a5" dir="rtl" lang="ur">
    <div className="p-head">
      <div>
        <div className="p-brand"><img className="p-logo" src={logoSrc(b)} alt="" width={38} height={38} />
          <div className="p-name">{b.name_ur}</div></div>
        <div className="small num">{b.phone1} · <span className="num">{s.number}</span> · <span className="num">{s.date}</span></div>
      </div>
      <div className="p-head-right small">{s.title_ur}</div>
    </div>
    {s.provisional && <div className="p-stamp"><span className="provisional-stamp">PROVISIONAL — عارضی</span></div>}
    <div className="p-party"><strong>فریق:</strong> {s.party.name}{s.party.phone ? <> — <span className="num">{s.party.phone}</span></> : null}</div>
    <table>
      <thead><tr><th>تفصیل</th><th>تعداد</th><th>ریٹ</th><th>رقم</th></tr></thead>
      <tbody>{s.lines.map((l, i) => <tr key={i}>
        <td>{l.label}{l.batch ? <span className="small"> — بیچ: <span className="num">{l.batch}</span></span> : null}</td>
        <td className="num">{l.qty}</td>
        <td className="num">{l.rate}</td>
        <td className="num">{formatPKR(l.amount_paisa)}</td>
      </tr>)}</tbody>
      <tfoot>
        {s.extras.map((x, i) => <tr key={i}><td>{x.label}</td><td colSpan={3} className="num">{formatPKR(x.amount_paisa)}</td></tr>)}
      </tfoot>
    </table>
    {s.arithmetic?.length ? <div className="p-arith">
      <strong>وزن:</strong><pre dir="ltr">{s.arithmetic.join('\n')}</pre>
    </div> : null}
    <div className="p-total"><span>کل</span><span className="num">{formatPKR(s.total_paisa)}</span></div>
    <div className="p-meta small">
      <div>ادا شدہ: <span className="num">{formatPKR(s.paid_paisa)}</span> · بقایا: <span className="num">{formatPKR(s.due_paisa)}</span></div>
      <div>{s.payment_method}{s.book_code ? ` · ${s.book_code}` : ''}</div>
    </div>
    {s.note && <div className="small">نوٹ: {s.note}</div>}
    <div className="p-sign p-sign-one"><div>دستخط: ____________________</div></div>
    <div className="p-foot">{b.invoice_footer || `${b.name_ur} — شکریہ`}</div>
  </div>;
}

/** 80mm — borderless thermal receipt: one line per item, no table or signatures.
 *  Depth here is structural (inverted bars, keyline blocks) because thermal prints one colour. */
function ThermalDoc({ s }: { s: Snap }) {
  const b = s.business;
  return <div className="print-doc print-80mm" dir="rtl" lang="ur">
    <div className="t-center t-brand">
      <img className="p-logo" src={logoSrc(b)} alt="" width={30} height={30} />
      <div className="p-name">{b.name_ur}</div>
      <div className="small">{b.location_ur}</div>
      <div className="small num">{b.phone1}</div>
    </div>
    <div className="t-dot" />
    <div className="t-headbar">
      <span>{s.title_ur}</span>
      <span className="num">{s.number}</span>
    </div>
    <div className="t-line"><span>تاریخ</span><span className="num">{s.date}</span></div>
    <div className="t-line"><span>فریق</span><span>{s.party.name}</span></div>
    {s.provisional && <div className="t-center"><span className="provisional-stamp">عارضی</span></div>}
    <div className="t-dot" />
    <div className="t-items">{s.lines.map((l, i) => <div key={i}>
      <div className="t-item-name">{l.label}{l.batch ? <span className="small"> (بیچ: <span className="num">{l.batch}</span>)</span> : null}</div>
      <div className="t-line"><span className="num">{l.qty} × {l.rate}</span><span className="num">{formatPKR(l.amount_paisa)}</span></div>
    </div>)}</div>
    <div className="t-dot" />
    <div className="t-line"><span>ذیلی کل</span><span className="num">{formatPKR(s.subtotal_paisa)}</span></div>
    {s.extras.map((x, i) => <div key={i} className="t-line"><span>{x.label}</span><span className="num">{formatPKR(x.amount_paisa)}</span></div>)}
    <div className="t-line t-line-total"><span>کل رقم</span><span className="num">{formatPKR(s.total_paisa)}</span></div>
    <div className="t-grid">
      <div className="t-cell"><span>ادا شدہ</span><b className="num">{formatPKR(s.paid_paisa)}</b></div>
      <div className="t-cell"><span>بقایا</span><b className="num">{formatPKR(s.due_paisa)}</b></div>
    </div>
    <div className="t-line"><span>طریقہ</span><span>{s.payment_method}{s.book_code ? ` · ${s.book_code}` : ''}</span></div>
    {s.arithmetic?.length ? <><div className="t-dot" /><pre className="t-arith" dir="ltr">{s.arithmetic.join('\n')}</pre></> : null}
    {s.note && <div className="small">نوٹ: {s.note}</div>}
    <div className="t-dot" />
    <VerifyQr docId={s.doc_id} size={72} />
    <div className="t-center small">{b.invoice_footer || `${b.name_ur} — شکریہ`}</div>
  </div>;
}

export function PrintDocument({ snapshot, size = 'A4' }: { snapshot: DocumentSnapshot; size: string }) {
  return size === '80mm' ? <ThermalDoc s={snapshot} />
    : size === 'A5' ? <CompactDoc s={snapshot} />
      : <FullDoc s={snapshot} />;
}
