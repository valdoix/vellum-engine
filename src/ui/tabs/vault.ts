import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc } from '../format.js';
import { send } from '../bridge.js';
import { formModal } from '../modal.js';

/**
 * Vault tab — story-aware authoring layer over the host's world books. Groups
 * entries by category (color/glyph), creates entries with category auto-settings
 * (so the user just writes keywords + content), attaches books to the chat, and
 * shows which entries are firing now. Activation itself stays native.
 *
 * Vault data is host-side, so this tab keeps its own snapshot (filled by app.ts
 * on vellum_vault) rather than reading ChronicleState.
 */

interface VCat { id: string; label: string; glyph: string; color: string; hidden: boolean; sync: string; defaults: any }
interface VEntry { id: string; bookId: string; key: string[]; content: string; comment: string; disabled: boolean; vellum: boolean; category: string; source: string; link: string; pending: boolean }
interface VBook { id: string; name: string; attachedToChat: boolean; global: boolean; vellum: boolean; entries: VEntry[] }
interface VSnap { ok: boolean; reason?: string; categories: VCat[]; books: VBook[]; activated: Array<{ id: string }>; suggestions?: Array<{ kind: string; id: string; label: string; reason: string }> }

let _snap: VSnap | null = null;
let _filter = 'all';
let _scope: 'vault' | 'all' = 'vault';
export function setVaultSnap(s: VSnap): void { _snap = s; }

const POS_OPTS = [
  { value: 'before_main', label: 'before main' }, { value: 'after_main', label: 'after main' },
  { value: 'at_depth', label: 'at depth' }, { value: 'before_an', label: 'before A/N' }, { value: 'after_an', label: 'after A/N' },
  { value: 'before_examples', label: 'before examples' }, { value: 'after_examples', label: 'after examples' },
];
const ROLE_OPTS = [{ value: 'system', label: 'system' }, { value: 'user', label: 'user' }, { value: 'assistant', label: 'assistant' }];

export const vaultTab: Component<ChronicleState> = {
  version: () => (_snap ? `${_snap.books.reduce((a, b) => a + b.entries.length, 0)}:${_snap.categories.length}:${_snap.activated.length}:${_filter}` : 'none'),
  render() {
    if (!_snap) { send({ type: 'vellum_get_vault' }); return '<div class="vle-empty sm">Loading vault\u2026</div>'; }
    if (!_snap.ok && _snap.reason === 'no_permission') return '<div class="vlm-comp-error">The Vault needs the <b>world_books</b> permission. Grant it in the extension settings to author lorebooks here.<br><span>Activation stays native; the Vault just organizes + auto-configures.</span></div>';
    const cats = _snap.categories.filter((c) => !c.hidden);
    const all = allEntries();
    // scope: 'vault' shows only VELLUM-managed entries (default, clean); 'all'
    // shows every native lorebook entry too (for adopting existing lore).
    const entries = _scope === 'vault' ? all.filter((e) => e.vellum) : all;
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.category || 'uncat'] = (counts[e.category || 'uncat'] ?? 0) + 1;
    const scopeBar = '<div class="vlv-scopebar">'
      + `<button class="vlv-scope${_scope === 'vault' ? ' on' : ''}" data-vscope="vault">\u2756 Vault <span class="vlv-cn">${all.filter((e) => e.vellum).length}</span></button>`
      + `<button class="vlv-scope${_scope === 'all' ? ' on' : ''}" data-vscope="all">All lorebooks <span class="vlv-cn">${all.length}</span></button>`
      + '</div>';
    const bar = '<div class="vlv-catbar">'
      + `<button class="vlv-chip${_filter === 'all' ? ' on' : ''}" data-vcat="all">All <span class="vlv-cn">${entries.length}</span></button>`
      + cats.map((c) => `<button class="vlv-chip${_filter === c.id ? ' on' : ''}" data-vcat="${esc(c.id)}" style="--c:${c.color}"><span class="vlv-glyph">${esc(c.glyph)}</span>${esc(c.label)} <span class="vlv-cn">${counts[c.id] ?? 0}</span><span class="vlv-gear" data-vcat-settings="${esc(c.id)}">\u2699</span></button>`).join('')
      + '<button class="vlv-chip add" data-vcat-add>+ Category</button>'
      + '</div>';
    const activeBook = _snap.books.find((b) => b.attachedToChat && b.vellum) || _snap.books.find((b) => b.attachedToChat) || _snap.books.find((b) => b.vellum) || _snap.books[0];
    const cur = `<div class="vlv-current"><span class="vlv-current-l">Current lorebook</span><span class="vlv-current-n" data-vbook>${activeBook ? esc(activeBook.name) + (activeBook.attachedToChat ? ' \u2713' : '') : '\u2014 none (one will be created)'}</span></div>`;
    const top = '<div class="vle-sec-top"><button class="vle-add" data-ventry-add>+ Entry</button><button class="vle-qol" data-vbook>\u2913 Books</button></div>' + cur;
    const shown = _filter === 'all' ? entries : entries.filter((e) => e.category === _filter);
    const active = new Set(_snap.activated.map((a) => a.id));
    const pending = all.filter((e) => e.pending);
    const grid = shown.filter((e) => !e.pending).length
      ? '<div class="vlv-grid">' + shown.filter((e) => !e.pending).map((e) => entryCard(e, active.has(e.id))).join('') + '</div>'
      : '<div class="vle-empty sm">' + (_scope === 'vault' ? 'No Vault entries yet. <b>+ Entry</b> to author lore, or switch to <b>All lorebooks</b> to adopt existing entries.' : 'No entries here yet.') + '</div>';
    return top + pendingTray(pending) + suggestStrip() + scopeBar + bar + grid;
  },
  mount(host) {
    // guard: the shell mounts once, but rerender() must NOT re-bind — stacked
    // listeners double-fire and clicks land on replaced nodes (buttons "don't
    // work"). Bind exactly one delegated handler per host element.
    if ((host as any)._vaultBound) return;
    (host as any)._vaultBound = true;
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sc = t.closest('[data-vscope]');
      if (sc) { _scope = sc.getAttribute('data-vscope') as 'vault' | 'all'; _filter = 'all'; rerender(host); return; }
      const chip = t.closest('[data-vcat]');
      if (chip && !t.closest('[data-vcat-settings]')) { _filter = chip.getAttribute('data-vcat')!; rerender(host); return; }
      const gear = t.closest('[data-vcat-settings]'); if (gear) { categorySettings(gear.getAttribute('data-vcat-settings')!); return; }
      if (t.closest('[data-vcat-add]')) { categoryCreate(); return; }
      if (t.closest('[data-ventry-add]')) { entryForm(null); return; }
      if (t.closest('[data-vbook]')) { bookManager(); return; }
      const ed = t.closest('[data-ventry-edit]'); if (ed) { entryForm(findEntry(ed.getAttribute('data-id')!)); return; }
      const del = t.closest('[data-ventry-del]'); if (del && confirm('Delete this entry?')) send({ type: 'vellum_vault_op', op: 'entry_delete', entryId: del.getAttribute('data-id') });
      const un = t.closest('[data-ventry-unlink]'); if (un) send({ type: 'vellum_vault_op', op: 'entry_unlink', entryId: un.getAttribute('data-id'), category: un.getAttribute('data-cat') });
      const sy = t.closest('[data-vsug-accept]'); if (sy) send({ type: 'vellum_vault_suggest', action: 'accept', kind: sy.getAttribute('data-kind'), id: sy.getAttribute('data-id') });
      const sn = t.closest('[data-vsug-dismiss]'); if (sn) send({ type: 'vellum_vault_suggest', action: 'dismiss', kind: sn.getAttribute('data-kind'), id: sn.getAttribute('data-id') });
      const py = t.closest('[data-vpend-accept]'); if (py) send({ type: 'vellum_vault_pending', action: 'accept', entryId: py.getAttribute('data-id'), category: py.getAttribute('data-cat'), link: py.getAttribute('data-link') });
      const pn = t.closest('[data-vpend-reject]'); if (pn) send({ type: 'vellum_vault_pending', action: 'reject', entryId: pn.getAttribute('data-id') });
    });
  },
};

function allEntries(): VEntry[] { return (_snap?.books ?? []).flatMap((b) => b.entries.map((e) => ({ ...e, bookId: b.id }))); }

function suggestStrip(): string {
  const sg = _snap?.suggestions ?? [];
  if (!sg.length) return '';
  const chips = sg.map((s) =>
    `<span class="vlv-sug"><span class="vlv-sug-l">${esc(s.label)}</span><span class="vlv-sug-r">${esc(s.reason)}</span>`
    + `<button class="vlv-sug-y" data-vsug-accept data-kind="${esc(s.kind)}" data-id="${esc(s.id)}" title="Create entry">+</button>`
    + `<button class="vlv-sug-n" data-vsug-dismiss data-kind="${esc(s.kind)}" data-id="${esc(s.id)}" title="Dismiss">\u2715</button></span>`
  ).join('');
  return `<div class="vlv-suggest"><span class="vlv-suggest-h">\u2727 Suggested</span>${chips}</div>`;
}

function pendingTray(pending: VEntry[]): string {
  if (!pending.length) return '';
  const rows = pending.map((e) =>
    `<div class="vlv-pend" data-id="${esc(e.id)}"><div class="vlv-pend-top"><span class="vlv-pend-n">${esc(e.comment || e.key[0] || 'Draft')}</span>`
    + `<span class="vlv-pend-ctl"><button class="vlv-pend-y" data-vpend-accept data-id="${esc(e.id)}" data-cat="${esc(e.category)}" data-link="${esc(e.link ?? '')}" title="Keep">\u2713</button>`
    + `<button class="vlv-pend-e" data-ventry-edit data-id="${esc(e.id)}" title="Edit then keep">\u270E</button>`
    + `<button class="vlv-pend-n2" data-vpend-reject data-id="${esc(e.id)}" title="Reject">\u2715</button></span></div>`
    + `<div class="vlv-pend-c">${esc(e.content).slice(0, 160)}${e.content.length > 160 ? '\u2026' : ''}</div></div>`
  ).join('');
  return `<div class="vlv-pending"><div class="vlv-pending-h">\u270D Drafts to review <span class="vlv-cn">${pending.length}</span></div>${rows}</div>`;
}
function findEntry(id: string): VEntry | null { return allEntries().find((e) => e.id === id) ?? null; }
// rerender only swaps the body; the delegated click handler stays bound on the
// host (mount() is idempotent), so listeners never stack and clicks keep working.
function rerender(host: HTMLElement): void { host.innerHTML = vaultTab.render(null as any); }

function entryCard(e: VEntry, firing: boolean): string {
  const cat = _snap?.categories.find((c) => c.id === e.category);
  const clr = cat?.color ?? '#8c8478';
  const keys = e.key.join(', ');
  return `<div class="vlv-entry${e.disabled ? ' off' : ''}" style="--c:${clr}">`
    + `<div class="vlv-entry-top"><span class="vlv-entry-cat">${esc(cat?.glyph ?? '\u2727')} ${esc(cat?.label ?? 'Uncategorized')}</span>`
    + (firing ? '<span class="vlv-firing">\u25C9 firing</span>' : '')
    + `<span class="vlv-entry-ctl"><button class="vle-mini" data-ventry-edit data-id="${esc(e.id)}">\u270E</button><button class="vle-mini del" data-ventry-del data-id="${esc(e.id)}">\u2715</button></span></div>`
    + (e.comment ? `<div class="vlv-title">${esc(e.comment)}</div>` : '')
    + `<div class="vlv-keys">${keys ? esc(keys) : '<em>always on</em>'}</div>`
    + `<div class="vlv-content">${esc(e.content).slice(0, 280)}${e.content.length > 280 ? '\u2026' : ''}</div>`
    + (e.source && e.source !== 'manual' ? `<div class="vlv-badge">\u21BB auto \u00b7 ${esc(e.source)}<button class="vlv-unlink" data-ventry-unlink data-id="${esc(e.id)}" data-cat="${esc(e.category)}" title="Stop auto-updating (convert to hand-owned)">unlink</button></div>` : '')
    + '</div>';
}

function entryForm(e: VEntry | null): void {
  const cats = (_snap?.categories ?? []).filter((c) => !c.hidden);
  const books = _snap?.books ?? [];
  const bookOpts = [{ value: '', label: books.length ? '(auto: VELLUM Vault)' : '(create VELLUM Vault)' }, ...books.map((b) => ({ value: b.id, label: b.name }))];
  formModal(e ? 'Edit Entry' : 'New Entry', [
    { key: 'title', label: 'Title / Name', type: 'text', value: e?.comment ?? '', placeholder: 'Thornfield Castle' },
    { key: 'category', label: 'Category', type: 'select', value: e?.category ?? cats[0]?.id ?? 'characters', options: cats.map((c) => ({ value: c.id, label: c.label })) },
    ...(e ? [] : [{ key: 'bookId', label: 'Lorebook', type: 'select' as const, value: '', options: bookOpts }]),
    { key: 'key', label: 'Keywords (comma-separated)', type: 'text', value: e?.key.join(', ') ?? '', placeholder: 'Thornfield, the castle' },
    { key: 'content', label: 'Content', type: 'textarea', value: e?.content ?? '' },
  ], (v) => {
    if (!v.content?.trim()) return;
    const payload = { category: v.category, key: v.key, content: v.content, comment: v.title };
    if (e) send({ type: 'vellum_vault_op', op: 'entry_update', entryId: e.id, ...payload });
    else send({ type: 'vellum_vault_op', op: 'entry_create', bookId: v.bookId || '', ...payload });
  });
}

function categorySettings(id: string): void {
  const c = _snap?.categories.find((x) => x.id === id); if (!c) return;
  const d = c.defaults ?? {};
  formModal(`${c.label} — auto-settings`, [
    { key: 'position', label: 'Position', type: 'select', value: d.position ?? 'at_depth', options: POS_OPTS },
    { key: 'depth', label: 'Depth (if at-depth)', type: 'text', value: String(d.depth ?? 4) },
    { key: 'role', label: 'Role', type: 'select', value: d.role ?? 'system', options: ROLE_OPTS },
    { key: 'order', label: 'Order', type: 'text', value: String(d.order ?? 100) },
    { key: 'sticky', label: 'Sticky (turns)', type: 'text', value: String(d.sticky ?? 0) },
    { key: 'sync', label: 'Auto-update', type: 'select', value: c.sync ?? 'off', options: [{ value: 'off', label: 'off' }, { value: 'promote', label: 'promote (manual)' }, { value: 'sync', label: 'sync (auto-update)' }, { value: 'auto', label: 'auto-author (drafts)' }] },
  ], (v) => {
    const defaults = { position: v.position, depth: Number(v.depth) || 4, role: v.role, order: Number(v.order) || 100, sticky: Number(v.sticky) || 0 };
    send({ type: 'vellum_vault_category', cat: { ...c, defaults, sync: v.sync } });
  });
}

function categoryCreate(): void {
  formModal('New Category', [
    { key: 'label', label: 'Name', type: 'text', placeholder: 'Vehicles' },
    { key: 'glyph', label: 'Glyph', type: 'text', value: '\u2727' },
    { key: 'color', label: 'Color (hex)', type: 'text', value: '#cdbfa0' },
    { key: 'position', label: 'Default position', type: 'select', value: 'at_depth', options: POS_OPTS },
    { key: 'order', label: 'Default order', type: 'text', value: '100' },
  ], (v) => { if (v.label?.trim()) send({ type: 'vellum_vault_category', cat: { label: v.label, glyph: v.glyph || '\u2727', color: v.color || '#cdbfa0', defaults: { position: v.position, depth: 4, role: 'system', order: Number(v.order) || 100 } } }); });
}

function bookManager(): void {
  const books = _snap?.books ?? [];
  // a lightweight books overlay: each book has rename + attach toggle + new
  const ov = document.createElement('div');
  ov.className = 'vlfm-overlay';
  const rows = books.map((b) =>
    `<div class="vlv-bk" data-bk="${esc(b.id)}"><span class="vlv-bk-n">${esc(b.name)}</span>`
    + `${b.global ? '<span class="vlv-bk-tag">global</span>' : ''}`
    + `<span class="vlv-bk-ctl"><button class="vle-mini" data-bk-rename data-id="${esc(b.id)}" data-name="${esc(b.name)}" title="Rename">\u270E</button>`
    + `<button class="vlv-bk-att${b.attachedToChat ? ' on' : ''}" data-bk-attach data-id="${esc(b.id)}" data-attach="${b.attachedToChat ? '' : '1'}">${b.attachedToChat ? '\u2713 attached' : '+ attach'}</button></span></div>`
  ).join('') || '<div class="vle-empty sm">No lorebooks yet.</div>';
  ov.innerHTML = '<div class="vlfm"><div class="vlfm-head"><span class="vlfm-mark">\u2756</span>Lorebooks</div>'
    + `<div class="vlfm-body"><div class="vlv-bklist">${rows}</div>`
    + '<label class="vlfm-l">New lorebook<input class="vlfm-in" data-bk-new placeholder="My World"></label></div>'
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-close>Close</button><button class="vlfm-btn vlfm-save" data-bk-create>+ Create</button></div></div>';
  document.body.appendChild(ov);
  const close = (): void => { try { ov.remove(); } catch { /* ignore */ } };
  ov.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === ov || t.closest('[data-close]')) { close(); return; }
    const rn = t.closest('[data-bk-rename]');
    if (rn) { close(); formModal('Rename Lorebook', [{ key: 'name', label: 'Name', type: 'text', value: rn.getAttribute('data-name') ?? '' }], (v) => { if (v.name?.trim()) send({ type: 'vellum_vault_op', op: 'book_update', bookId: rn.getAttribute('data-id'), name: v.name }); }); return; }
    const at = t.closest('[data-bk-attach]'); if (at) { send({ type: 'vellum_vault_op', op: 'book_attach', bookId: at.getAttribute('data-id'), attach: !!at.getAttribute('data-attach') }); close(); return; }
    if (t.closest('[data-bk-create]')) { const inp = ov.querySelector('[data-bk-new]') as HTMLInputElement | null; const name = inp?.value?.trim(); if (name) send({ type: 'vellum_vault_op', op: 'book_create', name, attach: true }); close(); }
  });
}
