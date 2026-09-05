import { describe, it, expect, afterEach } from 'vitest';
import { summarizeOnce, summarizeFromPlan, parseSummary, cleanGist, reportArchiveSaved } from '../src/bus/summarize.js';
import { invalidatePermissions } from '../src/host/capability.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';
import { DEFAULT_CFG } from '../src/domain/summarizer-config.js';
import { planArcFrom } from '../src/domain/memory.js';

// In tests there's no `spindle`, so internalGenerate returns an error. Safe
// failure leaves the exact source turns intact for a later retry.
function stateWithTurnMemories(n: number): ChronicleState {
  const s = freshState();
  s.turns = n;
  const longProse = 'The wheelhouse groans to a halt before the towering gates of Harrenhal and Cersei permits herself a moment of undisguised contempt before schooling her features into practiced composure that would make her father proud of the queen she pretends to be.';
  for (let i = 1; i <= n; i++) {
    s.memories.push({ id: 'turn_x_' + i, tier: 'turn', text: longProse + ' (turn ' + i + ')', keys: [], turn: i, covers: [i, i] } as any);
  }
  return s;
}

describe('summarize safe failure (no host generation)', () => {
  it('does not create or drop archive records without a dense summary', async () => {
    const evs = await summarizeOnce(stateWithTurnMemories(8), null, 8);
    expect(evs).toEqual([]);
  });

  it('returns [] when there are too few turn-memories to fold', async () => {
    const evs = await summarizeOnce(stateWithTurnMemories(3), null, 8);
    expect(evs).toEqual([]);
  });

  it('leaves every source turn available for a later retry', async () => {
    const state = stateWithTurnMemories(8);
    const evs = await summarizeOnce(state, null, 8);
    expect(evs.some((e: any) => e.kind === 'memory.drop')).toBe(false);
    expect(state.memories).toHaveLength(8);
  });
});

describe('archive progress durability', () => {
  it('marks an archive filed only after the caller reports a successful Chronicle append', () => {
    const updates: any[] = [];
    reportArchiveSaved([
      { seq: 1, turn: 8, day: 1, src: 'system', kind: 'memory.record', id: 'book_x', tier: 'book', text: 'Book gist.', detail: 'Book detail.', keys: [], covers: [1, 8], status: 'ready' } as any,
      { seq: 2, turn: 8, day: 1, src: 'system', kind: 'memory.drop', id: 'arc_a', folded: true } as any,
      { seq: 3, turn: 8, day: 1, src: 'system', kind: 'memory.drop', id: 'arc_b', folded: true } as any,
    ], 123, { onProgress: (u) => updates.push(u) });
    expect(updates).toEqual([expect.objectContaining({ phase: 'archive', status: 'done', kind: 'book', sourceCount: 2, covers: [1, 8], tokens: 123, message: 'Archive record saved to the Chronicle' })]);
  });
});

describe('parseSummary - drop leading headless fragment', () => {
  it('skips a body cut mid-word to the first real sentence', () => {
    const r = parseSummary('ered and made anyway. During the lesson their arms brushed. Cersei moved astride him.');
    expect(r.detail.startsWith('ered')).toBe(false);
    expect(r.detail.startsWith('During')).toBe(true);
  });
  it('leaves clean capitalized text untouched', () => {
    expect(parseSummary('The lesson began. Their arms brushed.').detail.startsWith('The lesson')).toBe(true);
  });
  it('cleans a headless GIST line', () => {
    const r = parseSummary('DETAIL:\nThe lesson began.\nGIST:\npered and surrendered. Cersei gave the word.');
    expect(r.gist.startsWith('Cersei')).toBe(true);
  });
});

describe('cleanGist — strips bullets, meta, fragments into flowing prose', () => {
  it('drops a leading cut-off fragment', () => {
    expect(cleanGist('ered the two experiences as one. Cersei held the lily.')).toBe('Cersei held the lily.');
  });
  it('converts bullet lines into sentences', () => {
    const out = cleanGist('- Daeron poured the wine.\n- Cersei agreed to stay.');
    expect(out).toBe('Daeron poured the wine. Cersei agreed to stay.');
    expect(out).not.toContain('-');
  });
  it('removes meta-commentary sentences', () => {
    const out = cleanGist('Daeron confessed about Tom. The thread left open: what it cost him to say the name.');
    expect(out).toBe('Daeron confessed about Tom.');
  });
  it('removes "she now knows" analysis sentences', () => {
    const out = cleanGist('Cersei chose the sofa. She now knows she cannot separate her body from his words.');
    expect(out).toBe('Cersei chose the sofa.');
  });
  it('leaves clean event prose untouched', () => {
    const s = 'Cersei arrived at Harrenhal and received a golden rose from Daeron. She kept it.';
    expect(cleanGist(s)).toBe(s);
  });
  it('drops only the partial first word when a fragment has no later sentence', () => {
    expect(cleanGist('ered the quality of the renovation and stared at his forearms')).toBe('the quality of the renovation and stared at his forearms.');
  });
});

describe('summarize pass-1 retry (reasoning-model empty first call)', () => {
  afterEach(() => { delete (globalThis as any).spindle; invalidatePermissions(); });

  it('retries once when the first detail call is empty, then uses the LLM gist (not the digest)', async () => {
    let calls = 0;
    (globalThis as any).spindle = {
      permissions: { has: async () => true },
      has: async () => true,
      log: { warn: () => {}, info: () => {} },
      generate: {
        raw: async () => {
          calls++;
          // pass-1 attempt 1: empty (thinking ate the budget); attempt 2: real detail;
          // pass-2 (gist): real gist.
          if (calls === 1) return { content: '' };
          if (calls === 2) return { content: 'DETAIL:\nCersei arrived at Harrenhal and took the golden rose.\nKEYS:\nHarrenhal, golden rose' };
          return { content: 'Cersei arrived at Harrenhal and accepted the golden rose from Daeron.' };
        },
      },
    };
    invalidatePermissions();
    const evs = await summarizeOnce(stateWithTurnMemories(8), null, 8);
    const chapter = evs.find((e: any) => e.kind === 'memory.record') as any;
    expect(chapter).toBeTruthy();
    // not the structural first-sentence digest
    expect(chapter.text.startsWith('Chapter (turns')).toBe(false);
    expect(chapter.text).toContain('Cersei');
    expect(calls).toBeGreaterThanOrEqual(2); // proves the retry fired
  });

  it('rejects a conversational reasoning reply when folding chapters into an arc', async () => {
    const state = freshState();
    state.turns = 8;
    state.memories = [
      { id: 'chap_1', tier: 'chapter', text: 'Eleanor met Gabriel.', detail: 'Eleanor met Gabriel at Nana\'s diner and recognized his family resemblance.', keys: ['Nana\'s diner'], turn: 4, covers: [1, 4] } as any,
      { id: 'chap_2', tier: 'chapter', text: 'Gabriel disclosed the letter.', detail: 'Gabriel showed Eleanor the sealed letter, and she promised to protect it.', keys: ['sealed letter'], turn: 8, covers: [5, 8] } as any,
    ];
    const plan = planArcFrom(state, ['chap_1', 'chap_2'], 2)!;
    const seenUsers: string[] = [];
    let calls = 0;
    (globalThis as any).spindle = {
      permissions: { has: async () => true }, has: async () => true,
      log: { warn: () => {}, info: () => {} },
      generate: { raw: async (req: any) => {
        calls++;
        seenUsers.push(req.messages[1].content);
        if (calls === 1) return { content: '', reasoning: "I've read through the full recap, but you haven't actually asked me anything. What would you like me to do with this?" };
        if (calls === 2) return { content: 'DETAIL:\nEleanor recognized Gabriel at Nana\'s diner before he entrusted her with a sealed letter, which she promised to protect.\nKEYS:\nNana\'s diner, sealed letter, Eleanor\'s promise' };
        return { content: 'Eleanor recognized Gabriel at Nana\'s diner, then promised to protect the sealed letter he entrusted to her.' };
      } },
    };
    invalidatePermissions();
    const result = await summarizeFromPlan(state, null, plan, undefined, DEFAULT_CFG, 'arc');
    const arc = result.events.find((e: any) => e.kind === 'memory.record') as any;
    expect(calls).toBe(3);
    expect(arc?.tier).toBe('arc');
    expect(arc?.detail).toContain('sealed letter');
    expect(arc?.detail).not.toContain('what would you like');
    expect(seenUsers[0]).toContain('[ARCHIVE TASK: WRITE ONE ARC RECORD NOW]');
    expect(seenUsers[0]).toContain('not a message that needs to ask a question');
    expect(seenUsers[1]).toContain('A prior attempt was rejected');
  });

  it('rejects the same conversational reply from the arc gist pass', async () => {
    const state = freshState();
    state.turns = 8;
    state.memories = [
      { id: 'chap_1', tier: 'chapter', text: 'Eleanor met Gabriel.', detail: 'Eleanor met Gabriel at Nana\'s diner.', keys: [], turn: 4, covers: [1, 4] } as any,
      { id: 'chap_2', tier: 'chapter', text: 'Gabriel disclosed the letter.', detail: 'Gabriel entrusted Eleanor with the sealed letter.', keys: [], turn: 8, covers: [5, 8] } as any,
    ];
    const plan = planArcFrom(state, ['chap_1', 'chap_2'], 2)!;
    let calls = 0;
    (globalThis as any).spindle = {
      permissions: { has: async () => true }, has: async () => true,
      log: { warn: () => {}, info: () => {} },
      generate: { raw: async () => {
        calls++;
        if (calls === 1) return { content: 'DETAIL:\nEleanor met Gabriel at Nana\'s diner before he entrusted her with the sealed letter.\nKEYS:\nNana\'s diner, sealed letter' };
        if (calls === 2) return { content: '', reasoning: "There's no question or instruction in your message. What would you like me to do with this?" };
        return { content: 'Eleanor met Gabriel at Nana\'s diner and accepted custody of his sealed letter.' };
      } },
    };
    invalidatePermissions();
    const result = await summarizeFromPlan(state, null, plan, undefined, DEFAULT_CFG, 'arc');
    const arc = result.events.find((e: any) => e.kind === 'memory.record') as any;
    expect(calls).toBe(3);
    expect(arc?.text).toContain('sealed letter');
    expect(arc?.text).not.toContain('What would you like');
  });

  it('keeps the configured token ceiling and allows reasoning on retry', async () => {
    const seen: Array<{ max: number; reasoningOff: boolean }> = [];
    (globalThis as any).spindle = {
      permissions: { has: async () => true },
      has: async () => true,
      log: { warn: () => {}, info: () => {} },
      generate: {
        raw: async (req: any) => {
          seen.push({ max: req?.parameters?.max_tokens, reasoningOff: req?.reasoning?.source === 'off' });
          // both detail attempts empty; only the pass-2 gist (3rd call) can't run
          // because detail never landed → falls to the digest. We only assert the
          // ESCALATION shape here.
          return { content: '' };
        },
      },
    };
    invalidatePermissions();
    await summarizeOnce(stateWithTurnMemories(8), null, 8, undefined, { ...DEFAULT_CFG, complete: false });
    // attempt 1: reasoning off; later attempts may reason, but all honor the
    // user-configured per-pass maximum.
    expect(seen[0]!.reasoningOff).toBe(true);
    expect(seen[1]!.reasoningOff).toBe(false);
    expect(seen[1]!.max).toBe(seen[0]!.max);
  });

  it('continues with the first-half window when the full window stays incomplete', async () => {
    let calls = 0;
    (globalThis as any).spindle = {
      permissions: { has: async () => true },
      has: async () => true,
      log: { warn: () => {}, info: () => {} },
      generate: {
        raw: async () => {
          calls++;
          // calls 1+2: full-window detail attempts, both empty (too much to write);
          // call 3: half-window detail succeeds; call 4: gist from that detail.
          if (calls <= 2) return { content: '' };
          if (calls === 3) return { content: 'DETAIL:\nCersei reached Harrenhal in the first days.\nKEYS:\nHarrenhal' };
          return { content: 'Cersei reached Harrenhal and settled in.' };
        },
      },
    };
    invalidatePermissions();
    const evs = await summarizeOnce(stateWithTurnMemories(8), null, 8);
    const chapter = evs.find((e: any) => e.kind === 'memory.record') as any;
    expect(chapter).toBeTruthy();
    // a real LLM chapter over the narrower source window
    expect(chapter.text.startsWith('Chapter (turns')).toBe(false);
    expect(chapter.text).toContain('Cersei');
    // narrowed to the first half: covers 1..4 and drops only those 4 turns
    expect(chapter.covers).toEqual([1, 4]);
    const drops = evs.filter((e: any) => e.kind === 'memory.drop');
    expect(drops.length).toBe(4);
  });

  it('keeps retrying a non-splittable window until a complete detail lands by default', async () => {
    let calls = 0;
    (globalThis as any).spindle = {
      permissions: { has: async () => true },
      has: async () => true,
      log: { warn: () => {}, info: () => {} },
      generate: {
        raw: async () => {
          calls++;
          if (calls <= 2) return { content: '' };
          if (calls === 3) return { content: 'DETAIL:\nCersei completed the crossing into Harrenhal.\nKEYS:\nHarrenhal, crossing' };
          return { content: 'Cersei completed the crossing into Harrenhal.' };
        },
      },
    };
    invalidatePermissions();
    const evs = await summarizeOnce(stateWithTurnMemories(3), null, 3);
    expect(calls).toBe(4);
    expect(evs.some((e: any) => e.kind === 'memory.record')).toBe(true);
  });

  it('reports real detail and gist chunks while keeping reasoning text hidden', async () => {
    let calls = 0;
    (globalThis as any).spindle = {
      permissions: { has: async () => true },
      has: async () => true,
      log: { warn: () => {}, info: () => {} },
      generate: {
        rawStream: async function* () {
          calls++;
          if (calls === 1) {
            yield { type: 'reasoning', token: 'private chain of thought' };
            yield { type: 'token', token: 'DETAIL:\nCersei entered Harrenhal.\nKEYS:\nHarrenhal' };
            yield { type: 'done', content: 'DETAIL:\nCersei entered Harrenhal.\nKEYS:\nHarrenhal', finish_reason: 'stop' };
          } else {
            yield { type: 'token', token: 'Cersei entered Harrenhal.' };
            yield { type: 'done', content: 'Cersei entered Harrenhal.', finish_reason: 'stop' };
          }
        },
      },
    };
    invalidatePermissions();
    const updates: any[] = [];
    const evs = await summarizeOnce(stateWithTurnMemories(8), null, 8, undefined, DEFAULT_CFG, { onProgress: (u) => updates.push(u) });
    expect(evs.some((e: any) => e.kind === 'memory.record')).toBe(true);
    expect(updates.some((u) => u.phase === 'detail' && u.status === 'chunk' && u.delta.includes('DETAIL:'))).toBe(true);
    expect(updates.some((u) => u.phase === 'gist' && u.status === 'chunk' && u.delta.includes('Harrenhal'))).toBe(true);
    expect(updates.some((u) => String(u.delta ?? '').includes('private chain'))).toBe(false);
    expect(updates.some((u) => u.status === 'reasoning')).toBe(true);
  });
});
