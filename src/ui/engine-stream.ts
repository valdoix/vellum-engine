/** Live, non-modal Engine Second Pass window. It renders only provider content
 * chunks and the validated canonical block sent by the backend. Reasoning tokens
 * are never exposed; they only change the activity label. */

import { attachFloatingDrag } from './floating-drag.js';

export interface EngineStreamPayload {
  type: 'vellum_engine_stream';
  runId: string;
  event: 'start' | 'progress' | 'chunk' | 'complete' | 'failed';
  status?: 'start' | 'requesting' | 'chunk' | 'reasoning' | 'retry' | 'validating' | 'validated' | 'failed';
  turn?: number;
  attempt?: number;
  delta?: string;
  text?: string;
  message?: string;
  errors?: string[];
  reason?: string;
}

interface LiveEngine {
  runId: string;
  turn: number;
  attempt: number;
  status: string;
  output: string;
  message: string;
  finished: boolean;
  failed: boolean;
  retrying: boolean;
  repairing: boolean;
}

let live: LiveEngine | null = null;
let panel: HTMLElement | null = null;
let sendRetry: (() => void) | null = null;
let detachDrag: (() => void) | null = null;
const dismissed = new Set<string>();

function ensurePanel(): HTMLElement | null {
  if (panel?.isConnected) return panel;
  try {
    panel = document.createElement('section');
    panel.className = 'vle-sumwin vle-engwin';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Live Engine Second Pass');
    panel.innerHTML = `
      <header class="vle-sumwin-head">
        <span class="vle-sumwin-pulse" aria-hidden="true"></span>
        <span class="vle-sumwin-title">Engine Pass</span>
        <span class="vle-sumwin-mode" data-eng-turn></span>
        <button class="vle-sumwin-icon" type="button" data-eng-min aria-label="Minimize Engine Pass">\u2212</button>
        <button class="vle-sumwin-icon" type="button" data-eng-close aria-label="Close Engine Pass">\u00d7</button>
      </header>
      <div class="vle-sumwin-body">
        <div class="vle-sumwin-status"><span data-eng-status aria-live="polite"></span><span class="vle-engwin-attempt" data-eng-attempt></span></div>
        <div class="vle-sumwin-track"><span data-eng-bar></span></div>
        <section class="vle-sumwin-pass">
          <div class="vle-sumwin-passhead"><span data-eng-file-label>Generated VELLUM file</span><span data-eng-count></span></div>
          <pre class="vle-sumwin-output vle-engwin-output" data-eng-output></pre>
        </section>
      </div>
      <footer class="vle-sumwin-foot"><span data-eng-foot>Compiler output is validated before filing.</span><button type="button" class="vle-sumwin-stop vle-engwin-retry" data-eng-retry>Repair Engine</button></footer>`;
    panel.querySelector('[data-eng-min]')?.addEventListener('click', () => {
      panel?.classList.toggle('is-min');
      const min = panel?.querySelector('[data-eng-min]');
      if (min) min.textContent = panel?.classList.contains('is-min') ? '\u25a1' : '\u2212';
    });
    panel.querySelector('[data-eng-close]')?.addEventListener('click', () => {
      if (live) dismissed.add(live.runId);
      detachDrag?.(); detachDrag = null;
      panel?.remove();
      panel = null;
    });
    panel.querySelector('[data-eng-retry]')?.addEventListener('click', () => {
      if (!live || live.retrying || !live.finished) return;
      live.retrying = true;
      live.message = `Repairing the held compiler draft for turn ${live.turn}\u2026`;
      render();
      sendRetry?.();
    });
    document.body.appendChild(panel);
    const handle = panel.querySelector('.vle-sumwin-head') as HTMLElement | null;
    if (handle) detachDrag = attachFloatingDrag(panel, handle, 'engine');
    return panel;
  } catch { return null; }
}

function setText(selector: string, text: string): void {
  const el = panel?.querySelector(selector);
  if (el) el.textContent = text;
}

function setOutput(text: string): void {
  const el = panel?.querySelector('[data-eng-output]') as HTMLElement | null;
  if (!el) return;
  const follow = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  el.textContent = text;
  if (follow) el.scrollTop = el.scrollHeight;
}

function progressWidth(status: string, finished: boolean): number {
  if (finished) return 100;
  if (status === 'validated') return 94;
  if (status === 'validating') return 82;
  if (status === 'chunk' || status === 'reasoning') return 58;
  if (status === 'requesting') return 22;
  if (status === 'retry') return 18;
  return 7;
}

function render(): void {
  if (!live || dismissed.has(live.runId) || !ensurePanel()) return;
  panel!.classList.toggle('is-done', live.finished && !live.failed);
  panel!.classList.toggle('is-failed', live.failed);
  setText('[data-eng-turn]', `Turn ${live.turn || '\u2014'}`);
  const status = live.retrying ? live.message
    : live.failed ? (live.message || 'The candidate could not be filed. You can repair it safely.')
      : live.finished ? 'Complete. The verified VELLUM file was applied to the Chronicle.'
        : live.status === 'reasoning' ? (live.repairing ? 'The repair model is checking the rejected draft\u2026' : 'The compiler is reasoning\u2026')
          : live.status === 'validating' ? (live.repairing ? 'Applying and validating the repair patch\u2026' : 'Validating the completed file\u2026')
            : live.status === 'validated' ? 'File validated; committing it to the Chronicle\u2026'
              : live.status === 'retry' ? (live.message || 'Preparing a minimal repair patch for the rejected draft\u2026')
                : live.status === 'chunk' ? (live.repairing ? 'Writing the repair patch\u2026' : 'Writing the VELLUM file\u2026')
                  : live.status === 'requesting' ? (live.repairing ? 'Waiting for the model to begin the repair patch\u2026' : 'Waiting for the model to begin the VELLUM file\u2026')
                    : 'Preparing the state compiler\u2026';
  setText('[data-eng-status]', status);
  setText('[data-eng-file-label]', live.status === 'retry' || (live.repairing && live.status === 'chunk')
    ? 'Streaming repair patch'
    : live.repairing ? 'Patched VELLUM file' : 'Generated VELLUM file');
  setText('[data-eng-attempt]', live.repairing ? `repair ${Math.max(1, live.attempt - 1)}` : `attempt ${live.attempt}`);
  setText('[data-eng-count]', live.output ? `${live.output.length.toLocaleString()} chars` : 'waiting');
  setOutput(live.output);
  const bar = panel!.querySelector('[data-eng-bar]') as HTMLElement | null;
  if (bar) bar.style.width = `${progressWidth(live.status, live.finished)}%`;
  const retry = panel!.querySelector('[data-eng-retry]') as HTMLButtonElement | null;
  if (retry) {
    retry.hidden = !live.finished;
    retry.disabled = live.retrying;
    retry.textContent = live.retrying ? 'Repairing\u2026' : 'Repair Engine';
  }
  setText('[data-eng-foot]', live.failed ? 'The rejected draft and patch were not applied.' : live.finished ? `Turn ${live.turn} is filed.` : 'Compiler output is validated before filing.');
}

export function handleEngineStream(payload: EngineStreamPayload, retry: () => void): void {
  if (!payload?.runId) return;
  sendRetry = retry;
  if (payload.event === 'start') {
    dismissed.delete(payload.runId);
    live = {
      runId: payload.runId,
      turn: Math.max(0, Number(payload.turn) || 0),
      attempt: 1,
      status: 'start',
      output: '',
      message: '',
      finished: false,
      failed: false,
      retrying: false,
      repairing: false,
    };
    detachDrag?.(); detachDrag = null; panel?.remove(); panel = null;
    render();
    return;
  }
  if (!live || live.runId !== payload.runId || dismissed.has(payload.runId)) return;
  if (typeof payload.turn === 'number') live.turn = payload.turn;
  if (typeof payload.attempt === 'number') live.attempt = payload.attempt;
  if (payload.status) live.status = payload.status;
  if (payload.status === 'retry') live.repairing = true;
  if (payload.message) live.message = payload.message;
  if (payload.status === 'retry') live.output = '';
  if ((payload.status === 'validating' || payload.status === 'validated') && typeof payload.text === 'string') live.output = payload.text;
  if (payload.event === 'chunk' && payload.delta) {
    live.output += payload.delta;
    live.message = '';
  } else if (payload.event === 'complete' || payload.event === 'failed') {
    live.finished = true;
    live.failed = payload.event === 'failed';
    live.retrying = false;
    if (payload.reason && !payload.message) live.message = String(payload.reason).replace(/_/g, ' ');
    if (Array.isArray(payload.errors) && payload.errors.length) live.message = String(payload.errors[0]);
  }
  render();
}

/** Releases a Retry button when the backend rejects the request before a new
 * stream can start (disabled pass, missing turn, missing permission, etc.). */
export function settleEngineRetry(payload: { ok?: boolean; reason?: string; errors?: unknown[] }): void {
  if (!live) return;
  live.retrying = false;
  if (payload.ok === false && !live.failed) {
    live.finished = true;
    live.failed = true;
    live.message = Array.isArray(payload.errors) && payload.errors.length
      ? String(payload.errors[0])
      : payload.reason ? `Retry could not start: ${String(payload.reason).replace(/_/g, ' ')}` : 'Retry could not start.';
  }
  render();
}

export function cleanupEngineStream(): void {
  detachDrag?.(); detachDrag = null;
  try { panel?.remove(); } catch { /* ignore */ }
  panel = null;
  live = null;
  sendRetry = null;
  dismissed.clear();
}
