'use client';

// the order a customer is putting together, kept on the phone per business until it is sent
// (thinking/19-orders.md). nothing goes to the server before "send": the cart survives a reload or
// a closed app, and every open page sees the same one.

import { useSyncExternalStore } from 'react';
import type { Uom } from '@custock/core';

export interface CartLine {
  variantId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  uom: Uom;
  // base units like the ledger: pieces, or grams/ml/mm
  qty: number;
}

export interface Cart {
  lines: CartLine[];
  shopId: string | null;
  note: string;
  wantedOn: string | null;
}

const EMPTY: Cart = { lines: [], shopId: null, note: '', wantedOn: null };
const key = (slug: string) => `custock.order.${slug}`;
const cache = new Map<string, Cart>();
const listeners = new Set<() => void>();

// how far one tap on + or - goes, and the smallest amount: a piece, a quarter kilo or litre, 10 cm
export function qtyStep(uom: Uom): number {
  return uom === 'piece' ? 1 : uom === 'm' ? 100 : 250;
}

function read(slug: string): Cart {
  const hit = cache.get(slug);
  if (hit) return hit;
  let cart = EMPTY;
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key(slug));
    if (raw) {
      const v = JSON.parse(raw) as Partial<Cart>;
      cart = {
        lines: Array.isArray(v.lines) ? v.lines.filter((l) => l && typeof l.variantId === 'string' && Number.isFinite(l.qty) && l.qty > 0) : [],
        shopId: typeof v.shopId === 'string' ? v.shopId : null,
        note: typeof v.note === 'string' ? v.note : '',
        wantedOn: typeof v.wantedOn === 'string' ? v.wantedOn : null,
      };
    }
  } catch { /* a broken entry starts empty */ }
  cache.set(slug, cart);
  return cart;
}

function write(slug: string, next: Cart) {
  cache.set(slug, next);
  try {
    if (next.lines.length || next.note || next.wantedOn) localStorage.setItem(key(slug), JSON.stringify(next));
    else localStorage.removeItem(key(slug));
  } catch { /* private mode: it lives as long as the page */ }
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // another tab or the home screen app changed it
  const onStorage = (e: StorageEvent) => {
    if (!e.key?.startsWith('custock.order.')) return;
    cache.delete(e.key.slice('custock.order.'.length));
    fn();
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
}

export function useCart(slug: string): Cart {
  return useSyncExternalStore(subscribe, () => read(slug), () => EMPTY);
}

export function cartCount(cart: Cart): number {
  return cart.lines.length;
}

export function addToCart(slug: string, line: CartLine) {
  const cart = read(slug);
  const found = cart.lines.find((l) => l.variantId === line.variantId);
  const lines = found
    ? cart.lines.map((l) => (l.variantId === line.variantId ? { ...l, ...line, qty: l.qty + line.qty } : l))
    : [...cart.lines, line];
  write(slug, { ...cart, lines });
}

export function setCartQty(slug: string, variantId: string, qty: number) {
  const cart = read(slug);
  const lines = qty > 0 ? cart.lines.map((l) => (l.variantId === variantId ? { ...l, qty } : l)) : cart.lines.filter((l) => l.variantId !== variantId);
  write(slug, { ...cart, lines });
}

export function removeFromCart(slug: string, variantId: string) {
  setCartQty(slug, variantId, 0);
}

// put a removed line back (the undo of a remove)
export function restoreCartLine(slug: string, line: CartLine, index: number) {
  const cart = read(slug);
  if (cart.lines.some((l) => l.variantId === line.variantId)) return;
  const lines = [...cart.lines];
  lines.splice(Math.min(index, lines.length), 0, line);
  write(slug, { ...cart, lines });
}

export function setCartMeta(slug: string, patch: Partial<Omit<Cart, 'lines'>>) {
  write(slug, { ...read(slug), ...patch });
}

export function clearCart(slug: string) {
  write(slug, EMPTY);
}
