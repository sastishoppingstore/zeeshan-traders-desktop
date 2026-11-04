/** PUB-08/09 — CMS pages, branded 404 / 403 / offline screens. */
import React from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '../api.js';
import { useApp } from '../app-state.js';
import { AsyncView, Button } from '../components.js';
import { BUSINESS_PROFILE } from '@zt/shared';
import { IMAGES } from '../images.js';
import { ABOUT_MEDIA, HERO_WHEAT } from '../media.js';
import { Photo } from '../ui/photo.js';
import { SectionHead, Eyebrow } from '../ui/cards.js';
import { Reveal } from '../ui/motion.js';
import { waLink } from './products.js';

export function CmsPage({ slug, fallbackTitle }: { slug: string; fallbackTitle: string }) {
  const { t, lang } = useApp();
  const { data, isLoading, error, refetch } = useGet<any>('page', `/api/v1/public/pages/${slug}`);
  const { data: home } = useGet<any>('public-home', '/api/v1/public/home');
  const b = home?.business ?? BUSINESS_PROFILE;

  if (slug === 'contact') return <div className="pub-container pub-with-nav" style={{ maxWidth: 860 }}>
    <SectionHead kicker={<Eyebrow>{t('contact')}</Eyebrow>} title={t('contact')} />
    <div className="contact-grid">
      <Reveal><div className="card">
        <div className="kv">
          <div><span className="k">{t('address')}</span><span className="v">{b.location_ur ?? BUSINESS_PROFILE.location_ur}</span></div>
          <div><span className="k">{t('mobile')} 1</span><span className="v num">{b.phone1 ?? BUSINESS_PROFILE.phone1}</span></div>
          <div><span className="k">{t('mobile')} 2</span><span className="v num">{b.phone2 ?? BUSINESS_PROFILE.phone2}</span></div>
          {home?.opening_hours && <div><span className="k">{t('opening')}</span><span className="v">{String(home.opening_hours)}</span></div>}
        </div>
        <div className="btn-row" style={{ marginBlockStart: 16 }}>
          <a className="btn btn-wa" href={b.whatsapp1 ?? BUSINESS_PROFILE.whatsapp1} target="_blank" rel="noreferrer">{t('whatsapp')} 1</a>
          <a className="btn btn-wa" href={b.whatsapp2 ?? BUSINESS_PROFILE.whatsapp2} target="_blank" rel="noreferrer">{t('whatsapp')} 2</a>
          <Link className="btn btn-gold" to="/enquiry">{t('sendEnquiry')}</Link>
        </div>
        <a className="btn btn-secondary btn-sm btn-block" style={{ marginBlockStart: 10 }} target="_blank" rel="noreferrer"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('مقصود چوک لیہ پنجاب پاکستان')}`}>{t('openInMaps')}</a>
      </div></Reveal>
      <Reveal delay={80}>
        <div className="photo-story">
          <figure><Photo src={IMAGES['about/about-showroom'].md} alt={t('shopPhoto')} ratio={4 / 3} /></figure>
          <figure><Photo src={IMAGES['about/about-warehouse'].md} alt={ABOUT_MEDIA[2].alt_ur} ratio={1} /></figure>
          <figure><Photo src={IMAGES['about/about-delivery'].md} alt={ABOUT_MEDIA[0].alt_ur} ratio={1} /></figure>
        </div>
      </Reveal>
    </div>
  </div>;

  const title = lang === 'ur' ? (data?.title_ur ?? fallbackTitle) : (data?.title_en ?? data?.title_ur ?? fallbackTitle);
  const body = (lang === 'ur' ? data?.body_ur : data?.body_en) || data?.body_ur || '';
  return <div className="pub-container pub-with-nav" style={{ maxWidth: 860 }}>
    <AsyncView loading={isLoading} error={error} retry={() => refetch()}>
      <SectionHead kicker={<Eyebrow>{t('website')}</Eyebrow>} title={title} />
      {body
        ? <div className="card cms-body" dangerouslySetInnerHTML={{ __html: body }} />
        : <div className="notice">یہ صفحہ مالک کے جائزے کے بعد شائع ہوگا۔ — This page will appear once the owner publishes it.</div>}
      <div className="btn-row" style={{ marginBlockStart: 16 }}>
        <Link className="btn btn-secondary" to="/">{t('home')}</Link>
        <a className="btn btn-wa" href={waLink(b.whatsapp1 as string, 'السلام علیکم۔')} target="_blank" rel="noreferrer">{t('askWhatsapp')}</a>
      </div>
    </AsyncView>
  </div>;
}

export function NotFound() {
  const { t } = useApp();
  return <div className="pub-container pub-with-nav status-page center">
    <Photo src={IMAGES[HERO_WHEAT.key].md} alt="" ratio={16 / 9} className="status-photo" />
    <h1 className="status-code">۴۰۴</h1>
    <p>{t('notFound')}</p>
    <div className="btn-row center" style={{ justifyContent: 'center' }}>
      <Link className="btn btn-primary" to="/">{t('home')}</Link>
      <Link className="btn btn-secondary" to="/products">{t('viewProducts')}</Link>
    </div>
  </div>;
}

export function Forbidden() {
  const { t } = useApp();
  return <div className="permission status-page">
    <div className="icon"><Photo src={IMAGES['categories/cat-tools'].md} alt="" ratio={1} /></div>
    <h2>{t('permissionDenied')}</h2>
    <Link className="btn btn-secondary" to="/erp">{t('dashboard')}</Link>
  </div>;
}

/** Shown by the service-worker offline route and when the API is unreachable. */
export function OfflineNotice({ onRetry }: { onRetry?: () => void }) {
  const { t } = useApp();
  return <div className="banner offline" role="status">
    {t('offlineBanner')} {onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>{t('retry')}</Button>}
  </div>;
}
