import type { ChronicleState } from '../domain/types.js';

/**
 * UI → backend bridge. Set once by app.ts; tab components call send() to issue
 * CRUD commands and request actions without threading ctx through every render.
 * Also tracks pagination offsets per list, so a re-render preserves the page.
 */

type Sender = (payload: Record<string, unknown>) => void;
let _send: Sender = () => { /* not wired yet */ };
let _refresh: (force?: boolean) => void = () => { /* set by shell */ };

export function wireBridge(send: Sender, refresh: (force?: boolean) => void): void { _send = send; _refresh = refresh; }
export function send(payload: Record<string, unknown>): void { _send(payload); }
export function cmd(cmdName: string, entry: Record<string, unknown>): void { _send({ type: 'vellum_cmd', cmd: cmdName, entry }); }
/** Force a re-render of the active tab (bypasses the version gate). UI-only
 * state (filters, pagination, open-book) changes nothing the version key sees,
 * so a normal update() would skip — these must force. */
export function refreshUI(): void { _refresh(true); }

// --- pagination state (per list id) -------------------------------------
const _page = new Map<string, number>();
export function pageOf(listId: string): number { return _page.get(listId) ?? 0; }
export function setPage(listId: string, p: number): void { _page.set(listId, Math.max(0, p)); _refresh(true); }
export const PAGE_SIZE = 12;

/** Slice a list to the current page; returns the slice + paging metadata. */
export function paginate<T>(listId: string, items: T[], size = PAGE_SIZE): { slice: T[]; page: number; pages: number; total: number } {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pageOf(listId), pages - 1);
  return { slice: items.slice(page * size, page * size + size), page, pages, total };
}

/** Render a compact pager control (prev / page / next) for a list. */
export function pagerHtml(listId: string, page: number, pages: number): string {
  if (pages <= 1) return '';
  return `<div class="vle-pager" data-pager="${listId}">`
    + `<button class="vle-pg" data-pg-prev${page <= 0 ? ' disabled' : ''}>\u2039</button>`
    + `<span class="vle-pg-n">${page + 1} / ${pages}</span>`
    + `<button class="vle-pg" data-pg-next${page >= pages - 1 ? ' disabled' : ''}>\u203a</button></div>`;
}

/** Wire pager clicks for a container (delegated). Call once per mounted shell. */
export function wirePagers(host: HTMLElement): void {
  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const pager = t.closest('[data-pager]'); if (!pager) return;
    const id = pager.getAttribute('data-pager')!;
    if (t.closest('[data-pg-prev]')) setPage(id, pageOf(id) - 1);
    else if (t.closest('[data-pg-next]')) setPage(id, pageOf(id) + 1);
  });
}

export type { ChronicleState };

// --- filter state (per list id) -----------------------------------------
export interface FilterState { sort: 'desc' | 'asc'; cat: string; who: string }
const _filter = new Map<string, FilterState>();
export function filterOf(listId: string): FilterState { return _filter.get(listId) ?? { sort: 'desc', cat: 'all', who: 'all' }; }
export function setFilter(listId: string, patch: Partial<FilterState>): void { _filter.set(listId, { ...filterOf(listId), ...patch }); setPage(listId, 0); }

/** Render a filter bar: sort toggle + optional category + per-character selects.
 * `counts`/`whoCounts` (keyed by option value) append an amount to each label,
 * with the grand total shown on the "all" option. */
export function filterBar(listId: string, opts: { cats?: string[]; whos?: Array<{ id: string; name: string }>; counts?: Record<string, number>; whoCounts?: Record<string, number> }): string {
  const f = filterOf(listId);
  const sort = `<button class="vle-fb-btn" data-filter-sort="${listId}" title="Sort by date">${f.sort === 'desc' ? '\u2193 newest' : '\u2191 oldest'}</button>`;
  const n = (v: number | undefined): string => (v === undefined ? '' : ` (${v})`);
  const catTotal = opts.counts ? Object.values(opts.counts).reduce((a, b) => a + b, 0) : undefined;
  const cat = opts.cats?.length
    ? `<select class="vle-fb-sel" data-filter-cat="${listId}"><option value="all">all kinds${n(catTotal)}</option>${opts.cats.map((c) => `<option value="${esc(c)}"${f.cat === c ? ' selected' : ''}>${esc(c)}${n(opts.counts?.[c])}</option>`).join('')}</select>`
    : '';
  const whoTotal = opts.whoCounts ? Object.values(opts.whoCounts).reduce((a, b) => a + b, 0) : undefined;
  const who = opts.whos?.length
    ? `<select class="vle-fb-sel" data-filter-who="${listId}"><option value="all">everyone${n(whoTotal)}</option>${opts.whos.map((w) => `<option value="${esc(w.id)}"${f.who === w.id ? ' selected' : ''}>${esc(w.name)}${n(opts.whoCounts?.[w.id])}</option>`).join('')}</select>`
    : '';
  return `<div class="vle-fbar" data-fbar="${listId}">${sort}${cat}${who}</div>`;
}

/** Apply sort + category + who filters to a dated list. */
export function applyFilter<T extends { turn?: number; day?: number }>(
  listId: string, items: T[], get?: { cat?: (x: T) => string; who?: (x: T) => string },
): T[] {
  const f = filterOf(listId);
  let out = items.slice();
  if (f.cat !== 'all' && get?.cat) out = out.filter((x) => get.cat!(x) === f.cat);
  if (f.who !== 'all' && get?.who) out = out.filter((x) => get.who!(x) === f.who);
  out.sort((a, b) => { const av = (a.turn ?? a.day ?? 0), bv = (b.turn ?? b.day ?? 0); return f.sort === 'desc' ? bv - av : av - bv; });
  return out;
}

/** Wire filter-bar controls (delegated). Call once per mounted shell. */
export function wireFilters(host: HTMLElement): void {
  host.addEventListener('click', (e) => {
    const s = (e.target as HTMLElement).closest('[data-filter-sort]');
    if (s) { const id = s.getAttribute('data-filter-sort')!; setFilter(id, { sort: filterOf(id).sort === 'desc' ? 'asc' : 'desc' }); }
  });
  host.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    const c = t.closest('[data-filter-cat]'); if (c) setFilter(c.getAttribute('data-filter-cat')!, { cat: (c as HTMLSelectElement).value });
    const w = t.closest('[data-filter-who]'); if (w) setFilter(w.getAttribute('data-filter-who')!, { who: (w as HTMLSelectElement).value });
  });
}

function esc(s: unknown): string { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
