/**
 * Motion primitives — CSS custom properties + IntersectionObserver only, no animation library.
 * Everything animates transform/opacity, never layout, and every hook short-circuits when the
 * visitor asks for reduced motion or when the pointer is coarse (touch tilt fights scrolling).
 */
import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Scroll-triggered entrance. The element is never invisible to screen readers or to no-JS. */
export function Reveal({ children, className = '', delay = 0, once = true, as: Tag = 'div' }: {
  children: ReactNode; className?: string; delay?: number; once?: boolean;
  as?: 'div' | 'section' | 'li' | 'article' | 'header' | 'footer';
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setShown(true);
        if (once) io.disconnect();
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, once]);

  return <Tag ref={ref as never}
    className={`reveal ${shown ? 'reveal-in' : ''} ${className}`.trim()}
    style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}>{children}</Tag>;
}

/** 3D tilt that writes --tilt-x/--tilt-y; the transform lives in the stylesheet.
 *  The ref is mutable so a caller can point two of these hooks at one element. */
export function useTilt<T extends HTMLElement>(strength = 8): React.MutableRefObject<T | null> {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    if (matchMedia?.('(hover: none)').matches) return;
    let frame = 0;
    const set = (x: number, y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--tilt-x', `${y.toFixed(2)}deg`);
        el.style.setProperty('--tilt-y', `${(-x).toFixed(2)}deg`);
      });
    };
    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      set(((ev.clientX - r.left) / r.width - 0.5) * 2 * strength,
        ((ev.clientY - r.top) / r.height - 0.5) * 2 * strength);
    };
    const onLeave = () => set(0, 0);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointercancel', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointercancel', onLeave);
    };
  }, [strength, reduced]);
  return ref;
}

/** Writes --parallax (0 → 1) as the element travels through the viewport. */export function useParallax<T extends HTMLElement>(ref: RefObject<T | null>): void {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const update = () => {
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
        el.style.setProperty('--parallax', (p - 0.5).toFixed(4));
      }
      frame = 0;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ref, reduced]);
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
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
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

/** Pointer spotlight: writes --mx/--my (percentages) for the radial highlight in .spot::after. */
export function useSpot<T extends HTMLElement>(): React.MutableRefObject<T | null> {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || matchMedia?.('(hover: none)').matches) return;
    let frame = 0;
    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = ((ev.clientX - r.left) / r.width) * 100;
      const y = ((ev.clientY - r.top) / r.height) * 100;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--mx', `${x.toFixed(1)}%`);
        el.style.setProperty('--my', `${y.toFixed(1)}%`);
      });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointercancel', () => { cancelAnimationFrame(frame); });
    return () => { cancelAnimationFrame(frame); el.removeEventListener('pointermove', onMove); };
  }, [reduced]);
  return ref;
}

/** Seamless kinetic band: one accessible run plus an aria-hidden copy for the loop. */
export function Marquee({ items, seconds = 36, label }: { items: ReactNode[]; seconds?: number; label: string }) {
  const run = (hidden: boolean) => <span className="mq-run" aria-hidden={hidden || undefined}>
    {items.map((x, i) => <span key={i} className="mq-item"><span className="mq-dot" />{x}</span>)}
  </span>;
  return <div className="marquee" role="group" aria-label={label}>
    <div className="marquee-track" style={{ '--mq-dur': `${seconds}s` } as CSSProperties}>{run(false)}{run(true)}</div>
  </div>;
}
