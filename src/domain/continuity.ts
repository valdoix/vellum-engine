import type { ChronicleState } from './types.js';
import type { VellumEvent } from '../core/events.js';
import { threadOffscreenLink } from './offscreen.js';
import { spanLabel } from './date-format.js';
import { parseClock, detectBackwardClock, clockLabel } from './clock.js';

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
  kind: 'unknown_secret' | 'already_revealed' | 'redundant_knowledge' | 'trait_reversal' | 'deceased_acting' | 'thread_offscreen_conflict' | 'clock_backward' | 'thread_thread_desync';
  text: string;
}

export function checkContinuity(events: readonly VellumEvent[], prior: ChronicleState): ContinuityWarning[] {
  const warnings: ContinuityWarning[] = [];
  const name = (id: string): string => prior.cast[id]?.name ?? id;

  for (const e of events) {
    if (e.kind === 'scene.set') {
      // physical-world guard: a character marked deceased narrated as on-stage.
      // Advisory only (a flashback/vision is legitimate) — flag, never block.
      const ids = new Set<string>([...(e.present ?? []), ...((e.detail ?? []).map((d) => d.id))]);
      for (const id of ids) {
        if (prior.cast[id]?.deceased) warnings.push({ kind: 'deceased_acting', text: `${name(id)} is deceased but appears on-stage \u2014 flashback, or a slip?` });
      }
      // TIME-ONLY-MOVES-FORWARD (code-level enforcement of the preset's [TIME -
      // INVIOLABLE] rule): if the new scene reads as an EARLIER time on the SAME
      // narrative day than the prior scene, that's a likely slip. A day advance
      // legitimately resets the clock, so this only fires within one day. The
      // mergeDetail (gap-fill) scene events carry no authored time — skip them.
      if (!e.mergeDetail) {
        const priorMin = prior.scene?.clock;
        const newMin = (typeof e.clock === 'number') ? e.clock : parseClock(e.time);
        if (detectBackwardClock(prior.day ?? 0, priorMin, e.day, newMin)) {
          warnings.push({ kind: 'clock_backward', text: `Time moved backward: it was "${prior.scene?.time || clockLabel(priorMin)}" and the scene now reads "${e.time || clockLabel(newMin)}" with no day rollover \u2014 a slip, or did a new day begin?` });
        }
      }
    } else if (e.kind === 'secret.reveal') {
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

/**
 * State-level skip-desync guard: after a fold, compare each open plot thread's
 * narrative-day anchor (`lastDay`) against any off-screen subplot it links to. A
 * large day gap between the two means one side moved through a time-skip and the
 * other was left behind — the exact on/off-screen desync a skip introduces.
 * Advisory only (surfaced in the Director Log). PURE + deterministic; tolerant of
 * absent day anchors (pre-day-stamp logs) — those simply don't flag.
 *
 * Distinct from checkContinuity (which is event-vs-prior): this reads only the
 * post-fold derived state, so it catches drift that has ACCUMULATED, not just
 * what a single fold's events introduced.
 */
export function checkThreadOffscreenSync(state: ChronicleState): ContinuityWarning[] {
  const warnings: ContinuityWarning[] = [];
  const isOpen = (t: { status: string }): boolean => !/resolv/i.test(t.status || '');
  const openThreads = state.threads.filter(isOpen);
  const openOff = (state.offscreen ?? []).filter((o) => o.status === 'active');
  // pass 1 — linked thread <-> off-screen desync (needs both sides present)
  if (openThreads.length && openOff.length) {
    for (const t of openThreads) {
      if (t.lastDay === undefined) continue;
      for (const o of openOff) {
        if (o.lastDay === undefined) continue;
        if (!threadOffscreenLink(t.name, o, t.id)) continue;
        // a >=2-day divergence between a linked pair is a skip-desync: one side
        // lives on a different narrative day than the other it's tied to.
        const span = spanLabel(Math.abs(t.lastDay - o.lastDay));
        if (span) {
          const behind = t.lastDay < o.lastDay ? `thread "${t.name}"` : `off-screen "${o.name}"`;
          warnings.push({ kind: 'thread_offscreen_conflict', text: `On/off-screen desync: ${behind} is ~${span} behind its linked counterpart \u2014 advance the lagging side to close the gap.` });
        }
      }
    }
  }

  // Thread-vs-thread desync: after a time-skip catch-up bumps only SOME threads,
  // two OPEN on-screen threads can end up living weeks apart. Cross-check the
  // most-recent threads pairwise (capped to bound cost) and flag a skip-span gap.
  // The lagging side is named so the Director can catch it up to the current arc.
  const dayThreads = openThreads
    .filter((t) => t.lastDay !== undefined)
    .sort((a, b) => (b.lastDay ?? 0) - (a.lastDay ?? 0))
    .slice(0, 6);
  for (let i = 0; i < dayThreads.length; i++) {
    for (let j = i + 1; j < dayThreads.length; j++) {
      const ahead = dayThreads[i]!; const behind = dayThreads[j]!;
      const span = spanLabel((ahead.lastDay ?? 0) - (behind.lastDay ?? 0));
      if (span) {
        warnings.push({ kind: 'thread_thread_desync', text: `Thread desync: "${behind.name}" (Day ${behind.lastDay}) is ~${span} behind "${ahead.name}" (Day ${ahead.lastDay}) \u2014 catch the lagging thread up to the current arc.` });
      }
    }
  }
  return warnings;
}

