import type { ChronicleState, Relation } from '../domain/types.js';
import { esc, nameOf } from './format.js';

/**
 * Chrome-specific render branches that can't be pure CSS. Each is boundary-safe
 * (called inside a Component render, which has an error boundary) and returns ''
 * on empty input so the caller can fall back to the default presentation.
 */

/** Map a -100..100 score to a 0..R radius along an axis. */
function scoreR(v: number, R: number): number {
  return (Math.max(-100, Math.min(100, v || 0)) / 100) * R;
}

/**
 * Futuristic "Oracle HUD" dual-axis bond radar: affection on the vertical axis,
 * trust on the horizontal. Each directed edge of a pair becomes a vector polygon
 * (origin → affection point → trust point). Asymmetry shows as different shapes.
 * Returns '' for an empty group so the caller renders the default twin meters.
 */
export function renderBondRadar(state: ChronicleState, group: Relation[]): string {
  if (!group.length) return '';
  const R = 70, cx = 90, cy = 90;
  const vec = (r: Relation, cls: string): string => {
    const ay = cy - scoreR(r.affection, R);          // +aff up
    const tx = cx + scoreR(r.trust, R);              // +trust right
    return `<polygon class="${cls}" points="${cx},${cy} ${cx},${ay} ${tx},${cy}"/>`
      + `<circle class="vle-radar-dot" cx="${cx}" cy="${ay}" r="3"/>`
      + `<circle class="vle-radar-dot" cx="${tx}" cy="${cy}" r="3"/>`;
  };
  const a = group[0]!;
  const b = group.find((r) => r.a === a.b && r.b === a.a);
  const legend = `<div class="vle-radar-leg">`
    + `<span style="color:var(--v-info)">\u25C6 ${esc(nameOf(state, a.a))}\u2192${esc(nameOf(state, a.b))} <i>aff ${a.affection >= 0 ? '+' : ''}${a.affection} \u00b7 tru ${a.trust >= 0 ? '+' : ''}${a.trust}</i></span>`
    + (b ? `<span style="color:var(--v-warn)">\u25C6 ${esc(nameOf(state, b.a))}\u2192${esc(nameOf(state, b.b))} <i>aff ${b.affection >= 0 ? '+' : ''}${b.affection} \u00b7 tru ${b.trust >= 0 ? '+' : ''}${b.trust}</i></span>` : '')
    + `</div>`;
  return legend
    + `<svg class="vle-radar" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="bond radar: affection vertical, trust horizontal">`
    + `<circle class="vle-radar-ring" cx="${cx}" cy="${cy}" r="${R}"/><circle class="vle-radar-ring" cx="${cx}" cy="${cy}" r="${R * 0.66}"/><circle class="vle-radar-ring" cx="${cx}" cy="${cy}" r="${R * 0.33}"/>`
    + `<line class="vle-radar-axis" x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}"/><line class="vle-radar-axis" x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}"/>`
    + `<text class="vle-radar-axl" x="${cx}" y="${cy - R - 4}" text-anchor="middle">+AFF</text>`
    + `<text class="vle-radar-axl" x="${cx + R + 2}" y="${cy + 3}">+TRU</text>`
    + vec(a, 'vle-radar-a')
    + (b ? vec(b, 'vle-radar-b') : '')
    + `<circle class="vle-radar-dot" cx="${cx}" cy="${cy}" r="2.5"/>`
    + `</svg>`;
}
