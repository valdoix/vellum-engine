import type { ChronicleState, Relation, CastCard } from '../domain/types.js';
import { hash01 } from '../core/ids.js';

/** Small formatting helpers shared across UI components. Pure, no DOM. */

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** One empty-state shape + voice across every tab: a short line + optional muted
 * hint. Replaces the ad-hoc mix of bare "—", terse strings, and <br><span> hints. */
export function emptyState(msg: string, hint?: string): string {
  return `<div class="vle-empty sm">${esc(msg)}${hint ? `<br><span>${esc(hint)}</span>` : ''}</div>`;
}

/** One section-header construction for the whole UI. Two roles, both reusing the
 * already-styled classes so there's no visual regression — the win is a single
 * path (consistent markup + escaping) instead of hand-built header strings:
 *  - top  (default): section title left + optional action(s) right (vle-sec-top)
 *  - sub  ({sub:true}): glyph + title + count chip + optional inline action (vle-sec-h)
 * `action` is developer-authored literal HTML (e.g. an add button), not user data. */
export function sectionHeader(title: string, opts: { glyph?: string; count?: number; action?: string; sub?: boolean; gap?: boolean } = {}): string {
  if (opts.sub) {
    const g = opts.glyph ? esc(opts.glyph) + ' ' : '';
    const c = opts.count !== undefined ? ` <span class="vle-n">${opts.count}</span>` : '';
    return `<div class="vle-sec-h">${g}${esc(title)}${c}${opts.action ?? ''}</div>`;
  }
  return `<div class="vle-sec-top${opts.gap ? ' vle-sec-gap' : ''}"><span class="vle-sec-title">${esc(title)}</span>${opts.action ?? ''}</div>`;
}

export function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export const CAT_COLORS: Record<string, string> = {
  familial: '#cda84e', romantic: '#c97a9a', alliance: '#8fa67e',
  rivalry: '#c96a6a', social: '#7ea6b0', neutral: '#8c8478',
};

export const SENT_LABEL: Record<string, string> = {
  warm: '\u2665 warm', hostile: '\u2694 hostile', strained: '\u26A1 strained',
  complex: '\u269C complex', neutral: '\u25CB neutral',
};

export function nameOf(state: ChronicleState, id: string): string {
  return state.cast[id]?.name ?? id;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * AUTO name color: derive a stable, distinct color per character from their id,
 * so the whole cast gets readable, consistent colors without manual picking.
 * Mode is persisted (localStorage); an EXPLICIT per-character color always wins.
 *   off      → inherited ink (today's default)
 *   solid    → one deterministic hue
 *   gradient → that hue → a complementary-ish second hue
 */
type AutoMode = 'off' | 'solid' | 'gradient';
const AKEY = 'vellum2.autoname';
let _auto: AutoMode = loadAuto();
function loadAuto(): AutoMode { try { const v = localStorage.getItem(AKEY); return v === 'solid' || v === 'gradient' ? v : 'off'; } catch { return 'off'; } }
export function autoNameMode(): AutoMode { return _auto; }
export function setAutoNameMode(m: AutoMode): void { _auto = m; try { if (m === 'off') localStorage.removeItem(AKEY); else localStorage.setItem(AKEY, m); } catch { /* ignore */ } }

/** Deterministic, readable HSL hex from a seed. Mid-high lightness + saturation
 * so it reads on the dark VELLUM surfaces; hue spread across the wheel by hash. */
function autoHue(seed: string, shift = 0): string {
  const h = Math.floor(hash01(seed) * 360 + shift) % 360;
  return hslHex(h, 60, 68);
}
function hslHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}

/** Resolve the [color, colorTo?] a name should render with: explicit card colors
 * win; else the auto mode derives from the id; else none. */
function resolveColor(id: string, color?: string, colorTo?: string): { c: string; to: string } {
  const c = color && HEX6.test(color) ? color : '';
  if (c) return { c, to: colorTo && HEX6.test(colorTo) ? colorTo : '' };
  if (_auto === 'off' || !id) return { c: '', to: '' };
  const base = autoHue(id);
  return { c: base, to: _auto === 'gradient' ? autoHue(id, 150) : '' };
}

function paint(label: string, c: string, to: string): string {
  if (!c) return label;
  if (to) return `<span class="vle-name vle-name--grad" style="--c1:${c};--c2:${to}">${label}</span>`;
  const lift = lowContrast(c) ? ' vle-name--lift' : '';
  return `<span class="vle-name${lift}" style="color:${c}">${label}</span>`;
}

/**
 * Render a character's name with color, applied everywhere names show. Priority:
 * explicit per-character color/gradient → auto mode (deterministic per id) →
 * plain ink. Hex is re-validated (defense in depth) so a bad value can't inject
 * style; the name is always escaped. */
export function nameHtml(state: ChronicleState, id: string): string {
  const c = state.cast[id];
  const { c: col, to } = resolveColor(id, c?.color, c?.colorTo);
  return paint(esc(c?.name ?? id), col, to);
}

/** Like nameHtml but from a CastCard directly (call sites that already hold the
 * card, e.g. the cast grid). */
export function nameHtmlCard(c: CastCard): string {
  const { c: col, to } = resolveColor(c.id, c.color, c.colorTo);
  return paint(esc(c.name), col, to);
}

/** Relative luminance (0..1) of a #rrggbb, per WCAG. For the contrast guardrail. */
export function luminance(hex: string): number {
  if (!HEX6.test(hex)) return 0.5;
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** True if a color is likely too low-contrast to read as a name on the dark-ish
 * VELLUM surfaces (advisory — used to warn, not block). */
export function lowContrast(hex: string): boolean {
  return luminance(hex) < 0.12; // very dark text on a dark surface
}

export function catsOf(r: Relation): string[] {
  return r.categories.length ? r.categories : [r.category || 'neutral'];
}

export type ChipTone = 'gold' | 'pos' | 'neg' | 'info' | 'warn' | 'press' | 'muted';
/** Unified chip: one shape (.v-chip), tone drives color only. `solid` fills. */
export function chip(label: string, tone: ChipTone = 'gold', solid = false): string {
  return `<span class="v-chip v-chip--${tone}${solid ? ' v-chip--solid' : ''}">${esc(label)}</span>`;
}

export function byRecent<T extends { lastTurn?: number }>(a: T, b: T): number {
  return (b.lastTurn ?? 0) - (a.lastTurn ?? 0);
}

/** A -100..100 diverging meter (affection/trust/standing). Pure HTML; uses the
 * shared .vle-bar* classes + --v-pos/--v-neg tokens. */
export function bar(label: string, v: number): string {
  const n = Math.max(-100, Math.min(100, v || 0));
  const pct = Math.abs(n) / 2; const pos = n >= 0;
  return '<div class="vle-bar"><span class="vle-bar-l">' + esc(label) + '</span>'
    + '<span class="vle-bar-t"><span class="vle-bar-mid"></span>'
    + '<span class="vle-bar-f ' + (pos ? 'pos' : 'neg') + '" style="' + (pos ? 'left:50%;width:' + pct + '%' : 'right:50%;width:' + pct + '%') + '"></span></span>'
    + '<span class="vle-bar-v ' + (pos ? 'pos' : 'neg') + '">' + (n > 0 ? '+' : '') + n + '</span></div>';
}

/** One diverging row inside a bondMeter: a short caption + a bar from a shared
 * center zero. axis picks the fill color (aff=--v-pos, trust=--v-info). */
function bondRow(caption: string, v: number, axis: 'aff' | 'trust'): string {
  const n = Math.max(-100, Math.min(100, v || 0));
  const pct = Math.abs(n) / 2; const pos = n >= 0;
  const fill = axis === 'aff' ? 'tw-aff' : 'tw-trust';
  return '<div class="vle-bm-row"><span class="vle-bm-cap">' + esc(caption) + '</span>'
    + '<span class="vle-tw-t"><span class="vle-tw-mid"></span>'
    + '<span class="vle-tw-f ' + fill + (pos ? '' : ' neg') + '" style="' + (pos ? 'left:50%;width:' + pct + '%' : 'right:50%;width:' + pct + '%') + '"></span></span>'
    + '<span class="vle-tw-v">' + (n > 0 ? '+' : '') + n + '</span></div>';
}

/**
 * The shared bond meter (mockup 06): BOTH directions of a pair interleaved per
 * axis against one visible center zero, so asymmetry (she mistrusts, he trusts)
 * reads at a glance. `dirs` is 1–2 directed edges (A→B and/or B→A). `lead` is the
 * stable first endpoint id so captions read consistently. Pure HTML; theme skins
 * (radar/shield) replace this in their renderers, defaults/modern use it. */
export function bondMeter(dirs: { a: string; b: string; affection: number; trust: number }[], nameFor: (id: string) => string): string {
  if (!dirs.length) return '';
  const cap = (d: { a: string; b: string }): string => abbr(nameFor(d.a)) + '\u2192' + abbr(nameFor(d.b));
  const aff = dirs.map((d) => bondRow(cap(d), d.affection, 'aff')).join('');
  const tru = dirs.map((d) => bondRow(cap(d), d.trust, 'trust')).join('');
  return '<div class="vle-bm">'
    + '<div class="vle-bm-axis"><span class="vle-bm-axl">affection</span>' + aff + '</div>'
    + '<div class="vle-bm-axis"><span class="vle-bm-axl">trust</span>' + tru + '</div>'
    + '</div>';
}

/** Short caption form of a name (first token, capped) for tight meter rows. */
function abbr(name: string): string {
  const first = (name || '').trim().split(/\s+/)[0] || name || '?';
  return first.length > 8 ? first.slice(0, 7) + '\u2026' : first;
}

export function castByStatus(state: ChronicleState): { present: CastCard[]; active: CastCard[]; mentioned: CastCard[]; added: CastCard[] } {
  const all = Object.values(state.cast);
  return {
    present: all.filter((c) => c.status === 'present').sort(byRecent),
    active: all.filter((c) => c.status === 'active').sort(byRecent),
    mentioned: all.filter((c) => c.status === 'mentioned').sort(byRecent),
    added: all.filter((c) => c.status === 'added').sort((a, b) => a.name.localeCompare(b.name)),
  };
}
