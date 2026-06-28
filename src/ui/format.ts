import type { ChronicleState, Relation, CastCard } from '../domain/types.js';

/** Small formatting helpers shared across UI components. Pure, no DOM. */

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
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
