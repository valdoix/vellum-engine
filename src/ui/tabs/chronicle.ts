import type { Component } from '../component.js';
import type { ChronicleState, Memory } from '../../domain/types.js';
import { esc, byRecent } from '../format.js';
import { cmd, paginate, pagerHtml } from '../bridge.js';
import { formModal } from '../modal.js';

/**
 * Chronicle tab. Scene, arcs, threads, memory (turn/chapter/arc tiers),
 * knowledge & secrets. Memories paginate and can be added/deleted; knowledge
 * and secrets can be added. CRUD flows through the bridge → vellum_cmd.
 */
export const chronicleTab: Component<ChronicleState> = {
  version: (s) => `${s.arcs.length}:${s.threads.length}:${s.memories.length}:${s.knowledge.length}:${s.secrets.length}:${s.turns}`,
  render(s) {
    return scene(s) + tracks('\u2746 Arcs', s.arcs) + tracks('\u269C Threads', s.threads) + memories(s) + knowledge(s) + secrets(s);
  },
  mount(host) {
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-mem-add]')) { formModal('New Memory', [
        { key: 'text', label: 'Memory', type: 'textarea', placeholder: 'What happened, in detail.' },
        { key: 'keys', label: 'Keywords (comma-separated)', type: 'text' },
        { key: 'tier', label: 'Tier', type: 'select', value: 'chapter', options: [{ value: 'chapter', label: 'chapter' }, { value: 'arc', label: 'arc' }] },
      ], (o) => { if (o.text?.trim()) cmd('memory_add', o); }); return; }
      if (t.closest('[data-know-add]')) { formModal('New Knowledge', [
        { key: 'who', label: 'Who knows it', type: 'text', placeholder: 'Cersei' },
        { key: 'fact', label: 'Fact', type: 'textarea' },
        { key: 'about', label: 'About (optional)', type: 'text' },
      ], (o) => { if (o.who?.trim() && o.fact?.trim()) cmd('knowledge_add', o); }); return; }
      if (t.closest('[data-sec-add]')) { formModal('New Secret', [
        { key: 'keeper', label: 'Keeper', type: 'text', placeholder: 'Cersei' },
        { key: 'text', label: 'Secret', type: 'textarea' },
        { key: 'from', label: 'Hidden from (comma-separated)', type: 'text' },
      ], (o) => { if (o.keeper?.trim() && o.text?.trim()) cmd('secret_add', o); }); return; }
      const md = t.closest('[data-mem-del]');
      if (md && confirm('Delete this memory?')) cmd('memory_delete', { id: md.getAttribute('data-id') });
    });
  },
};

function scene(s: ChronicleState): string {
  if (!s.scene.location && !s.scene.tension) return '';
  return '<div class="vle-scene">' + esc(s.scene.location || '\u2014')
    + (s.scene.tension ? ' <span class="vle-tension">tension ' + esc(s.scene.tension) + '/10</span>' : '') + '</div>';
}

function tracks(title: string, list: ChronicleState['arcs']): string {
  if (!list.length) return '';
  const rows = list.slice().sort(byRecent).slice(0, 12).map((t) =>
    '<div class="vle-track"><span class="vle-track-n">' + esc(t.name) + '</span><span class="vle-track-s">' + esc(t.status) + '</span></div>'
  ).join('');
  return '<div class="vle-sec-h">' + esc(title) + ' <span class="vle-n">' + list.length + '</span></div>' + rows;
}

function memories(s: ChronicleState): string {
  const head = '<div class="vle-sec-h">\uD83D\uDCD6 Memory <span class="vle-n">' + s.memories.length + '</span><button class="vle-add sm" data-mem-add>+</button></div>';
  if (!s.memories.length) return head + '<div class="vle-empty sm">No memories yet.</div>';
  const order = { arc: 0, chapter: 1, turn: 2 } as Record<string, number>;
  const sorted = s.memories.slice().sort((a, b) => (order[a.tier]! - order[b.tier]!) || b.turn - a.turn);
  const { slice, page, pages } = paginate('memories', sorted);
  const rows = slice.map((m: Memory) =>
    '<div class="vle-mem"><span class="vle-mem-tier t-' + m.tier + '">' + m.tier + '</span>'
    + '<span class="vle-mem-t">' + esc(m.text) + '</span>'
    + `<button class="vle-mini del" data-mem-del data-id="${esc(m.id)}" title="Delete">\u2715</button></div>`
  ).join('');
  return head + rows + pagerHtml('memories', page, pages);
}

function knowledge(s: ChronicleState): string {
  const head = '<div class="vle-sec-h">\u25C8 Knowledge <span class="vle-n">' + s.knowledge.length + '</span><button class="vle-add sm" data-know-add>+</button></div>';
  if (!s.knowledge.length) return head + '<div class="vle-empty sm">\u2014</div>';
  const { slice, page, pages } = paginate('knowledge', s.knowledge.slice().reverse());
  const rows = slice.map((k) => '<div class="vle-mem"><span class="vle-mem-tier t-chapter">' + esc(k.who) + '</span><span class="vle-mem-t">' + esc(k.fact) + '</span></div>').join('');
  return head + rows + pagerHtml('knowledge', page, pages);
}

function secrets(s: ChronicleState): string {
  const head = '<div class="vle-sec-h">\u26C0 Secrets <span class="vle-n">' + s.secrets.length + '</span><button class="vle-add sm" data-sec-add>+</button></div>';
  if (!s.secrets.length) return head + '<div class="vle-empty sm">\u2014</div>';
  const { slice, page, pages } = paginate('secrets', s.secrets.slice().reverse());
  const rows = slice.map((sec) => '<div class="vle-mem"><span class="vle-mem-tier t-turn">' + esc(sec.keeper) + (sec.revealed ? ' \u00b7 out' : '') + '</span><span class="vle-mem-t">' + esc(sec.text) + (sec.from.length ? ' <em>(from ' + esc(sec.from.join(', ')) + ')</em>' : '') + '</span></div>').join('');
  return head + rows + pagerHtml('secrets', page, pages);
}
