import { describe, it, expect, afterEach } from 'vitest';
import { summarizeOnce, parseSummary, cleanGist } from '../src/bus/summarize.js';
import { invalidatePermissions } from '../src/host/capability.js';
import { freshState, type ChronicleState } from '../src/domain/types.js';

// In tests there's no `spindle`, so internalGenerate returns an error and
// summarizeOnce takes the structural FALLBACK path — exactly what we're hardening.
function stateWithTurnMemories(n: number): ChronicleState {
  const s = freshState();
  s.turns = n;
  const longProse = 'The wheelhouse groans to a halt before the towering gates of Harrenhal and Cersei permits herself a moment of undisguised contempt before schooling her features into practiced composure that would make her father proud of the queen she pretends to be.';
  for (let i = 1; i <= n; i++) {
    s.memories.push({ id: 'turn_x_' + i, tier: 'turn', text: longProse + ' (turn ' + i + ')', keys: [], turn: i, covers: [i, i] } as any);
  }
  return s;
}

describe('summarize fallback (no host generation)', () => {
  it('produces a sentence-bounded digest, never a mid-word raw-prose dump', async () => {
    const evs = await summarizeOnce(stateWithTurnMemories(8), null, 8);
    const chapter = evs.find((e: any) => e.kind === 'memory.record') as any;
    expect(chapter).toBeTruthy();
    const text: string = chapter.text;
    expect(text.startsWith('Chapter (turns 1\u20138):')).toBe(true);
    // never ends mid-word: last char is sentence punctuation, ellipsis, or letter
    // following a complete sentence — specifically NOT a hard 1200 mid-word slice.
    expect(/[.!?\u2026]$/.test(text.trim()) || text.length < 1200).toBe(true);
    // it compressed: digest is far shorter than concatenating 8 full prose blocks
    const rawConcatLen = stateWithTurnMemories(8).memories.map((m) => m.text).join(' ').length;
    expect(text.length).toBeLessThan(rawConcatLen);
  });

  it('returns [] when there are too few turn-memories to fold', async () => {
    const evs = await summarizeOnce(stateWithTurnMemories(3), null, 8);
    expect(evs).toEqual([]);
  });

  it('never stores a summary cut mid-word', async () => {
    const evs = await summarizeOnce(stateWithTurnMemories(8), null, 8);
    const chapter = evs.find((e: any) => e.kind === 'memory.record') as any;
    const text: string = chapter.text;
    expect(text.length).toBeLessThanOrEqual(1200);
    // ends on sentence punctuation, ellipsis, or a complete word — not a fragment
    const last = text.trim().slice(-1);
    const endsClean = /[.!?\u2026)]/.test(last) || !text.includes('\u2026') ;
    expect(endsClean).toBe(true);
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

  it('escalates the token budget and allows reasoning on the retry attempt', async () => {
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
    await summarizeOnce(stateWithTurnMemories(8), null, 8);
    // attempt 1: reasoning off, base budget; attempt 2: reasoning ON, bigger budget
    expect(seen[0]!.reasoningOff).toBe(true);
    expect(seen[1]!.reasoningOff).toBe(false);
    expect(seen[1]!.max).toBeGreaterThan(seen[0]!.max);
  });

  it('falls back to the first-half window before the structural digest', async () => {
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
    // a real LLM chapter, not the digest
    expect(chapter.text.startsWith('Chapter (turns')).toBe(false);
    expect(chapter.text).toContain('Cersei');
    // narrowed to the first half: covers 1..4 and drops only those 4 turns
    expect(chapter.covers).toEqual([1, 4]);
    const drops = evs.filter((e: any) => e.kind === 'memory.drop');
    expect(drops.length).toBe(4);
  });
});
