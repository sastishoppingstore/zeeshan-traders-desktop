/**
 * Ambient layers — gold dust and the reading-progress bar. CSS keyframes on transform/opacity
 * only (no rAF loop, no canvas), deterministic positions so visual regression baselines stay
 * stable, and both are switched off by prefers-reduced-motion in the stylesheet.
 */
import React, { type CSSProperties } from 'react';
import { useScrollProgress } from './motion.js';

/** Deterministic pseudo-random so the layout never changes between renders or screenshots. */
const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function GoldDust(_props: { count?: number; className?: string }) {
  return null;
}

export function ScrollProgress({ className = '' }: { className?: string }) {
  const p = useScrollProgress();
  return <div className={`scroll-progress ${className}`} aria-hidden="true"
    style={{ transform: `scaleX(${p.toFixed(4)})` }} />;
}

/** Emerald → gold sheen used behind hero and dashboard panels; purely decorative. */
export function AuroraBg(_props: { className?: string }) {
  return null;
}
