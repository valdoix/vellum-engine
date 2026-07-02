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
