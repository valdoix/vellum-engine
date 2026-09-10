import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc } from '../format.js';
import { send, refreshUI } from '../bridge.js';

type Route = { source?: string; connectionId?: string; fallbackIds?: string[]; maxTokens?: number; timeoutMs?: number; temperature?: number; retries?: number; reasoning?: string; schema?: boolean };
type Connection = { id: string; name: string; provider: string; model: string; is_default?: boolean; has_api_key?: boolean };
type Finding = { code: string; severity: string; count: number; message: string };

interface Snapshot {
  revision: number;
  connections: Connection[];
  personal: { routes?: Record<string, Route> };
  chat: { routes?: Record<string, Route> };
  resolved: Record<string, Route & { resolvedConnectionId?: string; resolvedConnectionName?: string }>;
  health: { score: number; findings: Finding[]; counts: Record<string, number> };
  candidate?: { id: string; turns: number; events: number; createdAt: number; conflicts: number; findings: Finding[]; beforeCounts?: Record<string, number>; afterCounts?: Record<string, number> } | null;
  rollbackAvailable?: boolean;
  job?: { status: string; phase?: string; done?: number; total?: number; message?: string; deep?: boolean } | null;
}

const ROLES: Array<[string, string, string]> = [
  ['engine', 'Engine compiler', 'Structured state after each reply'],
  ['engineRetry', 'Engine retry', 'Repair or retry a failed compiler pass'],
  ['summaryDetail', 'Summary detail', 'Dense chapter, arc, and book archive'],
  ['summaryGist', 'Summary gist', 'Short Chronicle recap'],
  ['recall', 'Recall controller', 'Optional model-guided memory traversal'],
  ['offscreen', 'Living world', 'Off-screen and parallel events'],
  ['extractor', 'Memory extractor', 'Knowledge, secrets, journal, and state fallback'],
  ['blockRepair', 'Block repair', 'Reconstruct a missing or malformed state block'],
  ['reconstruction', 'Reconstruction', 'Whole-chat evidence rebuild'],
  ['maintenance', 'Maintenance', 'Thread, lore, and catch-up cleanup'],
];

let snap: Snapshot = { revision: 0, connections: [], personal: {}, chat: {}, resolved: {}, health: { score: 100, findings: [], counts: {} } };
let section = 'models';
let scope: 'chat' | 'personal' = 'chat';
let draft: Record<string, Route> | null = null;

export function setWorkbenchSnapshot(next: Partial<Snapshot>): void {
  snap = { ...snap, ...next, revision: snap.revision + 1 };
  draft = null;
  refreshUI();
}

export function setWorkbenchProgress(job: Snapshot['job'], candidate?: Snapshot['candidate']): void {
  snap = { ...snap, job, ...(candidate !== undefined ? { candidate } : {}), revision: snap.revision + 1 };
  refreshUI();
}

function activeRoutes(): Record<string, Route> {
  if (draft) return draft;
  const base = scope === 'personal' ? snap.personal.routes : snap.chat.routes;
  draft = JSON.parse(JSON.stringify(base ?? {}));
  return draft!;
}

function routeRow(role: string, label: string, hint: string): string {
  const routes = activeRoutes();
  const hasOwn = Object.prototype.hasOwnProperty.call(routes, role);
  const own = routes[role] ?? {};
  const resolved = snap.resolved[role] ?? {};
  const value = !hasOwn ? '__inherit' : own.source === 'default' ? '__default' : own.source === 'connection' && own.connectionId ? own.connectionId : '__main';
  const options = [
    `<option value="__inherit"${value === '__inherit' ? ' selected' : ''}>Use inherited route</option>`,
    `<option value="__main"${value === '__main' ? ' selected' : ''}>Follow current chat model</option>`,
    `<option value="__default"${value === '__default' ? ' selected' : ''}>Lumiverse default connection</option>`,
    ...snap.connections.map((c) => `<option value="${esc(c.id)}"${value === c.id ? ' selected' : ''}>${esc(c.name)} · ${esc(c.model || c.provider)}${c.is_default ? ' (default)' : ''}</option>`),
  ].join('');
  const status = resolved.resolvedConnectionName || (resolved.source === 'main' ? 'follows the current chat' : 'unresolved');
  const schemaControl = ['engine', 'engineRetry', 'extractor', 'blockRepair', 'reconstruction'].includes(role)
    ? `<label class="vlw-check"><input data-route-field="schema" type="checkbox"${own.schema === false ? '' : ' checked'}> Prefer structured schema</label>` : '';
  return `<article class="vlw-route" data-role="${role}">
    <div class="vlw-route-head"><div><b>${esc(label)}</b><small>${esc(hint)}</small></div><span>${esc(status)}</span></div>
    <label>Model<select data-route-field="connection">${options}</select></label>
    <label>Fallback connection ids<input data-route-field="fallbackIds" type="text" placeholder="optional, comma separated" value="${esc((own.fallbackIds ?? []).join(', '))}"></label>
    <div class="vlw-grid"><label>Max output<input data-route-field="maxTokens" type="number" min="64" max="128000" placeholder="task default" value="${own.maxTokens ?? ''}"></label>
    <label>Timeout (ms)<input data-route-field="timeoutMs" type="number" min="1000" max="900000" placeholder="task default" value="${own.timeoutMs ?? ''}"></label>
    <label>Temperature<input data-route-field="temperature" type="number" min="0" max="2" step="0.1" placeholder="task default" value="${own.temperature ?? ''}"></label>
    <label>Retries<input data-route-field="retries" type="number" min="0" max="8" placeholder="task default" value="${own.retries ?? ''}"></label>
    <label>Reasoning<select data-route-field="reasoning"><option value="off"${(own.reasoning ?? 'off') === 'off' ? ' selected' : ''}>Off</option><option value="inherit"${own.reasoning === 'inherit' ? ' selected' : ''}>Connection setting</option><option value="low"${own.reasoning === 'low' ? ' selected' : ''}>Low</option><option value="medium"${own.reasoning === 'medium' ? ' selected' : ''}>Medium</option><option value="high"${own.reasoning === 'high' ? ' selected' : ''}>High</option></select></label>
    ${schemaControl}</div>
  </article>`;
}

function models(): string {
  return `<section class="vlw-panel"><header><div><h3>Task models</h3><p>Route each internal job to a Lumiverse connection. API keys remain inside Lumiverse.</p></div><button data-wb="test">Test selected routes</button></header>
    <div class="vlw-scope"><button data-scope="chat" class="${scope === 'chat' ? 'on' : ''}">This chat</button><button data-scope="personal" class="${scope === 'personal' ? 'on' : ''}">Personal defaults</button></div>
    <div class="vlw-routes">${ROLES.map((r) => routeRow(...r)).join('')}</div>
    <footer><button data-wb="reset-routes">Reset ${scope === 'chat' ? 'chat overrides' : 'personal defaults'}</button><button class="primary" data-wb="save-routes">Save ${scope === 'chat' ? 'for this chat' : 'as personal defaults'}</button></footer></section>`;
}

function interventions(): string {
  const action = (id: string, title: string, text: string, strong = false) => `<button class="vlw-action${strong ? ' strong' : ''}" data-wb="${id}"><b>${title}</b><span>${text}</span></button>`;
  return `<section class="vlw-panel"><header><div><h3>Interventions</h3><p>Explicit controls for the next reply and focused recovery actions.</p></div></header>
    <h4>Story reply</h4><div class="vlw-actions">${action('refresh-now', 'Refresh prose now', 'Send ((refresh)) and generate one fresh continuation.', true)}${action('worldgen-now', 'Generate world now', 'Send ((worldgen)) through the active preset and Engine Pass.', true)}</div>
    <h4>Tracker repair</h4><div class="vlw-actions">${action('rescan', 'Rescan latest turn', 'Refold the latest saved prose.')}${action('repair', 'Repair state block', 'Reconstruct the latest malformed or missing block.')}${action('retry-engine', 'Retry Engine', 'Compile the held Engine candidate again.')}${action('reindex', 'Reindex recall', 'Discard the cached recall index and rebuild it.')}${action('summarize', 'Build summaries', 'Run the configured archive pipeline.')}</div>
    <p class="vlw-note">“Refresh prose” changes presentation for one reply. Rescan and repair change VELLUM’s derived tracker.</p></section>`;
}

function reconstruction(): string {
  const j = snap.job;
  const c = snap.candidate;
  const progress = j ? `<div class="vlw-progress"><b>${esc(j.phase || j.status)}</b><span>${esc(j.message || '')}</span>${j.total ? `<progress max="${j.total}" value="${j.done ?? 0}"></progress><small>${j.done ?? 0} / ${j.total} turns</small>` : ''}</div>` : '';
  const findings = c?.findings?.length ? `<ul class="vlw-findings">${c.findings.map((f) => `<li class="${esc(f.severity)}"><b>${esc(f.message)}</b><span>${f.count} · ${esc(f.code)}</span></li>`).join('')}</ul>` : '';
  const compare = c ? ['cast', 'knowledge', 'secrets', 'memories', 'threads', 'arcs', 'items', 'parallel'].map((key) => `<span><b>${c.beforeCounts?.[key] ?? 0} → ${c.afterCounts?.[key] ?? 0}</b>${esc(key)}</span>`).join('') : '';
  const candidate = c ? `<div class="vlw-candidate"><h4>Candidate ready</h4><p>${c.turns} turns · ${c.events} events · ${c.conflicts} integrity finding(s)</p><div class="vlw-counts">${compare}</div>${findings}<div class="vlw-actions"><button data-wb="discard-candidate">Discard</button><button class="primary" data-wb="apply-candidate">Apply with backup</button></div></div>` : '';
  return `<section class="vlw-panel"><header><div><h3>Reconstruction</h3><p>Read the active transcript, build a separate candidate, validate continuity, then apply atomically.</p></div></header>
    <div class="vlw-callout">The current chronicle stays live until you apply a verified candidate. User edits and configuration events are layered over reconstructed evidence. If the chat changes, the candidate is rejected as stale.</div>
    <div class="vlw-actions"><button data-wb="audit">Audit only</button><button class="strong" data-wb="reconstruct">Build full candidate</button>${j?.status === 'running' ? '<button data-wb="cancel-reconstruct">Stop safely</button>' : ''}${snap.rollbackAvailable ? '<button data-wb="rollback-reconstruct">Restore pre-reconstruction backup</button>' : ''}</div>${progress}${candidate}</section>`;
}

function health(): string {
  const h = snap.health;
  const findings = h.findings.length ? h.findings.map((f) => `<li class="${esc(f.severity)}"><b>${esc(f.message)}</b><span>${f.count} · ${esc(f.code)}</span></li>`).join('') : '<li class="ok"><b>No deterministic integrity problems found.</b><span>The transcript can still contain semantic contradictions that require reconstruction.</span></li>';
  return `<section class="vlw-panel"><header><div><h3>Health</h3><p>Fast structural checks over the active Chronicle and model routes.</p></div><button data-wb="audit">Run audit</button></header>
    <div class="vlw-score"><strong>${h.score}</strong><span>health score</span></div><div class="vlw-counts">${Object.entries(h.counts).map(([k, v]) => `<span><b>${v}</b>${esc(k)}</span>`).join('')}</div><ul class="vlw-findings">${findings}</ul></section>`;
}

function render(): string {
  const tabs = [['models', 'Models'], ['interventions', 'Interventions'], ['reconstruction', 'Reconstruction'], ['health', 'Health']];
  const body = section === 'interventions' ? interventions() : section === 'reconstruction' ? reconstruction() : section === 'health' ? health() : models();
  return `<div class="vlw"><nav>${tabs.map(([id, label]) => `<button data-wb-tab="${id}" class="${section === id ? 'on' : ''}">${label}</button>`).join('')}</nav>${body}</div>`;
}

function numeric(v: string): number | undefined { const n = Number(v); return v.trim() && Number.isFinite(n) ? n : undefined; }

export const workbenchTab: Component<ChronicleState> = {
  version: () => snap.revision + ':' + section + ':' + scope,
  render,
  mount: (host) => {
    send({ type: 'vellum_workbench_get' });
    host.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      const tab = target.closest('[data-wb-tab]');
      if (tab) { section = tab.getAttribute('data-wb-tab') || 'models'; refreshUI(); return; }
      const scopeBtn = target.closest('[data-scope]');
      if (scopeBtn) { scope = scopeBtn.getAttribute('data-scope') === 'personal' ? 'personal' : 'chat'; draft = null; refreshUI(); return; }
      const btn = target.closest('[data-wb]') as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      const op = btn.dataset.wb!;
      if (op === 'save-routes') send({ type: 'vellum_workbench_routes_set', scope, config: { version: 1, routes: activeRoutes() } });
      else if (op === 'reset-routes') { draft = {}; send({ type: 'vellum_workbench_routes_set', scope, config: { version: 1, routes: {} } }); }
      else if (op === 'test') send({ type: 'vellum_workbench_test_routes' });
      else if (op === 'refresh-now' || op === 'worldgen-now') send({ type: 'vellum_intervention', op });
      else if (op === 'rescan') send({ type: 'vellum_rescan' });
      else if (op === 'repair') send({ type: 'vellum_repair_block' });
      else if (op === 'retry-engine') send({ type: 'vellum_retry_engine' });
      else if (op === 'reindex') send({ type: 'vellum_workbench_reindex' });
      else if (op === 'summarize') send({ type: 'vellum_summarize' });
      else if (op === 'audit') send({ type: 'vellum_workbench_audit' });
      else if (op === 'reconstruct') send({ type: 'vellum_reconstruct_start', deep: true });
      else if (op === 'cancel-reconstruct') send({ type: 'vellum_reconstruct_cancel' });
      else if (op === 'apply-candidate') send({ type: 'vellum_reconstruct_apply', candidateId: snap.candidate?.id });
      else if (op === 'discard-candidate') send({ type: 'vellum_reconstruct_discard', candidateId: snap.candidate?.id });
      else if (op === 'rollback-reconstruct') send({ type: 'vellum_reconstruct_rollback' });
    });
    host.addEventListener('change', (ev) => {
      const input = (ev.target as HTMLElement).closest('[data-route-field]') as HTMLInputElement | HTMLSelectElement | null;
      const row = input?.closest('[data-role]') as HTMLElement | null;
      if (!input || !row) return;
      const role = row.dataset.role!;
      const routes = activeRoutes();
      const field = input.dataset.routeField!;
      if (field === 'connection') {
        if (input.value === '__inherit') { delete routes[role]; refreshUI(); return; }
        const route = routes[role] = { ...(routes[role] ?? { source: 'main' }) };
        if (input.value === '__main') { route.source = 'main'; delete route.connectionId; }
        else if (input.value === '__default') { route.source = 'default'; delete route.connectionId; }
        else { route.source = 'connection'; route.connectionId = input.value; }
      } else {
        const effective = snap.resolved[role] ?? { source: 'main' };
        const route = routes[role] = { ...(routes[role] ?? {
          source: effective.source ?? 'main',
          ...(effective.connectionId ? { connectionId: effective.connectionId } : {}),
        }) };
        if (field === 'schema') route.schema = (input as HTMLInputElement).checked;
        else if (field === 'reasoning') route.reasoning = input.value;
        else if (field === 'fallbackIds') route.fallbackIds = input.value.split(',').map((x) => x.trim()).filter(Boolean);
        else {
        const n = numeric(input.value);
        if (n === undefined) delete (route as any)[field]; else (route as any)[field] = n;
        }
      }
    });
  },
};
