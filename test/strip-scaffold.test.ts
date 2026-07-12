import { describe, it, expect } from 'vitest';
import { stripScaffold } from '../src/parse/state-block.js';

describe('stripScaffold — happy path', () => {
  it('strips a well-formed reverie prefix, vellum suffix, keeps prose', () => {
    const raw = '<reverie>\nSCENE: night\nSTATE: x\n</reverie>\nShe set the cup down.\n<vellum>\n{ "turn": 5 }\n</vellum>';
    expect(stripScaffold(raw)).toBe('She set the cup down.');
  });

  it('keeps prose verbatim when there is no scaffold at all', () => {
    const raw = 'Just a plain line of prose with no tags.';
    expect(stripScaffold(raw)).toBe('Just a plain line of prose with no tags.');
  });
});

describe('stripScaffold — assembled beat (keeps player action)', () => {
  // allTurnContents wraps a beat as "[Player action]\n{user}\n\n[Scene]\n{reply}".
  // The reverie sits INSIDE the [Scene] section, so stripping it must never eat the
  // player action or the [Scene]/[Player action] markers that precede it.
  it('keeps [Player action] + user message when reverie has an explicit open tag', () => {
    const raw = '[Player action]\nI open the door.\n\n[Scene]\n<reverie>\nSCENE: hallway\nSTATE: x\n</reverie>\nThe door swings wide.\n<vellum>\n{ "turn": 3 }\n</vellum>';
    const out = stripScaffold(raw);
    expect(out).toContain('[Player action]');
    expect(out).toContain('I open the door.');
    expect(out).toContain('[Scene]');
    expect(out).toContain('The door swings wide.');
    expect(out).not.toContain('SCENE: hallway');
    expect(out).not.toContain('turn');
  });

  it('keeps the player action when the reverie open tag was eaten by the prefill', () => {
    // prefill ate "<reverie>", so the beat opens straight into planning after [Scene]
    const raw = '[Player action]\nI draw my sword.\n\n[Scene]\nSCENE: courtyard\nSTATE: tense\n</reverie>\nSteel rings against steel.\n<vellum>{ "turn": 7 }</vellum>';
    const out = stripScaffold(raw);
    expect(out).toContain('[Player action]');
    expect(out).toContain('I draw my sword.');
    expect(out).toContain('Steel rings against steel.');
    expect(out).not.toContain('SCENE: courtyard');
    expect(out).not.toContain('STATE: tense');
  });
});

describe('stripScaffold — assembled beat wrapper (preserve player action)', () => {
  it('keeps [Player action] + user msg + [Scene] when reverie has an explicit open tag', () => {
    const raw = '[Player action]\nI open the door.\n\n[Scene]\n<reverie>\nSCENE: hall\nSTATE: x\n</reverie>\nThe door swings wide.\n<vellum>\n{ "turn": 3 }\n</vellum>';
    const out = stripScaffold(raw);
    expect(out).toContain('[Player action]');
    expect(out).toContain('I open the door.');
    expect(out).toContain('[Scene]');
    expect(out).toContain('The door swings wide.');
    expect(out).not.toContain('SCENE: hall');
    expect(out).not.toContain('turn');
  });

  it('keeps the player action when the reverie open tag was eaten (prefill)', () => {
    const raw = '[Player action]\nI wait quietly.\n\n[Scene]\nSCENE: night garden\nSTATE: Lira guarded\n</reverie>\nShe watched me in silence.\n<vellum>\n{ "turn": 7 }\n</vellum>';
    const out = stripScaffold(raw);
    expect(out).toContain('[Player action]');
    expect(out).toContain('I wait quietly.');
    expect(out).toContain('She watched me in silence.');
    expect(out).not.toContain('SCENE: night garden');
    expect(out).not.toContain('STATE: Lira guarded');
  });
});

describe('stripScaffold — mangled / truncated vellum suffix', () => {
  it('strips a truncated vellum block with no close tag', () => {
    const raw = 'The door opened.\n<vellum>\n{ "turn": 5, "scene": { "time": "late"';
    expect(stripScaffold(raw)).toBe('The door opened.');
  });

  it('strips a tagless trailing schema-keyed JSON blob (no fence)', () => {
    const raw = 'A long paragraph of story prose here that sets the scene properly.\n{ "turn": 5, "scene": { "loc": "hall" } }';
    expect(stripScaffold(raw)).toBe('A long paragraph of story prose here that sets the scene properly.');
  });

  it('handles the ‹vellum› fence variant', () => {
    const raw = 'Prose line.\n\u2039vellum\u203a{ "turn": 1 }\u2039/vellum\u203a';
    expect(stripScaffold(raw)).toBe('Prose line.');
  });

  it('handles the ```vellum fence variant', () => {
    const raw = 'Prose line.\n```vellum\n{ "turn": 1 }\n```';
    expect(stripScaffold(raw)).toBe('Prose line.');
  });

  it('handles the [VELLUM] fence variant', () => {
    const raw = 'Prose line.\n[VELLUM]{ "turn": 1 }[/VELLUM]';
    expect(stripScaffold(raw)).toBe('Prose line.');
  });

  it('handles a spaced close tag < / vellum >', () => {
    const raw = 'Prose line.\n< vellum >{ "turn": 1 }< / vellum >';
    expect(stripScaffold(raw)).toBe('Prose line.');
  });
});

describe('stripScaffold — reverie prefix variants', () => {
  it('strips a prefilled reverie with no open tag (starts mid-plan)', () => {
    const raw = 'SCENE: dawn\nSTATE: y\n</reverie>\nThe prose begins.\n<vellum>{ "turn": 2 }</vellum>';
    expect(stripScaffold(raw)).toBe('The prose begins.');
  });

  it('strips a spaced reverie close </ reverie >', () => {
    const raw = '<reverie>plan</ reverie >\nProse here.';
    expect(stripScaffold(raw)).toBe('Prose here.');
  });
});

describe('stripScaffold — truncated reverie (Part C heuristic)', () => {
  it('strips leading planning blocks when reverie never closes', () => {
    const raw = '<reverie>\nSCENE: garden, night\nSTATE: Lira guarded\n\nShe set the cup down without drinking.';
    expect(stripScaffold(raw)).toBe('She set the cup down without drinking.');
  });

  it('strips nothing when the first block after <reverie> is already prose (confident-match only)', () => {
    const raw = '<reverie>\nShe walked into the room and looked around.\n\nAnother paragraph.';
    // no planning fingerprint in the first block → leave prose intact (open tag itself still cleaned)
    const out = stripScaffold(raw);
    expect(out).toContain('She walked into the room');
    expect(out).toContain('Another paragraph.');
    expect(out).not.toContain('<reverie>');
  });
});

describe('stripScaffold — colored-dialogue tags', () => {
  it('removes [spk=Name] and [/spk] tags but keeps the quoted line', () => {
    const raw = 'He turned. [spk=Elara]"You came back."[/spk] The words hung there.';
    expect(stripScaffold(raw)).toBe('He turned. "You came back." The words hung there.');
  });

  it('removes a dangling [spk=..] with no close', () => {
    const raw = '[spk=Kael]"Where were you?"';
    expect(stripScaffold(raw)).toBe('"Where were you?"');
  });
});

describe('stripScaffold — leak-not-eat guards', () => {
  it('does not touch prose that merely mentions the word scene mid-sentence', () => {
    const raw = 'The scene before her was calm, and she said nothing more about it.';
    expect(stripScaffold(raw)).toBe('The scene before her was calm, and she said nothing more about it.');
  });

  it('does not strip a mid-prose brace that is not a trailing schema object', () => {
    const raw = 'He muttered "{maybe}" under his breath and then continued walking down the hall.';
    expect(stripScaffold(raw)).toBe('He muttered "{maybe}" under his breath and then continued walking down the hall.');
  });

  it('returns the original (leak-not-eat) for a pure-scaffold turn with no prose', () => {
    // reverie + vellum, no prose between. Stripping empties it, and the guard
    // CANNOT tell "empty because pure scaffold" from "empty because we ate prose",
    // so it returns the original rather than risk silent data loss. A pure-scaffold
    // turn is degenerate/rare, so leaking the scaffold here is the safe tradeoff.
    const raw = '<reverie>\nSTATE: x\n</reverie>\n<vellum>{ "turn": 1 }</vellum>';
    expect(stripScaffold(raw)).toBe(raw);
  });

  it('handles empty input', () => {
    expect(stripScaffold('')).toBe('');
  });
});
