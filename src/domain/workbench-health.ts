import type { ChronicleState } from './types.js';

export type HealthSeverity = 'ok' | 'info' | 'warning' | 'error';
export interface HealthFinding { code: string; severity: HealthSeverity; count: number; message: string }
export interface WorkbenchHealth { score: number; findings: HealthFinding[]; counts: Record<string, number> }

/** Fast, deterministic integrity audit. It deliberately reports evidence gaps
 * rather than inventing repairs; reconstruction can then reconcile them from
 * the transcript. */
export function auditChronicle(state: ChronicleState): WorkbenchHealth {
  const findings: HealthFinding[] = [];
  const add = (code: string, severity: HealthSeverity, count: number, message: string): void => {
    if (count > 0) findings.push({ code, severity, count, message });
  };
  const cast = new Set(Object.keys(state.cast));
  const present = new Set(state.scene.present ?? []);
  const duplicatePresent = (state.scene.present?.length ?? 0) - present.size;
  add('duplicate_present', 'warning', duplicatePresent, 'Duplicate character ids appear in the current scene.');
  add('unknown_present', 'error', [...present].filter((id) => !cast.has(id)).length, 'The current scene references cast members that do not exist.');
  add('present_elsewhere', 'error', state.parallel.filter((p) => !!p.who && present.has(p.who)).length, 'A character is both present and recorded elsewhere.');
  add('unknown_parallel', 'warning', state.parallel.filter((p) => !!p.who && !cast.has(p.who!)).length, 'Parallel events reference unknown characters.');
  add('unknown_knowledge_owner', 'error', state.knowledge.filter((k) => !cast.has(k.who)).length, 'Knowledge belongs to an unknown character.');
  add('knowledge_without_source', 'warning', state.knowledge.filter((k) => !String(k.source ?? '').trim()).length, 'Knowledge facts are missing a transmission source.');
  add('invalid_secret_keeper', 'error', state.secrets.filter((s) => !cast.has(s.keeper)).length, 'Secrets have an unknown keeper.');
  add('invalid_secret_audience', 'error', state.secrets.reduce((n, s) => n + (s.from ?? []).filter((id) => !cast.has(id)).length, 0), 'Secret audiences contain unknown character ids.');
  add('unknown_item_holder', 'error', state.items.filter((i) => i.who !== 'world' && !cast.has(i.who)).length, 'Items are held by unknown characters.');
  add('unknown_scar_owner', 'error', state.scars.filter((s) => !cast.has(s.who)).length, 'Scars belong to unknown characters.');
  const memoryIds = new Set<string>();
  let duplicateMemories = 0;
  for (const m of state.memories) { if (memoryIds.has(m.id)) duplicateMemories++; else memoryIds.add(m.id); }
  add('duplicate_memory', 'warning', duplicateMemories, 'Archive records reuse the same id.');
  const chapters = state.memories.filter((m) => m.tier === 'chapter' && m.covers).sort((a, b) => a.covers![0] - b.covers![0]);
  let overlaps = 0;
  for (let i = 1; i < chapters.length; i++) if (chapters[i]!.covers![0] <= chapters[i - 1]!.covers![1]) overlaps++;
  add('summary_overlap', 'warning', overlaps, 'Chapter coverage overlaps another chapter.');
  const dayRows = Object.entries(state.turnDays).map(([turn, day]) => [Number(turn), Number(day)] as const).sort((a, b) => a[0] - b[0]);
  let regressions = 0;
  for (let i = 1; i < dayRows.length; i++) if (dayRows[i]![1] < dayRows[i - 1]![1]) regressions++;
  add('day_regression', 'error', regressions, 'Narrative day moves backward between folded turns.');
  add('continuity_flags', 'info', state.continuityFlags.length, 'Continuity warnings are waiting for review.');
  const weighted = findings.reduce((n, f) => n + f.count * (f.severity === 'error' ? 8 : f.severity === 'warning' ? 3 : 1), 0);
  return {
    score: Math.max(0, Math.min(100, 100 - weighted)), findings,
    counts: {
      turns: state.turns, cast: cast.size, knowledge: state.knowledge.length,
      secrets: state.secrets.length, memories: state.memories.length,
      threads: state.threads.length, arcs: state.arcs.length, items: state.items.length,
      parallel: state.parallel.length, flags: state.continuityFlags.length,
    },
  };
}
