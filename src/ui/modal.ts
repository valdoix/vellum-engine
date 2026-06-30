/**
 * Tiny modal form helper for CRUD across tabs. Builds a themed overlay with
 * labeled fields (text / textarea / select / checks), collects values, and
 * calls back. Self-contained DOM; no framework. Also a confirm() wrapper for
 * destructive actions. Field values for checkbox groups are comma-joined.
 */

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checks' | 'color' | 'number';
  value?: string | string[];
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  big?: boolean; // textarea: render tall (for long content like summaries)
  min?: number;  // number: min / max / step
  max?: number;
  step?: number;
  hint?: string; // small helper line under the field
}

export interface FormModalOpts {
  large?: boolean;
  /** extra buttons in the footer (left of Cancel/Save). Each gets the live field
   * values and may mutate inputs in place via the provided setField helper. */
  actions?: Array<{ label: string; onClick: (setField: (key: string, value: string) => void, getField: (key: string) => string) => void }>;
  saveLabel?: string;
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function formModal(title: string, fields: Field[], onSave: (values: Record<string, string>) => void, opts?: FormModalOpts): void {
  const overlay = document.createElement('div');
  overlay.className = 'vlfm-overlay';
  const fieldHtml = fields.map((f) => {
    const hint = f.hint ? `<span class="vlfm-hint">${esc(f.hint)}</span>` : '';
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
      // a color input + a "none" checkbox so the user can clear back to default ink.
      // Empty value (none checked) is collected as '' → upsert clears the color.
      const v = String(f.value ?? '');
      return `<div class="vlfm-l" data-fcolor="${f.key}">${esc(f.label)}${hint}<div class="vlfm-colrow">`
        + `<input type="color" class="vlfm-col" data-fcol="${f.key}" value="${esc(v || '#cda84e')}">`
        + `<label class="vlfm-chk"><input type="checkbox" data-fcolnone="${f.key}"${v ? '' : ' checked'}> none</label></div></div>`;
    }
    return `<label class="vlfm-l">${esc(f.label)}${hint}<input class="vlfm-in" data-f="${f.key}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder ?? '')}"></label>`;
  }).join('');
  const actionBtns = (opts?.actions ?? []).map((a, i) => `<button class="vlfm-btn vlfm-act" data-act="${i}">${esc(a.label)}</button>`).join('');
  overlay.innerHTML = `<div class="vlfm${opts?.large ? ' vlfm-large' : ''}"><div class="vlfm-head"><span class="vlfm-mark">\u2756</span>${esc(title)}</div>`
    + `<div class="vlfm-body">${fieldHtml}</div>`
    + `<div class="vlfm-foot">${actionBtns}<span class="vlfm-foot-sp"></span><button class="vlfm-btn vlfm-cancel" data-cancel>Cancel</button><button class="vlfm-btn vlfm-save" data-save>${esc(opts?.saveLabel ?? 'Save')}</button></div></div>`;
  document.body.appendChild(overlay);

  let onKey: ((e: KeyboardEvent) => void) | null = null;
  const close = (): void => { try { overlay.remove(); } catch { /* ignore */ } if (onKey) document.removeEventListener('keydown', onKey); };
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
 */
export function confirmModal(message: string, onConfirm: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'vlfm-overlay';
  overlay.innerHTML = `<div class="vlfm vlfm-confirm"><div class="vlfm-head"><span class="vlfm-mark">\u2756</span>Confirm</div>`
    + `<div class="vlfm-body"><p class="vlfm-msg">${esc(message)}</p></div>`
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-cancel>Cancel</button><button class="vlfm-btn vlfm-save" data-confirm>Confirm</button></div></div>';
  document.body.appendChild(overlay);

  let onKey: ((e: KeyboardEvent) => void) | null = null;
  const close = (): void => { try { overlay.remove(); } catch { /* ignore */ } if (onKey) document.removeEventListener('keydown', onKey); };
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
