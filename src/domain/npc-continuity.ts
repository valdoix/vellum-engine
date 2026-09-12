import type { ChronicleState } from './types.js';
import { canonId } from '../core/ids.js';

/** Compact private direction for on-stage NPCs. Stable identity, current affect,
 * and executable intent remain distinct so a mood swing cannot rewrite a person
 * and a goal cannot become a guaranteed outcome. */
export function npcContinuityInjection(state: ChronicleState, presentIds: readonly string[], playerId = '', cap = 8): string {
  const player = canonId(playerId);
  const rows: string[] = [];
  for (const raw of presentIds) {
    const id = canonId(raw); const actor = state.cast[id];
    if (!actor || id === player) continue;
    const detail = state.scene.detail.find(row => canonId(row.id) === id);
    const parts: string[] = [];
    if (detail?.presence) parts.push(detail.presence);
    if (actor.traits?.length) parts.push(`stable: ${actor.traits.slice(0, 6).join(', ')}`);
    if (actor.introduction) parts.push(`identity: ${actor.introduction.role}; wants ${actor.introduction.want}; constrained by ${actor.introduction.constraint}; counter-trait ${actor.introduction.counterTrait}; voice ${actor.introduction.voiceTell}`);
    if (actor.intent) parts.push(`intent (${actor.intent.status}): ${actor.intent.goal}; next ${actor.intent.nextStep}${actor.intent.constraints.length ? `; limits ${actor.intent.constraints.join(', ')}` : ''}${actor.intent.destination ? `; destination ${actor.intent.destination}` : ''}`);
    if (actor.affect) parts.push(`affect v${actor.affect.valence}/a${actor.affect.arousal}/c${actor.affect.control} toward ${actor.affect.direction}${actor.affect.cause ? ` because ${actor.affect.cause}` : ''}`);
    if (parts.length) rows.push(`- ${actor.name}: ${parts.join(' | ')}`);
    if (rows.length >= cap) break;
  }
  if (!rows.length) return '';
  return '[NPC CONTINUITY — NPCs keep their own aims, knowledge limits, loyalties, fears, schedules, and capacity to disagree, refuse, bargain, leave, help, lie, or fail. Treat intent as pressure, never guaranteed success or permission to control the player. Affect changes expression and tactics, not stable identity, consent, or access. Spotlight is earned by this beat; periphery characters need not speak.]\n' + rows.join('\n');
}
