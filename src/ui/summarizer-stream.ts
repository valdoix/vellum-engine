/** Live, non-modal summarizer window. The backend sends real generation chunks;
 * this module only renders them and never invents progress. */

export interface SummarizerStreamPayload {
  type: 'vellum_summarizer_stream';
  runId: string;
  mode?: 'auto' | 'manual' | 'resummarize' | 'pick' | 'arc';
  event: 'start' | 'progress' | 'chunk' | 'complete' | 'failed';
  phase?: 'prepare' | 'detail' | 'gist' | 'archive';
  status?: 'start' | 'chunk' | 'reasoning' | 'retry' | 'done' | 'failed';
  kind?: 'chapter' | 'arc' | 'book';
  sourceCount?: number;
  covers?: [number, number];
  attempt?: number;
  delta?: string;
  text?: string;
  tokens?: number;
  message?: string;
  total?: number;
  rounds?: number;
  auto?: boolean;
  cancelled?: boolean;
  reason?: string;
}

interface LiveSummary {
  runId: string;
  mode: string;
  auto: boolean;
  phase: 'prepare' | 'detail' | 'gist' | 'archive';
  status: string;
  sourceCount: number;
  covers: [number, number] | null;
  attempt: number;
  tokens: number;
  done: number;
  total: number;
  detail: string;
  gist: string;
  message: string;
  finished: boolean;
  failed: boolean;
  cancelled: boolean;
}

let live: LiveSummary | null = null;
let panel: HTMLElement | null = null;
let sendCancel: (() => void) | null = null;
const dismissed = new Set<string>();

const phaseLabel = (phase: LiveSummary['phase']): string => phase === 'prepare'
  ? 'Preparing source window'
  : phase === 'detail' ? 'Writing durable detail'
    : phase === 'gist' ? 'Condensing chronicle gist' : 'Filing verified archive';

const modeLabel = (mode: string): string => mode === 'resummarize' ? 'Rebuild'
  : mode === 'pick' ? 'Selected turns' : mode === 'book' ? 'Book' : mode === 'arc' ? 'Arc' : mode === 'auto' ? 'Automatic' : 'Manual';

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

function ensurePanel(): HTMLElement | null {
  if (panel?.isConnected) return panel;
  try {
    panel = document.createElement('section');
    panel.className = 'vle-sumwin';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Live summarizer process');
    panel.innerHTML = `
      <header class="vle-sumwin-head">
        <span class="vle-sumwin-pulse" aria-hidden="true"></span>
        <span class="vle-sumwin-title">Summarizer</span>
        <span class="vle-sumwin-mode" data-sum-mode></span>
        <button class="vle-sumwin-icon" type="button" data-sum-min aria-label="Minimize summarizer">\u2212</button>
        <button class="vle-sumwin-icon" type="button" data-sum-close aria-label="Close summarizer">\u00d7</button>
      </header>
      <div class="vle-sumwin-body">
        <div class="vle-sumwin-status"><span data-sum-status aria-live="polite"></span><span data-sum-tokens></span></div>
        <div class="vle-sumwin-track"><span data-sum-bar></span></div>
        <div class="vle-sumwin-meta" data-sum-meta></div>
        <section class="vle-sumwin-pass" data-sum-detail-wrap>
          <div class="vle-sumwin-passhead"><span>Durable detail + retrieval keys</span><span data-sum-detail-count></span></div>
          <pre class="vle-sumwin-output" data-sum-detail></pre>
        </section>
        <section class="vle-sumwin-pass" data-sum-gist-wrap hidden>
          <div class="vle-sumwin-passhead"><span>Chronicle gist</span><span data-sum-gist-count></span></div>
          <pre class="vle-sumwin-output vle-sumwin-output--gist" data-sum-gist></pre>
        </section>
      </div>
      <footer class="vle-sumwin-foot"><span data-sum-rounds></span><button type="button" class="vle-sumwin-stop" data-sum-stop>Stop safely</button></footer>`;
    panel.querySelector('[data-sum-min]')?.addEventListener('click', () => {
      panel?.classList.toggle('is-min');
      const min = panel?.querySelector('[data-sum-min]');
      if (min) min.textContent = panel?.classList.contains('is-min') ? '\u25a1' : '\u2212';
    });
    panel.querySelector('[data-sum-close]')?.addEventListener('click', () => {
      if (live) dismissed.add(live.runId);
      panel?.remove();
      panel = null;
    });
    panel.querySelector('[data-sum-stop]')?.addEventListener('click', () => {
      const button = panel?.querySelector('[data-sum-stop]') as HTMLButtonElement | null;
      if (button) { button.disabled = true; button.textContent = 'Stopping\u2026'; }
      sendCancel?.();
    });
    document.body.appendChild(panel);
    return panel;
  } catch { return null; }
}

function setText(selector: string, text: string): void {
  const el = panel?.querySelector(selector);
  if (el) el.textContent = text;
}

function setOutput(selector: string, text: string): void {
  const el = panel?.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  const follow = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  el.textContent = text;
  if (follow) el.scrollTop = el.scrollHeight;
}

function percent(s: LiveSummary): number {
  if (s.finished) return 100;
  const within = s.phase === 'prepare' ? 5 : s.phase === 'detail' ? 55 : s.phase === 'gist' ? 82 : 95;
  return Math.max(2, Math.min(98, ((s.done + within / 100) / Math.max(1, s.total)) * 100));
}

function render(): void {
  if (!live || dismissed.has(live.runId) || !ensurePanel()) return;
  panel!.classList.toggle('is-done', live.finished && !live.failed);
  panel!.classList.toggle('is-failed', live.failed);
  setText('[data-sum-mode]', modeLabel(live.mode));
  const status = live.cancelled ? 'Stopped safely; original turns remain available.'
    : live.failed ? (live.message || 'Summarizer stopped before filing.')
      : live.finished ? (live.done > 0 ? 'Complete. The archive record passed coverage checks.' : 'No complete source window was filed; original turns remain available.')
      : live.status === 'reasoning' ? `${phaseLabel(live.phase)} \u00b7 model is reasoning\u2026`
        : live.status === 'retry' ? (live.message || `${phaseLabel(live.phase)} \u00b7 retry ${live.attempt}`)
          : live.message || phaseLabel(live.phase);
  setText('[data-sum-status]', status);
  setText('[data-sum-tokens]', live.tokens ? `~${fmtTokens(live.tokens)} tokens` : '');
  const bar = panel!.querySelector('[data-sum-bar]') as HTMLElement | null;
  if (bar) bar.style.width = `${percent(live)}%`;
  const span = live.covers ? `Turns ${live.covers[0]}\u2013${live.covers[1]}` : 'Resolving source span';
  setText('[data-sum-meta]', `${span} \u00b7 ${live.sourceCount || '\u2014'} source records \u00b7 attempt ${live.attempt}`);
  setOutput('[data-sum-detail]', live.detail);
  setText('[data-sum-detail-count]', live.detail ? `${live.detail.length.toLocaleString()} chars` : 'waiting');
  const gistWrap = panel!.querySelector('[data-sum-gist-wrap]') as HTMLElement | null;
  if (gistWrap) gistWrap.hidden = !live.gist && live.phase !== 'gist' && live.phase !== 'archive' && !live.finished;
  setOutput('[data-sum-gist]', live.gist);
  setText('[data-sum-gist-count]', live.gist ? `${live.gist.length.toLocaleString()} chars` : 'waiting');
  setText('[data-sum-rounds]', `${live.done}/${live.total} window${live.total === 1 ? '' : 's'} filed`);
  const stop = panel!.querySelector('[data-sum-stop]') as HTMLButtonElement | null;
  if (stop) { stop.hidden = live.finished; stop.disabled = false; stop.textContent = 'Stop safely'; }
}

export function handleSummarizerStream(payload: SummarizerStreamPayload, cancel: () => void): void {
  if (!payload?.runId) return;
  sendCancel = cancel;
  if (payload.event === 'start') {
    dismissed.delete(payload.runId);
    live = {
      runId: payload.runId, mode: payload.mode ?? 'manual', auto: !!payload.auto,
      phase: 'prepare', status: 'start', sourceCount: 0, covers: null, attempt: 1,
      tokens: 0, done: 0, total: Math.max(1, Number(payload.total) || 1), detail: '', gist: '',
      message: 'Preparing the first source window', finished: false, failed: false, cancelled: false,
    };
    panel?.remove(); panel = null;
    render();
    return;
  }
  if (!live || live.runId !== payload.runId || dismissed.has(payload.runId)) return;
  if (payload.phase) live.phase = payload.phase;
  if (payload.status) live.status = payload.status;
  if (payload.kind) live.mode = payload.mode ?? live.mode;
  if (typeof payload.sourceCount === 'number') live.sourceCount = payload.sourceCount;
  if (Array.isArray(payload.covers) && payload.covers.length === 2) live.covers = payload.covers;
  if (typeof payload.attempt === 'number') live.attempt = payload.attempt;
  if (typeof payload.tokens === 'number') live.tokens = Math.max(live.tokens, payload.tokens);
  if (payload.message) live.message = payload.message;
  if (payload.event === 'progress' && payload.phase === 'prepare' && payload.status === 'start') {
    live.detail = '';
    live.gist = '';
  }
  if (payload.status === 'done' && typeof payload.text === 'string') {
    if (payload.phase === 'gist') live.gist = payload.text;
    else if (payload.phase === 'detail') live.detail = payload.text;
  }
  if (payload.event === 'chunk' && payload.delta) {
    if (payload.phase === 'gist') live.gist += payload.delta;
    else live.detail += payload.delta;
    live.message = phaseLabel(live.phase);
  } else if (payload.event === 'complete' || payload.event === 'failed') {
    live.finished = true;
    live.failed = payload.event === 'failed';
    live.cancelled = !!payload.cancelled;
    if (typeof payload.rounds === 'number') live.done = payload.rounds;
    if (!live.cancelled && payload.event === 'failed') live.message = payload.reason ? `Summarizer stopped: ${payload.reason}` : 'Summarizer stopped before filing.';
  }
  render();
}

export function updateSummarizerRound(done: number, total: number, tokens: number): void {
  if (!live || live.finished) return;
  live.done = Math.max(live.done, done);
  live.total = Math.max(live.total, total, done);
  live.tokens = Math.max(live.tokens, tokens);
  render();
}

export function cleanupSummarizerStream(): void {
  try { panel?.remove(); } catch { /* ignore */ }
  panel = null;
  live = null;
  sendCancel = null;
  dismissed.clear();
}
