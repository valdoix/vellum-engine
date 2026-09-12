import type { ChronicleState } from './types.js';

/**
 * Foreshadow plants — PURE. Unresolved plants are gently surfaced so a seeded
 * detail (a locked drawer, an omen) doesn't quietly vanish; the older it gets,
 * the more it wants to pay off. Injection is capped + oldest-first.
 */

export function openPlants(state: ChronicleState): ChronicleState['plants'] {
  return (state.plants ?? []).filter((p) => p.status === 'planted').sort((a, b) => a.plantedTurn - b.plantedTurn);
}

function refClosed(state: ChronicleState, raw: string): boolean {
  const ref = raw.trim().toLocaleLowerCase();
  const track = [...state.threads, ...state.arcs].find(row => row.id.toLocaleLowerCase() === ref || row.name.toLocaleLowerCase() === ref);
  if (track) return /resolv|complete|closed/i.test(track.status);
  const subplot = state.offscreen.find(row => row.id.toLocaleLowerCase() === ref || row.name.toLocaleLowerCase() === ref);
  if (subplot) return subplot.status === 'resolved';
  const plant = state.plants.find(row => row.id.toLocaleLowerCase() === ref || row.what.toLocaleLowerCase() === ref);
  return !!plant && (plant.status === 'paid' || plant.status === 'abandoned');
}

export function plantEligible(state: ChronicleState, plant: ChronicleState['plants'][number]): boolean {
  if (plant.status !== 'planted') return false;
  if ((plant.blockedBy ?? []).some(ref => !refClosed(state, ref))) return false;
  if ((plant.dependsOn ?? []).some(ref => !refClosed(state, ref))) return false;
  if ((plant.maturity ?? 0) < (plant.minMaturity ?? 0)) return false;
  if (plant.dueDay !== undefined) {
    if (state.day < plant.dueDay) return false;
    if (state.day === plant.dueDay && plant.dueClock !== undefined && (state.scene.clock === undefined || state.scene.clock < plant.dueClock)) return false;
  }
  return true;
}

export function plantsInjection(state: ChronicleState, nowTurn: number, cap = 6): string {
  const open = openPlants(state);
  if (!open.length) return '';
  // Presence improves opportunity, but causal gates decide actual eligibility.
  const present = new Set(state.scene.present ?? []);
  const inScene = (p: ChronicleState['plants'][number]): boolean => !!p.subject && present.has(p.subject);
  const ordered = open.slice().sort((a, b) => Number(plantEligible(state, b)) - Number(plantEligible(state, a)) || (inScene(b) ? 1 : 0) - (inScene(a) ? 1 : 0));
  const nameOf = (id: string): string => state.cast[id]?.name ?? state.locations.find((l) => l.id === id)?.name ?? id;
  const lines = ordered.slice(0, cap).map((p) => {
    const eligible = plantEligible(state, p);
    const expired = p.expiryDay !== undefined && state.day >= p.expiryDay;
    const gate = eligible ? ' [eligible: may pay off through a causal path]' : ' [not mature: preserve; do not pay off yet]';
    const urgency = expired ? ' [expiry reached: let the possibility lapse or transform if supported; never force a reveal]' : '';
    const maturity = p.maturity !== undefined || p.minMaturity !== undefined ? ` [maturity ${p.maturity ?? 0}/${p.minMaturity ?? 0}]` : '';
    const subj = p.subject ? ' [concerns ' + nameOf(p.subject) + (inScene(p) ? ', present now' : '') + ']' : '';
    return '- ' + p.what + subj + maturity + gate + urgency;
  });
  void nowTurn;
  return '[UNRESOLVED THREADS \u2014 planted details remain possibilities, not obligations. Pay off only rows marked eligible and only through an available causal path. Preserve blocked rows; expiry may close a possibility without forcing it.]\n' + lines.join('\n');
}
