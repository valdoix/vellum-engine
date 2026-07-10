import { type Result, Ok, Err, tryCatchAsync } from '../core/result.js';
import { has } from './capability.js';

declare const spindle: any;

/** Pull generated text from whichever channel it lands in. `reasoning: off`
 * doesn't cover every provider (OpenRouter etc. still think), so the answer can
 * arrive in the reasoning / reasoning_details channel instead of `content`.
 * Mirrors legacy extractGenContent — without this, summaries come back empty or
 * truncated when the model reasons. */
export function extractGenContent(r: any): string {
  if (!r) return '';
  if (typeof r === 'string') return r;
  const pick = (v: unknown): string => (typeof v === 'string' && v.trim() ? v : '');
  let c = pick(r.content) || pick(r.message?.content) || pick(r.text);
  if (c) return c;
  c = pick(r.reasoning) || pick(r.reasoning_content);
  if (c) return c;
  const rd = r.reasoning_details || r.reasoningDetails;
  if (Array.isArray(rd)) {
    const joined = rd.map((d: any) => (d && (d.text || d.summary || d.content)) || '').filter(Boolean).join('\n');
    if (joined.trim()) return joined;
  }
  return '';
}

/**
 * Host text generation for internal tasks (summarization). Uses the user's
 * connection via spindle.generate.raw / .quiet, mirroring the legacy path.
 * Permission-gated on `generation`; returns a typed error instead of throwing.
 */
export interface GenMsg { role: 'system' | 'user' | 'assistant'; content: string }

/**
 * Bound a promise by wall-clock time INDEPENDENT of AbortSignal. Some hosts do
 * not honor the `signal` we pass to `spindle.generate`, so a stalled provider
 * would otherwise hang the await forever (fatal on the interceptor hot path).
 * On expiry this rejects; the surrounding tryCatchAsync surfaces it as an Err so
 * callers fall back. `signal` is still passed to the host as a best-effort tear-
 * down, but correctness no longer depends on the host obeying it.
 */
export function withTimeout<T>(p: Promise<T>, timeoutMs: number, label = 'generate'): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e as Error); },
    );
  });
}

export async function internalGenerate(
  messages: GenMsg[],
  params: Record<string, unknown>,
  userId: string | null,
  opts?: { reasoningOff?: boolean; responseFormat?: Record<string, unknown>; connectionId?: string; timeoutMs?: number },
): Promise<Result<string, string>> {
  if (!(await has('generation'))) return Err('no_generation_permission');
  if (!(spindle.generate && (spindle.generate.raw || spindle.generate.quiet))) return Err('no_generate_api');
  // Disable extended thinking for internal tasks by default: on a reasoning model
  // the token budget is otherwise spent on hidden thinking and `content` comes
  // back empty, which silently drops us to the structural fallback. Callers that
  // escalate a failed attempt pass reasoningOff:false so the answer is allowed to
  // land in the reasoning channel that extractGenContent already harvests.
  // `responseFormat` (json_schema) is now ENFORCED when the host grants the
  // generation_parameters permission, cutting malformed-JSON extraction failures.
  // Without the permission, we still parse defensively downstream as before.
  const wantSchema = !!opts?.responseFormat && (await has('generation_parameters'));
  const params2 = wantSchema
    ? { ...(params || {}), response_format: opts!.responseFormat }
    : (params || {});
  // Resolve the user's connection so internal tasks run on the SAME model the
  // user chats with (smarter summaries). `quiet` already follows the active
  // connection; passing connection_id also fixes the `raw` fallback, which would
  // otherwise have no provider/model. Caller may pin a specific connection.
  const connId = opts?.connectionId ?? (await defaultConnectionId(userId));
  // Bounded wall-clock: internal tasks run detached, but a provider that stalls
  // must not hang the summarize/extract/sim pass indefinitely. Generous by
  // default (these are background jobs); on timeout the upstream request is torn
  // down and tryCatchAsync surfaces the abort as an Err so callers fall back.
  const timeoutMs = opts?.timeoutMs;
  const signal = timeoutMs && typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
  const req = { messages, parameters: params2, userId, ...(connId ? { connection_id: connId } : {}), ...(signal ? { signal } : {}), ...(opts?.reasoningOff !== false ? { reasoning: { source: 'off' as const } } : {}) };
  return tryCatchAsync(async () => {
    const call = spindle.generate.quiet
      ? spindle.generate.quiet(req)
      : spindle.generate.raw(req);
    // Enforce the deadline ourselves — don't trust the host to honor `signal`.
    const r = timeoutMs ? await withTimeout(call, timeoutMs, 'internalGenerate') : await call;
    return extractGenContent(r);
  });
}

// The user's default connection id, cached per user (the model they actually
// chat with). Lets internal tasks pin the real connection instead of defaulting.
const _connCache = new Map<string, string>();

/** Drop the cached default-connection id (all users, or one). Call when the
 * active chat or permissions change, so a user who switched their default
 * connection mid-session doesn't keep running internal tasks on the stale one. */
export function invalidateConnCache(userId?: string | null): void {
  if (userId === undefined) { _connCache.clear(); return; }
  _connCache.delete(userId ?? '_');
}

async function defaultConnectionId(userId: string | null): Promise<string> {
  const key = userId ?? '_';
  const hit = _connCache.get(key);
  if (hit !== undefined) return hit;
  let id = '';
  try {
    const list = await spindle.connections?.list?.(userId ?? undefined);
    if (Array.isArray(list) && list.length) id = (list.find((c: any) => c?.is_default) ?? list[0])?.id ?? '';
  } catch { /* connections API optional */ }
  _connCache.set(key, id);
  return id;
}

/**
 * CONTROLLER call for guided retrieval (traversal, variant A). A cheap, fast,
 * thinking-OFF generation under a HARD wall-clock timeout — it runs on the
 * synchronous interceptor path, so it must never block prompt assembly. On
 * timeout the upstream request is torn down (AbortSignal) and we return Err so
 * the caller falls back to the deterministic ranking.
 */
export async function controllerGenerate(
  messages: GenMsg[],
  userId: string | null,
  timeoutMs = 1500,
  maxTokens = 200,
): Promise<Result<string, string>> {
  if (!(await has('generation'))) return Err('no_generation_permission');
  if (!(spindle.generate && (spindle.generate.raw || spindle.generate.quiet))) return Err('no_generate_api');
  const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
  const connId = await defaultConnectionId(userId); // run on the user's own model
  const req = { messages, parameters: { max_tokens: maxTokens, temperature: 0 }, reasoning: { source: 'off' as const }, userId, ...(connId ? { connection_id: connId } : {}), ...(signal ? { signal } : {}) };
  return tryCatchAsync(async () => {
    const call = spindle.generate.quiet
      ? spindle.generate.quiet(req)
      : spindle.generate.raw(req);
    // Hard wall-clock deadline independent of AbortSignal — this runs on the
    // synchronous interceptor path and must never block prompt assembly.
    const r = await withTimeout(call, timeoutMs, 'controllerGenerate');
    // Read reasoning channels too: on providers that ignore `reasoning: off`, the
    // reply lands in reasoning/reasoning_details, not content — a content-only
    // read here silently no-ops the off-screen sim (parseSim('') → null).
    return extractGenContent(r);
  });
}

export { Ok, Err };
