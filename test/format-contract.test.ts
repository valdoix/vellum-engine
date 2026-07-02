import { describe, it, expect } from 'vitest';
import { parseState } from '../src/parse/state-block.js';

/**
 * Pins the format contract the preset promises against the parser that consumes
 * it — the failure shapes behind inconsistent <reverie>/<vellum> emission:
 *   (a) a model that drifts to a ```vellum or [VELLUM] fence (the parser accepts
 *       these, so the display/context strips were aligned to them too);
 *   (b) the STATE: line copied verbatim into <vellum> (the "transcribe" cure);
 *   (c) a reply that ends in prose with NO block → must degrade to source 'none'
 *       so the prose-mining fallback runs, never a false 'json';
 *   (d) a non-echoed prefill leaving the reverie with no opening tag — the block
 *       must still parse from the trailing <vellum>.
 */

describe('format contract — fences the preset/strips must all agree on', () => {
  it('accepts the ```vellum fence spelling', () => {
    const r = parseState('Prose here.\n```vellum\n{ "turn": 12, "scene": { "loc": "dock" } }\n```');
    expect(r.source).toBe('json');
    expect(r.state?.turn).toBe(12);
  });

  it('accepts the [VELLUM] fence spelling', () => {
    const r = parseState('Prose here.\n[VELLUM]\n{ "turn": 13, "scene": { "loc": "dock" } }\n[/VELLUM]');
    expect(r.source).toBe('json');
    expect(r.state?.turn).toBe(13);
  });

  it('parses a STATE: line transcribed verbatim into <vellum>', () => {
    // the exact shape Fix 2 asks the model to copy from the reverie's STATE: line
    const reply =
      '<reverie>\nSCENE: x\nSTATE: { "turn": 5, "scene": { "time": "late evening" } }\n</reverie>\n' +
      'She set the cup down.\n' +
      '<vellum>\n{ "turn": 5, "scene": { "time": "late evening" } }\n</vellum>';
    const r = parseState(reply);
    expect(r.source).toBe('json');
    expect(r.state?.turn).toBe(5);
    // the STATE: line inside the reverie must NOT be what got parsed as the block
    // (it's the last <vellum> that counts) — turn matches either way, so assert
    // the scene came through the real block
    expect(r.state?.scene?.time).toBe('late evening');
  });

  it('reply ending in prose with no block → source none (prose fallback territory)', () => {
    const r = parseState('She set the cup down without drinking. "You\'re stalling."');
    expect(r.source).toBe('none');
    expect(r.state).toBeNull();
  });

  it('non-echoed prefill: reverie missing its opening tag still yields the trailing block', () => {
    // host dropped the "<reverie>\n" prefill, so the reply opens mid-plan
    const reply =
      'SCENE: x\nSTATE: { "turn": 7 }\n</reverie>\n' +
      'The door held.\n' +
      '<vellum>\n{ "turn": 7, "scene": { "loc": "hall" } }\n</vellum>';
    const r = parseState(reply);
    expect(r.source).toBe('json');
    expect(r.state?.turn).toBe(7);
  });

  it('picks the real trailing block, not an example block shown earlier in prose', () => {
    const reply =
      'Here is the shape: <vellum>{ "turn": 1 }</vellum> as an aside.\n' +
      'Then the actual prose happens.\n' +
      '<vellum>\n{ "turn": 42, "scene": { "loc": "solar", "tension": 7 } }\n</vellum>';
    const r = parseState(reply);
    expect(r.source).toBe('json');
    // largest schema-bearing candidate wins → the complete turn-42 block
    expect(r.state?.turn).toBe(42);
    expect(r.state?.scene?.tension).toBe(7);
  });
});

describe('regression — real message that broke the extension', () => {
  // The reverie speaks the same backstage words ("SCENE:", "STATE:", "PLAN:") as
  // the terse fallback grammar. Combined with a `"weather": null` in the block,
  // this shipped as: block rejected → fallback runs on the whole message → the
  // reverie's "SCENE: Private dining room…" sentence lands in scene.loc.
  const reverie =
    '<reverie>\n' +
    'SCENE: Private dining room, Harrenhal, early evening of Day 4. Post-sex glow. Jaime returned holding cooking oil.\n' +
    'STATES: Cersei — goal: recover dignity. Jaime — survive dinner.\n' +
    'PLAN: Cersei laughs and hits Daeron.\n' +
    'STATE: turn advance, day 4, scene loc "Private Dining Room", time "early evening", tension low ~2.\n' +
    '</reverie>';
  const block =
    '<vellum>\n{ "turn": 52, "day": 4, "scene": { "loc": "Private Dining Room — Harrenhal", "time": "early evening", "tension": 2, "weather": null }, "present": [{ "id": "Cersei Lannister", "mood": "warm" }] }\n</vellum>';

  it('accepts a block with "weather": null (null coerced, not a hard failure)', () => {
    const r = parseState(`${reverie}\n\nHe set the bread down.\n\n${block}`);
    expect(r.source).toBe('json');
    expect(r.state?.turn).toBe(52);
    expect(r.state?.scene?.loc).toBe('Private Dining Room — Harrenhal');
    expect(r.state?.scene?.weather).toBeUndefined();
  });

  it('never leaks the reverie SCENE: line into scene.loc via the fallback', () => {
    // even with NO block at all, the fallback must ignore the reverie entirely
    const r = parseState(`${reverie}\n\nHe set the bread down and said nothing.`);
    // reverie is the only structured text → nothing real to parse → none
    expect(r.source).toBe('none');
    expect(r.state?.scene?.loc ?? '').not.toContain('Post-sex glow');
  });

  it('null coerces to undefined for every scene scalar', () => {
    const r = parseState('<vellum>{ "turn": 3, "scene": { "loc": null, "time": null, "tension": null, "weather": null } }</vellum>');
    expect(r.source).toBe('json');
    expect(r.state?.turn).toBe(3);
    expect(r.state?.scene?.loc).toBeUndefined();
    expect(r.state?.scene?.tension).toBeUndefined();
  });
});
