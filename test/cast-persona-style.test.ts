import { describe, expect, it } from 'vitest';
import { STYLES } from '../src/ui/styles.js';

describe('cast persona control styling', () => {
  it('allows its text label to size beyond the icon-button width', () => {
    expect(STYLES).toContain('.vle-mini.vle-persona-btn{width:auto');
  });
});
