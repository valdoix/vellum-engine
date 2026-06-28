import type { VellumEvent } from '../core/events.js';

/**
 * Plot Director directives (Phase 2) — typed PENDING intentions that steer the
 * NEXT scene. Unlike relation locks (a hard output-side strip), directives are
 * SUGGESTIONS: they inject as gentle guidance while armed, self-clear when the
 * fold observes the matching state transition, and TTL-expire if the model never
 * complies (so nothing nags forever). Pure + deterministic — the backend
 * persists the list and owns I/O; this module decides text + lifecycle.
 *
 * Design rule: a directive is a whiteboard note, never a puppet string. The user
 * always sees its status (armed / done) in the Director panel + Context tab.
 */

export type DirectiveKind = 'reveal_secret' | 'reveal_knowledge' | 'advance_thread' | 'note';
export type DirectiveStatus = 'armed' | 'done';

export interface Directive {
  id: string;
  kind: DirectiveKind;
  /** human label shown in the panel + injected guidance */
  text: string;
  /** target id/name the self-clear watches (secret id, thread name, etc.) */
  target?: string;
  status: DirectiveStatus;
  createdTurn: number;
  /** turns-to-live while armed; 0 = no expiry */
  ttl: number;
}

const KINDS = new Set<DirectiveKind>(['reveal_secret', 'reveal_knowledge', 'advance_thread', 'note']);

/** Validate/normalize a raw directives blob (from a chat var). */
export function sanitizeDirectives(raw: unknown): Directive[] {
  if (!Array.isArray(raw)) return [];
  const out: Directive[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const kind = String(o.kind ?? '') as DirectiveKind;
    if (!KINDS.has(kind)) continue;
    const text = String(o.text ?? '').trim().slice(0, 280);
    if (!text) continue;
    out.push({
      id: String(o.id ?? '').trim() || `d${Math.random().toString(36).slice(2, 9)}`,
      kind,
      text,
      ...(o.target ? { target: String(o.target).trim() } : {}),
      status: o.status === 'done' ? 'done' : 'armed',
      createdTurn: Number.isFinite(o.createdTurn) ? Number(o.createdTurn) : 0,
      ttl: Number.isFinite(o.ttl) ? Math.max(0, Math.min(50, Number(o.ttl))) : 6,
    });
  }
  return out;
}

const KIND_VERB: Record<DirectiveKind, string> = {
  reveal_secret: 'Reveal this secret', reveal_knowledge: 'Have a character act on / share this',
  advance_thread: 'Advance this plot thread', note: 'Director note',
};

/**
 * The "DIRECTOR'S INTENT" block injected into the prompt — only ARMED directives,
 * phrased as gentle guidance (not commands). Returns '' if nothing is armed, so
 * the caller appends nothing.
 */
export function directiveInjection(directives: readonly Directive[]): string {
  const armed = directives.filter((d) => d.status === 'armed');
  if (!armed.length) return '';
  const lines = armed.map((d) => `- ${d.text}`);
  return `[DIRECTOR'S INTENT — weave these into the next scene naturally if it fits; do not force]\n${lines.join('\n')}`;
}

/**
 * Self-clear: given the events a fold just produced, mark armed directives done
 * when their target transition fired, and expire ones past TTL. Pure — returns a
 * new list + whether anything changed (so the caller persists only on change).
 */
export function reconcileDirectives(directives: readonly Directive[], newEvents: readonly VellumEvent[], currentTurn: number): { directives: Directive[]; changed: boolean } {
  if (!directives.length) return { directives: directives as Directive[], changed: false };
  const revealedSecretIds = new Set(newEvents.filter((e) => e.kind === 'secret.reveal').map((e) => (e as { id: string }).id));
  const advancedThreads = new Set(newEvents.filter((e) => e.kind === 'thread.op' && ((e as { op?: string }).op === 'advance' || (e as { op?: string }).op === 'resolve')).map((e) => (e as { name: string }).name.toLowerCase()));
  const learnedFacts = newEvents.filter((e) => e.kind === 'knowledge.learn').map((e) => (e as { fact: string }).fact.toLowerCase());

  let changed = false;
  const next = directives.map((d) => {
    if (d.status !== 'armed') return d;
    let fulfilled = false;
    if (d.kind === 'reveal_secret' && d.target && revealedSecretIds.has(d.target)) fulfilled = true;
    else if (d.kind === 'advance_thread' && d.target && advancedThreads.has(d.target.toLowerCase())) fulfilled = true;
    else if (d.kind === 'reveal_knowledge' && d.target) { const t = d.target.toLowerCase(); if (learnedFacts.some((f) => f.includes(t) || t.includes(f))) fulfilled = true; }
    if (fulfilled) { changed = true; return { ...d, status: 'done' as const }; }
    // TTL expiry (armed too long) → drop by marking done (caller may prune)
    if (d.ttl > 0 && currentTurn - d.createdTurn >= d.ttl) { changed = true; return { ...d, status: 'done' as const }; }
    return d;
  });
  return { directives: next, changed };
}

/** Drop done directives (housekeeping; keep the armed set lean). */
export function pruneDone(directives: readonly Directive[]): Directive[] {
  return directives.filter((d) => d.status === 'armed');
}
