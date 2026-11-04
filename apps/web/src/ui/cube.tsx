/**
 * HeroCube — the signature 3D block. Its four faces are live product cards (photo, name, public
 * price) whenever the catalogue has priced items, and fall back to the four brand photographs on a
 * fresh/empty shop. Auto-rotating, pause on hover/focus, drag or swipe to spin, dots and arrow keys
 * for keyboard users, and it stops entirely for prefers-reduced-motion. Pure CSS 3D: no WebGL.
 */
import React, { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { HERO_CUBE, productMedia, type PhotoRef } from '../media.js';
import { IMAGES } from '../images.js';
import { useReducedMotion } from './motion.js';
import { useApp } from '../app-state.js';
import { formatPKR } from '@zt/shared';

const STEP = 90;
const AUTO_MS = 4200;
/** Degrees per pixel of pointer travel, so a short flick still turns the box. */
const DRAG_SENSITIVITY = 0.85;

/** A cube face is either a brand photo or a catalogue product — the card renders whichever arrives. */
export type CubeFace =
  | { kind: 'photo'; key: string; alt_ur: string; alt_en: string }
  | { kind: 'product'; key: string; alt_ur: string; alt_en: string; name_ur: string; name_en?: string;
      slug: string; price_paisa: number | null; unit: string; img?: string };

function toFaces(faces: PhotoRef[]): CubeFace[] {
  return faces.map((f) => ({ kind: 'photo' as const, key: f.key, alt_ur: f.alt_ur, alt_en: f.alt_en }));
}

/** Four distinct priced products make the best faces; fall back to the brand photos when short. */
export function cubeFaces(products: any[], fallback: PhotoRef[] = HERO_CUBE): CubeFace[] {
  const picked: CubeFace[] = [];
  for (const p of products) {
    if (picked.length >= 4) break;
    if (!p?.slug || !p?.name_ur) continue;
    const media = productMedia(p);
    const alt = media?.alt || p.name_ur;
    picked.push({
      kind: 'product', key: `p:${p.slug}`, slug: p.slug,
      name_ur: p.name_ur, name_en: p.name_en, unit: p.base_unit ?? '',
      price_paisa: p.show_public_price ? (p.public_price_paisa ?? null) : null,
      img: media?.src, alt_ur: alt, alt_en: p.name_en || alt,
    });
  }
  // Guarantee a complete solid 4-sided cube: pad with fallback photos if fewer than 4 items
  if (picked.length < 4) {
    const fb = toFaces(fallback);
    for (const f of fb) {
      if (picked.length >= 4) break;
      picked.push(f);
    }
  }
  return picked;
}

/** How square a side face is to the eye: 1 facing us, 0 edge-on. Drives the shading overlay. */
const litFor = (rotationDeg: number, index: number) =>
  Math.max(0, Math.cos(((rotationDeg - STEP * index) * Math.PI) / 180));

export function HeroCube({ faces, products, className = '' }: {
  faces?: PhotoRef[]; products?: any[]; className?: string;
}) {
  const { lang, t } = useApp();
  const reduced = useReducedMotion();
  const items: CubeFace[] = products?.length ? cubeFaces(products) : toFaces(faces ?? HERO_CUBE);
  const [face, setFace] = useState(0);
  const [dragging, setDragging] = useState(false);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const faceRefs = useRef<(HTMLDivElement | null)[]>([]);
  const angleRef = useRef(0);
  const dragDeg = useRef(0);
  const startX = useRef(0);
  const draggingRef = useRef(false);
  const activeFaceRef = useRef(0);
  const speedRef = useRef(38); // continuous 38 deg/sec for smooth noticeable 3D spinning
  const count = items.length || 1;

  /** The one place rotation is applied: the body's CSS var, plus per-face lighting for depth.
   *  Direct DOM CSS custom property mutation avoids re-rendering all faces on every pointer tick. */
  const paint = (deg: number) => {
    const body = bodyRef.current;
    if (!body) return;
    body.style.setProperty('--cube-rot', `${deg}deg`);
    for (let i = 0; i < items.length; i++) {
      faceRefs.current[i]?.style.setProperty('--lit', litFor(deg, i).toFixed(3));
    }
  };

  /** Rotate continuously forward in one direction — never rewinding or spinning backward. */
  const stepForward = () => {
    angleRef.current -= STEP;
    const nextFace = (Math.round(-angleRef.current / STEP) % count + count) % count;
    activeFaceRef.current = nextFace;
    setFace(nextFace);
    paint(angleRef.current);
  };

  const stepBackward = () => {
    angleRef.current += STEP;
    const nextFace = (Math.round(-angleRef.current / STEP) % count + count) % count;
    activeFaceRef.current = nextFace;
    setFace(nextFace);
    paint(angleRef.current);
  };

  /** Navigate to a specific face using the shortest angular path. */
  const goToFace = (targetIndex: number) => {
    dragDeg.current = 0;
    const currentNormalized = (Math.round(-angleRef.current / STEP) % count + count) % count;
    let diff = targetIndex - currentNormalized;
    if (diff > count / 2) diff -= count;
    if (diff < -count / 2) diff += count;
    angleRef.current -= diff * STEP;
    activeFaceRef.current = targetIndex;
    setFace(targetIndex);
    paint(angleRef.current);
  };

  // Continuous auto-spinning loop at smooth 60fps/120fps via requestAnimationFrame
  useEffect(() => {
    if (reduced) return;
    let animId: number;
    let lastTime = performance.now();
    const tick = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      if (!draggingRef.current) {
        angleRef.current -= speedRef.current * dt;
        paint(angleRef.current);
        const nextFace = (Math.round(-angleRef.current / STEP) % count + count) % count;
        if (nextFace !== activeFaceRef.current) {
          activeFaceRef.current = nextFace;
          setFace(nextFace);
        }
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [reduced, count]);

  // Initial paint
  useEffect(() => { paint(angleRef.current); }, [items.length, reduced]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!groupRef.current?.contains(document.activeElement)) return;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        stepForward();
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        stepBackward();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [count]);

  const onDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (ev.button) return;
    startX.current = ev.clientX;
    dragDeg.current = 0;
    draggingRef.current = true;
    setDragging(true);
    // Mouse and pen may capture; a touch must not — capturing touch blocks scrolling past the hero.
    if (ev.pointerType !== 'touch') stageRef.current?.setPointerCapture?.(ev.pointerId);
  };

  const onMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    dragDeg.current = (ev.clientX - startX.current) * DRAG_SENSITIVITY;
    paint(angleRef.current + dragDeg.current);
  };

  const onUp = () => {
    if (!draggingRef.current) return;
    angleRef.current += dragDeg.current;
    dragDeg.current = 0;
    draggingRef.current = false;
    setDragging(false);
    const nextFace = (Math.round(-angleRef.current / STEP) % count + count) % count;
    activeFaceRef.current = nextFace;
    setFace(nextFace);
    paint(angleRef.current);
  };

  const current = items[face];
  const label = current ? (lang === 'ur' ? current.alt_ur : current.alt_en) : '';
  const showCaption = items[0]?.kind === 'photo';

  return <div className={`cube ${className}`} ref={groupRef}
    onPointerEnter={() => { speedRef.current = 14; }}
    onPointerLeave={() => { speedRef.current = 38; onUp(); }}
    onFocus={() => { speedRef.current = 14; }}
    onBlur={() => { speedRef.current = 38; }}
    tabIndex={0} role="group"
    aria-label={lang === 'ur' ? 'گھومتا 3D مصنوعات کیوب — تیر کے نشان سے گھمائیں' : 'Rotating 3D product cube — use arrow keys to turn'}>
    <div className="cube-glow" aria-hidden="true" />
    <div className="cube-stage" data-drag={dragging} ref={stageRef}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="cube-body" ref={bodyRef}>
        {items.map((f, i) => <div className={`cube-face ${i === face ? 'cube-face-active' : ''}`}
          key={f.key} ref={(el) => { faceRefs.current[i] = el; }}
          style={{ transform: `rotateY(${STEP * i}deg) translateZ(var(--cube-half))` } as CSSProperties}
          aria-hidden={i === face ? undefined : true}>
          {f.kind === 'product'
            ? <CubeProductCard face={f} active={i === face} lang={lang} t={t} />
            : <><img src={IMAGES[f.key as keyof typeof IMAGES]?.lg} alt={lang === 'ur' ? f.alt_ur : f.alt_en}
                loading={i === 0 ? 'eager' : 'lazy'} decoding="async" width={760} height={646} />
              <span className="cube-face-rim" aria-hidden="true" /></>}
          {/* Angle shading: a face darkens as it turns away, which is what reads as a solid box. */}
          <span className="cube-face-shade" aria-hidden="true" />
        </div>)}
        <span className="cube-face cube-face-top" aria-hidden="true" />
        <span className="cube-face cube-face-bottom" aria-hidden="true" />
      </div>
      <span className="cube-shadow" aria-hidden="true" />
    </div>
    {showCaption && <div className="cube-caption" key={face}>{label}</div>}
    <div className="cube-dots" role="tablist" aria-label={lang === 'ur' ? 'کیوب کے رخ' : 'Cube faces'}>
      {items.map((f, i) => <button type="button" key={f.key} role="tab"
        className={`cube-dot ${i === face ? 'cube-dot-active' : ''}`}
        aria-selected={i === face} aria-label={lang === 'ur' ? f.alt_ur : f.alt_en}
        onClick={() => goToFace(i)} />)}
    </div>
  </div>;
}

/** The face itself: product photo + name + public price, and it is a real link once it faces you. */
function CubeProductCard({ face, active, lang, t }: { face: Extract<CubeFace, { kind: 'product' }>; active: boolean; lang: string; t: (k: string) => string }) {
  const name = lang === 'ur' ? face.name_ur : (face.name_en || face.name_ur);
  const inner = <>
    {face.img ? <img src={face.img} alt={lang === 'ur' ? face.alt_ur : face.alt_en}
      loading={active ? 'eager' : 'lazy'} decoding="async" width={760} height={646} />
      : <span className="cube-face-blank" aria-hidden="true">{name.slice(0, 2)}</span>}
    <span className="cube-face-rim" aria-hidden="true" />
    <span className="cube-face-card">
      <strong className="cube-face-name">{name}</strong>
      <span className="cube-face-price num">
        {face.price_paisa != null ? `${formatPKR(face.price_paisa)} / ${face.unit}` : t('contactForPrice')}
      </span>
    </span>
  </>;
  if (!active) return <div className="cube-face-inner">{inner}</div>;
  // Only the forward-facing card is focusable, so the tab order matches what the eye can read.
  return <Link to={`/product/${face.slug}`} className="cube-face-inner cube-face-link">{inner}</Link>;
}
