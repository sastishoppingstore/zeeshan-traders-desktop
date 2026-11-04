/** Browser-rendered print surface (spec 0.3): one full-screen preview that holds both the
 *  format selector and the live template, so the controls are always reachable. "PDF" = browser
 *  Print -> Save as PDF; printing never modifies the posted document or its stored snapshot. */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatPKR, TEMPLATE_VERSION, type DocumentSnapshot } from '@zt/shared';
import { PrintDocument } from './print-docs.js';
import { Mark } from './ui/marks.js';
import { useApp } from './app-state.js';

type Size = 'A4' | 'A5' | '80mm';

/** Format chips carry i18n KEYS (resolved with t() at render), so an English visit never shows
 *  an Urdu-only control. */
const SIZES: { value: Size; labelKey: string; noteKey: string }[] = [
  { value: 'A4', labelKey: 'sizeA4', noteKey: 'noteA4' },
  { value: 'A5', labelKey: 'sizeA5', noteKey: 'noteA5' },
  { value: '80mm', labelKey: 'size80', noteKey: 'note80' },
];

export function PrintActions({ snapshot, onClose }: { snapshot: DocumentSnapshot; onClose?: () => void }) {
  const { t, toast, lang } = useApp();
  const [size, setSize] = useState<Size>('A4');
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const share = async () => {
    const text = `${snapshot.business.name_ur}\n${snapshot.title_ur} ${snapshot.number}\n${snapshot.party.name}\nکل: ${formatPKR(snapshot.total_paisa)}\nبقایا: ${formatPKR(snapshot.due_paisa)}`;
    try {
      if (navigator.share) await navigator.share({ title: `${snapshot.title_ur} ${snapshot.number}`, text, url: window.location.href });
      else { await navigator.clipboard.writeText(text); toast(t('copiedText')); }
    } catch { /* user cancelled */ }
  };
  const active = SIZES.find((x) => x.value === size);
  return createPortal(<div className="print-root" role="dialog" aria-modal="true"
    aria-label={`${snapshot.title_ur} ${snapshot.number} — ${t('printPreview')}`}>
    <div className="print-bar no-print">
      <button type="button" className="btn btn-secondary btn-sm pub-back-btn no-print"
        onClick={() => (onClose ? onClose() : window.history.back())}
        aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}>
        <span className="back-arrow">{lang === 'ur' ? '›' : '‹'}</span> {lang === 'ur' ? 'واپس' : 'Back'}
      </button>
      <span className="print-bar-title">{snapshot.title_ur} <span className="num">{snapshot.number}</span></span>
      <span className="print-sizes" role="group" aria-label={t('printFormat')}>
        {SIZES.map((x) => <button key={x.value} type="button"
          className={`size-chip${size === x.value ? ' size-chip-active' : ''}`}
          aria-pressed={size === x.value} onClick={() => setSize(x.value)}>{t(x.labelKey)}</button>)}
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}><Mark kind="print" /> {t('pdf')} / {t('print')}</button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void share()}><Mark kind="share" /> {t('share')}</button>
      {onClose && <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('closeLabel')}><Mark kind="x" /></button>}
    </div>
    <div className="print-note notice info small no-print" role="status">
      {active ? t(active.noteKey) : ''} · {t('linesCount')}: <span className="num">{snapshot.lines.length}</span>
    </div>
    <div className="print-note notice small no-print">
      {t('printPdfNote')} {t('printTemplateNote')} <span className="num">{snapshot.template_version || TEMPLATE_VERSION}</span> — {t('printReprintNote')}
    </div>
    <PrintDocument snapshot={snapshot} size={size} />
  </div>, document.body);
}
