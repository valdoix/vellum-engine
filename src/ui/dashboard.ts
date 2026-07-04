import type { ChronicleState, PresentChar, Relation } from '../domain/types.js';
import { esc, nameOf, catsOf, CAT_COLORS, SENT_LABEL, byRecent, nameHtml, bondMeter, initials, avatarParts } from './format.js';
import { storyStats } from '../domain/stats.js';
import { formatDate } from '../domain/date-format.js';

/**
 * The floating-window DASHBOARD — a single at-a-glance scene panel (distinct
 * from the drawer's tabbed browser). Shows the live now: turn/time/place/
 * weather/tension, each present character's state + emotion + inner thought,
 * relations, threads, parallel offscreen events, and the latest journal /
 * knowledge / secret / relation changes. Pure render(state) → html.
 */

import { getLayout, type LayoutDef, type SectionId } from './layout-defs.js';
import { getTheme } from './theme.js';

/** Section registry — each block is a pure (state) → html function. Layouts
 * compose these by id; the functions never change, the layout owns structure. */
const SECTIONS: Record<SectionId, (s: ChronicleState) => string> = {
  status: statusBar,
  present: presentBlock,
  tension: tensionBar,
  relations: relationsBlock,
  threads: threadsBlock,
  parallel: parallelBlock,
  recent: recentBlock,
  stats: statsBlock,
};

const SECTION_LABEL: Record<SectionId, string> = {
  status: 'Status', present: 'Present', tension: 'Tension', relations: 'Relations',
  threads: 'Threads', parallel: 'Parallel', recent: 'Latest', stats: 'Stats',
};

// dock glyphs for the phone 'switch' layout (one section at a time)
const SECTION_GLYPH: Record<SectionId, string> = {
  status: '\u2630', present: '\u25C9', tension: '\u25D0', relations: '\u269C',
  threads: '\u22C8', parallel: '\u2748', recent: '\u2606', stats: '\u2211',
};
// HUD telemetry footer text (recall mode + last injection size), set by app.ts.
// Rendered always but CSS-hidden unless futuristic chrome — keeps dashboard pure.
let _sysInfo = { recall: 'off', injChars: 0 };
export function setSysInfo(info: Partial<{ recall: string; injChars: number }>): void { _sysInfo = { ..._sysInfo, ...info }; }
// world-calendar epoch/season string (set via Actions), surfaced in the hero meta line
let _calendar = '';
export function setDashCalendar(cal: string): void { _calendar = cal || ''; }
function sysFooter(): string {
  const inj = _sysInfo.injChars ? ` &middot; inj=${_sysInfo.injChars}ch` : '';
  return `<div class="vld-sysfoot">SYS: recall=${esc(_sysInfo.recall)}${inj}</div>`;
}
// which section the phone form is showing; persists across re-renders within a session
let _phoneSection: SectionId | null = null;
/** Set the active phone-form section (delegated dock click). */
export function setPhoneSection(id: string): void {
  if ((['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent'] as string[]).includes(id)) _phoneSection = id as SectionId;
}

/** Phone 'switch' render: one section + a bottom dock of the visible sections.
 * Reuses the section registry verbatim — only the compose differs from stack. */
function switchHtml(s: ChronicleState, lay: LayoutDef): string {
  const visible = lay.order.filter((id) => !lay.hidden.includes(id));
  if (!visible.length) return '<div class="vle-empty sm">Nothing recorded yet.</div>';
  // active = remembered section if still visible, else first; sections with no
  // content this turn are skippable but still dock-reachable.
  const active = (_phoneSection && visible.includes(_phoneSection)) ? _phoneSection : visible[0]!;
  let body = '';
  try { body = SECTIONS[active](s); } catch { /* boundary */ }
  if (!body) body = `<div class="vle-empty sm">Nothing for ${SECTION_LABEL[active]} this scene yet.</div>`;
  const dock = visible.map((id) =>
    `<button class="vld-dock-b${id === active ? ' on' : ''}" data-phone-sec="${id}" title="${SECTION_LABEL[id]}"><span class="vld-dock-g">${SECTION_GLYPH[id]}</span><span class="vld-dock-l">${SECTION_LABEL[id]}</span></button>`
  ).join('');
  return `<div class="vld-phone"><div class="vld-phone-body">${body}</div><div class="vld-dock">${dock}</div></div>`;
}

/**
 * Render the dashboard for the active LAYOUT (separate from skin). The layout
 * decides which sections show, their order, density, columns, and which are
 * collapsed into <details>. Skin/scale handle look/size independently.
 */
export function dashboardHtml(s: ChronicleState): string {
  let lay: LayoutDef;
  try { lay = getLayout(); } catch { lay = { id: 'dashboard', name: '', blurb: '', glyph: '', order: ['status', 'present', 'tension', 'relations', 'threads', 'parallel', 'recent'], hidden: [], collapsed: [], density: 'comfortable', columns: 1 }; }
  if (lay.mode === 'switch') {
    return `<div class="vld-inner" data-layout="${lay.id}" data-density="${lay.density}" data-cols="1" data-mode="switch">${switchHtml(s, lay)}${sysFooter()}</div>`;
  }
  const parts = lay.order
    .filter((id) => !lay.hidden.includes(id))
    .map((id) => {
      let html = '';
      try { html = SECTIONS[id](s); } catch (e) { try { console.warn('[vellum] dashboard section ' + id + ' failed:', e); } catch { /* ignore */ } }
      if (!html) return '';
      if (lay.collapsed.includes(id)) {
        return `<details class="vld-fold"><summary>${SECTION_LABEL[id]}</summary><div class="vld-fold-b">${html}</div></details>`;
      }
      return html;
    })
    .filter(Boolean)
    .join('');
  const inner = parts || `<div class="vle-empty sm">Nothing recorded for this scene yet.<br><span>Play a turn — the chronicle fills as the model emits its &lt;vellum&gt; state block.</span></div>`;
  return `<div class="vld-inner" data-layout="${lay.id}" data-density="${lay.density}" data-cols="${lay.columns}">${inner}${sysFooter()}</div>`;
}

function statusBar(s: ChronicleState): string {
  // hero scene line (the biggest thing) + ONE quiet meta line, not 4 gold pills
  const meta = [
    `T${s.turns ?? 0}`,
    s.day !== undefined && s.day !== null ? formatDate(s.day, s.dateFormat || 'day', s) : '',
    s.scene.time ? esc(s.scene.time) : '',
    s.scene.weather ? esc(s.scene.weather) : '',
  ].filter(Boolean).join('  \u00b7  ');
  const loc = s.scene.location
    ? `<div class="vld-loc vld-hero">${esc(s.scene.location)}</div>`
    : '<div class="vld-loc vld-hero vld-loc--none">\u2014</div>';
  // Modern "app" hero: an eyebrow label + an inline tension pill (top-right),
  // so the hero reads as the mockup's scene card. Other chromes ignore these.
  let eyebrow = '', pill = '';
  if (getTheme().chrome === 'modern') {
    eyebrow = '<div class="vld-hero-eyebrow">Current scene</div>';
    const t = Math.max(0, Math.min(10, s.scene.tension || 0));
    if (t) pill = `<span class="vld-hero-tension"><span class="vld-hero-tdot"></span>Tension ${t}</span>`;
  }
  // world-calendar epoch: makes "Day 47" read as an occasion (e.g. ✦ Feast of Ash)
  const epoch = _calendar ? `<div class="vld-epoch">\u2726 ${esc(_calendar)}</div>` : '';
  return `<div class="vld-sec vld-sec--hero">${pill}${eyebrow}${loc}<div class="vld-meta">${meta}</div>${epoch}</div>`;
}

function tensionBar(s: ChronicleState): string {
  const t = Math.max(0, Math.min(10, s.scene.tension || 0));
  if (!t) return '';
  // Modern folds tension into the hero pill (see statusBar) — skip the standalone
  // section so the scroll isn't broken by a near-empty card.
  if (getTheme().chrome === 'modern') return '';
  const style = getTheme().tensionStyle;
  // amber dot-meter (--v-press): tension no longer borrows danger-red
  const dots = Array.from({ length: 10 }, (_, i) =>
    `<span class="vld-dot${i < t ? ' on' : ''}"></span>`).join('');
  const meter = `<div class="vld-dots" role="img" aria-label="tension ${t} of 10">${dots}</div>`;
  const num = `<span class="vld-tension-n">${t}/10</span>`;
  const inner = style === 'num' ? `<span class="vld-tension-n" style="min-width:auto">${t}/10</span>`
    : style === 'bar' ? meter : meter + num;
  return `<div class="vld-sec vld-sec--tension"><div class="vld-h">Tension</div><div class="vld-tension-row">${inner}</div></div>`;
}

function presentBlock(s: ChronicleState): string {
  const detail = s.scene.detail?.length ? s.scene.detail : s.scene.present.map((id) => ({ id } as PresentChar));
  if (!detail.length) return '';
  const rows = detail.map((d) => presentCard(s, d)).join('');
  return `<div class="vld-sec"><div class="vld-h">Present <span class="vld-n">${detail.length}</span></div>${rows}</div>`;
}

/**
 * One present-character card (mockup 09), shared by the drawer Now tab AND the
 * float (container-query reflow via .vld-pc). Portrait medallion + presence dot,
 * sentence-case sentiment mood/condition, doing, and the inner THOUGHT as the
 * focal quoted block. Theme skins live in styles.ts under [data-vle-chrome].
 */
function presentCard(s: ChronicleState, d: PresentChar): string {
  const name = nameOf(s, d.id);
  const status = [
    d.mood ? `<span class="vld-pc-mood">${esc(d.mood)}</span>` : '',
    d.condition ? `<span class="vld-pc-cond">${esc(d.condition)}</span>` : '',
  ].filter(Boolean).join('<span class="vld-pc-sep">\u00b7</span>');
  const doing = d.doing ? `<div class="vld-doing">${esc(d.doing)}</div>` : '';
  const thought = d.thought
    ? `<div class="vld-thought"><span class="vld-thought-k">thinking</span><span class="vld-thought-q">\u201C${esc(d.thought)}\u201D</span></div>`
    : '';
  // carried-items echo: a capped, read-only chip strip of what this character holds
  const carried = (s.items ?? []).filter((it) => it.who === d.id && !it.scene);
  const itemsStrip = carried.length
    ? `<div class="vld-pc-items">${carried.slice(0, 3).map((it) => `<span class="vld-pc-item">${esc(it.item)}</span>`).join('')}${carried.length > 3 ? `<span class="vld-pc-item">+${carried.length - 3}</span>` : ''}</div>`
    : '';
  const av = avatarParts(name, s.cast[d.id]?.imageUrl);
  return `<div class="vld-pc${d.thought ? ' has-thought' : ''}">`
    + `<span class="vld-pc-av${av.cls}"${av.style}>${av.inner}<span class="vld-pc-dot"></span></span>`
    + `<div class="vld-pc-body">`
    + `<div class="vld-pc-top"><span class="vld-pc-n">${nameHtml(s, d.id)}</span>${status ? `<span class="vld-pc-status">${status}</span>` : ''}</div>`
    + `${doing}${thought}${itemsStrip}`
    + `</div></div>`;
}

function relationsBlock(s: ChronicleState): string {
  if (!s.relations.length) return '';
  const present = new Set(s.scene.present);
  const rels = s.relations.filter((r) => !present.size || present.has(r.a) || present.has(r.b)).sort(byRecent);
  if (!rels.length) return '';
  // group directed edges into unordered pairs so both directions share one meter
  const pairs = new Map<string, typeof rels>();
  for (const r of rels) {
    const key = r.a <= r.b ? r.a + '\u0000' + r.b : r.b + '\u0000' + r.a;
    (pairs.get(key) ?? pairs.set(key, []).get(key)!).push(r);
  }
  const rows = Array.from(pairs.values()).slice(0, 5).map((group) => {
    const lead = group[0]!;
    const [pa, pb] = lead.a <= lead.b ? [lead.a, lead.b] : [lead.b, lead.a];
    const cats = catsOf(lead).map((c) => `<span class="vld-cat" style="--c:${CAT_COLORS[c] || '#888'}">${esc(c)}</span>`).join('');
    const meter = bondMeter(group, (id) => nameOf(s, id));
    return `<div class="vld-rel"><span class="vld-rel-p">${nameHtml(s, pa)} \u2194 ${nameHtml(s, pb)}</span>${cats}<span class="vld-rel-s">${esc(SENT_LABEL[lead.sentiment] || lead.sentiment)}</span></div>${meter}`;
  }).join('');
  return `<div class="vld-sec"><div class="vld-h">Relations</div>${rows}</div>`;
}

function threadsBlock(s: ChronicleState): string {
  const open = s.threads.filter((t) => t.status !== 'resolved').sort(byRecent).slice(0, 6);
  if (!open.length) return '';
  const rows = open.map((t) => `<div class="vld-thread"><span class="vld-thread-n">${esc(t.name)}</span><span class="vld-thread-s">${esc(t.status)}</span></div>`).join('');
  return `<div class="vld-sec"><div class="vld-h">Threads <span class="vld-n">${open.length}</span></div>${rows}</div>`;
}

function parallelBlock(s: ChronicleState): string {
  if (!s.parallel?.length) return '';
  const rows = s.parallel.slice(0, 6).map((p) => {
    const who = p.who ? nameHtml(s, p.who) : '';
    const where = p.where ? ` <span class="vld-par-w">@${esc(p.where)}</span>` : '';
    const sim = p.src === 'sim' ? ' <span class="vld-par-sim" title="Off-screen simulation">auto</span>' : '';
    return `<div class="vld-par"><span class="vld-par-who">${who}</span>${where}${sim}<div class="vld-par-act">${esc(p.activity)}${p.note ? ` <em>${esc(p.note)}</em>` : ''}</div></div>`;
  }).join('');
  return `<div class="vld-sec"><div class="vld-h">\u22C8 Parallel (offscreen) <span class="vld-n">${s.parallel.length}</span></div>${rows}</div>`;
}

function recentBlock(s: ChronicleState): string {
  // newest journal / knowledge / secret + the latest relation change, each with
  // a colored left spine per type so the mixed feed is scannable at a glance.
  const parts: string[] = [];
  const j = s.journal.slice().sort((a, b) => b.turn - a.turn)[0];
  if (j) parts.push(`<div class="vld-rec vld-rec--journal"><span class="vld-rec-k">journal</span>${nameHtml(s, j.who)}: \u201C${esc(j.memory)}\u201D</div>`);
  const k = latestKnowledge(s);
  if (k) parts.push(`<div class="vld-rec vld-rec--knew"><span class="vld-rec-k">knew</span>${nameHtml(s, k.who)}: ${esc(k.fact)}</div>`);
  const sec = latestSecret(s);
  if (sec) parts.push(`<div class="vld-rec vld-rec--secret"><span class="vld-rec-k">secret</span>${nameHtml(s, sec.keeper)}: ${esc(sec.text)}</div>`);
  const ch = latestRelChange(s);
  if (ch) parts.push(`<div class="vld-rec vld-rec--shift"><span class="vld-rec-k">shift</span>${ch}</div>`);
  if (!parts.length) return '';
  return `<div class="vld-sec"><div class="vld-h">Latest</div>${parts.join('')}</div>`;
}

/** Story stats — a light "story so far" readout (opt-in section). */
function statsBlock(s: ChronicleState): string {
  const st = storyStats(s);
  const chip = (label: string, val: string | number): string => `<span class="vld-stat"><span class="vld-stat-v">${esc(String(val))}</span><span class="vld-stat-k">${esc(label)}</span></span>`;
  let body = `<div class="vld-stats">${chip('turns', st.turns)}${chip('days', st.days)}${chip('cast', st.cast)}${chip('bonds', st.bonds)}${chip('chapters', st.chapters)}</div>`;
  if (st.topCharacters.length) body += `<div class="vld-stat-row"><span class="vld-stat-lbl">most connected</span> ${st.topCharacters.map((c) => `${esc(c.name)} (${c.bonds})`).join(', ')}</div>`;
  if (st.biggestSwings.length) body += `<div class="vld-stat-row"><span class="vld-stat-lbl">biggest swings</span> ${st.biggestSwings.slice(0, 3).map((x) => `${esc(x.pair)} (${x.delta})`).join(', ')}</div>`;
  return `<div class="vld-sec"><div class="vld-h">Story so far</div>${body}</div>`;
}

/** Fix 23: newest by turn, not array tail (folds can append out of turn order). */
export function latestKnowledge(s: ChronicleState): ChronicleState['knowledge'][number] | undefined {
  return s.knowledge.reduce<ChronicleState['knowledge'][number] | undefined>((best, k) => (!best || k.turn > best.turn ? k : best), undefined);
}
export function latestSecret(s: ChronicleState): ChronicleState['secrets'][number] | undefined {
  return s.secrets.reduce<ChronicleState['secrets'][number] | undefined>((best, x) => (!best || x.formedTurn > best.formedTurn ? x : best), undefined);
}

function latestRelChange(s: ChronicleState): string {
  let best: { turn: number; html: string } | null = null;
  for (const r of s.relations) {
    const cat = (r.categoryHistory ?? []).filter((h) => h.op === 'add' || h.op === 'remove');
    const last = cat[cat.length - 1];
    if (last && (!best || last.turn > best.turn)) {
      const sign = last.op === 'remove' ? '\u2212' : '+';
      best = { turn: last.turn, html: `${nameHtml(s, r.a)} \u2192 ${nameHtml(s, r.b)}: ${sign}${esc(last.category)}` };
    }
  }
  return best ? best.html : '';
}
