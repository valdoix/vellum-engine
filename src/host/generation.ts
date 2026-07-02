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

export async function internalGenerate(
  messages: GenMsg[],
  params: Record<string, unknown>,
  userId: string | null,
  opts?: { reasoningOff?: boolean; responseFormat?: Record<string, unknown>; connectionId?: string },
): Promise<Result<string, string>> {
  if (!(await has('generation'))) return Err('no_generation_permission');
  if (!(spindle.generate && (spindle.generate.raw || spindle.generate.quiet))) return Err('no_generate_api');
  // Disable extended thinking for internal tasks by default: on a reasoning model
  // the token budget is otherwise spent on hidden thinking and `content` comes
  // back empty, which silently drops us to the structural fallback.
  // `responseFormat` (json_schema) is best-effort: the host strips it without the
  // generation_parameters permission, so we still parse defensively downstream.
  const params2 = opts?.responseFormat ? { ...(params || {}), response_format: opts.responseFormat } : (params || {});
  // Resolve the user's connection so internal tasks run on the SAME model the
  // user chats with (smarter summaries). `quiet` already follows the active
  // connection; passing connection_id also fixes the `raw` fallback, which would
  // otherwise have no provider/model. Caller may pin a specific connection.
  const connId = opts?.connectionId ?? (await defaultConnectionId(userId));
  const req = { messages, parameters: params2, userId, ...(connId ? { connection_id: connId } : {}), ...(opts?.reasoningOff !== false ? { reasoning: { source: 'off' as const } } : {}) };
  return tryCatchAsync(async () => {
    const r = spindle.generate.quiet
      ? await spindle.generate.quiet(req)
      : await spindle.generate.raw(req);
    return extractGenContent(r);
  });
}

// The user's default connection id, cached per user (the model they actually
// chat with). Lets internal tasks pin the real connection instead of defaulting.
const _connCache = new Map<string, string>();
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
    const r = spindle.generate.quiet
      ? await spindle.generate.quiet(req)
      : await spindle.generate.raw(req);
    // Read reasoning channels too: on providers that ignore `reasoning: off`, the
    // reply lands in reasoning/reasoning_details, not content — a content-only
    // read here silently no-ops the off-screen sim (parseSim('') → null).
    return extractGenContent(r);
  });
}

export { Ok, Err };
