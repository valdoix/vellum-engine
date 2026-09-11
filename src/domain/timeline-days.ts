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
