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
    expect(html).toContain('Elsewhere Feed'); // new feed title
    expect(html).toContain('lit candles for the dead');
    expect(html).toContain('ravens circled the tower');
    expect(html).toContain('AUTO'); // src:'sim' badge (uppercase in new design)
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

describe('Director Locations view — The Atlas: plates, breadcrumbs, provenance', () => {
  it('renders contained places as plates after their parent, indented by depth', () => {
    const s = freshState();
    s.locations = [
      { id: 'harrenhal', name: 'Harrenhal', source: 'auto', firstTurn: 1, lastTurn: 5 },
      { id: 'yard', name: 'Training yard', parent: 'harrenhal', source: 'auto', firstTurn: 2, lastTurn: 6 },
      { id: 'hall', name: 'Great Hall', parent: 'harrenhal', source: 'auto', firstTurn: 3, lastTurn: 4 },
    ];
    switchTo('locations');
    const html = directorTab.render(s);
    expect(html).toContain('vle-atlas-plate');
    expect(html).toContain('Harrenhal');
    // children render AFTER the parent in document order (depth-first walk)
    expect(html.indexOf('Harrenhal')).toBeLessThan(html.indexOf('Training yard'));
    expect(html.indexOf('Harrenhal')).toBeLessThan(html.indexOf('Great Hall'));
    // a contained place shows its containment breadcrumb
    expect(html).toContain('vle-atlas-crumb');
  });

  it('a dangling parent ref still renders the place (as a root), never hidden', () => {
    const s = freshState();
    s.locations = [{ id: 'orphan', name: 'Lost Cave', parent: 'gone', source: 'auto', firstTurn: 1, lastTurn: 1 }];
    switchTo('locations');
    const html = directorTab.render(s);
    expect(html).toContain('Lost Cave');
  });

  it('provenance chip: auto source shows ○ auto; pinned wins with ⚑; user-made shows neither', () => {
    const s = freshState();
    s.turns = 10;
    s.locations = [
      { id: 'a', name: 'Auto Place', source: 'auto', pinned: false, firstTurn: 1, lastTurn: 5 },
      { id: 'p', name: 'Pinned Place', source: 'auto', pinned: true, firstTurn: 1, lastTurn: 5 },
      { id: 'u', name: 'User Place', source: 'user', pinned: false, firstTurn: 1, lastTurn: 5 },
    ];
    switchTo('locations');
    const html = directorTab.render(s);
    expect(html).toContain('\u25CB auto');   // auto chip present
    expect(html).toContain('\u2691 pinned'); // pinned chip present
    // the user-made, unpinned place carries no provenance chip — count chips
    const autoChips = (html.match(/\u25CB auto/g) ?? []).length;
    const pinChips = (html.match(/\u2691 pinned/g) ?? []).length;
    expect(autoChips).toBe(1); // only the auto+unpinned place
    expect(pinChips).toBe(1);  // only the pinned place
  });

  it('marks the current scene place with "you are here"', () => {
    const s = freshState();
    s.scene.location = 'Harrenhal';
    s.locations = [{ id: 'harrenhal', name: 'Harrenhal', source: 'auto', firstTurn: 1, lastTurn: 5 }];
    switchTo('locations');
    const html = directorTab.render(s);
    expect(html).toContain('you are here');
    expect(html).toContain('vle-atlas-plate here');
  });

  it('legacy rows without a source field read as auto (○), not user', () => {
    const s = freshState();
    s.locations = [{ id: 'old', name: 'Old Place', auto: true, firstTurn: 1, lastTurn: 1 } as any];
    switchTo('locations');
    const html = directorTab.render(s);
    expect(html).toContain('\u25CB auto');
  });
});
