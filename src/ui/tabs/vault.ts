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
interface VEntry { id: string; bookId: string; key: string[]; content: string; comment: string; disabled: boolean; vellum: boolean; category: string; source: string; pending: boolean }
interface VBook { id: string; name: string; attachedToChat: boolean; global: boolean; vellum: boolean; entries: VEntry[] }
interface VSnap { ok: boolean; reason?: string; categories: VCat[]; books: VBook[]; activated: Array<{ id: string }> }

let _snap: VSnap | null = null;
let _filter = 'all';
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
    const entries = allEntries();
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.category || 'uncat'] = (counts[e.category || 'uncat'] ?? 0) + 1;
    const bar = '<div class="vlv-catbar">'
      + `<button class="vlv-chip${_filter === 'all' ? ' on' : ''}" data-vcat="all">All <span class="vlv-cn">${entries.length}</span></button>`
      + cats.map((c) => `<button class="vlv-chip${_filter === c.id ? ' on' : ''}" data-vcat="${esc(c.id)}" style="--c:${c.color}"><span class="vlv-glyph">${esc(c.glyph)}</span>${esc(c.label)} <span class="vlv-cn">${counts[c.id] ?? 0}</span><span class="vlv-gear" data-vcat-settings="${esc(c.id)}">\u2699</span></button>`).join('')
      + '<button class="vlv-chip add" data-vcat-add>+ Category</button>'
      + '</div>';
    const top = '<div class="vle-sec-top"><button class="vle-add" data-ventry-add>+ Entry</button><button class="vle-qol" data-vbook>\u2913 Books</button></div>';
    const shown = _filter === 'all' ? entries : entries.filter((e) => e.category === _filter);
    const active = new Set(_snap.activated.map((a) => a.id));
    const grid = shown.length
      ? '<div class="vlv-grid">' + shown.map((e) => entryCard(e, active.has(e.id))).join('') + '</div>'
      : '<div class="vle-empty sm">No entries here yet. <b>+ Entry</b> to add lore.</div>';
    return top + bar + grid;
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const chip = t.closest('[data-vcat]');
      if (chip && !t.closest('[data-vcat-settings]')) { _filter = chip.getAttribute('data-vcat')!; rerender(host); return; }
      const gear = t.closest('[data-vcat-settings]'); if (gear) { categorySettings(gear.getAttribute('data-vcat-settings')!); return; }
      if (t.closest('[data-vcat-add]')) { categoryCreate(); return; }
      if (t.closest('[data-ventry-add]')) { entryForm(null); return; }
      if (t.closest('[data-vbook]')) { bookManager(); return; }
      const ed = t.closest('[data-ventry-edit]'); if (ed) { entryForm(findEntry(ed.getAttribute('data-id')!)); return; }
      const del = t.closest('[data-ventry-del]'); if (del && confirm('Delete this entry?')) send({ type: 'vellum_vault_op', op: 'entry_delete', entryId: del.getAttribute('data-id') });
      const un = t.closest('[data-ventry-unlink]'); if (un) send({ type: 'vellum_vault_op', op: 'entry_unlink', entryId: un.getAttribute('data-id'), category: un.getAttribute('data-cat') });
    });
  },
};

function allEntries(): VEntry[] { return (_snap?.books ?? []).flatMap((b) => b.entries.map((e) => ({ ...e, bookId: b.id }))); }
function findEntry(id: string): VEntry | null { return allEntries().find((e) => e.id === id) ?? null; }
function rerender(host: HTMLElement): void { host.innerHTML = vaultTab.render(null as any); vaultTab.mount?.(host); }

function entryCard(e: VEntry, firing: boolean): string {
  const cat = _snap?.categories.find((c) => c.id === e.category);
  const clr = cat?.color ?? '#8c8478';
  const keys = e.key.join(', ');
  return `<div class="vlv-entry${e.disabled ? ' off' : ''}" style="--c:${clr}">`
    + `<div class="vlv-entry-top"><span class="vlv-entry-cat">${esc(cat?.glyph ?? '\u2727')} ${esc(cat?.label ?? 'Uncategorized')}</span>`
    + (firing ? '<span class="vlv-firing">\u25C9 firing</span>' : '')
    + `<span class="vlv-entry-ctl"><button class="vle-mini" data-ventry-edit data-id="${esc(e.id)}">\u270E</button><button class="vle-mini del" data-ventry-del data-id="${esc(e.id)}">\u2715</button></span></div>`
    + `<div class="vlv-keys">${keys ? esc(keys) : '<em>always on</em>'}</div>`
    + `<div class="vlv-content">${esc(e.content).slice(0, 280)}${e.content.length > 280 ? '\u2026' : ''}</div>`
    + (e.source && e.source !== 'manual' ? `<div class="vlv-badge">\u21BB auto \u00b7 ${esc(e.source)}<button class="vlv-unlink" data-ventry-unlink data-id="${esc(e.id)}" data-cat="${esc(e.category)}" title="Stop auto-updating (convert to hand-owned)">unlink</button></div>` : '')
    + '</div>';
}

function entryForm(e: VEntry | null): void {
  const cats = (_snap?.categories ?? []).filter((c) => !c.hidden);
  const books = _snap?.books ?? [];
  formModal(e ? 'Edit Entry' : 'New Entry', [
    { key: 'category', label: 'Category', type: 'select', value: e?.category ?? cats[0]?.id ?? 'characters', options: cats.map((c) => ({ value: c.id, label: c.label })) },
    ...(e ? [] : [{ key: 'bookId', label: 'Lorebook', type: 'select' as const, value: books[0]?.id ?? '', options: books.map((b) => ({ value: b.id, label: b.name })) }]),
    { key: 'key', label: 'Keywords (comma-separated)', type: 'text', value: e?.key.join(', ') ?? '' },
    { key: 'content', label: 'Content', type: 'textarea', value: e?.content ?? '' },
    { key: 'comment', label: 'Label (optional)', type: 'text', value: e?.comment ?? '' },
  ], (v) => {
    if (!v.content?.trim()) return;
    if (e) send({ type: 'vellum_vault_op', op: 'entry_update', entryId: e.id, ...v });
    else { if (!v.bookId) { send({ type: 'vellum_vault_op', op: 'book_create', name: 'VELLUM Vault', attach: true }); return; } send({ type: 'vellum_vault_op', op: 'entry_create', ...v }); }
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
    { key: 'sync', label: 'Auto-update', type: 'select', value: c.sync ?? 'off', options: [{ value: 'off', label: 'off' }, { value: 'promote', label: 'promote (manual)' }, { value: 'sync', label: 'sync (auto-update)' }] },
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
  const rows = books.map((b) => `${b.name}${b.attachedToChat ? ' \u2713attached' : ''}${b.global ? ' \u00b7global' : ''}`).join('\n') || '(none)';
  formModal('Lorebooks', [
    { key: 'name', label: 'New lorebook name', type: 'text', placeholder: 'My World' },
    { key: 'existing', label: 'Existing', type: 'textarea', value: rows },
  ], (v) => { if (v.name?.trim()) send({ type: 'vellum_vault_op', op: 'book_create', name: v.name, attach: true }); });
}
