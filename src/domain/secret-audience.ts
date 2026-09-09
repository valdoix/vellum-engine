import { canonId } from '../core/ids.js';
import { notAName } from './identity.js';
import type { ChronicleState } from './types.js';

/** Individual audience tracking stays bounded. Large social groups belong in
 * factions; repeating a name can never add information and used to let one bad
 * compiler row consume the entire output budget. */
export const SECRET_AUDIENCE_LIMIT = 32;

function values(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split(',');
  return [];
}

/** Canonicalize a secret audience without inventing identities. The keeper
 * already knows their own secret, placeholders are not people, and recipients
 * who learned it cannot remain in the hidden audience. */
export function normalizeSecretAudience(keeper: string, raw: unknown, exclude: readonly string[] = []): string[] {
  const keeperId = canonId(keeper);
  const excluded = new Set(exclude.map(canonId).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values(raw)) {
    const label = String(value ?? '').trim();
    const id = canonId(label);
    if (!id || id === keeperId || excluded.has(id) || seen.has(id) || notAName(label)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= SECRET_AUDIENCE_LIMIT) break;
  }
  return out;
}

/** Replaying an older event log through current code repairs polluted audience
 * arrays in derived state while leaving the append-only source log intact. */
export function repairSecretAudiences(state: ChronicleState): ChronicleState {
  let changed = false;
  const secrets = state.secrets.map(secret => {
    const revealedTo = normalizeSecretAudience(secret.keeper, secret.revealedTo ?? []);
    const from = normalizeSecretAudience(secret.keeper, secret.from ?? [], revealedTo);
    const same = from.length === secret.from.length && from.every((id, index) => id === secret.from[index])
      && revealedTo.length === (secret.revealedTo ?? []).length && revealedTo.every((id, index) => id === secret.revealedTo[index]);
    if (same) return secret;
    changed = true;
    return { ...secret, from, revealedTo };
  });
  return changed ? { ...state, secrets } : state;
}
