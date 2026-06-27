import type { Component } from '../component.js';
import type { ChronicleState, JournalEntry } from '../../domain/types.js';
import { esc, nameOf } from '../format.js';
import { cmd, paginate, pagerHtml, filterBar, applyFilter, refreshUI } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';

/**
 * Journal tab — each character's MEMORY JOURNAL: the moments they personally
 * carry, categorized (kind/weight/sentiment). Filterable by sort, kind, and
 * per-character; add/edit/delete; paginated.
 */

const KIND_OPTS = [
  { value: 'interaction', label: 'interaction' }, { value: 'promise', label: 'promise' },
  { value: 'betrayal', label: 'betrayal' }, { value: 'gift', label: 'gift' },
  { value: 'shared', label: 'shared' }, { value: 'wound', label: 'wound' }, { value: 'observation', label: 'observation' },
];
const WEIGHT_OPTS = [{ value: 'trivial', label: 'trivial' }, { value: 'minor', label: 'minor' }, { value: 'significant', label: 'significant' }, { value: 'defining', label: 'defining' }];
const SENT_OPTS = [{ value: 'positive', label: 'positive' }, { value: 'negative', label: 'negative' }, { value: 'neutral', label: 'neutral' }, { value: 'complex', label: 'complex' }];

const KIND_GLYPH: Record<string, string> = {
  interaction: '\u2194', promise: '\u270B', betrayal: '\u2020', gift: '\u2728',
  shared: '\u269C', wound: '\u2620', observation: '\u25C9',
};
const SENT_CLR: Record<string, string> = { positive: '#8fa67e', negative: '#c96a6a', neutral: '#8c8478', complex: '#b48ed0' };

// "book" view: when set, show one character's full journal on its own page
let _openBook: string | null = null;

export const journalTab: Component<ChronicleState> = {
  version: (s) => s.journal.length + ':' + Object.keys(s.cast).length + ':' + (_openBook ?? ''),
  render(s) {
    if (_openBook) return bookView(s, _openBook);
    const header = '<div class="vle-sec-top"><button class="vle-add" data-jr-add>+ Memory</button></div>';
    if (!s.journal.length) return header + '<div class="vle-empty sm">No journal entries yet. Characters remember moments as the story unfolds.</div>';
    const whos = Array.from(new Set(s.journal.map((j) => j.who))).map((id) => ({ id, name: nameOf(s, id) }));
    // a "shelf" of per-character books to open
    const shelf = '<div class="vle-shelf">' + whos.map((w) => {
      const n = s.journal.filter((j) => j.who === w.id).length;
      return `<button class="vle-book" data-jr-book="${esc(w.id)}">${esc(w.name)} <span class="vle-book-n">${n}</span></button>`;
    }).join('') + '</div>';
    const bar = filterBar('journal', { cats: KIND_OPTS.map((k) => k.value), whos });
    const filtered = applyFilter('journal', s.journal, { cat: (j) => j.kind, who: (j) => j.who });
    if (!filtered.length) return header + shelf + bar + '<div class="vle-empty sm">No entries match the filter.</div>';
    const { slice, page, pages } = paginate('journal', filtered);
    return header + shelf + bar + '<div class="vle-jr-grid">' + slice.map((j) => card(s, j)).join('') + '</div>' + pagerHtml('journal', page, pages);
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const book = t.closest('[data-jr-book]');
      if (book) { _openBook = book.getAttribute('data-jr-book'); refreshUI(); return; }
      if (t.closest('[data-jr-close]')) { _openBook = null; refreshUI(); return; }
      if (t.closest('[data-jr-add]')) { jrForm('New Memory', {}); return; }
      const ed = t.closest('[data-jr-edit]');
      if (ed) {
        jrForm('Edit Memory', {
          id: ed.getAttribute('data-id') ?? '', who: ed.getAttribute('data-who') ?? '', about: ed.getAttribute('data-about') ?? '',
          memory: ed.getAttribute('data-mem') ?? '', kind: ed.getAttribute('data-kind') ?? 'interaction',
          weight: ed.getAttribute('data-weight') ?? 'minor', sentiment: ed.getAttribute('data-sent') ?? 'neutral',
        });
        return;
      }
      const del = t.closest('[data-jr-del]');
      if (del) confirmModal('Delete this memory?', () => cmd('journal_delete', { id: del.getAttribute('data-id') }));
    });
  },
};

/** One character's full journal as its own page. */
function bookView(s: ChronicleState, who: string): string {
  const entries = s.journal.filter((j) => j.who === who);
  const bar = filterBar('journal-book', { cats: KIND_OPTS.map((k) => k.value) });
  const filtered = applyFilter('journal-book', entries, { cat: (j) => j.kind });
  const head = `<div class="vle-book-head"><button class="vle-mini" data-jr-close title="Back">\u2039</button>`
    + `<span class="vle-book-title">${esc(nameOf(s, who))}\u2019s Journal</span>`
    + `<span class="vle-n">${entries.length}</span></div>`;
  const body = filtered.length ? '<div class="vle-jr-grid">' + filtered.map((j) => card(s, j)).join('') + '</div>' : '<div class="vle-empty sm">No entries match.</div>';
  return head + bar + body;
}

function jrForm(title: string, v: Record<string, string>): void {
  formModal(title, [
    { key: 'who', label: 'Held by (character)', type: 'text', value: v.who, placeholder: 'Cersei' },
    { key: 'about', label: 'About (optional)', type: 'text', value: v.about },
    { key: 'memory', label: 'The memory', type: 'textarea', value: v.memory },
    { key: 'kind', label: 'Kind', type: 'select', value: v.kind ?? 'interaction', options: KIND_OPTS },
    { key: 'weight', label: 'Weight', type: 'select', value: v.weight ?? 'minor', options: WEIGHT_OPTS },
    { key: 'sentiment', label: 'Sentiment', type: 'select', value: v.sentiment ?? 'neutral', options: SENT_OPTS },
  ], (out) => {
    if (!out.who?.trim() || !out.memory?.trim()) return;
    if (v.id) cmd('journal_edit', { id: v.id, ...out }); // Fix 14: edit in place, keep identity
    else cmd('journal_add', out);
  });
}

function card(s: ChronicleState, j: JournalEntry): string {
  const A = (x: unknown): string => esc(x);
  const clr = SENT_CLR[j.sentiment] ?? '#8c8478';
  const about = j.about ? ' \u2192 ' + esc(nameOf(s, j.about)) : '';
  return `<div class="vle-jr" style="--c:${clr}">`
    + `<div class="vle-jr-top"><span class="vle-jr-glyph">${KIND_GLYPH[j.kind] ?? '\u25C9'}</span>`
    + `<span class="vle-jr-who">${esc(nameOf(s, j.who))}${about}</span>`
    + `<span class="vle-jr-ctl"><button class="vle-mini" data-jr-edit data-id="${A(j.id)}" data-who="${A(nameOf(s, j.who))}" data-about="${A(j.about ? nameOf(s, j.about) : '')}" data-mem="${A(j.memory)}" data-kind="${A(j.kind)}" data-weight="${A(j.weight)}" data-sent="${A(j.sentiment)}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-jr-del data-id="${A(j.id)}" title="Delete">\u2715</button></span></div>`
    + `<div class="vle-jr-mem">${esc(j.memory)}</div>`
    + `<div class="vle-jr-tags"><span class="vle-jr-tag">${esc(j.kind)}</span><span class="vle-jr-tag w-${j.weight}">${esc(j.weight)}</span><span class="vle-jr-tag" style="color:${clr}">${esc(j.sentiment)}</span>${j.day ? `<span class="vle-jr-day">day ${j.day}</span>` : ''}</div>`
    + '</div>';
}
