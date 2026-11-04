/**
 * Photo — the only way images reach the DOM on the redesigned site.
 * Real product uploads (R2 via /media/<key>) always win; bundled WebP variants are the
 * brand-quality fallback. No emoji and no inline SVG icons anywhere: empty states use a
 * typographic monogram, everything else is photography or CSS.
 */
import React, { type CSSProperties } from 'react';
import { IMAGES, type ImageKey, type ImageVariant } from '../images.js';
import type { PhotoRef } from '../media.js';

export interface PhotoProps {
  src?: string | null;
  alt: string;
  variant?: ImageVariant;
  /** Rendered aspect ratio, e.g. 1 for square cards or 16/9 for hero panels. */
  ratio?: number;
  eager?: boolean;
  className?: string;
  sizes?: string;
  objectFit?: 'cover' | 'contain';
  /** Soft blur-up using the same URL as a tiny background is not possible offline, so we tint instead. */
  tint?: string;
}

export function Photo({ src, alt, variant = 'md', ratio = 1, eager = false, className = '',
  sizes, objectFit = 'cover', tint }: PhotoProps) {
  const style = { '--photo-ratio': String(ratio), ...(tint ? { '--photo-tint': tint } : {}) } as CSSProperties;
  if (!src) return <div className={`photo photo-empty ${className}`} style={style} role="img" aria-label={alt}>
    <span className="photo-monogram" aria-hidden="true">{monogram(alt)}</span>
    <span className="photo-empty-label">{alt}</span>
  </div>;
  return <div className={`photo ${className}`} style={style}>
    <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async"
      {...(eager ? { fetchpriority: 'high' } : {})} sizes={sizes}
      style={{ objectFit }} width={600} height={Math.round(600 / ratio)} />
  </div>;
}

function monogram(text: string): string {
  const clean = (text || '').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return 'ZT';
  if (words.length === 1) return words[0].slice(0, 2);
  return `${words[0][0]}${words[1][0]}`;
}

/** Resolve a central-map entry to a URL without every call site importing IMAGES. */
export function refSrc(ref: PhotoRef | undefined, variant: ImageVariant = 'md'): string | undefined {
  if (!ref) return undefined;
  return IMAGES[ref.key as ImageKey]?.[variant];
}

export function keySrc(key: string | undefined, variant: ImageVariant = 'md'): string | undefined {
  if (!key) return undefined;
  return IMAGES[key as ImageKey]?.[variant];
}

export { IMAGES };
export type { ImageKey, ImageVariant, PhotoRef };
