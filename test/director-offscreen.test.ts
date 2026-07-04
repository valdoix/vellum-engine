import { describe, it, expect } from 'vitest';
import { directorTab } from '../src/ui/tabs/director.js';
import { freshState } from '../src/domain/types.js';

// The Director tab keeps its active sub-view (_view) in module state, switched
// by a delegated click on a [data-dview] button. There's no DOM here, so we
// capture the click handler mount() registers and drive it with a minimal fake
// event to flip to the 'offscreen' sub-view, then assert render() output.
function switchTo(view: string): void {
  let handler: ((e: unknown) => void) | null = null;
  const fakeHost = { addEventListener: (_t: string, h: (e: unknown) => void) => { handler = h; } } as unknown as HTMLElement;
  directorTab.mount!(fakeHost);
  const target = { closest: (sel: string) => (sel === '[data-dview]' ? { getAttribute: () => view } : null) };
  handler!({ target });
}

describe('Director Off-screen view — renders model-narrated parallel meanwhile-lines', () => {
  it('shows s.parallel activity when the sub-view is offscreen', () => {
    const s = freshState();
    s.turns = 12;
    s.parallel = [
      { who: 'cersei', where: 'the sept', activity: 'lit candles for the dead', turn: 12, day: 3 },
      { activity: 'ravens circled the tower', note: 'an omen', src: 'sim', turn: 11, day: 3 },
    ];
    switchTo('offscreen');
    const html = directorTab.render(s);
    expect(html).toContain('Meanwhile (narrated)');
    expect(html).toContain('lit candles for the dead');
    expect(html).toContain('ravens circled the tower');
    expect(html).toContain('auto'); // src:'sim' badge
  });

  it('parallel-only state does not show the empty placeholder', () => {
    const s = freshState();
    s.parallel = [{ activity: 'the market reopened', turn: 5, day: 1 }];
    switchTo('offscreen');
    const html = directorTab.render(s);
    expect(html).not.toContain('No off-screen threads.');
    expect(html).toContain('the market reopened');
  });

  it('version() changes when parallel CONTENT changes but the count stays equal', () => {
    // parallel.set replaces the whole array each turn; same length, new content
    // must still bust the re-render gate or the tab shows stale meanwhile-lines.
    const a = freshState(); a.parallel = [{ activity: 'the market reopened', turn: 5, day: 1 }];
    const b = freshState(); b.parallel = [{ activity: 'the docks flooded', turn: 6, day: 1 }];
    expect(directorTab.version!(a)).not.toBe(directorTab.version!(b));
  });
});

describe('Director Locations view — nests contained places under their parent', () => {
  it('renders children indented with a branch connector under the parent', () => {
    const s = freshState();
    s.locations = [
      { id: 'harrenhal', name: 'Harrenhal', auto: true, firstTurn: 1, lastTurn: 5 },
      { id: 'yard', name: 'Training yard', parent: 'harrenhal', auto: true, firstTurn: 2, lastTurn: 6 },
      { id: 'hall', name: 'Great Hall', parent: 'harrenhal', auto: true, firstTurn: 3, lastTurn: 4 },
    ];
    switchTo('locations');
    const html = directorTab.render(s);
    // children nest inside the parent's node under a .vle-loc-kids wrapper (the
    // rail + elbow are drawn in CSS, like the timeline — no text glyphs).
    expect(html).toContain('Harrenhal');
    expect(html).toContain('vle-loc-kids');
    // child rows come AFTER the parent row in document order
    expect(html.indexOf('Harrenhal')).toBeLessThan(html.indexOf('Training yard'));
    expect(html.indexOf('Harrenhal')).toBeLessThan(html.indexOf('Great Hall'));
  });

  it('a dangling parent ref still renders the place (as a root), never hidden', () => {
    const s = freshState();
    s.locations = [{ id: 'orphan', name: 'Lost Cave', parent: 'gone', auto: true, firstTurn: 1, lastTurn: 1 }];
    switchTo('locations');
    const html = directorTab.render(s);
    expect(html).toContain('Lost Cave');
  });

  it('a parent with children shows a collapse caret; a leaf place does not', () => {
    const s = freshState();
    s.locations = [
      { id: 'harrenhal', name: 'Harrenhal', auto: true, firstTurn: 1, lastTurn: 5 },
      { id: 'yard', name: 'Training yard', parent: 'harrenhal', auto: true, firstTurn: 2, lastTurn: 6 },
    ];
    switchTo('locations');
    const html = directorTab.render(s);
    expect(html).toContain('data-loc-toggle'); // caret on the parent
    expect(html).toContain('data-id="harrenhal"');
    expect(html).toContain('Training yard'); // expanded by default
  });

  it('collapsing a parent hides its children and shows the contained-count badge', () => {
    const s = freshState();
    s.locations = [
      { id: 'harrenhal', name: 'Harrenhal', auto: true, firstTurn: 1, lastTurn: 5 },
      { id: 'yard', name: 'Training yard', parent: 'harrenhal', auto: true, firstTurn: 2, lastTurn: 6 },
      { id: 'hall', name: 'Great Hall', parent: 'harrenhal', auto: true, firstTurn: 3, lastTurn: 4 },
    ];
    switchTo('locations');
    // click the caret via the same delegated handler used in the tab
    let handler: ((e: unknown) => void) | null = null;
    const fakeHost = { addEventListener: (_t: string, h: (e: unknown) => void) => { handler = h; } } as unknown as HTMLElement;
    directorTab.mount!(fakeHost);
    const target = { closest: (sel: string) => (sel === '[data-loc-toggle]' ? { getAttribute: () => 'harrenhal' } : null) };
    handler!({ target });
    const html = directorTab.render(s);
    expect(html).not.toContain('Training yard'); // children hidden
    expect(html).not.toContain('Great Hall');
    expect(html).toContain('vle-loc-count');    // "2" contained-places badge
    expect(html).toContain('Harrenhal');        // parent still shown
    // toggle back open
    handler!({ target });
    expect(directorTab.render(s)).toContain('Training yard');
  });
});
