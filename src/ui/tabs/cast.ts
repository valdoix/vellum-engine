import type { Component } from '../component.js';
import type { ChronicleState, CastCard, Faction } from '../../domain/types.js';
import { esc, initials, byRecent } from '../format.js';
import { cmd, paginate, pagerHtml, send } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';

/**
 * Cast tab — two sections: CHARACTERS (individuals) and FACTIONS (groups).
 * Each is grouped by presence and paginates. Factions show a standing meter and
 * their member roster. CRUD flows through the bridge → vellum_cmd → events.
 */

const STATUS_OPTS = [
  { value: 'present', label: 'present' }, { value: 'active', label: 'active' },
  { value: 'mentioned', label: 'mentioned' }, { value: 'added', label: 'added' },
];

export const castTab: Component<ChronicleState> = {
  version: (s) => {
    const cv = Object.values(s.cast).map((c) => `${c.id}|${c.name}|${c.status}|${c.role}|${c.age}|${c.appearance}|${c.note}|${(c.aka ?? []).join(',')}|${c.lastTurn}`).join(';');
    const fv = Object.values(s.factions).map((f) => `${f.id}|${f.name}|${f.status}|${f.kind}|${f.standing}|${f.trust}|${f.lastTurn}`).join(';');
    const mv = s.memberships.map((m) => `${m.char}>${m.faction}:${m.role ?? ''}`).join(',');
    return cv + '#' + fv + '#' + mv + ':' + s.turns;
  },
  render(s) {
    return castSection(s) + factionSection(s);
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
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
  const groups: Array<[string, string, CastCard[], boolean]> = [
    ['\u25C9 Present', 'present', all.filter((c) => c.status === 'present'), true],
    ['\u25CB Active', 'active', all.filter((c) => c.status === 'active'), false],
    ['\u2027 Mentioned', 'mentioned', all.filter((c) => c.status === 'mentioned'), false],
    ['\u2605 Added', 'added', all.filter((c) => c.status === 'added'), false],
  ];
  const header = '<div class="vle-sec-top"><span class="vle-sec-title">Characters</span><button class="vle-add" data-cast-add>+ Character</button></div>';
  return header + groups.map(([title, gid, cards, present]) => groupHtml(title, gid, cards, present)).join('');
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
  ], (out) => { if (out.name?.trim()) cmd('cast_upsert', { ...(v.id ? { id: v.id } : {}), ...out }); });
}

function groupHtml(title: string, gid: string, cards: CastCard[], present: boolean): string {
  if (!cards.length) return '<div class="vle-sec-h">' + esc(title) + ' <span class="vle-n">0</span></div><div class="vle-empty sm">\u2014</div>';
  const sorted = cards.slice().sort(byRecent);
  const { slice, page, pages } = paginate('cast-' + gid, sorted);
  return '<div class="vle-sec-h">' + esc(title) + ' <span class="vle-n">' + cards.length + '</span></div>'
    + '<div class="vle-cards">' + slice.map((c) => card(c, present)).join('') + '</div>'
    + pagerHtml('cast-' + gid, page, pages);
}

function card(c: CastCard, present: boolean): string {
  const meta = [c.role, c.age].filter(Boolean).map(esc).join(' \u00b7 ');
  const A = (x: unknown): string => esc(x);
  return '<div class="vle-card' + (present ? ' on' : '') + '">'
    + '<span class="vle-av">' + esc(initials(c.name)) + '</span>'
    + '<span class="vle-card-main"><span class="vle-card-n">' + esc(c.name) + (c.userEdited ? ' <span class="vle-star">\u2605</span>' : '') + '</span>'
    + (meta ? '<span class="vle-card-meta">' + meta + '</span>' : '')
    + (c.appearance ? '<span class="vle-card-app">' + esc(c.appearance) + '</span>' : '')
    + '</span>'
    + '<span class="vle-card-ctl">'
    + `<button class="vle-mini" data-cast-promote data-id="${A(c.id)}" title="Promote to Vault lore">\u2756</button>`
    + `<button class="vle-mini" data-cast-edit data-id="${A(c.id)}" data-name="${A(c.name)}" data-role="${A(c.role)}" data-age="${A(c.age)}" data-app="${A(c.appearance)}" data-note="${A(c.note)}" data-status="${A(c.status)}" data-aka="${A((c.aka ?? []).join(', '))}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-cast-del data-id="${A(c.id)}" data-name="${A(c.name)}" title="Remove">\u2715</button>`
    + '</span></div>';
}

// ---------- factions ----------
function factionSection(s: ChronicleState): string {
  const all = Object.values(s.factions);
  const header = '<div class="vle-sec-top" style="margin-top:14px"><span class="vle-sec-title">Factions</span><button class="vle-add" data-fac-add>+ Faction</button></div>';
  if (!all.length) return header + '<div class="vle-empty sm">No factions yet \u2014 groups appear as the story names them.</div>';
  const groups: Array<[string, string, Faction[]]> = [
    ['\u25C9 Present', 'present', all.filter((f) => f.status === 'present')],
    ['\u25CB Active', 'active', all.filter((f) => f.status === 'active')],
    ['\u2027 Mentioned', 'mentioned', all.filter((f) => f.status === 'mentioned')],
    ['\u2605 Added', 'added', all.filter((f) => f.status === 'added')],
  ];
  return header + groups.map(([title, gid, facs]) => facGroupHtml(s, title, gid, facs)).join('');
}

function facGroupHtml(s: ChronicleState, title: string, gid: string, facs: Faction[]): string {
  if (!facs.length) return '';
  const sorted = facs.slice().sort(byRecent);
  const { slice, page, pages } = paginate('fac-' + gid, sorted);
  return '<div class="vle-sec-h">' + esc(title) + ' <span class="vle-n">' + facs.length + '</span></div>'
    + '<div class="vle-cards">' + slice.map((f) => factionCard(s, f)).join('') + '</div>'
    + pagerHtml('fac-' + gid, page, pages);
}

function factionCard(s: ChronicleState, f: Faction): string {
  const A = (x: unknown): string => esc(x);
  const members = s.memberships.filter((m) => m.faction === f.id);
  const nameOf = (id: string): string => s.cast[id]?.name ?? id;
  const chips = members.slice(0, 8).map((m) => `<span class="vle-fac-mem" title="${A(m.role ?? '')}">${esc(nameOf(m.char))}${m.role ? ' \u00b7 ' + esc(m.role) : ''}<button class="vle-fac-x" data-fac-memdel data-id="${A(f.id)}" data-char="${A(m.char)}" title="Remove">\u00d7</button></span>`).join('');
  const stand = standingLabel(f.standing);
  return '<div class="vle-card vle-fac">'
    + '<span class="vle-av vle-fac-av">' + esc(initials(f.name)) + '</span>'
    + '<span class="vle-card-main"><span class="vle-card-n">' + esc(f.name) + (f.userEdited ? ' <span class="vle-star">\u2605</span>' : '') + '</span>'
    + '<span class="vle-card-meta">' + (f.kind ? esc(f.kind) + ' \u00b7 ' : '') + `<span class="vle-fac-stand ${stand.cls}">${stand.text} (${f.standing > 0 ? '+' : ''}${f.standing})</span></span>`
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
  formModal('Add member to ' + factionName, [
    { key: 'char', label: 'Character name', type: 'text', placeholder: 'Martha' },
    { key: 'role', label: 'Role in faction (optional)', type: 'text' },
  ], (out) => { if (out.char?.trim()) cmd('faction_member', { char: out.char, faction: factionId, op: 'add', ...(out.role ? { role: out.role } : {}) }); });
}
