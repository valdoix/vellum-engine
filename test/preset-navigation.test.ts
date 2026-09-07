import { describe, expect, it } from 'vitest';
import { findLoomDrawerSurface, openLoomPresetTools } from '../src/ui/preset-navigation.js';

describe('VELLUM preset-tool navigation', () => {
  it('selects Lumiverse\'s exact native Loom drawer instead of a preset-like command', () => {
    const surfaces = [
      { kind: 'command', id: 'preset-import', label: 'Import a Loom preset' },
      { kind: 'drawer_tab', id: 'vellum-engine-tab', label: 'VELLUM', description: 'Preset diagnostics' },
      { kind: 'drawer_tab', id: 'loom', label: 'Loom', description: 'Configure narrative structure' },
    ] as any;

    expect(findLoomDrawerSurface(surfaces)).toEqual(surfaces[2]);
  });

  it('falls back when the native Loom drawer is absent or cannot be invoked', () => {
    expect(findLoomDrawerSurface([
      { kind: 'drawer_tab', id: 'loom', label: 'Loom', invocable: false },
      { kind: 'route', id: '/characters', label: 'Preset characters' },
    ] as any)).toBeNull();
  });

  it('opens Loom, waits for its editor controller, and activates VELLUM', async () => {
    let editorOpen = false;
    let invoked = '';
    let activated = 0;
    const opened = await openLoomPresetTools({
      editor: { getState: () => ({ open: editorOpen }) },
      surfaces: {
        list: () => [{ kind: 'drawer_tab', id: 'loom', label: 'Loom' }],
        invoke: (ref: any) => { invoked = `${ref.kind}:${ref.id}`; },
      } as any,
      activate: () => { activated += 1; },
      attempts: 2,
      wait: async () => { editorOpen = true; },
    });

    expect(opened).toBe(true);
    expect(invoked).toBe('drawer_tab:loom');
    expect(activated).toBe(1);
  });
});
