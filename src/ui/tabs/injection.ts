import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc } from '../format.js';
import { send } from '../bridge.js';

/**
 * Injection tab — a window into what VELLUM fed the model each turn and why.
 * Data lives backend-side (the interceptor's ring); this tab requests it and
 * renders each turn's injected text with its recall reasons. Transparency for
 * tuning recall — you can see exactly what context the model received.
 */

export interface InjTrace { scene: string; candidateIds: string[]; selectedIds: string[] }
export interface InjTreeTrace { scene: string; steps: Array<{ frontier: string[]; expand: string[]; select: string[] }>; selectedIds: string[] }
export interface InjRecord { turn: number; at: number; chars: number; recallIds: string[]; text: string; source?: string; trace?: InjTrace | InjTreeTrace }

// module-held latest injection log (filled by app.ts on vellum_injection)
let _log: InjRecord[] = [];
export function setInjectionLog(log: InjRecord[]): void { _log = Array.isArray(log) ? log : []; }
/** Fix 11 — live feed: prepend a streamed record (newest first), keep last 20. */
export function pushInjectionRecord(r: InjRecord): void { if (r) { _log = [r, ..._log].slice(0, 20); } }

export const injectionTab: Component<ChronicleState> = {
  version: () => _log.length + ':' + (_log[0]?.at ?? 0),
  render() {
    const head = '<div class="vle-sec-top"><span class="vle-inj-hint">What VELLUM injected each turn, and why.</span><button class="vle-add" data-inj-refresh>\u27F3 Refresh</button></div>';
    if (!_log.length) return head + '<div class="vle-empty sm">Nothing injected yet. Play a turn with recall active, then refresh.</div>';
    return head + '<div class="vle-inj-list">' + _log.map(record).join('') + '</div>';
  },
  mount(host) {
    const toggle = (h: Element): void => { const body = h.parentElement?.querySelector('.vle-inj-body'); if (body) (body as HTMLElement).classList.toggle('open'); };
    host.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-inj-refresh]')) send({ type: 'vellum_get_injection' });
      const h = (e.target as HTMLElement).closest('[data-inj-toggle]');
      if (h) toggle(h);
    });
    // Keyboard parity for the role="button" toggle: Enter/Space activate it.
    host.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== 'Enter' && ke.key !== ' ' && ke.key !== 'Spacebar') return;
      const h = (ke.target as HTMLElement).closest('[data-inj-toggle]');
      if (h) { ke.preventDefault(); toggle(h); }
    });
    send({ type: 'vellum_get_injection' }); // pull on open
  },
};

function record(r: InjRecord): string {
  // split into the labeled blocks ([CAST & BONDS] / [CHRONICLE RECALL]) for readability
  const blocks = r.text.split(/\n(?=\[)/).map((b) => b.trim()).filter(Boolean);
  const reasons = blocks.map((b) => {
    const m = b.match(/^\[([^\]]+)\]/);
    const label = m ? m[1]!.split('\u2014')[0]!.trim() : 'block';
    const lines = b.replace(/^\[[^\]]*\]\s*/, '').split('\n').filter(Boolean).length;
    return `<span class="vle-inj-reason">${esc(label)} \u00b7 ${lines} line${lines === 1 ? '' : 's'}</span>`;
  }).join('');
  // source badge: traversal (controller-picked) vs hybrid/lexical (deterministic)
  const srcLabel = r.source === 'traversal-tree' ? '\u2748 tree' : r.source === 'traversal' ? '\u2748 traversal' : r.source;
  const src = r.source ? `<span class="vle-inj-src vle-inj-src-${esc(r.source)}">${esc(srcLabel ?? '')}</span>` : '';
  return '<div class="vle-inj">'
    + `<div class="vle-inj-top" data-inj-toggle role="button" tabindex="0" aria-label="Toggle injected text for turn ${r.turn}"><span class="vle-inj-turn">turn ${r.turn}</span>`
    + `<span class="vle-inj-reasons">${src}${reasons}</span>`
    + `<span class="vle-inj-chars">${r.chars} ch</span></div>`
    + traceHtml(r.trace)
    + `<pre class="vle-inj-body">${esc(r.text)}</pre>`
    + '</div>';
}

/** Render the controller-traversal trace — flat (scene + candidates→selected) or
 * tree (the step-by-step arc→chapter→leaf drill, LoreRecall-style). */
function traceHtml(t?: InjTrace | InjTreeTrace): string {
  if (!t) return '';
  if ('steps' in t && Array.isArray(t.steps)) return treeTraceHtml(t);
  const f = t as InjTrace;
  const sel = new Set(f.selectedIds);
  const chips = f.candidateIds.map((id) => `<span class="vle-inj-cand${sel.has(id) ? ' on' : ''}">${esc(id)}</span>`).join('');
  return '<div class="vle-inj-trace">'
    + `<div class="vle-inj-scene">scene: ${esc(f.scene)}</div>`
    + `<div class="vle-inj-cands">${f.selectedIds.length}/${f.candidateIds.length} selected ${chips}</div>`
    + '</div>';
}

/** Tree drill: one row per controller step showing what it expanded vs selected. */
function treeTraceHtml(t: InjTreeTrace): string {
  const sel = new Set(t.selectedIds);
  const steps = t.steps.map((s, i) => {
    const exp = s.expand.map((id) => `<span class="vle-inj-cand exp">\u2192 ${esc(id)}</span>`).join('');
    const sl = s.select.map((id) => `<span class="vle-inj-cand on">\u2714 ${esc(id)}</span>`).join('');
    return `<div class="vle-inj-step"><span class="vle-inj-stepn">drill ${i + 1}</span>`
      + `<span class="vle-inj-stepf">${s.frontier.length} in view</span>${exp}${sl}</div>`;
  }).join('');
  return '<div class="vle-inj-trace vle-inj-tree">'
    + `<div class="vle-inj-scene">scene: ${esc(t.scene)}</div>`
    + steps
    + `<div class="vle-inj-cands">${sel.size} injected</div>`
    + '</div>';
}
