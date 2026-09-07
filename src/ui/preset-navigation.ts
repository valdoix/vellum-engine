import type { SpindleHostSurfaceAPI, SpindleHostSurfaceInfo } from 'lumiverse-spindle-types';

/**
 * Resolve Lumiverse's native Loom drawer without guessing from labels or
 * descriptions. Commands and routes can also mention presets, but invoking one
 * of those is not guaranteed to mount the preset editor.
 */
export function findLoomDrawerSurface(
  surfaces: readonly SpindleHostSurfaceInfo[],
): SpindleHostSurfaceInfo | null {
  return surfaces.find((surface) => (
    surface.kind === 'drawer_tab'
    && surface.id === 'loom'
    && surface.invocable !== false
  )) ?? null;
}

interface PresetEditorReader {
  getState(): { open: boolean };
}

interface OpenLoomPresetToolsOptions {
  editor: PresetEditorReader | null | undefined;
  surfaces: SpindleHostSurfaceAPI | null | undefined;
  activate(): void;
  attempts?: number;
  intervalMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

/** Open Loom, wait for its editor controller to mount, then show VELLUM's tab. */
export async function openLoomPresetTools({
  editor,
  surfaces,
  activate,
  attempts = 40,
  intervalMs = 50,
  wait = (delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
}: OpenLoomPresetToolsOptions): Promise<boolean> {
  try {
    if (!editor || typeof editor.getState !== 'function') return false;
    if (editor.getState().open) {
      activate();
      return true;
    }
    if (!surfaces) return false;
    const target = findLoomDrawerSurface(surfaces.list(['drawer_tab']));
    if (!target) return false;
    await surfaces.invoke({ kind: target.kind, id: target.id });
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (editor.getState().open) {
        activate();
        return true;
      }
      await wait(intervalMs);
    }
    return false;
  } catch {
    return false;
  }
}
