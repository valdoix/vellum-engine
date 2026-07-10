import { type Result, Ok, Err, tryCatchAsync } from '../core/result.js';
import { has } from './capability.js';

declare const spindle: any;

/**
 * Stamp structured metadata onto the active/companion preset so the extension
 * and the preset recognize each other without prose sniffing. The key constraint:
 * attach metadata WITHOUT marshalling prompt content back out — never round-trip
 * the preset's prompt fields.
 * 
 * Capability-gated on `presets`. Degrades to Err when the permission is absent
 * or the host API is missing.
 */
export async function stampPresetMetadata(
  presetId: string,
  meta: Record<string, unknown>,
  userId: string | null,
): Promise<Result<void, string>> {
  if (!(await has('presets'))) return Err('no_presets_permission');
  if (!spindle.presets?.updateMetadata && !spindle.presets?.update) return Err('no_presets_api');
  
  return tryCatchAsync(async () => {
    // Prefer a metadata-only merge API if the host exposes one; else read-modify-write
    // the preset's metadata object WITHOUT touching prompt content.
    if (spindle.presets.updateMetadata) {
      await spindle.presets.updateMetadata(presetId, { vellum_engine: meta }, userId);
    } else {
      // Fallback: read the preset, patch only metadata, write back
      const p = await spindle.presets.get(presetId, userId);
      const metadata = { ...(p?.metadata ?? {}), vellum_engine: meta };
      await spindle.presets.update(presetId, { metadata }, userId);
    }
  });
}
