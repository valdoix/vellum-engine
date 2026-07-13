/**
 * Turn-structure validation — a cheap, pure check that surfaces the "only one
 * block" failure honestly to the user instead of letting it pass silently.
 *
 * The VELLUM contract is three parts: <reverie> (plan) -> prose -> <vellum>
 * (state). Models sometimes emit only ONE of the two scaffold blocks:
 *   - reverie but no state  → the turn folds NOTHING into the chronicle (the
 *     damaging case: the ledger silently stops advancing)
 *   - state but no reverie  → planning collapsed into a hidden CoT channel, or
 *     the assistant prefill was not echoed (cosmetic; state still folds)
 *
 * This module only DETECTS. The backend decides whether to toast, using the
 * parse `source` (so a state block that parsed via regex/JSON still counts as
 * present even if the literal <vellum> fence drifted). Pure — no host/spindle
 * deps — so it is unit-testable in isolation.
 */

// Tolerant tag probes — match the spellings the parser/display regexes accept,
// including spaced/partial close tags (`</ reverie >`, `</rever…>`) and the
// four vellum fence variants (<vellum>, ‹vellum›, ```vellum, [VELLUM]).
const REVERIE_TAG_RE = /<\s*\/?\s*rever[a-z]*\s*>/i;
const VELLUM_TAG_RE = /\u2039\s*\/?\s*vellum\s*\u203a|<\s*\/?\s*vellum\s*>|```\s*vellum|\[\s*\/?\s*VELLUM\s*\]/i;

/** How the state block was parsed (mirrors ParseResult['source']). A block that
 *  parsed by ANY means — clean JSON, salvaged JSON, or the terse regex ledger —
 *  counts as PRESENT, so we never warn about a state block that actually folded. */
export type StateSource = 'json' | 'json-partial' | 'regex' | 'none';

export interface TurnExpectations {
  /** the preset's Reverie toggle is on (var::reverie) — a reverie is expected */
  reverie: boolean;
  /** the preset's Emit State Block toggle is on (var::state_on) — a block is expected */
  state: boolean;
}

export interface TurnValidation {
  valid: boolean;
  /** which expected parts are missing from the reply: 'reverie' and/or 'state' */
  missing: Array<'reverie' | 'state'>;
}

/**
 * Validate one raw assistant turn against the expected three-part contract.
 *
 * `stateSource` is the parser's verdict for THIS turn: any value other than
 * 'none' means the state folded successfully (even if the literal fence drifted
 * and the regex fallback caught it), so the state part is satisfied regardless
 * of whether a raw <vellum> tag survived. The state part is only "missing" when
 * the parser recovered nothing AND no vellum fence is present in the text.
 *
 * The reverie part relies on the literal tag (reverie is display-only scaffold,
 * never parsed into state), tolerating a prefill-eaten open tag by also
 * accepting a lone close tag.
 */
export function validateTurnStructure(
  content: string,
  expect: TurnExpectations,
  stateSource: StateSource,
): TurnValidation {
  const missing: Array<'reverie' | 'state'> = [];
  if (!content || !content.trim()) return { valid: true, missing }; // empty/streaming — don't warn

  if (expect.reverie && !REVERIE_TAG_RE.test(content)) missing.push('reverie');

  // state is present if the parser folded anything, OR a raw fence survived
  // (defensive — the backend passes the real source, so this OR mainly guards a
  // block that is present but momentarily unparsed mid-stream).
  const stateParsed = stateSource !== 'none';
  if (expect.state && !stateParsed && !VELLUM_TAG_RE.test(content)) missing.push('state');

  return { valid: missing.length === 0, missing };
}

/**
 * True when a raw turn looks like a VELLUM turn — it contains at least one of
 * the two scaffold blocks. Used as a gate in the backend so plain (non-VELLUM)
 * chats never receive a false-positive "missing block" warning.
 */
export function looksLikeVellumTurn(content: string): boolean {
  return REVERIE_TAG_RE.test(content) || VELLUM_TAG_RE.test(content);
}

/** Human-readable, actionable toast text for a missing-block result, or null when
 *  nothing is missing. Kept here (pure) so the copy is testable and consistent. */
export function missingBlockMessage(v: TurnValidation): string | null {
  if (v.valid || !v.missing.length) return null;
  if (v.missing.length === 2) {
    return 'VELLUM: the last reply emitted neither the reverie nor the \u2039vellum\u203a state block \u2014 the chronicle did not advance. Consider regenerating; if it persists, check the Model Errata dropdown matches your model.';
  }
  if (v.missing[0] === 'state') {
    return 'VELLUM: the last reply skipped the \u2039vellum\u203a state block after the prose, so nothing folded into the chronicle this turn. Consider regenerating; if it persists, set the Model Errata to match your model.';
  }
  return 'VELLUM: the last reply skipped the \u2039reverie\u203a planning block (prose/state only). State still folded; this is usually harmless on reasoning models that plan in a hidden channel.';
}
