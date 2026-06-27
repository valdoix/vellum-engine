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

export interface InjRecord { turn: number; at: number; chars: number; recallIds: string[]; text: string }

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
    host.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-inj-refresh]')) send({ type: 'vellum_get_injection' });
      const h = (e.target as HTMLElement).closest('[data-inj-toggle]');
      if (h) { const body = h.parentElement?.querySelector('.vle-inj-body'); if (body) (body as HTMLElement).classList.toggle('open'); }
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
  return '<div class="vle-inj">'
    + `<div class="vle-inj-top" data-inj-toggle><span class="vle-inj-turn">turn ${r.turn}</span>`
    + `<span class="vle-inj-reasons">${reasons}</span>`
    + `<span class="vle-inj-chars">${r.chars} ch</span></div>`
    + `<pre class="vle-inj-body">${esc(r.text)}</pre>`
    + '</div>';
}
