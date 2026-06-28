import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { internalGenerate } from '../src/host/generation.js';

// internalGenerate calls the host via globalThis.spindle — stub it to capture
// the outgoing request and assert response_format / reasoning are forwarded.
let lastReq: any = null;
beforeEach(() => {
  (globalThis as any).spindle = {
    permissions: { has: async () => true },
    has: async () => true,
    generate: { raw: async (req: any) => { lastReq = req; return { content: '{"knowledge":[]}' }; } },
  };
  // capability.has reads spindle.permissions?.has or spindle.has — cover both
});
afterEach(() => { lastReq = null; });

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
  });

  it('omits response_format when not requested', async () => {
    await internalGenerate([{ role: 'user', content: 'x' }], {}, null);
    expect(lastReq.parameters.response_format).toBeUndefined();
  });
});
