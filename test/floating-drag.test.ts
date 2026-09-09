import { describe, expect, it } from 'vitest';
import { clampFloatingPosition } from '../src/ui/floating-drag.js';

describe('floating process-window dragging', () => {
  it('keeps every edge reachable inside the viewport', () => {
    expect(clampFloatingPosition(-200, -50, 560, 400, 1200, 800)).toEqual({ left: 8, top: 8 });
    expect(clampFloatingPosition(1000, 700, 560, 400, 1200, 800)).toEqual({ left: 632, top: 392 });
  });

  it('handles a panel larger than the available viewport without negative coordinates', () => {
    expect(clampFloatingPosition(100, 100, 700, 900, 500, 600)).toEqual({ left: 8, top: 8 });
  });
});
