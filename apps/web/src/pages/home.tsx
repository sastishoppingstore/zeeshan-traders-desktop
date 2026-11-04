/** PUB-02 — home page: the ten bands from the master brief, driven only by /api/v1/public/home. */
import React from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '../api.js';
import { useApp } from '../app-state.js';
import { Chip, Skeleton, ErrorState } from '../components.js';
import { BUSINESS_PROFILE } from '@zt/shared';
import {
  ABOUT_MEDIA, CATEGORY_MEDIA, GRAIN_ORDER, HERO_BG, HERO_CUBE, SHOWCASE_MEDIA,
  categoryMedia, mediaUrl,
} from '../media.js';
import { IMAGES } from '../images.js';
import { HeroCube } from '../ui/cube.js';
import { GoldDust } from '../ui/particles.js';
import { Reveal, useParallax, useTilt, Marquee } from '../ui/motion.js';
import { MediaTile, SectionHead, Eyebrow, TiltCard } from '../ui/cards.js';
import { Photo } from '../ui/photo.js';
import { ProductCard, waLink } from './products.js';

/** The eight headline categories from the brief, in display order. */
const HEADLINE_CODES = ['FERT', 'PEST', 'CHOK', 'WAND', 'CEM', 'SEED', 'OTHR', 'GRAINS'];

const WHY = [
  { photo: 'about/about-weighing', ur: 'ناپ تول میں دیسی ایمانداری', en: 'Honest weights, every time',
    body_ur: 'فی تول پیمانے پر وزن، کچے بخاری اور پرچہ — وہی حساب جو دکان پر دیا جاتا ہے۔',
    body_en: 'Weighed on the shop scale, with a printed slip for every load.' },
  { photo: 'categories/cat-fertilizer', ur: 'درجہ بند کمپنی کا اصل مال', en: 'Sealed, genuine brands',
    body_ur: 'کھاد، پیسٹی سائیڈ اور بیج بند پیکٹ میں، لیبل اور ایکسپائری نمبر کے ساتھ۔',
    body_en: 'Fertilizer, pesticide and seed in factory-sealed packs with batch and expiry.' },
  { photo: 'about/about-delivery', ur: 'قریب و دور ترسیل', en: 'Delivery near and far',
    body_ur: 'ضلع لیہ اور گردونواح میں بھاری اجناس کی ترسیل، قیمت پر بات چیت کے ساتھ۔',
    body_en: 'Grain and goods delivery across Layyah district, freight agreed up front.' },
  { photo: 'about/about-grain-bowls', ur: 'اجناس کا الگ حساب', en: 'Separate accounts per grain',
    body_ur: 'ہر اجناس (گندم، چاول، تل، باجرہ، مکئی، مونگی، سرسوں) کا اپنا اسٹاک اور کھاتہ۔',
    body_en: 'Wheat, rice, sesame, millet, maize, moong and mustard each keep their own ledger.' },
];

/** Round "Goal" Category Slider — horizontal sliding strip of small circular category cards */
function GoalCategorySlider({ categories }: { categories: any[] }) {
  const { lang, bi } = useApp();
  const trackRef = React.useRef<HTMLDivElement | null>(null);

  const slide = (dir: 'left' | 'right') => {
    if (!trackRef.current) return;
    const amount = Math.max(220, Math.floor(trackRef.current.clientWidth * 0.7));
    trackRef.current.scrollBy({
      left: dir === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  return (
    <div className="cat-slider-wrap">
      <button type="button" className="cat-slide-btn cat-slide-prev"
        onClick={() => slide(lang === 'ur' ? 'right' : 'left')}
        aria-label={lang === 'ur' ? 'پچھلا' : 'Previous'}>
        ‹
      </button>
      <div className="cat-slider-track" ref={trackRef} tabIndex={0} role="region"
        aria-label={lang === 'ur' ? 'زمرے' : 'Categories'}>
        {categories.map((c) => {
          const photo = c.photo ? IMAGES[c.photo.key as keyof typeof IMAGES]?.md : null;
          const name = bi(c.name_ur, c.name_en);
          return (
            <Link key={c.id || c.slug} to={`/category/${c.slug}`} className="cat-goal-item">
              <div className="cat-goal-circle">
                {photo ? (
                  <img src={photo} alt={name} width={80} height={80} loading="lazy" decoding="async" />
                ) : (
                  <span className="cat-goal-fallback">{name.slice(0, 2)}</span>
                )}
                {c.product_count != null && c.product_count > 0 && (
                  <span className="cat-goal-badge num">{c.product_count}</span>
                )}
              </div>
              <span className="cat-goal-title">{name}</span>
            </Link>
          );
        })}
      </div>
      <button type="button" className="cat-slide-btn cat-slide-next"
        onClick={() => slide(lang === 'ur' ? 'left' : 'right')}
        aria-label={lang === 'ur' ? 'اگلا' : 'Next'}>
        ›
      </button>
    </div>
  );
}

export function Home() {
  const { t, lang, bi } = useApp();
  const { data, isLoading, error, refetch } = useGet<any>('public-home', '/api/v1/public/home');
  const b = data?.business ?? BUSINESS_PROFILE;
  const bgKey = data?.banners?.[0]?.image_r2_key ? mediaUrl(data.banners[0].image_r2_key) : IMAGES[HERO_BG.key].lg;
  const heroRef = React.useRef<HTMLDivElement | null>(null);
  useParallax(heroRef);

  const cats = (data?.categories ?? []).filter((c: any) => !c.parent_id);
  const allSliderCats = (data?.categories ?? []).map((c: any) => {
    const photo = categoryMedia(c) || CATEGORY_MEDIA[c.code];
    return { ...c, photo };
  });
  const headline = HEADLINE_CODES.map((code) => {
    const row = cats.find((c: any) => c.code === code);
    return row ? { ...row, photo: categoryMedia(row) } : null;
  }).filter(Boolean) as any[];
  const grains = GRAIN_ORDER.map((code) => {
    const row = (data?.categories ?? []).find((c: any) => c.code === code);
    return { code, photo: CATEGORY_MEDIA[code], row };
  });

  // Cube faces: featured first, then new arrivals, keeping only publicly priced items.
  const featuredFirst4 = [
    ...(data?.featured ?? []), ...(data?.new_arrivals ?? []),
  ].filter((p: any) => p.show_public_price && p.public_price_paisa).slice(0, 4);

  /** Sixteen on the shelf, the rest stay on /products. Featured leads and newest fills the remainder;
   *  the same product can arrive in both lists, so ids never repeat. */
  const shelf: any[] = [];
  for (const p of [...(data?.featured ?? []), ...(data?.new_arrivals ?? [])]) {
    if (shelf.length >= 16) break;
    if (p?.id && !shelf.some((s) => s.id === p.id)) shelf.push(p);
  }

  const marqueeItems = [
    ...(headline.length
      ? headline.map((c: any) => bi(c.name_ur, c.name_en))
      : GRAIN_ORDER.map((code) => (lang === 'ur' ? CATEGORY_MEDIA[code].alt_ur : CATEGORY_MEDIA[code].alt_en))),
    t('weighSlip'), t('oneRoof'), t('deliveryArea'), t('ownLedger'),
  ];

  const shell = <section className="pub-hero" ref={heroRef}>
    <div className="pub-hero-media kb" style={{ transform: 'translate3d(0, calc(var(--parallax, 0) * 40px), 0)' }}>
      <img src={bgKey} alt="" {...{ fetchpriority: 'high' }} decoding="async" width={1600} height={1360} />
    </div>
    <div className="pub-hero-scrim" aria-hidden="true" />
    <GoldDust count={16} />
    <div className="inner">
      <div className="hero-layout">
        <div className="hero-copy">
          <span className="pub-hero-kicker">{t('maqsoodChowk')}</span>
          <h1 className="h-nastaliq">{bi(b.name_ur, b.name_en) || t('appName')}</h1>
          <p className="tagline">{(lang === 'ur' && data?.hero_tagline) || (lang === 'ur' ? BUSINESS_PROFILE.location_ur : BUSINESS_PROFILE.location_en)}</p>
        </div>
        {/* the cube is the signature block: four live product cards when the catalogue has prices */}
        <div className="hero-cube"><HeroCube faces={HERO_CUBE} products={featuredFirst4} /></div>
        <div className="hero-cats">
          {headline.slice(0, 4).map((c) => <MediaTile key={c.id} size="sm" href={`/category/${c.slug}`}
            photo={c.photo} title={bi(c.name_ur, c.name_en)} subtitle={`${c.product_count ?? 0} ${t('items')}`} />)}
        </div>
        <div className="hero-cta btn-row">
          <Link className="btn btn-primary" to="/products">{t('viewProducts')}</Link>
          <button type="button" className="btn btn-gold" onClick={() => window.dispatchEvent(new CustomEvent('zt:open-install'))}>
            {lang === 'ur' ? 'ایپ انسٹال کریں' : 'Install App'}
          </button>
          <a className="btn btn-wa" href={b.whatsapp1 ?? BUSINESS_PROFILE.whatsapp1} target="_blank" rel="noreferrer">
            <span className="chat-mark" aria-hidden="true" />{t('contactWhatsapp')}</a>
        </div>
      </div>
    </div>
  </section>;

  const strip = <div className="info-strip">
    <div><span className="ico"><Photo src={IMAGES['about/about-shop'].md} alt="" ratio={1} /></span>
      {bi(b.location_ur, b.location_en)}</div>
    <div><span className="ico"><Photo src={IMAGES['categories/cat-wheat'].md} alt="" ratio={1} /></span>
      <a className="num" href={`tel:${(b.phone1 ?? BUSINESS_PROFILE.phone1).replace(/-/g, '')}`}>{b.phone1}</a> ·
      <a className="num" href={`tel:${(b.phone2 ?? BUSINESS_PROFILE.phone2).replace(/-/g, '')}`}>{b.phone2}</a></div>
    <div><span className="ico"><Photo src={IMAGES['about/about-delivery'].md} alt="" ratio={1} /></span>
      {data?.opening_hours ? (typeof data.opening_hours === 'string' ? data.opening_hours : JSON.stringify(data.opening_hours)) : t('heroTrust')}</div>
  </div>;

  const band = <Marquee items={marqueeItems} label={lang === 'ur' ? 'ہمارے زمرے اور خدمات' : 'Categories and services'} />;

  if (isLoading) return <>
    {shell}{band}{strip}
    <div className="pub-container" style={{ minHeight: '75vh' }}><Skeleton rows={6} /></div>
  </>;
  if (error) return <>
    {shell}{band}{strip}
    <div className="pub-container"><ErrorState error={error} retry={() => refetch()} /></div>
  </>;

  return <>
    {shell}
    {band}
    {strip}
    <div className="pub-container pub-with-nav">
      {data?.catalogue_empty && <div className="notice info" style={{ marginBlockStart: 24 }}>
        {t('emptyProducts')} — <a href={b.whatsapp1}>{t('askWhatsapp')}</a></div>}

      {/* 3 — category showcase */}
      <section className="section">
        <Reveal><SectionHead kicker={<Eyebrow>{lang === 'ur' ? 'زمرے' : 'Categories'}</Eyebrow>} title={t('categories')}
          action={<Link to="/products">{t('viewAll')} ›</Link>} /></Reveal>
        <GoalCategorySlider categories={allSliderCats.length ? allSliderCats : headline} />
      </section>

      {/* 4 — sixteen-item shelf: featured leads, newest fills, everything else stays on /products */}
      {!!shelf.length && <section className="section">
        <Reveal><SectionHead kicker={<Eyebrow>{lang === 'ur' ? 'آج کے ریٹ' : 'Today’s rates'}</Eyebrow>} title={t('products')}
          action={<Link to="/products?sort=featured">{t('viewAll')} ›</Link>} /></Reveal>
        <div className="products-grid products-grid-16">{shelf.map((p: any, i: number) =>
          <Reveal key={p.id} delay={Math.min(i, 8) * 35}><ProductCard p={p} business={b} /></Reveal>)}</div>
      </section>}

      {/* 5 — why choose us */}
      <section className="section">
        <Reveal><SectionHead kicker={<Eyebrow>{'Trust'}</Eyebrow>} title={t('whyUs')} center /></Reveal>
        <div className="why-grid">{WHY.map((w, i) =>
          <Reveal key={w.ur} delay={i * 60}>
            <TiltCard className="why-card glass">
              <span className="ico"><Photo src={IMAGES[w.photo as keyof typeof IMAGES]?.md} alt={lang === 'ur' ? w.ur : w.en} ratio={1} /></span>
              <h3>{lang === 'ur' ? w.ur : w.en}</h3>
              <p>{lang === 'ur' ? w.body_ur : w.body_en}</p>
            </TiltCard>
          </Reveal>)}</div>
      </section>

      {/* 6 — about */}
      <section className="section">
        <div className="band band-cream">
          <div className="band-grid">
            <Reveal>
              <Eyebrow>{lang === 'ur' ? 'پرانا کھاتہ' : 'Since generations'}</Eyebrow>
              <h2>{lang === 'ur'
                ? `${bi(b.name_ur, b.name_en)} — ${b.location_ur ?? BUSINESS_PROFILE.location_ur}`
                : `${bi(b.name_ur, b.name_en)}`}</h2>
              <p>{lang === 'ur'
                ? 'کھاد، پیسٹی سائیڈ، بیج، چوکر، ونڈا، سیمنٹ اور اجناس — ایک چھت تلے، کسان اور تاجر دونوں کے لیے۔'
                : 'Fertilizer, pesticide, seed, bran, cotton seed, cement and grains — under one roof for farmers and traders alike.'}</p>
              <div className="btn-row">
                <Link className="btn btn-secondary" to="/about">{t('about')}</Link>
                <a className="btn btn-wa" href={b.whatsapp1} target="_blank" rel="noreferrer">{t('askWhatsapp')}</a>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="photo-story">
                {ABOUT_MEDIA.slice(0, 3).map((m) => <figure key={m.key}>
                  <Photo src={IMAGES[m.key].md} alt={lang === 'ur' ? m.alt_ur : m.alt_en} ratio={m.key === 'about/about-shop' ? 16 / 9 : 1} />
                  <figcaption>{lang === 'ur' ? m.alt_ur : m.alt_en}</figcaption>
                </figure>)}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 7 — agricultural showcase */}
      <section className="section">
        <Reveal><SectionHead kicker={<Eyebrow>{lang === 'ur' ? 'دکان پر' : 'On the ground'}</Eyebrow>} title={t('goods')} /></Reveal>
        <div className="showcase-strip" tabIndex={0} role="region" aria-label={lang === 'ur' ? 'دکان کی تصاویر' : 'Shop photos'}>
          {SHOWCASE_MEDIA.map((m, i) => <Reveal key={m.key} delay={i * 50} className="showcase-cell">
            <figure><Photo src={IMAGES[m.key].md} alt={lang === 'ur' ? m.alt_ur : m.alt_en} ratio={4 / 3} /></figure>
            <figcaption>{lang === 'ur' ? m.alt_ur : m.alt_en}</figcaption>
          </Reveal>)}
        </div>
      </section>

      {/* 8 — grains showcase: one rail, but every grain stays its own ERP module */}
      <section className="section">
        <Reveal><SectionHead kicker={<Eyebrow>{lang === 'ur' ? 'اجناس' : 'Aggregates'}</Eyebrow>} title={t('grains')}
          action={<Link to="/category/grains">{t('viewAll')} ›</Link>} /></Reveal>
        <div className="grain-rail">{grains.map(({ code, photo, row }, i) =>
          <Reveal key={code} delay={i * 40}>
            <MediaTile photo={photo} href={`/category/${row?.slug ?? code.toLowerCase()}`}
              title={bi(row?.name_ur, row?.name_en) || (lang === 'ur' ? CATEGORY_MEDIA[code].alt_ur : CATEGORY_MEDIA[code].alt_en)}
              subtitle={lang === 'ur' ? (row?.name_en ?? CATEGORY_MEDIA[code].alt_en) : (row?.name_ur ?? CATEGORY_MEDIA[code].alt_ur)}
              badge={row?.product_count != null ? <Chip tone="gray">{row.product_count}</Chip> : undefined} />
          </Reveal>)}</div>
      </section>

      {/* 10 — announcements + contact */}
      {!!data?.announcements?.length && <section className="section">
        <Reveal><SectionHead kicker={<Eyebrow>{lang === 'ur' ? 'اطلاع نامہ' : 'Notice board'}</Eyebrow>} title={t('announcements')} /></Reveal>
        {data.announcements.map((a: any) => <Reveal key={a.id}>
          <div className="card announcement" style={{ marginBlockEnd: 10 }}>
            <strong>{a.title_ur}</strong><div className="small num">{a.publish_at}</div><p>{a.body_ur}</p>
          </div></Reveal>)}
      </section>}

      <section className="section">
        <div className="band">
          <GoldDust count={10} />
          <div className="band-grid">
            <Reveal>
              <h2>{t('contact')}</h2>
              <p>{b.location_ur ?? BUSINESS_PROFILE.location_ur}</p>
              <div className="btn-row">
                <a className="btn btn-wa" href={b.whatsapp1 ?? BUSINESS_PROFILE.whatsapp1} target="_blank" rel="noreferrer">
                  <span className="chat-mark" aria-hidden="true" />{t('whatsapp')}</a>
                <Link className="btn btn-gold" to="/enquiry">{t('sendEnquiry')}</Link>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="kv">
                <div><span className="k">{t('mobile')}</span><span className="v num">{b.phone1}</span></div>
                <div><span className="k">{t('mobile')} 2</span><span className="v num">{b.phone2}</span></div>
                <div><span className="k">{t('address')}</span><span className="v">{b.location_ur}</span></div>
                <div><span className="k">{t('openInMaps')}</span>
                  <span className="v"><a target="_blank" rel="noreferrer"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('مقصود چوک لیہ پنجاب پاکستان')}`}>{t('openInMaps')}</a></span></div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </div>
  </>;
}
