/** Per-task model routing for VELLUM background work. Connection profiles stay
 * owned by Lumiverse; VELLUM stores only safe profile ids and bounded knobs. */

export const TASK_ROLES = [
  'engine', 'engineRetry', 'summaryDetail', 'summaryGist', 'recall',
  'offscreen', 'extractor', 'blockRepair', 'reconstruction', 'maintenance',
] as const;

export type TaskRole = typeof TASK_ROLES[number];
export type RouteSource = 'main' | 'default' | 'connection';
export type ReasoningMode = 'off' | 'inherit' | 'low' | 'medium' | 'high';

export interface TaskRoute {
  source: RouteSource;
  connectionId?: string;
  fallbackIds?: string[];
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
  retries?: number;
  reasoning?: ReasoningMode;
  schema?: boolean;
}

export interface ModelRouteConfig {
  version: 1;
  routes: Partial<Record<TaskRole, TaskRoute>>;
}

export const DEFAULT_MODEL_ROUTES: ModelRouteConfig = { version: 1, routes: {} };

const PARENTS: Partial<Record<TaskRole, TaskRole>> = {
  engineRetry: 'engine', summaryGist: 'summaryDetail', extractor: 'blockRepair',
};

function finite(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function sanitizeTaskRoute(raw: unknown): TaskRoute {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const source: RouteSource = o.source === 'connection' || o.source === 'default' ? o.source : 'main';
  const connectionId = String(o.connectionId ?? '').trim();
  const fallbackIds = Array.isArray(o.fallbackIds)
    ? [...new Set(o.fallbackIds.map(String).map((x) => x.trim()).filter(Boolean))].slice(0, 4)
    : undefined;
  const maxTokens = finite(o.maxTokens);
  const timeoutMs = finite(o.timeoutMs);
  const temperature = finite(o.temperature);
  const retries = finite(o.retries);
  const reasoning: ReasoningMode = o.reasoning === 'inherit' || o.reasoning === 'low'
    || o.reasoning === 'medium' || o.reasoning === 'high' ? o.reasoning : 'off';
  return {
    source,
    ...(source === 'connection' && connectionId ? { connectionId } : {}),
    ...(fallbackIds?.length ? { fallbackIds } : {}),
    ...(maxTokens !== undefined ? { maxTokens: Math.round(Math.max(64, Math.min(128000, maxTokens))) } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs: Math.round(Math.max(1000, Math.min(900000, timeoutMs))) } : {}),
    ...(temperature !== undefined ? { temperature: Math.max(0, Math.min(2, temperature)) } : {}),
    ...(retries !== undefined ? { retries: Math.round(Math.max(0, Math.min(8, retries))) } : {}),
    reasoning,
    ...(typeof o.schema === 'boolean' ? { schema: o.schema } : {}),
  };
}

export function sanitizeModelRoutes(raw: unknown): ModelRouteConfig {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const source = o.routes && typeof o.routes === 'object' ? o.routes as Record<string, unknown> : o;
  const routes: Partial<Record<TaskRole, TaskRoute>> = {};
  for (const role of TASK_ROLES) if (source[role] && typeof source[role] === 'object') routes[role] = sanitizeTaskRoute(source[role]);
  return { version: 1, routes };
}

/** Chat settings win over personal defaults. Child roles inherit a parent only
 * when they have no explicit route at either scope. */
export function resolveTaskRoute(role: TaskRole, personal: ModelRouteConfig, chat: ModelRouteConfig): TaskRoute {
  const direct = chat.routes[role] ?? personal.routes[role];
  if (direct) return sanitizeTaskRoute(direct);
  const parent = PARENTS[role];
  if (parent) return sanitizeTaskRoute(chat.routes[parent] ?? personal.routes[parent] ?? { source: 'main' });
  return sanitizeTaskRoute({ source: 'main' });
}

export function generationReasoning(route: TaskRoute): { source: 'off' } | { source: 'inherit' } | { source: 'custom'; apiReasoning: true; effort: 'low' | 'medium' | 'high' } {
  if (route.reasoning === 'inherit') return { source: 'inherit' };
  if (route.reasoning === 'low' || route.reasoning === 'medium' || route.reasoning === 'high') {
    return { source: 'custom', apiReasoning: true, effort: route.reasoning };
  }
  return { source: 'off' };
}
