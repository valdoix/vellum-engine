/**
 * Tiny modal form helper for CRUD across tabs. Builds a themed overlay with
 * labeled fields (text / textarea / select / checks), collects values, and
 * calls back. Self-contained DOM; no framework. Also a confirm() wrapper for
 * destructive actions. Field values for checkbox groups are comma-joined.
 */

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checks' | 'color' | 'number' | 'section';
  value?: string | string[];
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  big?: boolean; // textarea: render tall (for long content like summaries)
  min?: number;  // number: min / max / step
  max?: number;
  step?: number;
  hint?: string; // small helper line under the field
  adv?: boolean; // group into a collapsed "Advanced" <details> fold
}

export interface FormModalOpts {
  large?: boolean;
  /** extra buttons in the footer (left of Cancel/Save). Each gets the live field
   * values and may mutate inputs in place via the provided setField helper. */
  actions?: Array<{ label: string; onClick: (setField: (key: string, value: string) => void, getField: (key: string) => string) => void }>;
  saveLabel?: string;
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Keep Tab focus cycling WITHIN the overlay so keyboard users can't tab into the
 * page behind an open modal. Returns a keydown handler to register/remove. */
function makeFocusTrap(overlay: HTMLElement): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const items = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0]!, last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !overlay.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };
}

export function formModal(title: string, fields: Field[], onSave: (values: Record<string, string>) => void, opts?: FormModalOpts): void {
  const overlay = document.createElement('div');
  overlay.className = 'vlfm-overlay';
  const renderField = (f: Field): string => {
    const hint = f.hint ? `<span class="vlfm-hint">${esc(f.hint)}</span>` : '';
    if (f.type === 'section') return `<div class="vlfm-section">${esc(f.label)}${hint}</div>`;
    if (f.type === 'textarea') return `<label class="vlfm-l${f.big ? ' vlfm-l-grow' : ''}">${esc(f.label)}${hint}<textarea class="vlfm-in vlfm-ta${f.big ? ' vlfm-ta-big' : ''}" data-f="${f.key}" placeholder="${esc(f.placeholder ?? '')}">${esc(f.value ?? '')}</textarea></label>`;
    if (f.type === 'number') {
      const attrs = `${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}${f.step !== undefined ? ` step="${f.step}"` : ''}`;
      return `<label class="vlfm-l">${esc(f.label)}${hint}<input type="number" class="vlfm-in" data-f="${f.key}" value="${esc(f.value ?? '')}"${attrs}></label>`;
    }
    if (f.type === 'select') {
      const opts2 = (f.options ?? []).map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(f.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
      return `<label class="vlfm-l">${esc(f.label)}${hint}<select class="vlfm-in" data-f="${f.key}">${opts2}</select></label>`;
    }
    if (f.type === 'checks') {
      const sel = Array.isArray(f.value) ? f.value.map(String) : String(f.value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const boxes = (f.options ?? []).map((o) => `<label class="vlfm-chk"><input type="checkbox" data-fc="${f.key}" value="${esc(o.value)}"${sel.includes(String(o.value)) ? ' checked' : ''}> ${esc(o.label)}</label>`).join('');
      return `<div class="vlfm-l" data-fchecks="${f.key}">${esc(f.label)}${hint}<div class="vlfm-chkrow">${boxes}</div></div>`;
    }
    if (f.type === 'color') {
      const v = String(f.value ?? '');
      return `<div class="vlfm-l" data-fcolor="${f.key}">${esc(f.label)}${hint}<div class="vlfm-colrow">`
        + `<input type="color" class="vlfm-col" data-fcol="${f.key}" value="${esc(v || '#cda84e')}">`
        + `<label class="vlfm-chk"><input type="checkbox" data-fcolnone="${f.key}"${v ? '' : ' checked'}> none</label></div></div>`;
    }
    return `<label class="vlfm-l">${esc(f.label)}${hint}<input class="vlfm-in" data-f="${f.key}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder ?? '')}"></label>`;
  };
  // fields flagged adv:true collapse into one "Advanced" <details> fold at the end
  const mainFields = fields.filter((f) => !f.adv);
  const advFields = fields.filter((f) => f.adv);
  const fieldHtml = mainFields.map(renderField).join('')
    + (advFields.length ? `<details class="vlfm-adv"><summary>Advanced</summary>${advFields.map(renderField).join('')}</details>` : '');
  const actionBtns = (opts?.actions ?? []).map((a, i) => `<button class="vlfm-btn vlfm-act" data-act="${i}">${esc(a.label)}</button>`).join('');
  overlay.innerHTML = `<div class="vlfm${opts?.large ? ' vlfm-large' : ''}"><div class="vlfm-head"><span class="vlfm-mark">\u2756</span>${esc(title)}</div>`
    + `<div class="vlfm-body">${fieldHtml}</div>`
    + `<div class="vlfm-foot">${actionBtns}<span class="vlfm-foot-sp"></span><button class="vlfm-btn vlfm-cancel" data-cancel>Cancel</button><button class="vlfm-btn vlfm-save" data-save>${esc(opts?.saveLabel ?? 'Save')}</button></div></div>`;
  document.body.appendChild(overlay);

  // Remember what had focus so we can restore it when the modal closes (a11y).
  const prevFocus = document.activeElement as HTMLElement | null;
  const trap = makeFocusTrap(overlay);
  overlay.addEventListener('keydown', trap);
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  const close = (): void => { try { overlay.remove(); } catch { /* ignore */ } if (onKey) document.removeEventListener('keydown', onKey); try { prevFocus?.focus?.(); } catch { /* ignore */ } };
  const save = (): void => {
    const values: Record<string, string> = {};
    overlay.querySelectorAll('[data-f]').forEach((el) => { values[el.getAttribute('data-f')!] = (el as HTMLInputElement).value; });
    overlay.querySelectorAll('[data-fchecks]').forEach((grp) => {
      const key = grp.getAttribute('data-fchecks')!;
      values[key] = Array.from(grp.querySelectorAll('[data-fc]')).filter((c) => (c as HTMLInputElement).checked).map((c) => (c as HTMLInputElement).value).join(',');
    });
    overlay.querySelectorAll('[data-fcolor]').forEach((grp) => {
      const key = grp.getAttribute('data-fcolor')!;
      const none = (grp.querySelector('[data-fcolnone]') as HTMLInputElement)?.checked;
      values[key] = none ? '' : ((grp.querySelector('[data-fcol]') as HTMLInputElement)?.value ?? '');
    });
    close(); onSave(values);
  };
  // COLOR FIELD UX: each color field pairs a picker with a "none" checkbox that
  // starts CHECKED when the value is empty. Touching the picker must clear "none",
  // else the save path (which honors "none") writes '' and the pick is lost — the
  // dialogue-color persistence bug (that field defaults empty, so "none" is checked
  // by default and picking a color never un-checked it).
  overlay.querySelectorAll('[data-fcol]').forEach((col) => {
    col.addEventListener('input', () => {
      const key = col.getAttribute('data-fcol')!;
      const none = overlay.querySelector(`[data-fcolnone="${key}"]`) as HTMLInputElement | null;
      if (none) none.checked = false;
    });
  });
  // intentionally no backdrop-close: only the Cancel/Done button (or Esc) dismisses
  overlay.querySelector('[data-cancel]')!.addEventListener('click', close);
  overlay.querySelector('[data-save]')!.addEventListener('click', save);
  // footer action buttons (e.g. "Reset to default"): mutate fields in place,
  // never close the modal.
  const setField = (key: string, value: string): void => { const el = overlay.querySelector(`[data-f="${key}"]`) as HTMLInputElement | HTMLTextAreaElement | null; if (el) el.value = value; };
  const getField = (key: string): string => ((overlay.querySelector(`[data-f="${key}"]`) as HTMLInputElement | null)?.value ?? '');
  (opts?.actions ?? []).forEach((a, i) => {
    overlay.querySelector(`[data-act="${i}"]`)?.addEventListener('click', (e) => { e.preventDefault(); a.onClick(setField, getField); });
  });
  // Esc closes; Enter saves ONLY from a single-line input AND only when the form
  // has no big textareas (a prompt editor must let Enter insert newlines and not
  // submit). Number/select inputs still submit on Enter for the small dialogs.
  const hasTextarea = fields.some((f) => f.type === 'textarea');
  onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !hasTextarea && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); save(); }
  };
  document.addEventListener('keydown', onKey);
  const first = overlay.querySelector('.vlfm-in') as HTMLElement | null; first?.focus();
}

/**
 * Themed confirm dialog (replaces window.confirm). Callback-based to match
 * formModal: `onConfirm` runs only on confirm. Overlay-click + Esc cancel,
 * Enter confirms, the Confirm button is focused.
 * 
 * Prefers the host's native showConfirm API when available (no permission
 * required), falling back to the DOM implementation on older hosts.
 */
export function confirmModal(message: string, onConfirm: () => void): void {
  const s: any = (globalThis as any).spindle;
  if (s?.ui?.showConfirm) {
    // Host API available: use the native themed confirmation dialog
    Promise.resolve(s.ui.showConfirm({ message, title: 'Confirm' }))
      .then((result: any) => { if (result?.confirmed) onConfirm(); })
      .catch(() => confirmModalDom(message, onConfirm)); // fall back on API error
    return;
  }
  // Fallback: use the DOM implementation
  confirmModalDom(message, onConfirm);
}

/**
 * DOM implementation of the confirm modal. Used as fallback when the host
 * showConfirm API is not available. Renamed from the original confirmModal.
 */
function confirmModalDom(message: string, onConfirm: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'vlfm-overlay';
  overlay.innerHTML = `<div class="vlfm vlfm-confirm"><div class="vlfm-head"><span class="vlfm-mark">\u2756</span>Confirm</div>`
    + `<div class="vlfm-body"><p class="vlfm-msg">${esc(message)}</p></div>`
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-cancel>Cancel</button><button class="vlfm-btn vlfm-save" data-confirm>Confirm</button></div></div>';
  document.body.appendChild(overlay);

  const prevFocus = document.activeElement as HTMLElement | null;
  const trap = makeFocusTrap(overlay);
  overlay.addEventListener('keydown', trap);
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  const close = (): void => { try { overlay.remove(); } catch { /* ignore */ } if (onKey) document.removeEventListener('keydown', onKey); try { prevFocus?.focus?.(); } catch { /* ignore */ } };
  const confirmIt = (): void => { close(); onConfirm(); };
  // intentionally no backdrop-close: only the Cancel/Done button (or Esc) dismisses
  overlay.querySelector('[data-cancel]')!.addEventListener('click', close);
  overlay.querySelector('[data-confirm]')!.addEventListener('click', confirmIt);
  onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); confirmIt(); }
  };
  document.addEventListener('keydown', onKey);
  (overlay.querySelector('[data-confirm]') as HTMLElement | null)?.focus();
}
