/**
 * Motion primitives — Zero lag, high-performance lightweight helpers.
 * Mouse listeners (useTilt, useSpot, useParallax) are completely removed to ensure
 * instantaneous, lag-free mouse movements and 120fps scrolling.
 */
import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

export function useReducedMotion(): boolean {
  return false;
}

/** Instant entrance without reflow delays */
export function Reveal({ children, className = '', as: Tag = 'div' }: {
  children: ReactNode; className?: string; delay?: number; once?: boolean;
  as?: 'div' | 'section' | 'li' | 'article' | 'header' | 'footer';
}) {
  return <Tag className={`reveal reveal-in ${className}`.trim()}>{children}</Tag>;
}

/** Lightweight no-op hook: 0 mousemove/pointermove listeners, 0 getBoundingClientRect reflows */
export function useTilt<T extends HTMLElement>(_strength = 8): React.MutableRefObject<T | null> {
  const ref = useRef<T | null>(null);
  return ref;
}

/** Lightweight no-op hook: 0 mousemove/pointermove listeners */
export function useSpot<T extends HTMLElement>(): React.MutableRefObject<T | null> {
  const ref = useRef<T | null>(null);
  return ref;
}

/** Lightweight no-op hook: 0 scroll reflows */
export function useParallax<T extends HTMLElement>(_ref: RefObject<T | null>): void {
  // disabled for blazing performance
}

/** Scroll progress (0 → 1) of the whole document — used by the header and progress bar. */
export function useScrollProgress(): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setP(h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0);
      frame = 0;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); };
  }, []);
  return p;
}

export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(() => (typeof matchMedia === 'function' ? matchMedia(query).matches : fallback));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Accessible band without continuous layout repaint */
export function Marquee({ items, label }: { items: ReactNode[]; seconds?: number; label: string }) {
  return <div className="marquee" role="group" aria-label={label}>
    <div className="marquee-track" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {items.map((x, i) => <span key={i} className="mq-item"><span className="mq-dot" />{x}</span>)}
    </div>
  </div>;
}
