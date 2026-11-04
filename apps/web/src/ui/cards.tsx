/**
 * Shared 3D building blocks used across the public site and the ERP: layered tilt cards,
 * photographic category tiles (icons are real product photos, never emoji or SVG) and
 * section headings.
 */
import React, { type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSpot, useTilt } from './motion.js';
import { IMAGES } from '../images.js';
import type { PhotoRef } from '../media.js';

/** Depth card: pointer tilt + layered shadow, flattening under reduced motion (CSS). */
export function TiltCard({ children, className = '', href, onClick, tone = 'default', style }: {
  children: ReactNode; className?: string; href?: string; onClick?: () => void;
  tone?: 'default' | 'emerald' | 'gold' | 'pink'; style?: CSSProperties;
}) {
  const ref = useTilt<HTMLDivElement>(7);
  const inner = <div ref={ref} className={`tilt tilt-${tone} ${className}`} style={style}>{children}</div>;
  if (href) return <Link to={href} className="tilt-link">{inner}</Link>;
  if (onClick) return <button type="button" className="tilt-link" onClick={onClick}>{inner}</button>;
  return inner;
}

/** Photographic tile — the site's navigation icon language. */
export function MediaTile({ photo, title, subtitle, badge, href, onClick, size = 'md', active }: {
  photo?: PhotoRef; title: string; subtitle?: string; badge?: ReactNode;
  href?: string; onClick?: () => void; size?: 'sm' | 'md' | 'lg'; active?: boolean;
}) {
  const spot = useSpot<HTMLElement>();
  const tilt = useTilt<HTMLElement>(6);
  // One element, two pointer hooks: the spotlight paints the highlight, the tilt turns the tile.
  const setRef = (el: HTMLElement | null) => { spot.current = el; tilt.current = el; };
  const body = <>
    <span className={`tile-media tile-media-${size}`}>
      {photo ? <img src={IMAGES[photo.key].md} alt="" loading="lazy" decoding="async" width={420} height={357} />
        : <span className="tile-media-fallback" aria-hidden="true">{title.slice(0, 2)}</span>}
      <span className="tile-media-scrim" aria-hidden="true" />
    </span>
    <span className="tile-body">
      <strong className="tile-title">{title}</strong>
      {subtitle && <span className="tile-sub">{subtitle}</span>}
      {badge && <span className="tile-badge">{badge}</span>}
    </span>
    <span className="tile-edge" aria-hidden="true" />
  </>;
  const cls = `tile tile-${size}${size === 'sm' ? '' : ' spot tile-3d'}${active ? ' tile-active' : ''}`;
  const ref = size === 'sm' ? undefined : (setRef as never);
  if (href) return <Link to={href} ref={ref} className={cls}>{body}</Link>;
  return <button type="button" ref={ref} className={cls} onClick={onClick}>{body}</button>;
}

export function SectionHead({ title, kicker, action, center }: {
  title: ReactNode; kicker?: ReactNode; action?: ReactNode; center?: boolean;
}) {
  return <div className={`section-head ${center ? 'section-head-center' : ''}`.trim()}>
    <div>
      {kicker && <div className="section-kicker">{kicker}</div>}
      <h2 className="section-title">{title}</h2>
    </div>
    {action && <div className="section-action">{action}</div>}
  </div>;
}

/** Thin gold rule + eyebrow, used above hero copy and dashboard groups. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow"><span className="eyebrow-rule" aria-hidden="true" />{children}</div>;
}
