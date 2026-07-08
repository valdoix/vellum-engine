import { esc } from './format.js';
import { applyTheme } from './theme.js';

/**
 * First-run onboarding overlay. Shows a short, keyboard-navigable carousel the
 * first time the VELLUM panel opens, and can be re-opened any time from the
 * Actions ▸ Help item. The "seen" flag lives in localStorage (a pure UI
 * preference — never gate onboarding on a host permission), so it survives
 * reloads without touching the chronicle or requiring storage permission.
 *
 * Fully static copy (no model data), but everything still runs through esc() to
 * keep the one-escaping-path convention. Rendering is wrapped so a guide failure
 * can never block the panel.
 */

const SEEN_KEY = 'vellum2.onboarded';

export function hasOnboarded(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markOnboarded(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

interface Step { title: string; body: string }

const STEPS: Step[] = [
  {
    title: 'Welcome to VELLUM',
    body: 'VELLUM gives your roleplay a living memory. It watches each scene and quietly tracks your cast, their relationships, what they secretly know, and what happened long ago \u2014 then feeds the relevant history back to the AI every turn. Everything runs automatically; you don\u2019t have to manage it.',
  },
  {
    title: 'Just play a turn',
    body: 'Send a message and let the AI reply. VELLUM reads a small hidden report at the end of each reply and builds your chronicle from it. You\u2019ll never see that report \u2014 it\u2019s hidden from the chat and stripped from the AI\u2019s future context so it never piles up.',
  },
  {
    title: 'The panel',
    body: '<b>Now</b> \u2014 the live scene, who\u2019s present, mood & tension.<br><b>Cast</b> \u2014 every character, editable.<br><b>Bonds</b> \u2014 relationships as affection + trust.<br><b>Chronicle</b> \u2014 timeline, memory, knowledge, secrets, scars, codex.<br><b>Director</b> \u2014 steer upcoming beats.<br><b>Journal</b> \u2014 per-character memory books.<br><b>Graph</b> \u2014 a map of your relationship web.<br><b>Vault</b> \u2014 your lorebook entries.<br><b>Context</b> \u2014 exactly what was injected this turn.',
  },
  {
    title: 'The preset (recommended)',
    body: 'For the best results, import the companion preset <b>vellum-ii.json</b> in the preset area. It shapes literary prose, enforces \u201ccharacters only know what they witnessed,\u201d and hands VELLUM clean structured data each turn. Open its Prompt Variables menu to set POV, length, tone, and content level \u2014 the README documents every setting.',
  },
  {
    title: 'Permissions',
    body: 'Without <b>interceptor</b>, no memory is fed to the AI. Without <b>generation</b>, auto-summaries and off-screen simulation stop. Without <b>world_books</b>, the Vault is unavailable. Without <b>memories</b>, recall still works but keyword-only. Everything runs inside your Lumiverse instance \u2014 nothing leaves it.',
  },
  {
    title: 'If anything looks off',
    body: 'Use the toolbar\u2019s <b>Actions</b> menu: <b>Rescan</b> re-reads the last turn, <b>Rebuild</b> reconstructs the whole chronicle from the transcript, <b>Recover</b> restores from the automatic backup, and <b>Undo</b> drops the latest turn. Chronicles are per-chat and survive extension updates.',
  },
  {
    title: 'You\u2019re set',
    body: 'That\u2019s everything. Reopen this guide any time from <b>Actions \u25B8 Help / Guide</b>. Enjoy the story.',
  },
];

/**
 * Open the onboarding carousel. Keyboard: \u2190/\u2192 or Back/Next buttons navigate;
 * Esc or Skip closes; Finish/Skip set the "seen" flag. Returns nothing; safe to
 * call repeatedly. `onClose` fires after the overlay is removed.
 */
export function openOnboarding(onClose?: () => void): void {
  try {
    let i = 0;
    const ov = document.createElement('div');
    ov.className = 'vlfm-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'VELLUM guide');

    const prevFocus = document.activeElement as HTMLElement | null;
    let onKey: ((e: KeyboardEvent) => void) | null = null;
    const close = (): void => {
      markOnboarded();
      try { ov.remove(); } catch { /* ignore */ }
      if (onKey) document.removeEventListener('keydown', onKey);
      try { prevFocus?.focus?.(); } catch { /* ignore */ }
      onClose?.();
    };

    const render = (): void => {
      const s = STEPS[i]!;
      const dots = STEPS.map((_, n) => `<span class="vlob-dot${n === i ? ' on' : ''}"></span>`).join('');
      const first = i === 0, last = i === STEPS.length - 1;
      ov.innerHTML = '<div class="vlfm vle-root vlob" style="width:min(460px,94vw)">'
        + `<div class="vlfm-head"><span class="vlfm-mark">\u2756</span>${esc(s.title)}</div>`
        + `<div class="vlfm-body vlob-body">${s.body}</div>`
        + `<div class="vlob-dots">${dots}</div>`
        + '<div class="vlfm-foot">'
        + `<button class="vlfm-btn" data-ob-skip>${last ? '' : 'Skip'}</button>`
        + '<span class="vlfm-foot-sp"></span>'
        + (first ? '' : '<button class="vlfm-btn" data-ob-back>Back</button>')
        + `<button class="vlfm-btn vlfm-save" data-ob-next>${last ? 'Done' : 'Next'}</button>`
        + '</div></div>';
      applyTheme(ov.querySelector('.vlfm') as HTMLElement);
      (ov.querySelector('[data-ob-next]') as HTMLElement | null)?.focus();
    };

    const next = (): void => { if (i < STEPS.length - 1) { i++; render(); } else { close(); } };
    const back = (): void => { if (i > 0) { i--; render(); } };

    ov.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-ob-skip]')) { close(); return; }
      if (t.closest('[data-ob-back]')) { back(); return; }
      if (t.closest('[data-ob-next]')) { next(); return; }
    });
    onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    document.addEventListener('keydown', onKey);

    document.body.appendChild(ov);
    render();
  } catch (e) {
    // A guide failure must never block the panel. Log and mark seen so it
    // doesn't retry-loop on every open.
    try { console.warn('[vellum] onboarding failed:', e); } catch { /* ignore */ }
    markOnboarded();
    onClose?.();
  }
}

/** Show the guide only on the very first panel open (flag unset). */
export function maybeShowOnboarding(): void {
  if (!hasOnboarded()) openOnboarding();
}
