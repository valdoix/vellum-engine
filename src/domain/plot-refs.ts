import { canonId } from '../core/ids.js';
import { sameTrack } from '../core/reduce.js';
import type { ChronicleState, OffscreenThread, Track } from './types.js';

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

function clean(value: unknown, limit: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function statusOf(row: Track | OffscreenThread): string {
  return clean(row.status, 24).toLowerCase() || 'active';
}

function active(row: Track | OffscreenThread): boolean {
  return !/^(?:resolved|complete|completed|closed|done|retired)$/i.test(statusOf(row));
}

function latestBeat(row: Track | OffscreenThread): string {
  if ('gist' in row && row.gist) return clean(row.gist, 240);
  return clean(row.beats?.[row.beats.length - 1], 240);
}

/**
 * Build the canonical plot ledger used before every generation. This is
 * intentionally compact, but includes every active plot object so the model
 * can reuse an existing row instead of minting a renamed duplicate.
 */
export function plotStateInjection(state: ChronicleState, cap = 120): string {
  const arcs = (state.arcs ?? []).filter(active);
  const threads = (state.threads ?? []).filter(active);
  const subplots = (state.offscreen ?? []).filter(active);
  if (!arcs.length && !threads.length && !subplots.length) return '';

  const lines: string[] = [
    '[CANONICAL PLOT LEDGER — READ BEFORE WRITING THREADS, ARCS, OR SUBPLOTS]',
    'These are the current durable plot objects. Reuse the exact existing id/title and emit advance, stall, or resolve when the new beat belongs to one of them.',
    'Do not create a new arc, thread, or subplot whose subject, actor, location, conflict, goal, or consequence substantially overlaps an existing row. A new title is not a new plot.',
    'If one event belongs to an existing row, update that row only. Keep one parent arc per thread and one stable subplot id per off-screen situation. Never create a thread with the same or near-equivalent title as an arc.',
  ];
  const append = (kind: string, rows: Array<Track | OffscreenThread>, format: (row: Track | OffscreenThread) => string): void => {
    if (!rows.length) return;
    lines.push(`[${kind}]`);
    for (const row of rows.slice(0, Math.max(0, cap - lines.length))) lines.push(format(row));
  };
  append('ARCS', arcs, row => `- id=${row.id} | title=${clean(row.name, 90)} | latest=${latestBeat(row) || 'none'}`);
  append('THREADS', threads, row => {
    const thread = row as Track;
    return `- id=${thread.id} | title=${clean(thread.name, 90)} | arc=${thread.arc || 'none'} | latest=${latestBeat(thread) || 'none'}`;
  });
  append('SUBPLOTS', subplots, row => {
    const subplot = row as OffscreenThread;
    return `- id=${subplot.id} | title=${clean(subplot.name, 90)} | thread=${subplot.thread || 'none'} | arc=${(subplot as OffscreenThread & { arc?: string }).arc || 'none'} | actor=${subplot.who || 'none'} | where=${clean(subplot.where, 100) || 'none'} | latest=${latestBeat(subplot) || 'none'}`;
  });
  return lines.join('\n');
}
