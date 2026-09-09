export interface FloatingPoint { left: number; top: number }

const positions = new Map<string, FloatingPoint>();

export function clampFloatingPosition(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 8,
): FloatingPoint {
  return {
    left: Math.max(margin, Math.min(left, Math.max(margin, viewportWidth - width - margin))),
    top: Math.max(margin, Math.min(top, Math.max(margin, viewportHeight - height - margin))),
  };
}

/** Make a fixed floating panel draggable from its header. Positions are kept per
 * window for this frontend session and clamped whenever the viewport or panel
 * size changes, so a dragged window cannot become unreachable. */
export function attachFloatingDrag(panel: HTMLElement, handle: HTMLElement, key: string): () => void {
  let activePointer: number | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let dragged = false;

  const place = (point: FloatingPoint): void => {
    const rect = panel.getBoundingClientRect();
    const next = clampFloatingPosition(point.left, point.top, rect.width, rect.height, window.innerWidth, window.innerHeight);
    panel.style.width = `${Math.min(rect.width, Math.max(0, window.innerWidth - 16))}px`;
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    positions.set(key, next);
  };
  const keepVisible = (): void => {
    const point = positions.get(key);
    if (point) place(point);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || (event.target as Element | null)?.closest('button,a,input,select,textarea')) return;
    const rect = panel.getBoundingClientRect();
    activePointer = event.pointerId;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    dragged = false;
    panel.classList.add('is-dragging');
    try { handle.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (activePointer !== event.pointerId) return;
    dragged = true;
    place({ left: event.clientX - offsetX, top: event.clientY - offsetY });
    event.preventDefault();
  };
  const stop = (event: PointerEvent): void => {
    if (activePointer !== event.pointerId) return;
    activePointer = null;
    panel.classList.remove('is-dragging');
    try { handle.releasePointerCapture(event.pointerId); } catch { /* capture may already be released */ }
    if (dragged) event.preventDefault();
  };

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  window.addEventListener('resize', keepVisible);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(keepVisible) : null;
  observer?.observe(panel);
  keepVisible();

  return () => {
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', stop);
    handle.removeEventListener('pointercancel', stop);
    window.removeEventListener('resize', keepVisible);
    observer?.disconnect();
    panel.classList.remove('is-dragging');
  };
}
