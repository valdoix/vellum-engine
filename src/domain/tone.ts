/**
 * Tone dials (Phase 2 engine reinforcement): Romance pace + World disposition,
 * made mechanically true on the bond graph rather than only suggested in the
 * preset. Pure — callers pass resolved facts (is this the user? does the bond
 * exist? is it already romantic?) so this module never touches ChronicleState
 * or host APIs. Off/neutral settings reproduce today's behavior exactly.
 */

export type Romance = 'off' | 'slow_burn' | 'medium' | 'fast' | 'erotic';
export type Disposition = 'kind' | 'warm' | 'fair' | 'harsh' | 'brutal';
export interface Tone { romance: Romance; disposition: Disposition }

export const DEFAULT_TONE: Tone = { romance: 'medium', disposition: 'fair' };

const ROMANCES = new Set<Romance>(['off', 'slow_burn', 'medium', 'fast', 'erotic']);
const DISPOSITIONS = new Set<Disposition>(['kind', 'warm', 'fair', 'harsh', 'brutal']);

// per-turn |aff| ceiling for a ROMANTIC bond. medium ≈ unconstrained in practice
// (model rarely exceeds), slow_burn bites hard, fast/erotic open it up.
const ROMANCE_CLAMP: Record<Romance, number> = { off: 0, slow_burn: 4, medium: 12, fast: 25, erotic: 40 };
// one-time opening lean added to a NEW {{user}}↔cast bond's first aff delta.
const DISP_SEED: Record<Disposition, number> = { kind: 15, warm: 7, fair: 0, harsh: -10, brutal: -25 };

export function parseTone(romance?: string | null, disposition?: string | null): Tone {
  const r = (romance && ROMANCES.has(romance as Romance)) ? romance as Romance : DEFAULT_TONE.romance;
  const d = (disposition && DISPOSITIONS.has(disposition as Disposition)) ? disposition as Disposition : DEFAULT_TONE.disposition;
  return { romance: r, disposition: d };
}

export function isDefaultTone(t: Tone): boolean {
  return t.romance === DEFAULT_TONE.romance && t.disposition === DEFAULT_TONE.disposition;
}

export interface BondInput { a: string; b: string; aff?: number; trust?: number; addCats?: string[] }
export interface BondFacts {
  /** canonical user id ('' if unknown) — for the disposition first-impression seed */
  userId: string;
  /** does a {a→b} relation already exist? (seed applies only on creation) */
  relExists: boolean;
  /** is this bond romantic — either adding the romantic cat now, or already romantic? */
  romantic: boolean;
}

/**
 * Apply the tone dials to one bond delta. Returns the adjusted bond, or null if
 * nothing survives (e.g. romance-off stripped the only thing it carried).
 *
 *  - Romance OFF      → strip the `romantic` category (no romance edges sprout).
 *  - Romance pace     → clamp |aff| of a romantic bond to the pace ceiling.
 *  - Disposition seed → add a one-time opening lean to a NEW user↔cast bond.
 */
export function adjustBond(b: BondInput, tone: Tone, facts: BondFacts): BondInput | null {
  let aff = b.aff;
  let addCats = b.addCats;

  // romance OFF: remove the romantic facet entirely
  if (tone.romance === 'off' && addCats?.length) {
    addCats = addCats.filter((c) => c !== 'romantic');
  }
  const romanticAfterStrip = tone.romance === 'off' ? false : facts.romantic;

  // romance pace: clamp a romantic bond's per-turn affection movement
  if (romanticAfterStrip && typeof aff === 'number' && tone.romance !== 'medium') {
    const cap = ROMANCE_CLAMP[tone.romance];
    if (cap > 0) aff = Math.max(-cap, Math.min(cap, aff));
  }

  // disposition: seed the opening lean on a brand-new user↔cast bond, once
  const involvesUser = !!facts.userId && (b.a === facts.userId || b.b === facts.userId);
  if (involvesUser && !facts.relExists) {
    const seed = DISP_SEED[tone.disposition];
    if (seed) aff = (aff ?? 0) + seed;
  }

  const out: BondInput = { a: b.a, b: b.b };
  if (typeof aff === 'number' && aff !== 0) out.aff = aff;
  if (typeof b.trust === 'number') out.trust = b.trust;
  if (addCats?.length) out.addCats = addCats;

  // nothing left to say → drop (e.g. off-romance stripped the sole romantic cat
  // and there was no aff/trust movement)
  if (out.aff === undefined && out.trust === undefined && !out.addCats) return null;
  return out;
}
