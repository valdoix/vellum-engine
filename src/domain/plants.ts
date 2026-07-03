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
  // a plant whose subject is on-stage this turn is the ripest to pay off — lead with those.
  const present = new Set(state.scene.present ?? []);
  const inScene = (p: ChronicleState['plants'][number]): boolean => !!p.subject && present.has(p.subject);
  const ordered = open.slice().sort((a, b) => (inScene(b) ? 1 : 0) - (inScene(a) ? 1 : 0));
  const nameOf = (id: string): string => state.cast[id]?.name ?? state.locations.find((l) => l.id === id)?.name ?? id;
  const lines = ordered.slice(0, cap).map((p) => {
    const age = Math.max(0, nowTurn - p.plantedTurn);
    const nudge = age >= 15 ? ' (planted long ago — it wants to pay off or resurface soon)' : '';
    const subj = p.subject ? ' [concerns ' + nameOf(p.subject) + (inScene(p) ? ', present now' : '') + ']' : '';
    return '- ' + p.what + subj + nudge;
  });
  return '[UNRESOLVED THREADS \u2014 details planted earlier that still hang. Honor them; let them resurface or pay off when the moment is right, never forget them]\n' + lines.join('\n');
}
