/**
 * Context budget — PURE (no I/O). One place to control how much VELLUM injects
 * per turn. A master preset (lean/balanced/rich) scales every injector cap
 * together; 'custom' exposes per-injector caps + off switches. Also carries the
 * off-screen sim interval and the auto-summarize threshold (they're all "how the
 * engine spends the turn"). Persisted as one per-chat chat var `vellum_budget`.
 *
 * `balanced` == the historical hardcoded defaults, so an unset chat is unchanged.
 */

export type BudgetPreset = 'lean' | 'balanced' | 'rich' | 'custom';

export interface ContextBudget {
  preset: BudgetPreset;
  // per-injector caps (used when preset === 'custom'); 0 disables that injector
  spine: number; locations: number; drift: number; mood: number; locks: number; plants: number; offscreen: number;
  recallDepth: number;      // memories the retrieval layer injects (topK)
  // whole-system inject toggles (custom only) — tracked-but-not-injected
  injectDrift: boolean; injectMood: boolean; injectPlants: boolean; injectLocations: boolean; injectOffscreen: boolean;
  // pacing knobs that live here too
  simInterval: number;      // off-screen sim runs every N turns (0 = never)
  autoSummaryAt: number;    // turn-memories before auto-summarize kicks in
}

export interface ResolvedCaps {
  spine: number; locations: number; drift: number; mood: number; locks: number; plants: number; offscreen: number;
  recallDepth: number; simInterval: number; autoSummaryAt: number;
}

// balanced == today's hardcoded defaults (spine 14, locations 12, drift/locks/
// plants 6, mood 5; offscreen 3; recall 12; sim every 4; summary at 16).
const PRESET_CAPS: Record<'lean' | 'balanced' | 'rich', ResolvedCaps> = {
  lean: { spine: 6, locations: 6, drift: 3, mood: 3, locks: 4, plants: 3, offscreen: 2, recallDepth: 6, simInterval: 6, autoSummaryAt: 16 },
  balanced: { spine: 14, locations: 12, drift: 6, mood: 5, locks: 6, plants: 6, offscreen: 3, recallDepth: 12, simInterval: 4, autoSummaryAt: 16 },
  rich: { spine: 24, locations: 20, drift: 10, mood: 8, locks: 10, plants: 10, offscreen: 5, recallDepth: 18, simInterval: 3, autoSummaryAt: 12 },
};

export const DEFAULT_BUDGET: ContextBudget = {
  preset: 'balanced',
  ...PRESET_CAPS.balanced,
  injectDrift: true, injectMood: true, injectPlants: true, injectLocations: true, injectOffscreen: true,
};

const RANGES: Record<string, [number, number]> = {
  spine: [0, 40], locations: [0, 40], drift: [0, 20], mood: [0, 20], locks: [0, 20], plants: [0, 20], offscreen: [0, 20],
  recallDepth: [0, 40], simInterval: [0, 20], autoSummaryAt: [4, 100],
};
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
function num(v: unknown, def: number, key: string): number {
  const n = typeof v === 'number' && isFinite(v) ? v : Number(v);
  const [lo, hi] = RANGES[key] ?? [0, 100];
  return isFinite(n) ? clamp(Math.round(n), lo, hi) : def;
}

/** Validate/clamp an untrusted budget blob. Never throws. */
export function sanitizeBudget(raw: unknown): ContextBudget {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const preset: BudgetPreset = (['lean', 'balanced', 'rich', 'custom'] as const).includes(o.preset as BudgetPreset) ? o.preset as BudgetPreset : 'balanced';
  const d = DEFAULT_BUDGET;
  const bool = (v: unknown, def: boolean): boolean => (v === undefined ? def : !!v);
  return {
    preset,
    spine: num(o.spine, d.spine, 'spine'), locations: num(o.locations, d.locations, 'locations'),
    drift: num(o.drift, d.drift, 'drift'), mood: num(o.mood, d.mood, 'mood'),
    locks: num(o.locks, d.locks, 'locks'), plants: num(o.plants, d.plants, 'plants'),
    offscreen: num(o.offscreen, d.offscreen, 'offscreen'), recallDepth: num(o.recallDepth, d.recallDepth, 'recallDepth'),
    injectDrift: bool(o.injectDrift, true), injectMood: bool(o.injectMood, true), injectPlants: bool(o.injectPlants, true),
    injectLocations: bool(o.injectLocations, true), injectOffscreen: bool(o.injectOffscreen, true),
    simInterval: num(o.simInterval, d.simInterval, 'simInterval'), autoSummaryAt: num(o.autoSummaryAt, d.autoSummaryAt, 'autoSummaryAt'),
  };
}

/** Resolve a config into concrete caps. A preset maps to its table (with the
 * chat's simInterval/autoSummaryAt overrides honored); 'custom' uses the fields,
 * and an off toggle forces that injector's cap to 0. */
export function resolveBudget(cfg: ContextBudget): ResolvedCaps {
  if (cfg.preset !== 'custom') {
    const base = PRESET_CAPS[cfg.preset];
    // sim interval + auto-summary threshold are always user-overridable
    return { ...base, simInterval: cfg.simInterval, autoSummaryAt: cfg.autoSummaryAt };
  }
  return {
    spine: cfg.spine,
    locations: cfg.injectLocations ? cfg.locations : 0,
    drift: cfg.injectDrift ? cfg.drift : 0,
    mood: cfg.injectMood ? cfg.mood : 0,
    locks: cfg.locks,
    plants: cfg.injectPlants ? cfg.plants : 0,
    offscreen: cfg.injectOffscreen ? cfg.offscreen : 0,
    recallDepth: cfg.recallDepth,
    simInterval: cfg.simInterval,
    autoSummaryAt: cfg.autoSummaryAt,
  } as ResolvedCaps;
}
