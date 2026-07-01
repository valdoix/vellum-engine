import type { ChronicleState } from './types.js';

/**
 * Foreshadow plants — PURE. Unresolved plants are gently surfaced so a seeded
 * detail (a locked drawer, an omen) doesn't quietly vanish; the older it gets,
 * the more it wants to pay off. Injection is capped + oldest-first.
 */

export function openPlants(state: ChronicleState): ChronicleState['plants'] {
  return (state.plants ?? []).filter((p) => p.status === 'planted').sort((a, b) => a.plantedTurn - b.plantedTurn);
}

export function plantsInjection(state: ChronicleState, nowTurn: number, cap = 6): string {
  const open = openPlants(state);
  if (!open.length) return '';
  const lines = open.slice(0, cap).map((p) => {
    const age = Math.max(0, nowTurn - p.plantedTurn);
    const nudge = age >= 15 ? ' (planted long ago — it wants to pay off or resurface soon)' : '';
    return '- ' + p.what + nudge;
  });
  return '[UNRESOLVED THREADS \u2014 details planted earlier that still hang. Honor them; let them resurface or pay off when the moment is right, never forget them]\n' + lines.join('\n');
}
