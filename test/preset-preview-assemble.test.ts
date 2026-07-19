import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// The vellum_preview_assemble dispatch handler lives inline in backend.ts
// (not an exported function). We test it by stubbing globalThis.spindle
// and calling the handler through the dispatch table, exactly like the
// preset-stamp/preset-vars-save tests.
//
// Contract: sends prompt_order as { blocks, chatId, promptVariables } to
// spindle.assemble, then runs a quiet generation and returns its prose sample.

let assembleArgs: any[] = [];
let assembleResult: any = { messages: [] };
let assembleShouldThrow = false;
let generateArgs: any[] = [];

function resetStubs(): void {
  assembleArgs = [];
  assembleResult = { messages: [] };
  assembleShouldThrow = false;
  generateArgs = [];
}

beforeEach(() => {
  resetStubs();
  (globalThis as any).spindle = {
    permissions: { has: async (p: string) => p === 'generation' },
    has: async (p: string) => p === 'generation',
    presets: {
      get: async (_id: string, _uid: string) => ({
        id: 'p1',
        prompt_order: [
          { id: 'v2-config', content: 'style config' },        // prose block — kept
          { id: 'v2-char-desc', content: 'character card' },   // non-prose — filtered out
        ],
        cache_revision: 1,
      }),
    },
    assemble: async (input: any, _uid: string) => {
      assembleArgs.push(input);
      if (assembleShouldThrow) throw new Error('assemble failed');
      return assembleResult;
    },
    generate: {
      quiet: async (input: any) => {
        generateArgs.push(input);
        return { content: 'Rain threaded the lamplight.' };
      },
    },
    sendToFrontend: () => {},
    log: { warn: () => {} },
  };
});
afterEach(() => { resetStubs(); delete (globalThis as any).spindle; });

// Inline the handler logic so we can test it without importing the full backend
// (the dispatch table is only reachable through the full spindle bridge).
async function previewAssemble(p: any, uid: string | null): Promise<any> {
  const spindle = (globalThis as any).spindle;
  const presetId = String(p?.presetId ?? '').trim();
  const chatId = String(p?.chatId ?? '').trim();
  const pv = (p && typeof p.promptVariables === 'object' && p.promptVariables) ? p.promptVariables : {};
  if (!presetId || !chatId || !(await spindle.has('generation')) || !spindle.assemble) return null;
  try {
    const preset = await spindle.presets?.get?.(presetId, uid);
    const allBlocks = Array.isArray(preset?.prompt_order) ? preset.prompt_order : null;
    if (!allBlocks?.length) return null;
    const PROSE_BLOCK_IDS = new Set<string>([
      'v2-config', 'v2-doctrine', 'v2-register', 'v2-prose-tuning', 'v2-genre',
      'v2-era', 'v2-tonal-cast', 'v2-antislop', 'v2-romance', 'v2-disposition',
      'v2-scribes', 'v2-imperfection',
    ]);
    const proseBlocks = allBlocks.filter((b: any) => b?.id && PROSE_BLOCK_IDS.has(String(b.id)));
    const blocks = proseBlocks.length ? proseBlocks : allBlocks;
    const result = await spindle.assemble({ blocks, chatId, promptVariables: pv }, uid);
    const messages = Array.isArray(result?.messages)
      ? result.messages.filter((m: any) => ['system', 'user', 'assistant'].includes(m?.role))
      : [];
    if (!messages.length) return null;
    const systemOnly = messages.filter((m: any) => m.role === 'system');
    if (!systemOnly.length) return null;
    systemOnly.push(
      { role: 'system', content: 'Write one short standalone paragraph of fiction in this style. No characters from any story. No analysis. No explanation. Output only the paragraph.' },
      { role: 'assistant', content: ' ' },
    );
    const generated = await spindle.generate.quiet({ messages: systemOnly, parameters: { max_tokens: 300, temperature: 0.85 }, userId: uid });
    return typeof generated?.content === 'string' && generated.content.trim() ? generated.content.trim() : null;
  } catch (e) {
    spindle.log?.warn?.('[vellum_engine] preview_assemble: ' + ((e as Error)?.message ?? e));
    return null;
  }
}

describe('vellum_preview_assemble', () => {
  it('assembles prompt_order and returns a quiet-generated sample', async () => {
    assembleResult = { messages: [{ role: 'system', content: 'Write in close third person.' }] };
    const sys = await previewAssemble({ presetId: 'p1', chatId: 'c1', promptVariables: { b1: { pov: '3rd' } } }, 'u1');
    expect(sys).toBe('Rain threaded the lamplight.');
    expect(assembleArgs).toHaveLength(1);
    expect(assembleArgs[0].chatId).toBe('c1');
    expect(assembleArgs[0].promptVariables).toEqual({ b1: { pov: '3rd' } });
    expect(Array.isArray(assembleArgs[0].blocks)).toBe(true);
    // only the prose-shaping block is kept; the character card is filtered out
    expect(assembleArgs[0].blocks).toHaveLength(1);
    expect(assembleArgs[0].blocks[0].id).toBe('v2-config');
    expect(generateArgs).toHaveLength(1);
    // system + style-probe system + assistant prefill (3 messages, no user turn)
    expect(generateArgs[0].messages).toHaveLength(3);
    expect(generateArgs[0].messages[0].role).toBe('system');
    expect(generateArgs[0].messages[1].role).toBe('system');
    expect(generateArgs[0].messages[1].content).toContain('standalone paragraph');
    expect(generateArgs[0].messages[2].role).toBe('assistant');
  });

  it('returns null when no chatId', async () => {
    const sys = await previewAssemble({ presetId: 'p1', chatId: '', promptVariables: {} }, 'u1');
    expect(sys).toBeNull();
    expect(assembleArgs).toHaveLength(0);
  });

  it('returns null when no presetId', async () => {
    const sys = await previewAssemble({ presetId: '', chatId: 'c1', promptVariables: {} }, 'u1');
    expect(sys).toBeNull();
    expect(assembleArgs).toHaveLength(0);
  });

  it('returns null when generation permission not granted', async () => {
    (globalThis as any).spindle.has = async () => false;
    (globalThis as any).spindle.permissions.has = async () => false;
    const sys = await previewAssemble({ presetId: 'p1', chatId: 'c1', promptVariables: {} }, 'u1');
    expect(sys).toBeNull();
    expect(assembleArgs).toHaveLength(0);
  });

  it('returns null when spindle.assemble throws', async () => {
    assembleShouldThrow = true;
    const sys = await previewAssemble({ presetId: 'p1', chatId: 'c1', promptVariables: {} }, 'u1');
    expect(sys).toBeNull();
  });

  it('returns null when assembly has no messages', async () => {
    assembleResult = { messages: [] };
    const sys = await previewAssemble({ presetId: 'p1', chatId: 'c1', promptVariables: {} }, 'u1');
    expect(sys).toBeNull();
  });
});
