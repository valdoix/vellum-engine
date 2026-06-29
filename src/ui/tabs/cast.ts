import type { Component } from '../component.js';
import type { ChronicleState, CastCard, Faction } from '../../domain/types.js';
import { esc, initials, byRecent, bar, emptyState, sectionHeader, nameHtmlCard, nameHtml, autoNameMode, setAutoNameMode } from '../format.js';
import { cmd, paginate, pagerHtml, send, setPage, refreshUI } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';

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
    const cv = Object.values(s.cast).map((c) => `${c.id}|${c.name}|${c.status}|${c.role}|${c.age}|${c.appearance}|${c.note}|${(c.aka ?? []).join(',')}|${c.lastTurn}|${c.color ?? ''}|${c.colorTo ?? ''}`).join(';');
    const fv = Object.values(s.factions).map((f) => `${f.id}|${f.name}|${f.status}|${f.kind}|${f.standing}|${f.trust}|${f.lastTurn}`).join(';');
    const mv = s.memberships.map((m) => `${m.char}>${m.faction}:${m.role ?? ''}`).join(',');
    return cv + '#' + fv + '#' + mv + ':' + s.turns + '#' + _st.cast + _sort.cast + _st.fac + _sort.fac + '#' + autoNameMode();
  },
  render(s) {
    _state = s;
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
          color: ed.getAttribute('data-color') ?? '', colorTo: ed.getAttribute('data-colorto') ?? '',
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
          trust: fed.getAttribute('data-trust') ?? '0',
        });
        return;
      }
      const fdel = t.closest('[data-fac-del]');
      if (fdel) { confirmModal(`Remove the faction ${fdel.getAttribute('data-name')}?`, () => cmd('faction_delete', { id: fdel.getAttribute('data-id') })); return; }
      const mem = t.closest('[data-fac-member]');
      if (mem) { memberForm(mem.getAttribute('data-id') ?? '', mem.getAttribute('data-name') ?? ''); return; }
      const mdel = t.closest('[data-fac-memdel]');
      if (mdel) { cmd('faction_member', { char: mdel.getAttribute('data-char'), faction: mdel.getAttribute('data-id'), op: 'remove' }); return; }
    });
  },
};

// ---------- characters ----------
function castSection(s: ChronicleState): string {
  const all = Object.values(s.cast);
  const auto = autoNameMode();
  const autoCtl = '<span class="vle-autoc">auto color: '
    + (['off', 'solid', 'gradient'] as const).map((m) => `<button class="vle-autoc-b${auto === m ? ' on' : ''}" data-autoname="${m}">${m}</button>`).join('')
    + '</span>';
  const header = sectionHeader('Characters', { action: autoCtl + '<button class="vle-add" data-cast-add>+ Character</button>' });
  if (!all.length) return header + emptyState('No characters yet.', 'They appear as the story introduces them.');
  const counts: Record<string, number> = {};
  for (const c of all) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const filtered = _st.cast === 'all' ? all : all.filter((c) => c.status === _st.cast);
  const sorted = sortItems(filtered, _sort.cast);
  const { slice, page, pages } = paginate('cast-list', sorted);
  const bar = filterBar('cast', counts, all.length);
  if (!slice.length) return header + bar + emptyState('No characters match this filter.');
  return header + bar + '<div class="vle-cards">' + slice.map((c) => card(c)).join('') + '</div>' + pagerHtml('cast-list', page, pages);
}

function castForm(title: string, v: Record<string, string>): void {
  formModal(title, [
    { key: 'name', label: 'Name', type: 'text', value: v.name, placeholder: 'Cersei Lannister' },
    { key: 'role', label: 'Role', type: 'text', value: v.role, placeholder: 'Queen Regent' },
    { key: 'age', label: 'Age', type: 'text', value: v.age },
    { key: 'appearance', label: 'Appearance', type: 'text', value: v.appearance },
    { key: 'aka', label: 'Also known as (comma-separated)', type: 'text', value: v.aka },
    { key: 'status', label: 'Status', type: 'select', value: v.status ?? 'active', options: STATUS_OPTS },
    { key: 'note', label: 'Note', type: 'textarea', value: v.note },
    { key: 'color', label: 'Name color', type: 'color', value: v.color },
    { key: 'colorTo', label: 'Gradient end (optional)', type: 'color', value: v.colorTo },
  ], (out) => {
    if (!out.name?.trim()) return;
    cmd('cast_upsert', { ...(v.id ? { id: v.id } : {}), ...out });
  });
}

function card(c: CastCard): string {
  const meta = [c.role, c.age].filter(Boolean).map(esc).join(' \u00b7 ');
  const A = (x: unknown): string => esc(x);
  return '<div class="vle-card vle-card--' + esc(c.status) + (c.status === 'present' ? ' on' : '') + '">'
    + '<span class="vle-av" title="' + esc(c.status) + '">' + esc(initials(c.name)) + '</span>'
    + '<span class="vle-card-main"><span class="vle-card-n">' + nameHtmlCard(c) + (c.userEdited ? ' <span class="vle-star">\u2605</span>' : '') + '</span>'
    + (meta ? '<span class="vle-card-meta">' + meta + '</span>' : '')
    + (c.appearance ? '<span class="vle-card-app">' + esc(c.appearance) + '</span>' : '')
    + '</span>'
    + '<span class="vle-card-ctl">'
    + `<button class="vle-mini" data-cast-promote data-id="${A(c.id)}" title="Promote to Vault lore">\u2934</button>`
    + `<button class="vle-mini" data-cast-edit data-id="${A(c.id)}" data-name="${A(c.name)}" data-role="${A(c.role)}" data-age="${A(c.age)}" data-app="${A(c.appearance)}" data-note="${A(c.note)}" data-status="${A(c.status)}" data-aka="${A((c.aka ?? []).join(', '))}" data-color="${A(c.color ?? '')}" data-colorto="${A(c.colorTo ?? '')}" title="Edit">\u270E</button>`
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
    + '<span class="vle-av vle-fac-av" title="' + esc(f.status) + '">' + esc(initials(f.name)) + '</span>'
    + '<span class="vle-card-main"><span class="vle-card-n">' + esc(f.name) + (f.userEdited ? ' <span class="vle-star">\u2605</span>' : '') + '</span>'
    + (f.kind ? '<span class="vle-card-meta">' + esc(f.kind) + '</span>' : '')
    + `<span class="vle-fac-standrow"><span class="vle-fac-stand ${stand.cls}">${stand.text}</span><span class="vle-fac-meter">` + bar('Standing', f.standing) + '</span></span>'
    + (members.length ? '<span class="vle-fac-mems">' + chips + (members.length > 8 ? ` <span class="vle-fac-more">+${members.length - 8}</span>` : '') + '</span>' : '<span class="vle-card-app vle-dim">no members</span>')
    + '</span>'
    + '<span class="vle-card-ctl">'
    + `<button class="vle-mini" data-fac-member data-id="${A(f.id)}" data-name="${A(f.name)}" title="Add member">\u002b</button>`
    + `<button class="vle-mini" data-fac-edit data-id="${A(f.id)}" data-name="${A(f.name)}" data-kind="${A(f.kind)}" data-note="${A(f.note)}" data-status="${A(f.status)}" data-standing="${A(f.standing)}" data-trust="${A(f.trust)}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-fac-del data-id="${A(f.id)}" data-name="${A(f.name)}" title="Remove">\u2715</button>`
    + '</span></div>';
}

function standingLabel(n: number): { text: string; cls: string } {
  if (n >= 40) return { text: 'devoted', cls: 'warm' };
  if (n >= 15) return { text: 'friendly', cls: 'warm' };
  if (n > -15) return { text: 'neutral', cls: 'neu' };
  if (n > -40) return { text: 'wary', cls: 'cool' };
  return { text: 'hostile', cls: 'cool' };
}

function factionForm(title: string, v: Record<string, string>): void {
  formModal(title, [
    { key: 'name', label: 'Name', type: 'text', value: v.name, placeholder: 'Harrenhal Household Staff' },
    { key: 'kind', label: 'Kind', type: 'text', value: v.kind, placeholder: 'household / house / guild' },
    { key: 'status', label: 'Status', type: 'select', value: v.status ?? 'active', options: STATUS_OPTS },
    { key: 'standing', label: 'Standing toward you (-100..100)', type: 'text', value: v.standing ?? '0' },
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
