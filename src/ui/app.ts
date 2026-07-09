import { STYLES } from './styles.js';
import { FONT_FACES } from './fonts.js';
import { mount, type Mounted } from './component.js';
import { freshState, type ChronicleState } from '../domain/types.js';
import { chronicleTab, setBeatSuggestions, setTurnLog } from './tabs/chronicle.js';
import { directorTab, setDirectorDirectives, setDirectorNextScene } from './tabs/director.js';
import { castTab } from './tabs/cast.js';
import { relationsTab, setRelationLocks } from './tabs/relations.js';
import { graphTab, resetGraphCache } from './tabs/graph.js';
import { journalTab } from './tabs/journal.js';
import { injectionTab, setInjectionLog, pushInjectionRecord } from './tabs/injection.js';
import { vaultTab, setVaultSnap } from './tabs/vault.js';
import { createFloatWindow, type FloatWindow } from './float.js';
import { applyTheme, customizePanel, wireCustomize, setThemePersist, hydrateTheme } from './theme.js';
import { setPrefsPersist, hydratePrefs, getPref, setPref } from './prefs.js';
import { reloadLayoutFromPrefs } from './layout-defs.js';
import { reloadAutoNameFromPrefs } from './format.js';
import { dashboardHtml, setPhoneSection, setSysInfo, setDashCalendar } from './dashboard.js';
import { formatDate } from '../domain/date-format.js';
import { visibleCast } from '../domain/cast-hygiene.js';
import { esc } from './format.js';
import { icon, hasIcon } from './icons.js';
import type { Component } from './component.js';
import { wireBridge, wirePagers, wireFilters, refreshUI, send, cmd } from './bridge.js';
import { confirmModal, formModal } from './modal.js';
import { maybeShowOnboarding, openOnboarding } from './onboarding.js';

/**
 * Frontend entrypoint. One reusable shell (tab bar + QOL toolbar + body) is
 * mounted into BOTH the drawer tab and a beautiful floating window, so they
 * stay in lockstep. Each panel is an isolated Component with an error boundary,
 * so one panel's failure can never freeze the others. New tab = a Component +
 * one entry in TABS.
 */

interface Ctx {
  ui: {
    registerDrawerTab(opts: Record<string, unknown>): { root: HTMLElement; destroy(): void };
    registerInputBarAction?(opts: Record<string, unknown>): { destroy(): void };
  };
  dom: { addStyle(css: string): { remove(): void }; cleanup(): void };
  sendToBackend(payload: Record<string, unknown>): void;
  onBackendMessage(handler: (payload: any) => void): () => void;
  events?: { on(name: string, fn: (p: any) => void): () => void };
  toast?: { info?(m: string): void; warning?(m: string): void; success?(m: string): void };
}

// Lumiverse's frontend context does NOT provide a toast API (ctx.toast was
// always undefined → every ctx.toast?.x?.() was a silent no-op). Own a tiny
// toast that renders above overlays. `ctx.toast` is still preferred if a future
// host adds it. Use notify(ctx, level, msg) everywhere instead of ctx.toast.
type ToastLevel = 'info' | 'success' | 'warning';
function notify(ctx: Ctx, level: ToastLevel, msg: string): void {
  const hostFn = ctx.toast?.[level];
  if (typeof hostFn === 'function') { try { hostFn(msg); return; } catch { /* fall through */ } }
  try {
    let host = document.querySelector('.vle-toasts') as HTMLElement | null;
    if (!host) { host = document.createElement('div'); host.className = 'vle-toasts'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'vle-toast vle-toast--' + level;
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    setTimeout(() => { el.classList.remove('on'); setTimeout(() => { try { el.remove(); } catch { /* ignore */ } }, 250); }, 3200);
  } catch { /* DOM unavailable */ }
}

/**
 * A STICKY toast that updates IN PLACE by a stable key, instead of stacking a
 * new one each call. Used for the multi-phase fold progress ("Scene inscribed…
 * (1/2)" → "Chronicle updated (2/2)") so the two backend broadcast phases read
 * as one message that advances, not two separate popups. Passing `done:true`
 * lets it auto-dismiss after a short beat; otherwise it lingers (a later call
 * with the same key replaces its text). Falls back silently if the DOM is gone.
 */
const _stickyToasts = new Map<string, { el: HTMLElement; t: ReturnType<typeof setTimeout> | null }>();
function stickyToast(key: string, level: ToastLevel, msg: string, done = false): void {
  try {
    let host = document.querySelector('.vle-toasts') as HTMLElement | null;
    if (!host) { host = document.createElement('div'); host.className = 'vle-toasts'; document.body.appendChild(host); }
    let rec = _stickyToasts.get(key);
    if (!rec || !rec.el.isConnected) {
      const el = document.createElement('div');
      el.className = 'vle-toast vle-toast--' + level;
      host.appendChild(el);
      requestAnimationFrame(() => el.classList.add('on'));
      rec = { el, t: null };
      _stickyToasts.set(key, rec);
    } else {
      rec.el.className = 'vle-toast vle-toast--' + level + ' on';
    }
    rec.el.textContent = msg;
    if (rec.t) { clearTimeout(rec.t); rec.t = null; }
    if (done) {
      const el = rec.el;
      rec.t = setTimeout(() => {
        el.classList.remove('on');
        setTimeout(() => { try { el.remove(); } catch { /* ignore */ } }, 250);
        _stickyToasts.delete(key);
      }, 2400);
    }
      } catch { /* DOM unavailable */ }
}

/** Tear down every toast artifact on extension unload: clear pending sticky
 * auto-dismiss timers, drop the sticky map, and remove the shared toast host
 * node from <body>. Prevents orphaned DOM nodes and timers surviving a reload. */
function cleanupToasts(): void {
  try {
    for (const rec of _stickyToasts.values()) { if (rec.t) { try { clearTimeout(rec.t); } catch { /* ignore */ } } }
    _stickyToasts.clear();
    const host = document.querySelector('.vle-toasts');
    if (host) { try { host.remove(); } catch { /* ignore */ } }
  } catch { /* DOM unavailable */ }
}

const ICON = '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:var(--vg,#cda84e)"><path d="M4 3.5h9l3 3V16.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.4"/><path d="M6 9h8M6 12h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

// "Now" — the live-scene dashboard, reused as the first drawer view so the drawer
// and the floating window share one language (float = Now alone; drawer = Now +
// the archive tabs). Same composable section engine as the float (dashboard.ts).
const nowTab: Component<ChronicleState> = {
  // rel term includes the affection/trust sum so the compact bond cards repaint
  // when scores shift on a turn even if the relation COUNT is unchanged.
  version: (s) => `${s.turns}:${s.day}:${s.scene.location ?? ''}:${s.scene.tension ?? 0}:${s.scene.present.join(',')}:${s.relations.length}:${s.relations.reduce((a, r) => a + r.affection + r.trust, 0)}:${s.scene.weather ?? ''}:${s.scene.time ?? ''}:${(s.scene.detail ?? []).map((d) => d.id + (d.mood ?? '') + (d.condition ?? '') + (d.doing ?? '') + (d.thought ?? '')).join(',')}`,
  render: (s) => `<div class="vld">${dashboardHtml(s)}</div>`,
  mount: (host) => host.addEventListener('click', (e) => { const d = (e.target as HTMLElement).closest('[data-phone-sec]'); if (d) { setPhoneSection(d.getAttribute('data-phone-sec')!); refreshUI(); } }),
};

const TABS = [
  { id: 'now', label: 'Now', icon: 'now', comp: nowTab, group: 'primary' },
  { id: 'cast', label: 'Cast', icon: 'cast', comp: castTab, group: 'primary' },
  { id: 'relations', label: 'Bonds', icon: 'bonds', comp: relationsTab, group: 'primary' },
  { id: 'chronicle', label: 'Chronicle', icon: 'chronicle', comp: chronicleTab, group: 'primary' },
  { id: 'director', label: 'Director', icon: 'director', comp: directorTab, group: 'primary' },
  { id: 'journal', label: 'Journal', icon: 'journal', comp: journalTab, group: 'tools' },
  { id: 'graph', label: 'Graph', icon: 'graph', comp: graphTab, group: 'tools' },
  { id: 'vault', label: 'Vault', icon: 'vault', comp: vaultTab, group: 'tools' },
  { id: 'injection', label: 'Context', icon: 'context', comp: injectionTab, group: 'tools' },
] as const;

// QOL actions, grouped. 'inline' stays on the toolbar; the rest live in the
// Actions menu so the shell isn't a wall of 12 equal-weight pills. Toggles show
// their current state; the destructive Clear is quarantined in its own group.
const QOL = [
  { id: 'customize', label: '\u25C8 Customize', title: 'Theme: color, font, size & skins', group: 'inline' },
  // settings = persistent configuration
  { id: 'boundaries', label: '\u26D4 Boundaries', title: 'Hard limits: content this story will never depict (outranks every other setting)', group: 'settings' },
  { id: 'calendar', label: '\u2637 Calendar', title: 'Name the current epoch/season so "Day 47" reads as an occasion', group: 'settings' },
  { id: 'budget', label: '\u2696 Context budget', title: 'How much VELLUM injects per turn: master dial + per-injector caps + off-screen/summary cadence', group: 'settings' },
  { id: 'tone', label: '\u2665 Tone', title: 'Romance pace + world bias: steers how fast bonds form and how the world leans toward you', group: 'settings' },
  { id: 'summarizer', label: '\u2699 Summarizer', title: 'Summarizer settings: token caps, window size, automation, and custom gist/chapter/arc prompts', group: 'settings' },
  // toggles = persistent on/off state
  { id: 'hide', label: '\u25d1 Hide filed', title: 'Hide summarized turns from the prompt (toggle)', group: 'toggle' },
  { id: 'traverse', label: '\u2748 Traverse', title: 'Controller-guided retrieval (click to cycle: off \u2192 flat one-shot \u2192 tree arc\u2192chapter\u2192leaf drill; needs generation permission)', group: 'toggle' },
  { id: 'offscreen', label: '\u263E Off-screen', title: 'Simulate off-screen life: characters not in the scene quietly act elsewhere each few turns (needs generation permission; costs a generation per tick)', group: 'toggle' },
  { id: 'foldtoast', label: '\u2261 Tracker Update Toast', title: 'Show a brief toast after each turn as the tracker updates (scene first, then the deep memory pass). Off by default.', group: 'toggle' },
  // run = one-shot verbs
  { id: 'summarize', label: '\u2727 Summarize', title: 'Compress older turns into chapter memories', group: 'run' },
  { id: 'rescan', label: '\u21bb Rescan', title: 'Re-fold the latest turn from the raw message', group: 'run' },
  { id: 'rebuild', label: '\u27F3 Rebuild', title: 'Reconstruct the whole chronicle from the chat transcript (recovery)', group: 'run' },
  { id: 'tidy', label: '\u2702 Tidy threads', title: 'Merge near-duplicate plot threads now (needs generation permission)', group: 'run' },
  { id: 'tidyfacts', label: '\u2702 Tidy lore', title: 'Fold near-duplicate knowledge & secrets now (needs generation permission)', group: 'run' },
  { id: 'resummarize', label: '\u27F2 Re-summarize all', title: 'Rebuild every chapter summary from scratch with the current pipeline (needs generation permission)', group: 'run' },
  // data
  { id: 'export', label: '\u2913 Export', title: 'Download the chronicle as JSON', group: 'data' },
  { id: 'exportmd', label: '\u2913 Export Markdown', title: 'Download the story as readable Markdown (story-so-far, cast, bonds, codex)', group: 'data' },
  { id: 'import', label: '\u2912 Import', title: 'Load a chronicle JSON', group: 'data' },
  { id: 'recover', label: '\u21BA Recover', title: 'Restore this chat from its automatic backup if data was lost', group: 'data' },
  { id: 'clear', label: '\u2715 Clear', title: 'Erase all chronicle data for this chat', group: 'danger' },
  // help = re-open the first-run guide (its own group so it reads as a distinct affordance)
  { id: 'help', label: '\u2370 Help / Guide', title: 'Re-open the VELLUM first-run guide', group: 'help' },
] as const;

/** Open the Customize (theme) panel as a modal-style overlay. */
function openBudgetModal(ctx: Ctx): void {
  const b = _budget ?? {};
  const n = (k: string, d: number): string => String(typeof b[k] === 'number' ? b[k] : d);
  const preset = String(b.preset ?? 'balanced');
  formModal('Context Budget', [
    { key: 'preset', label: 'How much to inject each turn', type: 'select', value: preset, options: [
      { value: 'lean', label: 'Lean (small-context models)' },
      { value: 'balanced', label: 'Balanced (default)' },
      { value: 'rich', label: 'Rich (large-context models)' },
      { value: 'custom', label: 'Custom (advanced fields below)' },
    ], hint: 'Lean/Balanced/Rich scale every injector together. Custom uses the caps below (0 = disable an injector).' },
    { key: '_s1', label: 'Cadence', type: 'section', adv: true },
    { key: 'simInterval', label: 'Off-screen sim interval (turns; 0 = never)', type: 'number', min: 0, max: 20, step: 1, value: n('simInterval', 4), adv: true },
    { key: 'autoSummaryAt', label: 'Auto-summarize after N turn-memories', type: 'number', min: 4, max: 100, step: 1, value: n('autoSummaryAt', 16), adv: true },
    { key: '_s2', label: 'Retrieval', type: 'section', adv: true },
    { key: 'recallDepth', label: 'recall depth (memories injected)', type: 'number', min: 0, max: 40, step: 1, value: n('recallDepth', 12), adv: true },
    { key: 'spine', label: 'beat spine cap', type: 'number', min: 0, max: 40, step: 1, value: n('spine', 14), adv: true },
    { key: 'locations', label: 'locations cap (0 = off)', type: 'number', min: 0, max: 40, step: 1, value: n('locations', 12), adv: true },
    { key: '_s3', label: 'Characters & plot', type: 'section', adv: true },
    { key: 'drift', label: 'personality drift cap (0 = off)', type: 'number', min: 0, max: 20, step: 1, value: n('drift', 6), adv: true },
    { key: 'mood', label: 'mood cap (0 = off)', type: 'number', min: 0, max: 20, step: 1, value: n('mood', 5), adv: true },
    { key: 'locks', label: 'relationship-lock cap', type: 'number', min: 0, max: 20, step: 1, value: n('locks', 6), adv: true },
    { key: 'plants', label: 'foreshadow-plants cap (0 = off)', type: 'number', min: 0, max: 20, step: 1, value: n('plants', 6), adv: true },
    { key: 'offscreen', label: 'off-screen convergence cap (0 = off)', type: 'number', min: 0, max: 20, step: 1, value: n('offscreen', 3), adv: true },
  ], (out) => {
    const num = (v: string | undefined, d: number): number => { const s = (v ?? '').trim(); const x = Number(s); return s !== '' && isFinite(x) ? x : d; };
    const budget: Record<string, unknown> = {
      preset: out.preset || 'balanced',
      simInterval: num(out.simInterval, 4), autoSummaryAt: num(out.autoSummaryAt, 16),
      spine: num(out.spine, 14), locations: num(out.locations, 12), drift: num(out.drift, 6), mood: num(out.mood, 5),
      locks: num(out.locks, 6), plants: num(out.plants, 6), offscreen: num(out.offscreen, 3), recallDepth: num(out.recallDepth, 12),
      injectDrift: num(out.drift, 6) > 0, injectMood: num(out.mood, 5) > 0, injectPlants: num(out.plants, 6) > 0,
      injectLocations: num(out.locations, 12) > 0, injectOffscreen: num(out.offscreen, 3) > 0,
    };
    _budget = budget;
    ctx.sendToBackend({ type: 'vellum_set_budget', budget });
    notify(ctx, 'success', `Context budget: ${budget.preset}.`);
  }, { large: true });
}

function openCalendarModal(ctx: Ctx): void {
  formModal('World Calendar', [
    { key: 'calendar', label: 'Current epoch / season / occasion (blank = none)', type: 'text', value: _calendar, placeholder: 'the third day of the harvest festival, year 312' },
    {
      key: 'dateFormat', label: 'Time display format', type: 'select', value: _dateFormat,
      hint: 'How the day counter reads everywhere (dashboard, beats, journal, export). Calendar formats derive a date from the day number + start date below.',
      options: [
        { value: 'day', label: 'Day count \u2014 Day 1, Day 2\u2026' },
        { value: 'month-day-year', label: 'Month Day, Year \u2014 January 5, 2026' },
        { value: 'month-day', label: 'Month Day \u2014 January 5' },
        { value: 'month', label: 'Month \u2014 January' },
        { value: 'week', label: 'Week number \u2014 Week 1, Week 2\u2026' },
        { value: 'month-year', label: 'Month Year \u2014 Jan 2026' },
        { value: 'year', label: 'Year \u2014 Year 2026' },
      ],
    },
    { key: 'dateEpoch', label: 'Start date (day 0) \u2014 optional, for calendar formats', type: 'text', value: _dateEpoch, placeholder: '2026-01-01', hint: 'ISO date the story\u2019s day 0 maps to. Blank = a neutral fictional calendar.' },
    // --- fantasy calendar naming (Advanced): rename months + the era on the year
    { key: 'monthNames', label: 'Custom month names (fantasy calendar)', type: 'textarea', value: _monthNames, adv: true, placeholder: 'Frostfall, Thawmoon, Seedtide, \u2026', hint: 'Comma- or line-separated. Replaces January\u2026December in order; fewer than 12 will cycle. Blank = default names.' },
    { key: 'monthNamesShort', label: 'Custom short month names (optional)', type: 'textarea', value: _monthNamesShort, adv: true, placeholder: 'Fro, Thw, Sed, \u2026', hint: 'Used by the Month Year format. Blank = falls back to the long names above.' },
    { key: 'yearPrefix', label: 'Year prefix (era)', type: 'text', value: _yearPrefix, adv: true, placeholder: 'Year ', hint: 'Text before the year number, e.g. \u201CYear \u201D.' },
    { key: 'yearSuffix', label: 'Year suffix (era)', type: 'text', value: _yearSuffix, adv: true, placeholder: ' A.R.', hint: 'Text after the year number, e.g. \u201C A.R.\u201D or \u201C of the Third Age\u201D.' },
  ], (o) => {
    _calendar = (o.calendar ?? '').trim();
    setDashCalendar(_calendar);
    ctx.sendToBackend({ type: 'vellum_set_calendar', calendar: _calendar });
    // date-format + epoch + fantasy naming persist as a config event (flows to every state consumer)
    const df = (o.dateFormat ?? 'day').trim();
    const epoch = (o.dateEpoch ?? '').trim();
    const months = (o.monthNames ?? '').trim();
    const monthsShort = (o.monthNamesShort ?? '').trim();
    const yearPrefix = o.yearPrefix ?? '';
    const yearSuffix = o.yearSuffix ?? '';
    if (df !== _dateFormat || epoch !== _dateEpoch || months !== _monthNames || monthsShort !== _monthNamesShort || yearPrefix !== _yearPrefix || yearSuffix !== _yearSuffix) {
      _dateFormat = df; _dateEpoch = epoch; _monthNames = months; _monthNamesShort = monthsShort; _yearPrefix = yearPrefix; _yearSuffix = yearSuffix;
      cmd('config_set', { dateFormat: df, dateEpoch: epoch, monthNames: months, monthNamesShort: monthsShort, yearPrefix, yearSuffix });
    }
    notify(ctx, 'success', 'Calendar settings saved.');
  });
}

function openBoundaries(ctx: Ctx): void {
  formModal('Content Boundaries', [
    { key: 'limits', label: 'Hard limits \u2014 never depict (outranks every other setting, incl. NSFW/NSFL and the Mandate)', type: 'textarea', big: true, value: _hardLimits, placeholder: 'e.g. any sexualization of minors; ... (comma- or line-separated)' },
  ], (o) => {
    _hardLimits = (o.limits ?? '').trim();
    ctx.sendToBackend({ type: 'vellum_set_limits', limits: _hardLimits });
    notify(ctx, 'success', _hardLimits ? 'Boundaries saved (absolute).' : 'Boundaries cleared.');
  }, { large: true });
}

function openCustomize(onChange: () => void): void {
  const ov = document.createElement('div');
  ov.className = 'vlfm-overlay';
  ov.innerHTML = '<div class="vlfm vle-root" style="width:min(440px,94vw)"><div class="vlfm-head"><span class="vlfm-mark">\u2756</span>Customize</div>'
    + '<div class="vlfm-body" data-cz-host>' + customizePanel('look') + '</div>'
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-save" data-close>Done</button></div></div>';
  document.body.appendChild(ov);
  const host = ov.querySelector('[data-cz-host]') as HTMLElement;
  const reskin = () => applyTheme(ov.querySelector('.vlfm') as HTMLElement);
  reskin();
  wireCustomize(host, onChange, (tab) => { host.innerHTML = customizePanel(tab); reskin(); });
  const close = (): void => { try { ov.remove(); } catch { /* ignore */ } };
  ov.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) close(); });
}

/** A self-contained shell instance: renders the tab bar + toolbar + body. */
function createShell(ctx: Ctx, getState: () => ChronicleState) {
  const root = document.createElement('div');
  root.className = 'vle-root';
  const primary = TABS.filter((t) => t.group === 'primary');
  const tools = TABS.filter((t) => t.group === 'tools');
  const tabBtn = (t: typeof TABS[number], on: boolean): string => `<button class="vle-tabbtn${on ? ' on' : ''}" data-tab="${t.id}">${icon(t.icon, { size: 15 })}<span class="vle-tabbtn-l">${t.label}</span></button>`;
  // five primary tabs (Now/Cast/Bonds/Chronicle/Director) lead; the rest are a
  // labeled secondary "dock" (Journal/Graph/Vault/Context) — icon + label, so
  // the tools read as a real tier, not cryptic afterthoughts. Labels hide when
  // the width is tight (see .vle-tabicon-l in styles.ts).
  const toolBtn = (t: typeof TABS[number]): string => `<button class="vle-tabicon" data-tab="${t.id}" title="${t.label}" aria-label="${t.label}">${icon(t.icon)}<span class="vle-tabicon-l">${t.label}</span></button>`;
  // ONE navigation tier: the five primary tabs, a hairline separator, then the
  // labeled tool dock — all in a single `.vle-tabbar` so nav reads as one grouped
  // control (was two disconnected rows). The float uses its own `.vlf-tab` strip
  // (primary only), so this consolidation is drawer-side.
  // H1: header + tab rail are grouped into one nav panel (mockup 20). Additive
  // wrapper only -- .vle-head/.vle-tabbar selectors keep matching; toolbar/body
  // stay outside so the search/actions row and scroll body are unaffected.
  root.innerHTML = '<div class="vle-navpanel">'
    + '<div class="vle-head"><span class="vle-mark">\u2756</span> VELLUM <span class="vle-ver">II</span>'
    + '<span class="vle-stats" data-stats></span></div>'
    + '<div class="vle-tabbar" data-tabbar role="tablist">'
      + primary.map((t, i) => tabBtn(t, i === 0)).join('')
      + '<span class="vle-tabbar-sep" aria-hidden="true"></span>'
      + tools.map((t) => toolBtn(t)).join('')
    + '</div>'
    + '</div>'

    + '<div class="vle-toolbar" data-toolbar>'
      + `<button class="vle-qol" data-search title="Search the chronicle (cast, bonds, journal, knowledge)">${icon('search', { size: 15 })}<span>Search</span></button>`
      + `<button class="vle-qol" data-qol="customize" title="Theme: color, font, size & skins">${icon('customize', { size: 15 })}<span>Customize</span></button>`
      + `<button class="vle-qol vle-qol-menu" data-actions title="Chronicle actions">${icon('actions', { size: 15 })}<span>Actions</span></button>`
    + '</div>'
    + '<div class="vle-body" data-body></div>';

  const statsEl = root.querySelector('[data-stats]') as HTMLElement;
  const tabbar = root.querySelector('[data-tabbar]') as HTMLElement;
  const bodyEl = root.querySelector('[data-body]') as HTMLElement;
  let active: string = TABS[0]!.id;
  let mounted: Mounted<ChronicleState> | null = null;
  const _scroll = new Map<string, number>(); // remember reading position per tab

  const showTab = (id: string): void => {
    if (active !== id) _scroll.set(active, bodyEl.scrollTop); // stash before leaving
    active = id;
    root.querySelectorAll('.vle-tabbtn,.vle-tabicon').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === id));
    if (mounted) { mounted.destroy(); mounted = null; }
    bodyEl.innerHTML = '';
    const def = TABS.find((t) => t.id === id) ?? TABS[0]!;
    mounted = mount(bodyEl, def.comp, getState(), def.id);
    bodyEl.scrollTop = _scroll.get(id) ?? 0; // restore reading position
  };
  // header stat pills: one labeled pill per fact (turn / day / cast / bonds /
  // weather) with an SVG icon — replaces the old `·`-joined run-on string and
  // its stray ☁ glyph, so the header scans as discrete data, not one long label.
  const stats = (): void => {
    // Isolated behind try/catch: a malformed-state throw while building the header
    // pills must never break drawer.update() + float.refresh() further down. Keeps
    // the "panels fail in isolation" guarantee even for the header.
    try {
      const s = getState();
      const dayLabel = s.day !== undefined && s.day !== null ? formatDate(s.day, s.dateFormat || 'day', s) : 'D0';
      const pill = (ico: string, value: string, label: string): string =>
        `<span class="vle-stat" title="${esc(label)}">${icon(ico, { size: 13 })}<b>${esc(value)}</b></span>`;
      const pills = [
        pill('turn', `T${s.turns ?? 0}`, 'turn'),
        pill('calendar', dayLabel, 'day'),
        pill('cast', String(visibleCast(s).length), 'cast on stage'),
        pill('bonds', String(s.relations.length), 'relationships'),
      ];
      if (s.scene.weather) pills.push(pill('weather', s.scene.weather, 'weather'));
      statsEl.innerHTML = pills.join('');
    } catch (e) { try { console.warn('[vellum] header stats failed:', e); } catch { /* ignore */ } }
  };

  root.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('.vle-tabbar [data-tab]'); if (b) showTab(b.getAttribute('data-tab')!); });

  root.querySelector('[data-toolbar]')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-qol]'); if (b) { onQol(ctx, b.getAttribute('data-qol')!); return; }
    if ((e.target as HTMLElement).closest('[data-search]')) openSearch(getState, showTab);
    if ((e.target as HTMLElement).closest('[data-actions]')) openActions(ctx);
  });
  // tab bodies may surface cross-links to Actions-menu modals (e.g. the Director
  // tab links to Tone/Genre as the "next-turn steering" hub). Delegate those.
  bodyEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-qol]');
    if (b) { onQol(ctx, b.getAttribute('data-qol')!); }
  });
  wirePagers(bodyEl); // delegated pager clicks for any paginated list
  wireFilters(bodyEl); // delegated filter-bar controls

  showTab(active); stats();
  return {
    root,
    update(force = false): void { stats(); if (mounted) mounted.update(getState(), force); else showTab(active); },
    destroy(): void { try { mounted?.destroy(); } catch { /* ignore */ } try { root.remove(); } catch { /* ignore */ } },
  };
}

let _ctxRef: Ctx | null = null;
let _hideOn = false;
let _offscreenOn = false; // off-screen sim toggle, mirrored from backend
let _traverseMode = 'off'; // off | flat | tree
let _traverseAxis = 'temporal'; // temporal | character | hybrid (tree only)
const axisLabel = (a: string): string => a === 'character' ? 'by char' : a === 'hybrid' ? 'by char+time' : 'by time';
let _tone = { romance: 'medium', disposition: 'fair', social: 'living', politics: 'off' };
let _tidyOn = false;
let _chapterVault = 'keyed';
let _hardLimits = ''; // last-known hard-limits chat var (mirrored from broadcasts)
let _calendar = ''; // last-known world-calendar chat var
let _dateFormat = 'day'; // last-known date-display format (mirrored from state broadcasts)
let _dateEpoch = ''; // last-known ISO start-date for calendar formats (mirrored from state broadcasts)
let _monthNames = ''; // last-known custom month names (comma/newline list, mirrored from state)
let _monthNamesShort = ''; // last-known custom short month names (mirrored from state)
let _yearPrefix = ''; // last-known era prefix on the year (mirrored from state)
let _yearSuffix = ''; // last-known era suffix on the year (mirrored from state)
let _budget: Record<string, unknown> | null = null; // last-known context-budget cfg
let _summarizerCfg: Record<string, unknown> | null = null; // last-known summarizer config (filled by vellum_summarizer_state)
let _summarizerDefaults: { chapter: string; arc: string; gist: string } = { chapter: '', arc: '', gist: '' };
let _retheme: () => void = () => { /* set in setup */ };
let _lastStateAt = 0; // epoch ms of the last vellum_state broadcast (for the post-turn safety poll)
// per-client display preference: show the post-turn "tracker updated" toast.
// Off by default so the common turn is silent; persisted via prefs (host-backed
// so it survives an extension reload, like the rest of the window prefs).
let _foldToastOn = getPref<boolean>('foldToast', false);

// Transient "running" indication for one-shot QOL actions. Set busy when the
// action is dispatched; cleared when the matching backend reply arrives. A
// safety timeout auto-clears so a dropped reply can't strand a button.
const _busyTimers = new Map<string, ReturnType<typeof setTimeout>>();
function setQolBusy(id: string, busy: boolean, timeoutMs = 30000): void {
  document.querySelectorAll(`[data-qol='${id}']`).forEach((b) => {
    b.classList.toggle('busy', busy);
    (b as HTMLButtonElement).disabled = busy;
  });
  const prev = _busyTimers.get(id);
  if (prev) { clearTimeout(prev); _busyTimers.delete(id); }
  if (busy) _busyTimers.set(id, setTimeout(() => setQolBusy(id, false), timeoutMs));
}

/** Open the grouped Actions menu as an overlay. Items reuse the same `data-qol`
 * ids so all existing busy/toggle wiring keeps working; only the container moved
 * off the always-on toolbar. Toggles render their current state inline. The menu
 * PERSISTS across actions (re-rendering toggle state) — only Close dismisses it. */
function openActions(ctx: Ctx): void {
  const ov = document.createElement('div');
  ov.className = 'vlfm-overlay';
  const groups: Array<[string, string]> = [['settings', 'Settings'], ['toggle', 'Toggles'], ['run', 'Run'], ['data', 'Data'], ['help', 'Help'], ['danger', 'Danger']];
  const bodyHtml = (): string => {
    const toggleState: Record<string, string> = {
      hide: _hideOn ? 'on' : 'off',
      offscreen: _offscreenOn ? 'on' : 'off',
      foldtoast: _foldToastOn ? 'on' : 'off',
      traverse: _traverseMode === 'off' ? 'off' : (_traverseMode === 'tree' ? `tree \u00b7 ${axisLabel(_traverseAxis)}` : 'flat'),
      tone: (_tone.romance === 'medium' && _tone.disposition === 'fair' && _tone.social === 'living' && _tone.politics === 'off') ? 'default' : `${_tone.romance.replace('_', ' ')} \u00b7 ${_tone.disposition} \u00b7 ${_tone.social}${_tone.politics !== 'off' ? ' \u00b7 pol:' + _tone.politics : ''}`,
    };
    return groups.map(([g, label]) => {
      const items = QOL.filter((q) => q.group === g);
      if (!items.length) return '';
      const rows = items.map((q) => {
        const st = toggleState[q.id];
        const stHtml = g === 'toggle' ? `<span class="vle-act-st">${esc(st ?? '')}</span>` : '';
        // strip the legacy leading glyph from the label; the SVG icon replaces it
        const text = q.label.replace(/^[^\sA-Za-z]+\s*/, '');
        const ico = hasIcon(q.id) ? icon(q.id, { size: 15 }) : '';
        return `<button class="vle-act-item${g === 'danger' ? ' danger' : ''}" data-qol="${q.id}" title="${esc(q.title)}">${ico}<span class="vle-act-l">${esc(text)}</span>${stHtml}</button>`;
      }).join('');
      return `<div class="vle-act-grp"><div class="vle-act-h">${label}</div>${rows}</div>`;
    }).join('');
  };
  ov.innerHTML = '<div class="vlfm vle-root" style="width:min(420px,94vw)"><div class="vlfm-head"><span class="vlfm-mark">\u22EF</span>Actions</div>'
    + `<div class="vlfm-body vle-acts" data-acts-host>${bodyHtml()}</div>`
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-close>Close</button></div></div>';
  document.body.appendChild(ov);
  applyTheme(ov.querySelector('.vlfm') as HTMLElement);
  const host = ov.querySelector('[data-acts-host]') as HTMLElement;
  const close = (): void => { try { ov.remove(); } catch { /* ignore */ } };
  ov.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) { close(); return; }
    const item = t.closest('[data-qol]');
    if (item) {
      const id = item.getAttribute('data-qol')!;
      onQol(ctx, id);
      // keep the menu open; refresh toggle state. Actions that open their own
      // modal (import/clear) render over this; it's still here when they finish.
      host.innerHTML = bodyHtml();
    }
  });
}

interface SearchHit { tab: string; kind: string; label: string; sub: string }
/** Flat free-text search across cast, factions, relations, journal, knowledge,
 * secrets by name/text. Result click jumps to the owning tab. Read-only over
 * state; no index to maintain — the chronicle is small enough to scan live. */
function buildSearchIndex(s: ChronicleState): SearchHit[] {
  const hits: SearchHit[] = [];
  const nm = (id: string): string => s.cast[id]?.name ?? id;
  for (const c of visibleCast(s)) hits.push({ tab: 'cast', kind: 'cast', label: c.name, sub: [c.role, c.status].filter(Boolean).join(' \u00b7 ') });
  for (const f of Object.values(s.factions)) hits.push({ tab: 'cast', kind: 'faction', label: f.name, sub: f.kind || 'faction' });
  for (const r of s.relations) hits.push({ tab: 'relations', kind: 'bond', label: `${nm(r.a)} \u2192 ${nm(r.b)}`, sub: r.label || r.categories.join(', ') });
  for (const j of s.journal) hits.push({ tab: 'journal', kind: 'journal', label: nm(j.who), sub: j.memory });
  for (const k of s.knowledge) hits.push({ tab: 'chronicle', kind: 'knowledge', label: nm(k.who), sub: k.fact });
  for (const sec of s.secrets) hits.push({ tab: 'chronicle', kind: 'secret', label: nm(sec.keeper), sub: sec.text });
  for (const x of s.scars ?? []) hits.push({ tab: 'chronicle', kind: 'scar', label: nm(x.who), sub: x.was });
  for (const x of s.lore ?? []) hits.push({ tab: 'chronicle', kind: 'codex', label: x.tag || 'canon', sub: x.fact });
  return hits;
}

function openSearch(getState: () => ChronicleState, go: (tab: string) => void): void {
  const index = buildSearchIndex(getState());
  const ov = document.createElement('div');
  ov.className = 'vlfm-overlay';
  ov.innerHTML = '<div class="vlfm vle-root" style="width:min(520px,94vw)"><div class="vlfm-head"><span class="vlfm-mark">\u2315</span>Search</div>'
    + '<div class="vlfm-body"><input class="vlfm-in" data-search-in placeholder="character, bond, memory, fact\u2026" autocomplete="off" spellcheck="false">'
    + '<div class="vle-search-results" data-search-out></div></div>'
    + '<div class="vlfm-foot"><button class="vlfm-btn vlfm-cancel" data-close>Close</button></div></div>';
  document.body.appendChild(ov);
  applyTheme(ov.querySelector('.vlfm') as HTMLElement);
  const input = ov.querySelector('[data-search-in]') as HTMLInputElement;
  const out = ov.querySelector('[data-search-out]') as HTMLElement;
  const close = (): void => { try { ov.remove(); } catch { /* ignore */ } };
  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    if (!q) { out.innerHTML = '<div class="vle-empty sm">Type to search the chronicle.</div>'; return; }
    const matches = index.filter((h) => h.label.toLowerCase().includes(q) || h.sub.toLowerCase().includes(q)).slice(0, 40);
    if (!matches.length) { out.innerHTML = `<div class="vle-empty sm">No matches for \u201c${esc(q)}\u201d.</div>`; return; }
    out.innerHTML = matches.map((h) =>
      `<button class="vle-search-hit" data-go="${esc(h.tab)}"><span class="vle-search-k">${esc(h.kind)}</span><span class="vle-search-l">${esc(h.label)}</span><span class="vle-search-s">${esc(h.sub.slice(0, 80))}</span></button>`).join('');
  };
  input.addEventListener('input', render);
  ov.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) { close(); return; }
    const hit = t.closest('[data-go]'); if (hit) { go(hit.getAttribute('data-go')!); close(); }
  });
  render();
  setTimeout(() => input.focus(), 30);
}

function onQol(ctx: Ctx, id: string): void {
  if (id === 'customize') { openCustomize(() => _retheme()); }
  else if (id === 'boundaries') { openBoundaries(ctx); }
  else if (id === 'calendar') { openCalendarModal(ctx); }
  else if (id === 'budget') { ctx.sendToBackend({ type: 'vellum_get_budget' }); /* modal opens when state arrives */ }
  else if (id === 'summarize') { setQolBusy('summarize', true); ctx.sendToBackend({ type: 'vellum_summarize' }); notify(ctx, 'info', 'Summarizing older turns\u2026'); }
  else if (id === 'rescan') { setQolBusy('rescan', true); ctx.sendToBackend({ type: 'vellum_rescan' }); notify(ctx, 'info', 'Rescanning the latest turn\u2026'); }
  else if (id === 'rebuild') { openRebuildModal(ctx); }
  else if (id === 'hide') { _hideOn = !_hideOn; setQolBusy('hide', true); ctx.sendToBackend({ type: 'vellum_set_hide', enabled: _hideOn }); }
  else if (id === 'offscreen') { _offscreenOn = !_offscreenOn; ctx.sendToBackend({ type: 'vellum_set_offscreen', enabled: _offscreenOn }); }
  else if (id === 'foldtoast') {
    _foldToastOn = !_foldToastOn;
    setPref('foldToast', _foldToastOn);
    document.querySelectorAll('[data-qol=\'foldtoast\']').forEach((b) => b.classList.toggle('on', _foldToastOn));
    notify(ctx, 'info', _foldToastOn ? 'Update toast on: a brief note after each turn.' : 'Update toast off.');
  }
  else if (id === 'traverse') {
    // cycle: off → flat → tree·time → tree·char → tree·hybrid → off
    if (_traverseMode === 'off') { _traverseMode = 'flat'; }
    else if (_traverseMode === 'flat') { _traverseMode = 'tree'; _traverseAxis = 'temporal'; }
    else if (_traverseMode === 'tree' && _traverseAxis === 'temporal') { _traverseAxis = 'character'; }
    else if (_traverseMode === 'tree' && _traverseAxis === 'character') { _traverseAxis = 'hybrid'; }
    else { _traverseMode = 'off'; _traverseAxis = 'temporal'; }
    setQolBusy('traverse', true);
    ctx.sendToBackend({ type: 'vellum_set_traversal', mode: _traverseMode, axis: _traverseAxis });
  }
  else if (id === 'tone') { openToneModal(ctx); }
  else if (id === 'tidy') { setQolBusy('tidy', true); ctx.sendToBackend({ type: 'vellum_tidy_now' }); notify(ctx, 'info', 'Reconciling plot threads\u2026'); }
  else if (id === 'tidyfacts') { setQolBusy('tidyfacts', true); ctx.sendToBackend({ type: 'vellum_tidy_facts_now' }); notify(ctx, 'info', 'Folding duplicate knowledge & secrets\u2026'); }
  else if (id === 'resummarize') { setQolBusy('resummarize', true); ctx.sendToBackend({ type: 'vellum_resummarize' }); notify(ctx, 'info', 'Rebuilding all chapter summaries\u2026'); }
  else if (id === 'summarizer') { ctx.sendToBackend({ type: 'vellum_get_summarizer' }); /* modal opens when state arrives */ }
  else if (id === 'export') { setQolBusy('export', true); ctx.sendToBackend({ type: 'vellum_export' }); }
  else if (id === 'exportmd') { setQolBusy('exportmd', true); ctx.sendToBackend({ type: 'vellum_export_markdown' }); }
  else if (id === 'import') { triggerImport(ctx); }
  else if (id === 'recover') { ctx.sendToBackend({ type: 'vellum_recover' }); notify(ctx, 'info', 'Checking backup\u2026'); }
  else if (id === 'clear') { confirmModal('Erase ALL VELLUM chronicle data for this chat? This cannot be undone.', () => { setQolBusy('clear', true); ctx.sendToBackend({ type: 'vellum_clear' }); }); }
  else if (id === 'help') { openOnboarding(); }
}

function openToneModal(ctx: Ctx): void {
  formModal('Tone & Relationship', [
    { key: 'romance', label: 'Romance Pace', type: 'select', value: _tone.romance, options: [
      { value: 'off', label: 'Off (no romance)' },
      { value: 'slow_burn', label: 'Slow Burn' },
      { value: 'medium', label: 'Measured' },
      { value: 'fast', label: 'Fast-Paced' },
      { value: 'erotic', label: 'Erotic' },
    ] },
    { key: 'disposition', label: 'World bias (toward you)', type: 'select', value: _tone.disposition, options: [
      { value: 'kind', label: 'Kind (everybody warms to you)' },
      { value: 'warm', label: 'Warm' },
      { value: 'fair', label: 'Fair (neutral)' },
      { value: 'harsh', label: 'Harsh' },
      { value: 'brutal', label: 'Brutal (the world is against you)' },
    ] },
    { key: 'social', label: 'NPC social autonomy', type: 'select', value: _tone.social, options: [
      { value: 'off', label: 'Off (only you drive relationships)' },
      { value: 'reactive', label: 'Reactive (NPCs bond in scenes you see)' },
      { value: 'living', label: 'Living (+ they drift off-screen too)' },
      { value: 'autonomous', label: 'Autonomous (they date, fall out, reconcile on their own)' },
    ] },
    { key: 'politics', label: 'Faction politics autonomy', type: 'select', value: _tone.politics, options: [
      { value: 'off', label: 'Off (factions only shift when you/the story drive it)' },
      { value: 'living', label: 'Living (standings drift off-screen)' },
      { value: 'autonomous', label: 'Autonomous (factions ally, feud, go to war on their own)' },
    ] },
    { key: 'tidy', label: 'Auto-tidy plot threads', type: 'select', value: _tidyOn ? 'on' : 'off', options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On (merge duplicate threads as you play)' },
    ] },
    { key: 'chaptervault', label: 'Chapter detail in vault', type: 'select', value: _chapterVault, options: [
      { value: 'keyed', label: 'Keyed (detailed chapters, injected on relevance)' },
      { value: 'constant', label: 'Constant (detailed chapters, always in context)' },
      { value: 'off', label: 'Off (chronicle gist only)' },
    ] },
  ], (out) => {
    ctx.sendToBackend({ type: 'vellum_set_tone', romance: out.romance, disposition: out.disposition, social: out.social, politics: out.politics });
    ctx.sendToBackend({ type: 'vellum_set_tidy', enabled: out.tidy === 'on' });
    ctx.sendToBackend({ type: 'vellum_set_chaptervault', mode: out.chaptervault });
  });
}

function openRebuildModal(ctx: Ctx): void {
  formModal('Rebuild from transcript', [
    { key: 'mode', label: 'What to do', type: 'select', value: 'full', options: [
      { value: 'full', label: 'Full rebuild \u2014 replace everything from the transcript' },
      { value: 'messages', label: 'Capture messages only \u2014 keep all existing data' },
    ], hint: 'Full REPLACES cast, relations, knowledge, secrets, journal + messages (recovery). Messages-only ADDS any missing per-turn memories and leaves everything else untouched.' },
  ], (out) => {
    const messagesOnly = out.mode === 'messages';
    setQolBusy('rebuild', true);
    ctx.sendToBackend({ type: 'vellum_rebuild', deep: !messagesOnly, messagesOnly });
    notify(ctx, 'info', messagesOnly ? 'Capturing missing message memories\u2026' : 'Rebuilding full chronicle from transcript\u2026 this may take a moment.');
  });
}

function openSummarizerModal(ctx: Ctx): void {
  const c = _summarizerCfg ?? {};
  const numv = (k: string, d: number): string => String(typeof c[k] === 'number' ? c[k] : d);
  formModal('Summarizer Settings', [
    { key: 'auto', label: 'Automatic summarizing', type: 'select', value: c.auto === false ? 'off' : 'on', options: [
      { value: 'on', label: 'On (fold older turns as you play)' },
      { value: 'off', label: 'Off (only summarize manually)' },
    ] },
    { key: 'genMaxTokens', label: 'Max summary tokens', type: 'number', min: 500, max: 32000, step: 100, value: numv('genMaxTokens', 4000), hint: 'Model output budget for the detail pass (500\u201332000).' },
    { key: 'detailCap', label: 'Detail size cap', type: 'number', min: 1000, max: 20000, step: 250, value: numv('detailCap', 6000), hint: 'How rich a vault entry can get, in characters (1000\u201320000).' },
    { key: 'gistCap', label: 'Gist size cap', type: 'number', min: 200, max: 4000, step: 50, value: numv('gistCap', 800), hint: 'The chronicle one-liner length, in characters (200\u20134000).' },
    { key: 'autoWindow', label: 'Auto window', type: 'number', min: 2, max: 50, step: 1, value: numv('autoWindow', 8), hint: 'Turns folded into each chapter automatically (2\u201350).' },
    { key: 'minWindow', label: 'Min window', type: 'number', min: 2, max: 50, step: 1, value: numv('minWindow', 3), hint: 'Smallest manual/auto fold (2\u201350).' },
    { key: 'temperature', label: 'Temperature', type: 'number', min: 0, max: 1, step: 0.05, value: numv('temperature', 0.2), hint: '0 = deterministic, 1 = loose. 0 is allowed.' },
    { key: 'useCustom', label: 'Summary prompts', type: 'select', value: c.useCustom ? 'custom' : 'default', options: [
      { value: 'default', label: 'Use built-in defaults' },
      { value: 'custom', label: 'Use my custom prompts' },
    ], hint: 'Edit the three prompts with the buttons below. Empty = built-in default.' },
  ], (out) => {
    // numeric fields: empty/NaN -> fall back to default, EXCEPT temperature where 0
    // is a valid value (so we must not use the `|| default` idiom for it).
    const n = (v: string | undefined, d: number): number => { const s = (v ?? '').trim(); const x = Number(s); return s !== '' && isFinite(x) ? x : d; };
    const cfg: Record<string, unknown> = {
      ...(_summarizerCfg ?? {}), // preserve the (separately-edited) prompt strings
      auto: out.auto === 'on',
      genMaxTokens: n(out.genMaxTokens, 4000),
      detailCap: n(out.detailCap, 6000),
      gistCap: n(out.gistCap, 800),
      autoWindow: n(out.autoWindow, 8),
      minWindow: n(out.minWindow, 3),
      temperature: n(out.temperature, 0.2),
      useCustom: out.useCustom === 'custom',
    };
    _summarizerCfg = cfg; // keep local copy in sync
    ctx.sendToBackend({ type: 'vellum_set_summarizer', cfg });
    notify(ctx, 'success', 'Summarizer settings saved.');
  }, { actions: [
    { label: '\u270E Gist prompt', onClick: () => openPromptEditor(ctx, 'gist') },
    { label: '\u270E Chapter prompt', onClick: () => openPromptEditor(ctx, 'chapter') },
    { label: '\u270E Arc prompt', onClick: () => openPromptEditor(ctx, 'arc') },
  ] });
}

/** Edit ONE summary prompt (gist | chapter | arc) in its own big editor. The box
 * shows the user's custom text only; the built-in default is the placeholder
 * (greyed, never saved). Empty = use the live default forever. */
function openPromptEditor(ctx: Ctx, kind: 'gist' | 'chapter' | 'arc'): void {
  const c = _summarizerCfg ?? {};
  const key = kind === 'gist' ? 'gistPrompt' : kind === 'arc' ? 'arcPrompt' : 'chapterPrompt';
  const def = _summarizerDefaults[kind] || '';
  const title = kind === 'gist' ? 'Gist Prompt (chronicle line)' : kind === 'arc' ? 'Arc Prompt (detail)' : 'Chapter Prompt (detail)';
  const desc = kind === 'gist'
    ? 'Condenses a finished record into the short chronicle paragraph.'
    : kind === 'arc'
      ? 'Writes the dense ARC record (detail + keys) from several chapters.'
      : 'Writes the dense CHAPTER record (detail + keys) from the turns.';
  formModal(title, [
    { key: 'prompt', label: desc, type: 'textarea', big: true, value: String(c[key] ?? ''), placeholder: def },
  ], (out) => {
    // empty (or whitespace) clears the custom prompt → the live default is used.
    const text = (out.prompt ?? '').trim();
    const cfg: Record<string, unknown> = { ...(_summarizerCfg ?? {}), [key]: text };
    if (text && !cfg.useCustom) cfg.useCustom = true; // writing a prompt implies "use custom"
    _summarizerCfg = cfg;
    ctx.sendToBackend({ type: 'vellum_set_summarizer', cfg });
    notify(ctx, 'success', text ? `${title} saved.` : `${title} reset to the built-in default.`);
  }, { large: true, saveLabel: 'Save prompt', actions: [
    { label: '\u21BA Reset to default', onClick: (setField) => setField('prompt', '') },
  ] });
}

function triggerImport(ctx: Ctx): void {
  const inp = document.createElement('input');
  inp.addEventListener('change', () => {
    const f = inp.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { const log = JSON.parse(String(r.result)); setQolBusy('import', true); ctx.sendToBackend({ type: 'vellum_import', log }); notify(ctx, 'info', 'Importing chronicle\u2026'); } catch { notify(ctx, 'warning', 'That file is not valid JSON.'); } };
    r.readAsText(f);
  });
  inp.click();
}

/** Compact token count for toasts: 1234 -> "1.2k". */
function fmtTokens(n: number): string { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); }

function downloadJson(name: string, data: unknown): void {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch { /* ignore */ }
}

function downloadText(name: string, text: string, mime = 'text/plain'): void {
  try {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch { /* ignore */ }
}

export function setup(ctx: Ctx): () => void {
  _ctxRef = ctx;
  setThemePersist((json) => ctx.sendToBackend({ type: 'vellum_set_theme', theme: json }));
  // window PREFS (layout / density / custom arrangement / float tab & geometry /
  // auto-name / fold-toast) persist host-side too, so they survive an extension
  // reload that wipes localStorage — same durability the theme already had.
  setPrefsPersist((json) => ctx.sendToBackend({ type: 'vellum_set_prefs', prefs: json }));
  const style = ctx.dom.addStyle(FONT_FACES + '\n' + STYLES);
  let state: ChronicleState = freshState();
  const getState = (): ChronicleState => state;

  const tab = ctx.ui.registerDrawerTab({
    id: 'vellum-engine-tab', title: 'VELLUM', shortName: 'VELLUM',
    description: 'Living-narrative chronicle, cast, relations, graph & QOL',
    keywords: ['vellum', 'chronicle', 'cast', 'relations', 'lore', 'memory', 'graph'],
    headerTitle: 'VELLUM', iconSvg: ICON,
  });
  const drawer = createShell(ctx, getState);
  tab.root.appendChild(drawer.root);

  // apply the saved theme to the drawer shell + document (launcher/toggle/icon)
  applyTheme(drawer.root);
  _retheme = () => { applyTheme(drawer.root); try { drawer.update(true); float.applyTheme(); float.refresh(); } catch { /* ignore */ } };

  // bridge: tab components issue CRUD via send(); refresh re-renders both shells
  wireBridge((payload) => ctx.sendToBackend(payload), (force?: boolean) => { drawer.update(force); float.refresh(); });

  // beautiful floating window — a live scene DASHBOARD with a refresh button
  const FLOAT_TABS = TABS.filter((t) => t.group === 'primary');
  let floatTab = getPref<string>('floatTab', 'now');
  let floatMounted: Mounted<ChronicleState> | null = null;
  let floatMountedId: string | null = null;
  const floatTabStrip = (): string => FLOAT_TABS.map((t) =>
    `<button class="vlf-tab${t.id === floatTab ? ' on' : ''}" data-vlf-tab="${t.id}" title="${t.label}" aria-label="${t.label}">${icon(t.icon, { size: 16 })}<span class="vlf-tab-l">${t.label}</span></button>`).join('');
  const float: FloatWindow = createFloatWindow({
    title: 'VELLUM',
    actions: [{ id: 'refresh', label: '\u27F3', title: 'Re-fold the latest turn (recover a mis-parsed turn)' }],
    onAction: (id) => { if (id === 'refresh') { ctx.sendToBackend({ type: 'vellum_refresh' }); notify(ctx, 'info', 'Refreshing the tracker\u2026'); } },
    render: (host) => {
      // a mini-app: the primary tabs (Now/Cast/Bonds/Chronicle/Director) mount into the body.
      let tabsEl = host.querySelector('[data-vlf-tabs]') as HTMLElement | null;
      let bodyEl = host.querySelector('[data-vlf-tabbody]') as HTMLElement | null;
      if (!tabsEl || !bodyEl) {
        host.innerHTML = '<div class="vlf-tabs" data-vlf-tabs></div><div class="vlf-tabbody" data-vlf-tabbody></div>';
        tabsEl = host.querySelector('[data-vlf-tabs]') as HTMLElement;
        bodyEl = host.querySelector('[data-vlf-tabbody]') as HTMLElement;
        floatMounted = null; floatMountedId = null;
        tabsEl.addEventListener('click', (e) => {
          const b = (e.target as HTMLElement).closest('[data-vlf-tab]');
          if (!b) return;
          floatTab = b.getAttribute('data-vlf-tab')!;
          setPref('floatTab', floatTab);
          float.refresh();
        });
      }
      tabsEl.innerHTML = floatTabStrip();
      const def = FLOAT_TABS.find((t) => t.id === floatTab) ?? FLOAT_TABS[0]!;
      try {
        if (!floatMounted || floatMountedId !== def.id) {
          if (floatMounted) floatMounted.destroy();
          bodyEl.innerHTML = '';
          floatMounted = mount(bodyEl, def.comp as Component<ChronicleState>, getState(), 'float-' + def.id);
          floatMountedId = def.id;
        } else {
          floatMounted.update(getState());
        }
      } catch (e) {
        try { console.warn('[vellum] float tab render failed:', e); } catch { /* ignore */ }
        bodyEl.innerHTML = '<div class="vle-empty sm">This view hit an error. Hit refresh.</div>';
        floatMounted = null; floatMountedId = null;
      }
    },
  });
  let floatShell: ReturnType<typeof createShell> | null = null;
  void floatShell; void createShell;

  let inputBtn: { destroy(): void } | null = null;
  try {
    inputBtn = ctx.ui.registerInputBarAction?.({ id: 'vellum-float-toggle', title: 'VELLUM window', iconSvg: ICON, onClick: () => float.toggle() }) ?? null;
  } catch { /* optional */ }

  const unsub = ctx.onBackendMessage((p: any) => {
    try {
      if (p?.type === 'vellum_toast') {
        const lvl: ToastLevel = p.level === 'success' || p.level === 'warning' ? p.level : 'info';
        notify(ctx, lvl, String(p.msg ?? ''));
      } else if (p?.type === 'vellum_state') {
        _lastStateAt = Date.now(); // mark arrival so the post-turn safety poll can skip
        state = p.state ?? freshState();
        if (p.tone) {
        _tone = { romance: p.tone.romance ?? 'medium', disposition: p.tone.disposition ?? 'fair', social: p.tone.social ?? 'living', politics: p.tone.politics ?? 'off' };
        const isDefault = _tone.romance === 'medium' && _tone.disposition === 'fair' && _tone.social === 'living' && _tone.politics === 'off';
          document.querySelectorAll('[data-qol=\'tone\']').forEach((b) => b.classList.toggle('on', !isDefault));
        }
        if (typeof p.tidy === 'boolean') _tidyOn = p.tidy;
        if (typeof p.offscreen === 'boolean') _offscreenOn = p.offscreen;
        if (typeof p.hide === 'boolean') { _hideOn = p.hide; document.querySelectorAll('[data-qol=\'hide\']').forEach((b) => b.classList.toggle('on', _hideOn)); }
        if (typeof p.chapterVault === 'string') _chapterVault = p.chapterVault;
        if (Array.isArray(p.relationLocks)) setRelationLocks(p.relationLocks);
        if (Array.isArray(p.directives)) { setDirectorDirectives(p.directives); }
        if ('nextScene' in p) setDirectorNextScene(p.nextScene);
        if (typeof p.hardLimits === 'string') _hardLimits = p.hardLimits;
        if (typeof p.calendar === 'string') { _calendar = p.calendar; setDashCalendar(_calendar); }
        // mirror date-display config from the reduced state so the Calendar modal opens pre-filled
        if (state?.dateFormat) _dateFormat = state.dateFormat;
        _dateEpoch = state?.dateEpoch ? new Date(state.dateEpoch).toISOString().slice(0, 10) : '';
        _monthNames = Array.isArray(state?.monthNames) ? state.monthNames.join(', ') : '';
        _monthNamesShort = Array.isArray(state?.monthNamesShort) ? state.monthNamesShort.join(', ') : '';
        _yearPrefix = state?.yearPrefix ?? '';
        _yearSuffix = state?.yearSuffix ?? '';
        if (typeof p.traversalMode === 'string') {
          _traverseMode = p.traversalMode;
          if (typeof p.traversalAxis === 'string') _traverseAxis = p.traversalAxis;
          document.querySelectorAll('[data-qol=\'traverse\']').forEach((b) => b.classList.toggle('on', _traverseMode !== 'off'));
        }
        setSysInfo({ recall: _traverseMode === 'off' ? 'off' : _traverseMode === 'tree' ? `tree\u00b7${axisLabel(_traverseAxis)}` : 'flat' });
        if (typeof p.theme === 'string' && p.theme) { hydrateTheme(p.theme); applyTheme(drawer.root); }
        // hydrate the window prefs blob (layout/density/custom/float/auto-name/
        // fold-toast). Backend wins after a reload that wiped localStorage; when it
        // changed anything, re-read the module state, re-sync toggles, and re-render.
        if (typeof p.prefs === 'string' && p.prefs && hydratePrefs(p.prefs)) {
          reloadLayoutFromPrefs();
          reloadAutoNameFromPrefs();
          _foldToastOn = getPref<boolean>('foldToast', false);
          document.querySelectorAll('[data-qol=\'foldtoast\']').forEach((b) => b.classList.toggle('on', _foldToastOn));
          const nextFloatTab = getPref<string>('floatTab', 'now');
          if (nextFloatTab !== floatTab) floatTab = nextFloatTab;
          try { float.reloadGeo(); } catch { /* ignore */ }
          try { applyTheme(drawer.root); } catch { /* ignore */ }
        }
        drawer.update(); float.refresh();
      } else if (p?.type === 'vellum_fold_progress') {
        // Two-phase fold: phase 1 = the live scene is in (fast); phase 2 = the
        // deep memory pass (knowledge/secrets/journal) finished. One sticky toast
        // advances in place rather than stacking two. Off by default (opt-in via
        // the Update-toast toggle) so the common turn is silent.
        if (_foldToastOn) {
          const total = Number(p.total) || 1;
          if (total < 2) {
            stickyToast('fold', 'success', 'Chronicle updated.', true); // single-pass turn
          } else if (p.phase === 1) {
            stickyToast('fold', 'info', 'Scene inscribed\u2026 weaving memory (1/2)');
          } else {
            stickyToast('fold', 'success', 'Chronicle updated (2/2)', true);
          }
        }
      } else if (p?.type === 'vellum_injection') {
        setInjectionLog(p.log ?? []);
        if (p.log?.[0]?.chars) setSysInfo({ injChars: p.log[0].chars });
        drawer.update(); float.refresh();
      } else if (p?.type === 'vellum_injection_push') {
        // Fix 11 — live retrieval feed: stream the new record in as it happens
        if (p.record) { pushInjectionRecord(p.record); if (p.record.chars) setSysInfo({ injChars: p.record.chars }); drawer.update(); float.refresh(); }
      } else if (p?.type === 'vellum_continuity') {
        // Plot Director: passive continuity warnings — advise, never block.
        if (Array.isArray(p.warnings) && p.warnings.length) notify(ctx, 'warning', 'Continuity: ' + p.warnings.map((w: { text: string }) => w.text).join(' '));
      } else if (p?.type === 'vellum_vault') {
        setVaultSnap(p);
        drawer.update();
      } else if (p?.type === 'vellum_vault_categories') {
        // categories changed — re-request the full snapshot to reflect counts
        ctx.sendToBackend({ type: 'vellum_get_vault' });
      } else if (p?.type === 'vellum_vault_done') {
        if (!p.ok) notify(ctx, 'warning', 'Vault: ' + (p.reason ?? 'failed'));
      } else if (p?.type === 'vellum_export' && p.log) {
        setQolBusy('export', false);
        downloadJson(`vellum-${p.chatId ?? 'chronicle'}.json`, p.log);
        notify(ctx, 'success', 'Chronicle exported.');
      } else if (p?.type === 'vellum_export_markdown' && typeof p.markdown === 'string') {
        setQolBusy('exportmd', false);
        downloadText(`vellum-${p.chatId ?? 'chronicle'}.md`, p.markdown, 'text/markdown');
        notify(ctx, 'success', 'Story exported as Markdown.');
      } else if (p?.type === 'vellum_summarize_start') {
        // a summarize pass actually STARTED. The manual button already toasts on
        // click; this is the signal for the AUTOMATIC cadence (which runs off the
        // response path, so the user otherwise had no indication it kicked off).
        if (p.auto) notify(ctx, 'info', 'Summarizing older turns\u2026');
      } else if (p?.type === 'vellum_summarize_progress') {
        // live count + running token usage as each window is summarized.
        const tok = typeof p.tokens === 'number' && p.tokens > 0 ? ` \u00b7 ~${fmtTokens(p.tokens)} tokens` : '';
        notify(ctx, 'info', `Summarizing\u2026 ${p.done}/${p.total}${tok}`);
      } else if (p?.type === 'vellum_summarize_done') {
        setQolBusy('summarize', false);
        const tok = typeof p.tokens === 'number' && p.tokens > 0 ? ` \u00b7 ~${fmtTokens(p.tokens)} tokens` : '';
        if (p.ok === false && p.reason === 'too_few') notify(ctx, 'warning', `Select at least ${p.need ?? 2} turns to fold into a chapter.`);
        else if (p.ok === false && p.reason === 'no_generation') notify(ctx, 'warning', 'Summarizing needs the generation permission.');
        else notify(ctx, 'success', p.rounds ? `Summarized ${p.rounds} chapter${p.rounds === 1 ? '' : 's'}${tok}.` : 'Nothing old enough to summarize yet.');
        // surface WHY the vault didn't update (the silent-gate that hid this)
        const v = p.vault;
        if (p.rounds && v && !v.created && !v.updated) {
          if (v.reason === 'no_world_books') notify(ctx, 'warning', 'Chapter detail not saved to vault — grant the world_books permission.');
          else if (v.reason === 'mode_off') notify(ctx, 'info', 'Chapter-vault is off (Tone \u2192 Chapter detail in vault) — chronicle gist only.');
        } else if (v && (v.created || v.updated)) {
          notify(ctx, 'success', `Vault: ${v.created} chapter${v.created === 1 ? '' : 's'} saved${v.updated ? `, ${v.updated} updated` : ''}.`);
        }
      } else if (p?.type === 'vellum_arc_done') {
        const tok = typeof p.tokens === 'number' && p.tokens > 0 ? ` \u00b7 ~${fmtTokens(p.tokens)} tokens` : '';
        if (p.ok === false && p.reason === 'too_few') notify(ctx, 'warning', 'Need at least 2 chapters to fold into an arc.');
        else if (p.ok === false && p.reason === 'no_generation') notify(ctx, 'warning', 'Folding to an arc needs the generation permission.');
        else notify(ctx, 'success', p.rounds ? `Folded ${p.bound ?? 0} chapters into an arc${tok}.` : 'No chapters old enough to fold yet.');
      } else if (p?.type === 'vellum_beat_suggestions') {
        setBeatSuggestions(p.items);
        try { refreshUI(); } catch { /* best effort */ }
        const n = Array.isArray(p.items) ? p.items.length : 0;
        notify(ctx, 'info', n ? `${n} beat suggestion${n === 1 ? '' : 's'} ready in Chronicle \u2192 Beats.` : 'No new beats to suggest yet.');
      } else if (p?.type === 'vellum_beat_done') {
        // state broadcast already refreshes the view; nothing else to do
      } else if (p?.type === 'vellum_resummarize_done') {
        setQolBusy('resummarize', false);
        if (!p.ok) notify(ctx, 'warning', p.reason === 'no_generation' ? 'Re-summarize needs the generation permission.' : 'Re-summarize failed.');
        else notify(ctx, 'success', p.rounds ? `Rebuilt ${p.rounds} chapter${p.rounds === 1 ? '' : 's'}.` : 'No chapters to rebuild.');
      } else if (p?.type === 'vellum_summarizer_state') {
        // backend handed us the current config + built-in default prompts → open the editor
        _summarizerCfg = (p.cfg && typeof p.cfg === 'object') ? p.cfg as Record<string, unknown> : {};
        if (p.defaults && typeof p.defaults === 'object') _summarizerDefaults = { chapter: String((p.defaults as any).chapter || ''), arc: String((p.defaults as any).arc || ''), gist: String((p.defaults as any).gist || '') };
        if (_ctxRef) openSummarizerModal(_ctxRef);
      } else if (p?.type === 'vellum_summarizer_done') {
        if (p.ok && p.cfg && typeof p.cfg === 'object') _summarizerCfg = p.cfg as Record<string, unknown>;
      } else if (p?.type === 'vellum_cleared') {
        setQolBusy('clear', false);
        notify(ctx, 'success', 'Chronicle cleared.');
      } else if (p?.type === 'vellum_recover_done') {
        notify(ctx, p.ok ? 'success' : 'warning', p.ok ? `Recovered ${p.events} events from backup.` : (p.reason === 'no_active_chat' ? 'No active chat.' : 'No fuller backup to recover \u2014 current data is already the most complete.'));
      } else if (p?.type === 'vellum_import_done') {
        setQolBusy('import', false);
        notify(ctx, p.ok ? 'success' : 'warning', p.ok ? `Imported ${p.events ?? ''} events.` : `Import failed: ${p.reason ?? 'error'}`);
      } else if (p?.type === 'vellum_rescan_done') {
        setQolBusy('rescan', false);
        notify(ctx, 'success', 'Rescanned.');
      } else if (p?.type === 'vellum_refresh_done') {
        notify(ctx, p.ok ? 'success' : 'warning', p.ok ? (p.refolded ? `Re-folded turn ${p.refolded}.` : 'Tracker refreshed.') : (p.reason === 'no_active_chat' ? 'No active chat.' : 'Refresh failed.'));
      } else if (p?.type === 'vellum_undo_done') {
        setQolBusy('undo', false);
        notify(ctx, p.ok ? 'success' : 'warning', p.ok ? `Undid turn ${p.undoneTurn ?? ''}.` : (p.reason === 'nothing_to_undo' ? 'Nothing to undo.' : `Undo failed: ${p.reason ?? 'error'}`));
      } else if (p?.type === 'vellum_rebuild_done') {
        setQolBusy('rebuild', false);
        const what = p.messagesOnly ? (p.turns ? `Captured ${p.turns} missing message memor${p.turns === 1 ? 'y' : 'ies'}` : 'No missing message memories \u2014 nothing to capture') : `Chronicle rebuilt from ${p.turns ?? 0} turn(s)`;
        notify(ctx, p.ok ? 'success' : 'warning', p.ok ? `${what}.` : `Rebuild failed: ${p.reason ?? 'error'}`);
      } else if (p?.type === 'vellum_next_scene_done' || p?.type === 'vellum_next_scene_state') {
        setDirectorNextScene('next' in p ? p.next : null);
        try { refreshUI(); } catch { /* best effort */ }
        if (p.type === 'vellum_next_scene_done') notify(ctx, 'success', p.next ? 'Next scene set.' : 'Next scene cleared.');
      } else if (p?.type === 'vellum_turnlog') {
        setTurnLog(p.turns, p.maxTurn);
        try { refreshUI(); } catch { /* best effort */ }
      } else if (p?.type === 'vellum_limits_done' || p?.type === 'vellum_limits_state') {
        if (typeof p.limits === 'string') _hardLimits = p.limits;
      } else if (p?.type === 'vellum_budget_state') {
        _budget = (p.budget && typeof p.budget === 'object') ? p.budget as Record<string, unknown> : {};
        if (_ctxRef) openBudgetModal(_ctxRef);
      } else if (p?.type === 'vellum_budget_done') {
        if (p.budget && typeof p.budget === 'object') _budget = p.budget as Record<string, unknown>;
      } else if (p?.type === 'vellum_calendar_done') {
        if (typeof p.calendar === 'string') { _calendar = p.calendar; setDashCalendar(_calendar); }
      } else if (p?.type === 'vellum_hide_done') {
        setQolBusy('hide', false);
        _hideOn = !!p.enabled;
        document.querySelectorAll('[data-qol=\'hide\']').forEach((b) => b.classList.toggle('on', _hideOn));
        notify(ctx, 'success', p.enabled ? `Hiding ${p.hid ?? 0} filed turn(s) from the prompt.` : `Restored ${p.shown ?? 0} turn(s).`);
      } else if (p?.type === 'vellum_traversal_done') {
        setQolBusy('traverse', false);
        _traverseMode = p.mode ?? (p.enabled ? 'flat' : 'off');
        if (typeof p.axis === 'string') _traverseAxis = p.axis;
        document.querySelectorAll('[data-qol=\'traverse\']').forEach((b) => b.classList.toggle('on', _traverseMode !== 'off'));
        if (_traverseMode !== 'off' && !p.available) notify(ctx, 'warning', 'Traversal needs the generation permission \u2014 falling back to standard recall.');
        else if (_traverseMode === 'tree') notify(ctx, 'success', `Controller retrieval: tree drill (${_traverseAxis === 'character' ? 'by character' : _traverseAxis === 'hybrid' ? 'by character + timeline' : 'by timeline'}).`);
        else notify(ctx, 'success', _traverseMode === 'flat' ? 'Controller retrieval: flat (one-shot).' : 'Controller retrieval off.');
      } else if (p?.type === 'vellum_tone_done') {
        _tone = { romance: p.romance ?? 'medium', disposition: p.disposition ?? 'fair', social: p.social ?? 'living', politics: p.politics ?? 'off' };
        const isDefault = _tone.romance === 'medium' && _tone.disposition === 'fair' && _tone.social === 'living' && _tone.politics === 'off';
        document.querySelectorAll('[data-qol=\'tone\']').forEach((b) => b.classList.toggle('on', !isDefault));
        notify(ctx, 'success', `Tone set \u2014 romance: ${_tone.romance.replace('_', ' ')}, world: ${_tone.disposition}, social: ${_tone.social}, politics: ${_tone.politics}.`);
      } else if (p?.type === 'vellum_tidy_done') {
        setQolBusy('tidy', false);
        if (!p.ok) notify(ctx, 'warning', p.reason === 'no_generation' ? 'Tidy threads needs the generation permission.' : 'Tidy threads failed.');
        else notify(ctx, 'success', p.merged ? `Merged ${p.merged} duplicate thread(s).` : 'No duplicate threads found.');
      } else if (p?.type === 'vellum_tidy_facts_done') {
        setQolBusy('tidyfacts', false);
        if (!p.ok) notify(ctx, 'warning', p.reason === 'no_generation' ? 'Tidy lore needs the generation permission.' : 'Tidy lore failed.');
        else notify(ctx, 'success', p.merged ? `Folded ${p.merged} duplicate knowledge/secret(s).` : 'No duplicate lore found.');
      } else if (p?.type === 'vellum_tidy_set_done') {
        _tidyOn = !!p.enabled;
        if (p.enabled && !p.available) notify(ctx, 'warning', 'Auto-tidy needs the generation permission to run.');
        else notify(ctx, 'success', p.enabled ? 'Auto-tidy threads on.' : 'Auto-tidy threads off.');
      } else if (p?.type === 'vellum_offscreen_set_done') {
        _offscreenOn = !!p.enabled;
        if (p.enabled && !p.available) notify(ctx, 'warning', 'Off-screen sim needs the generation permission to run.');
        else notify(ctx, 'success', p.enabled ? 'Off-screen simulation on \u2014 the world ticks every few turns.' : 'Off-screen simulation off.');
      } else if (p?.type === 'vellum_offthread_done') {
        // only the manual advance/simulate-all path reports a reason; the CRUD
        // ops send a bare ok:true (nothing to announce).
        if (p.reason === 'no_generation') notify(ctx, 'warning', 'Off-screen sim needs the generation permission to run.');
        else if (p.reason === 'no_cast') notify(ctx, 'info', 'Nobody off-screen to simulate right now.');
        else if (p.reason === 'empty_reply') notify(ctx, 'warning', 'The model returned no off-screen beat \u2014 try again.');
        else if (p.advanced) notify(ctx, 'success', 'Advanced the off-screen world.');
      } else if (p?.type === 'vellum_chaptervault_done') {
        _chapterVault = p.mode ?? 'keyed';
        if (p.mode !== 'off' && !p.available) notify(ctx, 'warning', 'Chapter-vault needs the world_books permission \u2014 keeping chronicle gist only.');
        else notify(ctx, 'success', p.mode === 'off' ? 'Chapter detail: chronicle only.' : `Chapter detail \u2192 vault (${p.mode}).`);
      }
    } catch (e) { try { console.warn('[vellum] message handler:', e); } catch { /* ignore */ } }
  });

  const offChat = ctx.events?.on('CHAT_SWITCHED', () => { resetGraphCache(); ctx.sendToBackend({ type: 'vellum_get_state' }); });
  // After a turn finishes the backend folds and broadcasts vellum_state on its
  // own (including an EARLY broadcast before the slow prose extractor). So this is
  // just a safety net for the case where that broadcast never arrives (a missed
  // fold, or GENERATION_ENDED firing before the message is committed): fire ONE
  // conditional poll ~700ms later, and only if no fresh state showed up in the
  // meantime. No fixed 600ms floor on the common path, and no redundant second
  // fetch that would force another full fold.
  const offGen = ctx.events?.on('GENERATION_ENDED', () => {
    const mark = Date.now();
    setTimeout(() => { if (_lastStateAt < mark) ctx.sendToBackend({ type: 'vellum_get_state' }); }, 700);
  });
  ctx.sendToBackend({ type: 'vellum_get_state' });

  // First-run guide: shows once (flag in localStorage), re-openable from Actions ▸ Help.
  try { maybeShowOnboarding(); } catch { /* never block the panel */ }

  return () => {
    try { unsub(); } catch { /* ignore */ }
    try { offChat?.(); } catch { /* ignore */ }
    try { offGen?.(); } catch { /* ignore */ }
    try { drawer.destroy(); } catch { /* ignore */ }
    try { float.destroy(); } catch { /* ignore */ }
    try { inputBtn?.destroy(); } catch { /* ignore */ }
    try { tab.destroy(); } catch { /* ignore */ }
    try { style.remove(); } catch { /* ignore */ }
    try { cleanupToasts(); } catch { /* ignore */ }
    try { ctx.dom.cleanup(); } catch { /* ignore */ }
  };
}
