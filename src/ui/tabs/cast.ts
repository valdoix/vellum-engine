import type { Component } from '../component.js';
import type { ChronicleState, CastCard, Faction } from '../../domain/types.js';
import { esc, initials, byRecent, bar, emptyState, sectionHeader, nameHtmlCard, nameHtml, nameOf, autoNameMode, setAutoNameMode, warmCastColors, avatarParts, affectionTone, bondDot, bondTitle } from '../format.js';

import { cmd, paginate, pagerHtml, send, setPage, refreshUI } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';
import { traitArc, dormantTraits } from '../../domain/drift.js';
import { visibleCast } from '../../domain/cast-hygiene.js';
import { activeShape } from '../theme.js';
import { shapeOrnament } from '../ornament.js';

/**
 * Cast tab — two sections: CHARACTERS (individuals) and FACTIONS (groups).
 * Each is a single filterable list (status filter + sort) with one pager, so a
 * lopsided cast doesn't fragment into many short paginated groups. Factions show
 * a standing meter and member roster. CRUD flows through bridge → vellum_cmd.
 */

const STATUS_OPTS = [
  { value: 'present', label: 'present' }, { value: 'active', label: 'active' },
  { value: 'mentioned', label: 'mentioned' }, { value: 'added', label: 'added' },
];

// status presentation: rank (present-first sort), glyph, label, card class
const STATUS = [
  { id: 'present', rank: 0, glyph: '\u25C9', label: 'Present' },
  { id: 'active', rank: 1, glyph: '\u25CB', label: 'Active' },
  { id: 'mentioned', rank: 2, glyph: '\u2027', label: 'Mentioned' },
  { id: 'added', rank: 3, glyph: '\u2605', label: 'Added' },
] as const;
const RANK: Record<string, number> = { present: 0, active: 1, mentioned: 2, added: 3 };

type Sort = 'presence' | 'new' | 'old' | 'az';
const SORT_LABEL: Record<Sort, string> = { presence: '\u25C9 presence', new: '\u2193 newest', old: '\u2191 oldest', az: 'A\u2013Z' };

// per-side UI state (which status filter + sort). 'all' shows every status.
const _st = { cast: 'all', fac: 'all' };
const _sort = { cast: 'presence' as Sort, fac: 'presence' as Sort };
// density: 'cards' = full cards (unfoldable), 'strip' = one line per character.
let _density: 'cards' | 'strip' = 'cards';
// ids of cards the user has unfolded (expanded). Only meaningful in 'cards' mode.
const _expanded = new Set<string>();
// latest rendered state, so click handlers (memberForm) can read the cast list.
let _state: ChronicleState | null = null;

/** Status filter chips (zero-count statuses omitted) + sort buttons. */
function filterBar(side: 'cast' | 'fac', counts: Record<string, number>, total: number): string {
  const chips = `<button class="vle-fb-btn${_st[side] === 'all' ? ' on' : ''}" data-cstatus="${side}:all">All <span class="vle-n">${total}</span></button>`
    + STATUS.filter((s) => (counts[s.id] ?? 0) > 0).map((s) =>
      `<button class="vle-fb-btn${_st[side] === s.id ? ' on' : ''}" data-cstatus="${side}:${s.id}">${s.glyph} ${s.label} <span class="vle-n">${counts[s.id]}</span></button>`).join('');
  const sorts = (['presence', 'new', 'old', 'az'] as Sort[]).map((k) =>
    `<button class="vle-fb-btn${_sort[side] === k ? ' on' : ''}" data-csort="${side}:${k}">${SORT_LABEL[k]}</button>`).join('');
  return `<div class="vle-fbar">${chips}</div><div class="vle-fbar">${sorts}</div>`;
}

function sortItems<T extends CastCard | Faction>(items: T[], sort: Sort): T[] {
  const out = items.slice();
  if (sort === 'az') return out.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'new') return out.sort(byRecent);
  if (sort === 'old') return out.sort((a, b) => (a.lastTurn ?? 0) - (b.lastTurn ?? 0));
  return out.sort((a, b) => ((RANK[a.status] ?? 9) - (RANK[b.status] ?? 9)) || byRecent(a, b)); // presence
}

export const castTab: Component<ChronicleState> = {
  version: (s) => {
    const cv = Object.values(s.cast).map((c) => `${c.id}|${c.name}|${c.status}|${c.role}|${c.age}|${c.appearance}|${c.note}|${c.disposition ?? ''}|${(c.traits ?? []).join(',')}|${(c.aka ?? []).join(',')}|${c.lastTurn}|${c.color ?? ''}|${c.colorTo ?? ''}|${c.deceased ? 'd' : ''}|${c.userEdited ? 'u' : ''}|${c.imageUrl ?? ''}`).join(';');
    const fv = Object.values(s.factions).map((f) => `${f.id}|${f.name}|${f.status}|${f.kind}|${f.standing}|${f.trust}|${f.lastTurn}|${f.seat ?? ''}|${f.userEdited ? 'u' : ''}`).join(';');
    const mv = s.memberships.map((m) => `${m.char}>${m.faction}:${m.role ?? ''}`).join(',')
      + '~' + (s.factionRelations ?? []).map((r) => `${r.a}>${r.b}:${r.kind}:${r.standing}`).join(',');
    return cv + '#' + fv + '#' + mv + ':' + s.turns + '#' + _st.cast + _sort.cast + _st.fac + _sort.fac + '#' + autoNameMode() + '#' + _density + '#' + Array.from(_expanded).sort().join(',') + '#' + (s.traitHistory ?? []).length;
  },
  render(s) {
    _state = s;
    warmCastColors(Object.keys(s.cast));
    return castSection(s) + factionSection(s);
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const ac = t.closest('[data-autoname]');
      if (ac) { setAutoNameMode(ac.getAttribute('data-autoname') as 'off' | 'solid' | 'gradient'); refreshUI(); return; }
      const cs = t.closest('[data-cstatus]');
      if (cs) { const [side, v] = cs.getAttribute('data-cstatus')!.split(':') as ['cast' | 'fac', string]; _st[side] = v; setPage((side === 'cast' ? 'cast' : 'fac') + '-list', 0); return; }
      const so = t.closest('[data-csort]');
      if (so) { const [side, v] = so.getAttribute('data-csort')!.split(':') as ['cast' | 'fac', Sort]; _sort[side] = v; setPage((side === 'cast' ? 'cast' : 'fac') + '-list', 0); return; }
      const dn = t.closest('[data-cdensity]');
      if (dn) { _density = dn.getAttribute('data-cdensity') as 'cards' | 'strip'; refreshUI(); return; }
      const uf = t.closest('[data-cast-unfold]');
      if (uf) { const id = uf.getAttribute('data-id')!; _expanded.has(id) ? _expanded.delete(id) : _expanded.add(id); refreshUI(); return; }
      const pr = t.closest('[data-cast-promote]');
      if (pr) { send({ type: 'vellum_vault_promote', kind: 'cast', id: pr.getAttribute('data-id') }); const b = pr as HTMLElement; const o = b.textContent; b.textContent = '\u2713'; setTimeout(() => { b.textContent = o; }, 1800); return; }
      if (t.closest('[data-cast-add]')) { castForm('New Character', {}); return; }
      const ed = t.closest('[data-cast-edit]');
      if (ed) {
        castForm('Edit Character', {
          id: ed.getAttribute('data-id') ?? '', name: ed.getAttribute('data-name') ?? '',
          role: ed.getAttribute('data-role') ?? '', age: ed.getAttribute('data-age') ?? '',
          appearance: ed.getAttribute('data-app') ?? '', note: ed.getAttribute('data-note') ?? '',
          status: ed.getAttribute('data-status') ?? 'active', aka: ed.getAttribute('data-aka') ?? '',
          disposition: ed.getAttribute('data-disp') ?? '', traits: ed.getAttribute('data-traits') ?? '',
          color: ed.getAttribute('data-color') ?? '', colorTo: ed.getAttribute('data-colorto') ?? '',
          imageUrl: ed.getAttribute('data-img') ?? '', deceased: ed.getAttribute('data-deceased') ?? 'no',
        });
        return;
      }
      const del = t.closest('[data-cast-del]');
      if (del) { confirmModal(`Remove ${del.getAttribute('data-name')} and their relations?`, () => cmd('cast_delete', { id: del.getAttribute('data-id') })); return; }

      // --- factions ---
      if (t.closest('[data-fac-add]')) { factionForm('New Faction', {}); return; }
      const fed = t.closest('[data-fac-edit]');
      if (fed) {
        factionForm('Edit Faction', {
          id: fed.getAttribute('data-id') ?? '', name: fed.getAttribute('data-name') ?? '',
          kind: fed.getAttribute('data-kind') ?? '', note: fed.getAttribute('data-note') ?? '',
          status: fed.getAttribute('data-status') ?? 'active', standing: fed.getAttribute('data-standing') ?? '0',
          trust: fed.getAttribute('data-trust') ?? '0', seat: fed.getAttribute('data-seat') ?? '',
        });
        return;
      }
      const fdel = t.closest('[data-fac-del]');
      if (fdel) { confirmModal(`Remove the faction ${fdel.getAttribute('data-name')}?`, () => cmd('faction_delete', { id: fdel.getAttribute('data-id') })); return; }
      const mem = t.closest('[data-fac-member]');
      if (mem) { memberForm(mem.getAttribute('data-id') ?? '', mem.getAttribute('data-name') ?? ''); return; }
      const mdel = t.closest('[data-fac-memdel]');
      if (mdel) { cmd('faction_member', { char: mdel.getAttribute('data-char'), faction: mdel.getAttribute('data-id'), op: 'remove' }); return; }
      const frel = t.closest('[data-fac-rel]');
      if (frel) { factionRelForm(frel.getAttribute('data-id') ?? '', frel.getAttribute('data-name') ?? ''); return; }
      const freldel = t.closest('[data-fac-reldel]');
      if (freldel) { cmd('faction_relation_delete', { a: freldel.getAttribute('data-a'), b: freldel.getAttribute('data-b') }); return; }
    });
  },
};

// ---------- characters ----------
function castSection(s: ChronicleState): string {
  // hide provisional cards (unproven, single-mention, attachment-less auto names)
  // until they earn their place — Layer 1 quarantine
  const all = visibleCast(s);
  const auto = autoNameMode();
  const autoCtl = '<span class="vle-autoc">auto color: '
    + (['off', 'solid', 'gradient'] as const).map((m) => `<button class="vle-autoc-b${auto === m ? ' on' : ''}" data-autoname="${m}">${m}</button>`).join('')
    + '</span>';
  // density toggle: full cards vs compact strip (for large casts)
  const densityCtl = '<span class="vle-dens">'
    + (['cards', 'strip'] as const).map((m) => `<button class="vle-dens-b${_density === m ? ' on' : ''}" data-cdensity="${m}" title="${m === 'cards' ? 'Full cards' : 'Compact one-line rows'}">${m === 'cards' ? '\u25A4 cards' : '\u2630 strip'}</button>`).join('')
    + '</span>';
  const header = sectionHeader('Characters', { action: densityCtl + autoCtl + '<button class="vle-add" data-cast-add>+ Character</button>' });
  if (!all.length) return header + emptyState('No characters yet.', 'They appear as the story introduces them.');
  const counts: Record<string, number> = {};
  for (const c of all) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const filtered = _st.cast === 'all' ? all : all.filter((c) => c.status === _st.cast);
  const sorted = sortItems(filtered, _sort.cast);
  const { slice, page, pages } = paginate('cast-list', sorted);
  const bar = filterBar('cast', counts, all.length);
  if (!slice.length) return header + bar + emptyState('No characters match this filter.');
  const body = _density === 'strip'
    ? '<div class="vle-strips">' + slice.map((c) => strip(s, c)).join('') + '</div>'
    : '<div class="vle-cards">' + slice.map((c) => card(s, c)).join('') + '</div>';
  return header + bar + body + pagerHtml('cast-list', page, pages);
}

function castForm(title: string, v: Record<string, string>): void {
  formModal(title, [
    { key: 'name', label: 'Name', type: 'text', value: v.name, placeholder: 'Cersei Lannister' },
    { key: 'role', label: 'Role', type: 'text', value: v.role, placeholder: 'Queen Regent' },
    { key: 'age', label: 'Age', type: 'text', value: v.age },
    { key: 'appearance', label: 'Appearance', type: 'text', value: v.appearance },
    { key: 'aka', label: 'Also known as (comma-separated)', type: 'text', value: v.aka },
    { key: 'status', label: 'Status', type: 'select', value: v.status ?? 'active', options: STATUS_OPTS },
    { key: 'disposition', label: 'Disposition (one-line temperament)', type: 'text', value: v.disposition },
    { key: 'traits', label: 'Personality traits (comma-separated)', type: 'text', value: v.traits },
    { key: 'note', label: 'Note', type: 'textarea', value: v.note },
    { key: 'deceased', label: 'Life state', type: 'select', value: v.deceased ?? 'no', options: [{ value: 'no', label: 'Alive' }, { value: 'yes', label: 'Deceased' }] },
    { key: 'color', label: 'Name color', type: 'color', value: v.color },
    { key: 'colorTo', label: 'Gradient end (optional)', type: 'color', value: v.colorTo },
    { key: 'imageUrl', label: 'Portrait image URL (optional)', type: 'text', value: v.imageUrl, placeholder: 'https://\u2026' },
  ], (out) => {
    if (!out.name?.trim()) return;
    cmd('cast_upsert', { ...(v.id ? { id: v.id } : {}), ...out });
  });
}

/** Inline bond chips for a character (ally/rival/etc), used in expanded cards
 * and strips. Reads relations from the rendered state. Capped for tidiness. */
function bondChips(s: ChronicleState, id: string): string {
  const rels = s.relations.filter((r) => r.a === id).slice(0, 4);
  if (!rels.length) return '';
  return rels.map((r) => {
    const cat = (r.categories[0] || r.category || 'neutral');
    const tone = affectionTone(r.affection);
    return `<span class="vle-bondchip vle-bondchip--${tone}" title="${esc(bondTitle(nameOf(s, r.b), r.affection, r.trust))}">${esc(nameOf(s, r.b))} \u00b7 ${esc(cat)}</span>`;
  }).join('');

}

/** A dagger suffix for deceased characters (empty for the living). */
function deceasedMark(c: CastCard): string {
  return c.deceased ? ' <span class="vle-deceased" title="deceased">\u2020</span>' : '';
}

/** Personality trait tags for a character, rendered as neutral chips. */
function traitChips(c: CastCard): string {
  const traits = (c.traits ?? []).filter(Boolean).slice(0, 6);
  if (!traits.length) return '';
  return traits.map((t) => `<span class="vle-traitchip">${esc(t)}</span>`).join('');
}

const DRIFT_GLYPH: Record<string, string> = { emerge: '\u2726', reverse: '\u21C4', resurface: '\u21BA', harden: '\u25C6', fade: '\u00b7' };

/** Personality-drift lane on an expanded card: a one-line arc (the glance) + a
 * turn-stamped timeline of how/when/why each trait changed (the dive). Each node
 * shows its cause on hover. Only rendered when the character has actually drifted. */
function driftSection(s: ChronicleState, id: string): string {
  const arcs = traitArc(s, id);
  const dormant = dormantTraits(s, id);
  const events = (s.traitHistory ?? []).filter((e) => e.who === id);
  const drifted = events.some((e) => e.op !== 'emerge') || events.length > 1;
  if (!drifted) return '';
  // glance: the arc line
  const active = arcs.map((a) => `<span class="vle-drift-t vle-drift-${a.momentum}">${esc(a.trait)}</span>`).join('<span class="vle-drift-arrow">\u2192</span>');
  const dormantChips = dormant.length ? `<span class="vle-drift-dormant-lbl">was</span> ${dormant.map((t) => `<span class="vle-drift-t vle-drift-gone">${esc(t)}</span>`).join(' ')}` : '';
  // dive: the timeline, chronological
  const rows = events.slice().sort((a, b) => a.turn - b.turn).map((e) => {
    const label = e.op === 'reverse' && e.from ? `${esc(e.from)} \u2192 ${esc(e.trait)}` : esc(e.trait);
    const cause = e.cause ? ` title="${esc(e.cause)}"` : '';
    return `<div class="vle-drift-node vle-drift-${e.op}"${cause}><span class="vle-drift-mark">${DRIFT_GLYPH[e.op] ?? '\u00b7'}</span>`
      + `<span class="vle-drift-op">${e.op}</span><span class="vle-drift-lab">${label}</span>`
      + (e.cause ? `<span class="vle-drift-cause">${esc(e.cause)}</span>` : '')
      + `<span class="vle-drift-turn">t${e.turn}</span></div>`;
  }).join('');
  return '<div class="vle-drift">'
    + `<div class="vle-drift-arc"><span class="vle-drift-k">drift</span>${active}${dormantChips ? ' \u00b7 ' + dormantChips : ''}</div>`
    + `<div class="vle-drift-timeline">${rows}</div>`
    + '</div>';
}

function card(s: ChronicleState, c: CastCard): string {
  const A = (x: unknown): string => esc(x);
  // sentence-case "role, age" line; presence shown by avatar dot + card spine
  const meta = [c.role, c.age].filter(Boolean).map(esc).join(', ');
  const st = STATUS.find((x) => x.id === c.status);
  const where = c.status === 'present' ? 'present' : (st?.label.toLowerCase() ?? c.status);
  const sub = [where, meta].filter(Boolean).join(' \u00b7 ');
  const open = _expanded.has(c.id);
  const aka = (c.aka ?? []).filter(Boolean);
  // expanded-only detail: appearance, aka, inline bonds, note
  const detail = open
    ? '<div class="vle-card-detail">'
      + (c.appearance ? `<div class="vle-card-app2">${esc(c.appearance)}</div>` : '')
      + (c.disposition ? `<div class="vle-card-disp">${esc(c.disposition)}</div>` : '')
      + (() => { const tr = traitChips(c); return tr ? `<div class="vle-card-traits">${tr}</div>` : ''; })()
      + driftSection(s, c.id)
      + (aka.length ? `<div class="vle-card-aka"><span class="vle-card-aka-k">aka</span> ${esc(aka.join(', '))}</div>` : '')
      + (() => { const ch = bondChips(s, c.id); return ch ? `<div class="vle-card-bonds">${ch}</div>` : ''; })()
      + (c.note ? `<div class="vle-card-note">${esc(c.note)}</div>` : '')
      + '</div>'
    : '';
  return '<div class="vle-card vle-card--' + esc(c.status) + (c.status === 'present' ? ' on' : '') + (open ? ' is-open' : '') + '">'
    + shapeOrnament(activeShape('cast'), 'cast')
    + '<button class="vle-av' + (c.imageUrl ? ' has-img' : '') + (c.deceased ? ' v-orn--ring-harm' : '') + '" data-cast-unfold data-id="' + A(c.id) + '" title="' + esc(c.status) + ' \u00b7 expand"' + (c.imageUrl ? ' style="background-image:url(' + JSON.stringify(c.imageUrl) + ')"' : '') + '>' + (c.imageUrl ? '' : esc(initials(c.name))) + '<span class="vle-av-dot"></span></button>'
    + '<span class="vle-card-main"><span class="vle-card-n">' + nameHtmlCard(c) + deceasedMark(c) + (c.userEdited ? ' <span class="vle-star">\u2605</span>' : '') + '</span>'
    + (sub ? '<span class="vle-card-sub">' + sub + '</span>' : '')
    + (!open && c.appearance ? '<span class="vle-card-app">' + esc(c.appearance) + '</span>' : '')
    + detail
    + '</span>'
    + '<span class="vle-card-ctl">'
    + `<button class="vle-mini" data-cast-unfold data-id="${A(c.id)}" title="${open ? 'Collapse' : 'Expand'}">${open ? '\u2303' : '\u2304'}</button>`
    + `<button class="vle-mini" data-cast-promote data-id="${A(c.id)}" title="Promote to Vault lore">\u2934</button>`
    + `<button class="vle-mini" data-cast-edit data-id="${A(c.id)}" data-name="${A(c.name)}" data-role="${A(c.role)}" data-age="${A(c.age)}" data-app="${A(c.appearance)}" data-note="${A(c.note)}" data-status="${A(c.status)}" data-aka="${A((c.aka ?? []).join(', '))}" data-disp="${A(c.disposition ?? '')}" data-traits="${A((c.traits ?? []).join(', '))}" data-color="${A(c.color ?? '')}" data-colorto="${A(c.colorTo ?? '')}" data-img="${A(c.imageUrl ?? '')}" data-deceased="${c.deceased ? 'yes' : 'no'}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-cast-del data-id="${A(c.id)}" data-name="${A(c.name)}" title="Remove">\u2715</button>`
    + '</span></div>';
}

/** Compact one-line row for big casts: dot + name + status + role + bond dots. */
function strip(s: ChronicleState, c: CastCard): string {
  const A = (x: unknown): string => esc(x);
  const st = STATUS.find((x) => x.id === c.status);
  const where = c.status === 'present' ? 'present' : (st?.label.toLowerCase() ?? c.status);
  // two-axis bond glyphs: affection = fill color, trust = ring (see bondDot).
  const dots = s.relations.filter((r) => r.a === c.id).slice(0, 5).map((r) =>
    bondDot(r.affection, r.trust, bondTitle(nameOf(s, r.b), r.affection, r.trust))).join('');

  const sav = avatarParts(c.name, c.imageUrl);
  return '<div class="vle-strip vle-card--' + esc(c.status) + '">'
    + '<span class="vle-strip-av' + sav.cls + '"' + sav.style + '>' + sav.inner + '</span>'
    + '<span class="vle-strip-n">' + nameHtmlCard(c) + deceasedMark(c) + '</span>'
    + '<span class="vle-strip-st">' + esc(where) + '</span>'
    + (c.role ? '<span class="vle-strip-role">' + esc(c.role) + '</span>' : '')
    + (dots ? '<span class="vle-strip-bonds">' + dots + '</span>' : '')
    + '<span class="vle-card-ctl">'
    + `<button class="vle-mini" data-cast-edit data-id="${A(c.id)}" data-name="${A(c.name)}" data-role="${A(c.role)}" data-age="${A(c.age)}" data-app="${A(c.appearance)}" data-note="${A(c.note)}" data-status="${A(c.status)}" data-aka="${A((c.aka ?? []).join(', '))}" data-disp="${A(c.disposition ?? '')}" data-traits="${A((c.traits ?? []).join(', '))}" data-color="${A(c.color ?? '')}" data-colorto="${A(c.colorTo ?? '')}" data-img="${A(c.imageUrl ?? '')}" data-deceased="${c.deceased ? 'yes' : 'no'}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-cast-del data-id="${A(c.id)}" data-name="${A(c.name)}" title="Remove">\u2715</button>`
    + '</span></div>';
}

// ---------- factions ----------
function factionSection(s: ChronicleState): string {
  const all = Object.values(s.factions);
  const header = sectionHeader('Factions', { gap: true, action: '<button class="vle-add" data-fac-add>+ Faction</button>' });
  if (!all.length) return header + emptyState('No factions yet.', 'Groups appear as the story names them.');
  const counts: Record<string, number> = {};
  for (const f of all) counts[f.status] = (counts[f.status] ?? 0) + 1;
  const filtered = _st.fac === 'all' ? all : all.filter((f) => f.status === _st.fac);
  const sorted = sortItems(filtered, _sort.fac);
  const { slice, page, pages } = paginate('fac-list', sorted);
  const bar = filterBar('fac', counts, all.length);
  if (!slice.length) return header + bar + emptyState('No factions match this filter.');
  return header + bar + '<div class="vle-cards">' + slice.map((f) => factionCard(s, f)).join('') + '</div>' + pagerHtml('fac-list', page, pages);
}

function factionCard(s: ChronicleState, f: Faction): string {
  const A = (x: unknown): string => esc(x);
  const members = s.memberships.filter((m) => m.faction === f.id);
  const chips = members.slice(0, 8).map((m) => `<span class="vle-fac-mem" title="${A(m.role ?? '')}">${nameHtml(s, m.char)}${m.role ? ' \u00b7 ' + esc(m.role) : ''}<button class="vle-fac-x" data-fac-memdel data-id="${A(f.id)}" data-char="${A(m.char)}" title="Remove">\u00d7</button></span>`).join('');
  const stand = standingLabel(f.standing);
  return '<div class="vle-card vle-fac vle-card--' + esc(f.status) + (f.status === 'present' ? ' on' : '') + '">'
    + shapeOrnament(activeShape('factions'), 'factions')
    + '<span class="vle-av vle-fac-av" title="' + esc(f.status) + '">' + esc(initials(f.name)) + '</span>'
    + '<span class="vle-card-main"><span class="vle-card-n">' + esc(f.name) + (f.userEdited ? ' <span class="vle-star">\u2605</span>' : '') + '</span>'
    + (f.kind ? '<span class="vle-card-meta">' + esc(f.kind) + '</span>' : '')
    + (f.seat ? '<span class="vle-card-meta">seat: ' + esc(s.locations.find((l) => l.id === f.seat)?.name ?? f.seat) + '</span>' : '')
    + `<span class="vle-fac-standrow"><span class="vle-fac-stand ${stand.cls}">${stand.text}</span><span class="vle-fac-meter">` + bar('Standing', f.standing) + '</span></span>'
    + (members.length ? '<span class="vle-fac-mems">' + chips + (members.length > 8 ? ` <span class="vle-fac-more">+${members.length - 8}</span>` : '') + '</span>' : '<span class="vle-card-app vle-dim">no members</span>')
    + relChips(s, f)
    + '</span>'
    + '<span class="vle-card-ctl">'
    + `<button class="vle-mini" data-fac-rel data-id="${A(f.id)}" data-name="${A(f.name)}" title="Add faction relation">\u21C4</button>`
    + `<button class="vle-mini" data-fac-member data-id="${A(f.id)}" data-name="${A(f.name)}" title="Add member">\u002b</button>`
    + `<button class="vle-mini" data-fac-edit data-id="${A(f.id)}" data-name="${A(f.name)}" data-kind="${A(f.kind)}" data-note="${A(f.note)}" data-status="${A(f.status)}" data-standing="${A(f.standing)}" data-trust="${A(f.trust)}" data-seat="${A(f.seat ?? '')}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-fac-del data-id="${A(f.id)}" data-name="${A(f.name)}" title="Remove">\u2715</button>`
    + '</span></div>';
}

/** Inter-faction relation chips (a→b), rendered on the faction card. */
function relChips(s: ChronicleState, f: Faction): string {
  const rels = (s.factionRelations ?? []).filter((r) => r.a === f.id).slice(0, 6);
  if (!rels.length) return '';
  const nm = (id: string): string => s.factions[id]?.name ?? id.replace(/^fac:/, '');
  const chips = rels.map((r) =>
    `<span class="vle-fac-mem" title="${esc(r.kind)}${r.standing ? ' ' + r.standing : ''}">${esc(r.kind)} \u00b7 ${esc(nm(r.b))}`
    + `<button class="vle-fac-x" data-fac-reldel data-a="${esc(r.a)}" data-b="${esc(r.b)}" title="Remove">\u00d7</button></span>`).join('');
  return '<span class="vle-fac-mems">' + chips + '</span>';
}

function factionRelForm(factionId: string, factionName: string): void {
  const facs = _state ? Object.values(_state.factions).filter((f) => f.id !== factionId) : [];
  if (!facs.length) { formModal('Faction relation', [{ key: 'none', label: 'Add another faction first', type: 'text', value: '' }], () => {}); return; }
  const opts = facs.sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ value: f.id, label: f.name }));
  formModal('Relation from ' + factionName, [
    { key: 'b', label: 'Toward faction', type: 'select', value: opts[0]!.value, options: opts },
    { key: 'kind', label: 'Kind', type: 'select', value: 'rivalry', options: [
      { value: 'alliance', label: 'Alliance' }, { value: 'rivalry', label: 'Rivalry' },
      { value: 'war', label: 'War' }, { value: 'vassal', label: 'Vassal' }, { value: 'trade', label: 'Trade' },
    ] },
    { key: 'standing', label: 'Standing toward it (-100..100)', type: 'text', value: '0' },
  ], (out) => { if (out.b) cmd('faction_relation_set', { a: factionId, b: out.b, kind: out.kind, standing: out.standing }); });
}

function standingLabel(n: number): { text: string; cls: string } {
  if (n >= 40) return { text: 'devoted', cls: 'warm' };
  if (n >= 15) return { text: 'friendly', cls: 'warm' };
  if (n > -15) return { text: 'neutral', cls: 'neu' };
  if (n > -40) return { text: 'wary', cls: 'cool' };
  return { text: 'hostile', cls: 'cool' };
}

function factionForm(title: string, v: Record<string, string>): void {
  const locs = (_state?.locations ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const seatOpts = [{ value: '', label: '\u2014 none \u2014' }, ...locs.map((l) => ({ value: l.id, label: l.name }))];
  formModal(title, [
    { key: 'name', label: 'Name', type: 'text', value: v.name, placeholder: 'Harrenhal Household Staff' },
    { key: 'kind', label: 'Kind', type: 'text', value: v.kind, placeholder: 'household / house / guild' },
    { key: 'status', label: 'Status', type: 'select', value: v.status ?? 'active', options: STATUS_OPTS },
    { key: 'standing', label: 'Standing toward you (-100..100)', type: 'text', value: v.standing ?? '0' },
    { key: 'seat', label: 'Seat / territory (location)', type: 'select', value: v.seat ?? '', options: seatOpts },
    { key: 'note', label: 'Note', type: 'textarea', value: v.note },
  ], (out) => { if (out.name?.trim()) cmd('faction_upsert', { ...(v.id ? { id: v.id } : {}), ...out }); });
}

function memberForm(factionId: string, factionName: string): void {
  // offer existing characters (those not already in this faction) so the user
  // links a real card instead of typing a name that spawns a duplicate. Picking
  // an existing one sends its canonical id (idempotent in ensureCast); the
  // free-text field is the escape hatch for someone not yet on the roster.
  const cast = _state ? Object.values(_state.cast) : [];
  const inFaction = new Set((_state?.memberships ?? []).filter((m) => m.faction === factionId).map((m) => m.char));
  const avail = cast.filter((c) => !inFaction.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  const opts = [{ value: '', label: avail.length ? '\u2014 pick existing character \u2014' : '\u2014 no other characters \u2014' }, ...avail.map((c) => ({ value: c.id, label: c.name }))];
  formModal('Add member to ' + factionName, [
    { key: 'existing', label: 'Existing character', type: 'select', value: '', options: opts },
    { key: 'char', label: 'or new character name', type: 'text', placeholder: 'Martha' },
    { key: 'role', label: 'Role in faction (optional)', type: 'text' },
  ], (out) => {
    const char = out.existing?.trim() || out.char?.trim(); // existing id wins → no duplicate card
    if (char) cmd('faction_member', { char, faction: factionId, op: 'add', ...(out.role ? { role: out.role } : {}) });
  });
}
