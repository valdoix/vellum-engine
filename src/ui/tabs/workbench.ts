import type { Component } from '../component.js';
import type { ChronicleState } from '../../domain/types.js';
import { esc } from '../format.js';
import { send, refreshUI } from '../bridge.js';

type Route = { source?: string; connectionId?: string; fallbackIds?: string[]; maxTokens?: number; timeoutMs?: number; temperature?: number; retries?: number; reasoning?: string; schema?: boolean };
type Connection = { id: string; name: string; provider: string; model: string; is_default?: boolean; has_api_key?: boolean };
type Finding = { code: string; severity: string; count: number; message: string };
interface Snapshot {
  revision: number; connections: Connection[];
  personal: { routes?: Record<string, Route> }; chat: { routes?: Record<string, Route> };
  resolved: Record<string, Route & { resolvedConnectionId?: string; resolvedConnectionName?: string }>;
  health: { score: number; findings: Finding[]; counts: Record<string, number> };
  candidate?: { id: string; turns: number; events: number; createdAt: number; conflicts: number; findings: Finding[]; beforeCounts?: Record<string, number>; afterCounts?: Record<string, number> } | null;
  rollbackAvailable?: boolean;
  job?: { status: string; phase?: string; done?: number; total?: number; message?: string; deep?: boolean } | null;
}

const ROLES: Array<[string, string, string]> = [
  ['engine', 'Engine compiler', 'Structured state after each reply'],
  ['engineRetry', 'Engine repair', 'Patch a failed compiler draft without regenerating it'],
  ['summaryDetail', 'Summary detail', 'Dense chapter, arc, and book archive'],
  ['summaryGist', 'Summary gist', 'Short Chronicle recap'],
  ['recall', 'Recall controller', 'Optional model-guided memory traversal'],
  ['offscreen', 'Living world', 'Off-screen and parallel events'],
  ['extractor', 'Memory extractor', 'Knowledge, secrets, journal, and state fallback'],
  ['blockRepair', 'Block repair', 'Reconstruct a missing or malformed state block'],
  ['reconstruction', 'Reconstruction', 'Whole-chat evidence rebuild'],
  ['maintenance', 'Maintenance', 'Thread, lore, and catch-up cleanup'],
];
const ROLE_BY_ID = new Map(ROLES.map((role) => [role[0], role]));
const STRUCTURED_ROLES = new Set(['engine', 'engineRetry', 'extractor', 'blockRepair', 'reconstruction']);
const AUDIT_CHECK_COUNT = 13;
const TAB_META: Array<[string, string, string]> = [
  ['models', 'Models', '\u2723'], ['interventions', 'Interventions', '\u2301'],
  ['reconstruction', 'Reconstruction', '\u25a4'], ['health', 'Health', '\u2726'],
];

let snap: Snapshot = { revision: 0, connections: [], personal: {}, chat: {}, resolved: {}, health: { score: 100, findings: [], counts: {} } };
let section = 'models';
let scope: 'chat' | 'personal' = 'chat';
let selectedRole = 'engine';
let draft: Record<string, Route> | null = null;

export function setWorkbenchSnapshot(next: Partial<Snapshot>): void {
  snap = { ...snap, ...next, revision: snap.revision + 1 }; draft = null; refreshUI();
}
export function setWorkbenchProgress(job: Snapshot['job'], candidate?: Snapshot['candidate']): void {
  snap = { ...snap, job, ...(candidate !== undefined ? { candidate } : {}), revision: snap.revision + 1 }; refreshUI();
}
function activeRoutes(): Record<string, Route> {
  if (draft) return draft;
  const base = scope === 'personal' ? snap.personal.routes : snap.chat.routes;
  draft = JSON.parse(JSON.stringify(base ?? {})); return draft!;
}
function ownRoute(role: string): { own: Route; hasOwn: boolean } {
  const routes = activeRoutes(); return { own: routes[role] ?? {}, hasOwn: Object.prototype.hasOwnProperty.call(routes, role) };
}
function routeChoice(role: string): string {
  const { own, hasOwn } = ownRoute(role);
  if (!hasOwn) return '__inherit';
  if (own.source === 'default') return '__default';
  if (own.source === 'connection' && own.connectionId) return own.connectionId;
  return '__main';
}
function effectiveName(role: string): string {
  const resolved = snap.resolved[role] ?? {};
  if (resolved.resolvedConnectionName) return resolved.resolvedConnectionName;
  if (resolved.source === 'default') return 'Lumiverse default';
  if (resolved.source === 'main') return 'Current chat model';
  return 'Needs connection';
}
function connectionOptions(value: string): string {
  return [
    `<option value="__inherit"${value === '__inherit' ? ' selected' : ''}>Use inherited route</option>`,
    `<option value="__main"${value === '__main' ? ' selected' : ''}>Follow current chat model</option>`,
    `<option value="__default"${value === '__default' ? ' selected' : ''}>Lumiverse default connection</option>`,
    ...snap.connections.map((c) => `<option value="${esc(c.id)}"${value === c.id ? ' selected' : ''}>${esc(c.name)} · ${esc(c.model || c.provider)}${c.is_default ? ' (default)' : ''}</option>`),
  ].join('');
}
function statusPill(role: string): string {
  const resolved = snap.resolved[role] ?? {};
  const connected = resolved.source === 'main' || resolved.source === 'default' || !!resolved.resolvedConnectionId;
  return `<span class="vlw-pill ${connected ? 'good' : 'warn'}"><i></i>${connected ? 'Connected' : 'Review route'}</span>`;
}
function fallbackEditor(role: string, own: Route): string {
  const ids = own.fallbackIds ?? [];
  const chips = ids.length ? ids.map((id) => {
    const name = snap.connections.find((c) => c.id === id)?.name ?? id;
    return `<span class="vlw-route-node">${esc(name)}<button type="button" data-fallback-remove="${esc(id)}" aria-label="Remove ${esc(name)}">\u00d7</button></span>`;
  }).join('') : '<span class="vlw-empty-inline">No explicit fallback; VELLUM uses the task default.</span>';
  const choices = snap.connections.filter((c) => !ids.includes(c.id)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.model || c.provider)}</option>`).join('');
  return `<div class="vlw-fallback" data-role="${esc(role)}"><div class="vlw-route-path">${chips}</div><label>Add fallback<select data-fallback-add><option value="">Choose a connection…</option>${choices}</select></label></div>`;
}
function routeEditor(role: string): string {
  const [, label, hint] = ROLE_BY_ID.get(role) ?? ROLES[0]!;
  const { own } = ownRoute(role); const value = routeChoice(role);
  const schemaControl = STRUCTURED_ROLES.has(role)
    ? `<label class="vlw-check"><input data-route-field="schema" type="checkbox"${own.schema === false ? '' : ' checked'}><span><b>Structured schema</b><small>Ask compatible providers for constrained output.</small></span></label>` : '';
  return `<article class="vlw-card vlw-route-editor" data-role="${esc(role)}">
    <div class="vlw-card-head"><div><span class="vlw-label">Selected route</span><h3>${esc(label)}</h3><p>${esc(hint)}.</p></div>${statusPill(role)}</div>
    <div class="vlw-fields">
      <label class="wide">Connection<select data-route-field="connection">${connectionOptions(value)}</select></label>
      <label>Maximum output<input data-route-field="maxTokens" type="number" min="64" max="128000" placeholder="Task default" value="${own.maxTokens ?? ''}"></label>
      <label>Timeout (seconds)<input data-route-field="timeoutSeconds" type="number" min="1" max="900" placeholder="Task default" value="${own.timeoutMs ? Math.round(own.timeoutMs / 1000) : ''}"></label>
      <label>Extra attempts<input data-route-field="retries" type="number" min="0" max="8" placeholder="Task default" value="${own.retries ?? ''}"></label>
      <label>Temperature<input data-route-field="temperature" type="number" min="0" max="2" step="0.1" placeholder="Task default" value="${own.temperature ?? ''}"></label>
      <label>Reasoning<select data-route-field="reasoning"><option value="off"${(own.reasoning ?? 'off') === 'off' ? ' selected' : ''}>Off</option><option value="inherit"${own.reasoning === 'inherit' ? ' selected' : ''}>Connection setting</option><option value="low"${own.reasoning === 'low' ? ' selected' : ''}>Low</option><option value="medium"${own.reasoning === 'medium' ? ' selected' : ''}>Medium</option><option value="high"${own.reasoning === 'high' ? ' selected' : ''}>High</option></select></label>
      ${schemaControl}
    </div>
  </article>`;
}
function models(): string {
  const routes = activeRoutes(); const selected = ROLE_BY_ID.has(selectedRole) ? selectedRole : 'engine';
  const resolved = snap.resolved[selected] ?? {}; const own = routes[selected] ?? {};
  const rail = ROLES.map(([id, label]) => `<button class="vlw-role${selected === id ? ' on' : ''}" data-wb-role="${id}" aria-pressed="${selected === id}"><span>${esc(label)}</span><small>${Object.prototype.hasOwnProperty.call(routes, id) ? esc(effectiveName(id)) : 'inherit'}</small></button>`).join('');
  const primary = effectiveName(selected); const fallback = own.fallbackIds ?? [];
  return `<section class="vlw-panel" aria-labelledby="vlw-models-title"><header class="vlw-panel-head"><div><span class="vlw-label">Connections</span><h2 id="vlw-models-title">Task models</h2><p>Choose the model for each VELLUM job, how long it may work, and how it recovers.</p></div><button data-wb="test">Test routes</button></header>
    <div class="vlw-scope" aria-label="Route settings scope"><button data-scope="chat" class="${scope === 'chat' ? 'on' : ''}">This chat</button><button data-scope="personal" class="${scope === 'personal' ? 'on' : ''}">Personal defaults</button></div>
    <div class="vlw-model-layout"><aside class="vlw-role-rail"><span class="vlw-label">${scope === 'chat' ? 'This chat' : 'Your defaults'}</span><p>${ROLES.length} task routes · ${Object.keys(routes).length} override${Object.keys(routes).length === 1 ? '' : 's'}</p>${rail}</aside>
      <div class="vlw-model-cards">${routeEditor(selected)}
        <article class="vlw-card vlw-effective"><span class="vlw-label">Effective route</span><h3>${esc(primary)}</h3><p>${resolved.schema === false ? 'Plain text output' : 'Structured output when supported'} · ${resolved.maxTokens ? `${resolved.maxTokens.toLocaleString()} tokens` : 'task output default'}.</p><div class="vlw-meter"><i></i></div><small>Task settings resolve from chat, personal defaults, then VELLUM defaults.</small></article>
        <article class="vlw-card"><span class="vlw-label">Fallback chain</span><h3>Graceful recovery</h3>${fallbackEditor(selected, own)}</article>
      </div>
    </div>
    <footer><button data-wb="reset-routes">Reset ${scope === 'chat' ? 'chat overrides' : 'personal defaults'}</button><button class="primary" data-wb="save-routes">Save ${scope === 'chat' ? 'for this chat' : 'as defaults'}</button></footer>
  </section>`;
}
function actionCard(id: string, eyebrow: string, title: string, text: string, meta: string, tone = ''): string {
  return `<article class="vlw-card vlw-action-card ${tone}"><div><span class="vlw-label">${esc(eyebrow)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div><div class="vlw-action-foot"><span>${esc(meta)}</span><button data-wb="${esc(id)}">${id === 'retry-engine' ? 'Repair' : id === 'reindex' ? 'Reindex' : id === 'summarize' ? 'Build' : id === 'audit' ? 'Review' : 'Run'}</button></div></article>`;
}
function interventions(): string {
  return `<section class="vlw-panel" aria-labelledby="vlw-interventions-title"><header class="vlw-panel-head"><div><span class="vlw-label">Active chat</span><h2 id="vlw-interventions-title">Interventions</h2><p>Run a deliberate one-off operation. Every action says what it changes.</p></div><span class="vlw-pill good"><i></i>Chronicle ready</span></header>
    <article class="vlw-hero"><span class="vlw-hero-seal">\u21bb</span><div><span class="vlw-label">Story reply</span><h3>Refresh prose now</h3><p>Ask the active preset for one fresh continuation. Chronicle data stays unchanged until the new reply is folded.</p></div><button class="primary" data-wb="refresh-now">Refresh reply</button></article>
    <div class="vlw-action-grid">
      ${actionCard('worldgen-now', 'World-building', 'Generate world', 'Create one grounded living-world event from lorebooks, cards, chat history, and Chronicle evidence.', '((worldgen))', 'ready')}
      ${actionCard('rescan', 'Latest turn', 'Rescan prose', 'Fold the latest saved reply again and refresh its derived Chronicle data.', 'Derived data only')}
      ${actionCard('repair', 'State block', 'Repair latest block', 'Reconstruct a malformed or missing VELLUM block from the saved prose.', 'Uses repair route')}
      ${actionCard('retry-engine', 'Engine candidate', 'Repair held draft', 'Patch only the invalid or missing parts of the held Engine candidate with the configured repair route.', 'Held draft', 'attention')}
      ${actionCard('reindex', 'Recall', 'Reindex memory', 'Rebuild the searchable recall index from Chronicle evidence and attached lore.', 'Safe rebuild')}
      ${actionCard('summarize', 'Archive', 'Build summaries', 'Run pending chapters, arcs, and books through their selected summarizer routes.', 'Archive pipeline')}
      ${actionCard('audit', 'Continuity', 'Audit health', 'Inspect deterministic continuity findings before starting a reconstruction.', 'Read only', 'attention')}
    </div>
  </section>`;
}
function countComparison(c: NonNullable<Snapshot['candidate']>): string {
  const preferred = ['cast', 'knowledge', 'secrets', 'memories', 'threads', 'arcs', 'items', 'parallel'];
  return preferred.map((key) => `<span><b>${c.beforeCounts?.[key] ?? 0} <i>→</i> ${c.afterCounts?.[key] ?? 0}</b><small>${esc(key)}</small></span>`).join('');
}
function reconstructionLog(): string {
  const running = snap.job?.status === 'running'; const ready = !!snap.candidate;
  const rows = [['01', 'Read transcript evidence and preserve user-owned edits.'], ['02', 'Normalize events, identities, time, and source references.'], ['03', 'Cross-check cast, knowledge, secrets, items, and threads.'], ['04', 'Seal a reviewable candidate against the source revision.']];
  return `<div class="vlw-rebuild-log">${rows.map(([n, detail], index) => `<div class="vlw-log-row ${ready || (running && index === 0) ? 'done' : ''}"><b>${n}</b><span>${detail}</span></div>`).join('')}</div>`;
}
function reconstruction(): string {
  const j = snap.job; const c = snap.candidate;
  const progress = j ? `<div class="vlw-progress"><div><b>${esc(j.phase || j.status)}</b><span>${esc(j.message || '')}</span></div>${j.total ? `<progress max="${j.total}" value="${j.done ?? 0}"></progress><small>${j.done ?? 0} / ${j.total} turns</small>` : ''}</div>` : '';
  const findings = c?.findings?.length ? `<div class="vlw-findings">${c.findings.map((f) => `<div class="vlw-finding ${esc(f.severity)}"><span><b>${esc(f.message)}</b><small>${f.count} · ${esc(f.code)}</small></span><em>${f.severity === 'error' ? 'Review' : 'Found'}</em></div>`).join('')}</div>` : c ? '<div class="vlw-finding ok"><span><b>No deterministic conflicts found.</b><small>Candidate passed structural validation.</small></span><em>Verified</em></div>' : '';
  const candidate = c ? `<article class="vlw-card vlw-candidate"><div class="vlw-card-head"><div><span class="vlw-label">Candidate ready</span><h3>Transcript reconstruction · ${c.turns.toLocaleString()} turns</h3><p>${c.events.toLocaleString()} verified events assembled without changing the live Chronicle.</p></div><span class="vlw-pill ${c.conflicts ? 'warn' : 'good'}"><i></i>${c.conflicts ? 'Review findings' : 'Ready to apply'}</span></div><div class="vlw-counts">${countComparison(c)}</div>${findings}<div class="vlw-candidate-actions"><button data-wb="discard-candidate">Discard</button><button class="primary" data-wb="apply-candidate">Apply with backup</button></div></article>` : `<article class="vlw-card vlw-candidate-empty"><span class="vlw-label">No candidate yet</span><h3>Build from the complete transcript</h3><p>VELLUM will compare the result with your live Chronicle before anything can be applied.</p><button class="primary" data-wb="reconstruct">Build full candidate</button></article>`;
  return `<section class="vlw-panel" aria-labelledby="vlw-reconstruction-title"><header class="vlw-panel-head"><div><span class="vlw-label">Evidence recovery</span><h2 id="vlw-reconstruction-title">Reconstruction</h2><p>Build a separate Chronicle candidate from the whole transcript, review it, then apply it with a rollback point.</p></div><button data-wb="audit">Run fresh audit</button></header>
    <div class="vlw-callout">The current Chronicle remains live while VELLUM assembles the candidate. A candidate is rejected if the chat changes before apply.</div>
    ${progress}<div class="vlw-recovery-grid">${candidate}<aside><article class="vlw-card"><div class="vlw-card-head"><div><span class="vlw-label">Rebuild log</span><h3>${c ? 'Candidate sealed' : j?.status === 'running' ? 'Rebuild in progress' : 'Ready to begin'}</h3></div>${c ? '<span class="vlw-pill good"><i></i>Complete</span>' : ''}</div>${reconstructionLog()}${j?.status === 'running' ? '<button data-wb="cancel-reconstruct">Stop safely</button>' : ''}</article><article class="vlw-card vlw-backup"><span class="vlw-label">Rollback</span><h3>${snap.rollbackAvailable ? 'Backup available' : 'Created on apply'}</h3><p>${snap.rollbackAvailable ? 'Restore the Chronicle from immediately before the last reconstruction.' : 'Applying a candidate first writes a pre-reconstruction backup.'}</p>${snap.rollbackAvailable ? '<button data-wb="rollback-reconstruct">Restore backup</button>' : ''}</article></aside></div>
  </section>`;
}
function health(): string {
  const h = snap.health; const issueTypes = h.findings.length;
  const errors = h.findings.filter((f) => f.severity === 'error').reduce((n, f) => n + f.count, 0);
  const warnings = h.findings.filter((f) => f.severity === 'warning').reduce((n, f) => n + f.count, 0);
  const info = h.findings.filter((f) => f.severity === 'info').reduce((n, f) => n + f.count, 0);
  const passed = Math.max(0, AUDIT_CHECK_COUNT - issueTypes);
  const findings = h.findings.length ? h.findings.map((f) => `<div class="vlw-check-row ${esc(f.severity)}"><i>${f.severity === 'error' ? '!' : f.severity === 'warning' ? '△' : 'i'}</i><span><b>${esc(f.message)}</b><small>${f.count} finding${f.count === 1 ? '' : 's'} · ${esc(f.code)}</small></span><em>${f.severity}</em></div>`).join('') : '<div class="vlw-check-row ok"><i>✓</i><span><b>No deterministic integrity problems found.</b><small>Structural continuity checks passed.</small></span><em>clear</em></div>';
  const nextOp = errors ? 'reconstruct' : 'audit';
  const nextTitle = errors ? 'Build a reconstruction candidate' : warnings ? 'Review warnings before the next reply' : 'Chronicle is structurally healthy';
  const coverage = Object.entries(h.counts).map(([key, value]) => `<span><b>${value.toLocaleString()}</b><small>${esc(key)}</small></span>`).join('');
  return `<section class="vlw-panel" aria-labelledby="vlw-health-title"><header class="vlw-panel-head"><div><span class="vlw-label">Continuity audit</span><h2 id="vlw-health-title">Chronicle health</h2><p>Fast deterministic checks across active state, evidence ownership, archive coverage, and narrative time.</p></div><button data-wb="audit">Run audit</button></header>
    <div class="vlw-health-summary"><article class="vlw-card vlw-health-score"><div class="vlw-score-ring" style="--vlw-score:${Math.max(0, Math.min(100, h.score)) * 3.6}deg"><strong>${h.score}</strong><small>health</small></div><p>${errors ? 'Repair recommended' : warnings ? 'Review recommended' : 'Structurally sound'}</p></article><div class="vlw-health-stats"><article class="vlw-card"><span class="vlw-label">Passed</span><b>${passed}</b><p>check groups clear</p></article><article class="vlw-card"><span class="vlw-label">Review</span><b>${warnings + info}</b><p>non-blocking findings</p></article><article class="vlw-card"><span class="vlw-label">Repair</span><b>${errors}</b><p>integrity failures</p></article></div></div>
    <div class="vlw-health-grid"><article class="vlw-card"><div class="vlw-card-head"><div><span class="vlw-label">Integrity ledger</span><h3>${issueTypes ? `${issueTypes} check group${issueTypes === 1 ? '' : 's'} need attention` : 'All checked systems are clear'}</h3></div></div><div class="vlw-check-list">${findings}</div></article><aside><article class="vlw-card vlw-next"><span class="vlw-label">Recommended next step</span><h3>${esc(nextTitle)}</h3><p>${errors ? 'The live Chronicle stays unchanged while VELLUM builds a reviewable recovery candidate.' : warnings ? 'Open each finding below before deciding whether reconstruction is needed.' : 'You can keep playing or rerun the audit after a major story transition.'}</p><button class="primary" data-wb="${nextOp}">${errors ? 'Open reconstruction' : 'Run audit again'}</button></article><article class="vlw-card"><span class="vlw-label">Audit coverage</span><div class="vlw-coverage">${coverage}</div></article></aside></div>
  </section>`;
}
function render(): string {
  const body = section === 'interventions' ? interventions() : section === 'reconstruction' ? reconstruction() : section === 'health' ? health() : models();
  const issueCount = snap.health.findings.reduce((n, f) => n + f.count, 0);
  const tabs = TAB_META.map(([id, label, icon]) => `<button id="vlw-tab-${id}" role="tab" aria-controls="vlw-panel" aria-selected="${section === id}" data-wb-tab="${id}" class="${section === id ? 'on' : ''}"><i>${icon}</i>${label}${id === 'health' && issueCount ? `<em>${issueCount}</em>` : ''}</button>`).join('');
  return `<div class="vlw"><nav role="tablist" aria-label="Workbench sections">${tabs}</nav><main id="vlw-panel" role="tabpanel" aria-labelledby="vlw-tab-${section}">${body}</main></div>`;
}
function numeric(v: string): number | undefined { const n = Number(v); return v.trim() && Number.isFinite(n) ? n : undefined; }

export const workbenchTab: Component<ChronicleState> = {
  version: () => snap.revision + ':' + section + ':' + scope + ':' + selectedRole,
  render,
  mount: (host) => {
    send({ type: 'vellum_workbench_get' });
    host.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      const tab = target.closest('[data-wb-tab]');
      if (tab) { section = tab.getAttribute('data-wb-tab') || 'models'; refreshUI(); return; }
      const roleBtn = target.closest('[data-wb-role]');
      if (roleBtn) { selectedRole = roleBtn.getAttribute('data-wb-role') || 'engine'; refreshUI(); return; }
      const scopeBtn = target.closest('[data-scope]');
      if (scopeBtn) { scope = scopeBtn.getAttribute('data-scope') === 'personal' ? 'personal' : 'chat'; draft = null; refreshUI(); return; }
      const remove = target.closest('[data-fallback-remove]');
      if (remove) {
        const route = activeRoutes()[selectedRole] = { ...(activeRoutes()[selectedRole] ?? snap.resolved[selectedRole] ?? { source: 'main' }) };
        route.fallbackIds = (route.fallbackIds ?? []).filter((id) => id !== remove.getAttribute('data-fallback-remove'));
        refreshUI(); return;
      }
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
      else if (op === 'audit') { section = 'health'; send({ type: 'vellum_workbench_audit' }); refreshUI(); }
      else if (op === 'reconstruct') { section = 'reconstruction'; send({ type: 'vellum_reconstruct_start', deep: true }); refreshUI(); }
      else if (op === 'cancel-reconstruct') send({ type: 'vellum_reconstruct_cancel' });
      else if (op === 'apply-candidate') send({ type: 'vellum_reconstruct_apply', candidateId: snap.candidate?.id });
      else if (op === 'discard-candidate') send({ type: 'vellum_reconstruct_discard', candidateId: snap.candidate?.id });
      else if (op === 'rollback-reconstruct') send({ type: 'vellum_reconstruct_rollback' });
    });
    host.addEventListener('change', (ev) => {
      const target = ev.target as HTMLElement;
      const fallbackAdd = target.closest('[data-fallback-add]') as HTMLSelectElement | null;
      if (fallbackAdd?.value) {
        const route = activeRoutes()[selectedRole] = { ...(activeRoutes()[selectedRole] ?? snap.resolved[selectedRole] ?? { source: 'main' }) };
        route.fallbackIds = [...new Set([...(route.fallbackIds ?? []), fallbackAdd.value])].slice(0, 4);
        refreshUI(); return;
      }
      const input = target.closest('[data-route-field]') as HTMLInputElement | HTMLSelectElement | null;
      const row = input?.closest('[data-role]') as HTMLElement | null;
      if (!input || !row) return;
      const role = row.dataset.role!; const routes = activeRoutes(); const field = input.dataset.routeField!;
      if (field === 'connection') {
        if (input.value === '__inherit') { delete routes[role]; refreshUI(); return; }
        const route = routes[role] = { ...(routes[role] ?? { source: 'main' }) };
        if (input.value === '__main') { route.source = 'main'; delete route.connectionId; }
        else if (input.value === '__default') { route.source = 'default'; delete route.connectionId; }
        else { route.source = 'connection'; route.connectionId = input.value; }
      } else {
        const effective = snap.resolved[role] ?? { source: 'main' };
        const route = routes[role] = { ...(routes[role] ?? { source: effective.source ?? 'main', ...(effective.connectionId ? { connectionId: effective.connectionId } : {}) }) };
        if (field === 'schema') route.schema = (input as HTMLInputElement).checked;
        else if (field === 'reasoning') route.reasoning = input.value;
        else {
          const n = numeric(input.value); const normalizedField = field === 'timeoutSeconds' ? 'timeoutMs' : field;
          if (n === undefined) delete (route as any)[normalizedField];
          else (route as any)[normalizedField] = field === 'timeoutSeconds' ? Math.round(n * 1000) : n;
        }
      }
    });
  },
};
