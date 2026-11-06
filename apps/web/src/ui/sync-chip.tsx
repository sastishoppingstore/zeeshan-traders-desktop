/**
 * Desktop header indicator. The queue and the conflicts live in the main process's SQLite, so this
 * chip is the shopkeeper's one-glance answer to "did my last entry reach the server?". It renders
 * nothing in a browser, where the ERP's own chip and the service worker already cover that.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../app-state.js';
import { DESKTOP_SYNC_PATH, isDesktop } from '../desktop.js';

export function SyncChip() {
  const { online, pending, conflicts, syncing, lastSync, lang, t } = useApp();
  const nav = useNavigate();
  if (!isDesktop) return null;
  const ur = lang === 'ur';
  const tone = !online ? 'warning' : conflicts ? 'danger' : syncing ? 'info' : pending ? 'gray' : 'success';
  const label = !online ? t('offline')
    : conflicts ? (ur ? `${conflicts} تضاد` : `${conflicts} conflicts`)
    : syncing ? (ur ? 'سنک ہو رہا ہے…' : 'Syncing…')
    : pending ? (ur ? `${pending} باقی` : `${pending} pending`)
    : t('synced');
  const title = `${ur ? 'آخری سنک' : 'Last sync'}: ${lastSync ?? (ur ? 'ابھی تک نہیں' : 'not yet')}`
    + (conflicts ? (ur ? ' — تضاد دیکھیں' : ' — open conflicts') : '');
  return <button type="button" className={`chip ${tone} no-print`} title={title}
    aria-label={title} onClick={() => nav(DESKTOP_SYNC_PATH)}
    style={{ cursor: 'pointer', border: 'none' }}>
    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', flex: '0 0 auto' }} />
    <span>{label}</span>
    {/* Clock digits stay left-to-right inside the RTL sentence, like every other timestamp here. */}
    {lastSync && <span className="small" style={{ direction: 'ltr', fontWeight: 500, opacity: .75 }}>{lastSync}</span>}
  </button>;
}
