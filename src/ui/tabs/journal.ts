import type { Component } from '../component.js';
import type { ChronicleState, JournalEntry } from '../../domain/types.js';
import { esc, nameOf, emptyState, sectionHeader, nameHtml, initials } from '../format.js';
import { cmd, paginate, pagerHtml, filterBar, applyFilter, refreshUI } from '../bridge.js';
import { formModal, confirmModal } from '../modal.js';
import { formatDate } from '../../domain/date-format.js';

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
// sentiment → semantic-token class (skin-aware; no hardcoded hex reaches the DOM)
const SENT_CLS: Record<string, string> = { positive: 'pos', negative: 'neg', neutral: 'neu', complex: 'cx' };

// "book" view: when set, show one character's full journal on its own page
let _openBook: string | null = null;

/** Tally journal entries by a key extractor → {value: count} for filter labels. */
function jCounts(s: ChronicleState, key: (j: ChronicleState['journal'][number]) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of s.journal) { const k = key(j); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** The most common sentiment across a set of entries → SENT_CLS class. */
function dominantSentiment(entries: JournalEntry[]): string {
  const tally: Record<string, number> = {};
  for (const e of entries) tally[e.sentiment] = (tally[e.sentiment] ?? 0) + 1;
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';
  return SENT_CLS[top] ?? 'neu';
}

export const journalTab: Component<ChronicleState> = {
  version: (s) => s.journal.length + ':' + Object.keys(s.cast).length + ':' + (_openBook ?? ''),
  render(s) {
    if (_openBook) return bookView(s, _openBook);
    const header = sectionHeader('', { action: '<button class="vle-add" data-jr-add>+ Memory</button>' });
    if (!s.journal.length) return header + emptyState('No journal entries yet.', 'Characters remember moments as the story unfolds.');
    const whos = Array.from(new Set(s.journal.map((j) => j.who))).map((id) => ({ id, name: nameOf(s, id) }));
    // a "shelf" of per-character books: spine height ∝ entry count, the foot band
    // = dominant sentiment, a portrait medallion on the spine (mockup 11A).
    const maxN = Math.max(1, ...whos.map((w) => s.journal.filter((j) => j.who === w.id).length));
    const spines = whos.map((w) => {
      const entries = s.journal.filter((j) => j.who === w.id);
      const h = Math.round(150 + 60 * (entries.length / maxN)); // 150–210px
      const sc = dominantSentiment(entries);
      const img = s.cast[w.id]?.imageUrl;
      const av = img
        ? `<span class="vle-jspine-av has-img" style="background-image:url(${esc(JSON.stringify(img))})"></span>`
        : `<span class="vle-jspine-av">${esc(initials(w.name))}</span>`;
      return `<button class="vle-jspine vle-jspine--${sc}" data-jr-book="${esc(w.id)}" style="height:${h}px" title="${esc(w.name)} \u00b7 ${entries.length}">`
        + av
        + `<span class="vle-jspine-name">${esc(w.name)}</span>`
        + `<span class="vle-jspine-n">${entries.length}</span></button>`;
    }).join('');
    const shelf = `<div class="vle-shelf-wrap"><div class="vle-shelf">${spines}</div><div class="vle-shelf-plank"></div></div>`;
    const bar = filterBar('journal', { cats: KIND_OPTS.map((k) => k.value), whos, counts: jCounts(s, (j) => j.kind), whoCounts: jCounts(s, (j) => j.who) });
    const filtered = applyFilter('journal', s.journal, { cat: (j) => j.kind, who: (j) => j.who });
    if (!filtered.length) return header + shelf + bar + emptyState('No entries match the filter.');
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

/** One character's journal as an open two-page diary (mockup 11B): entries are
 * dated handwritten leaves, sentiment-colored ink, split L/R by recency. */
function bookView(s: ChronicleState, who: string): string {
  const entries = s.journal.filter((j) => j.who === who);
  const bar = filterBar('journal-book', { cats: KIND_OPTS.map((k) => k.value) });
  const filtered = applyFilter('journal-book', entries, { cat: (j) => j.kind })
    .slice().sort((a, b) => (b.day ?? 0) - (a.day ?? 0) || b.turn - a.turn);
  const head = `<div class="vle-diary-head"><button class="vle-mini" data-jr-close title="Back">\u2039</button>`
    + `<span class="vle-diary-av">${esc(initials(nameOf(s, who)))}</span>`
    + `<span class="vle-book-title">${nameHtml(s, who)}\u2019s Journal</span>`
    + `<span class="vle-n">${entries.length}</span></div>`;
  if (!filtered.length) return head + bar + emptyState('No entries match.');
  // split into two facing pages (left = more recent, right = older)
  const half = Math.ceil(filtered.length / 2);
  const left = filtered.slice(0, half).map((j) => leaf(s, j)).join('');
  const right = filtered.slice(half).map((j) => leaf(s, j)).join('');
  const body = `<div class="vle-diary"><div class="vle-diary-page">${left}</div>`
    + `<div class="vle-diary-page">${right}<button class="vle-diary-add" data-jr-add>+ add a memory\u2026</button></div></div>`;
  return head + bar + body;
}

/** One diary leaf: a dated, kind-tagged, sentiment-inked handwritten entry. */
function leaf(s: ChronicleState, j: JournalEntry): string {
  const sc = SENT_CLS[j.sentiment] ?? 'neu';
  const A = (x: unknown): string => esc(x);
  const about = j.about ? ' \u2192 ' + nameOf(s, j.about) : '';
  const anchor = (j.day ? formatDate(j.day, s.dateFormat || 'day', s) + ' \u00b7 ' : '') + (KIND_GLYPH[j.kind] ?? '\u25C9') + ' ' + j.kind + ' \u00b7 ' + j.weight;
  return `<div class="vle-leaf vle-leaf--${sc}">`
    + `<div class="vle-leaf-meta">${esc(anchor)}${esc(about)}`
    + `<span class="vle-leaf-ctl"><button class="vle-mini" data-jr-edit data-id="${A(j.id)}" data-who="${A(nameOf(s, j.who))}" data-about="${A(j.about ? nameOf(s, j.about) : '')}" data-mem="${A(j.memory)}" data-kind="${A(j.kind)}" data-weight="${A(j.weight)}" data-sent="${A(j.sentiment)}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-jr-del data-id="${A(j.id)}" title="Delete">\u2715</button></span></div>`
    + `<div class="vle-leaf-mem">\u201C${esc(j.memory)}\u201D</div></div>`;
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
  const sc = SENT_CLS[j.sentiment] ?? 'neu';
  const about = j.about ? ' \u2192 ' + nameHtml(s, j.about) : '';
  return `<div class="vle-jr vle-jr--${sc}">`
    + `<div class="vle-jr-top"><span class="vle-jr-glyph">${KIND_GLYPH[j.kind] ?? '\u25C9'}</span>`
    + `<span class="vle-jr-who">${nameHtml(s, j.who)}${about}</span>`
    + `<span class="vle-jr-ctl"><button class="vle-mini" data-jr-edit data-id="${A(j.id)}" data-who="${A(nameOf(s, j.who))}" data-about="${A(j.about ? nameOf(s, j.about) : '')}" data-mem="${A(j.memory)}" data-kind="${A(j.kind)}" data-weight="${A(j.weight)}" data-sent="${A(j.sentiment)}" title="Edit">\u270E</button>`
    + `<button class="vle-mini del" data-jr-del data-id="${A(j.id)}" title="Delete">\u2715</button></span></div>`
    + `<div class="vle-jr-mem">${esc(j.memory)}</div>`
    + `<div class="vle-jr-tags"><span class="vle-jr-tag">${esc(j.kind)}</span><span class="vle-jr-tag w-${j.weight}">${esc(j.weight)}</span><span class="vle-jr-tag vle-jr-sent">${esc(j.sentiment)}</span>${j.day ? `<span class="vle-jr-day">day ${j.day}</span>` : ''}</div>`
    + '</div>';
}
