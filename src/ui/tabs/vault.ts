import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc, safeColor } from '../format.js';
import { send, paginate, pagerHtml, setPage } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';

/**
 * Vault tab — story-aware authoring layer over the host's world books. Groups
 * entries by category (color/glyph), creates entries with category auto-settings
 * (so the user just writes keywords + content), attaches books to the chat, and
 * shows which entries are firing now. Activation itself stays native.
 *
 * Vault data is host-side, so this tab keeps its own snapshot (filled by app.ts
 * on vellum_vault) rather than reading ChronicleState.
 */

interface VCat { id: string; label: string; glyph: string; color: string; hidden: boolean; sync: string; source?: string; defaults: any }
interface VEntry { id: string; bookId: string; key: string[]; keysecondary?: string[]; content: string; comment: string; constant?: boolean; disabled: boolean; vellum: boolean; category: string; source: string; link: string; pending: boolean; ownerChatId?: string; schemaVersion?: number; bodyState?: 'clean' | 'override' | 'conflict' | 'legacy'; overrideFields?: string[]; recursionKeys?: string[]; createdAt?: number; updatedAt?: number }
interface VBook { id: string; name: string; attachedToChat: boolean; global: boolean; vellum: boolean; ownerChatId?: string; role?: string; entries: VEntry[] }
interface VHealthIssue { code: string; severity: 'error' | 'warning' | 'info'; message: string; entryId?: string; bookId?: string; link?: string }
interface VHealth { score: number; issues: VHealthIssue[]; stats: { books: number; entries: number; conflicts: number; orphaned: number; owned: number } }
interface VSnap { ok: boolean; chatId?: string; reason?: string; listFailed?: boolean; complete?: boolean; errors?: string[]; categories: VCat[]; books: VBook[]; activated: Array<{ id: string }>; suggestions?: Array<{ kind: string; id: string; label: string; reason: string }>; health?: VHealth }

let _snap: VSnap | null = null;
let _filter = 'all';
let _scope: 'vault' | 'all' = 'vault';
let _sort: 'az' | 'za' | 'new' | 'old' = 'az';
let _book = 'all'; // lorebook filter ('all' or a book id)
let _query = '';
export function setVaultSnap(s: VSnap): void { _snap = s; }
function bookName(id: string): string { return _snap?.books.find((b) => b.id === id)?.name ?? id; }

const POS_OPTS = [
  { value: 'before_main', label: 'before main' }, { value: 'after_main', label: 'after main' },
  { value: 'at_depth', label: 'at depth' }, { value: 'before_an', label: 'before A/N' }, { value: 'after_an', label: 'after A/N' },
  { value: 'before_examples', label: 'before examples' }, { value: 'after_examples', label: 'after examples' },
];
const ROLE_OPTS = [{ value: 'system', label: 'system' }, { value: 'user', label: 'user' }, { value: 'assistant', label: 'assistant' }];
const SOURCE_OPTS = [
  { value: '', label: 'none (manual only)' }, { value: 'cast', label: 'cast' }, { value: 'relations', label: 'relationships' },
  { value: 'factions', label: 'factions' }, { value: 'locations', label: 'locations' }, { value: 'items', label: 'items' },
  { value: 'lore', label: 'Codex lore' }, { value: 'memories', label: 'summary memories' }, { value: 'timeline', label: 'timeline beats' },
  { value: 'threads', label: 'threads and arcs' }, { value: 'knowledge', label: 'private knowledge (recall only)' },
  { value: 'secrets', label: 'secrets (public only)' }, { value: 'journal', label: 'character memory (recall only)' }, { value: 'scars', label: 'scars (recall only)' },
];

export const vaultTab: Component<ChronicleState> = {
  // version must reflect entry CONTENT, not just counts — otherwise editing an
  // entry (or a reconcile updating a summary's body/keys) leaves the count
  // unchanged and the drawer's version-diff skips the repaint, so edits never
  // show. Hash each entry's mutable fields cheaply.
  version: () => (_snap ? `${vaultContentSig()}:${_snap.categories.length}:${_snap.activated.length}:${_filter}:${_scope}:${_sort}:${_book}:${_query}:${_snap.health?.score ?? ''}` : 'none'),
  render() {
    if (!_snap) { send({ type: 'vellum_get_vault' }); return '<div class="vle-empty sm">Loading vault\u2026</div>'; }
    if (!_snap.ok && _snap.reason === 'no_permission') return '<div class="vlm-comp-error">The Vault needs the <b>world_books</b> permission. Grant it in the extension settings to author lorebooks here.<br><span>Activation stays native; the Vault just organizes + auto-configures.</span></div>';
    // The list call itself failed (host error / permission hiccup) and returned no
    // books — distinct from an empty library. Say so instead of "no entries yet".
    if (_snap.listFailed && !_snap.books.length) return '<div class="vlm-comp-error">Couldn\u2019t load your lorebooks just now.<br><span>This is usually a temporary host or permission hiccup \u2014 try Refresh, or re-check the <b>world_books</b> permission.</span></div>';
    const cats = _snap.categories.filter((c) => !c.hidden);
    const all = allEntries();
    const vaultOwned = all.filter((e) => e.vellum && (!_snap!.chatId || e.ownerChatId === _snap!.chatId));
    // scope: 'vault' shows only VELLUM-managed entries (default, clean); 'all'
    // shows every native lorebook entry too (for adopting existing lore).
    const scoped = _scope === 'vault' ? vaultOwned : all;
    // lorebook filter: only the books that actually contribute scoped entries.
    const bookIds = Array.from(new Set(scoped.map((e) => e.bookId)));
    const bookCounts: Record<string, number> = {};
    for (const e of scoped) bookCounts[e.bookId] = (bookCounts[e.bookId] ?? 0) + 1;
    if (_book !== 'all' && !bookIds.includes(_book)) _book = 'all'; // stale filter guard
    const entries = _book === 'all' ? scoped : scoped.filter((e) => e.bookId === _book);
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.category || 'uncat'] = (counts[e.category || 'uncat'] ?? 0) + 1;
    const scopeBar = '<div class="vlv-scopebar">'
      + `<button class="vlv-scope${_scope === 'vault' ? ' on' : ''}" data-vscope="vault">\u2756 Vault <span class="vlv-cn">${vaultOwned.length}</span></button>`
      + `<button class="vlv-scope${_scope === 'all' ? ' on' : ''}" data-vscope="all">All lorebooks <span class="vlv-cn">${all.length}</span></button>`
      + '</div>';
    const bar = '<div class="vlv-catbar">'
      + `<button class="vlv-chip${_filter === 'all' ? ' on' : ''}" data-vcat="all">All <span class="vlv-cn">${entries.length}</span></button>`
      + cats.map((c) => `<span class="vlv-chipwrap" style="--c:${safeColor(c.color)}"><button class="vlv-chip${_filter === c.id ? ' on' : ''}" data-vcat="${esc(c.id)}"><span class="vlv-glyph">${esc(c.glyph)}</span>${esc(c.label)} <span class="vlv-cn">${counts[c.id] ?? 0}</span></button><button class="vlv-gear" data-vcat-settings="${esc(c.id)}" title="Category settings" aria-label="Settings for ${esc(c.label)}">\u2699</button></span>`).join('')
      + '<button class="vlv-chip add" data-vcat-add>+ Category</button>'
      + '</div>';
    // list ALL lorebooks attached to this chat (not just the first); fall back
    // to a vellum/first book when none is attached yet.
    const attached = _snap.books.filter((b) => b.attachedToChat);
    const names = (attached.length ? attached : [_snap.books.find((b) => b.vellum) || _snap.books[0]].filter(Boolean) as VBook[])
      .map((b) => esc(b.name) + (b.attachedToChat ? ' \u2713' : ''));
    const curLabel = attached.length > 1 ? 'Current lorebooks' : 'Current lorebook';
    const curBody = names.length ? names.join('<span class="vlv-current-sep"> \u00b7 </span>') : '\u2014 none (one will be created)';
    const cur = `<div class="vlv-current"><span class="vlv-current-l">${curLabel}</span><span class="vlv-current-n" data-vbook>${curBody}</span></div>`;
    const top = '<div class="vle-sec-top"><button class="vle-add" data-ventry-add>+ Entry</button><button class="vle-qol" data-vbook>\u2913 Books</button></div>' + cur;
    const needle = _query.trim().toLocaleLowerCase();
    const matches = (e: VEntry): boolean => !needle || [e.comment, e.content, e.category, e.link, ...e.key, ...(e.keysecondary ?? []), bookName(e.bookId)].join(' ').toLocaleLowerCase().includes(needle);
    const shown = sortEntries((_filter === 'all' ? entries : entries.filter((e) => e.category === _filter)).filter((e) => !e.pending && matches(e)));
    const active = new Set(_snap.activated.map((a) => a.id));
    const pending = scoped.filter((e) => e.pending);
    const sortBar = '<div class="vlv-tools"><label class="vlv-search"><span>Search</span><input data-vault-search value="' + esc(_query) + '" placeholder="names, facts, keys, links"></label><div class="vle-fbar">'
      + (['az', 'za', 'new', 'old'] as const).map((k) => `<button class="vle-fb-btn${_sort === k ? ' on' : ''}" data-vsort="${k}">${SORT_LABEL[k]}</button>`).join('')
      + '</div></div>';
    // lorebook filter — only worth showing when 2+ books contribute scoped entries
    const bookBar = bookIds.length > 1
      ? '<div class="vle-fbar vlv-bookbar"><button class="vle-fb-btn' + (_book === 'all' ? ' on' : '') + '" data-vbookfilter="all">all books <span class="vle-n">' + scoped.length + '</span></button>'
        + bookIds.map((id) => `<button class="vle-fb-btn${_book === id ? ' on' : ''}" data-vbookfilter="${esc(id)}">${esc(bookName(id))} <span class="vle-n">${bookCounts[id] ?? 0}</span></button>`).join('')
        + '</div>'
      : '';
    let grid: string;
    if (shown.length) {
      const { slice, page, pages } = paginate('vault', shown);
      grid = sortBar + bookBar + '<div class="vlv-grid">' + slice.map((e) => entryCard(e, active.has(e.id))).join('') + '</div>' + pagerHtml('vault', page, pages);
    } else {
      grid = sortBar + bookBar + '<div class="vle-empty sm">' + (_scope === 'vault' ? 'No Vault entries yet. <b>+ Entry</b> to author lore, or switch to <b>All lorebooks</b> to adopt existing entries.' : 'No entries here yet.') + '</div>';
    }
    return top + healthPanel() + pendingTray(pending) + suggestStrip() + scopeBar + bar + grid;
  },
  mount(host) {
    // guard: the shell mounts once, but rerender() must NOT re-bind — stacked
    // listeners double-fire and clicks land on replaced nodes (buttons "don't
    // work"). Bind exactly one delegated handler per host element.
    if ((host as any)._vaultBound) return;
    (host as any)._vaultBound = true;
    host.addEventListener('input', (e) => {
      const input = (e.target as HTMLElement).closest('[data-vault-search]') as HTMLInputElement | null;
      if (!input) return;
      _query = input.value; setPage('vault', 0); rerender(host);
      const next = host.querySelector('[data-vault-search]') as HTMLInputElement | null;
      if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
    });
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sc = t.closest('[data-vscope]');
      if (sc) { _scope = sc.getAttribute('data-vscope') as 'vault' | 'all'; _filter = 'all'; setPage('vault', 0); rerender(host); return; }
      const so = t.closest('[data-vsort]');
      if (so) { _sort = so.getAttribute('data-vsort') as typeof _sort; setPage('vault', 0); rerender(host); return; }
      const bf = t.closest('[data-vbookfilter]');
      if (bf) { _book = bf.getAttribute('data-vbookfilter')!; setPage('vault', 0); rerender(host); return; }
      const chip = t.closest('[data-vcat]');
      if (chip && !t.closest('[data-vcat-settings]')) { _filter = chip.getAttribute('data-vcat')!; setPage('vault', 0); rerender(host); return; }
      const gear = t.closest('[data-vcat-settings]'); if (gear) { categorySettings(gear.getAttribute('data-vcat-settings')!); return; }
      if (t.closest('[data-vcat-add]')) { categoryCreate(); return; }
      if (t.closest('[data-ventry-add]')) { entryForm(null); return; }
      if (t.closest('[data-vbook]')) { bookManager(); return; }
      const ed = t.closest('[data-ventry-edit]'); if (ed) { entryForm(findEntry(ed.getAttribute('data-id')!)); return; }
      const del = t.closest('[data-ventry-del]'); if (del) confirmModal('Delete this entry?', () => send({ type: 'vellum_vault_op', op: 'entry_delete', entryId: del.getAttribute('data-id') }));
      const un = t.closest('[data-ventry-unlink]'); if (un) send({ type: 'vellum_vault_op', op: 'entry_unlink', entryId: un.getAttribute('data-id'), category: un.getAttribute('data-cat') });
      const sy = t.closest('[data-vsug-accept]'); if (sy) send({ type: 'vellum_vault_suggest', action: 'accept', kind: sy.getAttribute('data-kind'), id: sy.getAttribute('data-id') });
      const sn = t.closest('[data-vsug-dismiss]'); if (sn) send({ type: 'vellum_vault_suggest', action: 'dismiss', kind: sn.getAttribute('data-kind'), id: sn.getAttribute('data-id') });
      const py = t.closest('[data-vpend-accept]'); if (py) send({ type: 'vellum_vault_pending', action: 'accept', entryId: py.getAttribute('data-id'), category: py.getAttribute('data-cat'), link: py.getAttribute('data-link') });
      const pn = t.closest('[data-vpend-reject]'); if (pn) send({ type: 'vellum_vault_pending', action: 'reject', entryId: pn.getAttribute('data-id') });
    });
  },
};

function allEntries(): VEntry[] { return (_snap?.books ?? []).flatMap((b) => b.entries.map((e) => ({ ...e, bookId: b.id }))); }

/** A cheap signature of every entry's MUTABLE fields (id + key + comment +
 * content length/head + disabled + category + pending). Changes whenever an
 * entry is edited/added/removed, so the version-diff repaints. djb2 over the
 * concatenation keeps it short regardless of entry count. */
function vaultContentSig(): string {
  let h = 5381;
  const acc = (str: string): void => { for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; };
  for (const e of allEntries()) {
    acc(e.id); acc('\u0001'); acc(e.key.join(',')); acc('\u0001'); acc((e.keysecondary ?? []).join(',')); acc('\u0001'); acc(e.comment || ''); acc('\u0001');
    acc(String(e.content.length)); acc(e.content.slice(0, 64)); acc('\u0001');
    acc(e.category || ''); acc(e.disabled ? '1' : '0'); acc(e.pending ? 'p' : ''); acc(e.source || '');
    acc('\u0002');
  }
  return (h >>> 0).toString(36);
}

const SORT_LABEL: Record<'az' | 'za' | 'new' | 'old', string> = { az: 'A\u2013Z', za: 'Z\u2013A', new: '\u2193 newest', old: '\u2191 oldest' };
// Entries carry no timestamp, so newest/oldest use snapshot (insertion) order as
// the proxy — newest = last in the book arrays. A-Z/Z-A sort by title then keys.
// ponytail: real recency needs a created/updated turn on VEntry; add when entries gain one.
function sortEntries(list: VEntry[]): VEntry[] {
  const label = (e: VEntry): string => (e.comment || e.key[0] || '').toLowerCase();
  if (_sort === 'new') return list.slice().reverse();
  if (_sort === 'old') return list.slice();
  const dir = _sort === 'za' ? -1 : 1;
  return list.slice().sort((a, b) => dir * label(a).localeCompare(label(b)));
}

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

function healthPanel(): string {
  const h = _snap?.health; if (!h) return '';
  const severity = h.issues.some((x) => x.severity === 'error') ? 'error' : h.issues.some((x) => x.severity === 'warning') ? 'warning' : 'ok';
  const details = h.issues.slice(0, 8).map((x) => `<li class="${esc(x.severity)}"><span>${esc(x.code.replace(/_/g, ' '))}</span>${esc(x.message)}</li>`).join('');
  return `<details class="vlv-health ${severity}"${h.issues.length ? '' : ' open'}><summary><span class="vlv-health-score">${h.score}</span><b>Vault health</b><span>${h.stats.entries} owned entries \u00b7 ${h.stats.conflicts} conflicts \u00b7 ${h.stats.orphaned} orphaned</span><em>${h.issues.length ? `${h.issues.length} issue${h.issues.length === 1 ? '' : 's'}` : 'healthy'}</em></summary>${details ? `<ul>${details}</ul>` : '<p>Ownership, canonical links, hashes, activation keys, and privacy boundaries are healthy.</p>'}</details>`;
}

function entryCard(e: VEntry, firing: boolean): string {
  const cat = _snap?.categories.find((c) => c.id === e.category);
  const clr = safeColor(cat?.color);
  const keys = e.key.join(', ');
  const integrity = e.bodyState === 'conflict' ? '<span class="vlv-integrity conflict">conflict</span>' : e.bodyState === 'override' ? '<span class="vlv-integrity override">user override</span>' : '';
  return `<div class="vlv-entry${e.disabled ? ' off' : ''}${e.bodyState === 'conflict' ? ' conflict' : ''}" style="--c:${clr}">`
    + `<div class="vlv-entry-top"><span class="vlv-entry-cat">${esc(cat?.glyph ?? '\u2727')} ${esc(cat?.label ?? 'Uncategorized')}</span>`
    + (e.bookId ? `<span class="vlv-entry-book" title="Lorebook">\uD83D\uDCD5 ${esc(bookName(e.bookId))}</span>` : '')
    + (firing ? '<span class="vlv-firing">\u25C9 firing</span>' : '')
    + integrity
    + `<span class="vlv-entry-ctl"><button class="vle-mini" data-ventry-edit data-id="${esc(e.id)}">\u270E</button><button class="vle-mini del" data-ventry-del data-id="${esc(e.id)}">\u2715</button></span></div>`
    + (e.comment ? `<div class="vlv-title">${esc(e.comment)}</div>` : '')
    + `<div class="vlv-keys">${keys ? esc(keys) : e.constant ? '<em>always on</em>' : '<em>no activation keywords</em>'}</div>`
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
    { key: 'content', label: 'Content', type: 'textarea', value: e?.content ?? '', big: true },
  ], (v) => {
    if (!v.content?.trim()) return;
    const payload = { category: v.category, key: v.key, content: v.content, comment: v.title };
    if (e) send({ type: 'vellum_vault_op', op: 'entry_update', entryId: e.id, ...payload });
    else send({ type: 'vellum_vault_op', op: 'entry_create', bookId: v.bookId || '', ...payload });
  }, { large: true });
}

function categorySettings(id: string): void {
  const c = _snap?.categories.find((x) => x.id === id); if (!c) return;
  const d = c.defaults ?? {};
  formModal(`${c.label} — auto-settings`, [
    { key: 'position', label: 'Position', type: 'select', value: d.position ?? 'at_depth', options: POS_OPTS },
    { key: 'depth', label: 'Depth (if at-depth)', type: 'number', value: String(d.depth ?? 4), min: 0, max: 100 },
    { key: 'role', label: 'Role', type: 'select', value: d.role ?? 'system', options: ROLE_OPTS },
    { key: 'order', label: 'Order', type: 'number', value: String(d.order ?? 100) },
    { key: 'constant', label: 'Activation', type: 'select', value: d.constant ? 'constant' : 'keyed', options: [{ value: 'keyed', label: 'keyword activated' }, { value: 'constant', label: 'always active' }] },
    { key: 'priority', label: 'Priority', type: 'number', value: String(d.priority ?? 0), min: 0, adv: true },
    { key: 'sticky', label: 'Sticky (turns)', type: 'number', value: String(d.sticky ?? 0), min: 0, adv: true },
    { key: 'cooldown', label: 'Cooldown (turns)', type: 'number', value: String(d.cooldown ?? 0), min: 0, adv: true },
    { key: 'delay', label: 'Delay (turns)', type: 'number', value: String(d.delay ?? 0), min: 0, adv: true },
    { key: 'source', label: 'Canonical source', type: 'select', value: c.source ?? '', options: SOURCE_OPTS },
    { key: 'sync', label: 'Auto-update', type: 'select', value: c.sync ?? 'off', options: [{ value: 'off', label: 'off' }, { value: 'promote', label: 'promote (manual)' }, { value: 'sync', label: 'sync (auto-update)' }, { value: 'auto', label: 'auto-author (drafts)' }] },
  ], (v) => {
    const defaults = { position: v.position, depth: Number(v.depth) || 4, role: v.role, order: Number(v.order) || 100, constant: v.constant === 'constant', priority: Math.max(0, Number(v.priority) || 0), sticky: Math.max(0, Number(v.sticky) || 0), cooldown: Math.max(0, Number(v.cooldown) || 0), delay: Math.max(0, Number(v.delay) || 0) };
    send({ type: 'vellum_vault_category', cat: { ...c, defaults, sync: v.sync, source: v.source || undefined } });
  });
}

function categoryCreate(): void {
  formModal('New Category', [
    { key: 'label', label: 'Name', type: 'text', placeholder: 'Vehicles' },
    { key: 'glyph', label: 'Glyph', type: 'text', value: '\u2727' },
    { key: 'color', label: 'Color (hex)', type: 'text', value: '#cdbfa0' },
    { key: 'source', label: 'Canonical source', type: 'select', value: '', options: SOURCE_OPTS },
    { key: 'position', label: 'Default position', type: 'select', value: 'at_depth', options: POS_OPTS },
    { key: 'order', label: 'Default order', type: 'text', value: '100' },
  ], (v) => { if (v.label?.trim()) send({ type: 'vellum_vault_category', cat: { label: v.label, glyph: v.glyph || '\u2727', color: safeColor(v.color, '#cdbfa0'), source: v.source || undefined, defaults: { position: v.position, depth: 4, role: 'system', order: Number(v.order) || 100 } } }); });
}

function bookManager(): void {
  const books = _snap?.books ?? [];
  const chatId = _snap?.chatId ?? '';
  const fullyOwned = (b: VBook): boolean => b.vellum && b.ownerChatId === chatId && b.entries.every((e) => e.vellum && e.ownerChatId === chatId && (e.schemaVersion ?? 0) >= 2);
  const claimable = books.filter((b) => b.attachedToChat && (!b.ownerChatId || b.ownerChatId === chatId) && !b.entries.some((e) => !!e.ownerChatId && e.ownerChatId !== chatId) && !fullyOwned(b));
  // a lightweight books overlay: each book has rename + attach toggle + new
  const ov = document.createElement('div');
  ov.className = 'vlfm-overlay';
  const rows = books.map((b) => {
    const owned = !!chatId && b.vellum && b.ownerChatId === chatId;
    const foreign = (!!b.ownerChatId && b.ownerChatId !== chatId) || b.entries.some((e) => !!e.ownerChatId && e.ownerChatId !== chatId);
    const canClaim = !!chatId && b.attachedToChat && !foreign && !fullyOwned(b);
    return `<div class="vlv-bk" data-bk="${esc(b.id)}"><span class="vlv-bk-n">${esc(b.name)}</span>`
    + `${owned ? '<span class="vlv-bk-tag vault">Vault</span>' : foreign ? '<span class="vlv-bk-tag protected" title="Owned by another chat">other chat</span>' : ''}`
    + `${b.global ? '<span class="vlv-bk-tag">global</span>' : ''}`
    + `<span class="vlv-bk-ctl"><button class="vle-mini" data-bk-rename data-id="${esc(b.id)}" data-name="${esc(b.name)}" title="Rename">\u270E</button>`
    + (canClaim ? `<button class="vlv-bk-claim" data-bk-claim data-id="${esc(b.id)}" title="Add this lorebook and its existing entries to this chat's Vault">${owned ? 'Repair Vault' : '+ Vault'}</button>` : '')
    + `<button class="vlv-bk-att${b.attachedToChat ? ' on' : ''}" data-bk-attach data-id="${esc(b.id)}" data-attach="${b.attachedToChat ? '' : '1'}">${b.attachedToChat ? '\u2713 attached' : '+ attach'}</button></span></div>`
  }).join('') || '<div class="vle-empty sm">No lorebooks yet.</div>';
  const claimAll = claimable.length
    ? `<div class="vlv-adopt"><div><b>Add this chat's lorebooks to Vault</b><span>Claims ${claimable.length} attached lorebook${claimable.length === 1 ? '' : 's'} and preserves every entry and activation setting.</span></div><button class="vlfm-btn vlfm-save" data-bk-claim-all>Use attached</button></div>`
    : '';
  ov.innerHTML = '<div class="vlfm"><div class="vlfm-head"><span class="vlfm-mark">\u2756</span>Lorebooks</div>'
    + `<div class="vlfm-body">${claimAll}<div class="vlv-bklist">${rows}</div>`
    + '<label class="vlfm-l">New lorebook<input class="vlfm-in" data-bk-new placeholder="My World"></label></div>'
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-close>Close</button><button class="vlfm-btn vlfm-save" data-bk-create>+ Create</button></div></div>';
  document.body.appendChild(ov);
  const close = (): void => { try { ov.remove(); } catch { /* ignore */ } };
  ov.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === ov || t.closest('[data-close]')) { close(); return; }
    const rn = t.closest('[data-bk-rename]');
    if (rn) { close(); formModal('Rename Lorebook', [{ key: 'name', label: 'Name', type: 'text', value: rn.getAttribute('data-name') ?? '' }], (v) => { if (v.name?.trim()) send({ type: 'vellum_vault_op', op: 'book_update', bookId: rn.getAttribute('data-id'), name: v.name }); }); return; }
    const claim = t.closest('[data-bk-claim]'); if (claim) { send({ type: 'vellum_vault_op', op: 'book_claim', bookId: claim.getAttribute('data-id') }); close(); return; }
    if (t.closest('[data-bk-claim-all]')) { send({ type: 'vellum_vault_op', op: 'books_claim_attached' }); close(); return; }
    const at = t.closest('[data-bk-attach]'); if (at) { send({ type: 'vellum_vault_op', op: 'book_attach', bookId: at.getAttribute('data-id'), attach: !!at.getAttribute('data-attach') }); close(); return; }
    if (t.closest('[data-bk-create]')) { const inp = ov.querySelector('[data-bk-new]') as HTMLInputElement | null; const name = inp?.value?.trim(); if (name) send({ type: 'vellum_vault_op', op: 'book_create', name, attach: true }); close(); }
  });
}
