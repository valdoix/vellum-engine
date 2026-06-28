import type { Component } from '../component.js';
import type { ChronicleState, Relation } from '../../domain/types.js';
import { esc, nameOf, catsOf, CAT_COLORS, SENT_LABEL, bar, emptyState, sectionHeader } from '../format.js';
import { cmd, send, paginate, pagerHtml, filterBar, filterOf } from '../bridge.js';
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

// Plot Director relation locks, mirrored from the backend broadcast (set by app.ts).
// Keyed by sorted-canonical pair so direction doesn't matter.
interface UILock { key: string; a: string; b: string; forbid: string[]; pin: string[] }
let _locks: UILock[] = [];
const pairKey = (a: string, b: string): string => [a, b].sort().join('|');
export function setRelationLocks(locks: UILock[]): void { _locks = Array.isArray(locks) ? locks : []; }
function lockFor(a: string, b: string): UILock | undefined { const k = pairKey(a, b); return _locks.find((l) => l.key === k); }

export const relationsTab: Component<ChronicleState> = {
  version: (s) => s.relations.length + ':' + s.relations.reduce((a, r) => a + r.affection + r.trust + r.categories.length, 0) + ':L' + _locks.length + _locks.reduce((a, l) => a + l.forbid.length + l.pin.length, 0),
  render(s) {
    const header = sectionHeader('', { action: '<button class="vle-add" data-rel-add>+ Relation</button>' });
    if (!s.relations.length) return header + emptyState('No bonds recorded yet.', 'Relationships appear as characters interact.');
    // filter bar: sort (newest/oldest by lastTurn) + category + per-character
    const cats = Array.from(new Set(s.relations.flatMap((r) => catsOf(r)))).sort();
    const ids = Array.from(new Set(s.relations.flatMap((r) => [r.a, r.b])));
    const whos = ids.map((id) => ({ id, name: nameOf(s, id) })).sort((a, b) => a.name.localeCompare(b.name));
    const counts: Record<string, number> = {};
    for (const r of s.relations) for (const c of catsOf(r)) counts[c] = (counts[c] ?? 0) + 1;
    const whoCounts: Record<string, number> = {};
    for (const r of s.relations) { whoCounts[r.a] = (whoCounts[r.a] ?? 0) + 1; if (r.b !== r.a) whoCounts[r.b] = (whoCounts[r.b] ?? 0) + 1; }
    const bar = filterBar('relations', { cats, whos, counts, whoCounts });
    const f = filterOf('relations');
    let rels = s.relations.filter((r) => (f.cat === 'all' || catsOf(r).includes(f.cat as Relation['category']))
      && (f.who === 'all' || r.a === f.who || r.b === f.who));
    rels = rels.sort((a, b) => f.sort === 'desc' ? (b.lastTurn ?? 0) - (a.lastTurn ?? 0) : (a.lastTurn ?? 0) - (b.lastTurn ?? 0));
    const { slice, page, pages } = paginate('relations', rels);
    if (!slice.length) return header + bar + emptyState('No bonds match this filter.');
    return header + bar + '<div class="vle-rel-grid">' + slice.map((r) => card(s, r)).join('') + '</div>' + pagerHtml('relations', page, pages);
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
      if (del) { confirmModal(`Delete the bond ${del.getAttribute('data-a')} \u2192 ${del.getAttribute('data-b')}?`, () => cmd('relation_delete', { a: del.getAttribute('data-a'), b: del.getAttribute('data-b') })); return; }
      const lk = t.closest('[data-rel-lock]');
      if (lk) lockForm(lk.getAttribute('data-a') ?? '', lk.getAttribute('data-b') ?? '', lk.getAttribute('data-an') ?? '', lk.getAttribute('data-bn') ?? '');
    });
  },
};

/** Plot Director lock editor for one pair: pick categories that can never form
 * (forbid) or that are protected from removal (pin). Sends the full updated lock
 * list to the backend, which strips forbidden cats at the fold + drops any that
 * already exist on the graph. */
function lockForm(aId: string, bId: string, aName: string, bName: string): void {
  const cur = lockFor(aId, bId);
  const forbid = new Set(cur?.forbid ?? []);
  const pin = new Set(cur?.pin ?? []);
  formModal(`Lock: ${aName} \u2194 ${bName}`, [
    { key: 'forbid', label: 'Forbid (can never form)', type: 'checks', value: Array.from(forbid).join(','), options: CAT_OPTS },
    { key: 'pin', label: 'Pin (protect from removal)', type: 'checks', value: Array.from(pin).join(','), options: CAT_OPTS },
  ], (out) => {
    const fb = (out.forbid ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const pn = (out.pin ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const others = _locks.filter((l) => l.key !== pairKey(aId, bId));
    const next = (fb.length || pn.length) ? [...others, { key: pairKey(aId, bId), a: aId, b: bId, forbid: fb, pin: pn }] : others;
    send({ type: 'vellum_set_locks', locks: next });
  });
}

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

function card(s: ChronicleState, r: Relation): string {
  const cats = catsOf(r);
  const A = (x: unknown): string => esc(x);
  const chips = cats.map((c) => '<span class="vle-cat" style="--c:' + (CAT_COLORS[c] || '#888') + '">' + esc(c) + '</span>').join('');
  const an = nameOf(s, r.a), bn = nameOf(s, r.b);
  const lock = lockFor(r.a, r.b);
  const lockBadge = lock ? `<span class="vle-rel-lockbadge" title="${A('forbidden: ' + (lock.forbid.join(', ') || '\u2014') + (lock.pin.length ? ' \u00b7 pinned: ' + lock.pin.join(', ') : ''))}">\uD83D\uDD12 ${esc(lock.forbid.join(', ') || 'pinned')}</span>` : '';
  return '<div class="vle-rel-card">'
    + '<div class="vle-rel-top"><span class="vle-rel-pair">' + esc(an) + ' \u2192 ' + esc(bn) + '</span>'
    + '<span class="vle-rel-ctl">'
    + `<button class="vle-mini${lock ? ' on' : ''}" data-rel-lock data-a="${A(r.a)}" data-b="${A(r.b)}" data-an="${A(an)}" data-bn="${A(bn)}" title="Plot Director lock">\uD83D\uDD12</button>`
    + `<button class="vle-mini" data-rel-edit data-a="${A(an)}" data-b="${A(bn)}" data-label="${A(r.label)}" data-cats="${A(cats.join(','))}" data-aff="${r.affection}" data-trust="${r.trust}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-rel-del data-a="${A(an)}" data-b="${A(bn)}" title="Delete">\u2715</button>`
    + '</span></div>'
    + '<div class="vle-rel-sub"><span class="vle-rel-sent">' + esc(SENT_LABEL[r.sentiment] || r.sentiment) + '</span>' + lockBadge + '</div>'
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
