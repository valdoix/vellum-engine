import type { VellumEvent } from '../core/events.js';

/**
 * Turn Inspector — PURE. Groups the raw event log by turn into a human-readable
 * "what changed this turn" digest. The event log carries `turn` on every event,
 * so this is a group-by, not new data. Read-only; the backend owns the log I/O.
 */

export interface TurnChange { icon: string; text: string; }
export interface TurnEntry { turn: number; changes: TurnChange[]; }

function label(e: VellumEvent, nameOf: (id: string) => string): TurnChange | null {
  const n = nameOf;
  switch (e.kind) {
    case 'bond.delta': {
      const a = e as any;
      const parts: string[] = [];
      if (a.aff) parts.push('aff ' + (a.aff > 0 ? '+' : '') + a.aff);
      if (a.trust) parts.push('trust ' + (a.trust > 0 ? '+' : '') + a.trust);
      if (a.addCats?.length) parts.push('+' + a.addCats.join('/'));
      if (a.removeCats?.length) parts.push('-' + a.removeCats.join('/'));
      return { icon: '\u2665', text: `${n(a.a)} \u2192 ${n(a.b)}: ${parts.join(', ') || 'bond'}${a.why ? ' (' + a.why + ')' : ''}` };
    }
    case 'knowledge.learn': { const a = e as any; return { icon: '\u25C8', text: `${n(a.who)} learned: ${a.fact}` }; }
    case 'secret.form': { const a = e as any; return { icon: '\u26C0', text: `secret: ${a.text ?? a.secret ?? ''}` }; }
    case 'secret.reveal': return { icon: '\u26C0', text: 'a secret was revealed' };
    case 'journal.entry': { const a = e as any; return { icon: '\u270E', text: `${n(a.who)} remembers: ${a.memory}` }; }
    case 'scar.form': { const a = e as any; return { icon: '\u2620', text: `${n(a.who)} scar: ${a.was}` }; }
    case 'lore.note': { const a = e as any; return { icon: '\u2756', text: `codex: ${a.fact}` }; }
    case 'item.change': { const a = e as any; return { icon: '\u2726', text: `${a.who === 'world' ? 'scene' : n(a.who)} ${a.op}: ${a.item}` }; }
    case 'location.set': { const a = e as any; return a.auto ? null : { icon: '\u25C9', text: `location: ${a.name}` }; }
    case 'trait.drift': { const a = e as any; return { icon: '\u21C4', text: `${n(a.who)} ${a.op}: ${a.trait}${a.from ? ' (was ' + a.from + ')' : ''}` }; }
    case 'faction.member': { const a = e as any; return { icon: '\u2691', text: `${n(a.char)} ${a.op === 'add' ? 'joined' : 'left'} ${a.faction}` }; }
    case 'arc.op': case 'thread.op': { const a = e as any; return { icon: '\u269C', text: `${a.op ?? 'thread'}: ${a.name ?? ''}` }; }
    case 'continuity.flag': { const a = e as any; return { icon: '\u26A0', text: a.detail }; }
    default: return null; // structural/noise events (turn.fold, cast.seen, scene.set, memory.*) are omitted
  }
}

/** Group events into per-turn digests, newest turn first. Turns with no
 * meaningful change are omitted. */
export function turnLog(events: readonly VellumEvent[], nameOf: (id: string) => string, limitTurns = 60): TurnEntry[] {
  const byTurn = new Map<number, TurnChange[]>();
  for (const e of events) {
    const t = (e as { turn?: number }).turn ?? 0;
    if (t <= 0) continue;
    const c = label(e, nameOf);
    if (!c) continue;
    (byTurn.get(t) ?? byTurn.set(t, []).get(t)!).push(c);
  }
  return [...byTurn.entries()]
    .filter(([, cs]) => cs.length)
    .sort((a, b) => b[0] - a[0])
    .slice(0, limitTurns)
    .map(([turn, changes]) => ({ turn, changes }));
}
