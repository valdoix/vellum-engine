/**
 * Tiny modal form helper for CRUD across tabs. Builds a themed overlay with
 * labeled fields (text / textarea / select / checks), collects values, and
 * calls back. Self-contained DOM; no framework. Also a confirm() wrapper for
 * destructive actions. Field values for checkbox groups are comma-joined.
 */

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checks';
  value?: string | string[];
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function formModal(title: string, fields: Field[], onSave: (values: Record<string, string>) => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'vlfm-overlay';
  const fieldHtml = fields.map((f) => {
    if (f.type === 'textarea') return `<label class="vlfm-l">${esc(f.label)}<textarea class="vlfm-in vlfm-ta" data-f="${f.key}" placeholder="${esc(f.placeholder ?? '')}">${esc(f.value ?? '')}</textarea></label>`;
    if (f.type === 'select') {
      const opts = (f.options ?? []).map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(f.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
      return `<label class="vlfm-l">${esc(f.label)}<select class="vlfm-in" data-f="${f.key}">${opts}</select></label>`;
    }
    if (f.type === 'checks') {
      const sel = Array.isArray(f.value) ? f.value.map(String) : String(f.value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const boxes = (f.options ?? []).map((o) => `<label class="vlfm-chk"><input type="checkbox" data-fc="${f.key}" value="${esc(o.value)}"${sel.includes(String(o.value)) ? ' checked' : ''}> ${esc(o.label)}</label>`).join('');
      return `<div class="vlfm-l" data-fchecks="${f.key}">${esc(f.label)}<div class="vlfm-chkrow">${boxes}</div></div>`;
    }
    return `<label class="vlfm-l">${esc(f.label)}<input class="vlfm-in" data-f="${f.key}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder ?? '')}"></label>`;
  }).join('');
  overlay.innerHTML = `<div class="vlfm"><div class="vlfm-head"><span class="vlfm-mark">\u2756</span>${esc(title)}</div>`
    + `<div class="vlfm-body">${fieldHtml}</div>`
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-cancel>Cancel</button><button class="vlfm-btn vlfm-save" data-save>Save</button></div></div>';
  document.body.appendChild(overlay);

  const close = (): void => { try { overlay.remove(); } catch { /* ignore */ } };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-cancel]')!.addEventListener('click', close);
  overlay.querySelector('[data-save]')!.addEventListener('click', () => {
    const values: Record<string, string> = {};
    overlay.querySelectorAll('[data-f]').forEach((el) => { values[el.getAttribute('data-f')!] = (el as HTMLInputElement).value; });
    overlay.querySelectorAll('[data-fchecks]').forEach((grp) => {
      const key = grp.getAttribute('data-fchecks')!;
      values[key] = Array.from(grp.querySelectorAll('[data-fc]')).filter((c) => (c as HTMLInputElement).checked).map((c) => (c as HTMLInputElement).value).join(',');
    });
    close(); onSave(values);
  });
  const first = overlay.querySelector('.vlfm-in') as HTMLElement | null; first?.focus();
}

export function confirmModal(message: string): boolean {
  return confirm(message);
}
