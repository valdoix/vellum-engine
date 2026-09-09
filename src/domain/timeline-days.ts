import type { ChronicleState } from './types.js';

/**
 * Effective narrative day for a historical turn.
 *
 * A user repair wins. An entry's authored stamp (notably Story Beats) comes
 * next, then the canonical turn.fold stamp supplies dates for record types that
 * never carried their own day. Undefined means the old log has no usable stamp.
 */
export function timelineDay(state: ChronicleState, turn: number, recordedDay?: number): number | undefined {
  const override = state.timelineDayOverrides?.[String(turn)];
  if (Number.isFinite(override) && override! >= 0) return Math.floor(override!);
  if (Number.isFinite(recordedDay) && recordedDay! >= 0) return Math.floor(recordedDay!);
  const folded = state.turnDays?.[String(turn)];
  return Number.isFinite(folded) && folded! >= 0 ? Math.floor(folded!) : undefined;
}

/** Turn-only form used to validate a range repair against adjacent chronology. */
export function canonicalTurnDay(state: ChronicleState, turn: number): number | undefined {
  const override = state.timelineDayOverrides?.[String(turn)];
  if (Number.isFinite(override) && override! >= 0) return Math.floor(override!);
  const folded = state.turnDays?.[String(turn)];
  return Number.isFinite(folded) && folded! >= 0 ? Math.floor(folded!) : undefined;
}

/** Find the closest known day on each side of an inclusive turn range. */
export function adjacentTimelineDays(
  state: ChronicleState,
  fromTurn: number,
  toTurn: number,
): { before?: { turn: number; day: number }; after?: { turn: number; day: number } } {
  const turns = new Set<number>();
  for (const key of Object.keys(state.turnDays ?? {})) turns.add(Number(key));
  for (const key of Object.keys(state.timelineDayOverrides ?? {})) turns.add(Number(key));
  const valid = Array.from(turns).filter((turn) => Number.isInteger(turn) && turn >= 0);
  const beforeTurn = valid.filter((turn) => turn < fromTurn).sort((a, b) => b - a)[0];
  const afterTurn = valid.filter((turn) => turn > toTurn).sort((a, b) => a - b)[0];
  const beforeDay = beforeTurn === undefined ? undefined : canonicalTurnDay(state, beforeTurn);
  const afterDay = afterTurn === undefined ? undefined : canonicalTurnDay(state, afterTurn);
  return {
    ...(beforeTurn !== undefined && beforeDay !== undefined ? { before: { turn: beforeTurn, day: beforeDay } } : {}),
    ...(afterTurn !== undefined && afterDay !== undefined ? { after: { turn: afterTurn, day: afterDay } } : {}),
  };
}

/** Return the first backward step a proposed repair would create. */
export function timelineRepairConflict(
  state: ChronicleState,
  fromTurn: number,
  toTurn: number,
  narrativeDay: number | null,
): { earlierTurn: number; earlierDay: number; laterTurn: number; laterDay: number } | null {
  const turns = new Set<number>([fromTurn, toTurn]);
  for (const key of Object.keys(state.turnDays ?? {})) turns.add(Number(key));
  for (const key of Object.keys(state.timelineDayOverrides ?? {})) turns.add(Number(key));
  const ordered = Array.from(turns).filter((turn) => Number.isInteger(turn) && turn >= 0).sort((a, b) => a - b);
  let previous: { turn: number; day: number } | undefined;
  for (const turn of ordered) {
    let day: number | undefined;
    if (turn >= fromTurn && turn <= toTurn) {
      day = narrativeDay === null ? state.turnDays?.[String(turn)] : narrativeDay;
    } else day = canonicalTurnDay(state, turn);
    if (!Number.isFinite(day) || day! < 0) continue;
    const current = { turn, day: Math.floor(day!) };
    if (previous && current.day < previous.day) {
      return { earlierTurn: previous.turn, earlierDay: previous.day, laterTurn: current.turn, laterDay: current.day };
    }
    previous = current;
  }
  return null;
}
