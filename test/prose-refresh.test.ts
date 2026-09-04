import { describe, expect, it } from 'vitest';
import {
  hasProseRefreshCommand,
  proseRefreshInjection,
  scrubProseRefreshCommands,
  stripProseRefreshCommand,
} from '../src/domain/prose-refresh.js';

const a = (content: string, marked = true) => ({ role: 'assistant', content, __isChatHistory: marked });
const u = (content: string, marked = true) => ({ role: 'user', content, __isChatHistory: marked });

describe('prose refresh command', () => {
  it('recognizes the OOC form case-insensitively on its own line', () => {
    expect(hasProseRefreshCommand('OOC: ((refresh))')).toBe(true);
    expect(hasProseRefreshCommand('ooc (( REFRESH ))')).toBe(true);
    expect(hasProseRefreshCommand('Continue this.\n\n((refresh))')).toBe(true);
  });

  it('does not fire when merely discussed inside a sentence', () => {
    expect(hasProseRefreshCommand('What does OOC: ((refresh)) do?')).toBe(false);
  });

  it('fires only from the newest user message, not an old invocation', () => {
    const text = proseRefreshInjection([
      u('OOC: ((refresh))'),
      a('A fresh reply followed.'),
      u('Continue normally.'),
    ]);
    expect(text).toBe('');
  });

  it('ignores a command example in non-history prompt material', () => {
    const text = proseRefreshInjection([
      { role: 'user', content: 'OOC: ((refresh))', __isChatHistory: false },
      u('Continue normally.'),
    ]);
    expect(text).toBe('');
  });

  it('emits a one-turn style governor that preserves continuity and player agency', () => {
    const text = proseRefreshInjection([
      a('The rain struck the glass. Cersei waited.'),
      u('OOC: ((refresh))'),
    ]);
    expect(text).toContain('ONE-TURN PROSE REFRESH');
    expect(text).toContain('exact current instant');
    expect(text).toContain('numeric clock');
    expect(text).toContain("never invent {{user}}'s dialogue");
    expect(text).toContain('speaker-color tags');
    expect(text).toContain('complete <vellum> state block');
  });

  it('detects repeated phrases, openings, and stale body-language beats', () => {
    const text = proseRefreshInjection([
      a('For a moment, she said nothing. Her breath caught in her throat. She turned toward the rain and held her silence.'),
      u('Go on.'),
      a('For a moment, the room held still. Her breath caught before she answered. She turned toward the rain and held her silence.'),
      u('OOC: ((refresh))'),
    ]);
    expect(text).toContain('“for a moment/beat/heartbeat” transition');
    expect(text).toContain('caught/released breath beat');
    expect(text).toContain('repeated sentence opening “for a moment');
    expect(text).toContain('repeated phrase “she turned toward the”');
  });

  it('uses the supplied scaffold cleaner before analyzing prior prose', () => {
    let cleaned = 0;
    proseRefreshInjection([
      a('Visible prose. <vellum>{"turn":1}</vellum>'),
      u('((refresh))'),
    ], (text) => { cleaned++; return text.replace(/<vellum>[\s\S]*/i, ''); });
    expect(cleaned).toBe(1);
  });

  it('strips the command from Chronicle/extractor text and cleans empty player markers', () => {
    const combined = '[Player action]\nOOC: ((refresh))\n\n[Scene]\nCersei opened the door.';
    const stripped = stripProseRefreshCommand(combined).replace(/\[Player action\]\s*(?=\[Scene\])/gi, '');
    expect(stripped).toBe('[Scene]\nCersei opened the door.');
    expect(stripped).not.toContain('refresh');
  });

  it('consumes current and historical command lines from model-facing history only', () => {
    const original = [
      u('OOC: ((refresh))'),
      a('A refreshed reply.'),
      u('I open the door.\n\n((refresh))'),
    ];
    const scrubbed = scrubProseRefreshCommands(original) as Array<{ role: string; content: string }>;
    expect(scrubbed[0]?.content).toContain('control consumed');
    expect(scrubbed[2]?.content).toContain('I open the door.');
    expect(scrubbed[2]?.content).toContain('active for THIS reply only');
    expect(original[0]?.content).toBe('OOC: ((refresh))'); // no persisted mutation
  });

  it('works with structured content arrays', () => {
    const text = proseRefreshInjection([
      a('The room remained still.'),
      { role: 'user', content: [{ type: 'text', text: 'OOC: ((refresh))' }], __isChatHistory: true },
    ]);
    expect(text).toContain('ONE-TURN PROSE REFRESH');
  });
});
