import { describe, expect, it } from 'vitest';
import { freshState } from '../src/domain/types.js';
import { castTab, setPersonaCastBinding } from '../src/ui/tabs/cast.js';

describe('Cast persona assignment control', () => {
  it('renders a set-persona button on each cast card and marks the selection', () => {
    const state = freshState();
    state.cast.gabriel_winters = {
      id: 'gabriel_winters', name: 'Gabriel Winters', aka: [], status: 'present',
      source: 'user', firstTurn: 1, lastTurn: 1, userEdited: true,
    };
    state.cast.buffy_summers = {
      id: 'buffy_summers', name: 'Buffy Summers', aka: [], status: 'present',
      source: 'user', firstTurn: 1, lastTurn: 1, userEdited: false,
    };
    setPersonaCastBinding({ id: 'gabriel_winters', name: 'Gabriel Winters' });

    const html = castTab.render(state);
    expect(html.match(/data-cast-persona/g)).toHaveLength(2);
    expect(html).toContain('data-id="gabriel_winters" aria-pressed="true"');
    expect(html).toContain('class="vle-persona-mark"');
    expect(html).toContain('Set Buffy Summers as the player persona');
  });
});
