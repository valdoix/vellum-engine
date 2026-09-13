import { describe, expect, it } from 'vitest';
import { applyPersonaCastBinding, parsePersonaCastBinding } from '../src/domain/persona-cast.js';

describe('persona cast binding', () => {
  it('parses a valid per-chat cast selection', () => {
    expect(parsePersonaCastBinding('{"id":"gabriel_winters","name":"Gabriel Winters"}'))
      .toEqual({ id: 'gabriel_winters', name: 'Gabriel Winters' });
  });

  it('rejects empty, malformed, or incomplete selections', () => {
    expect(parsePersonaCastBinding('')).toBeNull();
    expect(parsePersonaCastBinding('{bad')).toBeNull();
    expect(parsePersonaCastBinding('{"id":"gabriel_winters"}')).toBeNull();
  });

  it('overrides only the player persona and preserves the character card', () => {
    expect(applyPersonaCastBinding(
      { user: 'Buffy Summers', char: 'Buffy Summers' },
      { id: 'gabriel_winters', name: 'Gabriel Winters' },
    )).toEqual({ user: 'Gabriel Winters', char: 'Buffy Summers' });
  });
});
