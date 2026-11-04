/**
 * Iconography without emoji and without SVG: navigation and status marks are real photographs
 * from the central asset map, and everything else is typographic (monogram) or CSS-shaped.
 */
import React from 'react';
import { IMAGES } from '../images.js';
import { CATEGORY_MEDIA, type PhotoRef } from '../media.js';
import type { ImageKey } from '../images.js';

/** ERP module / nav marks reuse the shop photography so the icon language matches the site. */
export const MODULE_MEDIA: Record<string, ImageKey> = {
  dashboard: 'about/about-showroom', sales: 'about/about-weighing', purchases: 'about/about-delivery',
  inventory: 'about/about-goods', grains: 'categories/cat-wheat', khata: 'about/about-grain-bowls',
  accounts: 'about/about-shop', expenses: 'categories/cat-tools', employees: 'about/about-farmers',
  website: 'hero/hero-bg', documents: 'about/about-warehouse', reports: 'hero/hero-wheat',
  accounting: 'categories/cat-cement', users: 'about/about-farmer', sync: 'products/product-irrigation',
  backup: 'products/product-sprayer', settings: 'categories/cat-seeds', audit: 'about/about-warehouse',
  fertilizer: 'categories/cat-fertilizer', pesticide: 'categories/cat-pesticide',
  cement: 'categories/cat-cement', seeds: 'categories/cat-seeds', tools: 'categories/cat-tools',
  cattle: 'categories/cat-cattle-feed', enquiries: 'products/product-urea',
  parties: 'about/about', products: 'products/product-dap', catalogue: 'categories/cat-seeds',
  status: 'products/product-wheat-1', returns: 'products/product-wheat-bran-1',
  orders: 'products/product-cement', payments: 'products/product-urea',
};

/** Two letters of the label (Urdu or English) — used wherever a photo is unavailable. */
export function Monogram({ text, className = '' }: { text: string; className?: string }) {
  const clean = (text || '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const mark = !words.length ? 'ZT' : words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`;
  return <span className={`mono-mark ${className}`} aria-hidden="true">{mark}</span>;
}

export function ModuleIcon({ name, label, alt }: { name: string; label: string; alt?: boolean }) {
  const key = MODULE_MEDIA[name];
  return <span className="ico">
    {key ? <img src={IMAGES[key].md} alt={alt === false ? '' : label} loading="lazy" decoding="async" width={420} height={357} />
      : <Monogram text={label} />}
  </span>;
}

export function CategoryIcon({ code, label }: { code?: string | null; label: string }) {
  const ref: PhotoRef | undefined = code ? CATEGORY_MEDIA[code.toUpperCase()] : undefined;
  return <span className="ico">
    {ref ? <img src={IMAGES[ref.key].md} alt="" loading="lazy" decoding="async" width={420} height={357} />
      : <Monogram text={label} />}
  </span>;
}

/** CSS speech bubble for the WhatsApp affordances (no emoji, no SVG file). */
export function ChatMark() {
  return <span className="chat-mark" aria-hidden="true" />;
}

/** Nav mark: accepts an ERP module name or a catalogue book code and renders its photo. */
export function NavIcon({ icon, label, size = 26 }: { icon: string; label: string; size?: number }) {
  const cat = CATEGORY_MEDIA[icon?.toUpperCase()];
  const key = cat?.key ?? MODULE_MEDIA[icon];
  return <span className="ico ico-photo" aria-hidden="true">
    {key ? <img src={IMAGES[key].md} alt="" loading="lazy" decoding="async" width={size} height={size} />
      : <Monogram text={label} />}
  </span>;
}
