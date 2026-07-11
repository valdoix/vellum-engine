import { esc } from './format.js';
import { applyTheme } from './theme.js';

/**
 * First-run onboarding overlay. Shows a comprehensive, keyboard-navigable guide
 * the first time the VELLUM panel opens, and can be re-opened any time from the
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

const SLIDES = [
  {
    title: 'Welcome to VELLUM II',
    body: `
      <p><strong>VELLUM II</strong> is a memory and continuity engine for long-form roleplay. It watches your story as you play it and quietly keeps track of everything that matters — who's in the room, how people feel about each other, what each character secretly knows, what's happening off-screen, and what happened fifty messages ago that would otherwise be forgotten.</p>
      <p>It then feeds the <em>relevant</em> slice of that history back into the AI on every turn, so your characters stay consistent and the world keeps its shape over a long story.</p>
      <p><strong>VELLUM II is a matched set:</strong> the <strong>preset</strong> tells the AI how to write and what to track. The <strong>extension</strong> (this panel) reads that tracking data and builds a living chronicle of your story.</p>
      <p class="vle-ob-note">💡 <strong>Tip:</strong> Use the preset and extension together for the best experience. They're designed as one system.</p>
    `
  },
  {
    title: 'The Tabs: Your Story at a Glance',
    body: `
      <p>VELLUM organizes your story into tabs. Here's what each one does:</p>
      <div class="vle-ob-grid">
        <div class="vle-ob-item">
          <span class="vle-ob-icon">📍</span>
          <div>
            <strong>Now</strong> — The live dashboard. See the current scene, who's present, their moods, tension level, and the latest changes.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">👥</span>
          <div>
            <strong>Cast</strong> — Every character in your story. Click the pencil icon to <strong>edit</strong> any character card. You can add <strong>traits</strong> that evolve with the narrative — the AI tracks how they change over time.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">💞</span>
          <div>
            <strong>Bonds</strong> — Every relationship with affection and trust scores that move gradually and are earned. Relationships are <em>directional</em>, so "A adores B while B can't stand A" is fully representable.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">📜</span>
          <div>
            <strong>Chronicle</strong> — The heart of the panel. Sub-views for <strong>World</strong> (scene, arcs, threads), <strong>Timeline</strong>, <strong>Turns</strong>, <strong>Beats</strong>, <strong>Time Sync</strong> (catch up lagging threads), <strong>Memory</strong> (layered compression), <strong>Knowledge</strong>, <strong>Secrets</strong>, <strong>Scars</strong>, <strong>Codex</strong>, and <strong>Items</strong>.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🎬</span>
          <div>
            <strong>Director</strong> — Control what happens next. Set <strong>Directives</strong> (plot goals), manage <strong>Locations</strong> (gazetteer), stage the <strong>Next Scene</strong>, track <strong>Off-screen</strong> life, plant <strong>Chekhov's Guns</strong>, and review the <strong>Continuity Log</strong>.
          </div>
        </div>
      </div>
    `
  },
  {
    title: 'More Tabs: Tools & Context',
    body: `
      <div class="vle-ob-grid">
        <div class="vle-ob-item">
          <span class="vle-ob-icon">📔</span>
          <div>
            <strong>Journal</strong> — Per-character memory books. Each character (including you) keeps a journal of turning points written from <em>their</em> point of view.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🕸️</span>
          <div>
            <strong>Graph</strong> — A beautiful force-directed map of your relationship web. Drag nodes, zoom, click to isolate. Faction clusters show alliances at a glance.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">📚</span>
          <div>
            <strong>Vault</strong> — Your lorebook entries, grouped by category. VELLUM ships with <strong>pre-made categories</strong> (Characters, Locations, Items, Concepts, etc.) with smart settings already applied. Click any category to <strong>edit its settings</strong> to your liking.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🔍</span>
          <div>
            <strong>Context</strong> — A live feed showing <em>exactly</em> what the engine injected into the prompt this turn. Great for understanding why the AI knew something.
          </div>
        </div>
      </div>
    `
  },
  {
    title: 'The VELLUM Preset Tab',
    body: `
      <p>When you open the VELLUM preset in Lumiverse's <strong>Preset Editor</strong>, you'll see a new <strong>VELLUM</strong> tab alongside the built-in Preset tab. This is your control panel for making the preset and extension talk.</p>
      <div class="vle-ob-grid">
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🔗</span>
          <div>
            <strong>Link Status</strong> — Shows whether the open preset is linked to the extension. Linking is <strong>one click</strong> — no manual tagging or config files needed.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🩺</span>
          <div>
            <strong>Health Check</strong> — Confirms the preset has the required <code>&lt;vellum&gt;</code> state block. If it's missing, click <strong>Fix</strong> to insert it automatically.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">👁️</span>
          <div>
            <strong>Injection Preview</strong> — Shows what the extension <em>would</em> inject into the prompt right now (characters, relationships, recalled turns, facts). Helps you understand what the AI sees.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">📊</span>
          <div>
            <strong>Extraction Status</strong> — Recent turns and whether the extension successfully read their state blocks. If extraction fails, the Health Check will help diagnose why.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">📈</span>
          <div>
            <strong>Prompt Budget</strong> — An estimate of the preset's standing-prompt weight (in tokens) from all enabled blocks, with a per-category breakdown and the heaviest blocks. It also shows the active chat's context budget as read-only status. The estimate updates live as you toggle blocks on and off.
          </div>
        </div>
      </div>
    `
  },
  {
    title: 'Editing Characters: Traits That Evolve',
    body: `
      <p>Character cards aren't static profiles — they're <strong>living records</strong> that change with your story.</p>
      <p><strong>To edit a character:</strong></p>
      <ol class="vle-ob-steps">
        <li>Go to the <strong>Cast</strong> tab</li>
        <li>Click the <strong>pencil icon (✎)</strong> on any character card</li>
        <li>Edit their <strong>name, role, age, appearance, notes, disposition</strong>, and <strong>traits</strong></li>
      </ol>
      <p><strong>Traits</strong> are especially powerful. Enter a comma-separated list like <code>loyal, impulsive, haunted</code>. As the story unfolds, the AI tracks how these traits <strong>evolve</strong> — a character who starts "naive" might become "worldly" after betrayal. These changes show up in the Cast tab automatically.</p>
      <p><strong>Colors &amp; dialogue.</strong> Each card has a <strong>Name color</strong> (with an optional gradient end) and a dedicated <strong>Dialogue color</strong>. With the Colored Dialogue preset block on, a character's spoken lines are tinted their color in the chat display. Leave Dialogue color blank to reuse the name color — a gradient name collapses to a single readable tone for speech — or leave both blank for an automatic, distinct hue.</p>
      <p class="vle-ob-note">💡 <strong>Tip:</strong> Traits work best when they're <em>specific</em> and <em>observable</em>. "Haunted by guilt" is better than "sad."</p>
    `
  },
  {
    title: 'The Vault: Smart Lorebook Categories',
    body: `
      <p>The <strong>Vault</strong> is VELLUM's story-aware layer over Lumiverse's lorebooks. It organizes entries into <strong>smart categories</strong> so you don't have to configure every entry from scratch.</p>
      <p><strong>Pre-made categories include:</strong></p>
      <ul class="vle-ob-list">
        <li><strong>Characters</strong> — Auto-settings for character sheets</li>
        <li><strong>Locations</strong> — Places in your world</li>
        <li><strong>Items</strong> — Objects, artifacts, possessions</li>
        <li><strong>Concepts</strong> — Magic systems, technologies, lore</li>
        <li><strong>Factions</strong> — Groups, organizations, families</li>
        <li><strong>History</strong> — Past events, legends, timelines</li>
      </ul>
      <p>Each category comes with <strong>sensible defaults</strong> (keywords, insertion depth, priority) that you can <strong>edit</strong> by clicking the category name. When you create a new entry, just write the content — the category's settings are applied automatically.</p>
      <p class="vle-ob-note">💡 <strong>Tip:</strong> The Vault shows which entries are <strong>firing now</strong> (actively injected into the prompt) with a highlight.</p>
    `
  },
  {
    title: 'Customize: Make VELLUM Yours',
    body: `
      <p>Click the <strong>◈ Customize</strong> button in the Actions menu to theme the panel exactly how you like it.</p>
      <div class="vle-ob-grid">
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🎨</span>
          <div>
            <strong>Look</strong> — Choose a <strong>skin</strong> (color palette), pick <strong>accent/text/background colors</strong>, adjust <strong>font size</strong>, and select <strong>serif/mono fonts</strong>. VELLUM ships with beautiful presets like <em>Bloom</em>, <em>Ember</em>, <em>Ink</em>, and <em>Parchment</em>.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🖼️</span>
          <div>
            <strong>Chrome</strong> — Pick the visual style of the panel: <em>Default</em>, <em>Illuminated</em> (manuscript style), <em>Modern</em>, <em>Futuristic</em>, or themed chromes matching the skins.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">📐</span>
          <div>
            <strong>Layout</strong> — Choose a <strong>density preset</strong> (Comfortable / Cozy / Compact / Dense) or build a <strong>custom layout</strong> by toggling individual UI elements on/off.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🎭</span>
          <div>
            <strong>Shapes</strong> — Assign decorative shapes to different card types (Cast, Bonds, Beats, Factions, Items). Choose from 24 ornamental styles like <em>Tarot</em>, <em>Notched</em>, <em>Gilt-edge</em>, and more.
          </div>
        </div>
      </div>
      <p class="vle-ob-note">💡 <strong>Tip:</strong> Your theme is saved automatically. You can <strong>export</strong> it as JSON to share or back up, and <strong>import</strong> themes from others.</p>
    `
  },
  {
    title: 'Actions Menu: Your Toolkit',
    body: `
      <p>The <strong>Actions</strong> button (≡) in the top-right opens a menu of powerful tools. Here's what each one does:</p>
      <div class="vle-ob-section">
        <h4>🔧 Tools & Controls</h4>
        <ul class="vle-ob-list">
          <li><strong>Customize</strong> — Open the theme editor (colors, fonts, layout, shapes)</li>
          <li><strong>Boundaries</strong> — Set hard content limits (what this story will never depict)</li>
          <li><strong>Hide filed</strong> — Toggle: hide summarized turns from the prompt to save tokens</li>
          <li><strong>Traverse</strong> — Cycle through retrieval modes: off → flat one-shot → tree drill (arc→chapter→leaf)</li>
          <li><strong>Off-screen</strong> — Toggle: simulate off-screen life (characters act elsewhere every few turns)</li>
        </ul>
      </div>
      <div class="vle-ob-section">
        <h4>⚡ Actions</h4>
        <ul class="vle-ob-list">
          <li><strong>Summarize now</strong> — Compress older turns into chapter memories right now</li>
          <li><strong>Rescan last turn</strong> — Re-read the latest turn if tracking missed something</li>
          <li><strong>Rebuild all</strong> — Reconstruct the entire chronicle from the transcript (recovery tool)</li>
          <li><strong>Undo last turn</strong> — Drop the most recent turn's tracked changes</li>
          <li><strong>Tidy threads</strong> — Merge near-duplicate plot threads (uses AI generation)</li>
          <li><strong>Tidy lore</strong> — Fold near-duplicate knowledge & secrets (uses AI generation)</li>
          <li><strong>Re-summarize all</strong> — Rebuild every chapter summary from scratch with current pipeline</li>
        </ul>
      </div>
    `
  },
  {
    title: 'Actions Menu: Data & Help',
    body: `
      <div class="vle-ob-section">
        <h4>💾 Data</h4>
        <ul class="vle-ob-list">
          <li><strong>Export JSON</strong> — Download the chronicle as a JSON file (full backup)</li>
          <li><strong>Export Markdown</strong> — Download the story as readable Markdown (story-so-far, cast, bonds, codex)</li>
          <li><strong>Import</strong> — Load a chronicle JSON file (restore from backup or switch stories)</li>
          <li><strong>Recover</strong> — Restore this chat from its automatic backup if data was lost</li>
          <li><strong>Clear</strong> — Erase <em>all</em> chronicle data for this chat (cannot be undone)</li>
        </ul>
      </div>
      <div class="vle-ob-section">
        <h4>❓ Help</h4>
        <ul class="vle-ob-list">
          <li><strong>Help</strong> — Re-open this guide anytime</li>
          <li><strong>About</strong> — Version info and credits</li>
        </ul>
      </div>
      <p class="vle-ob-note">⚠️ <strong>Warning:</strong> Actions marked with <strong>⚡</strong> or requiring generation permission will use AI generation tokens. Use them thoughtfully.</p>
    `
  },
  {
    title: 'Chronicle Views: Redesigned for Clarity',
    body: `
      <p>The <strong>Chronicle</strong> tab has been completely rebuilt with visual hierarchy and grouping. Here's what makes each view special:</p>
      <div class="vle-ob-grid">
        <div class="vle-ob-item">
          <span class="vle-ob-icon">📚</span>
          <div>
            <strong>Memory</strong> — Layered compression. <strong>Arc summaries</strong> are wide spine covers, <strong>chapters</strong> are collapsible cards showing their source turns, and <strong>uncovered turns</strong> sit at the bottom as chips. Click a chapter to expand and see the turns it compressed.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🧠</span>
          <div>
            <strong>Knowledge</strong> — Grouped by character. <strong>Dramatic irony</strong> (false beliefs) reads at a glance with a crimson row tint and a <code>⚠ false</code> badge. Reliability is encoded visually: dot (knows) / diamond (believes) / arrow (suspects) / ✗ (irony).
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🔒</span>
          <div>
            <strong>Secrets</strong> — Danger-coded envelope cards. A colored left bar (blue/amber/crimson for minor/major/explosive) signals threat level. "Hidden from" targets appear as chips in the header. Revealed secrets show a watermark and go translucent.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">💔</span>
          <div>
            <strong>Scars</strong> — Palimpsest wound cards grouped by character. The <em>old belief</em> is struck through in red-faded ink above a dashed divider. The moment it was proven wrong sits below. These resurface as doubt under pressure.
          </div>
        </div>
      </div>
    `
  },
  {
    title: 'More Chronicle Views',
    body: `
      <div class="vle-ob-grid">
        <div class="vle-ob-item">
          <span class="vle-ob-icon">📖</span>
          <div>
            <strong>Codex</strong> — Tag-grouped canon index. Facts are organized by category (Geography, History, Custom) with a thin gold border signaling ground truth. These are facts the AI invented and bound as <em>immutable canon</em>.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🌍</span>
          <div>
            <strong>World</strong> — Current scene, open arcs (story-level plot threads), active threads (character-level goals), and off-screen subplots. Each thread is a collapsible card showing its beat history.
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">⏱️</span>
          <div>
            <strong>Timeline</strong> — Every tracked event in chronological order. Filter by type (all/memory/knowledge/secret/journal) and by day. Great for reviewing "what happened when."
          </div>
        </div>
        <div class="vle-ob-item">
          <span class="vle-ob-icon">🔄</span>
          <div>
            <strong>Time Sync</strong> — When a time-skip leaves threads or off-screen subplots behind, they appear here with <strong>catch-up options</strong>. Generate missed beats to bring everything back in sync.
          </div>
        </div>
      </div>
    `
  },
  {
    title: 'Quick Tips for Beginners',
    body: `
      <div class="vle-ob-tips">
        <div class="vle-ob-tip">
          <span class="vle-ob-tip-icon">💡</span>
          <div>
            <strong>Start simple.</strong> You don't need to configure anything to begin. VELLUM tracks everything automatically. Explore the tabs as your story grows.
          </div>
        </div>
        <div class="vle-ob-tip">
          <span class="vle-ob-tip-icon">💡</span>
          <div>
            <strong>Link the preset.</strong> Open your VELLUM preset in the Preset Editor and click the <strong>VELLUM</strong> tab. Click <strong>Link</strong> so the extension knows to inject chronicle data for this preset.
          </div>
        </div>
        <div class="vle-ob-tip">
          <span class="vle-ob-tip-icon">💡</span>
          <div>
            <strong>Check the Context tab.</strong> If the AI seems to have forgotten something, open <strong>Context</strong> to see exactly what was injected. It shows characters, relationships, recalled turns, and facts.
          </div>
        </div>
        <div class="vle-ob-tip">
          <span class="vle-ob-tip-icon">💡</span>
          <div>
            <strong>Use Summarize.</strong> After 15-20 turns, click <strong>Actions → Summarize now</strong> to compress older turns into chapter memories. This keeps the prompt lean and the chronicle organized.
          </div>
        </div>
        <div class="vle-ob-tip">
          <span class="vle-ob-tip-icon">💡</span>
          <div>
            <strong>Adjust panel width.</strong> For the best desktop experience, set <strong>Lumiverse → Settings → Panel Width → Custom → 42vw</strong> (or more). This gives the Chronicle tabs breathing room.
          </div>
        </div>
        <div class="vle-ob-tip">
          <span class="vle-ob-tip-icon">💡</span>
          <div>
            <strong>Export often.</strong> Use <strong>Actions → Export JSON</strong> to back up your chronicle. VELLUM auto-saves, but manual backups are good practice for long stories.
          </div>
        </div>
      </div>
    `
  },
  {
    title: 'Ready to Begin',
    body: `
      <p>You're all set! VELLUM is watching your story now. As you play, it will:</p>
      <ul class="vle-ob-list">
        <li>✓ Track every character, relationship, secret, and turning point</li>
        <li>✓ Build a living chronicle that can't drift or forget</li>
        <li>✓ Feed the right context back to the AI so the world stays consistent</li>
        <li>✓ Show you dramatic irony, time-sync issues, and off-screen life</li>
        <li>✓ Compress old turns into chapters and arcs so the story scales</li>
      </ul>
      <p><strong>You don't have to do anything.</strong> VELLUM works quietly in the background. Explore the tabs as your story grows, and use the tools when you need them.</p>
      <p class="vle-ob-cta">Click <strong>Actions → Help</strong> anytime to see this guide again.</p>
      <p style="text-align:center;margin-top:2rem;opacity:0.7;font-style:italic;">Happy storytelling. ✧</p>
    `
  }
];

export function openOnboarding(onClose?: () => void): void {
  try {
    if (document.querySelector('.vle-ob')) return; // already open
    let slide = 0;
    const ov = document.createElement('div');
    ov.className = 'vle-ob';
    let onKey: ((e: KeyboardEvent) => void) | null = null;

    const close = (): void => {
      markOnboarded();
      if (onKey) document.removeEventListener('keydown', onKey);
      try { ov.remove(); } catch { /* ignore */ }
      onClose?.();
    };
    const next = (): void => { if (slide < SLIDES.length - 1) { slide++; render(); } else close(); };
    const back = (): void => { if (slide > 0) { slide--; render(); } };

    const render = (): void => {
      const cur = SLIDES[slide] ?? SLIDES[0]!;
      const { title, body } = cur;
      const progress = `<div class="vle-ob-progress">${SLIDES.map((_, i) => `<span class="${i === slide ? 'active' : ''}">${i + 1}</span>`).join('')}</div>`;
      ov.innerHTML = `<div class="vle-ob-shell">
        <div class="vle-ob-head">
          <h2>${esc(title)}</h2>
          <button class="vle-ob-x" data-ob-close title="Close (Esc)">\u2715</button>
        </div>
        <div class="vle-ob-body">${body}</div>
        <div class="vle-ob-foot">
          ${progress}
          <div class="vle-ob-nav">
            ${slide > 0 ? '<button class="vle-ob-btn" data-ob-back>\u2190 Back</button>' : '<span></span>'}
            <button class="vle-ob-btn primary" data-ob-next>${slide < SLIDES.length - 1 ? 'Next \u2192' : 'Get Started'}</button>
          </div>
        </div>
      </div>`;
      applyTheme(ov);
    };

    ov.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-ob-close]') || t.classList.contains('vle-ob')) { close(); return; }
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
