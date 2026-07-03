/**
 * Tone dials (Phase 2 engine reinforcement): Romance pace + World disposition,
 * made mechanically true on the bond graph rather than only suggested in the
 * preset. Pure — callers pass resolved facts (is this the user? does the bond
 * exist? is it already romantic?) so this module never touches ChronicleState
 * or host APIs. Off/neutral settings reproduce today's behavior exactly.
 */

export type Romance = 'off' | 'slow_burn' | 'medium' | 'fast' | 'erotic';
export type Disposition = 'kind' | 'warm' | 'fair' | 'harsh' | 'brutal';
// Social autonomy: how much NPC↔NPC relationships evolve on their own.
//  off       — only user-driven; off-screen sim never touches bonds (today's behavior)
//  reactive  — NPC↔NPC bonds evolve freely IN witnessed scenes; nothing off-screen
//  living    — + bounded off-screen drift (small aff/trust nudges, NO category flips)
//  autonomous— + off-screen bonds may form/strain/cool (small category steps allowed)
export type Social = 'off' | 'reactive' | 'living' | 'autonomous';
export interface Tone { romance: Romance; disposition: Disposition; social: Social }

export const DEFAULT_TONE: Tone = { romance: 'medium', disposition: 'fair', social: 'living' };

const ROMANCES = new Set<Romance>(['off', 'slow_burn', 'medium', 'fast', 'erotic']);
const DISPOSITIONS = new Set<Disposition>(['kind', 'warm', 'fair', 'harsh', 'brutal']);
const SOCIALS = new Set<Social>(['off', 'reactive', 'living', 'autonomous']);

// per-turn |aff| ceiling for a ROMANTIC bond. medium ≈ unconstrained in practice
// (model rarely exceeds), slow_burn bites hard, fast/erotic open it up.
const ROMANCE_CLAMP: Record<Romance, number> = { off: 0, slow_burn: 4, medium: 12, fast: 25, erotic: 40 };
// one-time opening lean added to a NEW {{user}}↔cast bond's first aff delta.
const DISP_SEED: Record<Disposition, number> = { kind: 15, warm: 7, fair: 0, harsh: -10, brutal: -25 };
// per-interval |aff|/|trust| ceiling for an OFF-SCREEN NPC↔NPC bond drift. off/reactive
// forbid it entirely (0); living nudges gently; autonomous allows a real step.
const OFFSCREEN_BOND_CLAMP: Record<Social, number> = { off: 0, reactive: 0, living: 6, autonomous: 15 };

/** Off-screen NPC↔NPC relationship policy for the given level. PURE — the sim
 * uses `maxDelta` to clamp aff/trust and `allowCategory` to gate new facets
 * (never romantic off-screen unless already established). `enabled` false = the
 * sim must not emit ANY bond (off/reactive reproduce today's blanket ban). */
export function offscreenBondPolicy(social: Social): { enabled: boolean; maxDelta: number; allowCategory: boolean } {
  const maxDelta = OFFSCREEN_BOND_CLAMP[social] ?? 0;
  return { enabled: maxDelta > 0, maxDelta, allowCategory: social === 'autonomous' };
}

/** A new faction's opening standing toward {{user}}, seeded by World Disposition
 * — the per-group granular version of the global dial. 0 for fair. */
export function seedFactionStanding(tone: Tone): number {
  return DISP_SEED[tone.disposition] ?? 0;
}

export function parseTone(romance?: string | null, disposition?: string | null, social?: string | null): Tone {
  const r = (romance && ROMANCES.has(romance as Romance)) ? romance as Romance : DEFAULT_TONE.romance;
  const d = (disposition && DISPOSITIONS.has(disposition as Disposition)) ? disposition as Disposition : DEFAULT_TONE.disposition;
  const s = (social && SOCIALS.has(social as Social)) ? social as Social : DEFAULT_TONE.social;
  return { romance: r, disposition: d, social: s };
}

export function isDefaultTone(t: Tone): boolean {
  return t.romance === DEFAULT_TONE.romance && t.disposition === DEFAULT_TONE.disposition && t.social === DEFAULT_TONE.social;
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
