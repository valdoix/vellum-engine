import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc, nameOf, catsOf, CAT_COLORS, SENT_LABEL, byRecent } from '../format.js';

/**
 * Relations tab. One card per bond (pair-identity), showing its coexisting
 * category facets, sentiment, and the -100..100 affection/trust bars. Pure.
 */
export const relationsTab: Component<ChronicleState> = {
  version: (s) => s.relations.length + ':' + s.relations.reduce((a, r) => a + r.affection + r.trust + r.categories.length, 0),
  render(s) {
    if (!s.relations.length) return '<div class="vle-empty sm">No bonds recorded yet.</div>';
    return '<div class="vle-rel-grid">'
      + s.relations.slice().sort(byRecent).map((r) => card(s, r)).join('')
      + '</div>';
  },
};

function bar(label: string, v: number): string {
  const n = Math.max(-100, Math.min(100, v || 0));
  const pct = Math.abs(n) / 2;
  const pos = n >= 0;
  return '<div class="vle-bar"><span class="vle-bar-l">' + label + '</span>'
    + '<span class="vle-bar-t"><span class="vle-bar-mid"></span>'
    + '<span class="vle-bar-f ' + (pos ? 'pos' : 'neg') + '" style="' + (pos ? 'left:50%;width:' + pct + '%' : 'right:50%;width:' + pct + '%') + '"></span></span>'
    + '<span class="vle-bar-v ' + (pos ? 'pos' : 'neg') + '">' + (n > 0 ? '+' : '') + n + '</span></div>';
}

function card(s: ChronicleState, r: ChronicleState['relations'][number]): string {
  const cats = catsOf(r);
  const chips = cats.map((c) => '<span class="vle-cat" style="--c:' + (CAT_COLORS[c] || '#888') + '">' + esc(c) + '</span>').join('');
  return '<div class="vle-rel-card">'
    + '<div class="vle-rel-top"><span class="vle-rel-pair">' + esc(nameOf(s, r.a)) + ' \u2192 ' + esc(nameOf(s, r.b)) + '</span>'
    + '<span class="vle-rel-sent">' + esc(SENT_LABEL[r.sentiment] || r.sentiment) + '</span></div>'
    + (r.label ? '<div class="vle-rel-label">\u201c' + esc(r.label) + '\u201d</div>' : '')
    + '<div class="vle-cats">' + chips + (r.status !== 'active' ? '<span class="vle-st">' + esc(r.status) + '</span>' : '') + '</div>'
    + '<div class="vle-bars">' + bar('Aff', r.affection) + bar('Trust', r.trust) + '</div>'
    + '</div>';
}
