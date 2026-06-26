/**
 * A tiny component model with a built-in error boundary. Every panel is a
 * Component; if its render throws, the boundary shows a placeholder and logs —
 * it can NEVER take down the rest of the tab. This makes the legacy
 * "one graph throw freezes the Relations tab" bug impossible by construction.
 *
 * Components subscribe to a slice of state and only re-render when that slice's
 * version changes, so a turn patches only what changed (no full innerHTML churn,
 * no lost scroll/focus, no listener re-binding).
 */

export interface Component<S> {
  /** Build the panel's HTML from its state slice. Pure; may throw safely. */
  render(state: S): string;
  /** Called once after the element is in the DOM — attach delegated listeners. */
  mount?(el: HTMLElement): void;
  /** Optional: which version of the slice this render reflects (skip if equal). */
  version?(state: S): string | number;
}

export interface Mounted<S> {
  el: HTMLElement;
  update(state: S, force?: boolean): void;
  destroy(): void;
}

function escapeText(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * Mount a component into a host element with an error boundary. Returns an
 * updater that re-renders only when the component's version changes.
 */
export function mount<S>(host: HTMLElement, comp: Component<S>, initial: S, name = 'panel'): Mounted<S> {
  const el = document.createElement('div');
  el.className = 'vlm-comp';
  el.setAttribute('data-comp', name);
  host.appendChild(el);

  let lastVersion: string | number | undefined;
  let mounted = false;

  const safeRender = (state: S): string => {
    try {
      return comp.render(state);
    } catch (e) {
      try { console.warn(`[vellum] component "${name}" render failed:`, e); } catch { /* ignore */ }
      return `<div class="vlm-comp-error">This panel hit an error and was skipped.<br><span>${escapeText(name)} — the rest of the view is unaffected.</span></div>`;
    }
  };

  const doMount = (): void => {
    if (mounted || !comp.mount) return;
    try { comp.mount(el); mounted = true; } catch (e) { try { console.warn(`[vellum] component "${name}" mount failed:`, e); } catch { /* ignore */ } }
  };

  const update = (state: S, force = false): void => {
    const v = comp.version ? comp.version(state) : undefined;
    if (!force && v !== undefined && v === lastVersion) return; // slice unchanged → skip
    lastVersion = v;
    el.innerHTML = safeRender(state);
    doMount();
  };

  update(initial);
  return {
    el,
    update,
    destroy(): void { try { el.remove(); } catch { /* ignore */ } },
  };
}

/** Centralized HTML-attribute/text escaping. Use for ALL model-authored text. */
export { escapeText as escape };
