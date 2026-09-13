import { canonId } from '../core/ids.js';
import { sameTrack } from '../core/reduce.js';

export interface PlotRefRow { id: string; name: string }

function refKey(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
}

function slugKey(value: unknown): string {
  return canonId(String(value ?? '')).replace(/^(?:thr|thread|arc|plot)_+/, '');
}

/** Resolve the spellings produced by both the model and the reducer. Plot ids
 * are engine-owned (`thr_*` for both arrays), while models often use `arc_*`,
 * `thread_*`, a bare slug, or the human title. Those are format aliases, not
 * fuzzy semantic guesses. */
export function resolvePlotRef<T extends PlotRefRow>(rows: readonly T[], raw: unknown): T | undefined {
  const exact = refKey(raw);
  if (!exact) return undefined;
  const exactMatch = rows.find(row => refKey(row.id) === exact || refKey(row.name) === exact);
  if (exactMatch) return exactMatch;
  const slug = slugKey(raw);
  if (!slug) return undefined;
  const slugMatches = rows.filter(row => slugKey(row.id) === slug || slugKey(row.name) === slug);
  if (slugMatches.length === 1) return slugMatches[0];
  const title = String(raw ?? '').replace(/^(?:thr|thread|arc|plot)[_:\s-]+/i, '').replace(/_/g, ' ').trim();
  const titleMatches = rows.filter(row => sameTrack(row.name, title));
  return titleMatches.length === 1 ? titleMatches[0] : undefined;
}

export function plotRefMatches(row: { id?: unknown; name?: unknown }, raw: unknown): boolean {
  const probe: PlotRefRow = { id: String(row.id ?? ''), name: String(row.name ?? '') };
  return !!resolvePlotRef([probe], raw);
}
