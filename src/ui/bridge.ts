import type { ChronicleState } from '../domain/types.js';

/**
 * UI → backend bridge. Set once by app.ts; tab components call send() to issue
 * CRUD commands and request actions without threading ctx through every render.
 * Also tracks pagination offsets per list, so a re-render preserves the page.
 */

type Sender = (payload: Record<string, unknown>) => void;
let _send: Sender = () => { /* not wired yet */ };
let _refresh: () => void = () => { /* set by shell */ };

export function wireBridge(send: Sender, refresh: () => void): void { _send = send; _refresh = refresh; }
export function send(payload: Record<string, unknown>): void { _send(payload); }
export function cmd(cmdName: string, entry: Record<string, unknown>): void { _send({ type: 'vellum_cmd', cmd: cmdName, entry }); }
export function refreshUI(): void { _refresh(); }

// --- pagination state (per list id) -------------------------------------
const _page = new Map<string, number>();
export function pageOf(listId: string): number { return _page.get(listId) ?? 0; }
export function setPage(listId: string, p: number): void { _page.set(listId, Math.max(0, p)); _refresh(); }
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
