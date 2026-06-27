import { type Result, Ok, Err, tryCatchAsync } from '../core/result.js';
import { has } from './capability.js';

declare const spindle: any;

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
): Promise<Result<string, string>> {
  if (!(await has('generation'))) return Err('no_generation_permission');
  if (!(spindle.generate && (spindle.generate.raw || spindle.generate.quiet))) return Err('no_generate_api');
  const req = { messages, parameters: params || {}, userId };
  return tryCatchAsync(async () => {
    const r = spindle.generate.quiet
      ? await spindle.generate.quiet(req)
      : await spindle.generate.raw(req);
    const text = typeof r === 'string' ? r : (r?.content ?? r?.text ?? r?.message?.content ?? '');
    return String(text || '');
  });
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
): Promise<Result<string, string>> {
  if (!(await has('generation'))) return Err('no_generation_permission');
  if (!(spindle.generate && (spindle.generate.raw || spindle.generate.quiet))) return Err('no_generate_api');
  const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
  const req = { messages, parameters: { max_tokens: 200, temperature: 0 }, reasoning: { source: 'off' as const }, userId, ...(signal ? { signal } : {}) };
  return tryCatchAsync(async () => {
    const r = spindle.generate.quiet
      ? await spindle.generate.quiet(req)
      : await spindle.generate.raw(req);
    const text = typeof r === 'string' ? r : (r?.content ?? r?.text ?? r?.message?.content ?? '');
    return String(text || '');
  });
}

export { Ok, Err };
