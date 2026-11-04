/**
 * Visitor cart for the public site. There is no cart endpoint in the API, so the cart is a local,
 * per-device basket with two exits: POST /api/v1/public/enquiry (ask) and
 * POST /api/v1/public/checkout (order, which the server re-prices from the catalogue).
 * Nothing here touches stock, ledger or D1 — an order only becomes a sale when an admin approves it.
 */
import { useEffect, useState } from 'react';

export interface CartLine {
  product_id: string;
  slug?: string;
  name_ur: string;
  name_en?: string;
  unit: string;
  qty_milli: number;      // 1000 = 1 unit (matches the API's qty_milli)
  price_paisa: number | null;  // public price only; null = "price on call"
  img?: string;
  alt?: string;
}

const KEY = 'zt_cart_v1';
export const CART_MAX_LINES = 30;
export const CART_EVENT = 'zt-cart';

export function readCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((l: any) => l && typeof l.product_id === 'string' && Number.isFinite(l.qty_milli))
      .slice(0, CART_MAX_LINES);
  } catch { return []; }
}

function persist(lines: CartLine[]) {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(CART_EVENT));
  return lines;
}

export function addLine(line: Omit<CartLine, 'qty_milli'> & { qty_milli?: number }): CartLine[] {
  const lines = readCart();
  const qty = line.qty_milli && line.qty_milli > 0 ? line.qty_milli : 1000;
  const existing = lines.find((l) => l.product_id === line.product_id);
  if (existing) existing.qty_milli += qty;
  else lines.push({ ...line, qty_milli: qty });
  return persist(lines.slice(0, CART_MAX_LINES));
}

export function setQty(productId: string, qty_milli: number): CartLine[] {
  const lines = readCart();
  const l = lines.find((x) => x.product_id === productId);
  if (l) l.qty_milli = Math.max(0, Math.round(qty_milli));
  return persist(l && l.qty_milli === 0 ? lines.filter((x) => x.product_id !== productId) : lines);
}

export function removeLine(productId: string): CartLine[] {
  return persist(readCart().filter((l) => l.product_id !== productId));
}

export function clearCart(): CartLine[] { return persist([]); }

export const cartCount = (lines: CartLine[]) => lines.length;

/** Sum is only meaningful where the shop publishes a public price; partial totals are flagged. */
export function cartTotal(lines: CartLine[]): { paisa: number; priced: number; unpriced: number } {
  let paisa = 0, priced = 0, unpriced = 0;
  for (const l of lines) {
    if (l.price_paisa === null || l.price_paisa === undefined) { unpriced++; continue; }
    priced++;
    paisa += Math.round((l.price_paisa * l.qty_milli) / 1000);
  }
  return { paisa, priced, unpriced };
}

/** Lines in exactly the shape enquirySchema expects. */
export function enquiryItems(lines: CartLine[]) {
  return lines.slice(0, CART_MAX_LINES).map((l) => ({ product_id: l.product_id, qty_milli: l.qty_milli, unit: l.unit }));
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>(() => readCart());
  useEffect(() => {
    const sync = () => setLines(readCart());
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CART_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return { lines, setLines, total: cartTotal(lines), count: lines.length };
}
