import type { ChronicleState, Relation, CastCard } from '../domain/types.js';

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
 * Render a character's name with their optional color/gradient, applied
 * everywhere names show. No color → plain escaped text (today's output). Solid →
 * `color`. Gradient (color + colorTo) → background-clip:text. Hex is re-validated
 * here (defense in depth) so a bad value can't inject style. */
export function nameHtml(state: ChronicleState, id: string): string {
  const c = state.cast[id];
  const label = esc(c?.name ?? id);
  const col = c?.color && HEX6.test(c.color) ? c.color : '';
  if (!col) return label;
  const to = c?.colorTo && HEX6.test(c.colorTo) ? c.colorTo : '';
  if (to) return `<span class="vle-name vle-name--grad" style="--c1:${col};--c2:${to}">${label}</span>`;
  // contrast guardrail: a very dark solid color gets a subtle light lift so it
  // stays legible on dark surfaces (automatic, non-blocking — better than a warning).
  const lift = lowContrast(col) ? ' vle-name--lift' : '';
  return `<span class="vle-name${lift}" style="color:${col}">${label}</span>`;
}

/** Like nameHtml but from a CastCard directly (call sites that already hold the
 * card, e.g. the cast grid). */
export function nameHtmlCard(c: CastCard): string {
  const label = esc(c.name);
  const col = c.color && HEX6.test(c.color) ? c.color : '';
  if (!col) return label;
  const to = c.colorTo && HEX6.test(c.colorTo) ? c.colorTo : '';
  if (to) return `<span class="vle-name vle-name--grad" style="--c1:${col};--c2:${to}">${label}</span>`;
  const lift = lowContrast(col) ? ' vle-name--lift' : '';
  return `<span class="vle-name${lift}" style="color:${col}">${label}</span>`;
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

export function castByStatus(state: ChronicleState): { present: CastCard[]; active: CastCard[]; mentioned: CastCard[]; added: CastCard[] } {
  const all = Object.values(state.cast);
  return {
    present: all.filter((c) => c.status === 'present').sort(byRecent),
    active: all.filter((c) => c.status === 'active').sort(byRecent),
    mentioned: all.filter((c) => c.status === 'mentioned').sort(byRecent),
    added: all.filter((c) => c.status === 'added').sort((a, b) => a.name.localeCompare(b.name)),
  };
}
