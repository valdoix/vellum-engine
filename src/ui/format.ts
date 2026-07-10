import type { ChronicleState, Relation, CastCard } from '../domain/types.js';
import { getPref, setPref } from './prefs.js';
import { HEX6 as HEX6_IMPORTED, safeColor as safeColorImported, hslHex, castSlotColors, castSlotColorPairs, autoHue as autoHueImported } from '../core/palette.js';

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

/** One portrait convention for every avatar medallion (cast card + strip, present
 * card, journal spine). When imageUrl is set: adds ` has-img`, a background-image
 * style, and empty inner (CSS hides initials via .has-img). Otherwise: initials.
 * Returns the three fragments the caller splices into its own element. */
export function avatarParts(name: string, imageUrl?: string): { cls: string; style: string; inner: string } {
  if (imageUrl) return { cls: ' has-img', style: ' style="background-image:url(' + esc(JSON.stringify(imageUrl)) + ')"', inner: '' };
  return { cls: '', style: '', inner: esc(initials(name)) };
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

// Re-export from shared palette module
const HEX6 = HEX6_IMPORTED;
export const safeColor = safeColorImported;

/**
 * AUTO name color: derive a stable, distinct color per character from their id,
 * so the whole cast gets readable, consistent colors without manual picking.
 * Mode is persisted (localStorage); an EXPLICIT per-character color always wins.
 *   off      → inherited ink (today's default)
 *   solid    → one deterministic hue
 *   gradient → that hue → a complementary-ish second hue
 */
type AutoMode = 'off' | 'solid' | 'gradient';
let _auto: AutoMode = loadAuto();
function loadAuto(): AutoMode { const v = getPref<string>('autoName', 'off'); return v === 'solid' || v === 'gradient' ? v : 'off'; }
export function autoNameMode(): AutoMode { return _auto; }
export function setAutoNameMode(m: AutoMode): void { _auto = m; setPref('autoName', m === 'off' ? null : m); }
/** Re-read the auto-name mode after a backend prefs hydrate (reload recovery). */
export function reloadAutoNameFromPrefs(): void { _auto = loadAuto(); }
/** Warm the collision-free color map for the given cast ids, so nameHtmlCard
 * paints with the same assignments. Call once per cast render. */
export function warmCastColors(castIds: string[]): void { warmColorMap(castIds); }

// Re-use autoHue from shared palette
const autoHue = autoHueImported;

// --- collision-free cast palette (frontend cache) ---------------------------
// The core logic lives in core/palette.ts; this caches the color map per render.
let _colorMap: Map<string, { base: string; to: string }> = new Map();
let _colorSig = '';

/** Warm the color-pair cache for a cast id set. Call once per render. */
function warmColorMap(castIds: string[]): void {
  const sig = castIds.length + ':' + [...castIds].sort().join(',');
  if (sig !== _colorSig) {
    _colorSig = sig;
    _colorMap = castSlotColorPairs(castIds);
  }
}

/** Get the cached slot color pair for an id (warmed by warmColorMap). */
function getCachedPair(id: string, castIds: string[]): { base: string; to: string } {
  warmColorMap(castIds);
  return _colorMap.get(id) ?? { base: autoHue(id), to: autoHue(id, 150) }; // fallback if not in cast
}

/** Resolve the [color, colorTo?] a name should render with: explicit card colors
 * win; else the auto mode derives a COLLISION-FREE slot color from the cast set;
 * else none. `castIds` gives the slot assignment its cross-cast awareness. */
function resolveColor(id: string, color?: string, colorTo?: string, castIds?: string[]): { c: string; to: string } {
  const c = color && HEX6.test(color) ? color : '';
  if (c) return { c, to: colorTo && HEX6.test(colorTo) ? colorTo : '' };
  if (_auto === 'off' || !id) return { c: '', to: '' };
  if (castIds && castIds.length) {
    const { base, to } = getCachedPair(id, castIds);
    return { c: base, to: _auto === 'gradient' ? to : '' };
  }
  // no cast context (rare call sites): fall back to per-id hash
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
  const { c: col, to } = resolveColor(id, c?.color, c?.colorTo, Object.keys(state.cast));
  return paint(esc(c?.name ?? id), col, to);
}

/** Like nameHtml but from a CastCard directly (call sites that already hold the
 * card, e.g. the cast grid). Reuses the cached color map (kept warm by the
 * many nameHtml calls per render) so grid colors match the rest of the UI. */
export function nameHtmlCard(c: CastCard): string {
  const ids = _colorSig ? _colorSig.slice(_colorSig.indexOf(':') + 1).split(',').filter(Boolean) : undefined;
  const { c: col, to } = resolveColor(c.id, c.color, c.colorTo, ids && ids.includes(c.id) ? ids : undefined);
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

/** WCAG 2.x contrast ratio (1..21) between two opaque #rrggbb colors. */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Flatten a CSS color to an opaque #rrggbb by compositing it over `base`.
 * Accepts #rrggbb, rgb()/rgba(), or the FIRST color of a linear-gradient (the
 * skin's `glass` background) — enough for the contrast audit, which only needs a
 * representative background. Unparseable input returns `base` unchanged. */
export function flattenColor(css: string, base = '#0c0a08'): string {
  const s = String(css ?? '').trim();
  // pull the first rgb/rgba/hex token out of a gradient or plain color
  const rgba = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  const hex = s.match(/#[0-9a-fA-F]{6}/);
  let r: number, g: number, b: number, a = 1;
  if (rgba) {
    r = +rgba[1]!; g = +rgba[2]!; b = +rgba[3]!; a = rgba[4] !== undefined ? +rgba[4]! : 1;
  } else if (hex) {
    const h = hex[0]!;
    r = parseInt(h.slice(1, 3), 16); g = parseInt(h.slice(3, 5), 16); b = parseInt(h.slice(5, 7), 16);
  } else {
    return base;
  }
  if (a >= 1) return '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  // composite (src over base) using the base's rgb
  const bh = HEX6.test(base) ? base : '#000000';
  const br = parseInt(bh.slice(1, 3), 16), bg2 = parseInt(bh.slice(3, 5), 16), bb = parseInt(bh.slice(5, 7), 16);
  const mix = (c: number, bc: number): string => Math.round(c * a + bc * (1 - a)).toString(16).padStart(2, '0');
  return '#' + mix(r, br) + mix(g, bg2) + mix(b, bb);
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

/**
 * A single glanceable VERDICT word for a bond (mockup 20 panel 2), derived from
 * the pair's dominant category + sentiment + the sign of average affection/trust.
 * Pure: reads only the given directed edges, invents no state. Used as the card's
 * one-line read so the pair name/scores don't have to be scanned to "get" it.
 */
export function bondVerdict(dirs: { affection: number; trust: number; sentiment?: string; category?: string; categories?: string[] }[]): string {
  if (!dirs.length) return 'unknown';
  const avg = (pick: (d: typeof dirs[number]) => number): number => dirs.reduce((s, d) => s + (pick(d) || 0), 0) / dirs.length;
  const aff = avg((d) => d.affection);
  const tru = avg((d) => d.trust);
  // dominant category across both directions (first non-neutral wins)
  const cats = dirs.flatMap((d) => d.categories ?? (d.category ? [d.category] : []));
  const cat = cats.find((c) => c && c !== 'neutral') ?? dirs[0]!.category ?? 'social';
  const sent = dirs.map((d) => d.sentiment).find(Boolean) ?? 'neutral';
  const warm = aff > 20, cold = aff < -20, trusts = tru > 20, wary = tru < -20;
  const hostile = sent === 'hostile' || (cold && wary);
  switch (cat) {
    case 'romantic':
      return warm && trusts ? 'devotion' : warm ? 'infatuation' : cold ? 'bitter ex' : 'uneasy romance';
    case 'familial':
      return hostile ? 'estranged kin' : warm ? 'close family' : wary ? 'strained family' : 'family';
    case 'alliance':
      return hostile ? 'broken pact' : trusts && warm ? 'firm alliance' : wary ? 'wary alliance' : 'alliance';
    case 'rivalry':
      return hostile ? 'enmity' : cold ? 'rivalry' : 'tense rivalry';
    default:
      return hostile ? 'hostility' : warm && trusts ? 'close bond' : cold ? 'cold distance' : wary ? 'wary acquaintance' : 'acquaintance';
  }
}

// ---------------------------------------------------------------------------
// SHARED BOND COMPONENT (relations refactor). ONE renderer for both the Now
// block (compact) and the Bonds tab (full), plus a strip form for dense lists.
// Presentation-only: derives everything from the given directed edges, invents
// no state. The Bonds tab passes CRUD controls + the (promoted) sparkline and
// numeric history via `opts`; the Now block passes none.
// ---------------------------------------------------------------------------
export type BondDensity = 'full' | 'compact' | 'strip';
type BondDir = { a: string; b: string; affection: number; trust: number; sentiment?: string; category?: string; categories?: string[]; label?: string; status?: string };

/** Map a -100..100 score to a 0..100 position on a center-zero track (50%=zero). */
function scorePct(v: number): number { return 50 + Math.max(-100, Math.min(100, v || 0)) / 2; }

/**
 * True when a pair's two directions disagree enough to be worth flagging — an
 * opposite-sign axis, or a wide gap on either axis. One-sided pairs are never
 * "asymmetric" (there's nothing to compare). Threshold is intentionally coarse.
 */
export function isAsymmetric(dirs: BondDir[]): boolean {
  if (dirs.length < 2) return false;
  const [x, y] = dirs as [BondDir, BondDir];
  const opp = (a: number, b: number): boolean => (a > 15 && b < -15) || (a < -15 && b > 15);
  return opp(x.affection, y.affection) || opp(x.trust, y.trust)
    || Math.abs(x.affection - y.affection) > 40 || Math.abs(x.trust - y.trust) > 40;
}

/** One axis of the dumbbell meter: a single shared track with a dot per direction
 * and a connector between them (its length = the asymmetry). Values show inline in
 * `full`; otherwise they live on the dot's hover title so it's never lossy. */
function bondDumbbell(dA: BondDir | undefined, dB: BondDir | undefined, axis: 'affection' | 'trust', nameFor: (id: string) => string, density: BondDensity): string {
  const cls = axis === 'affection' ? 'aff' : 'trust';
  const positions: number[] = [];
  const dot = (d: BondDir | undefined, which: 'a' | 'b'): string => {
    if (!d) return '';
    const v = axis === 'affection' ? d.affection : d.trust;
    const pct = scorePct(v);
    positions.push(pct);
    const lbl = (v > 0 ? '+' : '') + Math.round(v);
    const title = abbr(nameFor(d.a)) + '\u2192' + abbr(nameFor(d.b)) + ' \u00b7 ' + axis + ' ' + lbl;
    return `<span class="vle-bc-dot vle-bc-dot--${cls} vle-bc-dot--${which}" style="left:${pct.toFixed(1)}%" title="${esc(title)}">`
      + (density === 'full' ? `<span class="vle-bc-val">${esc(lbl)}</span>` : '') + '</span>';
  };
  const dots = dot(dA, 'a') + dot(dB, 'b');
  let conn = '';
  if (positions.length === 2) {
    const lo = Math.min(positions[0]!, positions[1]!), hi = Math.max(positions[0]!, positions[1]!);
    conn = `<span class="vle-bc-conn vle-bc-conn--${cls}" style="left:${lo.toFixed(1)}%;width:${(hi - lo).toFixed(1)}%"></span>`;
  }
  return '<div class="vle-bc-axis">'
    + (density !== 'strip' ? `<span class="vle-bc-axl vle-bc-axl--${cls}">${axis}</span>` : '')
    + '<span class="vle-bc-track"><span class="vle-bc-zero" aria-hidden="true"></span>' + conn + dots + '</span></div>';
}

/**
 * The shared bond card. `group` is the 1–2 directed edges of one pair. `density`
 * picks the form; `opts` supplies the Bonds-tab-only extras (CRUD control slot,
 * lock badge, the promoted sparkline `arc`, and the numeric `history` disclosure).
 * Keeps `.vle-rel-card` as the outer class so the card-shape system still applies.
 */
export function bondCard(state: ChronicleState, group: Relation[], density: BondDensity, opts: { ctl?: string; badge?: string; arc?: string; history?: string } = {}): string {
  if (!group.length) return '';
  const nameFor = (id: string): string => nameOf(state, id);
  const g0 = group[0]!;
  const [pa, pb] = g0.a <= g0.b ? [g0.a, g0.b] : [g0.b, g0.a];
  const dA = group.find((r) => r.a === pa && r.b === pb);
  const dB = group.find((r) => r.a === pb && r.b === pa);
  const dirs = [dA, dB].filter(Boolean) as Relation[];
  // warmth spine: dominant (first non-neutral) category color, else neutral.
  const allCats = Array.from(new Set(dirs.flatMap(catsOf)));
  const domCat = allCats.find((c) => c !== 'neutral') ?? allCats[0] ?? 'neutral';
  const spine = CAT_COLORS[domCat] || '#8c8478';
  const asym = isAsymmetric(dirs);
  const asymBadge = asym ? '<span class="vle-bc-asym" title="the two directions disagree">\u21AF asymmetric</span>' : '';
  const pair = '<span class="vle-bc-pair">' + nameHtml(state, pa) + '<span class="vle-rel-arrow">\u21C4</span>' + nameHtml(state, pb) + '</span>';

  if (density === 'strip') {
    const dots = dirs.map((d) => bondDot(d.affection, d.trust, bondTitle(abbr(nameFor(d.a)) + '\u2192' + abbr(nameFor(d.b)), d.affection, d.trust))).join('');
    return '<div class="vle-rel-card vle-bc vle-bc--strip" style="--spine:' + spine + '"><span class="vle-bc-spine" aria-hidden="true"></span>'
      + pair + '<span class="vle-bc-dots">' + dots + '</span>'
      + '<span class="vle-bc-verdict">' + esc(bondVerdict(dirs)) + '</span></div>';
  }

  // per-direction verdict reads (full only) — this is where asymmetry becomes the
  // headline instead of an averaged single word.
  const read = (d: Relation | undefined, which: 'a' | 'b'): string => d
    ? `<span class="vle-bc-read vle-bc-read--${which}"><b>${esc(abbr(nameFor(d.a)))}</b> ${esc(bondVerdict([d]))}</span>` : '';
  const reads = density === 'full' ? '<span class="vle-bc-reads">' + read(dA, 'a') + read(dB, 'b') + '</span>' : '';

  const meters = bondDumbbell(dA, dB, 'affection', nameFor, density) + bondDumbbell(dA, dB, 'trust', nameFor, density);

  let foot = '';
  if (density === 'full') {
    const labels = dirs.map((d) => d.label).filter(Boolean).map((l) => '\u201C' + esc(l!) + '\u201D').join(' \u00b7 ');
    const cats = allCats.length ? '<div class="vle-rel-catfoot">' + allCats.map((c) => '<span class="vle-cat" style="--c:' + (CAT_COLORS[c] || '#888') + '">' + esc(c) + '</span>').join('') + '</div>' : '';
    const oneSided = dirs.length === 1 ? `<div class="vle-rel-onesided">no reciprocal bond from ${esc(nameFor(dirs[0]!.b))} yet</div>` : '';
    foot = (labels ? '<div class="vle-bc-labels">' + labels + '</div>' : '') + cats + oneSided;
  }

  return '<div class="vle-rel-card vle-bc vle-bc--' + density + '" style="--spine:' + spine + '"><span class="vle-bc-spine" aria-hidden="true"></span>'
    + '<div class="vle-bc-head">' + pair + reads + asymBadge
    + (opts.badge || opts.ctl ? '<span class="vle-rel-ctl">' + (opts.badge ?? '') + (opts.ctl ?? '') + '</span>' : '')
    + '</div>'
    + '<div class="vle-bc-meters">' + meters + '</div>'
    + (opts.arc ?? '')
    + foot
    + (opts.history ?? '')
    + '</div>';
}

/** Sentiment tone from the affection axis alone (fill color of a bond glyph). */
export function affectionTone(affection: number): 'pos' | 'neg' | 'info' {
  return affection < -15 ? 'neg' : affection > 15 ? 'pos' : 'info';
}

/** Trust band from the trust axis (drives the RING of a two-axis bond glyph):
 * high = a confident gold ring, wary = a dashed red ring, neutral = none. */
export function trustBand(trust: number): 'high' | 'low' | 'mid' {
  return trust > 25 ? 'high' : trust < -25 ? 'low' : 'mid';
}

/** Human-readable both-axes summary for a bond glyph's tooltip, so the compact
 * dot/chip (which shows affection as fill + trust as ring) is never lossy on hover. */
export function bondTitle(name: string, affection: number, trust: number): string {
  const a = (affection > 0 ? '+' : '') + Math.round(affection);
  const t = (trust > 0 ? '+' : '') + Math.round(trust);
  return `${name} \u2014 affection ${a} \u00b7 trust ${t}`;
}

/** A compact TWO-AXIS bond glyph: affection tints the fill (pos/neg/info), trust
 * draws the ring (high/low/mid). Replaces the old affection-only dot that silently
 * dropped the trust axis. `title` should come from bondTitle() so hover is complete. */
export function bondDot(affection: number, trust: number, title: string): string {
  return `<span class="vle-bonddot vle-bonddot--${affectionTone(affection)} vle-bonddot--t-${trustBand(trust)}" title="${esc(title)}"></span>`;
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
