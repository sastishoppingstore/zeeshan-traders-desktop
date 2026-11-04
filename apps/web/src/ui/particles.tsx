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

export function GoldDust({ count = 18, className = '' }: { count?: number; className?: string }) {
  return <div className={`dust ${className}`} aria-hidden="true">
    {Array.from({ length: count }, (_, i) => {
      const size = 3 + Math.round(rnd(i, 1) * 7);
      const style = {
        '--dust-x': `${(rnd(i, 2) * 100).toFixed(2)}%`,
        '--dust-y': `${(rnd(i, 3) * 100).toFixed(2)}%`,
        '--dust-size': `${size}px`,
        '--dust-dur': `${(9 + rnd(i, 4) * 12).toFixed(2)}s`,
        '--dust-delay': `${(-rnd(i, 5) * 14).toFixed(2)}s`,
        '--dust-drift': `${(-40 + rnd(i, 6) * 80).toFixed(1)}px`,
        '--dust-opacity': (0.18 + rnd(i, 7) * 0.42).toFixed(2),
      } as CSSProperties;
      return <span key={i} className="dust-mote" style={style} />;
    })}
  </div>;
}

export function ScrollProgress({ className = '' }: { className?: string }) {
  const p = useScrollProgress();
  return <div className={`scroll-progress ${className}`} aria-hidden="true"
    style={{ transform: `scaleX(${p.toFixed(4)})` }} />;
}

/** Emerald → gold sheen used behind hero and dashboard panels; purely decorative. */
export function AuroraBg({ className = '' }: { className?: string }) {
  return <div className={`aurora ${className}`} aria-hidden="true">
    <span className="aurora-blob aurora-blob-1" /><span className="aurora-blob aurora-blob-2" />
    <span className="aurora-blob aurora-blob-3" />
  </div>;
}
