import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc, initials, castByStatus, byRecent } from '../format.js';

/**
 * Cast tab. Groups the cast by presence and renders cards. Pure render; the
 * version key means it only re-renders when the cast set/turn changes.
 */
export const castTab: Component<ChronicleState> = {
  version: (s) => Object.keys(s.cast).length + ':' + s.turns,
  render(s) {
    const g = castByStatus(s);
    return group('\u25C9 Present', g.present, 'No one on stage this turn.', true)
      + group('\u25CB Active', g.active, 'No recurring characters yet.')
      + group('\u2027 Mentioned', g.mentioned, 'No off-page mentions yet.')
      + group('\u2605 Added', g.added, 'None added by you.');
  },
};

function group(title: string, cards: ChronicleState['cast'][string][], empty: string, present = false): string {
  const body = cards.length
    ? '<div class="vle-cards">' + cards.slice().sort(byRecent).map((c) => card(c, present)).join('') + '</div>'
    : '<div class="vle-empty sm">' + esc(empty) + '</div>';
  return '<div class="vle-sec-h">' + esc(title) + ' <span class="vle-n">' + cards.length + '</span></div>' + body;
}

function card(c: ChronicleState['cast'][string], present: boolean): string {
  const meta = [c.role, c.age].filter(Boolean).map(esc).join(' \u00b7 ');
  return '<div class="vle-card' + (present ? ' on' : '') + '">'
    + '<span class="vle-av">' + esc(initials(c.name)) + '</span>'
    + '<span class="vle-card-main"><span class="vle-card-n">' + esc(c.name) + (c.userEdited ? ' <span class="vle-star">\u2605</span>' : '') + '</span>'
    + (meta ? '<span class="vle-card-meta">' + meta + '</span>' : '')
    + (c.appearance ? '<span class="vle-card-app">' + esc(c.appearance) + '</span>' : '')
    + '</span></div>';
}
