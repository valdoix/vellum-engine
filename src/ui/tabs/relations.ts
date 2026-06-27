import type { Component } from '../component.js';
import type { ChronicleState, Relation } from '../../domain/types.js';
import { esc, nameOf, catsOf, CAT_COLORS, SENT_LABEL, byRecent } from '../format.js';
import { cmd, paginate, pagerHtml } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';

/**
 * Relations tab. One card per bond (pair-identity) with its coexisting category
 * facets, sentiment, and the -100..100 affection/trust bars. Add/edit/delete +
 * pagination; CRUD flows through the bridge → vellum_cmd.
 */

const CAT_OPTS = [
  { value: 'familial', label: 'familial' }, { value: 'romantic', label: 'romantic' },
  { value: 'alliance', label: 'alliance' }, { value: 'rivalry', label: 'rivalry' }, { value: 'social', label: 'social' },
];

export const relationsTab: Component<ChronicleState> = {
  version: (s) => s.relations.length + ':' + s.relations.reduce((a, r) => a + r.affection + r.trust + r.categories.length, 0),
  render(s) {
    const header = '<div class="vle-sec-top"><button class="vle-add" data-rel-add>+ Relation</button></div>';
    if (!s.relations.length) return header + '<div class="vle-empty sm">No bonds recorded yet.</div>';
    const sorted = s.relations.slice().sort(byRecent);
    const { slice, page, pages } = paginate('relations', sorted);
    return header + '<div class="vle-rel-grid">' + slice.map((r) => card(s, r)).join('') + '</div>' + pagerHtml('relations', page, pages);
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-rel-add]')) { relForm('New Relation', {}); return; }
      const ed = t.closest('[data-rel-edit]');
      if (ed) {
        relForm('Edit Relation', {
          a: ed.getAttribute('data-a') ?? '', b: ed.getAttribute('data-b') ?? '',
          label: ed.getAttribute('data-label') ?? '', categories: ed.getAttribute('data-cats') ?? '',
          aff: ed.getAttribute('data-aff') ?? '0', trust: ed.getAttribute('data-trust') ?? '0',
        });
        return;
      }
      const del = t.closest('[data-rel-del]');
      if (del) confirmModal(`Delete the bond ${del.getAttribute('data-a')} \u2192 ${del.getAttribute('data-b')}?`, () => cmd('relation_delete', { a: del.getAttribute('data-a'), b: del.getAttribute('data-b') }));
    });
  },
};

function relForm(title: string, v: Record<string, string>): void {
  formModal(title, [
    { key: 'a', label: 'Character A', type: 'text', value: v.a, placeholder: 'Cersei' },
    { key: 'b', label: 'Character B', type: 'text', value: v.b, placeholder: 'Jaime' },
    { key: 'label', label: 'Label (from A\u2019s view)', type: 'text', value: v.label, placeholder: 'twin brother' },
    { key: 'categories', label: 'Categories', type: 'checks', value: v.categories ?? '', options: CAT_OPTS },
    { key: 'aff', label: 'Affection (-100..100)', type: 'text', value: v.aff ?? '0' },
    { key: 'trust', label: 'Trust (-100..100)', type: 'text', value: v.trust ?? '0' },
  ], (out) => { if (out.a?.trim() && out.b?.trim()) cmd('relation_upsert', out); });
}

function bar(label: string, v: number): string {
  const n = Math.max(-100, Math.min(100, v || 0));
  const pct = Math.abs(n) / 2; const pos = n >= 0;
  return '<div class="vle-bar"><span class="vle-bar-l">' + label + '</span>'
    + '<span class="vle-bar-t"><span class="vle-bar-mid"></span>'
    + '<span class="vle-bar-f ' + (pos ? 'pos' : 'neg') + '" style="' + (pos ? 'left:50%;width:' + pct + '%' : 'right:50%;width:' + pct + '%') + '"></span></span>'
    + '<span class="vle-bar-v ' + (pos ? 'pos' : 'neg') + '">' + (n > 0 ? '+' : '') + n + '</span></div>';
}

function card(s: ChronicleState, r: Relation): string {
  const cats = catsOf(r);
  const A = (x: unknown): string => esc(x);
  const chips = cats.map((c) => '<span class="vle-cat" style="--c:' + (CAT_COLORS[c] || '#888') + '">' + esc(c) + '</span>').join('');
  const an = nameOf(s, r.a), bn = nameOf(s, r.b);
  return '<div class="vle-rel-card">'
    + '<div class="vle-rel-top"><span class="vle-rel-pair">' + esc(an) + ' \u2192 ' + esc(bn) + '</span>'
    + '<span class="vle-rel-ctl">'
    + `<button class="vle-mini" data-rel-edit data-a="${A(an)}" data-b="${A(bn)}" data-label="${A(r.label)}" data-cats="${A(cats.join(','))}" data-aff="${r.affection}" data-trust="${r.trust}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-rel-del data-a="${A(an)}" data-b="${A(bn)}" title="Delete">\u2715</button>`
    + '</span></div>'
    + '<div class="vle-rel-sub"><span class="vle-rel-sent">' + esc(SENT_LABEL[r.sentiment] || r.sentiment) + '</span></div>'
    + (r.label ? '<div class="vle-rel-label">\u201c' + esc(r.label) + '\u201d</div>' : '')
    + '<div class="vle-cats">' + chips + (r.status !== 'active' ? '<span class="vle-st">' + esc(r.status) + '</span>' : '') + '</div>'
    + '<div class="vle-bars">' + bar('Aff', r.affection) + bar('Trust', r.trust) + '</div>'
    + historyHtml(r)
    + '</div>';
}

/** Collapsible change-history: category transitions + score samples over time. */
function historyHtml(r: Relation): string {
  const cat = (r.categoryHistory ?? []).filter((h) => h.op === 'add' || h.op === 'remove');
  const scores = (r.history ?? []);
  if (cat.length < 1 && scores.length < 2) return '';
  const catRows = cat.slice(-8).map((h) => {
    const sign = h.op === 'remove' ? '\u2212' : '+';
    const cls = h.op === 'remove' ? 'rm' : 'add';
    return `<div class="vle-hist-row"><span class="vle-hist-t">d${h.day || '?'}</span><span class="vle-hist-ev ${cls}">${sign}${esc(h.category)}</span>${h.reason ? `<span class="vle-hist-why">${esc(h.reason)}</span>` : ''}</div>`;
  }).join('');
  const scoreRows = scores.slice(-6).map((s) => {
    const aff = (s.affection > 0 ? '+' : '') + s.affection, tr = (s.trust > 0 ? '+' : '') + s.trust;
    return `<div class="vle-hist-row"><span class="vle-hist-t">t${s.turn}</span><span class="vle-hist-sc">aff ${aff} \u00b7 trust ${tr}</span>${s.reason ? `<span class="vle-hist-why">${esc(s.reason)}</span>` : ''}</div>`;
  }).join('');
  return '<details class="vle-hist"><summary>change history</summary>'
    + (catRows ? '<div class="vle-hist-sec">bond shifts</div>' + catRows : '')
    + (scoreRows ? '<div class="vle-hist-sec">score trail</div>' + scoreRows : '')
    + '</details>';
}
