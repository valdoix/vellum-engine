import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { internalGenerate, controllerGenerate, extractGenContent, withTimeout } from '../src/host/generation.js';
import { invalidatePermissions } from '../src/host/capability.js';

// internalGenerate calls the host via globalThis.spindle — stub it to capture
// the outgoing request and assert response_format / reasoning are forwarded.
let lastReq: any = null;
beforeEach(() => {
  invalidatePermissions();
  (globalThis as any).spindle = {
    permissions: { has: async () => true },
    has: async () => true,
    generate: { raw: async (req: any) => { lastReq = req; return { content: '{"knowledge":[]}' }; } },
  };
  // capability.has reads spindle.permissions?.has or spindle.has — cover both
});
afterEach(() => { lastReq = null; invalidatePermissions(); });

describe('internalGenerate — response_format forwarding', () => {
  it('injects response_format when given, and reasoning:off by default', async () => {
    const r = await internalGenerate(
      [{ role: 'user', content: 'x' }],
      { temperature: 0.2 },
      null,
      { reasoningOff: true, responseFormat: { type: 'json_schema', json_schema: { name: 'x', schema: {} } } },
    );
    expect(r.ok).toBe(true);
    expect(lastReq.parameters.response_format?.type).toBe('json_schema');
    expect(lastReq.parameters.temperature).toBe(0.2);
    expect(lastReq.reasoning?.source).toBe('off');
    expect(lastReq.type).toBe('raw');
  });

  it('omits response_format when not requested', async () => {
    await internalGenerate([{ role: 'user', content: 'x' }], {}, null);
    expect(lastReq.parameters.response_format).toBeUndefined();
  });
});

describe('internalGenerate — incremental streaming', () => {
  it('uses the host stream, aggregates content, and labels reasoning separately', async () => {
    const updates: Array<{ type: string; token: string }> = [];
    (globalThis as any).spindle.generate.rawStream = async function* (req: any) {
      lastReq = req;
      yield { type: 'token', token: 'DETAIL:\nA door opened. ' };
      yield { type: 'reasoning', token: 'private thought' };
      yield { type: 'token', token: 'KEYS:\ndoor' };
      yield { type: 'done', content: 'DETAIL:\nA door opened. KEYS:\ndoor', finish_reason: 'stop' };
    };
    const r = await internalGenerate(
      [{ role: 'user', content: 'x' }],
      { max_tokens: 16000 },
      null,
      { onStream: (update) => updates.push(update) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toContain('A door opened');
    expect(updates.filter((u) => u.type === 'content').map((u) => u.token).join('')).toContain('KEYS:');
    expect(updates.find((u) => u.type === 'reasoning')?.token).toBe('private thought');
    expect(lastReq.type).toBe('raw');
    expect(lastReq.parameters.max_tokens).toBe(16000);
  });

  it('lets the live window cancel even when the provider ignores its signal', async () => {
    (globalThis as any).spindle.generate.rawStream = async function* () {
      yield { type: 'token', token: 'partial' };
      await new Promise(() => { /* provider never completes */ });
    };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const r = await internalGenerate(
      [{ role: 'user', content: 'x' }], {}, null,
      { signal: controller.signal, onStream: () => {} },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/aborted/i);
  });
});

describe('extractGenContent — recovers text from reasoning channels', () => {
  it('reads reasoning_details when content is empty', () => {
    const r = { content: '', reasoning_details: [{ text: '{"offscreen":[]}' }] };
    expect(extractGenContent(r)).toBe('{"offscreen":[]}');
  });
  it('prefers content when present', () => {
    expect(extractGenContent({ content: 'real', reasoning: 'thinking' })).toBe('real');
  });
});

describe('controllerGenerate — reasoning-channel + maxTokens', () => {
  it('recovers a reply that landed in reasoning, not content', async () => {
    (globalThis as any).spindle.generate.raw = async (req: any) => { lastReq = req; return { content: '', reasoning: '{"offscreen":[{"op":"new","id":"x","gist":"y"}]}' }; };
    const r = await controllerGenerate([{ role: 'user', content: 'x' }], null, 3000, 600);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toContain('offscreen');
    // forwarded the caller's token budget, not the hard-coded 200
    expect(lastReq.parameters.max_tokens).toBe(600);
  });
  it('defaults max_tokens to 200 (latency-sensitive callers unchanged)', async () => {
    await controllerGenerate([{ role: 'user', content: 'x' }], null);
    expect(lastReq.parameters.max_tokens).toBe(200);
    expect(lastReq.type).toBe('raw');
  });
  it('uses the quiet request discriminator when the quiet API is available', async () => {
    (globalThis as any).spindle.generate.quiet = async (req: any) => { lastReq = req; return { content: 'ok' }; };
    const r = await controllerGenerate([{ role: 'user', content: 'x' }], 'u1');
    expect(r.ok).toBe(true);
    expect(lastReq.type).toBe('quiet');
    expect(lastReq.userId).toBe('u1');
  });
});

describe('withTimeout — bounds a hanging call independent of AbortSignal', () => {
  it('rejects at the deadline when the promise never resolves', async () => {
    const never = new Promise<string>(() => { /* never settles */ });
    await expect(withTimeout(never, 20, 'test')).rejects.toThrow(/test_timeout_20ms/);
  });
  it('resolves normally when the call beats the deadline', async () => {
    const quick = new Promise<string>((r) => setTimeout(() => r('ok'), 5));
    await expect(withTimeout(quick, 500, 'test')).resolves.toBe('ok');
  });
  it('passes through when timeoutMs is 0 (no bound)', async () => {
    await expect(withTimeout(Promise.resolve('v'), 0)).resolves.toBe('v');
  });
});

describe('controllerGenerate — hard timeout when host ignores AbortSignal', () => {
  it('returns Err when the host generate hangs past the timeout', async () => {
    (globalThis as any).spindle.generate.raw = () => new Promise(() => { /* hangs; ignores signal */ });
    const r = await controllerGenerate([{ role: 'user', content: 'x' }], null, 20, 200);
    expect(r.ok).toBe(false);
  });
});

describe('internalGenerate — hard timeout when host ignores AbortSignal', () => {
  it('returns Err when the host generate hangs past the timeout', async () => {
    (globalThis as any).spindle.generate.raw = () => new Promise(() => { /* hangs */ });
    const r = await internalGenerate([{ role: 'user', content: 'x' }], {}, null, { timeoutMs: 20 });
    expect(r.ok).toBe(false);
  });
});
