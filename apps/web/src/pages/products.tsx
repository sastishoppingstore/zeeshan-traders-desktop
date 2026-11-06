/** PUB-03/04/05 — catalogue grid, filters and product detail. Data comes from /api/v1/public/* only. */
import React, { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useGet } from '../api.js';
import { useApp } from '../app-state.js';
import { Button, Chip, Skeleton, ErrorState, SelectField, TextField } from '../components.js';
import { formatPKR, BUSINESS_PROFILE } from '@zt/shared';
import { productMedia, categoryMedia } from '../media.js';
import { addLine, useCart } from '../cart.js';
import { MediaTile, SectionHead, Eyebrow } from '../ui/cards.js';
import { useSpot, useTilt } from '../ui/motion.js';
import { Monogram } from '../ui/icons.js';
import { Photo, keySrc } from '../ui/photo.js';

export function StatusBadge({ availability }: { availability: string }) {
  const { t } = useApp();
  const tone = availability === 'AVAILABLE' ? 'success' : availability === 'CALL' ? 'info' : 'gray';
  const label = availability === 'AVAILABLE' ? t('available') : availability === 'CALL' ? t('callUs') : t('outOfStock');
  return <Chip tone={tone}>{label}</Chip>;
}

export function waLink(whatsapp: string | undefined, text: string) {
  const base = whatsapp ?? BUSINESS_PROFILE.whatsapp1;
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function ProductCard({ p, business }: { p: any; business: any }) {
  const { t, lang } = useApp();
  const { setLines, count } = useCart();
  const nav = useNavigate();
  const spot = useSpot<HTMLElement>();
  const tilt = useTilt<HTMLElement>(5);
  const media = productMedia(p);
  const name = lang === 'ur' ? (p.name_ur || p.name_en) : (p.name_en || p.name_ur);
  const line = {
    product_id: p.id, slug: p.slug, name_ur: p.name_ur ?? p.name_en ?? '', name_en: p.name_en,
    unit: p.base_unit ?? 'BF', qty_milli: 1000,
    price_paisa: p.show_public_price ? (p.public_price_paisa ?? null) : null,
    img: media?.src, alt: media?.alt,
  };
  const add = () => setLines(addLine(line));
  /** Order Now is the one-tap path: put the item in the cart and land on checkout, so a farmer on a
   *  phone never has to find the cart. Stock is still not reserved — checkout is an enquiry. */
  const orderNow = () => { add(); nav('/checkout'); };
  const askWa = `السلام علیکم، مجھے ${p.name_ur ?? name} کے بارے میں معلومات چاہئیں۔`;
  const setRef = (el: HTMLElement | null) => { spot.current = el; tilt.current = el; };
  return <article ref={setRef as never} className="product-card zoom spot foil tile-3d">
    <button type="button" className="quick-add" onClick={add} aria-label={`${t('addToCart')}: ${name}`}>+</button>
    <Link to={`/product/${p.slug}`} className="thumb" aria-label={name}>
      {media ? <img src={media.src} alt={media.alt} loading="lazy" decoding="async" width={360} height={360} />
        : <span className="thumb-mono"><Monogram text={name} /></span>}
    </Link>
    <div className="body">
      <Chip tone="gray">{lang === 'ur' ? (p.category_ur ?? p.category_en) : (p.category_en ?? p.category_ur)}</Chip>
      <Link to={`/product/${p.slug}`} className="name">{name}</Link>
      {(p.brand_ur || p.brand_en) && <div className="small">{lang === 'ur' ? p.brand_ur : p.brand_en}</div>}
      <div className="small">{t('unit')}: {p.base_unit}</div>
      <StatusBadge availability={p.availability} />
      <div className="price">{p.show_public_price ? formatPKR(p.public_price_paisa) : t('contactForPrice')}</div>
      <div className="card-actions">
        <button type="button" className="btn btn-primary btn-sm btn-block" onClick={orderNow}>{t('orderNow')}</button>
        <a className="btn btn-wa btn-sm" href={waLink(business?.whatsapp1, askWa)}
          target="_blank" rel="noreferrer">{t('askWhatsapp')}</a>
      </div>
      <Link to={`/product/${p.slug}`} className="small card-more">{t('details')} ›</Link>
    </div>
    {count > 0 && <span className="sr-only">{`${t('cart')}: ${count}`}</span>}
  </article>;
}

export function CartButton() {
  const { t, lang } = useApp();
  const { count } = useCart();
  return <Link to="/checkout" className="btn btn-gold btn-sm" aria-label={lang === 'ur' ? 'آرڈر کریں' : 'Order Now'}>
    {lang === 'ur' ? 'آرڈر کریں' : 'Order Now'} {count > 0 && <span className="num">({count})</span>}
  </Link>;
}

function EmptyForProducts({ whatsapp }: { whatsapp?: string }) {
  const { t } = useApp();
  return <div className="empty">
    <div className="icon"><Photo src={keySrc('categories/cat-tools')} alt={t('emptyProducts')} ratio={1} /></div>
    <p>{t('emptyProducts')}</p>
    <a className="btn btn-wa" href={waLink(whatsapp, 'السلام علیکم، سامان کی دستیابی معلوم کرنی ہے۔')}
      target="_blank" rel="noreferrer">{t('askWhatsapp')}</a></div>;
}

export function Products({ categorySlug }: { categorySlug?: string }) {
  const { t, lang, bi } = useApp();
  const loc = useLocation();
  const qs = new URLSearchParams(loc.search);
  const [q, setQ] = useState(qs.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [sort, setSort] = useState(qs.get('sort') ?? 'new');
  const [cat, setCat] = useState(categorySlug ?? qs.get('category') ?? '');
  const [cursor, setCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [first, setFirst] = useState(true);
  const categories = useGet<any[]>('public-categories', '/api/v1/public/categories');
  const home = useGet<any>('public-home', '/api/v1/public/home');

  useEffect(() => { const x = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(x); }, [q]);
  useEffect(() => { setCat(categorySlug ?? new URLSearchParams(loc.search).get('category') ?? ''); }, [categorySlug, loc.search]);
  const path = `/api/v1/public/products?q=${encodeURIComponent(debounced)}&sort=${sort}`
    + `&category=${encodeURIComponent(cat)}&limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const { data, isLoading, error, refetch } = useGet<any>('public-products', path);
  useEffect(() => { setRows([]); setCursor(null); setFirst(true); }, [debounced, sort, cat]);
  useEffect(() => { if (data?.rows) { setRows((r) => first ? data.rows : [...r, ...data.rows]); setFirst(false); } }, [data]);

  const activeCat = categories.data?.find((c: any) => c.slug === cat);
  const business = home.data?.business;

  return <div className="pub-container pub-with-nav">
    <nav className="breadcrumb small" aria-label={t('location')}>
      <Link to="/">{t('home')}</Link> › <Link to="/products">{t('allProducts')}</Link>
      {activeCat && ` › ${bi(activeCat.name_ur, activeCat.name_en)}`}
    </nav>
    <SectionHead kicker={<Eyebrow>{t('products')}</Eyebrow>}
      title={activeCat ? bi(activeCat.name_ur, activeCat.name_en) : t('allProducts')}
      action={<a className="btn btn-wa btn-sm" href={waLink(business?.whatsapp1, 'السلام علیکم، قیمت معلوم کرنی ہے۔')}
        target="_blank" rel="noreferrer">{t('askWhatsapp')}</a>} />

    <div className="catalogue-layout">
      <aside className="filters card">
        <h2 style={{ fontSize: 18 }}>{t('filter')}</h2>
        <TextField label={t('search')} value={q} onChange={setQ} placeholder={t('searchPlaceholder')} />
        <div className="field"><label>{t('categories')}</label>
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('categories')}>
            <option value="">{t('allProducts')}</option>
            {(categories.data ?? []).map((c: any) => <option key={c.id} value={c.slug}>{bi(c.name_ur, c.name_en)}</option>)}
          </select></div>
        <SelectField label={t('sort')} value={sort} onChange={setSort} options={[
          { value: 'new', label: t('newProducts') }, { value: 'name', label: t('name') },
          { value: 'featured', label: t('featured') }, { value: 'price', label: t('price') }]} />
        <div className="cat-rail">
          {(categories.data ?? []).filter((c: any) => !c.parent_id).slice(0, 6).map((c: any) =>
            <MediaTile key={c.id} size="sm" active={cat === c.slug} href={`/category/${c.slug}`}
              photo={categoryMedia(c)} title={bi(c.name_ur, c.name_en)}
              subtitle={lang === 'ur' ? c.name_en : c.name_ur} />)}
        </div>
        <a className="btn btn-secondary btn-sm btn-block no-print" target="_blank" rel="noreferrer"
          href={`/api/v1/public/products?q=${encodeURIComponent(q)}`}>{t('apiData')}</a>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="toolbar">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')} />
          <Button variant="secondary" size="sm" onClick={() => setSort(sort === 'new' ? 'name' : 'new')}>{t('sort')}</Button>
          <CartButton />
        </div>
        <div style={{ minHeight: '60vh' }}>
          {isLoading && !rows.length
            ? <div className="products-grid">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} rows={1} />)}</div>
            : error ? <ErrorState error={error} retry={() => refetch()} />
              : !rows.length ? <EmptyForProducts whatsapp={business?.whatsapp1} />
                : <>
                  <div className="small" style={{ marginBlockEnd: 10 }}>{rows.length} {t('items')}</div>
                  <div className="products-grid">{rows.map((p) => <ProductCard key={p.id} p={p} business={business} />)}</div>
                  {data?.next_cursor && <div className="center" style={{ marginBlock: 24 }}>
                    <Button variant="secondary" onClick={() => setCursor(data.next_cursor)}>{t('loadMore')}</Button></div>}
                </>}
        </div>
      </div>
    </div>
  </div>;
}

function ProductGallery({ p }: { p: any }) {
  const [main, setMain] = useState(0);
  const tilt = useTilt<HTMLDivElement>(7);
  const spot = useSpot<HTMLDivElement>();
  // One element, both pointer hooks.
  const setRef = (el: HTMLDivElement | null) => { tilt.current = el; spot.current = el; };
  const images = p.images ?? [];
  const media = productMedia(p);
  const src = images.length ? images[main]?.url : media?.src;
  const alt = images.length ? (images[main]?.alt_ur || p.name_ur) : (media?.alt ?? p.name_ur ?? '');
  return <div className="gallery" ref={setRef}>
    <div className="main tile-3d spot">
      {src ? <img src={src} alt={alt} width={600} height={600} decoding="async"
        fetchPriority={main === 0 ? 'high' : undefined} />
        : <span className="thumb-mono"><Monogram text={alt} /></span>}
      <span className="gallery-edge" aria-hidden="true" />
    </div>
    {images.length > 1 && <div className="thumbs">
      {images.map((i: any, idx: number) =>
        <button type="button" key={i.id} className="thumb-btn" aria-pressed={idx === main}
          onClick={() => setMain(idx)}>
          <img src={i.url} alt={i.alt_ur || p.name_ur} width={72} height={72} loading="lazy" decoding="async" />
        </button>)}
    </div>}
  </div>;
}

export function ProductDetail({ slug }: { slug: string }) {
  const { t, lang, bi, setPageName } = useApp();
  const { data, isLoading, error, refetch } = useGet<any>('public-product', `/api/v1/public/product/${slug}`);
  const { setLines } = useCart();
  const home = useGet<any>('public-home', '/api/v1/public/home');
  const nav = useNavigate();
  const [qty, setQty] = useState(1);
  const p = data?.product;
  const b = home.data?.business;
  const name = lang === 'ur' ? (p?.name_ur || p?.name_en) : (p?.name_en || p?.name_ur);

  useEffect(() => { setPageName(name || ''); }, [name, setPageName]);

  if (isLoading) return <div className="pub-container pub-with-nav"><Skeleton rows={6} /></div>;
  if (error) return <div className="pub-container pub-with-nav"><ErrorState error={error} retry={() => refetch()} /></div>;
  if (!p) return <div className="pub-container pub-with-nav"><EmptyForProducts whatsapp={b?.whatsapp1} /></div>;

  const line = {
    product_id: p.id, slug: p.slug, name_ur: p.name_ur, name_en: p.name_en, unit: p.base_unit ?? 'BF',
    qty_milli: Math.max(1, Math.round(qty * 1000)),
    price_paisa: p.show_public_price ? (p.public_price_paisa ?? null) : null,
    img: productMedia(p)?.src, alt: productMedia(p)?.alt,
  };
  const add = () => setLines(addLine(line));
  const orderNow = () => { add(); nav('/checkout'); };
  const waText = `السلام علیکم، مجھے ${p.name_ur ?? name} (${qty} ${p.base_unit ?? ''}) چاہیے: ${window.location.href}`;

  const specs: [string, ReactNode][] = [
    [t('unit'), p.base_unit ?? '—'], ['SKU', p.sku ?? '—'],
    [t('categories'), bi(p.category_ur, p.category_en) || '—'],
    [t('brand'), bi(p.brand_ur, p.brand_en) || '—'],
    [t('status'), <StatusBadge availability={p.availability} />],
  ];

  return <div className="pub-container pub-with-nav">
    <nav className="breadcrumb small" aria-label={t('location')}>
      <Link to="/">{t('home')}</Link> › <Link to="/products">{t('products')}</Link> › {name}
    </nav>
    <div className="product-detail">
      <ProductGallery p={p} />
      <div className="product-info">
        <div className="row"><Chip>{bi(p.category_ur, p.category_en)}</Chip><StatusBadge availability={p.availability} /></div>
        <h1 className="h-nastaliq">{name}</h1>
        <div className="small">{(lang === 'ur' ? p.name_en : p.name_ur) || ''}{p.brand_ur ? ` · ${bi(p.brand_ur, p.brand_en)}` : ''}</div>
        <div className="price-lg">{p.show_public_price
          ? <>{formatPKR(p.public_price_paisa)} <span className="price-per">/ {p.base_unit}</span></>
          : t('contactForPrice')}</div>

        <div className="qty-row">
          <span className="qty-label">{t('quantity')}</span>
          <div className="stepper">
            <button type="button" className="step" onClick={() => setQty((v) => Math.max(1, v - 1))}
              aria-label={lang === 'ur' ? 'کم کریں' : 'Decrease'}>−</button>
            <input className="num" type="number" min={1} step={1} value={qty} aria-label={t('quantity')}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
            <button type="button" className="step" onClick={() => setQty((v) => v + 1)}
              aria-label={lang === 'ur' ? 'زیادہ کریں' : 'Increase'}>+</button>
          </div>
          {p.show_public_price && <span className="qty-total num">{formatPKR((p.public_price_paisa ?? 0) * qty)}</span>}
        </div>

        <div className="btn-row pd-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={orderNow}>{t('orderNow')}</button>
          <Button variant="secondary" onClick={add}>{t('addToCart')}</Button>
          <a className="btn btn-wa" target="_blank" rel="noreferrer" href={waLink(b?.whatsapp1, waText)}>
            {t('askWhatsapp')}</a>
        </div>
        <p className="small pd-note">{t('cartNote')}</p>

        <div className="card">
          <h2 style={{ fontSize: 18 }}>{t('detailedForm')}</h2>
          <div className="kv">{specs.map(([k, v]) => <div key={k}><span className="k">{k}</span><span className="v">{v}</span></div>)}</div>
        </div>
        {(p.description_ur || p.description_en) && <div className="card cms-body">
          <h2 style={{ fontSize: 18 }}>{t('description')}</h2>
          <div dangerouslySetInnerHTML={{ __html: (lang === 'ur' ? p.description_ur : p.description_en) || p.description_ur || '' }} />
        </div>}
      </div>
    </div>
    {!!data?.related?.length && <section className="section">
      <SectionHead title={t('featured')} kicker={<Eyebrow>{t('products')}</Eyebrow>} />
      <div className="products-grid">{data.related.map((r: any) => <ProductCard key={r.id} p={r} business={b} />)}</div>
    </section>}
  </div>;
}
