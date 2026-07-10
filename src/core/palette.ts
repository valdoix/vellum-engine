import { hash01 } from './ids.js';

/**
 * Shared deterministic color palette for cast characters. Pure functions
 * (no DOM, no spindle) so both frontend and backend can compute identical colors.
 * 
 * The core is a collision-free 24-slot hue wheel: each character is hashed to
 * a slot, linear-probed to the next free slot on collision, then mapped to a
 * distinct hue. Lightness banding handles the 25th+ character. This ensures
 * every cast member gets a readable, distinct color without manual picking.
 */

export const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Guard a model/user-authored color before it goes into a style attribute.
 * Only a strict 6-digit hex passes; anything else falls back to neutral. */
export function safeColor(color: unknown, fallback = '#8c8478'): string {
  return typeof color === 'string' && HEX6.test(color) ? color : fallback;
}

/** Convert HSL (h:0-360, s:0-100, l:0-100) to #rrggbb hex. */
export function hslHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}

const WHEEL = 24;                 // distinct hue slots before lightness banding
const SLOT_DEG = 360 / WHEEL;

/** Assign each cast id to a collision-free slot on the 24-hue wheel (sorted for
 * stability; linear probing on collision). Returns id→slot map. */
function buildSlotMap(castIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  const taken = new Set<number>();
  for (const cid of [...castIds].sort()) {
    let slot = Math.floor(hash01(cid) * WHEEL) % WHEEL;
    let guard = 0;
    while (taken.has(slot) && guard < WHEEL) { slot = (slot + 1) % WHEEL; guard++; }
    taken.add(slot);
    map.set(cid, slot);
  }
  return map;
}

/** Solid color for a character slot. `band` (from how many times the wheel
 * wrapped) nudges lightness so a 25th+ character still reads apart. */
function slotColor(slot: number, band = 0, hueShift = 0): string {
  const h = (slot * SLOT_DEG + hueShift + 360) % 360;
  const l = 68 - (band % 3) * 7;   // 68 / 61 / 54 lightness bands
  const s = 60 + (slot % 2) * 6;   // gentle sat alternation for adjacent hues
  return hslHex(h, s, l);
}

/**
 * Compute collision-free cast colors: id → #hex. Each character gets a distinct
 * hue from the 24-slot wheel; lightness banding handles 25+ characters.
 * 
 * @param castIds - all cast member ids (order doesn't matter; sorted internally)
 * @returns Map of id → #hex color
 */
export function castSlotColors(castIds: string[]): Map<string, string> {
  const slotMap = buildSlotMap(castIds);
  const colors = new Map<string, string>();
  const sorted = [...castIds].sort();
  for (const id of castIds) {
    const slot = slotMap.get(id) ?? (Math.floor(hash01(id) * WHEEL) % WHEEL);
    const band = Math.floor(sorted.indexOf(id) / WHEEL);
    colors.set(id, slotColor(slot, band));
  }
  return colors;
}

/**
 * Deterministic color from a seed string (fallback for ids not in the cast set).
 * Mid-high lightness + saturation so it reads on dark surfaces.
 */
export function autoHue(seed: string, shift = 0): string {
  const h = Math.floor(hash01(seed) * 360 + shift) % 360;
  return hslHex(h, 60, 68);
}
