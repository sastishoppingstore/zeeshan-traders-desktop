/** PUBLIC WEBSITE — PUB-01..09. All data comes from /api/v1/public/* (no internal fields). */
import React, { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useGet } from './api.js';
import { useApp } from './app-state.js';
import { BUSINESS_PROFILE } from '@zt/shared';
import { IMAGES } from './images.js';
import { categoryMedia } from './media.js';
import { useCart } from './cart.js';
import { Home } from './pages/home.js';
import { CartButton, ProductDetail, Products } from './pages/products.js';
import { Enquiry } from './pages/enquiry.js';
import { Checkout } from './pages/checkout.js';
import { InvoiceVerify } from './pages/verify.js';
import { CmsPage, NotFound } from './pages/cms.js';
import { ScrollProgress, GoldDust } from './ui/particles.js';
import { MediaTile } from './ui/cards.js';
import { ChatMark } from './ui/icons.js';

/** Photo-driven icon language: no emoji, no SVG icons anywhere in the shell. */
const NAV_PHOTOS: Record<string, string> = {
  home: 'about/about-shop',
  products: 'about/about-goods',
  categories: 'categories/cat-seeds',
  enquiry: 'about/about-weighing',
  contact: 'about/about-farmer',
};

function NavPhoto({ name, active }: { name: string; active: boolean }) {
  const key = NAV_PHOTOS[name];
  return <span className="nav-ico" aria-hidden="true">
    {key && <img src={IMAGES[key as keyof typeof IMAGES].md} alt="" width={34} height={34} loading="lazy" />}
    {active && <span className="nav-ico-ring" />}
  </span>;
}

function Header({ business }: { business: any }) {
  const { lang, setLang, t, bi } = useApp();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  const b = business ?? BUSINESS_PROFILE;
  const nav: [string, string][] = [
    ['/', t('home')], ['/products', t('products')], ['/categories', t('categories')],
    ['/checkout', t('checkout')], ['/about', t('about')], ['/contact', t('contact')],
  ];
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  return <header className={`pub-header glass${scrolled ? ' pub-header-scrolled' : ''}`}>
    <Link to="/" className="brand">
      <span className="brand-mark"><img src={b.logo_url || '/brand/logo-96.png'} alt="" width={44} height={44} /></span>
      <span className="brand-text">
        {/* One name, in the reading language — the other script stays as the subtle sub-line. */}
        <strong>{bi(b.name_ur, b.name_en)}</strong>
        <small>{lang === 'ur' ? (b.name_en ?? BUSINESS_PROFILE.name_en) : (b.name_ur ?? BUSINESS_PROFILE.name_ur)}</small>
      </span>
    </Link>
    <nav className="pub-nav" aria-label={t('mainNav')}>
      {nav.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
    </nav>
    <div className="row" style={{ gap: 8 }}>
      <CartButton />
      <button className="btn btn-ghost btn-sm" onClick={() => setLang(lang === 'ur' ? 'en' : 'ur')}
        aria-label={lang === 'ur' ? 'Switch to English' : 'اردو میں بدلیں'}>
        {lang === 'ur' ? 'EN' : 'UR'}
      </button>
      <a className="btn btn-wa btn-sm pub-nav-cta" href={b.whatsapp1 ?? BUSINESS_PROFILE.whatsapp1} target="_blank" rel="noreferrer">
        <ChatMark /> {t('whatsapp')}
      </a>
      <button className="btn btn-ghost btn-sm burger" onClick={() => setOpen(!open)} aria-label={t('menu')} aria-expanded={open}>
        <span className="burger-lines" aria-hidden="true" />
      </button>
    </div>
    {open && <div className="card pub-menu-pop">
      {nav.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
      <Link to="/enquiry">{t('enquiry')}</Link>
      <Link to="/erp">{t('erpArea')}</Link>
    </div>}
  </header>;
}

function MobileNav({ business }: { business: any }) {
  const { t } = useApp();
  const loc = useLocation();
  const { count } = useCart();
  const b = business ?? BUSINESS_PROFILE;
  const items: [string, string, string][] = [
    ['/', 'home', t('home')],
    ['/products', 'products', t('products')],
    ['/categories', 'categories', t('categories')],
    ['/checkout', 'enquiry', t('checkout')],
    ['/contact', 'contact', t('contact')],
  ];
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));
  return <nav className="mobile-nav glass" aria-label={t('mobileNav')}>
    {items.map(([to, name, label]) =>
      <Link key={to} to={to} className={`mobile-nav-item${isActive(to) ? ' active' : ''}`}>
        <NavPhoto name={name} active={isActive(to)} />
        <span className="nav-label">{label}</span>
        {name === 'enquiry' && count > 0 && <span className="nav-badge num">{count}</span>}
      </Link>)}
    <a className="mobile-nav-item wa" href={b.whatsapp1 ?? BUSINESS_PROFILE.whatsapp1} target="_blank" rel="noreferrer">
      <span className="nav-ico"><ChatMark /></span>
      <span className="nav-label">{t('whatsapp')}</span>
    </a>
  </nav>;
}

function Footer({ business }: { business: any }) {
  const { t, bi } = useApp();
  const b = business ?? BUSINESS_PROFILE;
  const photos = ['about/about-shop', 'about/about-warehouse', 'about/about-farmers'] as const;
  const shop = bi(b.name_ur, b.name_en) || t('appName');
  return <footer className="pub-footer">
    <GoldDust count={8} />
    <div className="cols">
      <div>
        <div className="footer-brand"><img src={b.logo_url || '/brand/logo-96.png'} alt="" width={40} height={40} loading="lazy" />
          <h2 style={{ fontSize: 18 }}>{shop}</h2></div>
        <p>{bi(b.location_ur, b.location_en)}</p>
        <p className="small">{t('siteTagline')}</p>
      </div>
      <div>
        <h2 style={{ fontSize: 18 }}>{t('contact')}</h2>
        <p><a className="num" href={`tel:${(b.phone1 ?? BUSINESS_PROFILE.phone1).replace(/-/g, '')}`}>{b.phone1 ?? BUSINESS_PROFILE.phone1}</a></p>
        <p><a className="num" href={`tel:${(b.phone2 ?? BUSINESS_PROFILE.phone2).replace(/-/g, '')}`}>{b.phone2 ?? BUSINESS_PROFILE.phone2}</a></p>
        <p><a href={b.whatsapp1 ?? BUSINESS_PROFILE.whatsapp1} target="_blank" rel="noreferrer">{t('whatsapp1')}</a> ·
          <a href={b.whatsapp2 ?? BUSINESS_PROFILE.whatsapp2} target="_blank" rel="noreferrer">{t('whatsapp2')}</a></p>
      </div>
      <div>
        <h2 style={{ fontSize: 18 }}>{t('quickLinks')}</h2>
        <div className="link-list">
          <Link to="/products">{t('products')}</Link><Link to="/categories">{t('categories')}</Link>
          <Link to="/enquiry">{t('enquiry')}</Link><Link to="/privacy">{t('privacy')}</Link>
          <Link to="/terms">{t('terms')}</Link><Link to="/erp">{t('erpArea')}</Link>
        </div>
      </div>
    </div>
    <div className="footer-photos">
      {photos.map((key) => <img key={key} src={IMAGES[key].md} alt="" loading="lazy" width={120} height={120} />)}
    </div>
    <p className="small center" style={{ marginBlockStart: 24 }}>© {shop} {new Date().getFullYear()}</p>
  </footer>;
}

function FloatingActions({ business }: { business: any }) {
  const { t } = useApp();
  const { count } = useCart();
  const loc = useLocation();
  if (loc.pathname === '/enquiry') return null;
  return <>
    <a className="float-wa" href={business?.whatsapp1 ?? BUSINESS_PROFILE.whatsapp1} target="_blank" rel="noreferrer" aria-label={t('whatsapp')}>
      <ChatMark />
    </a>
    {count > 0 && <Link to="/enquiry" className="float-cart" aria-label={t('viewCart')}>
      <span className="num">{count}</span>
      <span className="float-cart-label">{t('cart')}</span>
    </Link>}
  </>;
}

function CategoryRoute() {
  const { slug } = useParams();
  return <Products categorySlug={slug} />;
}

function ProductRoute() {
  const { slug } = useParams();
  return <ProductDetail slug={slug ?? ''} />;
}

function CategoriesScreen() {
  const { t, bi, lang } = useApp();
  // A tile subtitle is deliberately the *other* script, so a tile never shows the same word twice.
  const other = (c: any) => (lang === 'ur' ? c.name_en : c.name_ur);
  const { data, isLoading, error } = useGet<any[]>('public-categories', '/api/v1/public/categories');
  const tops = (data ?? []).filter((c: any) => !c.parent_id);
  const subs = (data ?? []).filter((c: any) => c.parent_id);
  return <div className="pub-container">
    <div className="section-title">
      <h1>{t('categories')}</h1>
      <p className="small">{isLoading ? '…' : `${tops.length} ${t('topCategoriesCount')}`}</p>
    </div>
    {error && <div className="err"><span className="mark-warn" aria-hidden="true" /> {t('loadError')}</div>}
    <div className="tile-grid">
      {tops.map((c: any) =>
        <MediaTile key={c.id} size="lg" photo={categoryMedia(c)} title={bi(c.name_ur, c.name_en)}
          subtitle={other(c)} badge={`${c.product_count} ${t('items')}`} href={`/category/${c.slug}`} />)}
    </div>
    {!!subs.length && <>
      <div className="gold-rule" />
      <h2 style={{ fontSize: 18 }}>{t('allCategories')}</h2>
      <div className="cat-rail">
        {subs.map((c: any) => <MediaTile key={c.id} size="sm" photo={categoryMedia(c)} title={bi(c.name_ur, c.name_en)}
          subtitle={other(c)} href={`/category/${c.slug}`} />)}
      </div>
    </>}
    <div className="center" style={{ marginBlockStart: 24 }}>
      <Link className="btn btn-secondary" to="/products">{t('allProducts')}</Link>
    </div>
  </div>;
}

export function PublicApp() {
  const { data } = useGet<any>('public-home', '/api/v1/public/home');
  const b = data?.business;
  const { t, setBrand } = useApp();
  const mainRef = useRef<HTMLElement | null>(null);
  const loc = useLocation();
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [loc.pathname]);
  useEffect(() => {
    if (b?.name_ur || b?.name_en) setBrand(String(b.name_ur ?? ''), String(b.name_en ?? ''));
  }, [b?.name_ur, b?.name_en, setBrand]);
  return <div className="pub-shell pub-with-nav">
    <ScrollProgress />
    <a className="skip-link" href="#main">{t('skipToMain')}</a>
    <Header business={b} />
    <main id="main" ref={mainRef} tabIndex={-1}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/products" element={<Products />} />
        <Route path="/categories" element={<CategoriesScreen />} />
        <Route path="/category/:slug" element={<CategoryRoute />} />
        <Route path="/product/:slug" element={<ProductRoute />} />
        <Route path="/enquiry" element={<Enquiry />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/verify/:id" element={<InvoiceVerify />} />
        <Route path="/about" element={<CmsPage slug="about" fallbackTitle={t('about')} />} />
        <Route path="/contact" element={<CmsPage slug="contact" fallbackTitle={t('contact')} />} />
        <Route path="/privacy" element={<CmsPage slug="privacy" fallbackTitle={t('privacy')} />} />
        <Route path="/terms" element={<CmsPage slug="terms" fallbackTitle={t('terms')} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </main>
    <Footer business={b} />
    <MobileNav business={b} />
    <FloatingActions business={b} />
  </div>;
}
