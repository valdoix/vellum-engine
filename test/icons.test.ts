import { describe, it, expect } from 'vitest';
import { icon, hasIcon } from '../src/ui/icons.js';

/** Icon set completeness — every tab id and toolbar/action verb must have an
 * icon so the nav never falls back to the generic dot. */
describe('icon set', () => {
  const TAB_IDS = ['now', 'cast', 'bonds', 'chronicle', 'journal', 'graph', 'vault', 'context'];
  const TOOLBAR = ['search', 'director', 'customize', 'actions'];
  // action ids that opt into icons (toggles + maintenance + data + danger that have art)
  const ACTIONS = ['summarize', 'rescan', 'undo', 'rebuild', 'resummarize', 'tidy', 'tidyfacts', 'summarizer', 'hide', 'traverse', 'tone', 'offscreen', 'export', 'import', 'recover', 'clear'];

  it('has an icon for every tab', () => {
    for (const id of TAB_IDS) expect(hasIcon(id), id).toBe(true);
  });
  it('has an icon for every toolbar button', () => {
    for (const id of TOOLBAR) expect(hasIcon(id), id).toBe(true);
  });
  it('has an icon for every action verb', () => {
    for (const id of ACTIONS) expect(hasIcon(id), id).toBe(true);
  });
  it('renders a well-formed inline svg that uses currentColor', () => {
    const out = icon('cast', { size: 16 });
    expect(out.startsWith('<svg')).toBe(true);
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('width="16"');
  });
  it('falls back to a dot for an unknown name (boundary-safe)', () => {
    expect(icon('nope')).toContain('<svg');
  });
});
