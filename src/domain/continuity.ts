import type { ChronicleState } from './types.js';
import type { VellumEvent } from '../core/events.js';

/**
 * Continuity alarm (Plot Director, Phase 5) — a PASSIVE guard. It compares a
 * fold's events against the prior derived state and flags likely impossibilities
 * the model wrote. It NEVER blocks or mutates: it only advises, because the model
 * is creative and false positives are expected. Pure + deterministic.
 *
 * Checks (high-signal, low-false-positive) — all derivable from the fold's own
 * events vs prior state:
 *  - reveal of a secret that isn't kept (unknown id) or is already revealed
 *  - "learning" a fact a character already holds verbatim (redundant re-learn)
 *
 * (A locked-category violation can't be seen here — the lock already stripped it
 * at the fold chokepoint, so the event no longer carries the forbidden cat.)
 */

export interface ContinuityWarning {
  kind: 'unknown_secret' | 'already_revealed' | 'redundant_knowledge' | 'trait_reversal';
  text: string;
}

export function checkContinuity(events: readonly VellumEvent[], prior: ChronicleState): ContinuityWarning[] {
  const warnings: ContinuityWarning[] = [];
  const name = (id: string): string => prior.cast[id]?.name ?? id;

  for (const e of events) {
    if (e.kind === 'secret.reveal') {
      const id = (e as { id: string }).id;
      const sec = prior.secrets.find((x) => x.id === id);
      if (!sec) warnings.push({ kind: 'unknown_secret', text: `Revealed a secret that isn't tracked (id ${id}).` });
      else if (sec.revealed) warnings.push({ kind: 'already_revealed', text: `Secret already revealed: "${sec.text.slice(0, 60)}".` });
    } else if (e.kind === 'knowledge.learn') {
      const k = e as { who: string; fact: string };
      const f = k.fact.trim().toLowerCase();
      if (prior.knowledge.some((x) => x.who === k.who && x.fact.trim().toLowerCase() === f)) {
        warnings.push({ kind: 'redundant_knowledge', text: `${name(k.who)} "learned" something already known: "${k.fact.slice(0, 60)}".` });
      }
    } else if (e.kind === 'trait.drift') {
      // anti-flip-flop: a trait that was HARDENED (defining) reversing/fading is
      // a big deal — surface it so the author notices a possible unearned revert.
      const d = e as { who: string; trait: string; op: string };
      if (d.op === 'reverse' || d.op === 'fade') {
        const wasHardened = prior.traitHistory.some((x) => x.who === d.who && x.trait.trim().toLowerCase() === d.trait.trim().toLowerCase() && x.op === 'harden');
        if (wasHardened) warnings.push({ kind: 'trait_reversal', text: `${name(d.who)}'s defining trait "${d.trait}" is reversing \u2014 earned, or a slip?` });
      }
    }
  }
  return warnings;
}

