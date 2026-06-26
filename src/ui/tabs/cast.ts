import type { Component } from '../component.js';
import type { ChronicleState, CastCard } from '../../domain/types.js';
import { esc, initials, byRecent } from '../format.js';
import { cmd, paginate, pagerHtml } from '../bridge.js';
import { formModal } from '../modal.js';

/**
 * Cast tab. Groups the cast by presence; each card has edit/delete; an add
 * button creates new members; long groups paginate. CRUD flows through the
 * bridge → vellum_cmd → events (src:user, so edits win).
 */

const STATUS_OPTS = [
  { value: 'present', label: 'present' }, { value: 'active', label: 'active' },
  { value: 'mentioned', label: 'mentioned' }, { value: 'added', label: 'added' },
];

export const castTab: Component<ChronicleState> = {
  version: (s) => Object.keys(s.cast).length + ':' + s.turns + ':' + Object.values(s.cast).map((c) => c.lastTurn).join(','),
  render(s) {
    const all = Object.values(s.cast);
    const groups: Array<[string, string, CastCard[], boolean]> = [
      ['\u25C9 Present', 'present', all.filter((c) => c.status === 'present'), true],
      ['\u25CB Active', 'active', all.filter((c) => c.status === 'active'), false],
      ['\u2027 Mentioned', 'mentioned', all.filter((c) => c.status === 'mentioned'), false],
      ['\u2605 Added', 'added', all.filter((c) => c.status === 'added'), false],
    ];
    const header = '<div class="vle-sec-top"><button class="vle-add" data-cast-add>+ Character</button></div>';
    const body = groups.map(([title, gid, cards, present]) => groupHtml(title, gid, cards, present)).join('');
    return header + body;
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
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
      if (del && confirm(`Remove ${del.getAttribute('data-name')} and their relations?`)) cmd('cast_delete', { id: del.getAttribute('data-id') });
    });
  },
};

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
  const A = (s: unknown): string => esc(s);
  return '<div class="vle-card' + (present ? ' on' : '') + '">'
    + '<span class="vle-av">' + esc(initials(c.name)) + '</span>'
    + '<span class="vle-card-main"><span class="vle-card-n">' + esc(c.name) + (c.userEdited ? ' <span class="vle-star">\u2605</span>' : '') + '</span>'
    + (meta ? '<span class="vle-card-meta">' + meta + '</span>' : '')
    + (c.appearance ? '<span class="vle-card-app">' + esc(c.appearance) + '</span>' : '')
    + '</span>'
    + '<span class="vle-card-ctl">'
    + `<button class="vle-mini" data-cast-edit data-id="${A(c.id)}" data-name="${A(c.name)}" data-role="${A(c.role)}" data-age="${A(c.age)}" data-app="${A(c.appearance)}" data-note="${A(c.note)}" data-status="${A(c.status)}" data-aka="${A((c.aka ?? []).join(', '))}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-cast-del data-id="${A(c.id)}" data-name="${A(c.name)}" title="Remove">\u2715</button>`
    + '</span></div>';
}
