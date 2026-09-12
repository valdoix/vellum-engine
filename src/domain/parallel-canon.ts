import { canonId } from '../core/ids.js';
import { factTokens } from './fact-match.js';
import type { ChronicleState, ParallelEvent } from './types.js';

export interface ActorLocation {
  where: string;
  source: 'scene' | 'parallel' | 'offscreen' | 'last-seen';
}

export type ParallelDraft = Pick<ParallelEvent, 'who' | 'where' | 'activity' | 'note'>;

const MOVE = /\b(?:arriv(?:e|es|ed|ing)|depart(?:s|ed|ing)?|enter(?:s|ed|ing)?|exit(?:s|ed|ing)?|go(?:es|ing)?|head(?:s|ed|ing)?|journey(?:s|ed|ing)?|leave(?:s|ing)?|left|mov(?:e|es|ed|ing)|reach(?:es|ed|ing)?|return(?:s|ed|ing)?|ride(?:s|ing)?|rode|run(?:s|ning)?|ran|sail(?:s|ed|ing)?|teleport(?:s|ed|ing)?|travel(?:s|ed|ing)?|walk(?:s|ed|ing)?|went)\b/i;
const ACCESS = /\b(?:announce(?:s|d)?|broadcast(?:s|ed|ing)?|call(?:s|ed|ing)?|courier|deliver(?:s|ed|ing)?|discover(?:s|ed|ing)?|hear(?:s|d|ing)?|heard|inform(?:s|ed|ing)?|learn(?:s|ed|ing)?|letter|message|messenger|notice(?:s|d|ing)?|observe(?:s|d|ing)?|overhear(?:s|d|ing)?|phone|radio|read(?:s|ing)?|receive(?:s|d|ing)?|report(?:s|ed|ing)?|see(?:s|ing)?|saw|signal(?:s|ed|ing)?|tell(?:s|ing)?|told|telegram|text(?:s|ed|ing)?|witness(?:es|ed|ing)?)\b/i;
const EPISTEMIC_ACTIVITY = /\b(?:aware|discovers?|finds out|hears? (?:about|that|news)|is (?:informed|told)|knows?|learns?|process(?:es|ing) (?:that|the news)|reads? (?:a |the )?(?:letter|message|report)|receives? (?:a |the )?(?:call|letter|message|news|report|signal|telegram)|realizes?|unaware)\b/i;
const RESOLVE = /\b(?:abandon(?:s|ed|ing)?|arriv(?:e|es|ed|ing)|cancel(?:s|led|ed|ing)?|ceas(?:e|es|ed|ing)|clos(?:e|es|ed|ing)|complet(?:e|es|ed|ing)|conclud(?:e|es|ed|ing)|depart(?:s|ed|ing)?|dissolv(?:e|es|ed|ing)|end(?:s|ed|ing)?|finish(?:es|ed|ing)?|lift(?:s|ed|ing)?|open(?:s|ed|ing)?|reopen(?:s|ed|ing)?|resolv(?:e|es|ed|ing)|settle(?:s|d|ing)?|stop(?:s|ped|ping)?)\b/i;
const NEGATIVE_KNOWLEDGE = /\b(?:does not|doesn't|did not|didn't|cannot|can't|unaware|unknown to|has no (?:idea|knowledge)|last knows?)\b/i;
const HIGH_IMPACT = /\b(?:abduct(?:s|ed|ing)?|assassinat(?:e|es|ed|ing)|coup|declar(?:e|es|ed|ing) war|destroy(?:s|ed|ing)?|divorc(?:e|es|ed|ing)|kidnap(?:s|ped|ping)?|kill(?:s|ed|ing)?|marr(?:y|ies|ied|ying)|murder(?:s|ed|ing)?|overthrow(?:s|ing)?|suicid(?:e|al)|wedding)\b/i;

export interface ParallelReconcileOptions {
  /** Selected NPC social autonomy. Only the highest level authorizes new
   * low-risk actor activity without visible-scene evidence. */
  npcAutonomy?: 'off' | 'reactive' | 'living' | 'autonomous';
}

export function locationKey(value?: string): string {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function sameLocation(a?: string, b?: string): boolean {
  const ak = locationKey(a), bk = locationKey(b);
  return !!ak && ak === bk;
}

/** The newest engine-owned physical anchor for an actor. */
export function canonicalActorLocation(state: ChronicleState, who: string): ActorLocation | undefined {
  const id = canonId(who);
  if (!id) return undefined;
  if (state.scene.present.map(canonId).includes(id) && state.scene.location) return { where: state.scene.location, source: 'scene' };
  const parallel = [...state.parallel].reverse().find(row => row.who && canonId(row.who) === id && row.where);
  if (parallel?.where) return { where: parallel.where, source: 'parallel' };
  const subplot = [...state.offscreen].reverse().find(row => row.status === 'active' && row.who && canonId(row.who) === id && row.where);
  if (subplot?.where) return { where: subplot.where, source: 'offscreen' };
  const actor = state.cast[id];
  return actor?.lastLocation ? { where: actor.lastLocation, source: 'last-seen' } : undefined;
}

export function actorLabels(state: ChronicleState, who: string): string[] {
  const actor = state.cast[canonId(who)];
  return [...new Set([who, actor?.name, ...(actor?.aka ?? [])].map(value => String(value ?? '').trim()).filter(Boolean))];
}

function includesNormalized(haystack: string, needle: string): boolean {
  return haystack.normalize('NFKC').toLocaleLowerCase().includes(needle.normalize('NFKC').toLocaleLowerCase().trim());
}

function relatedToken(a: string, b: string): boolean {
  return a === b || (Math.min(a.length, b.length) >= 4 && a.slice(0, 4) === b.slice(0, 4));
}

function contentGrounded(value: string, evidence: string, ignored: readonly string[] = []): boolean {
  const skip = new Set(ignored.flatMap(part => [...factTokens(part)]));
  const wanted = [...factTokens(value)].filter(token => !skip.has(token));
  const found = [...factTokens(evidence)].filter(token => !skip.has(token));
  return wanted.length > 0 && wanted.some(token => found.some(candidate => relatedToken(token, candidate)));
}

export function evidenceMentionsActor(state: ChronicleState, who: string, evidence: string): boolean {
  return actorLabels(state, who).some(label => includesNormalized(evidence, label));
}

export function evidenceHasAccessPath(evidence: string): boolean {
  return ACCESS.test(evidence);
}

export function activityNeedsAccessPath(activity: string): boolean {
  return EPISTEMIC_ACTIVITY.test(activity);
}

/** Proves that one clause is actually about this actor, at this place, doing
 * this activity. This is deliberately stricter than merely finding the quote. */
export function evidenceGroundsActorActivity(state: ChronicleState, who: string, where: string, activity: string, evidence: string): boolean {
  const labels = actorLabels(state, who);
  if (!labels.some(label => includesNormalized(evidence, label))) return false;
  if (!where || !includesNormalized(evidence, where)) return false;
  if (!contentGrounded(activity, evidence, [...labels, where])) return false;
  return !activityNeedsAccessPath(activity) || evidenceHasAccessPath(evidence);
}

export function evidenceGroundsMove(state: ChronicleState, who: string, destination: string, evidence: string): boolean {
  return evidenceMentionsActor(state, who, evidence) && includesNormalized(evidence, destination) && MOVE.test(evidence);
}

export function evidenceGroundsActorResolution(state: ChronicleState, who: string, evidence: string): boolean {
  return evidenceMentionsActor(state, who, evidence) && RESOLVE.test(evidence);
}

export function evidenceGroundsWorldActivity(where: string | undefined, activity: string, evidence: string): boolean {
  if (where && !includesNormalized(evidence, where)) return false;
  return contentGrounded(activity, evidence, where ? [where] : []);
}

export function evidenceGroundsWorldMove(destination: string, evidence: string): boolean {
  return !!destination && includesNormalized(evidence, destination) && MOVE.test(evidence);
}

export function evidenceGroundsWorldResolution(where: string | undefined, evidence: string): boolean {
  return (!where || includesNormalized(evidence, where)) && RESOLVE.test(evidence);
}

/** Canonical active subplot state is the only non-prose source allowed to seed
 * an inline/current parallel row. It already belongs to the append-only log. */
export function subplotGroundsActorActivity(state: ChronicleState, who: string, where: string, activity: string): boolean {
  const id = canonId(who);
  return state.offscreen.some(row => row.status === 'active' && row.who && canonId(row.who) === id
    && !!row.where && sameLocation(row.where, where) && !!row.gist
    && contentGrounded(activity, row.gist, [...actorLabels(state, who), where]));
}

function sameActivity(a?: string, b?: string): boolean {
  return String(a ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
    === String(b ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/** Conservative guard for model-authored inline snapshots and repaired blocks.
 * Existing rows survive omission or an unsupported rewrite. Explicit [] remains
 * the intentional replace-all clear operation. */
export function reconcileParallelSnapshot(
  state: ChronicleState,
  incoming: readonly ParallelDraft[],
  finalPresent: readonly string[],
  prose = '',
  options: ParallelReconcileOptions = {},
): ParallelDraft[] {
  if (incoming.length === 0) return [];
  const here = new Set(finalPresent.map(canonId));
  const priorActors = new Map(state.parallel.filter(row => row.who).map(row => [canonId(row.who!), row]));
  const resultActors = new Map<string, ParallelDraft>();
  const incomingActors = new Map<string, ParallelDraft>();
  const priorWorld = state.parallel.filter(row => !row.who).map(row => ({ ...(row.where ? { where: row.where } : {}), activity: row.activity, ...(row.note ? { note: row.note } : {}) }));
  const incomingWorld: ParallelDraft[] = [];
  for (const row of incoming) {
    if (!row.activity?.trim()) continue;
    if (!row.who) { incomingWorld.push(row); continue; }
    incomingActors.set(canonId(row.who), row); // last T1 row wins
  }

  for (const [id, old] of priorActors) if (!here.has(id)) resultActors.set(id, { who: id, ...(old.where ? { where: old.where } : {}), activity: old.activity, ...(old.note ? { note: old.note } : {}) });
  for (const [id, row] of incomingActors) {
    if (!id || here.has(id) || !row.where?.trim()) continue;
    const old = priorActors.get(id);
    const actor = state.cast[id];
    if (!actor && !evidenceMentionsActor(state, row.who!, prose)) continue;
    const known = canonicalActorLocation(state, id);
    const moved = !!known && !sameLocation(known.where, row.where);
    const autonomous = options.npcAutonomy === 'autonomous' && !!actor;
    if (moved && !evidenceGroundsMove(state, id, row.where, prose) && !(autonomous && MOVE.test(row.activity))) continue;
    const unchanged = !!old && sameLocation(old.where, row.where) && sameActivity(old.activity, row.activity);
    const peerDeliveredAccess = [...incomingActors.entries()].some(([peerId, peer]) => peerId !== id
      && sameLocation(peer.where, row.where)
      && evidenceMentionsActor(state, id, peer.activity)
      && evidenceHasAccessPath(peer.activity));
    const knowledgeOkay = !activityNeedsAccessPath(row.activity)
      || NEGATIVE_KNOWLEDGE.test(row.activity)
      || evidenceHasAccessPath(row.activity)
      || peerDeliveredAccess;
    // At Autonomous, a known absent NPC may originate an ordinary off-screen
    // act. This does not authorize teleportation, high-impact irreversible
    // outcomes, omniscient knowledge, or putting an on-stage actor elsewhere.
    const autonomySupported = autonomous && !HIGH_IMPACT.test(row.activity) && knowledgeOkay;
    const supported = unchanged
      || evidenceGroundsActorActivity(state, id, row.where, row.activity, prose)
      || subplotGroundsActorActivity(state, id, row.where, row.activity)
      || autonomySupported;
    if (!supported) continue;
    resultActors.set(id, { who: id, where: row.where, activity: row.activity, ...(row.note ? { note: row.note } : {}) });
  }

  const world = [...priorWorld];
  for (const row of incomingWorld) {
    const exact = world.findIndex(old => sameLocation(old.where, row.where) && sameActivity(old.activity, row.activity));
    if (exact >= 0) {
      const previous = world[exact]!;
      world[exact] = { ...previous, ...(row.note ? { note: row.note } : {}) };
      continue;
    }
    const locationOkay = !row.where || includesNormalized(prose, row.where);
    if (!locationOkay || !contentGrounded(row.activity, prose, row.where ? [row.where] : [])) continue;
    // Anonymous rows lack ids. When exactly one prior row owns the same place,
    // treat a grounded T1 row as its replacement instead of keeping a stale T0
    // activity beside it. Ambiguous same-place rows remain separate.
    const samePlace = row.where
      ? world.map((old, index) => ({ old, index })).filter(({ old }) => sameLocation(old.where, row.where))
      : [];
    if (samePlace.length === 1) world[samePlace[0]!.index] = { ...(row.where ? { where: row.where } : {}), activity: row.activity, ...(row.note ? { note: row.note } : {}) };
    else world.push(row);
  }
  return [...world, ...resultActors.values()];
}
