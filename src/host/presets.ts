import { type Result, Ok, Err, tryCatchAsync } from '../core/result.js';
import { has } from './capability.js';

declare const spindle: any;

/**
 * The host's optimistic-concurrency conflict code. When a preset update's
 * `expected_cache_revision` no longer matches the stored revision, the host
 * rejects with an Error carrying this `code` (plus `actualCacheRevision`) —
 * see Lumiverse's PresetRevisionConflictError / deserializeWorkerResponseError.
 * We match by literal value (the extension can't import host types).
 */
const PRESET_REVISION_CONFLICT = 'PRESET_REVISION_CONFLICT';

interface RevisionConflict { code?: string; actualCacheRevision?: number }
function asConflict(e: unknown): RevisionConflict | null {
  const c = e as RevisionConflict | undefined;
  if (c && c.code === PRESET_REVISION_CONFLICT) return c;
  // Fallback: some hosts may only preserve the message text.
  if (e instanceof Error && /revision/i.test(e.message) && /current revision/i.test(e.message)) return {};
  return null;
}

/**
 * Merge `vellum_engine` metadata onto a preset WITHOUT round-tripping prompt
 * content, satisfying the host's mandatory optimistic-concurrency precondition
 * (`expected_cache_revision`). Read → merge metadata only → write with the
 * preset's current revision. On a revision conflict (another writer bumped the
 * preset between our read and write) it retries ONCE with the fresh revision.
 */
async function updatePresetMetadata(
  presetId: string,
  meta: Record<string, unknown>,
  userId: string | null,
  knownRevision?: number,
): Promise<void> {
  // Resolve the current metadata + revision. On a retry we already know the
  // authoritative revision from the conflict, but we still re-read so the
  // metadata we merge onto is the freshest (another writer may have changed it).
  const preset = await spindle.presets.get(presetId, userId);
  if (!preset) throw new Error('preset_not_found');
  const revision = knownRevision ?? preset.cache_revision ?? 0;
  // metadata-ONLY patch — never marshal prompts / prompt_order / parameters.
  const metadata = { ...(preset.metadata ?? {}), vellum_engine: meta };
  await spindle.presets.update(presetId, { metadata, expected_cache_revision: revision }, userId);
}

/**
 * Stamp structured metadata onto the active/companion preset so the extension
 * and the preset recognize each other without prose sniffing. The key constraint:
 * attach metadata WITHOUT marshalling prompt content back out — never round-trip
 * the preset's prompt fields.
 *
 * Capability-gated on `presets`. Degrades to Err when the permission is absent
 * or the host API is missing. The host's preset-update contract REQUIRES an
 * `expected_cache_revision`; we read it from the preset and retry once on a
 * revision conflict.
 */
export async function stampPresetMetadata(
  presetId: string,
  meta: Record<string, unknown>,
  userId: string | null,
): Promise<Result<void, string>> {
  if (!(await has('presets'))) return Err('no_presets_permission');
  // Prefer a metadata-only merge API if a future host exposes one; otherwise we
  // need get + update to satisfy the revision precondition.
  if (spindle.presets?.updateMetadata) {
    return tryCatchAsync(async () => {
      await spindle.presets.updateMetadata(presetId, { vellum_engine: meta }, userId);
    });
  }
  if (!spindle.presets?.get || !spindle.presets?.update) return Err('no_presets_api');

  return tryCatchAsync(async () => {
    try {
      await updatePresetMetadata(presetId, meta, userId);
    } catch (e) {
      const conflict = asConflict(e);
      if (!conflict) throw e;
      // Retry ONCE with the host's authoritative revision (or a fresh read).
      await updatePresetMetadata(presetId, meta, userId, conflict.actualCacheRevision);
    }
  });
}

/**
 * Merge a single top-level metadata KEY (e.g. `promptVariables`) onto a preset
 * WITHOUT round-tripping prompt content, satisfying the host's mandatory
 * `expected_cache_revision` precondition and retrying once on a revision
 * conflict. Sibling of stampPresetMetadata (which owns `vellum_engine`); shared
 * so both write paths use the same revision-safe read-modify-write.
 *
 * Capability-gated on `presets`; degrades to Err when the permission or the
 * get/update host API is missing.
 */
export async function updatePresetMetadataKey(
  presetId: string,
  key: string,
  value: unknown,
  userId: string | null,
): Promise<Result<void, string>> {
  if (!(await has('presets'))) return Err('no_presets_permission');
  if (!spindle.presets?.get || !spindle.presets?.update) return Err('no_presets_api');

  const write = async (knownRevision?: number): Promise<void> => {
    const preset = await spindle.presets.get(presetId, userId);
    if (!preset) throw new Error('preset_not_found');
    const revision = knownRevision ?? preset.cache_revision ?? 0;
    const metadata = { ...(preset.metadata ?? {}), [key]: value };
    await spindle.presets.update(presetId, { metadata, expected_cache_revision: revision }, userId);
  };

  return tryCatchAsync(async () => {
    try {
      await write();
    } catch (e) {
      const conflict = asConflict(e);
      if (!conflict) throw e;
      await write(conflict.actualCacheRevision);
    }
  });
}
