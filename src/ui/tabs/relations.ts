import type { Component } from '../component.js';
import type { ChronicleState, Relation } from '../../domain/types.js';
import { esc, nameOf, catsOf, CAT_COLORS, SENT_LABEL, bondMeter, bondVerdict, emptyState, sectionHeader, nameHtml } from '../format.js';
import { cmd, send, paginate, pagerHtml, filterBar, filterOf } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';
import { getTheme, activeShape } from '../theme.js';
import { shapeOrnament } from '../ornament.js';
import { renderBondRadar } from '../theme-render.js';

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
    // group the two directed edges of a pair into ONE card (A→B + B→A together).
    const groups = new Map<string, Relation[]>();
    for (const r of rels) { const k = pairKey(r.a, r.b); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    const pairs = Array.from(groups.values());
    const recency = (g: Relation[]): number => Math.max(...g.map((r) => r.lastTurn ?? 0));
    pairs.sort((x, y) => f.sort === 'desc' ? recency(y) - recency(x) : recency(x) - recency(y));
    const { slice, page, pages } = paginate('relations', pairs);
    if (!slice.length) return header + bar + emptyState('No bonds match this filter.');
    return header + bar + '<div class="vle-rel-grid">' + slice.map((g) => card(s, g)).join('') + '</div>' + pagerHtml('relations', page, pages);
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
          aff: ed.getAttribute('data-aff') ?? '0', trust: ed.getAttribute('data-trust') ?? '0', edit: '1',
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
  // `edit` is true when editing one existing directed edge — the reciprocal
  // section is offered only for NEW relations (editing stays single-direction).
  const edit = !!v.edit;
  const fields = [
    { key: 'a', label: 'Character A', type: 'text' as const, value: v.a, placeholder: 'Cersei' },
    { key: 'b', label: 'Character B', type: 'text' as const, value: v.b, placeholder: 'Jaime' },
    { key: 'label', label: 'Label (from A\u2019s view)', type: 'text' as const, value: v.label, placeholder: 'twin brother' },
    { key: 'categories', label: 'Categories (A \u2192 B)', type: 'checks' as const, value: v.categories ?? '', options: CAT_OPTS },
    { key: 'aff', label: 'Affection A\u2192B (-100..100)', type: 'text' as const, value: v.aff ?? '0' },
    { key: 'trust', label: 'Trust A\u2192B (-100..100)', type: 'text' as const, value: v.trust ?? '0' },
  ];
  const reciprocal = [
    { key: 'both', label: 'Also add the reverse (B \u2192 A)?', type: 'select' as const, value: 'no', options: [{ value: 'no', label: 'no' }, { value: 'yes', label: 'yes' }] },
    { key: 'blabel', label: 'Label (from B\u2019s view)', type: 'text' as const, value: '', placeholder: 'twin sister' },
    { key: 'bcategories', label: 'Categories (B \u2192 A)', type: 'checks' as const, value: '', options: CAT_OPTS },
    { key: 'baff', label: 'Affection B\u2192A (-100..100)', type: 'text' as const, value: '0' },
    { key: 'btrust', label: 'Trust B\u2192A (-100..100)', type: 'text' as const, value: '0' },
  ];
  formModal(title, edit ? fields : [...fields, ...reciprocal], (out) => {
    if (out.a?.trim() && out.b?.trim()) cmd('relation_upsert', out);
  });
}

/** A paired relation card: the A↔B header + lock, then one directional row per
 * existing edge (A→B and/or B→A), each with its own label/cats/bars/edit/delete/
 * history. Directed edges stay distinct so asymmetry (she devoted, he wary) shows. */
function card(s: ChronicleState, group: Relation[]): string {
  const A = (x: unknown): string => esc(x);
  // stable endpoint order from the sorted pair key, so the header reads the same
  // regardless of which direction was authored first.
  const [pa, pb] = group[0]!.a <= group[0]!.b ? [group[0]!.a, group[0]!.b] : [group[0]!.b, group[0]!.a];
  const lock = lockFor(pa, pb);
  const lockBadge = lock ? `<span class="vle-rel-lockbadge" title="${A('forbidden: ' + (lock.forbid.join(', ') || '\u2014') + (lock.pin.length ? ' \u00b7 pinned: ' + lock.pin.join(', ') : ''))}">\uD83D\uDD12 ${esc(lock.forbid.join(', ') || 'pinned')}</span>` : '';
  const byDir = (from: string, to: string): Relation | undefined => group.find((r) => r.a === from && r.b === to);
  const dirs = [byDir(pa, pb), byDir(pb, pa)].filter(Boolean) as Relation[];

  // K3: each direction collapses to ONE line — from→to · sentiment + label quote
  // + edit/del. Category chips move to the card foot (shown once), not per row.
  const dirLine = (r: Relation): string => {
    const an = nameOf(s, r.a), bn = nameOf(s, r.b);
    const cats = catsOf(r);
    return '<div class="vle-rel-dirline">'
      + '<span class="vle-rel-dirn">' + nameHtml(s, r.a) + ' \u2192 ' + nameHtml(s, r.b) + '</span>'
      + '<span class="vle-rel-sent">' + esc(SENT_LABEL[r.sentiment] || r.sentiment) + '</span>'
      + (r.label ? '<span class="vle-rel-label">\u201c' + esc(r.label) + '\u201d</span>' : '')
      + (r.status !== 'active' ? '<span class="vle-st">' + esc(r.status) + '</span>' : '')
      + '<span class="vle-rel-ctl">'
      + `<button class="vle-mini" data-rel-edit data-a="${A(an)}" data-b="${A(bn)}" data-label="${A(r.label)}" data-cats="${A(cats.join(','))}" data-aff="${r.affection}" data-trust="${r.trust}" title="Edit">\u270E</button>`
      + `<button class="vle-mini del" data-rel-del data-a="${A(an)}" data-b="${A(bn)}" title="Delete">\u2715</button>`
      + '</span></div>';
  };
  // category chips: the UNION of both directions, rendered once at the card foot.
  const allCats = Array.from(new Set(dirs.flatMap((r) => catsOf(r))));
  const catFoot = allCats.length
    ? '<div class="vle-rel-catfoot">' + allCats.map((c) => '<span class="vle-cat" style="--c:' + (CAT_COLORS[c] || '#888') + '">' + esc(c) + '</span>').join('') + '</div>'
    : '';
  // K1 verdict word — the one-line read of the pair.
  const verdict = bondVerdict(dirs);

  const reverseMissing = dirs.length === 1
    ? `<div class="vle-rel-onesided">no reciprocal bond from ${esc(nameOf(s, dirs[0]!.b))} yet</div>`
    : '';
  // bond visualization: futuristic = radar; everyone else = the shared diverging
  // bondMeter (both directions per axis vs one zero). Boundary-safe; '' degrades.
  const viz = getTheme().chrome === 'futuristic'
    ? renderBondRadar(s, group)
    : bondMeter(dirs, (id) => nameOf(s, id));
  return '<div class="vle-rel-card">'
    + shapeOrnament(activeShape('bonds'), 'bonds')
    // K1 verdict header: A ⇄ B + one verdict word + lock badge/button.
    + '<div class="vle-rel-top"><span class="vle-rel-pair">' + nameHtml(s, pa) + ' \u21C4 ' + nameHtml(s, pb) + '</span>'
    + '<span class="vle-rel-verdict">' + esc(verdict) + '</span>'
    + '<span class="vle-rel-ctl">' + lockBadge
    + `<button class="vle-mini${lock ? ' on' : ''}" data-rel-lock data-a="${A(pa)}" data-b="${A(pb)}" data-an="${A(nameOf(s, pa))}" data-bn="${A(nameOf(s, pb))}" title="Plot Director lock">\uD83D\uDD12</button>`
    + '</span></div>'
    + viz
    + dirs.map(dirLine).join('')
    + catFoot
    + reverseMissing
    // K4 history as one quiet disclosure per PAIR (both directions combined).
    + pairHistoryHtml(dirs)
    + '</div>';
}

/** K4: ONE quiet change-history disclosure per PAIR (both directions combined),
 * with the richest direction's sparkline. Category transitions + score samples,
 * merged and time-ordered so the margin holds one history, not two. */
function pairHistoryHtml(dirs: Relation[]): string {
  const cat = dirs.flatMap((r) => (r.categoryHistory ?? []).filter((h) => h.op === 'add' || h.op === 'remove'))
    .sort((a, b) => (a.day || 0) - (b.day || 0));
  // sparkline follows the direction with the most samples (fullest arc)
  const richest = dirs.slice().sort((a, b) => (b.history?.length ?? 0) - (a.history?.length ?? 0))[0];
  const scores = richest?.history ?? [];
  if (cat.length < 1 && scores.length < 2) return '';
  const spark = scores.length >= 2 ? arcSparkline(scores) : '';
  const catRows = cat.slice(-8).map((h) => {
    const sign = h.op === 'remove' ? '\u2212' : '+';
    const cls = h.op === 'remove' ? 'rm' : 'add';
    return `<div class="vle-hist-row"><span class="vle-hist-t">d${h.day || '?'}</span><span class="vle-hist-ev ${cls}">${sign}${esc(h.category)}</span>${h.reason ? `<span class="vle-hist-why">${esc(h.reason)}</span>` : ''}</div>`;
  }).join('');
  const scoreRows = scores.slice(-6).map((s) => {
    const aff = (s.affection > 0 ? '+' : '') + s.affection, tr = (s.trust > 0 ? '+' : '') + s.trust;
    return `<div class="vle-hist-row"><span class="vle-hist-t">t${s.turn}</span><span class="vle-hist-sc">aff ${aff} \u00b7 trust ${tr}</span>${s.reason ? `<span class="vle-hist-why">${esc(s.reason)}</span>` : ''}</div>`;
  }).join('');
  return '<details class="vle-hist"><summary>\u25B8 change history</summary>'
    + spark
    + (catRows ? '<div class="vle-hist-sec">bond shifts</div>' + catRows : '')
    + (scoreRows ? '<div class="vle-hist-sec">score trail</div>' + scoreRows : '')
    + '</details>';
}

/** A dual aff/trust sparkline over the relationship's score samples — the arc of
 * the bond at a glance. Pure SVG on theme vars; nodes carry their reason on hover. */
function arcSparkline(scores: Array<{ turn: number; affection: number; trust: number; reason?: string }>): string {
  const pts = scores.slice(-40); // cap the series width
  const n = pts.length;
  const W = 240, H = 46, padX = 3, padY = 4;
  const x = (i: number): number => padX + (n <= 1 ? 0 : (i * (W - 2 * padX)) / (n - 1));
  const y = (v: number): number => padY + ((100 - v) / 200) * (H - 2 * padY); // +100 top, -100 bottom
  const path = (key: 'affection' | 'trust'): string => pts.map((s, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s[key]).toFixed(1)).join(' ');
  const dots = (key: 'affection' | 'trust', color: string): string => pts.map((s, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(s[key]).toFixed(1)}" r="2" fill="${color}"><title>t${s.turn} \u00b7 ${key} ${s[key] > 0 ? '+' : ''}${s[key]}${s.reason ? ' \u2014 ' + esc(s.reason) : ''}</title></circle>`).join('');
  const zeroY = y(0).toFixed(1);
  return '<div class="vle-arc"><svg viewBox="0 0 ' + W + ' ' + H + '" class="vle-arc-svg" preserveAspectRatio="none">'
    + `<line x1="${padX}" y1="${zeroY}" x2="${W - padX}" y2="${zeroY}" class="vle-arc-zero"/>`
    + `<path d="${path('affection')}" class="vle-arc-aff" fill="none"/>`
    + `<path d="${path('trust')}" class="vle-arc-trust" fill="none"/>`
    + dots('affection', 'var(--v-pos)') + dots('trust', 'var(--vg)')
    + '</svg><div class="vle-arc-key"><span class="vle-arc-k-aff">\u2014 affection</span><span class="vle-arc-k-tr">\u2014 trust</span></div></div>';
}
