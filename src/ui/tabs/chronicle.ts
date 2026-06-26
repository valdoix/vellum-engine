import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc, byRecent } from '../format.js';

/**
 * Chronicle tab. The narrative record: arcs, threads, recent events (via
 * memories), and the scene. Pure render keyed on the relevant slice sizes.
 */
export const chronicleTab: Component<ChronicleState> = {
  version: (s) => `${s.arcs.length}:${s.threads.length}:${s.memories.length}:${s.turns}`,
  render(s) {
    return scene(s) + tracks('\u2746 Arcs', s.arcs) + tracks('\u269C Threads', s.threads) + memories(s);
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
  if (!s.memories.length) return '';
  const order = { arc: 0, chapter: 1, turn: 2 } as Record<string, number>;
  const mem = s.memories.slice().sort((a, b) => (order[a.tier]! - order[b.tier]!) || b.turn - a.turn).slice(0, 14);
  const rows = mem.map((m) =>
    '<div class="vle-mem"><span class="vle-mem-tier t-' + m.tier + '">' + m.tier + '</span>'
    + '<span class="vle-mem-t">' + esc(m.text) + '</span></div>'
  ).join('');
  return '<div class="vle-sec-h">\uD83D\uDCD6 Memory <span class="vle-n">' + s.memories.length + '</span></div>' + rows;
}
