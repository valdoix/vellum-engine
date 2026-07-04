/**
 * Themed CSS for the VELLUM shell + components. Illuminated-manuscript palette
 * via CSS variables so skins/host theme can override. Single string loaded via
 * spindle.dom.addStyle.
 */
export const STYLES = [
  // --- theme tokens (overridden at runtime by theme.ts) ---------------------
  // --vg accent (hex) + --vg-rgb its r,g,b ; --vi primary ink, --vi2 muted ink ;
  // --vserif/--vmono fonts ; --vscale chrome size multiplier ; --vsurf-* panel bg.
  //
  // SEMANTIC COLOR CONTRACT (one meaning each — do not overload):
  //   --vg     gold   = brand / accent / interactive (tabs, links, focus). NOT a status.
  //   --v-pos  sage   = positive / affection / kept memory (journal).
  //   --v-info blue   = knowledge / trust / information.
  //   --v-press amber = pressure / tension / a bond shifting. (Freed from red.)
  //   --v-neg  red    = harm / danger / destructive / "wrong" belief (irony).
  //   --v-warn violet = the INTERNAL/AMBIGUOUS register ONLY: inner thoughts,
  //                     scars, complex sentiment, romance. If a new use isn't
  //                     "internal/ambiguous", pick another token — don't add to violet.
  ":root{--vg:#cda84e;--vg-rgb:205,168,78;--vi:#e7d6ad;--vi2:#cdbfa0;--vserif:'Cormorant Garamond',Georgia,serif;--vmono:'JetBrains Mono',ui-monospace,monospace;--vscale:1;--vsurf-1:rgba(28,25,20,.5);--vsurf-2:rgba(18,16,12,.4);--vle-gold:var(--vg);--vle-gold-soft:rgba(var(--vg-rgb),.16);--vle-ink:var(--vi);--vle-bg:rgba(20,18,14,.55);--vg2:#9bc0e6;--vg2-rgb:155,192,230;--vai:1;--vdscale:1;--vdensity:1;--vopacity:1;--vblur:8px;--vradius:18px;--vborder:1px;--vink-e:1;--v1:4px;--v2:8px;--v3:12px;--v4:16px;--v5:20px;--v6:24px;--vr1:6px;--vr2:9px;--vr3:13px;--rpill:20px;--v-pos:#8fa67e;--v-pos-i:#a9c089;--v-neg:#c96a6a;--v-neg-i:#e09090;--v-info:#9bc0e6;--v-warn:#b48ed0;--v-press:#c8923e;--v-press-i:#dcad62;--vt-display:calc(24px * var(--vscale));--vt-title:calc(18px * var(--vscale));--vt-body:calc(14px * var(--vscale));--vt-meta:calc(11px * var(--vdscale));--vt-eyebrow:calc(10px * var(--vscale))}",
  // launcher edge + reduced-motion (set on document by theme.ts)
  "html[data-vle-launch='left'] .vlf-launch{right:auto;left:0;border-radius:0 13px 13px 0;border-right:1px solid rgba(var(--vg-rgb),.5);border-left:none;writing-mode:vertical-rl;transform:rotate(180deg)}",
  "html[data-vle-launch='left'] .vlf-launch .vlf-launch-mark,html[data-vle-launch='left'] .vlf-launch .vlf-launch-t{transform:rotate(180deg)}",
  "html[data-vle-launch='hidden'] .vlf-launch{display:none!important}",
  "html[data-vle-motion='off'] *{transition:none!important;animation:none!important}",
  // unified chip family: ONE shape (radius --vr1, mono label, --vt-meta) with
  // tone modifiers driving color only. New surfaces use this; legacy bespoke
  // chips migrate onto it incrementally. .v-chip--solid fills; default is outline.
  ".v-chip{display:inline-flex;align-items:center;gap:4px;font:600 var(--vt-meta)/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;padding:2px 7px;border-radius:var(--vr1);border:1px solid color-mix(in srgb,var(--v-chip-c,var(--vg)) 42%,transparent);color:var(--v-chip-c,var(--vi2));white-space:nowrap}",
  ".v-chip--solid{background:color-mix(in srgb,var(--v-chip-c,var(--vg)) 16%,transparent)}",
  ".v-chip--gold{--v-chip-c:var(--vg)}.v-chip--pos{--v-chip-c:var(--v-pos-i)}.v-chip--neg{--v-chip-c:var(--v-neg-i)}.v-chip--info{--v-chip-c:var(--v-info)}.v-chip--warn{--v-chip-c:var(--v-warn)}.v-chip--press{--v-chip-c:var(--v-press-i)}.v-chip--muted{--v-chip-c:#8c8478}",
  // mono/data text honors its own scale; ink emphasis tints body text
  ".vld-stat,.vld-h,.vld-mood,.vld-cond,.vld-rel-s,.vld-cat,.vld-thread-s,.vld-par-w,.vld-rec-k{font-size:calc(1em * var(--vdscale))}",
  ".vle-root,.vlf-body{opacity:1}",
  ".vle-root{font-family:var(--vserif);color:var(--vle-ink);padding:calc(13px * var(--vscale)) calc(15px * var(--vscale))}",
  ".vle-head{display:flex;align-items:center;gap:9px;font-size:calc(22px * var(--vscale));letter-spacing:1.5px;padding-bottom:calc(11px * var(--vscale));border-bottom:1px solid var(--vle-gold-soft)}",
  ".vle-mark{color:var(--vle-gold);text-shadow:0 0 8px rgba(var(--vg-rgb),.4)}",
  ".vle-ver{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;opacity:.6;color:var(--vle-gold)}",
  ".vle-stats{margin-left:auto;font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;opacity:.6}",
  // tab bar
  ".vle-tabbar{display:flex;align-items:center;gap:5px;margin:calc(11px * var(--vscale)) 0 calc(5px * var(--vscale));flex-wrap:wrap}",
  ".vle-tabicons{display:flex;align-items:center;gap:5px;margin:0 0 calc(9px * var(--vscale));flex-wrap:wrap;padding-top:calc(6px * var(--vscale));border-top:1px solid rgba(var(--vg-rgb),.14)}",
  ".vle-tabbtn{font:600 calc(11px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:9px;padding:calc(8px * var(--vscale)) calc(13px * var(--vscale));cursor:pointer;opacity:.7;transition:opacity .15s,background .15s,color .15s}",
  ".vle-tabbtn:hover{opacity:1;background:rgba(var(--vg-rgb),.08)}",
  ".vle-tabbtn.on{opacity:1;background:rgba(var(--vg-rgb),.2);border-color:rgba(var(--vg-rgb),.45);color:var(--vle-gold)}",
  ".vle-tabbar-sep{flex:none;width:1px;align-self:stretch;margin:2px 4px;background:rgba(var(--vg-rgb),.22)}",
  // labeled tool dock (Journal/Graph/Vault/Context) — icon + label chip, a real
  // second tier. Labels hide when the dock is tight (see the container query below).
  ".vle-tabicon{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:calc(30px * var(--vscale));padding:0 calc(11px * var(--vscale));font:600 calc(10.5px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:9px;cursor:pointer;opacity:.62;transition:opacity .15s,background .15s,color .15s}",
  ".vle-tabicon:hover{opacity:1;background:rgba(var(--vg-rgb),.08)}",
  ".vle-tabicon.on{opacity:1;background:rgba(var(--vg-rgb),.2);border-color:rgba(var(--vg-rgb),.45);color:var(--vle-gold)}",
  ".vle-tabicon .vi{opacity:.85}",
  ".vle-tabicon-l{white-space:nowrap}",
  // when the shell is narrow, the dock collapses to icon-only (labels hidden)
  "@media (max-width:440px){.vle-tabicon{padding:0;width:calc(30px * var(--vscale));justify-content:center}.vle-tabicon-l{display:none}.vle-tabbtn{padding:calc(8px * var(--vscale)) calc(10px * var(--vscale))}.vle-tabbtn-l{display:none}}",
  // inline-SVG icon family (icons.ts): inherits color, sized per call
  ".vi{display:inline-block;vertical-align:-0.18em;flex:none}",
  ".vle-tabbtn{display:inline-flex;align-items:center;gap:6px}",
  ".vle-tabbtn .vi{opacity:.85}",
  ".vle-qol{display:inline-flex;align-items:center;gap:6px}",
  // float mini-app tab strip (4 primary tabs mounted into the float body)
  ".vlf-tabs{display:flex;gap:3px;padding:calc(8px * var(--vscale)) calc(10px * var(--vscale)) 0;flex:none}",
  ".vlf-tab{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;font:600 calc(10.5px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:9px 9px 0 0;padding:7px 6px;cursor:pointer;opacity:.65;transition:opacity .15s,background .15s,color .15s}",
  ".vlf-tab:hover{opacity:1;background:rgba(var(--vg-rgb),.08)}",
  ".vlf-tab.on{opacity:1;color:var(--vle-gold);background:rgba(var(--vg-rgb),.14);border-color:rgba(var(--vg-rgb),.3);border-bottom-color:transparent}",
  ".vlf-tab .vi{opacity:.85}",
  // hide labels when the float is very narrow (icons only)
  "@container (max-width:320px){.vlf-tab-l{display:none}}",
  ".vlf-tabbody{flex:1;min-height:0;overflow-y:auto;padding:calc(12px * var(--vscale)) calc(14px * var(--vscale)) calc(16px * var(--vscale))}",
  ".vlf-tabbody .vlm-comp{display:block}",
  // chronicle sub-nav (segmented in-tab views)
  ".vle-subnav{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 calc(11px * var(--vscale))}",
  // soft group label between sub-nav clusters (forces a wrap to its own line)
  ".vle-subnav-g{flex-basis:100%;font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:1.2px;text-transform:uppercase;color:var(--vg);opacity:.55;margin:6px 0 2px}",
  ".vle-subnav-g:first-child{margin-top:0}",
  ".vle-subnav-b{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:8px;padding:6px 10px;cursor:pointer;opacity:.7;transition:opacity .15s,background .15s,color .15s}",
  ".vle-subnav-b:hover{opacity:1;background:rgba(var(--vg-rgb),.08)}",
  ".vle-subnav-b.on{opacity:1;background:rgba(var(--vg-rgb),.18);border-color:rgba(var(--vg-rgb),.4);color:var(--vle-gold)}",
  // timeline (Plot Director, Phase 3) — turn-axis rail
  ".vle-spine{position:relative;margin:10px 0;padding:4px 0}",
  ".vle-spine::before{content:'';position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:rgba(var(--vg-rgb),.25)}",
  ".vle-spine-act{position:relative;z-index:1;text-align:center;margin:14px auto 10px;max-width:70%;font:600 var(--vt-eyebrow)/1.4 var(--vmono);letter-spacing:3px;text-transform:uppercase;color:var(--vg);background:rgba(var(--vg-rgb),.08);border-radius:var(--vr1);padding:5px 10px}",
  ".vle-spine-day{position:relative;z-index:1;display:flex;justify-content:center;margin:8px 0}",
  ".vle-spine-day span{font:600 calc(9px * var(--vscale))/1 var(--vmono);color:var(--vg);background:var(--vsurf-2);border:1px solid rgba(var(--vg-rgb),.5);border-radius:50%;width:30px;height:30px;display:grid;place-items:center}",
  ".vle-spine-beat{position:relative;z-index:1;margin:8px auto;max-width:80%;text-align:center;background:color-mix(in srgb,var(--vg) 12%,var(--vsurf-1));border:1px solid rgba(var(--vg-rgb),.5);border-radius:var(--vr2);padding:7px 12px}",
  ".vle-spine-beat-k{display:block;font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vg);opacity:.8;margin-bottom:3px}",
  ".vle-spine-beat-x{font-family:var(--vserif);font-style:italic;font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-spine-row{position:relative;display:flex;width:50%;box-sizing:border-box;margin:5px 0}",
  ".vle-spine-l{margin-right:auto;padding-right:20px;justify-content:flex-end}",
  ".vle-spine-r{margin-left:auto;padding-left:20px}",
  ".vle-spine-card{position:relative;background:var(--vsurf-1);border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--vle-gold-soft);border-radius:var(--vr2);padding:7px 11px;max-width:100%}",
  ".vle-spine-l .vle-spine-card::after,.vle-spine-r .vle-spine-card::after{content:'';position:absolute;top:14px;width:18px;height:2px;background:rgba(var(--vg-rgb),.3)}",
  ".vle-spine-l .vle-spine-card::after{right:-21px}.vle-spine-r .vle-spine-card::after{left:-21px}",
  ".vle-spine-meta{display:flex;gap:7px;align-items:baseline;margin-bottom:2px}",
  ".vle-spine-kind{font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.7}",
  ".vle-spine-t{font:600 calc(9px * var(--vscale))/1 var(--vmono);opacity:.5}",
  ".vle-spine-x{font-size:calc(12.5px * var(--vscale));line-height:1.45;color:var(--vi2)}",
  ".vle-spine-memory{border-left-color:var(--vg)}.vle-spine-memory .vle-spine-kind{color:var(--vg)}",
  ".vle-spine-knew{border-left-color:var(--v-info)}.vle-spine-knew .vle-spine-kind{color:var(--v-info)}",
  ".vle-spine-secret{border-left-color:var(--v-neg)}.vle-spine-secret .vle-spine-kind{color:var(--v-neg-i)}",
  ".vle-spine-journal{border-left-color:var(--v-pos)}.vle-spine-journal .vle-spine-kind{color:var(--v-pos-i)}",
  ".vle-spine-scar{border-left-color:var(--v-warn)}.vle-spine-scar .vle-spine-kind{color:var(--v-warn)}",
  ".vle-spine-lore{border-left-color:var(--vg)}.vle-spine-lore .vle-spine-kind{color:var(--vg)}",
  "@container (max-width:420px){.vle-spine::before{left:13px}.vle-spine-row{width:100%;padding-left:30px!important;padding-right:0!important;justify-content:flex-start!important;margin-left:0!important;margin-right:0!important}.vle-spine-l .vle-spine-card::after,.vle-spine-r .vle-spine-card::after{left:-17px!important;right:auto!important}.vle-spine-beat,.vle-spine-act{margin-left:0;max-width:100%}.vle-spine-day{justify-content:flex-start;margin-left:0}}",
  ".vle-tl{display:flex;flex-direction:column;gap:0;margin-top:6px;position:relative}",
  ".vle-tl-row{display:flex;align-items:flex-start;gap:9px;padding:5px 0;position:relative}",
  ".vle-tl-t{flex:none;width:54px;text-align:right;font:600 9px/1.5 var(--vmono);color:var(--vle-gold);opacity:.7}",
  ".vle-tl-dot{flex:none;width:9px;height:9px;margin-top:3px;border-radius:50%;background:var(--vle-gold);box-shadow:0 0 0 3px rgba(var(--vg-rgb),.12);position:relative}",
  ".vle-tl-dot::before{content:'';position:absolute;left:50%;top:11px;transform:translateX(-50%);width:1px;height:calc(100% + 9px);background:rgba(var(--vg-rgb),.22)}",
  ".vle-tl-row:last-child .vle-tl-dot::before{display:none}",
  ".vle-tl-dot.vle-tl-arc{background:var(--v-warn)}.vle-tl-dot.vle-tl-chapter{background:var(--vle-gold)}",
  ".vle-tl-dot.vle-tl-knew{background:var(--v-info)}.vle-tl-dot.vle-tl-secret{background:var(--v-neg)}.vle-tl-dot.vle-tl-journal{background:var(--v-pos)}",
  ".vle-tl-dot.vle-tl-scar{background:var(--v-warn)}.vle-tl-dot.vle-tl-lore{background:var(--vle-gold)}",
  ".vle-tl-dot.vle-tl-beat{background:var(--vle-gold);box-shadow:0 0 0 2px color-mix(in srgb,var(--vle-gold) 40%,transparent)}",
  ".vle-mem-tier.t-beat{color:var(--vle-gold);border-color:color-mix(in srgb,var(--vle-gold) 45%,transparent)}",
  ".vle-beat-sug-h{display:flex;align-items:center;gap:8px;margin:4px 0 8px;min-width:0}",
  ".vle-beat-sug-lbl{flex:0 0 auto;font:600 10px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.6}",
  ".vle-beat-sug-row{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}",
  ".vle-beat-sug-chip{flex:0 0 auto;white-space:nowrap;font:500 11px/1 var(--vmono);color:var(--vi2);background:color-mix(in srgb,var(--vle-gold) 8%,transparent);border:1px solid color-mix(in srgb,var(--vle-gold) 30%,transparent);border-radius:999px;padding:5px 10px;cursor:pointer}",
  ".vle-beat-sug-chip:hover{background:color-mix(in srgb,var(--vle-gold) 18%,transparent);color:var(--vle-gold)}",
  ".vle-scar-was{text-decoration:line-through;text-decoration-color:var(--v-neg);opacity:.85}",
  ".vle-arc{margin:6px 0 8px}",
  ".vle-turn{margin:0 0 8px;padding:7px 9px;border:1px solid rgba(var(--vg-rgb),.16);border-radius:9px;background:color-mix(in srgb,var(--vi) 3%,transparent)}",
  ".vle-plant{display:flex;align-items:baseline;gap:8px;padding:5px 2px}",
  ".vle-plant.paid{opacity:.5}",
  ".vle-plant-mark{flex:0 0 auto;color:var(--vle-gold)}",
  ".vle-plant.paid .vle-plant-mark{color:var(--v-pos)}",
  ".vle-plant-what{flex:1 1 auto;font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-plant.paid .vle-plant-what{text-decoration:line-through;text-decoration-color:rgba(var(--vg-rgb),.4)}",
  ".vle-plant-meta{flex:0 0 auto;font:500 10px/1.4 var(--vmono);color:var(--vi2);opacity:.6}",
  ".vle-os-ripe{font:600 9px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vle-gold);margin-left:6px}",
  ".vle-os-stale{font:500 9px/1.4 var(--vmono);color:var(--vi2);opacity:.55;margin-left:6px}",
  ".vle-av.has-img{background-size:cover;background-position:center}.vle-av.has-img>.vle-av-dot{}",
  // shared portrait convention: any medallion with .has-img shows the image (cover) + hides initials text
  ".vld-pc-av.has-img,.vle-strip-av.has-img,.vle-jspine-av.has-img{background-size:cover!important;background-position:center;color:transparent;font-size:0}",
  ".vld-stats{display:flex;flex-wrap:wrap;gap:10px;margin:2px 0 6px}",
  ".vld-stat{display:flex;flex-direction:column;align-items:center;min-width:44px}",
  ".vld-stat-v{font-family:var(--vserif);font-size:calc(18px * var(--vscale));color:var(--vle-gold);line-height:1}",
  ".vld-stat-k{font:500 9px/1.4 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);opacity:.65}",
  ".vld-stat-row{font-size:calc(12px * var(--vscale));color:var(--vi);margin-top:3px}",
  ".vld-stat-lbl{font:600 9px/1.4 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);opacity:.6;margin-right:5px}",
  "html[data-vle-chrome='futuristic'] .vld-stat-v{font-family:var(--vmono);color:var(--vg)}",
  "html[data-vle-chrome='modern'] .vld-stat-v{color:var(--vi)}",
  ".vle-turn-h{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}",
  ".vle-turn-n{font:600 11px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold)}",
  ".vle-turn-count{flex:1 1 auto;font:500 10px/1.4 var(--vmono);color:var(--vi2);opacity:.6}",
  ".vle-turn-change{display:flex;align-items:baseline;gap:7px;padding:2px 0;font-size:calc(12.5px * var(--vscale))}",
  ".vle-turn-ico{flex:0 0 auto;color:var(--vle-gold);opacity:.8}",
  ".vle-turn-tx{color:var(--vi)}",
  "html[data-vle-chrome='futuristic'] .vle-turn{border-radius:2px}html[data-vle-chrome='futuristic'] .vle-turn-n{font-family:var(--vmono);color:var(--vg)}",
  "html[data-vle-chrome='modern'] .vle-turn{background:color-mix(in srgb,var(--vi) 5%,transparent);border-radius:12px}html[data-vle-chrome='modern'] .vle-turn-n{color:var(--vi2);opacity:.7}",
  ".vle-arc-svg{width:100%;height:46px;display:block}",
  ".vle-arc-zero{stroke:rgba(var(--vg-rgb),.25);stroke-width:1;stroke-dasharray:3 3}",
  ".vle-arc-aff{stroke:var(--v-pos);stroke-width:1.5}",
  ".vle-arc-trust{stroke:var(--vg);stroke-width:1.5}",
  ".vle-arc-key{display:flex;gap:12px;font:500 9px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;opacity:.6;margin-top:2px}",
  ".vle-arc-k-aff{color:var(--v-pos)}.vle-arc-k-tr{color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-arc-aff,html[data-vle-chrome='futuristic'] .vle-arc-trust{stroke-width:1.25}",
  "html[data-vle-chrome='modern'] .vle-arc-zero{stroke-dasharray:none;opacity:.5}",
  ".vle-drift{margin:7px 0 3px;padding:7px 9px;border:1px solid rgba(var(--vg-rgb),.16);border-radius:9px;background:color-mix(in srgb,var(--vi) 3%,transparent)}",
  ".vle-drift-arc{display:flex;align-items:center;flex-wrap:wrap;gap:5px;font-size:calc(12.5px * var(--vscale))}",
  ".vle-drift-k{font:600 9px/1.4 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vle-gold);opacity:.75;margin-right:3px}",
  ".vle-drift-t{font-family:var(--vserif);color:var(--vi)}",
  ".vle-drift-hardened{color:var(--vle-gold);font-weight:600}",
  ".vle-drift-rising{color:var(--v-pos)}",
  ".vle-drift-gone{opacity:.5;text-decoration:line-through;text-decoration-color:rgba(var(--vg-rgb),.4)}",
  ".vle-drift-arrow{color:var(--vi2);opacity:.5}",
  ".vle-drift-dormant-lbl,.vle-drift-op{font:600 9px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);opacity:.6}",
  ".vle-drift-timeline{margin-top:6px;display:flex;flex-direction:column;gap:3px;border-left:1px solid rgba(var(--vg-rgb),.16);padding-left:8px}",
  ".vle-drift-node{display:flex;align-items:baseline;gap:6px;font-size:calc(12px * var(--vscale))}",
  ".vle-drift-mark{flex:0 0 auto;color:var(--vle-gold)}",
  ".vle-drift-reverse .vle-drift-mark{color:var(--v-warn)}",
  ".vle-drift-fade .vle-drift-mark{color:var(--vi2);opacity:.5}",
  ".vle-drift-lab{font-family:var(--vserif);color:var(--vi)}",
  ".vle-drift-cause{flex:1 1 auto;min-width:0;color:var(--vi2);opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vle-drift-turn{flex:0 0 auto;font:500 10px/1.4 var(--vmono);color:var(--vi2);opacity:.55}",
  "html[data-vle-chrome='futuristic'] .vle-drift{border-radius:2px;background:rgba(var(--vg-rgb),.05)}",
  "html[data-vle-chrome='futuristic'] .vle-drift-t,html[data-vle-chrome='futuristic'] .vle-drift-lab{font-family:var(--vmono);font-style:normal}",
  "html[data-vle-chrome='futuristic'] .vle-drift-hardened{text-shadow:0 0 6px color-mix(in srgb,var(--vle-gold) 60%,transparent)}",
  "html[data-vle-chrome='modern'] .vle-drift{background:color-mix(in srgb,var(--vi) 5%,transparent);border-radius:12px}",
  "html[data-vle-chrome='modern'] .vle-drift-k{color:var(--vi2);opacity:.6}",
  ".vle-director{display:flex;flex-direction:column;gap:8px}",
  ".vle-dir-col{margin:0 0 10px}",
  ".vle-dir-col-h{font:600 11px/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vle-gold);opacity:.8;margin:0 0 5px;padding-bottom:3px;border-bottom:1px solid rgba(var(--vg-rgb),.16)}",
  ".vle-dir-card{display:flex;align-items:baseline;gap:8px;padding:6px 9px;margin:0 0 5px;border:1px solid rgba(var(--vg-rgb),.18);border-left:3px solid var(--v-warn);border-radius:8px;background:color-mix(in srgb,var(--vi) 3%,transparent)}",
  ".vle-dir-armed{border-left-color:var(--v-pos)}",
  ".vle-dir-dormant{border-left-color:var(--v-warn)}",
  ".vle-dir-done{border-left-color:rgba(var(--vg-rgb),.3);opacity:.6}",
  ".vle-dir-glyph{flex:0 0 auto;color:var(--vle-gold)}",
  ".vle-dir-text{flex:1 1 auto;font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-dir-target{font-family:var(--vmono);font-size:11px;color:var(--vi2);opacity:.7}",
  ".vle-dir-when,.vle-dir-ttl{font-family:var(--vmono);font-size:10px;color:var(--vi2);opacity:.65}",
  ".vle-loc-grp{margin:0 0 10px}",
  ".vle-loc-grp-h{font:600 11px/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vle-gold);opacity:.8;margin:0 0 5px;padding-bottom:3px;border-bottom:1px solid rgba(var(--vg-rgb),.16)}",
  ".vle-loc-row{position:relative;display:flex;align-items:center;gap:8px;padding:5px 2px}",
  ".vle-loc-mark{flex:0 0 auto;color:var(--vle-gold)}",
  ".vle-loc-name{font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-loc-note{flex:1 1 auto;min-width:0;font-size:calc(12px * var(--vscale));color:var(--vi2);opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vle-loc-tree{margin:0 0 6px}",
  ".vle-loc-node{position:relative}",
  // children indent under their parent; connectors are drawn PER child node so
  // nesting stays correct (classic file-tree CSS): a vertical segment + an elbow.
  ".vle-loc-kids{margin-left:9px;padding-left:16px}",
  // vertical rail: runs from the top of the node down to the child's dot centre;
  // non-last children extend it the full node height to reach the next sibling.
  ".vle-loc-kids>.vle-loc-node::before{content:'';position:absolute;left:-7px;top:0;height:16px;width:2px;background:rgba(var(--vg-rgb),.28)}",
  ".vle-loc-kids>.vle-loc-node:not(:last-child)::before{height:100%}",
  // elbow: from the rail across to the dot
  ".vle-loc-kids>.vle-loc-node>.vle-loc-row::before{content:'';position:absolute;left:-7px;top:15px;width:13px;height:2px;background:rgba(var(--vg-rgb),.28)}",
  ".vle-loc-dot{position:relative;flex:0 0 auto;display:inline-grid;place-items:center;width:18px;height:18px;font-size:calc(11px * var(--vscale));color:var(--vle-gold);background:var(--vsurf-1);border-radius:50%;box-shadow:0 0 0 3px var(--vsurf-1)}",
  ".vle-loc-caret{flex:0 0 auto;width:16px;height:16px;display:inline-grid;place-items:center;padding:0;font-size:calc(10px * var(--vscale));line-height:1;color:var(--vle-gold);background:transparent;border:none;border-radius:4px;cursor:pointer;opacity:.7;transition:transform .12s,opacity .12s}",
  ".vle-loc-caret:hover{opacity:1;background:rgba(var(--vg-rgb),.14)}",
  ".vle-loc-caret.closed{transform:rotate(-90deg)}",
  ".vle-loc-caret.spacer{cursor:default;opacity:0;pointer-events:none}",
  ".vle-loc-count{flex:0 0 auto;font:600 9px/1 var(--vmono);color:var(--vle-gold);background:rgba(var(--vg-rgb),.14);border-radius:999px;padding:2px 6px}",
  ".vle-nextscene{border:1px solid color-mix(in srgb,var(--vle-gold) 30%,transparent);border-radius:10px;padding:11px 13px;background:color-mix(in srgb,var(--vle-gold) 6%,transparent)}",
  ".vle-ns-row{display:flex;gap:9px;margin:0 0 5px}",
  ".vle-ns-k{flex:0 0 48px;font:600 10px/1.5 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold);opacity:.75}",
  ".vle-ns-v{flex:1 1 auto;font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-ns-ctl{display:flex;gap:6px;margin-top:8px}",
  // next-turn steering cross-link (Director tab → Tone modal)
  ".vle-ns-steer{margin-top:12px;padding-top:10px;border-top:1px solid rgba(var(--vg-rgb),.14);font-size:calc(12px * var(--vscale));color:var(--vi2);opacity:.85}",
  ".vle-link{background:none;border:none;cursor:pointer;font:inherit;color:var(--vle-gold);padding:0 2px;text-decoration:underline;text-decoration-color:rgba(var(--vg-rgb),.4)}",
  ".vle-link:hover{text-decoration-color:var(--vle-gold)}",
  ".vle-dir-log-row{display:flex;align-items:baseline;gap:8px;padding:5px 2px;border-bottom:1px solid rgba(var(--vg-rgb),.08)}",
  ".vle-dir-log-mark{flex:0 0 auto}",
  ".vle-dir-log-flag .vle-dir-log-mark{color:var(--v-neg)}",
  ".vle-dir-log-reveal .vle-dir-log-mark{color:var(--vle-gold)}",
  ".vle-dir-log-t{flex:1 1 auto;font-size:calc(13px * var(--vscale));color:var(--vi)}",
  ".vle-dir-log-turn{flex:0 0 auto;font:500 10px/1.4 var(--vmono);color:var(--vi2);opacity:.6}",
  "html[data-vle-chrome='futuristic'] .vle-dir-col-h,html[data-vle-chrome='futuristic'] .vle-loc-grp-h{font-family:var(--vmono);color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-dir-card{border-radius:2px;background:rgba(var(--vg-rgb),.06)}",
  "html[data-vle-chrome='futuristic'] .vle-dir-text,html[data-vle-chrome='futuristic'] .vle-loc-name,html[data-vle-chrome='futuristic'] .vle-ns-v{font-family:var(--vmono);font-style:normal}",
  "html[data-vle-chrome='futuristic'] .vle-nextscene{border-radius:2px}",
  "html[data-vle-chrome='modern'] .vle-dir-col-h,html[data-vle-chrome='modern'] .vle-loc-grp-h{color:var(--vi2);opacity:.6}",
  "html[data-vle-chrome='modern'] .vle-dir-card{background:color-mix(in srgb,var(--vi) 5%,transparent);border-left-width:3px}",
  "html[data-vle-chrome='modern'] .vle-nextscene{border-radius:14px;background:color-mix(in srgb,var(--vi) 5%,transparent);border-color:rgba(var(--vg-rgb),.2)}",
  // ---- Items (possession tracker) — built on theme vars so it adapts per chrome ----
  ".vle-item-grp{margin:0 0 10px}",
  ".vle-item-grp-h{font:600 11px/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vle-gold);opacity:.8;margin:0 0 5px;padding-bottom:3px;border-bottom:1px solid rgba(var(--vg-rgb),.16)}",
  ".vle-item-row{display:flex;align-items:baseline;gap:8px;padding:5px 2px}",
  ".vle-item-name{font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-item-note{flex:1 1 auto;min-width:0;font-size:calc(12px * var(--vscale));color:var(--vi2);opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // present-card carried-items chip strip (echo on the Now card)
  ".vld-pc-items{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}",
  ".vld-pc-item{font:500 10px/1.4 var(--vmono);color:var(--vle-gold);background:color-mix(in srgb,var(--vle-gold) 10%,transparent);border:1px solid color-mix(in srgb,var(--vle-gold) 28%,transparent);border-radius:12px;padding:2px 7px;max-width:100%;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  // FUTURISTIC chrome: square, mono, accent edge — match the diary/HUD treatment
  "html[data-vle-chrome='futuristic'] .vle-item-grp-h{font-family:var(--vmono);color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-item-name{font-family:var(--vmono);font-style:normal}",
  "html[data-vle-chrome='futuristic'] .vld-pc-item{border-radius:2px;background:rgba(var(--vg-rgb),.12)}",
  // MODERN chrome: flat, quieter accent, no manuscript gilt emphasis
  "html[data-vle-chrome='modern'] .vle-item-grp-h{color:var(--vi2);opacity:.6}",
  "html[data-vle-chrome='modern'] .vld-pc-item{border-radius:6px;color:var(--vi);background:color-mix(in srgb,var(--vi) 6%,transparent);border-color:rgba(var(--vg-rgb),.2)}",
  ".vle-mem.pickable{cursor:pointer}.vle-mem-pick{margin-right:6px;accent-color:var(--vle-gold);cursor:pointer}",
  ".vle-pickbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:7px 10px;margin:4px 0 8px;border:1px solid color-mix(in srgb,var(--vle-gold) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--vle-gold) 8%,transparent);font-size:12px}",
  ".vle-add.danger{color:var(--v-neg);border-color:color-mix(in srgb,var(--v-neg) 40%,transparent)}.vle-add.danger:hover{background:color-mix(in srgb,var(--v-neg) 14%,transparent)}",
  ".vle-tl-body{flex:1;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:12px;line-height:1.5}",
  ".vle-tl-k{font:600 8px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);opacity:.7}",
  ".vle-tl-day{font:600 8px/1.4 var(--vmono);color:var(--vle-gold);opacity:.6}",
  ".vle-tl-x{flex:1 1 100%;opacity:.9}",
  ".vle-toolbar{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 calc(12px * var(--vscale))}",
  ".vle-qol{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid var(--vle-gold-soft);border-radius:8px;padding:7px 11px;cursor:pointer;transition:background .15s,color .15s}",
  ".vle-qol:hover{background:rgba(var(--vg-rgb),.14);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.4)}",
  ".vle-qol.on{background:rgba(var(--vg-rgb),.28);color:var(--vle-gold);border-color:var(--vle-gold);box-shadow:inset 0 0 0 1px rgba(var(--vg-rgb),.35)}",
  ".vle-qol.on::before{content:'\\2713 ';opacity:.9}",
  ".vle-qol.busy{color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.5);cursor:progress;opacity:.85}",
  ".vle-qol.busy::before{content:'\\21BB ';display:inline-block;animation:vle-spin 0.9s linear infinite}",
  "@keyframes vle-spin{to{transform:rotate(360deg)}}",
  // Actions menu (grouped overlay)
  ".vle-acts{gap:14px}",
  ".vle-act-grp{display:flex;flex-direction:column;gap:4px}",
  ".vle-act-h{font:600 calc(9px * var(--vscale))/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vg);opacity:.7;margin-bottom:2px}",
  ".vle-act-item{display:flex;align-items:center;justify-content:space-between;gap:10px;font:600 calc(11px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);background:rgba(var(--vg-rgb),.06);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:9px 12px;cursor:pointer;transition:background .15s,color .15s;text-align:left;width:100%}",
  ".vle-act-item .vi{opacity:.8;margin-right:-2px}",
  ".vle-act-item .vle-act-l{flex:1}",
  ".vle-act-item:hover{background:rgba(var(--vg-rgb),.18);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.4)}",
  ".vle-act-item.busy{cursor:progress;opacity:.8}",
  ".vle-act-st{font:600 calc(9px * var(--vscale))/1 var(--vmono);letter-spacing:.3px;text-transform:none;color:var(--vg);opacity:.85}",
  ".vle-act-item.danger{border-color:color-mix(in srgb,var(--v-neg) 35%,transparent)}",
  ".vle-act-item.danger:hover{color:var(--v-neg-i);border-color:color-mix(in srgb,var(--v-neg) 55%,transparent);background:color-mix(in srgb,var(--v-neg) 12%,transparent)}",
  // search palette
  ".vle-search-results{display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow-y:auto;margin-top:9px}",
  ".vle-search-hit{display:flex;align-items:baseline;gap:8px;text-align:left;width:100%;background:rgba(var(--vg-rgb),.05);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:8px 11px;cursor:pointer;transition:background .15s}",
  ".vle-search-hit:hover{background:rgba(var(--vg-rgb),.16)}",
  ".vle-search-k{flex:none;font:600 8px/1.4 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vle-gold);opacity:.8;min-width:62px}",
  ".vle-search-l{flex:none;font-family:var(--vserif);font-size:14px;color:var(--vi)}",
  ".vle-search-s{flex:1;font-size:11px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // Plot Director panel
  ".vle-dir-list{display:flex;flex-direction:column;gap:5px;margin:6px 0}",
  ".vle-dir-row{display:flex;align-items:center;gap:8px;background:rgba(var(--vg-rgb),.06);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:7px 10px}",
  ".vle-dir-k{flex:none;font:600 8px/1.3 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--v-warn);min-width:88px}",
  ".vle-dir-t{flex:1;font-size:12px;line-height:1.4}",
  ".vle-dir-row.dormant{opacity:.7}",
  ".vle-dir-when{flex:none;font:600 8px/1.4 var(--vmono);letter-spacing:.4px;color:var(--v-info)}",
  ".vle-body{min-height:60px}",
  ".vle-empty{padding:28px 10px;text-align:center;opacity:.65;font-size:calc(15px * var(--vscale));line-height:1.6}",
  ".vle-empty.sm{padding:14px;font-size:calc(13px * var(--vscale))}",
  // section headers + counts
  ".vle-sec-h{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:1.2px;text-transform:uppercase;color:var(--vg);opacity:.7;margin:calc(15px * var(--vscale)) 0 calc(8px * var(--vscale));display:flex;align-items:center;gap:7px}",
  ".vle-n{font-size:calc(9px * var(--vscale));background:var(--vle-gold-soft);color:var(--vle-gold);border-radius:9px;padding:2px 7px}",
  ".vle-scene{font-size:calc(15px * var(--vscale));font-style:italic;opacity:.85;padding:5px 2px}",
  ".vle-tension{font:600 calc(10px * var(--vscale))/1 var(--vmono);color:var(--v-neg);letter-spacing:.5px;margin-left:6px}",
  // cast cards
  ".vle-cards{display:flex;flex-direction:column;gap:calc(7px * var(--vscale))}",
  ".vle-card{position:relative;display:flex;align-items:center;gap:11px;padding:calc(11px * var(--vscale)) calc(13px * var(--vscale));border:1px solid var(--vle-gold-soft);border-radius:var(--vr3);background:linear-gradient(170deg,var(--vsurf-1),var(--vsurf-2));border-left:4px solid var(--vle-gold-soft)}",
  // status carried by a colored left spine (visible without reading)
  ".vle-card--present{border-left-color:var(--v-pos)}",
  ".vle-card--active{border-left-color:var(--v-info)}",
  ".vle-card--mentioned{border-left-color:rgba(var(--vg-rgb),.5)}",
  ".vle-card--added{border-left-color:var(--v-warn)}",
  ".vle-card.on{border-color:var(--vle-gold);border-left-color:var(--v-pos);box-shadow:0 0 10px rgba(var(--vg-rgb),.18)}",
  ".vle-av{position:relative;flex:none;width:calc(34px * var(--vscale));height:calc(34px * var(--vscale));display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.18);color:var(--vle-gold);font-weight:600;font-size:calc(13px * var(--vscale))}",
  // presence dot on the avatar (mockup): tinted by status, hidden unless present/active
  ".vle-av-dot{position:absolute;right:-1px;top:-1px;width:9px;height:9px;border-radius:50%;border:2px solid var(--vsurf-2);background:transparent}",
  ".vle-card--present .vle-av-dot{background:var(--v-pos)}",
  ".vle-card--active .vle-av-dot{background:var(--v-info)}",
  ".vle-card-main{display:flex;flex-direction:column;gap:3px;min-width:0}",
  ".vle-card-n{font-size:calc(16px * var(--vscale))}",
  // character name color / gradient (nameHtml). Solid uses inline color; gradient
  // clips a background to the text. Inherits weight/size from the surrounding name.
  ".vle-name{font:inherit}",
  ".vle-name--grad{background:linear-gradient(90deg,var(--c1),var(--c2));-webkit-background-clip:text;background-clip:text;color:transparent}",
  ".vle-name--lift{text-shadow:0 0 6px rgba(255,255,255,.35)}",
  ".vle-star{color:var(--vle-gold);font-size:calc(10px * var(--vscale))}",
  ".vle-deceased{opacity:.55;font-size:calc(11px * var(--vscale))}",
  ".vle-card-meta{font:600 calc(10px * var(--vscale))/1.2 var(--vmono);opacity:.6}",
  // density toggle (cards vs strip)
  ".vle-dens{display:inline-flex;gap:2px;margin-right:8px}",
  ".vle-dens-b{font:600 10px/1 var(--vmono);padding:4px 8px;border-radius:var(--vr1);border:1px solid rgba(var(--vg-rgb),.2);background:transparent;color:var(--vi2);cursor:pointer;opacity:.7}",
  ".vle-dens-b.on{background:rgba(var(--vg-rgb),.16);color:var(--vg);border-color:var(--vg);opacity:1}",
  // avatar is now a button (unfold); keep visuals, add cursor
  ".vle-av{cursor:pointer;border:none}",
  // expanded card detail
  ".vle-card.is-open{align-items:flex-start}",
  ".vle-card-detail{margin-top:8px;display:flex;flex-direction:column;gap:6px}",
  ".vle-card-app2{font-size:calc(13px * var(--vscale));opacity:.82;line-height:1.5}",
  ".vle-card-aka{font-size:calc(12px * var(--vscale));opacity:.7}",
  ".vle-card-aka-k{font:600 var(--vt-eyebrow)/1 var(--vmono);text-transform:uppercase;letter-spacing:1px;color:var(--vg);opacity:.7;margin-right:4px}",
  ".vle-card-bonds{display:flex;flex-wrap:wrap;gap:4px}",
  ".vle-bondchip{font:600 calc(10px * var(--vscale))/1 var(--vmono);padding:3px 7px;border-radius:var(--vr1);border:1px solid color-mix(in srgb,var(--v-chip-c,var(--vg)) 40%,transparent);color:var(--v-chip-c,var(--vi2))}",
  ".vle-bondchip--pos{--v-chip-c:var(--v-pos-i)}.vle-bondchip--neg{--v-chip-c:var(--v-neg-i)}.vle-bondchip--info{--v-chip-c:var(--v-info)}",
  ".vle-card-disp{font-size:calc(12.5px * var(--vscale));color:var(--vi2);line-height:1.45}",
  ".vle-card-traits{display:flex;flex-wrap:wrap;gap:4px}",
  ".vle-traitchip{font:600 calc(10px * var(--vscale))/1 var(--vmono);padding:3px 7px;border-radius:var(--vr1);border:1px solid color-mix(in srgb,var(--vg) 30%,transparent);color:var(--vi2);text-transform:lowercase}",
  ".vle-card-note{font-style:italic;font-size:calc(12.5px * var(--vscale));opacity:.7;line-height:1.5}",
  // compact strip rows (density mode for big casts)
  ".vle-strips{display:flex;flex-direction:column;gap:3px}",
  ".vle-strip{display:flex;align-items:center;gap:9px;padding:5px 10px;border-radius:var(--vr2);background:rgba(var(--vg-rgb),.04);border-left:3px solid var(--vle-gold-soft)}",
  ".vle-strip.vle-card--present{border-left-color:var(--v-pos)}.vle-strip.vle-card--active{border-left-color:var(--v-info)}.vle-strip.vle-card--mentioned{border-left-color:rgba(var(--vg-rgb),.5)}.vle-strip.vle-card--added{border-left-color:var(--v-warn)}",
  ".vle-strip-av{flex:none;width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.18);color:var(--vg);font:600 9px/1 var(--vmono)}",
  ".vle-strip-n{font-family:var(--vserif);font-size:calc(14px * var(--vscale));color:var(--vi)}",
  ".vle-strip-st{font:600 calc(10px * var(--vscale))/1 var(--vmono);opacity:.6;font-style:italic}",
  ".vle-strip-role{font-size:calc(11px * var(--vscale));opacity:.55}",
  ".vle-strip-bonds{display:inline-flex;gap:3px;margin-left:auto;margin-right:4px}",
  ".vle-strip-dot{width:7px;height:7px;border-radius:50%;background:var(--vi2)}",
  ".vle-strip-dot--pos{background:var(--v-pos)}.vle-strip-dot--neg{background:var(--v-neg)}.vle-strip-dot--info{background:var(--v-info)}",
  ".vle-strip .vle-card-ctl{margin-left:0}",
  // sentence-case status+role line (cast redesign): serif, italic, calm
  ".vle-card-sub{font-family:var(--vserif);font-style:italic;font-size:calc(13px * var(--vscale));color:var(--v-pos-i);opacity:.85}",
  ".vle-card--mentioned .vle-card-sub,.vle-card--added .vle-card-sub{color:var(--vi2);opacity:.6}",
  ".vle-card-app{font-size:13px;opacity:.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // tracks + memory
  // plot threads / arcs — cards in a responsive grid (was a cramped 1-row flex)
  ".vle-trk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:6px}",
  ".vle-trk{display:flex;flex-direction:column;gap:6px;padding:10px 11px;border:1px solid rgba(var(--vg-rgb),.18);border-left:3px solid var(--vle-gold-soft);border-radius:var(--vr2);background:color-mix(in srgb,var(--vi) 3%,transparent)}",
  ".vle-trk--done{opacity:.6;border-left-color:rgba(var(--vg-rgb),.3)}",
  ".vle-trk-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}",
  ".vle-trk-n{flex:1 1 auto;min-width:0;font-family:var(--vserif);font-size:calc(14px * var(--vscale));line-height:1.3;color:var(--vi);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".vle-trk-pill{flex:0 0 auto;font:600 8.5px/1.4 var(--vmono);letter-spacing:.3px;text-transform:uppercase;color:var(--vle-gold);background:color-mix(in srgb,var(--vle-gold) 12%,transparent);border:1px solid color-mix(in srgb,var(--vle-gold) 32%,transparent);border-radius:999px;padding:2px 8px;white-space:nowrap}",
  ".vle-trk-pill.done{color:var(--vi2);background:rgba(var(--vg-rgb),.1);border-color:rgba(var(--vg-rgb),.25)}",
  ".vle-trk-off{font-size:calc(11.5px * var(--vscale));line-height:1.4;color:var(--v-info);opacity:.92}",
  ".vle-trk-hist{font-size:calc(11.5px * var(--vscale))}",
  ".vle-trk-hist summary{cursor:pointer;color:var(--vi2);opacity:.7;font:600 9px/1.4 var(--vmono);letter-spacing:.3px;text-transform:uppercase}",
  ".vle-trk-beat{margin-top:2px;color:var(--vi2);opacity:.85;line-height:1.45}",
  ".vle-trk-ctl{display:flex;gap:4px;justify-content:flex-end;margin-top:2px;padding-top:6px;border-top:1px solid rgba(var(--vg-rgb),.1)}",
  ".vle-os-link{font:600 9px/1.3 var(--vmono);color:var(--vle-gold);background:rgba(var(--vg-rgb),.12);border-radius:999px;padding:2px 7px;white-space:nowrap}",
  // off-screen subplots (the sim) in the World view
  ".vle-os{border-left:2px solid color-mix(in srgb,var(--v-info) 50%,transparent);background:color-mix(in srgb,var(--v-info) 6%,transparent);border-radius:0 var(--vr1) var(--vr1) 0;padding:6px 10px;margin-bottom:5px}",
  ".vle-os--narr{border-left-color:var(--vle-gold-soft);background:rgba(var(--vg-rgb),.04)}",
  ".vle-os-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}",
  ".vle-os-n{font-family:var(--vserif);font-size:calc(14px * var(--vscale))}",
  ".vle-os-who{font:600 9px/1.3 var(--vmono);color:var(--v-info)}",
  ".vle-os-w{font:600 9px/1.3 var(--vmono);opacity:.55}",
  ".vle-os-gist{font-size:12px;line-height:1.45;opacity:.9;margin-top:2px}",
  ".vle-os-h{margin-top:4px;font-size:11px;opacity:.6}.vle-os-h summary{cursor:pointer;font:600 9px/1.3 var(--vmono);text-transform:uppercase;letter-spacing:.4px}.vle-os-h div{padding:2px 0 0 8px}",
  ".vle-mem{display:flex;gap:7px;font-size:12px;padding:4px 0;line-height:1.45;align-items:baseline}",
  // per-type record identity: a colored left spine so Knowledge/Secrets/Scars/
  // Codex read as different kinds down a long list (not one flat texture).
  ".vle-mem--know,.vle-mem--secret,.vle-mem--scar,.vle-mem--codex{padding-left:13px;border-left:3px solid var(--vle-gold-soft)}",
  ".vle-mem--know{border-left-color:var(--v-info)}",
  ".vle-mem--secret{border-left-color:var(--v-neg)}",
  ".vle-mem--scar{border-left-color:var(--v-warn)}",
  ".vle-mem--codex{border-left-color:var(--vg)}",
  ".vle-mem-t{flex:1;min-width:0}",
  ".vle-mem-ctl{flex:none;display:inline-flex;gap:3px;align-self:flex-start}",
  ".vle-mem-tier{flex:none;font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:var(--vr1);opacity:.85}",
  ".vle-mem-tier.t-turn{color:#8c8478;border:1px solid rgba(140,132,120,.4)}",
  ".vle-mem-tier.t-chapter{color:var(--v-info);border:1px solid color-mix(in srgb,var(--v-info) 40%,transparent)}",
  ".vle-mem-tier.t-arc{color:var(--vle-gold);border:1px solid rgba(var(--vg-rgb),.4)}",
  // knowledge epistemic chips (reliability + truth)
  ".vle-krel{display:inline-block;font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;padding:2px 6px;border-radius:var(--vr1);margin-right:5px;vertical-align:middle;opacity:.9}",
  ".vle-krel-believes{color:#c8a24e;border:1px solid rgba(200,162,78,.4)}",
  ".vle-krel-suspects{color:var(--v-warn);border:1px solid color-mix(in srgb,var(--v-warn) 40%,transparent)}",
  ".vle-krel-wrong{color:var(--v-neg-i);border:1px solid color-mix(in srgb,var(--v-neg) 50%,transparent);background:color-mix(in srgb,var(--v-neg) 8%,transparent)}",
  ".vle-krel-unaware{color:#8c8478;border:1px solid rgba(140,132,120,.4)}",
  ".vle-kfalse{display:inline-block;font:600 9px/1 var(--vmono);color:var(--v-neg-i);margin-right:5px;opacity:.85}",
  // relations
  ".vle-rel-grid{display:flex;flex-direction:column;gap:7px}",
  ".vle-rel-card{border:1px solid var(--vle-gold-soft);border-radius:9px;padding:8px 10px;background:rgba(22,20,16,.4)}",
  ".vle-rel-top{display:flex;justify-content:space-between;align-items:center;gap:8px}",
  ".vle-rel-pair{font-size:14px}",
  // paired card: A↔B header, then a directional row per edge
  ".vle-rel-dir{margin-top:7px;padding-top:7px;border-top:1px dashed rgba(var(--vg-rgb),.16)}",
  ".vle-rel-dir:first-of-type{border-top:none;margin-top:5px;padding-top:0}",
  ".vle-rel-dirtop{display:flex;align-items:center;gap:8px}",
  ".vle-rel-dirn{font-size:12px;font-weight:600;margin-right:auto}",
  ".vle-rel-onesided{margin-top:7px;font:600 9px/1.4 var(--vmono);opacity:.5;font-style:italic}",
  ".vle-rel-sent{font:600 9px/1 var(--vmono);opacity:.7}",
  ".vle-rel-label{font-size:12px;font-style:italic;opacity:.75;margin:3px 0}",
  ".vle-cats{display:flex;flex-wrap:wrap;gap:4px;margin:5px 0}",
  ".vle-cat{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:var(--vr1);color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}",
  ".vle-st{font:600 9px/1 var(--vmono);text-transform:uppercase;padding:2px 6px;border-radius:var(--vr1);opacity:.6;border:1px solid var(--vle-gold-soft)}",
  ".vle-bars{display:flex;flex-direction:column;gap:3px;margin-top:4px}",
  ".vle-bar{display:flex;align-items:center;gap:6px}",
  ".vle-bar-l{flex:none;width:30px;font:600 9px/1 var(--vmono);opacity:.6}",
  ".vle-bar-t{position:relative;flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.06)}",
  ".vle-bar-mid{position:absolute;left:50%;top:-1px;width:1px;height:7px;background:rgba(255,255,255,.2)}",
  ".vle-bar-f{position:absolute;top:0;height:5px;border-radius:3px}",
  ".vle-bar-f.pos{background:var(--v-pos)}.vle-bar-f.neg{background:var(--v-neg)}",
  ".vle-bar-v{flex:none;width:30px;text-align:right;font:600 9px/1 var(--vmono)}",
  ".vle-bar-v.pos{color:var(--v-pos-i)}.vle-bar-v.neg{color:var(--v-neg-i)}",
  // twin meter (compact aff/trust, used on the redesigned bond + dashboard)
  ".vle-tw{display:flex;align-items:center;gap:6px;margin-top:3px}",
  ".vle-tw-l{flex:none;width:34px;font:600 var(--vt-meta)/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;opacity:.6}",
  ".vle-tw-t{position:relative;flex:1;height:8px;border-radius:5px;background:rgba(255,255,255,.06)}",
  ".vle-tw-mid{position:absolute;left:50%;top:-1px;width:1px;height:10px;background:rgba(255,255,255,.22)}",
  ".vle-tw-f{position:absolute;top:0;height:8px;border-radius:5px}",
  ".vle-tw-f.tw-aff{background:linear-gradient(90deg,color-mix(in srgb,var(--v-pos) 70%,transparent),var(--v-pos-i))}",
  ".vle-tw-f.tw-trust{background:linear-gradient(90deg,color-mix(in srgb,var(--v-info) 70%,transparent),var(--v-info))}",
  ".vle-tw-f.neg{filter:saturate(.7) brightness(.92)}",
  ".vle-tw-v{flex:none;width:30px;text-align:right;font:600 var(--vt-meta)/1 var(--vmono)}",
  // shared bond meter (mockup 06): both directions per axis vs one center zero
  ".vle-bm{display:flex;flex-direction:column;gap:7px;margin-top:6px}",
  ".vle-bm-axis{display:flex;flex-direction:column;gap:3px}",
  ".vle-bm-axl{font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vi2);opacity:.55}",
  ".vle-bm-row{display:flex;align-items:center;gap:7px}",
  ".vle-bm-cap{flex:none;width:84px;font:600 var(--vt-meta)/1.1 var(--vmono);color:var(--vi2);opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  // error boundary
  ".vlm-comp-error{padding:8px;font-size:11px;color:#e09090;border:1px solid rgba(201,106,106,.3);border-radius:8px;background:rgba(201,106,106,.08)}",
  ".vlm-comp-error span{opacity:.7;font-size:10px}",
  // ---- relationship graph ----
  ".vlg-wrap{display:flex;flex-direction:column;gap:8px}",
  ".vlg-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}",
  ".vlg-legend{display:flex;flex-wrap:wrap;gap:4px}",
  ".vlg-leg{display:inline-flex;align-items:center;gap:4px;font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid var(--vle-gold-soft);border-radius:20px;padding:3px 9px;cursor:pointer;opacity:.6;transition:opacity .15s,background .15s}",
  ".vlg-leg:hover{opacity:.92}.vlg-leg.on{opacity:1;background:rgba(var(--vg-rgb),.2);border-color:rgba(var(--vg-rgb),.45)}",
  ".vlg-leg-dot{width:8px;height:8px;border-radius:50%;box-shadow:0 0 5px currentColor}",
  ".vlg-tools{display:flex;gap:4px}",
  ".vlg-tool{min-width:24px;height:24px;display:grid;place-items:center;font:600 13px/1 var(--vmono);color:var(--vle-gold);background:rgba(var(--vg-rgb),.1);border:1px solid rgba(var(--vg-rgb),.24);border-radius:6px;cursor:pointer}",
  ".vlg-tool:hover{background:rgba(var(--vg-rgb),.22)}.vlg-tool.wide{padding:0 9px;font-size:9px;letter-spacing:.5px;text-transform:uppercase}",
  ".vlg-tool.wide.on{background:rgba(var(--vg-rgb),.26);border-color:rgba(var(--vg-rgb),.5)}",
  ".vlg-stage{position:relative;border:1px solid var(--vle-gold-soft);border-radius:14px;overflow:hidden;background:radial-gradient(130% 100% at 50% 0%,rgba(var(--vg-rgb),.06),transparent 55%),linear-gradient(168deg,rgba(26,22,16,.97),rgba(15,13,10,.99));box-shadow:inset 0 1px 40px rgba(0,0,0,.5),0 2px 18px rgba(0,0,0,.35)}",
  ".vlg-svg{display:block;width:100%;height:auto;min-height:360px;max-height:64vh;cursor:grab;touch-action:none}",
  ".vlg-svg:active{cursor:grabbing}",
  "[data-graph-pan]{transition:transform .09s ease-out}",
  // hulls
  ".vlg-hull-fill{opacity:.08;transition:opacity .3s;pointer-events:none}",
  ".vlg-wrap:hover .vlg-hull-fill{opacity:.12}",
  ".vlg-hull-label{font:600 13px/1 var(--vserif);letter-spacing:2px;text-transform:uppercase;opacity:.5;pointer-events:none}",
  "[data-factions='off'] .vlg-hulls{display:none}",
  // edges
  ".vlg-edge-line{opacity:.6;transition:opacity .2s,stroke-width .2s;filter:drop-shadow(0 0 2px rgba(0,0,0,.55))}",
  ".vlg-edge:hover .vlg-edge-line{opacity:1;stroke-width:5.5}",
  ".vlg-edge-hit{cursor:pointer}",
  // nodes
  ".vlg-node{cursor:grab}.vlg-node.vlg-dragging{cursor:grabbing}",
  ".vlg-node-glow{fill:rgba(var(--vg-rgb),0);opacity:0;transition:opacity .25s}",
  ".vlg-node-c{fill:url(#vlgNode);stroke:#8c8478;stroke-width:2;transition:stroke .2s,stroke-width .2s}",
  ".vlg-node-i{fill:var(--vi);font:600 12px/1 var(--vserif);letter-spacing:.5px;pointer-events:none;user-select:none}",
  ".vlg-node-l{fill:var(--vi2);font:600 11px/1 var(--vmono);opacity:0;transition:opacity .2s;pointer-events:none;paint-order:stroke;stroke:rgba(12,10,8,.92);stroke-width:3.5px}",
  ".vlg-node.is-present .vlg-node-c{fill:#3a2f16;stroke:var(--vle-gold);stroke-width:2.6;filter:url(#vlgGlow)}",
  ".vlg-node.is-present .vlg-node-glow{fill:rgba(var(--vg-rgb),.3);opacity:.95}",
  ".vlg-node.is-present .vlg-node-l{opacity:1;fill:var(--vi)}",
  ".vlg-node.is-user .vlg-node-c{stroke:#e6c07a;stroke-width:3;stroke-dasharray:3 2}",
  ".vlg-node.is-mention .vlg-node-c{opacity:.5;stroke-dasharray:2 3}",
  ".vlg-node:hover .vlg-node-l{opacity:1}.vlg-node:hover .vlg-node-glow{opacity:.85;fill:rgba(var(--vg-rgb),.34)}",
  ".vlg-node:hover .vlg-node-c{stroke:var(--vle-gold);stroke-width:3}",
  // focus dimming
  ".vlg-focusing .vlg-edge.vlg-dim .vlg-edge-line{opacity:.08}",
  ".vlg-focusing .vlg-node.vlg-dim{opacity:.2}",
  ".vlg-focusing .vlg-node.vlg-hot .vlg-node-l{opacity:1}",
  ".vlg-node.vlg-hot .vlg-node-c{stroke:var(--vle-gold);stroke-width:3.2}",
  // tooltip
  ".vlg-tip{position:absolute;pointer-events:none;z-index:5;max-width:220px;background:rgba(18,15,11,.97);border:1px solid rgba(var(--vg-rgb),.34);border-radius:9px;padding:7px 11px;font:500 11px/1.5 var(--vmono);color:#d8c9a8;box-shadow:0 8px 26px rgba(0,0,0,.55)}",
  ".vlg-tip b{color:var(--vi);font-family:var(--vserif);font-size:14px;letter-spacing:.5px}.vlg-tip span{opacity:.6}",
  ".vlg-hint{font-size:9px;line-height:1.5;opacity:.45;text-align:center;letter-spacing:.3px}",
  // ---- floating window ----
  ".vlf{position:fixed;z-index:9999;opacity:0;transform:translateY(8px) scale(.985);transition:opacity .22s ease,transform .22s cubic-bezier(.2,.8,.2,1);pointer-events:none;font-family:var(--vserif)}",
  ".vlf.is-open{opacity:1;transform:none;pointer-events:auto}",
  ".vlf-frame{position:absolute;inset:0;display:flex;flex-direction:column;border-radius:var(--vradius,18px);overflow:hidden;color:var(--vle-ink);background:transparent;border:var(--vborder,1px) solid rgba(var(--vg-rgb),calc(.5 * var(--vai,1)));box-shadow:0 28px 80px rgba(0,0,0,.62),0 2px 0 rgba(var(--vg-rgb),.14),inset 0 0 0 1px rgba(var(--vg-rgb),calc(.1 * var(--vai,1))),inset 0 1px 60px rgba(var(--vg-rgb),.05);backdrop-filter:blur(var(--vblur,8px))}",
  ".vlf-tex{position:absolute;inset:0;z-index:0;background:var(--vglass,linear-gradient(168deg,rgba(26,22,16,.97),rgba(15,13,10,.985)));opacity:var(--vopacity,1);pointer-events:none}",
  ".vlf-scrim{position:absolute;inset:0;z-index:0;background-image:var(--vtexture,none);background-size:140px,16px 16px,16px 16px;opacity:.5;mix-blend-mode:overlay;pointer-events:none}",
  ".vlf-bar,.vlf-body,.vlf-grip{position:relative;z-index:1}",
  "[data-vle-chrome='illuminated'] .vlf-frame::before{content:'';position:absolute;z-index:1;inset:6px;border-radius:calc(var(--vradius,18px) - 5px);border:1px solid rgba(var(--vg-rgb),calc(.2 * var(--vai,1)));pointer-events:none}",
  "[data-vle-chrome='illuminated'] .vlf-frame::after{content:'';position:absolute;left:0;right:0;top:0;height:150px;background:radial-gradient(130% 90% at 50% -25%,rgba(var(--vg-rgb),.14),transparent 70%);pointer-events:none}",
  ".vlf-bar{position:relative;display:flex;align-items:center;gap:10px;padding:calc(13px * var(--vscale)) calc(16px * var(--vscale)) calc(11px * var(--vscale));cursor:grab;user-select:none;touch-action:none;border-bottom:1px solid rgba(var(--vg-rgb),.22);background:linear-gradient(180deg,rgba(var(--vg-rgb),.09),transparent)}",
  ".vlf-bar:active{cursor:grabbing}",
  ".vlf-mark{color:var(--vle-gold);font-size:calc(16px * var(--vscale));text-shadow:0 0 10px rgba(var(--vg-rgb),.55)}",
  ".vlf-title{font-family:var(--vserif);font-size:calc(20px * var(--vscale));letter-spacing:3px;text-transform:uppercase;color:var(--vi)}",
  ".vlf-actions{margin-left:auto;display:flex;gap:5px}",
  ".vlf-act{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:rgba(var(--vg-rgb),.1);border:1px solid rgba(var(--vg-rgb),.26);border-radius:8px;padding:6px 10px;cursor:pointer;transition:background .15s}",
  ".vlf-act:hover{background:rgba(var(--vg-rgb),.26);color:var(--vle-gold)}",
  ".vlf-x{width:calc(26px * var(--vscale));height:calc(26px * var(--vscale));display:grid;place-items:center;border-radius:8px;color:var(--vi2);background:transparent;border:1px solid transparent;cursor:pointer;font-size:calc(14px * var(--vscale))}",
  ".vlf-x:hover{color:#e09090;border-color:rgba(201,106,106,.4);background:rgba(201,106,106,.1)}",
  ".vlf-body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;padding:0;scrollbar-width:thin;scrollbar-color:rgba(var(--vg-rgb),.4) transparent}",
  ".vlf-body::-webkit-scrollbar{width:9px}.vlf-body::-webkit-scrollbar-thumb{background:rgba(var(--vg-rgb),.3);border-radius:5px;border:2px solid transparent;background-clip:padding-box}",
  ".vlf-grip{position:absolute;right:3px;bottom:3px;width:18px;height:18px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 45%,rgba(var(--vg-rgb),.5) 45%,rgba(var(--vg-rgb),.5) 55%,transparent 55%,transparent 70%,rgba(var(--vg-rgb),.5) 70%,rgba(var(--vg-rgb),.5) 80%,transparent 80%);border-bottom-right-radius:12px}",
  // persistent launcher tab
  ".vlf-launch{position:fixed;right:0;top:46%;z-index:9998;display:flex;align-items:center;gap:6px;padding:11px 11px 11px 13px;border-radius:13px 0 0 13px;cursor:pointer;color:var(--vi);font-family:var(--vserif);letter-spacing:1.5px;text-transform:uppercase;font-size:13px;background:var(--vglass,linear-gradient(180deg,rgba(34,28,19,.97),rgba(20,17,12,.98)));border:1px solid rgba(var(--vg-rgb),.5);border-right:none;box-shadow:-5px 4px 22px rgba(0,0,0,.5);transition:transform .18s,box-shadow .18s;writing-mode:vertical-rl}",
  ".vlf-launch:hover{transform:translateX(-3px);box-shadow:-7px 4px 24px rgba(0,0,0,.55)}",
  ".vlf-launch.is-hidden{display:none}",
  ".vlf-launch-mark{color:var(--vle-gold);font-size:14px;writing-mode:horizontal-tb;text-shadow:0 0 8px rgba(var(--vg-rgb),.5)}",
  ".vlf-launch-t{opacity:.85}",
  // ---- window chrome modes (orthogonal to skin; default = illuminated above) ----
  // MODERN — flat, quiet, sans title, no manuscript ornament
  "[data-vle-chrome='modern'] .vlf-frame{border-color:rgba(var(--vg-rgb),calc(.28 * var(--vai,1)));box-shadow:0 18px 50px rgba(0,0,0,.5),inset 0 0 0 1px rgba(var(--vg-rgb),.05)}",
  "[data-vle-chrome='modern'] .vlf-bar{background:rgba(var(--vg-rgb),.05);border-bottom-color:rgba(var(--vg-rgb),.14)}",
  "[data-vle-chrome='modern'] .vlf-title{font-family:var(--vserif);font-size:calc(16px * var(--vscale));letter-spacing:.5px;text-transform:none}",
  "[data-vle-chrome='modern'] .vlf-mark{text-shadow:none}",
  "[data-vle-chrome='modern'] .vlf-grip{background:none;border:none;right:5px;bottom:5px;width:12px;height:12px;border-right:2px solid rgba(var(--vg-rgb),.4);border-bottom:2px solid rgba(var(--vg-rgb),.4);border-bottom-right-radius:4px}",
  // FUTURISTIC — sharp, accent edge-glow, mono HUD title, corner ticks
  "[data-vle-chrome='futuristic'] .vlf-frame{border-color:rgba(var(--vg-rgb),calc(.7 * var(--vai,1)));box-shadow:0 0 0 1px rgba(var(--vg-rgb),.25),0 0 22px rgba(var(--vg-rgb),.22),0 18px 50px rgba(0,0,0,.6)}",
  "[data-vle-chrome='futuristic'] .vlf-bar{background:linear-gradient(180deg,rgba(var(--vg-rgb),.16),transparent);border-bottom-color:rgba(var(--vg-rgb),.45)}",
  "[data-vle-chrome='futuristic'] .vlf-title{font-family:var(--vmono);font-size:calc(14px * var(--vscale));font-weight:600;letter-spacing:2px;text-transform:uppercase}",
  "[data-vle-chrome='futuristic'] .vlf-frame::before{content:'';position:absolute;z-index:1;inset:4px;border-radius:2px;border:1px solid rgba(var(--vg-rgb),.18);pointer-events:none}",
  "[data-vle-chrome='futuristic'] .vlf-frame::after{content:'';position:absolute;z-index:1;inset:0;pointer-events:none;background:linear-gradient(90deg,var(--vg) 0 14px,transparent 14px) 0 0/100% 2px no-repeat,linear-gradient(90deg,var(--vg) 0 14px,transparent 14px) 100% 100%/100% 2px no-repeat;opacity:.55}",
  "[data-vle-chrome='futuristic'] .vlf-grip{background:none;border:none;right:4px;bottom:4px;width:12px;height:12px;border-right:2px solid var(--vg);border-bottom:2px solid var(--vg);opacity:.7;border-radius:0}",
  "[data-vle-chrome='futuristic'] .vlf-launch{border-radius:0;border-width:1px 0 1px 1px}",
  // BLOOM — soft pastel garden: pillowy rounded frame, blush glow, lace edge, script title
  "[data-vle-chrome='bloom'] .vlf-frame{border-radius:calc(var(--vradius) + 8px);border-color:color-mix(in srgb,var(--vg) 40%,transparent);box-shadow:0 10px 40px rgba(180,120,150,.28),0 0 0 6px rgba(var(--vg-rgb),.06),inset 0 0 0 1px rgba(255,255,255,.35)}",
  "[data-vle-chrome='bloom'] .vlf-bar{background:linear-gradient(180deg,rgba(var(--vg-rgb),.14),transparent);border-bottom:1px solid color-mix(in srgb,var(--vg) 22%,transparent)}",
  "[data-vle-chrome='bloom'] .vlf-title{font-family:var(--vserif);font-style:italic;font-weight:600;font-size:calc(18px * var(--vscale));letter-spacing:.5px;text-transform:none}",
  // scalloped-lace inner edge (dotted pastel arcs) hugging the frame
  "[data-vle-chrome='bloom'] .vlf-frame::before{content:'';position:absolute;z-index:1;inset:7px;border-radius:calc(var(--vradius) + 2px);border:1.5px dotted color-mix(in srgb,var(--vg) 35%,transparent);pointer-events:none}",
  "[data-vle-chrome='bloom'] .vlf-grip{background:none;border:none;right:7px;bottom:7px;width:12px;height:12px;border-right:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-bottom:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-radius:0 0 8px 0}",
  "[data-vle-chrome='bloom'] .vlf-launch{border-radius:16px 0 0 16px}",
  // EMBER (float frame) - starlit void: a rounded aurora frame with a soft
  // pastel edge-glow and an ethereal italic title. Distinct from every other
  // chrome: no hard brackets (futuristic), no parchment (fantasy), no flat
  // sans (modern), no lace (bloom). Its signature is glowing softness over
  // a deep indigo field; the fireflies/bubbles live on the body below.
  "[data-vle-chrome='ember'] .vlf-frame{border-radius:calc(var(--vradius) + 10px);border-color:color-mix(in srgb,var(--vg) 38%,transparent);box-shadow:0 0 24px rgba(var(--vg-rgb),.18),0 0 60px rgba(var(--vg2-rgb),.14),0 18px 60px rgba(8,8,24,.6),inset 0 0 0 1px rgba(255,255,255,.06)}",
  "[data-vle-chrome='ember'] .vlf-bar{background:linear-gradient(180deg,rgba(var(--vg-rgb),.1),transparent);border-bottom:1px solid color-mix(in srgb,var(--vg) 22%,transparent)}",
  "[data-vle-chrome='ember'] .vlf-title{font-family:var(--vserif);font-style:italic;font-weight:500;font-size:calc(17px * var(--vscale));letter-spacing:1px;text-transform:none;text-shadow:0 0 12px rgba(var(--vg-rgb),.4)}",
  // a soft inner halo - a diffuse glow ring, not a hard bracket or dotted lace
  "[data-vle-chrome='ember'] .vlf-frame::before{content:'';position:absolute;z-index:1;inset:6px;border-radius:calc(var(--vradius) + 4px);box-shadow:inset 0 0 22px rgba(var(--vg-rgb),.1),inset 0 0 40px rgba(var(--vg2-rgb),.07);pointer-events:none}",
  "[data-vle-chrome='ember'] .vlf-grip{background:none;border:none;right:7px;bottom:7px;width:12px;height:12px;border-right:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-bottom:2px solid color-mix(in srgb,var(--vg) 55%,transparent);border-radius:0 0 10px 0;opacity:.7}",
  "[data-vle-chrome='ember'] .vlf-launch{border-radius:18px 0 0 18px;box-shadow:-5px 4px 22px rgba(0,0,0,.5),0 0 18px rgba(var(--vg-rgb),.18)}",

  // ---- CRUD controls + pagination ----
  ".vle-sec-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:flex-end;margin-bottom:8px}",
  ".vle-add{font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold);background:rgba(var(--vg-rgb),.14);border:1px solid rgba(var(--vg-rgb),.34);border-radius:7px;padding:5px 11px;cursor:pointer}",
  ".vle-add:hover{background:rgba(var(--vg-rgb),.28)}",
  ".vle-add.sm{margin-left:auto;padding:2px 8px;font-size:11px;line-height:1}",
  ".vle-card-ctl,.vle-rel-ctl{display:inline-flex;gap:3px;margin-left:auto}",
  // controls fade in on hover/keyboard-focus; only hidden where hover exists, so
  // touch devices (hover:none) keep them tappable. Kept in DOM (not display:none).
  "@media (hover:hover){.vle-card .vle-card-ctl{opacity:.4;transition:opacity .15s}.vle-card:hover .vle-card-ctl,.vle-card:focus-within .vle-card-ctl{opacity:1}}",
  "html[data-vle-motion='off'] .vle-card .vle-card-ctl{opacity:1}",
  ".vle-mini{width:22px;height:22px;display:grid;place-items:center;border-radius:6px;font-size:11px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.2);cursor:pointer}",
  ".vle-mini:hover{background:rgba(var(--vg-rgb),.22);color:var(--vle-gold)}",
  ".vle-mini.del:hover{color:#e09090;border-color:rgba(201,106,106,.4);background:rgba(201,106,106,.1)}",
  ".vle-card{align-items:center}",
  ".vle-rel-sub{margin:2px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
  ".vle-mini.on{color:var(--vle-gold);background:rgba(var(--vg-rgb),.2)}",
  ".vle-rel-lockbadge{display:inline-flex;align-items:center;justify-content:center;gap:3px;text-align:center;font:600 8.5px/1.3 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--v-warn);border:1px solid color-mix(in srgb,var(--v-warn) 40%,transparent);border-radius:var(--vr1);padding:3px 6px}",
  ".vle-mem{align-items:center;gap:7px}",
  ".vle-pager{display:flex;align-items:center;justify-content:center;gap:10px;margin:8px 0 4px}",
  ".vle-pg{width:26px;height:24px;border-radius:6px;font-size:13px;color:var(--vle-gold);background:rgba(var(--vg-rgb),.1);border:1px solid rgba(var(--vg-rgb),.24);cursor:pointer}",
  ".vle-pg:hover{background:rgba(var(--vg-rgb),.24)}.vle-pg[disabled]{opacity:.3;cursor:default}",
  ".vle-pg-n{font:600 9px/1 var(--vmono);opacity:.6;min-width:42px;text-align:center}",
  // ---- modal ----
  ".vlfm-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(8,7,5,.6);backdrop-filter:blur(3px)}",
  // self-owned toasts (the Lumiverse ctx has no toast API) — above overlays
  ".vle-toasts{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10002;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}",
  ".vle-toast{pointer-events:auto;max-width:min(460px,90vw);padding:10px 16px;border-radius:10px;font:600 12px/1.4 var(--vmono);letter-spacing:.2px;color:var(--vle-ink);background:linear-gradient(168deg,rgba(28,24,17,.99),rgba(16,14,10,1));border:1px solid rgba(var(--vg-rgb),.45);box-shadow:0 12px 40px rgba(0,0,0,.6);opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s}",
  ".vle-toast.on{opacity:1;transform:translateY(0)}",
  ".vle-toast--success{border-color:color-mix(in srgb,var(--v-pos) 55%,transparent)}",
  ".vle-toast--warning{border-color:color-mix(in srgb,var(--v-warn) 60%,transparent)}",
  ".vle-toast--info{border-color:rgba(var(--vg-rgb),.45)}",
  ".vlfm{width:min(440px,92vw);max-height:86vh;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;color:var(--vle-ink);background:linear-gradient(168deg,rgba(28,24,17,.99),rgba(16,14,10,1));border:1px solid rgba(var(--vg-rgb),.5);box-shadow:0 28px 80px rgba(0,0,0,.7)}",
  // Search / Customize / Actions carry .vle-root (to scope theme vars); the chrome
  // `.vle-root{background-image:...}` rules would otherwise beat .vlfm's opaque fill
  // and let the chat show through. Pin an opaque surface for these panels on every chrome.
  "html[data-vle-chrome] .vlfm.vle-root{background-color:#14110b;background-image:linear-gradient(168deg,rgba(28,24,17,.99),rgba(16,14,10,1))}",
  // user custom background color: paints the drawer fill (float reads --vglass via .vlf-tex).
  // Excludes .vlfm modals (they pin their own opaque surface) and clears chrome gradients so the color reads true.
  "html[data-vle-bg] .vle-root:not(.vlfm){background-color:var(--vle-bg-custom);background-image:none}",
  ".vlfm-head{display:flex;align-items:center;gap:8px;padding:13px 16px;font-family:var(--vserif);font-size:18px;letter-spacing:1.5px;text-transform:uppercase;color:var(--vi);border-bottom:1px solid rgba(var(--vg-rgb),.22)}",
  ".vlfm-mark{color:var(--vle-gold)}",
  ".vlfm-body{padding:14px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:11px}",
  ".vlfm-l{display:flex;flex-direction:column;gap:5px;font:600 9px/1.3 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.78}",
  ".vlfm-section{margin:12px 0 2px;font:600 9px/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vg);opacity:.7;padding-bottom:4px;border-bottom:1px solid rgba(var(--vg-rgb),.16)}",
  ".vlfm-adv{margin-top:10px;border-top:1px solid rgba(var(--vg-rgb),.16);padding-top:4px}",
  ".vlfm-adv>summary{font:600 10px/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vg);opacity:.75;cursor:pointer;padding:5px 0}",
  ".vlfm-adv[open]>summary{margin-bottom:6px}",
  ".vlfm-in{font-family:var(--vserif);font-size:15px;letter-spacing:0;text-transform:none;color:var(--vle-ink);background:rgba(12,10,8,.7);border:1px solid rgba(var(--vg-rgb),.26);border-radius:8px;padding:8px 10px;outline:none}",
  ".vlfm-in:focus{border-color:var(--vle-gold);box-shadow:0 0 0 2px rgba(var(--vg-rgb),.16)}",
  ".vlfm-ta{min-height:84px;resize:vertical;line-height:1.5}",
  // large editor (vault entries): wide dialog + tall content area, with a body that grows
  ".vlfm-large{width:min(860px,94vw);max-height:90vh}",
  ".vlfm-large .vlfm-body{flex:1 1 auto}",
  ".vlfm-l-grow{flex:1 1 auto;min-height:0}",
  ".vlfm-ta-big{min-height:min(58vh,520px);height:min(58vh,520px);resize:vertical;line-height:1.6;font-size:15px}",
  ".vlfm-chkrow{display:flex;flex-wrap:wrap;gap:8px 14px;padding:3px 0}",
  ".vlfm-chk{display:inline-flex;align-items:center;gap:5px;font:500 12px/1 var(--vmono);text-transform:none;letter-spacing:0;cursor:pointer}",
  ".vlfm-chk input{accent-color:var(--vle-gold);cursor:pointer}",
  // edit-character color field: space the color input from the 'none' toggle
  ".vlfm-colrow{display:flex;align-items:center;gap:14px;margin-top:4px}",
  ".vlfm-col{width:46px;height:28px;padding:0;border:1px solid rgba(var(--vg-rgb),.3);border-radius:6px;background:transparent;cursor:pointer}",
  // cast tab auto-color control
  ".vle-autoc{display:inline-flex;align-items:center;gap:4px;font:600 8.5px/1 var(--vmono);letter-spacing:.3px;text-transform:uppercase;color:var(--vle-dim);margin-right:8px}",
  ".vle-autoc-b{font:inherit;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid var(--vle-gold-soft);border-radius:6px;padding:4px 7px;cursor:pointer}",
  ".vle-autoc-b:hover{color:var(--vle-gold)}",
  ".vle-autoc-b.on{background:rgba(var(--vg-rgb),.22);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.45)}",
  ".vlfm-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:11px 16px;border-top:1px solid rgba(var(--vg-rgb),.18)}",
  ".vlfm-foot-sp{flex:1 1 auto}",
  ".vlfm-act{color:var(--vi2);opacity:.85}.vlfm-act:hover{background:rgba(255,255,255,.05);opacity:1}",
  ".vlfm-hint{font:500 10px/1.4 var(--vmono);letter-spacing:0;text-transform:none;opacity:.6;margin-top:-2px}",
  ".vlfm-btn{font:600 11px/1 var(--vmono);letter-spacing:.5px;border-radius:8px;padding:8px 16px;cursor:pointer;border:1px solid rgba(var(--vg-rgb),.3);background:transparent;color:var(--vi2)}",
  ".vlfm-save{background:rgba(var(--vg-rgb),.22);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.5)}",
  ".vlfm-save:hover{background:rgba(var(--vg-rgb),.36)}.vlfm-cancel:hover{background:rgba(255,255,255,.05)}",
  // ---- filter bar ----
  ".vle-fbar{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 9px}",
  ".vle-fb-btn,.vle-fb-sel{font:600 9px/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.22);border-radius:7px;padding:5px 9px;cursor:pointer}",
  ".vle-fb-btn:hover{background:rgba(var(--vg-rgb),.2);color:var(--vle-gold)}",
  ".vle-fb-btn.on{background:rgba(var(--vg-rgb),.2);color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.45)}",
  ".vle-fb-sel{text-transform:none}",
  // ---- journal ----
  ".vle-jr-grid{display:flex;flex-direction:column;gap:7px}",
  ".vle-jr{border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--c,#8c8478);border-radius:0 var(--vr2) var(--vr2) 0;background:rgba(22,20,16,.42);padding:8px 11px}",
  ".vle-jr-top{display:flex;align-items:center;gap:7px}",
  ".vle-jr-glyph{color:var(--c,var(--vg));font-size:14px}",
  ".vle-jr-who{font-family:var(--vserif);font-size:14px;color:var(--vi);flex:1}",
  ".vle-jr-ctl{display:inline-flex;gap:3px}",
  ".vle-jr-mem{font-size:12.5px;line-height:1.5;color:#cdc3ad;margin:5px 0 6px;font-style:italic}",
  ".vle-jr-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center}",
  ".vle-jr-tag{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;padding:2px 6px;border-radius:5px;border:1px solid rgba(var(--vg-rgb),.2);opacity:.85}",
  ".vle-jr-tag.w-defining{border-color:rgba(var(--vg-rgb),.6);color:var(--vle-gold)}",
  ".vle-jr-tag.w-significant{border-color:rgba(var(--vg-rgb),.4)}",
  ".vle-jr-day{margin-left:auto;font:600 9px/1 var(--vmono);opacity:.5}",
  // sentiment → semantic token (drives left rule, glyph, and the sentiment tag)
  ".vle-jr--pos{--c:var(--v-pos-i)}.vle-jr--neg{--c:var(--v-neg-i)}.vle-jr--neu{--c:var(--vle-dim)}.vle-jr--cx{--c:var(--v-warn)}",
  ".vle-jr-sent{color:var(--c,var(--vle-dim))}",
  // ---- relation change history ----
  ".vle-hist{margin-top:7px;border-top:1px solid rgba(var(--vg-rgb),.14);padding-top:5px}",
  ".vle-hist>summary{cursor:pointer;list-style:none;font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.5}",
  ".vle-hist>summary::-webkit-details-marker{display:none}.vle-hist>summary::before{content:'\u25B8 '}",
  ".vle-hist[open]>summary::before{content:'\u25BE '}",
  ".vle-hist-sec{font:600 9px/1 var(--vmono);text-transform:uppercase;opacity:.45;margin:6px 0 3px}",
  ".vle-hist-row{display:flex;gap:7px;align-items:baseline;font-size:11px;padding:1px 0}",
  ".vle-hist-t{flex:none;width:30px;font:600 9px/1 var(--vmono);opacity:.5}",
  ".vle-hist-ev{font:600 9px/1 var(--vmono);padding:1px 5px;border-radius:5px}",
  ".vle-hist-ev.add{color:var(--v-pos-i);border:1px solid color-mix(in srgb,var(--v-pos) 40%,transparent)}",
  ".vle-hist-ev.rm{color:var(--v-neg-i);border:1px solid color-mix(in srgb,var(--v-neg) 40%,transparent);text-decoration:line-through}",
  ".vle-hist-sc{font:600 9px/1.3 var(--vmono);color:var(--vi2)}",
  ".vle-hist-why{opacity:.55;font-style:italic;font-size:10px}",
  // ---- injection tab ----
  ".vle-inj-hint{font-size:10px;opacity:.55;margin-right:auto}",
  ".vle-inj-list{display:flex;flex-direction:column;gap:6px}",
  ".vle-inj{border:1px solid rgba(var(--vg-rgb),.18);border-radius:9px;overflow:hidden;background:rgba(20,18,14,.4)}",
  ".vle-inj-top{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer}",
  ".vle-inj-top:hover{background:rgba(var(--vg-rgb),.06)}",
  ".vle-inj-turn{font:600 9px/1 var(--vmono);color:var(--vle-gold);flex:none}",
  ".vle-inj-reasons{flex:1;display:flex;flex-wrap:wrap;gap:4px}",
  ".vle-inj-reason{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;padding:2px 6px;border-radius:var(--vr1);background:rgba(var(--vg-rgb),.1);color:var(--vi2)}",
  ".vle-inj-chars{font:600 9px/1 var(--vmono);opacity:.45;flex:none}",
  ".vle-inj-body{display:none;margin:0;padding:9px 11px;border-top:1px solid rgba(var(--vg-rgb),.16);font:500 10.5px/1.5 var(--vmono);color:#bcb29c;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow-y:auto;background:rgba(12,10,8,.5)}",
  ".vle-inj-body.open{display:block}",
  // ---- journal book / shelf ----
  ".vle-shelf{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 9px}",
  ".vle-book{font:600 11px/1 var(--vserif);letter-spacing:.5px;color:var(--vi);background:linear-gradient(180deg,rgba(34,28,19,.9),rgba(20,17,12,.9));border:1px solid rgba(var(--vg-rgb),.3);border-radius:6px;padding:6px 10px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}",
  ".vle-book:hover{border-color:var(--vle-gold);background:rgba(var(--vg-rgb),.16)}",
  ".vle-book-n{font:600 9px/1 var(--vmono);background:rgba(var(--vg-rgb),.2);color:var(--vle-gold);border-radius:7px;padding:2px 6px}",
  ".vle-book-head{display:flex;align-items:center;gap:8px;margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid rgba(var(--vg-rgb),.22)}",
  ".vle-book-title{font-family:var(--vserif);font-size:17px;letter-spacing:1px;color:var(--vi);flex:1}",
  // ---- Journal "Shelf": book spines standing on a plank (mockup 11A) ----
  ".vle-shelf-wrap{margin:0 0 14px}",
  ".vle-shelf-wrap .vle-shelf{display:flex;flex-wrap:nowrap;overflow-x:auto;align-items:flex-end;gap:6px;padding:6px 2px 0}",
  ".vle-shelf-plank{height:8px;border-radius:2px;background:linear-gradient(180deg,#2a2114,#1a140c);box-shadow:0 2px 6px rgba(0,0,0,.4)}",
  ".vle-jspine{flex:none;width:52px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:6px;padding:8px 4px;cursor:pointer;border:1px solid rgba(var(--vg-rgb),.35);border-bottom:none;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#3a2f1a,#241c10);color:var(--vi);position:relative}",
  ".vle-jspine:hover{background:linear-gradient(180deg,#473921,#2c2213);transform:translateY(-3px);transition:transform .12s}",
  ".vle-jspine-av{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.2);border:1.5px solid rgba(var(--vg-rgb),.5);color:var(--vle-gold);font:600 11px/1 var(--vmono)}",
  ".vle-jspine-name{writing-mode:vertical-rl;transform:rotate(180deg);font-family:var(--vserif);font-style:italic;font-size:12px;letter-spacing:.5px;flex:1;max-height:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vle-jspine-n{font:600 9px/1 var(--vmono);opacity:.7}",
  // foot band = dominant sentiment
  ".vle-jspine::after{content:'';position:absolute;left:0;right:0;bottom:0;height:5px}",
  ".vle-jspine--pos::after{background:var(--v-pos)}.vle-jspine--neg::after{background:var(--v-neg)}.vle-jspine--neu::after{background:rgba(var(--vg-rgb),.5)}.vle-jspine--cx::after{background:var(--v-warn)}",
  // ---- Journal "Diary": open two-page spread (mockup 11B) ----
  ".vle-diary-head{display:flex;align-items:center;gap:9px;margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid rgba(var(--vg-rgb),.22)}",
  ".vle-diary-av{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.2);border:1.5px solid rgba(var(--vg-rgb),.5);color:var(--vle-gold);font:600 11px/1 var(--vmono)}",
  ".vle-diary{display:grid;grid-template-columns:1fr 1fr;gap:0;border-radius:var(--vr3);overflow:hidden;background:linear-gradient(90deg,var(--vsurf-1),var(--vsurf-2) 49%,rgba(0,0,0,.25) 50%,var(--vsurf-1) 51%,var(--vsurf-2))}",
  ".vle-diary-page{padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:200px}",
  ".vle-leaf{padding-bottom:9px;border-bottom:1px solid rgba(var(--vg-rgb),.12)}",
  ".vle-leaf-meta{display:flex;align-items:baseline;gap:6px;font:600 calc(9.5px * var(--vscale))/1.3 var(--vmono);letter-spacing:.4px;color:var(--vg);opacity:.8;margin-bottom:4px}",
  ".vle-leaf-ctl{margin-left:auto;display:inline-flex;gap:3px;opacity:.5}",
  ".vle-leaf:hover .vle-leaf-ctl{opacity:1}",
  ".vle-leaf-mem{font-family:var(--vserif);font-style:italic;font-size:calc(14px * var(--vscale));line-height:1.55;color:var(--vi2)}",
  // sentiment inks the handwriting
  ".vle-leaf--pos .vle-leaf-mem{color:var(--v-pos-i)}.vle-leaf--neg .vle-leaf-mem{color:var(--v-neg-i)}.vle-leaf--cx .vle-leaf-mem{color:var(--v-warn)}",
  ".vle-diary-add{align-self:flex-start;margin-top:auto;font-family:var(--vserif);font-style:italic;font-size:13px;color:var(--vi2);background:none;border:none;cursor:pointer;opacity:.7}",
  ".vle-diary-add:hover{opacity:1;color:var(--vle-gold)}",
  "@container (max-width:460px){.vle-diary{grid-template-columns:1fr;background:var(--vsurf-1)}.vle-diary-page:first-child{border-bottom:1px solid rgba(var(--vg-rgb),.15)}}",
  // diary theme skins: futuristic = MEMORY_LOG (mono, no skeuomorph), modern = flat cards
  "html[data-vle-chrome='futuristic'] .vle-diary{background:#04121a;border:1px solid rgba(var(--vg-rgb),.4)}",
  "html[data-vle-chrome='futuristic'] .vle-leaf-mem{font-family:var(--vmono);font-style:normal;font-size:calc(12px * var(--vscale))}",
  "html[data-vle-chrome='futuristic'] .vle-leaf-mem::before{content:'\\00bb '}",
  "html[data-vle-chrome='modern'] .vle-diary{background:none;gap:8px}",
  "html[data-vle-chrome='modern'] .vle-diary-page{background:color-mix(in srgb,var(--vi) 4%,transparent);border-radius:16px}",
  "html[data-vle-chrome='modern'] .vle-leaf-mem{font-style:normal}",
  // ---- floating dashboard ----
  ".vld{display:flex;flex-direction:column;gap:calc(16px * var(--vscale))}",
  ".vld-sec{display:flex;flex-direction:column;gap:calc(11px * var(--vscale));padding:calc(13px * var(--vscale)) calc(14px * var(--vscale));border:1px solid rgba(var(--vg-rgb),.14);border-radius:var(--vr3);background:linear-gradient(168deg,var(--vsurf-1),var(--vsurf-2))}",
  // header sits apart from its body: own line + breathing room beneath the eyebrow
  ".vld-h{font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vg);opacity:.85;display:flex;align-items:center;gap:7px;margin-bottom:calc(3px * var(--vscale))}",
  ".vld-statbar{display:flex;flex-wrap:wrap;gap:7px}",
  ".vld-stat{font:600 calc(11px * var(--vscale))/1 var(--vmono);color:var(--vi2);background:rgba(var(--vg-rgb),.1);border:1px solid rgba(var(--vg-rgb),.24);border-radius:8px;padding:7px 11px;display:inline-flex;gap:6px}",
  ".vld-stat b{color:var(--vle-gold);font-weight:600;opacity:.85}",
  ".vld-loc{font-family:var(--vserif);font-size:calc(18px * var(--vscale));color:var(--vi);font-style:italic;line-height:1.3}",
  // redesigned hero scene block + single quiet meta line (replaces the 4 pills)
  ".vld-sec--hero{gap:calc(6px * var(--vscale))}",
  ".vld-hero{font-size:var(--vt-display);line-height:1.18}",
  ".vld-hero:not(.vld-loc--none)::before{content:'\\25C8 ';color:var(--vg);opacity:.7;font-style:normal}",
  ".vld-loc--none{opacity:.5}",
  ".vld-meta{font:600 var(--vt-meta)/1.4 var(--vmono);letter-spacing:.5px;color:var(--vi2);opacity:.7}",
  // world-calendar epoch token — reads as an occasion under the meta line
  ".vld-epoch{margin-top:calc(4px * var(--vscale));font-family:var(--vserif);font-style:italic;font-size:calc(14px * var(--vscale));color:var(--v-press-i);letter-spacing:.3px}",
  "html[data-vle-chrome='illuminated'] .vld-epoch{color:var(--v-neg-i);font-variant:small-caps;letter-spacing:1px}",
  "html[data-vle-chrome='futuristic'] .vld-epoch{font-family:var(--vmono);font-style:normal;text-transform:uppercase;letter-spacing:1.5px;font-size:calc(11px * var(--vscale))}",
  // amber tension dot-meter (semantic --v-press, no longer danger-red)
  ".vld-dots{display:flex;gap:4px;align-items:center;flex:1}",
  ".vld-dot{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.1)}",
  ".vld-dot.on{background:var(--v-press);box-shadow:0 0 6px color-mix(in srgb,var(--v-press) 60%,transparent)}",
  // twin meters under a dashboard relation row
  ".vld-rel-meters{display:flex;flex-direction:column;gap:2px;margin:1px 0 6px;padding-left:2px}",
  // colored left spine per recent-event kind (scannable mixed feed)
  ".vld-rec--journal{border-left:3px solid var(--v-pos)}",
  ".vld-rec--knew{border-left:3px solid var(--v-info)}",
  ".vld-rec--secret{border-left:3px solid var(--v-neg)}",
  ".vld-rec--shift{border-left:3px solid var(--v-press)}",
  ".vld-tension-row{display:flex;align-items:center;gap:12px}",
  ".vld-tension{position:relative;flex:1;height:8px;border-radius:5px;background:rgba(255,255,255,.07);overflow:hidden}",
  ".vld-tension-f{position:absolute;left:0;top:0;height:8px;border-radius:5px;transition:width .3s;box-shadow:0 0 8px currentColor}",
  ".vld-tension-n{flex:none;min-width:38px;text-align:right;font:600 calc(11px * var(--vscale))/1 var(--vmono);opacity:.7}",
  ".vld-pc{display:flex;gap:11px;align-items:flex-start;border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--v-pos);border-radius:0 var(--vr3) var(--vr3) 0;background:rgba(var(--vg-rgb),.05);padding:calc(10px * var(--vscale)) calc(12px * var(--vscale))}",
  ".vld-pc+.vld-pc{margin-top:7px}",
  // portrait medallion + presence dot (mockup 09)
  ".vld-pc-av{position:relative;flex:none;width:calc(38px * var(--vscale));height:calc(38px * var(--vscale));display:grid;place-items:center;border-radius:50%;background:rgba(var(--vg-rgb),.18);border:2px solid color-mix(in srgb,var(--v-pos) 60%,transparent);color:var(--vle-gold,var(--vg));font-weight:600;font-size:calc(14px * var(--vscale))}",
  ".vld-pc-dot{position:absolute;right:-1px;top:-1px;width:10px;height:10px;border-radius:50%;background:var(--v-pos);border:2px solid var(--vsurf-2)}",
  ".vld-pc-body{flex:1;min-width:0}",
  ".vld-pc-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}",
  ".vld-pc-n{font-family:var(--vserif);font-size:calc(18px * var(--vscale));color:var(--vi);font-weight:600}",
  // sentence-case sentiment status (no shouty mono pills)
  ".vld-pc-status{font-family:var(--vserif);font-style:italic;font-size:calc(13px * var(--vscale))}",
  ".vld-pc-mood{color:var(--v-pos-i)}.vld-pc-cond{color:var(--v-neg-i)}",
  ".vld-pc-sep{opacity:.4;margin:0 4px}",
  ".vld-doing{font-size:calc(13.5px * var(--vscale));opacity:.82;margin-top:5px;line-height:1.5}",
  // the inner thought = focal point: own quoted block, violet key
  ".vld-thought{margin-top:7px;padding-left:11px;border-left:2px solid color-mix(in srgb,var(--v-warn) 55%,transparent)}",
  ".vld-thought-k{display:block;font:600 var(--vt-eyebrow)/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--v-warn);opacity:.8;margin-bottom:2px}",
  ".vld-thought-q{font-family:var(--vserif);font-style:italic;font-size:calc(14.5px * var(--vscale));color:var(--vi2);line-height:1.5}",
  // narrow float reflow: smaller medallion, name+status share a line, thought truncates
  "@container (max-width:360px){.vld-pc{gap:9px}.vld-pc-av{width:calc(30px * var(--vscale));height:calc(30px * var(--vscale));font-size:calc(12px * var(--vscale))}.vld-pc-n{font-size:calc(15px * var(--vscale))}.vld-thought-q{font-size:calc(13px * var(--vscale))}}",
  ".vld-rel{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:calc(13px * var(--vscale));padding:5px 0;border-top:1px solid rgba(var(--vg-rgb),.08)}",
  ".vld-rel:first-child{border-top:none}",
  ".vld-rel-p{color:var(--vi)}.vld-rel-s{margin-left:auto;font:600 calc(9px * var(--vscale))/1 var(--vmono);opacity:.6}",
  ".vld-cat{font:600 calc(9px * var(--vscale))/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;padding:2px 6px;border-radius:5px;color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}",
  ".vld-thread{display:flex;justify-content:space-between;gap:8px;font-size:calc(13px * var(--vscale));padding:4px 0 4px 9px;border-left:2px solid rgba(var(--vg-rgb),.3)}",
  ".vld-thread+.vld-thread{border-top:1px solid rgba(var(--vg-rgb),.08)}",
  ".vld-thread-s{font:600 calc(9px * var(--vscale))/1 var(--vmono);color:var(--vle-gold);opacity:.75}",
  ".vld-par{border:1px solid color-mix(in srgb,var(--v-info) 22%,transparent);border-radius:10px;background:color-mix(in srgb,var(--v-info) 7%,transparent);padding:calc(11px * var(--vscale)) calc(13px * var(--vscale))}",
  ".vld-par+.vld-par{margin-top:8px}",
  ".vld-par-who{font-family:var(--vserif);font-size:calc(15px * var(--vscale));color:var(--v-info)}",
  ".vld-par-w{font:600 calc(9px * var(--vscale))/1 var(--vmono);opacity:.55}",
  ".vld-par-sim{font:600 calc(8px * var(--vscale))/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--v-info);border:1px solid color-mix(in srgb,var(--v-info) 35%,transparent);border-radius:var(--vr1);padding:1px 4px;opacity:.8}",
  ".vld-par-act{font-size:calc(12.5px * var(--vscale));opacity:.82;margin-top:6px;line-height:1.5}",
  ".vld-rec{font-size:calc(12.5px * var(--vscale));line-height:1.55;padding:6px 0 6px 14px;color:var(--vi2);border-top:1px solid rgba(var(--vg-rgb),.08)}",
  ".vld-rec:first-child{border-top:none}",
  ".vld-rec-k{font:600 calc(9px * var(--vscale))/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;color:var(--vle-gold);background:rgba(var(--vg-rgb),.14);border-radius:5px;padding:3px 6px;margin-right:7px}",
  // ---- Vault tab ----
  ".vlv-catbar{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 10px}",
  ".vlv-chip{display:inline-flex;align-items:center;gap:5px;font:600 10px/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.07);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:5px 9px;cursor:pointer;opacity:.78}",
  ".vlv-chip:hover{opacity:1}.vlv-chip.on{opacity:1;border-color:var(--c,rgba(var(--vg-rgb),.5));background:color-mix(in srgb,var(--c,var(--vg)) 18%,transparent);color:var(--vi)}",
  ".vlv-chip.add{color:var(--vle-gold);border-style:dashed}",
  ".vlv-glyph{color:var(--c,var(--vle-gold))}",
  ".vlv-cn{font-size:9px;background:rgba(var(--vg-rgb),.18);color:var(--vle-gold);border-radius:7px;padding:1px 5px}",
  ".vlv-gear{opacity:.5;margin-left:2px}.vlv-gear:hover{opacity:1;color:var(--vle-gold)}",
  ".vlv-grid{display:flex;flex-direction:column;gap:7px}",
  ".vlv-entry{border:1px solid rgba(var(--vg-rgb),.16);border-left:3px solid var(--c,#8c8478);border-radius:0 var(--vr2) var(--vr2) 0;background:rgba(22,20,16,.42);padding:8px 11px}",
  ".vlv-entry.off{opacity:.5}",
  ".vlv-entry-top{display:flex;align-items:center;gap:7px}",
  ".vlv-entry-cat{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;color:var(--c,var(--vi2))}",
  ".vlv-firing{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;color:var(--v-pos-i);background:color-mix(in srgb,var(--v-pos) 18%,transparent);border-radius:var(--vr1);padding:2px 6px}",
  ".vlv-entry-book{font:600 8px/1 var(--vmono);letter-spacing:.3px;color:var(--vi2);opacity:.7;border:1px solid var(--vle-gold-soft);border-radius:var(--vr1);padding:2px 5px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".vlv-entry-ctl{margin-left:auto;display:inline-flex;gap:3px}",
  ".vlv-keys{font:600 10px/1.3 var(--vmono);color:var(--vle-gold);margin-top:5px;opacity:.85}",
  ".vlv-content{font-size:12px;line-height:1.5;color:#cdc3ad;margin-top:4px;white-space:pre-wrap;word-break:break-word}",
  ".vlv-badge{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;color:var(--v-info);margin-top:6px;opacity:.7;display:flex;align-items:center;gap:6px}",
  ".vlv-unlink{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.2);border-radius:5px;padding:2px 6px;cursor:pointer}",
  ".vlv-unlink:hover{color:var(--vle-gold);background:rgba(var(--vg-rgb),.2)}",
  ".vlv-title{font-family:var(--vserif);font-size:15px;color:var(--vi);margin-top:4px}",
  ".vlv-suggest{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 10px;padding:7px 9px;border:1px dashed rgba(var(--vg-rgb),.3);border-radius:9px;background:rgba(var(--vg-rgb),.05)}",
  ".vlv-suggest-h{font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold);opacity:.8}",
  ".vlv-sug{display:inline-flex;align-items:center;gap:5px;font-size:11px;background:rgba(22,20,16,.5);border:1px solid var(--vle-gold-soft);border-radius:20px;padding:3px 5px 3px 9px}",
  ".vlv-sug-l{color:var(--vi)}.vlv-sug-r{font:600 9px/1 var(--vmono);opacity:.5}",
  ".vlv-sug-y,.vlv-sug-n{width:18px;height:18px;display:grid;place-items:center;border-radius:50%;border:none;cursor:pointer;font-size:11px}",
  ".vlv-sug-y{background:color-mix(in srgb,var(--v-pos) 25%,transparent);color:var(--v-pos-i)}.vlv-sug-y:hover{background:color-mix(in srgb,var(--v-pos) 45%,transparent)}",
  ".vlv-sug-n{background:rgba(255,255,255,.06);color:var(--vi2)}.vlv-sug-n:hover{background:color-mix(in srgb,var(--v-neg) 25%,transparent);color:var(--v-neg-i)}",
  ".vlv-bklist{display:flex;flex-direction:column;gap:5px;margin-bottom:4px}",
  ".vlv-bk{display:flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid var(--vle-gold-soft);border-radius:8px;background:rgba(22,20,16,.4)}",
  ".vlv-bk-n{flex:1;font-family:var(--vserif);font-size:14px;color:var(--vi)}",
  ".vlv-bk-tag{font:600 9px/1 var(--vmono);text-transform:uppercase;color:var(--v-info);opacity:.7}",
  ".vlv-bk-ctl{display:inline-flex;align-items:center;gap:5px}",
  ".vlv-bk-att{font:600 9px/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.22);border-radius:6px;padding:4px 8px;cursor:pointer}",
  ".vlv-bk-att.on{color:var(--v-pos-i);border-color:color-mix(in srgb,var(--v-pos) 40%,transparent);background:color-mix(in srgb,var(--v-pos) 16%,transparent)}",
  ".vlv-current{display:flex;align-items:center;gap:8px;margin:0 0 9px;padding:6px 10px;border:1px solid var(--vle-gold-soft);border-radius:8px;background:rgba(var(--vg-rgb),.05)}",
  ".vlv-current-l{font:600 9px/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;opacity:.5}",
  ".vlv-current-n{font-family:var(--vserif);font-size:14px;color:var(--vle-gold);cursor:pointer}",
  ".vlv-current-n:hover{text-decoration:underline}",
  ".vlv-scopebar{display:flex;gap:5px;margin:0 0 8px}",
  ".vlv-scope{flex:1;font:600 9.5px/1 var(--vmono);letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.06);border:1px solid var(--vle-gold-soft);border-radius:8px;padding:7px 10px;cursor:pointer;opacity:.7;display:inline-flex;align-items:center;justify-content:center;gap:6px}",
  ".vlv-scope:hover{opacity:.95}.vlv-scope.on{opacity:1;color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.5);background:rgba(var(--vg-rgb),.16)}",
  ".vlv-pending{margin:0 0 10px;padding:8px 10px;border:1px solid rgba(180,142,208,.34);border-radius:9px;background:rgba(180,142,208,.07)}",
  ".vlv-pending-h{font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--v-warn);display:flex;align-items:center;gap:6px;margin-bottom:6px}",
  ".vlv-pend{border-top:1px solid rgba(180,142,208,.18);padding:6px 0}",
  ".vlv-pend:first-of-type{border-top:none}",
  ".vlv-pend-top{display:flex;align-items:center;gap:7px}",
  ".vlv-pend-n{flex:1;font-family:var(--vserif);font-size:14px;color:var(--vi)}",
  ".vlv-pend-ctl{display:inline-flex;gap:4px}",
  ".vlv-pend-y,.vlv-pend-e,.vlv-pend-n2{width:20px;height:20px;display:grid;place-items:center;border-radius:5px;border:none;cursor:pointer;font-size:11px}",
  ".vlv-pend-y{background:color-mix(in srgb,var(--v-pos) 25%,transparent);color:var(--v-pos-i)}.vlv-pend-y:hover{background:color-mix(in srgb,var(--v-pos) 45%,transparent)}",
  ".vlv-pend-e{background:rgba(var(--vg-rgb),.14);color:var(--vle-gold)}.vlv-pend-e:hover{background:rgba(var(--vg-rgb),.28)}",
  ".vlv-pend-n2{background:rgba(255,255,255,.06);color:var(--vi2)}.vlv-pend-n2:hover{background:color-mix(in srgb,var(--v-neg) 25%,transparent);color:var(--v-neg-i)}",
  ".vlv-pend-c{font-size:11.5px;line-height:1.45;opacity:.75;margin-top:3px}",
  // ---- Customize panel (theme) ----
  ".vle-cz{display:flex;flex-direction:column;gap:7px}",
  ".vle-cz-h{font:600 calc(9.5px * var(--vscale))/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vg);opacity:.7;margin-top:6px}",
  ".vle-cz-row{display:flex;align-items:center;gap:9px}",
  ".vle-cz-color{width:42px;height:34px;padding:0;border:1px solid rgba(var(--vg-rgb),.4);border-radius:9px;background:transparent;cursor:pointer}",
  ".vle-cz-hex{flex:1;font:600 13px/1 var(--vmono);letter-spacing:1px;text-transform:uppercase;color:var(--vi);background:rgba(12,10,8,.6);border:1px solid rgba(var(--vg-rgb),.26);border-radius:8px;padding:9px 11px;outline:none}",
  ".vle-cz-hex:focus{border-color:var(--vg)}",
  ".vle-cz-sel{flex:1;font-family:var(--vserif);font-size:15px;color:var(--vi);background:rgba(12,10,8,.6);border:1px solid rgba(var(--vg-rgb),.26);border-radius:8px;padding:9px 11px;cursor:pointer}",
  ".vle-cz-range{flex:1;accent-color:var(--vg);cursor:pointer}",
  ".vle-cz-sv{flex:none;min-width:48px;text-align:right;font:600 12px/1 var(--vmono);color:var(--vg)}",
  ".vle-skins{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:7px}",
  ".vle-skin{display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px 6px;border:1px solid rgba(var(--vg-rgb),.2);border-radius:11px;background:rgba(var(--vg-rgb),.05);cursor:pointer;transition:border-color .15s,background .15s}",
  ".vle-skin:hover{background:rgba(var(--vg-rgb),.12)}",
  ".vle-skin.on{border-color:var(--sw);background:color-mix(in srgb,var(--sw) 16%,transparent);box-shadow:0 0 10px color-mix(in srgb,var(--sw) 35%,transparent)}",
  ".vle-skin-sw{width:100%;height:14px;border-radius:5px;background:linear-gradient(90deg,var(--sw),color-mix(in srgb,var(--sw) 35%,transparent));box-shadow:0 0 6px color-mix(in srgb,var(--sw) 50%,transparent)}",
  ".vle-skin-n{font:600 9.5px/1.2 var(--vmono);letter-spacing:.3px;text-align:center;color:var(--vi2)}",
  // theme gallery (Mode tab): big cards with a tiny wireframe sketch
  ".vle-modes{display:flex;flex-direction:column;gap:8px}",
  ".vle-mode{display:grid;grid-template-columns:64px 1fr;grid-template-rows:auto auto;gap:2px 12px;align-items:center;text-align:left;padding:11px 13px;border:1px solid rgba(var(--vg-rgb),.2);border-radius:12px;background:rgba(var(--vg-rgb),.05);cursor:pointer;transition:border-color .15s,background .15s}",
  ".vle-mode:hover{background:rgba(var(--vg-rgb),.12)}",
  ".vle-mode.on{border-color:var(--vg);background:rgba(var(--vg-rgb),.16);box-shadow:0 0 12px rgba(var(--vg-rgb),.28)}",
  ".vle-mode-sk{grid-row:1 / 3;width:64px;height:48px;border-radius:6px;border:1px solid rgba(var(--vg-rgb),.35);background:rgba(0,0,0,.25);display:flex;gap:3px;padding:5px;overflow:hidden}",
  ".vle-mode-sk i{background:rgba(var(--vg-rgb),.4);border-radius:2px;display:block}",
  ".vle-mode-sk.sk-default{flex-direction:column;gap:4px}.vle-mode-sk.sk-default i{height:8px}.vle-mode-sk.sk-default i:first-child{height:12px}",
  ".vle-mode-sk.sk-codex i{flex:1}.vle-mode-sk.sk-codex i:first-child{border-right:1px solid rgba(var(--vg-rgb),.5)}",
  ".vle-mode-sk.sk-phone{flex-direction:column;gap:4px}.vle-mode-sk.sk-phone i{height:7px}.vle-mode-sk.sk-phone i:last-child{margin-top:auto;height:9px}",
  ".vle-mode-sk.sk-hud{flex-direction:column;gap:4px}.vle-mode-sk.sk-hud i{height:5px;width:70%}.vle-mode-sk.sk-hud i:last-child{width:45%}",
  ".vle-mode-sk.sk-bloom{flex-direction:column;gap:5px;background:linear-gradient(160deg,#fff4f8,#f0e2ea)}.vle-mode-sk.sk-bloom i{height:8px;border-radius:9px;background:linear-gradient(90deg,rgba(217,140,171,.5),rgba(143,191,127,.45))}.vle-mode-sk.sk-bloom i:first-child{height:11px}",
  ".vle-mode-sk.sk-ember{flex-direction:column;gap:4px;background:radial-gradient(80% 60% at 30% 20%,rgba(184,169,255,.18),transparent),linear-gradient(160deg,#141428,#0a0a18)}.vle-mode-sk.sk-ember i{height:6px;border-radius:5px;background:linear-gradient(90deg,rgba(184,169,255,.55),rgba(143,214,200,.45));box-shadow:0 0 4px rgba(184,169,255,.4)}.vle-mode-sk.sk-ember i:first-child{height:9px}.vle-mode-sk.sk-ember i:last-child{width:60%}",
  ".vle-mode-sk.sk-nocturne{flex-direction:column;gap:5px;padding:8px;background:radial-gradient(circle at 85% 18%,#b9cfee 0 1px,transparent 2px),linear-gradient(145deg,#0c2348,#020817);box-shadow:inset 0 0 0 3px #122d55,inset 0 0 0 4px rgba(185,207,238,.55)}.vle-mode-sk.sk-nocturne i{height:7px;border:1px solid rgba(185,207,238,.42);background:linear-gradient(90deg,rgba(70,109,168,.5),rgba(185,207,238,.14))}.vle-mode-sk.sk-nocturne i:first-child{height:10px}.vle-mode-sk.sk-nocturne i:last-child{width:72%}",

  ".vle-mode-n{font:600 13px/1 var(--vserif);letter-spacing:.5px;color:var(--vi);align-self:end}",
  ".vle-mode-b{font-size:10.5px;line-height:1.4;opacity:.6;align-self:start}",
  // ---- layout picker + dashboard layout modes ----
  ".vle-lays{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:7px}",
  ".vle-lay{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;border:1px solid rgba(var(--vg-rgb),.2);border-radius:11px;background:rgba(var(--vg-rgb),.05);cursor:pointer;color:var(--vi2);transition:border-color .15s,background .15s}",
  ".vle-lay:hover{background:rgba(var(--vg-rgb),.12)}",
  ".vle-lay.on{border-color:var(--vg);background:rgba(var(--vg-rgb),.16);box-shadow:0 0 10px rgba(var(--vg-rgb),.3)}",
  ".vle-lay-g{font-size:20px;color:var(--vg);line-height:1}",
  ".vle-lay-n{font:600 9px/1.2 var(--vmono);letter-spacing:.3px;text-align:center}",
  // dashboard density (scales the section gap + inner padding)
  ".vld-inner{display:flex;flex-direction:column;gap:calc(16px * var(--vscale) * var(--vdensity,1))}",
  ".vld-inner[data-density='compact']{gap:calc(9px * var(--vscale))}",
  ".vld-inner[data-density='compact'] .vld-sec{padding:calc(8px * var(--vscale)) calc(10px * var(--vscale));gap:calc(5px * var(--vscale));border-radius:10px}",
  ".vld-inner[data-density='roomy']{gap:calc(22px * var(--vscale))}",
  ".vld-inner[data-density='roomy'] .vld-sec{padding:calc(16px * var(--vscale)) calc(17px * var(--vscale));gap:calc(11px * var(--vscale))}",
  ".vld-inner[data-density='roomy'] .vld-thought-q,.vld-inner[data-density='roomy'] .vld-rec{font-size:calc(15px * var(--vscale));line-height:1.65}",
  // 2-column (Director) — masonry-ish via CSS columns; collapses under 380px
  ".vld-inner[data-cols='2']{display:block;column-count:2;column-gap:calc(14px * var(--vscale))}",
  ".vld-inner[data-cols='2'] .vld-sec,.vld-inner[data-cols='2'] .vld-fold{break-inside:avoid;margin-bottom:calc(14px * var(--vscale));display:inline-block;width:100%}",
  "@container (max-width:380px){.vld-inner[data-cols='2']{column-count:1}}",
  ".vld-stage,.vlf-body,.vlf-tabbody{container-type:inline-size}",
  // collapsed sections (accordion)
  ".vld-fold{border:1px solid rgba(var(--vg-rgb),.14);border-radius:var(--vr3);background:linear-gradient(168deg,var(--vsurf-1),var(--vsurf-2));overflow:hidden}",
  ".vld-fold>summary{cursor:pointer;list-style:none;padding:calc(9px * var(--vscale)) calc(13px * var(--vscale));font:600 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vg);opacity:.85}",
  ".vld-fold>summary::-webkit-details-marker{display:none}.vld-fold>summary::before{content:'\u25B8 '}",
  ".vld-fold[open]>summary::before{content:'\u25BE '}",
  ".vld-fold[open]>summary{border-bottom:1px solid rgba(var(--vg-rgb),.12)}",
  ".vld-fold-b{padding:calc(10px * var(--vscale)) calc(13px * var(--vscale))}",
  ".vld-fold-b .vld-sec{border:none;background:none;padding:0}",

  // ============ FLOAT FORM FACTORS (chrome-scoped; .vlf only, drawer untouched) ============
  // ---- FANTASY · Codex (illuminated + 2-col): an open book with a center gutter ----
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-cols='2']{position:relative;column-gap:calc(26px * var(--vscale));padding:0 calc(4px * var(--vscale))}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-cols='2']::before{content:'';position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);background:linear-gradient(180deg,transparent,rgba(var(--vg-rgb),.4) 12%,rgba(var(--vg-rgb),.4) 88%,transparent);box-shadow:0 0 10px rgba(var(--vg-rgb),.25);pointer-events:none}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-cols='2']::after{content:'';position:absolute;bottom:0;left:0;right:0;height:18px;background:radial-gradient(60% 100% at 0% 100%,rgba(0,0,0,.22),transparent 70%),radial-gradient(60% 100% at 100% 100%,rgba(0,0,0,.22),transparent 70%);pointer-events:none}",
  // illuminated tension → gilded vine fill
  "html[data-vle-chrome='illuminated'] .vlf .vld-tension{background:rgba(var(--vg-rgb),.1)}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-tension-f{background:repeating-linear-gradient(90deg,var(--vg) 0 5px,rgba(var(--vg-rgb),.5) 5px 10px)!important;box-shadow:0 0 8px rgba(var(--vg-rgb),.45)}",
  // ---- FANTASY · Scroll (illuminated + 1-col 'scroll' layout): unfurled parchment ----
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-layout='scroll']{-webkit-mask-image:linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent)}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-layout='scroll'] .vld-sec{border:none;background:none;padding-left:calc(6px * var(--vscale));padding-right:calc(6px * var(--vscale))}",
  "html[data-vle-chrome='illuminated'] .vlf .vld-inner[data-layout='scroll'] .vld-sec+.vld-sec{border-top:1px dotted rgba(var(--vg-rgb),.4);margin-top:calc(10px * var(--vscale));padding-top:calc(12px * var(--vscale))}",

  // ---- MODERN · Phone (modern chrome + 'switch' layout): a device ----
  "html[data-vle-chrome='modern'] .vlf .vld-phone{display:flex;flex-direction:column;min-height:100%;max-width:440px;margin:0 auto}",
  ".vld-phone-body{flex:1;display:flex;flex-direction:column;gap:calc(8px * var(--vscale));padding-bottom:calc(8px * var(--vscale))}",
  // bottom dock — app-style section switcher
  ".vld-dock{position:sticky;bottom:0;display:flex;gap:2px;justify-content:space-around;padding:6px 4px;margin-top:auto;background:linear-gradient(180deg,transparent,var(--vsurf-2));backdrop-filter:blur(6px);border-top:1px solid rgba(var(--vg-rgb),.16)}",
  ".vld-dock-b{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:0;border-radius:10px;padding:6px 2px;cursor:pointer;color:var(--vi2);opacity:.6;transition:opacity .15s,background .15s}",
  ".vld-dock-b:hover{opacity:.9}",
  ".vld-dock-b.on{opacity:1;color:var(--vg);background:rgba(var(--vg-rgb),.14)}",
  ".vld-dock-g{font-size:calc(15px * var(--vscale));line-height:1}",
  ".vld-dock-l{font:600 7.5px/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase}",
  // modern present-cast → notification cards
  "html[data-vle-chrome='modern'] .vlf .vld-pc{border:none;border-radius:14px;background:rgba(255,255,255,.05);box-shadow:0 1px 3px rgba(0,0,0,.25)}",
  // phone status strip (status section as the 'lock screen' header)
  "html[data-vle-chrome='modern'] .vlf .vld-phone .vld-statbar{justify-content:center;gap:14px}",

  // ---- FUTURISTIC · Oracle HUD (futuristic chrome): tactical telemetry ----
  "html[data-vle-chrome='futuristic'] .vlf .vld-sec{border:none;background:none;border-left:2px solid rgba(var(--vg-rgb),.5);border-radius:0;padding-left:calc(10px * var(--vscale))}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-h{position:relative;padding-left:14px}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-h::before{content:'\u25B7';position:absolute;left:0;color:var(--vg);font-size:9px;top:1px}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-pc{border:none;border-radius:0;border-left:2px solid rgba(var(--vg-rgb),.45);background:linear-gradient(90deg,rgba(var(--vg-rgb),.06),transparent)}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-loc{font-family:var(--vmono);letter-spacing:1px;text-transform:uppercase}",
  "html[data-vle-chrome='futuristic'] .vlf .vld-thread-s,html[data-vle-chrome='futuristic'] .vlf .vld-rel-s{font-family:var(--vmono);text-transform:uppercase;letter-spacing:.5px}",
  // HUD system footer (recall mode + injection chars), rendered by dashboard
  ".vld-sysfoot{margin-top:calc(10px * var(--vscale));padding-top:8px;border-top:1px solid rgba(var(--vg-rgb),.25);font:600 8.5px/1.4 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vg);opacity:.7;display:flex;gap:14px;flex-wrap:wrap}",
  "html:not([data-vle-chrome='futuristic']) .vlf .vld-sysfoot{display:none}",

  // ---- Customize panel: tabs, sliders, reset, custom-layout editor ----
  ".vle-czt-bar{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:10px;border-bottom:1px solid rgba(var(--vg-rgb),.18);padding-bottom:8px}",
  ".vle-czt{font:600 9.5px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vi2);background:transparent;border:1px solid transparent;border-radius:7px;padding:6px 10px;cursor:pointer;opacity:.7}",
  ".vle-czt:hover{opacity:1}.vle-czt.on{opacity:1;color:var(--vg);background:rgba(var(--vg-rgb),.14);border-color:rgba(var(--vg-rgb),.35)}",
  // 'advanced' divider in the customize tab strip (separates Look from the cockpit)
  ".vle-czt-sep{align-self:center;font:600 8px/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vi2);opacity:.4;padding:0 4px 0 8px;margin-left:4px;border-left:1px solid rgba(var(--vg-rgb),.2)}",
  ".vle-cz-rst{margin-left:auto;cursor:pointer;opacity:.5;font-size:13px}.vle-cz-rst:hover{opacity:1;color:var(--vg)}",
  ".vle-cz-h{display:flex;align-items:center}",
  ".vle-cz-btn{font:600 9.5px/1 var(--vmono);letter-spacing:.4px;text-transform:uppercase;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.24);border-radius:8px;padding:7px 11px;cursor:pointer}",
  ".vle-cz-btn:hover{background:rgba(var(--vg-rgb),.2);color:var(--vg)}",
  ".vle-cz-btn.danger:hover{color:#e09090;border-color:rgba(201,106,106,.4);background:rgba(201,106,106,.1)}",
  ".vle-cz-chk{display:inline-flex;align-items:center;gap:6px;font:500 12px/1 var(--vmono);color:var(--vi2);cursor:pointer}",
  ".vle-cz-chk input{accent-color:var(--vg);cursor:pointer}",
  ".vle-cz-mini{font:600 9px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;opacity:.6}",
  ".vle-cz-note{font-size:11px;line-height:1.5;opacity:.6;padding:4px 0}",
  // custom layout editor
  ".vle-clays{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}",
  ".vle-clr{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid rgba(var(--vg-rgb),.16);border-radius:8px;background:rgba(var(--vg-rgb),.05)}",
  ".vle-clr.off{opacity:.5}",
  ".vle-clr-up,.vle-clr-dn{cursor:pointer;color:var(--vg);opacity:.7;font-size:12px;width:16px;text-align:center}",
  ".vle-clr-up:hover,.vle-clr-dn:hover{opacity:1}.vle-clr-up[data-dis],.vle-clr-dn[data-dis]{opacity:.2;pointer-events:none}",
  ".vle-clr-n{flex:1;font-family:var(--vserif);font-size:14px;color:var(--vi)}",
  ".vle-clr-b{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px;color:var(--vi2);background:rgba(var(--vg-rgb),.08);border:1px solid rgba(var(--vg-rgb),.2);border-radius:6px;padding:4px 7px;cursor:pointer}",
  ".vle-clr-b.on{color:var(--vg);border-color:rgba(var(--vg-rgb),.45);background:rgba(var(--vg-rgb),.18)}",
  // controller-traversal trace (flat + tree drill)
  ".vle-inj-trace{margin:4px 0 2px;padding:6px 8px;border-left:2px solid rgba(var(--vg-rgb),.35);background:rgba(var(--vg-rgb),.05);border-radius:0 6px 6px 0;font:500 10px/1.5 var(--vmono)}",
  ".vle-inj-scene{color:var(--vle-dim);font-style:italic;margin-bottom:4px}",
  ".vle-inj-cands{color:var(--vle-dim);margin-top:3px}",
  ".vle-inj-cand{display:inline-block;margin:2px 4px 0 0;padding:1px 5px;border-radius:3px;border:1px solid rgba(255,255,255,.12);color:var(--vle-dim);font-size:9px}",
  ".vle-inj-cand.on{color:var(--vle-gold);border-color:rgba(var(--vg-rgb),.5);background:rgba(var(--vg-rgb),.12)}",
  ".vle-inj-cand.exp{color:#8fb0c9;border-color:rgba(143,176,201,.4)}",
  ".vle-inj-step{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:3px 0;border-top:1px dashed rgba(255,255,255,.08)}",
  ".vle-inj-stepn{color:var(--vle-gold);font-weight:600;margin-right:4px}",
  ".vle-inj-stepf{color:var(--vle-dim);margin-right:6px;font-size:9px}",
  ".vle-inj-tree{border-left-color:rgba(var(--vg-rgb),.5)}",
  // keyboard focus ring (a11y): one rule for the whole shell + graph nodes
  ".vle-root :focus-visible,.vlf :focus-visible,.vlfm :focus-visible{outline:2px solid var(--vg);outline-offset:2px;border-radius:var(--vr1)}",
  ".vlf-launch:focus-visible{outline:2px solid var(--vg);outline-offset:2px}",
  ".vlg-node:focus-visible{outline:none}.vlg-node:focus-visible .vlg-node-c{stroke:var(--vg);stroke-width:3.4}.vlg-node:focus-visible .vlg-node-l{opacity:1}",
  // factions
  ".vle-sec-title{font:600 11px/1 var(--vmono);letter-spacing:.5px;text-transform:uppercase;color:var(--vle-gold);opacity:.85;margin-right:auto}",
  ".vle-sec-gap{margin-top:14px}",
  ".vle-fac-av{background:rgba(var(--vg-rgb),.16);color:var(--vle-gold)}",
  ".vle-fac-stand{font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.4px}",
  ".vle-fac-stand.warm{color:var(--v-pos-i)}", ".vle-fac-stand.cool{color:var(--v-neg-i)}", ".vle-fac-stand.neu{color:var(--vle-dim)}",
  ".vle-fac-meter{display:block;flex:1;max-width:160px}",
  ".vle-fac-standrow{display:flex;align-items:center;gap:10px;margin-top:6px}",
  ".vle-fac-standrow .vle-fac-stand{flex:none}",
  ".vle-fac-standrow .vle-bar-l{display:none}",
  ".vle-fac-mems{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}",
  ".vle-fac-mem{display:inline-flex;align-items:center;gap:3px;font:500 9px/1.4 var(--vmono);padding:2px 4px;border-radius:var(--vr1);border:1px solid rgba(255,255,255,.12);color:var(--vle-dim)}",
  ".vle-fac-x{background:none;border:0;color:var(--vle-dim);cursor:pointer;font-size:11px;line-height:1;padding:0 0 0 2px;opacity:.6}",
  ".vle-fac-x:hover{opacity:1;color:var(--v-neg-i)}",
  ".vle-fac-more{font:500 9px/1.4 var(--vmono);color:var(--vle-dim);opacity:.7}",
  ".vle-dim{opacity:.6}",
  // status-on-avatar: cards self-describe presence (signal lands where the eye does)
  ".vle-card--present .vle-av{box-shadow:0 0 0 2px var(--vg),0 0 9px rgba(var(--vg-rgb),.5)}",
  ".vle-card--active .vle-av{box-shadow:0 0 0 2px rgba(var(--vg-rgb),.45)}",
  ".vle-card--mentioned .vle-av{box-shadow:inset 0 0 0 1px rgba(var(--vg-rgb),.3);opacity:.8}",
  ".vle-card--added .vle-av{opacity:.55}",
  ".vle-card--mentioned,.vle-card--added{opacity:.92}",

  // ================= THEME: MODERN ("The App") — float + drawer =================
  // Calm, flat, sans, rounded. Drawer (.vle-root) gets equal treatment to the float.
  "html[data-vle-chrome='modern'] .vle-root{font-family:var(--vserif)}",
  // head → app title, no glow; tab bar → flat pills with an accent underline
  "html[data-vle-chrome='modern'] .vle-head{border-bottom:none;font-weight:700;letter-spacing:0}",
  "html[data-vle-chrome='modern'] .vle-mark{text-shadow:none}",
  "html[data-vle-chrome='modern'] .vle-tabbtn{border-radius:var(--rpill);text-transform:none;letter-spacing:.2px;font-family:var(--vserif);font-size:calc(13px * var(--vscale));font-weight:600}",
  "html[data-vle-chrome='modern'] .vle-tabbtn.on{background:color-mix(in srgb,var(--vg) 16%,transparent);border-color:transparent;position:relative}",
  "html[data-vle-chrome='modern'] .vle-tabbtn.on::after{content:'';position:absolute;left:18%;right:18%;bottom:-3px;height:2px;border-radius:2px;background:var(--vg);transition:left .2s,right .2s}",
  // cards → soft, rounded, flat shadow (no gold hairline shouting)
  "html[data-vle-chrome='modern'] .vle-card,html[data-vle-chrome='modern'] .vle-rel-card{border-color:color-mix(in srgb,var(--vg) 10%,transparent);border-radius:18px;box-shadow:0 1px 3px rgba(0,0,0,.25)}",
  // hero scene + soft top glow (recolor the bloom to the cool accent)
  "html[data-vle-chrome='modern'] .vlf-frame::after{background:radial-gradient(120% 80% at 50% -20%,rgba(var(--vg-rgb),.16),transparent 70%)}",
  // === MODERN = a continuous card-app scroll (no chopped one-section switch) ===
  // sections are TRANSPARENT groups; the label floats above; only the items are
  // cards. This is what fixes the 'disjointed boxes' look.
  "html[data-vle-chrome='modern'] .vld{gap:calc(20px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-inner{display:flex;flex-direction:column;gap:calc(20px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-sec{border:none!important;background:none!important;box-shadow:none!important;padding:0!important;gap:calc(10px * var(--vscale))}",
  // section label = a quiet heading above the group (not a chip inside a box)
  "html[data-vle-chrome='modern'] .vld-h{font:700 calc(16px * var(--vscale))/1.2 var(--vserif);letter-spacing:0;text-transform:none;color:var(--vi);opacity:1;padding:0 calc(4px * var(--vscale));margin-bottom:calc(2px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-h::before{display:none!important}",
  "html[data-vle-chrome='modern'] .vld-n{font:700 calc(13px * var(--vscale))/1 var(--vserif);color:var(--vg);background:none;padding:0;margin-left:6px}",
  // the HERO is itself a real card (the only section that is a box)
  "html[data-vle-chrome='modern'] .vld-sec--hero{position:relative;background:linear-gradient(180deg,color-mix(in srgb,var(--vi) 6%,transparent),color-mix(in srgb,var(--vi) 3%,transparent))!important;border:1px solid color-mix(in srgb,var(--vg) 12%,transparent)!important;border-radius:22px!important;box-shadow:0 1px 3px rgba(0,0,0,.25)!important;padding:calc(16px * var(--vscale)) calc(18px * var(--vscale))!important}",
  "html[data-vle-chrome='modern'] .vld-hero-eyebrow{font:700 calc(10.5px * var(--vscale))/1 var(--vmono);letter-spacing:1.5px;text-transform:uppercase;color:var(--vi2);opacity:.7;margin-bottom:calc(8px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-sec--hero .vld-hero{font-weight:700;letter-spacing:-.3px;font-size:calc(23px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-sec--hero .vld-hero::before{display:none}",
  "html[data-vle-chrome='modern'] .vld-meta{margin-top:calc(6px * var(--vscale));opacity:.8}",
  // tension pill, top-right of the hero card
  "html[data-vle-chrome='modern'] .vld-hero-tension{position:absolute;top:calc(16px * var(--vscale));right:calc(16px * var(--vscale));display:inline-flex;align-items:center;gap:6px;font:600 calc(12px * var(--vscale))/1 var(--vserif);color:var(--v-press-i);background:color-mix(in srgb,var(--v-press) 16%,transparent);border-radius:var(--rpill);padding:6px 11px}",
  "html[data-vle-chrome='modern'] .vld-hero-tdot{width:6px;height:6px;border-radius:50%;background:var(--v-press)}",
  // present cast → notification cards; avatars fully round with presence ring
  "html[data-vle-chrome='modern'] .vld-pc{border:none;border-radius:18px;background:color-mix(in srgb,var(--vi) 5%,transparent);box-shadow:0 1px 3px rgba(0,0,0,.22);padding:calc(13px * var(--vscale)) calc(15px * var(--vscale))}",
  "html[data-vle-chrome='modern'] .vld-pc+.vld-pc{margin-top:calc(10px * var(--vscale))}",
  // relation 'spotlight' rows → a rounded card each
  "html[data-vle-chrome='modern'] .vld-rel{border-radius:18px;background:color-mix(in srgb,var(--vi) 5%,transparent);box-shadow:0 1px 3px rgba(0,0,0,.22);padding:calc(13px * var(--vscale)) calc(15px * var(--vscale));margin:0}",
  "html[data-vle-chrome='modern'] .vld-rel+.vle-bm{margin:calc(-4px * var(--vscale)) 0 calc(10px * var(--vscale));padding:0 calc(15px * var(--vscale))}",
  // threads + parallel → soft pill rows
  "html[data-vle-chrome='modern'] .vld-thread,html[data-vle-chrome='modern'] .vld-par{border-radius:14px;background:color-mix(in srgb,var(--vi) 4%,transparent);padding:calc(10px * var(--vscale)) calc(13px * var(--vscale));margin-bottom:calc(7px * var(--vscale))}",
  // 'Latest' → a real activity feed: a connector line + colored nodes
  "html[data-vle-chrome='modern'] .vld-sec--recent,html[data-vle-chrome='modern'] .vld-rec{position:relative}",
  "html[data-vle-chrome='modern'] .vld-rec{margin-left:calc(7px * var(--vscale));padding:calc(2px * var(--vscale)) 0 calc(12px * var(--vscale)) calc(18px * var(--vscale));border-left:2px solid color-mix(in srgb,var(--vg) 18%,transparent)}",
  "html[data-vle-chrome='modern'] .vld-rec:last-child{border-left-color:transparent;padding-bottom:0}",
  "html[data-vle-chrome='modern'] .vld-rec::before{content:'';position:absolute;left:-6px;top:calc(3px * var(--vscale));width:10px;height:10px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px var(--vsurf-1)}",
  "html[data-vle-chrome='modern'] .vld-rec--journal::before{color:var(--v-pos-i)}html[data-vle-chrome='modern'] .vld-rec--knew::before{color:var(--v-info)}html[data-vle-chrome='modern'] .vld-rec--secret::before{color:var(--v-neg-i)}html[data-vle-chrome='modern'] .vld-rec--shift::before{color:var(--v-press-i)}",
  "html[data-vle-chrome='modern'] .vld-rec-k{display:block;font:700 calc(10px * var(--vscale))/1 var(--vmono);letter-spacing:.6px;text-transform:uppercase;color:var(--vi2);opacity:.7;margin-bottom:3px}",
  // twin meters fully rounded + a touch taller in modern
  "html[data-vle-chrome='modern'] .vle-tw-t{height:9px;border-radius:6px}",
  // float frame already flat (existing rules); round the drawer launcher too
  "html[data-vle-chrome='modern'] .vlf-title{font-weight:700}",
  // bond meter theme skins (shared layout, themed material)
  "html[data-vle-chrome='modern'] .vle-bm .vle-tw-t{height:10px;border-radius:6px}",
  "html[data-vle-chrome='illuminated'] .vle-bm-axl{color:var(--v-neg-i);font-variant:small-caps;letter-spacing:1.5px;opacity:.8}",
  "html[data-vle-chrome='illuminated'] .vle-bm .vle-tw-f.tw-aff{background:linear-gradient(90deg,color-mix(in srgb,var(--vg) 50%,transparent),var(--vg))}",
  // present-card avatar theme skins (shared structure, themed material)
  "html[data-vle-chrome='illuminated'] .vld-pc-av{border-radius:50%;background:radial-gradient(40% 35% at 40% 35%,#b8403a,#6e1f1c);border-color:#4a1513;color:#f0c4c0}",
  "html[data-vle-chrome='modern'] .vld-pc-av{border-width:2px}",
  "html[data-vle-chrome='futuristic'] .vld-pc-av{background:transparent;border:1.5px solid var(--vg);box-shadow:0 0 8px rgba(var(--vg-rgb),.4);border-radius:50%;color:var(--vg);position:relative}",
  "html[data-vle-chrome='futuristic'] .vld-pc-av::before{content:'';position:absolute;left:-3px;right:-3px;top:50%;height:1px;background:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vld-pc-av::after{content:'';position:absolute;top:-3px;bottom:-3px;left:50%;width:1px;background:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vld-pc-n{font-family:var(--vmono);text-transform:uppercase;letter-spacing:1px;font-size:calc(14px * var(--vscale))}",
  "html[data-vle-chrome='futuristic'] .vld-thought-q,html[data-vle-chrome='futuristic'] .vld-pc-status{font-family:var(--vmono);font-style:normal}",

  // ================= THEME: FANTASY ("The Codex") — float + drawer =================
  // Deepens the illuminated chrome. Float keeps BOTH Codex (2-col) + Scroll (1-col)
  // forms (rules above); these add ornament, drop-caps, rubrics, heraldry, seal.
  // --- drop-cap on the hero scene line (float dashboard + drawer Now share it) ---
  "html[data-vle-chrome='illuminated'] .vld-hero::before{content:none}",
  "html[data-vle-chrome='illuminated'] .vld-hero::first-letter{font-size:2.6em;line-height:.8;float:left;margin:4px 8px 0 0;padding:4px 8px;color:var(--v-neg-i);background:color-mix(in srgb,var(--v-neg) 14%,transparent);border:1px solid color-mix(in srgb,var(--v-neg) 30%,transparent);border-radius:var(--vr1);font-family:'Cinzel',var(--vserif);font-style:normal}",
  // --- rubric section eyebrows: small-caps, red, hairline rule + fleurons ---
  "html[data-vle-chrome='illuminated'] .vld-h,html[data-vle-chrome='illuminated'] .vle-sec-h{color:var(--v-neg-i);font-variant:small-caps;letter-spacing:2px}",
  "html[data-vle-chrome='illuminated'] .vld-h::before,html[data-vle-chrome='illuminated'] .vle-sec-h::before{content:'\\2766 ';opacity:.7}",
  // --- portrait medallions: present-cast avatars round, double-gilt, haloed ---
  "html[data-vle-chrome='illuminated'] .vle-av{border-radius:50%;box-shadow:0 0 0 1px rgba(var(--vg-rgb),.6),0 0 0 4px rgba(0,0,0,.25),0 0 0 5px rgba(var(--vg-rgb),.3)}",
  "html[data-vle-chrome='illuminated'] .vle-card--present .vle-av{box-shadow:0 0 0 2px var(--vg),0 0 0 5px rgba(var(--vg-rgb),.35),0 0 12px rgba(var(--vg-rgb),.5)}",
  // --- heraldic bond card: split-shield tint + gilded base ---
  "html[data-vle-chrome='illuminated'] .vle-rel-card{background:linear-gradient(180deg,rgba(var(--vg-rgb),.07),transparent 60%),var(--vsurf-1);border-color:rgba(var(--vg-rgb),.35);border-bottom-width:2px;position:relative}",
  "html[data-vle-chrome='illuminated'] .vle-rel-pair{font-variant:small-caps;letter-spacing:1px}",
  // --- wax-seal close button (float only; the drawer has no frame) ---
  "html[data-vle-chrome='illuminated'] .vlf-x{border-radius:50%;background:radial-gradient(40% 35% at 40% 35%,#b8403a,#6e1f1c);border:1px solid #4a1513;color:#f0c4c0;box-shadow:0 2px 6px rgba(0,0,0,.5),inset 0 1px 2px rgba(255,200,190,.3);text-shadow:0 1px 1px rgba(0,0,0,.5)}",
  "html[data-vle-chrome='illuminated'] .vlf-x:hover{background:radial-gradient(40% 35% at 40% 35%,#c84a44,#7e2622);color:#ffd8d2;border-color:#4a1513}",
  // --- drawer 'binding': a gilt top rule + parchment already via texture default ---
  "html[data-vle-chrome='illuminated'] .vlf-title{font-family:var(--vserif);font-style:italic;letter-spacing:1px}",
  "html[data-vle-chrome='illuminated'] .vle-head{border-bottom:2px solid rgba(var(--vg-rgb),.3);box-shadow:0 1px 0 rgba(var(--vg-rgb),.15);font-family:var(--vserif);font-style:italic}",
  "html[data-vle-chrome='illuminated'] .vle-stats{font-family:var(--vserif);font-style:italic;font-variant:small-caps;letter-spacing:1px;text-transform:lowercase;opacity:.7}",
  "html[data-vle-chrome='modern'] .vle-stats{font-family:var(--vserif);font-weight:600;letter-spacing:0;opacity:.65}",
  // --- ribbon-bookmark tabs (both surfaces' nav): notched bottom ---
  "html[data-vle-chrome='illuminated'] .vle-tabbtn.on{border-radius:3px 3px 0 0;position:relative}",
  "html[data-vle-chrome='illuminated'] .vle-tabbtn.on::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:0;border-left:5px solid transparent;border-right:5px solid transparent}",
  // --- corner flourishes on the float frame (additive to the existing double-rule) ---
  "html[data-vle-chrome='illuminated'] .vlf-bar::before{content:'\\2766';position:absolute;left:calc(16px * var(--vscale));top:50%;transform:translateY(-50%);color:var(--vg);opacity:.4;font-size:11px;pointer-events:none}",

  // ================= THEME: FUTURISTIC ("Oracle HUD") — float + drawer =================
  // Deepens the futuristic chrome (sharp corners/edge-glow/mono caps already exist).
  // grid void backdrop on both roots
  "html[data-vle-chrome='futuristic'] .vle-root{background-image:linear-gradient(rgba(var(--vg-rgb),.05) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--vg-rgb),.05) 1px,transparent 1px);background-size:22px 22px}",
  // drawer head → telemetry bar
  "html[data-vle-chrome='futuristic'] .vle-head{font-family:'Orbitron',var(--vmono);text-transform:uppercase;letter-spacing:3px;border-bottom:1px solid rgba(var(--vg-rgb),.4);font-size:calc(16px * var(--vscale))}",
  "html[data-vle-chrome='futuristic'] .vle-head::before{content:'\\25E4 ';color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-stats{color:var(--vg);opacity:.8}",
  // tab bar → segmented HUD buttons with bracket corners
  "html[data-vle-chrome='futuristic'] .vle-tabbtn{border-radius:0;border-color:rgba(var(--vg-rgb),.25);letter-spacing:2px}",
  "html[data-vle-chrome='futuristic'] .vle-tabbtn.on{border-color:var(--vg);box-shadow:inset 0 0 0 1px rgba(var(--vg-rgb),.4),0 0 10px rgba(var(--vg-rgb),.25);background:rgba(var(--vg-rgb),.12)}",
  "html[data-vle-chrome='futuristic'] .vle-tabbtn.on::before{content:'\\25B7 '}",
  // cards → bracketed, sharp, edge-lit
  "html[data-vle-chrome='futuristic'] .vle-card,html[data-vle-chrome='futuristic'] .vld-sec,html[data-vle-chrome='futuristic'] .vle-rel-card{border-radius:0;border-color:rgba(var(--vg-rgb),.3);border-left:2px solid var(--vg);background:linear-gradient(90deg,rgba(var(--vg-rgb),.06),transparent)}",
  "html[data-vle-chrome='futuristic'] .vld-h{font-family:var(--vmono);text-transform:uppercase;letter-spacing:2px}",
  "html[data-vle-chrome='futuristic'] .vld-h::before{content:'\\25B7 ';color:var(--vg);font-size:9px}",
  // hero → mono caps telemetry
  "html[data-vle-chrome='futuristic'] .vlf-title{font-family:'Orbitron',var(--vmono)}",
  "html[data-vle-chrome='futuristic'] .vld-hero{font-family:'Orbitron',var(--vmono);text-transform:uppercase;letter-spacing:1px;font-size:calc(20px * var(--vscale));text-shadow:0 0 8px rgba(var(--vg-rgb),.4)}",
  "html[data-vle-chrome='futuristic'] .vld-hero::before{content:'\\25B7 '}",
  // targeting-reticle avatars: transparent center, crosshair ticks, ring
  "html[data-vle-chrome='futuristic'] .vle-av{border-radius:50%;background:transparent;border:1.5px solid var(--vg);box-shadow:0 0 8px rgba(var(--vg-rgb),.4),inset 0 0 6px rgba(var(--vg-rgb),.2);position:relative;color:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-av::before,html[data-vle-chrome='futuristic'] .vle-av::after{content:'';position:absolute;background:var(--vg)}",
  "html[data-vle-chrome='futuristic'] .vle-av::before{left:-3px;right:-3px;top:50%;height:1px}",
  "html[data-vle-chrome='futuristic'] .vle-av::after{top:-3px;bottom:-3px;left:50%;width:1px}",
  // tension → segmented notched amber→red bar (dots become ticks)
  "html[data-vle-chrome='futuristic'] .vld-dot{border-radius:0;width:100%;height:10px;flex:1}",
  "html[data-vle-chrome='futuristic'] .vld-dot.on{background:linear-gradient(180deg,var(--v-press),var(--v-neg));box-shadow:0 0 6px rgba(var(--vg-rgb),.4)}",
  // scanline shimmer over the float body (motion-gated by the global kill-switch)
  "html[data-vle-chrome='futuristic'] .vlf-body::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,transparent 0 3px,rgba(var(--vg-rgb),.025) 3px 4px);z-index:2}",
  "html[data-vle-chrome='futuristic'] .vlf-body{position:relative}",
  // Phase 5.1: the HUD signature also asserts on the DRAWER (surface-independent,
  // skin-independent) — scanlines over the body so 'Futuristic' always reads HUD.
  "html[data-vle-chrome='futuristic'] .vle-body{position:relative}",
  "html[data-vle-chrome='futuristic'] .vle-body::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,transparent 0 3px,rgba(var(--vg-rgb),.022) 3px 4px);z-index:0}",
  "html[data-vle-chrome='futuristic'] .vle-body>*{position:relative;z-index:1}",
  // bond radar block
  ".vle-radar{display:block;margin:8px auto 4px;max-width:240px}",
  ".vle-radar-ring{fill:none;stroke:rgba(var(--vg-rgb),.2)}",
  ".vle-radar-axis{stroke:rgba(var(--vg-rgb),.3)}",
  ".vle-radar-axl{fill:var(--vg);font:600 7px/1 var(--vmono);letter-spacing:.5px;opacity:.7}",
  ".vle-radar-a{fill:color-mix(in srgb,var(--v-info) 22%,transparent);stroke:var(--v-info);stroke-width:1.5}",
  ".vle-radar-b{fill:color-mix(in srgb,var(--v-warn) 18%,transparent);stroke:var(--v-warn);stroke-width:1.5}",
  ".vle-radar-dot{fill:var(--vi)}",
  ".vle-radar-leg{display:flex;justify-content:center;gap:14px;font:600 9px/1 var(--vmono);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}",
  ".vle-radar-leg i{font-style:normal;opacity:.7}",

  // ================= THEME: BLOOM ("Pressed-Flower Garden") — float + drawer =================
  // A soft, cozy, romantic pastel look (blush pink + sage). Light surfaces, rounded
  // everything, dashed lace rules, fleuron dividers, petal accents. All chrome-scoped
  // so it re-skins BOTH the floating window (.vlf) and the drawer (.vle-root).
  // --- shared: warm the whole surface with a faint blush→sage wash + petals ---
  "html[data-vle-chrome='bloom'] .vle-root{font-family:var(--vserif);background-image:radial-gradient(120% 90% at 0% 0%,rgba(var(--vg-rgb),.08),transparent 55%),radial-gradient(120% 90% at 100% 100%,rgba(var(--vg2-rgb),.08),transparent 55%)}",
  "html[data-vle-chrome='bloom'] .vlf-body{background-image:radial-gradient(120% 80% at 0% 0%,rgba(var(--vg-rgb),.06),transparent 55%),radial-gradient(120% 80% at 100% 100%,rgba(var(--vg2-rgb),.06),transparent 55%)}",
  // --- drawer head → a lace-hemmed garland with a script title + bloom mark ---
  "html[data-vle-chrome='bloom'] .vle-head{font-family:var(--vserif);font-style:italic;font-weight:600;letter-spacing:.5px;border-bottom:1.5px dashed color-mix(in srgb,var(--vg) 34%,transparent)}",
  "html[data-vle-chrome='bloom'] .vle-mark{text-shadow:0 0 10px rgba(var(--vg-rgb),.45)}",
  "html[data-vle-chrome='bloom'] .vle-mark::after{content:'\\2740';margin-left:6px;color:var(--vg2);opacity:.7;font-size:.8em}",
  "html[data-vle-chrome='bloom'] .vle-stats{font-family:var(--vserif);font-style:italic;font-variant:small-caps;letter-spacing:1px;text-transform:lowercase;opacity:.7}",
  // --- tab bar → soft rounded petal-pills with a two-tone active bloom ---
  "html[data-vle-chrome='bloom'] .vle-tabbtn{border-radius:var(--rpill);text-transform:none;letter-spacing:.3px;font-family:var(--vserif);font-size:calc(13px * var(--vscale));font-weight:600}",
  "html[data-vle-chrome='bloom'] .vle-tabbtn:hover{background:color-mix(in srgb,var(--vg) 10%,transparent)}",
  "html[data-vle-chrome='bloom'] .vle-tabbtn.on{color:var(--vg);border-color:transparent;background:linear-gradient(120deg,color-mix(in srgb,var(--vg) 18%,transparent),color-mix(in srgb,var(--vg2) 16%,transparent))}",
  "html[data-vle-chrome='bloom'] .vle-tabicon.on{color:var(--vg);border-color:color-mix(in srgb,var(--vg) 40%,transparent);background:color-mix(in srgb,var(--vg) 14%,transparent)}",
  // --- cards → pillowy, light, softly shadowed; hairlines become blush ---
  "html[data-vle-chrome='bloom'] .vle-card,html[data-vle-chrome='bloom'] .vle-rel-card,html[data-vle-chrome='bloom'] .vld-sec,html[data-vle-chrome='bloom'] .vld-pc{border-radius:18px;border-color:color-mix(in srgb,var(--vg) 20%,transparent);box-shadow:0 2px 10px rgba(180,120,150,.14)}",
  // --- section eyebrows → romantic script small-caps with a fleuron ---
  "html[data-vle-chrome='bloom'] .vld-h,html[data-vle-chrome='bloom'] .vle-sec-h{font-family:var(--vserif);font-style:italic;font-variant:small-caps;letter-spacing:1.5px;color:var(--vg);text-transform:none}",
  "html[data-vle-chrome='bloom'] .vld-h::before,html[data-vle-chrome='bloom'] .vle-sec-h::before{content:'\\2740 ';color:var(--vg2);opacity:.75}",
  // --- hero scene line → dreamy italic serif with a soft rosy glow ---
  "html[data-vle-chrome='bloom'] .vld-hero{font-family:var(--vserif);font-style:italic;font-weight:600;letter-spacing:.2px;text-shadow:0 1px 10px rgba(var(--vg-rgb),.3)}",
  "html[data-vle-chrome='bloom'] .vld-hero::before{content:'\\275B ';color:var(--vg2);opacity:.6;font-style:normal}",
  "html[data-vle-chrome='bloom'] .vld-sec--hero{background:linear-gradient(160deg,color-mix(in srgb,var(--vg) 10%,transparent),color-mix(in srgb,var(--vg2) 8%,transparent))!important;border-color:color-mix(in srgb,var(--vg) 22%,transparent)!important;border-radius:22px!important}",
  // --- tension → soft rounded pink→sage dots (calm, not alarming) ---
  "html[data-vle-chrome='bloom'] .vld-dot{border-radius:50%}",
  "html[data-vle-chrome='bloom'] .vld-dot.on{background:linear-gradient(120deg,var(--vg),var(--vg2));box-shadow:0 0 6px rgba(var(--vg-rgb),.4)}",
  // --- avatars → soft-ringed flower medallions with a petal halo when present ---
  "html[data-vle-chrome='bloom'] .vle-av,html[data-vle-chrome='bloom'] .vld-pc-av{border-radius:50%;background:radial-gradient(60% 55% at 40% 35%,color-mix(in srgb,var(--vg) 30%,transparent),color-mix(in srgb,var(--vg2) 22%,transparent));border:2px solid color-mix(in srgb,var(--vg) 45%,transparent);color:var(--vi)}",
  "html[data-vle-chrome='bloom'] .vle-card--present .vle-av{box-shadow:0 0 0 2px var(--vg),0 0 0 5px rgba(var(--vg-rgb),.22),0 0 12px rgba(var(--vg-rgb),.4)}",
  // --- twin bond meters → fully rounded, pink (affection) & sage (trust) ---
  "html[data-vle-chrome='bloom'] .vle-tw-t{height:9px;border-radius:6px}",
  "html[data-vle-chrome='bloom'] .vle-bm .vle-tw-f.tw-aff{background:linear-gradient(90deg,color-mix(in srgb,var(--vg) 55%,transparent),var(--vg))}",
  "html[data-vle-chrome='bloom'] .vle-bm .vle-tw-f.tw-trust{background:linear-gradient(90deg,color-mix(in srgb,var(--vg2) 55%,transparent),var(--vg2))}",
  // --- 'Latest' feed → a garland: dashed blush stem with petal nodes ---
  "html[data-vle-chrome='bloom'] .vld-rec{position:relative;margin-left:calc(7px * var(--vscale));padding:calc(2px * var(--vscale)) 0 calc(11px * var(--vscale)) calc(18px * var(--vscale));border-left:2px dashed color-mix(in srgb,var(--vg) 26%,transparent)}",
  "html[data-vle-chrome='bloom'] .vld-rec:last-child{border-left-color:transparent}",
  "html[data-vle-chrome='bloom'] .vld-rec::before{content:'\\2740';position:absolute;left:-8px;top:calc(1px * var(--vscale));font-size:11px;color:var(--vg2)}",
  "html[data-vle-chrome='bloom'] .vld-rec--journal::before{color:var(--v-pos-i)}html[data-vle-chrome='bloom'] .vld-rec--knew::before{color:var(--v-info)}html[data-vle-chrome='bloom'] .vld-rec--secret::before{color:var(--v-neg-i)}html[data-vle-chrome='bloom'] .vld-rec--shift::before{color:var(--v-press-i)}",
  // --- chips soften to fully-rounded pastel lozenges ---
  "html[data-vle-chrome='bloom'] .v-chip{border-radius:var(--rpill)}",
  // --- modal + toasts pick up the rounded pastel treatment (read document attr) ---
  "html[data-vle-chrome='bloom'] .vlfm{border-radius:22px;border-color:color-mix(in srgb,var(--vg) 34%,transparent);box-shadow:0 24px 70px rgba(180,120,150,.35)}",
  "html[data-vle-chrome='bloom'] .vlfm-head{font-family:var(--vserif);font-style:italic;text-transform:none;letter-spacing:.5px;border-bottom:1.5px dashed color-mix(in srgb,var(--vg) 30%,transparent)}",
  // --- float-only: petal 'confetti' close button + fleuron flanking the title ---
  "html[data-vle-chrome='bloom'] .vlf-x{border-radius:50%;background:radial-gradient(50% 45% at 40% 35%,var(--vg),color-mix(in srgb,var(--vg) 60%,#fff));border:1px solid color-mix(in srgb,var(--vg) 55%,transparent);color:#fff;box-shadow:0 2px 6px rgba(180,120,150,.4)}",
  "html[data-vle-chrome='bloom'] .vlf-x:hover{background:radial-gradient(50% 45% at 40% 35%,var(--vg2),color-mix(in srgb,var(--vg2) 60%,#fff));border-color:color-mix(in srgb,var(--vg2) 55%,transparent);color:#fff}",
  "html[data-vle-chrome='bloom'] .vlf-bar::before{content:'\\2740';position:absolute;left:calc(16px * var(--vscale));top:50%;transform:translateY(-50%);color:var(--vg2);opacity:.55;font-size:12px;pointer-events:none}",

  // ================= THEME: EMBER ("Starlit Night Dreaming") - float + drawer =================
  // A dark, ethereal, animated pastel look (lilac & mint glow on indigo void).
  // Signature: drifting fireflies + slow-rising bubbles + a faint nebula wash.
  // Soft-edged glowing cards, pillowy radius, dotted-stardust rules. Distinct
  // from Bloom (light/cozy, static) and Futuristic (hard/telemetry, scanlines).
  // All chrome-scoped so it re-skins BOTH the floating window and the drawer.
  // Animations honor html[data-vle-motion='off'] + prefers-reduced-motion.
  // --- shared: indigo nebula wash + the starfall texture (set by the mode) ---
  "html[data-vle-chrome='ember'] .vle-root{font-family:var(--vserif);background-image:radial-gradient(120% 90% at 20% 10%,rgba(var(--vg-rgb),.1),transparent 50%),radial-gradient(120% 90% at 80% 90%,rgba(var(--vg2-rgb),.08),transparent 50%)}",
  "html[data-vle-chrome='ember'] .vlf-body{background-image:radial-gradient(120% 80% at 20% 10%,rgba(var(--vg-rgb),.07),transparent 50%),radial-gradient(120% 80% at 80% 90%,rgba(var(--vg2-rgb),.06),transparent 50%)}",
  // --- the signature: drifting fireflies + slow-rising bubbles (motion-gated) ---
  "html[data-vle-chrome='ember'] .vle-body{position:relative}",
  "html[data-vle-chrome='ember'] .vlf-body{position:relative}",
  "html[data-vle-chrome='ember'] .vle-body::after,html[data-vle-chrome='ember'] .vlf-body::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background-image:radial-gradient(1.5px 1.5px at 12% 18%,rgba(var(--vg-rgb),.6),transparent),radial-gradient(1px 1px at 70% 32%,rgba(var(--vg2-rgb),.5),transparent),radial-gradient(2px 2px at 38% 68%,rgba(var(--vg-rgb),.45),transparent),radial-gradient(1px 1px at 84% 78%,rgba(var(--vg2-rgb),.55),transparent),radial-gradient(1.5px 1.5px at 52% 12%,rgba(240,184,208,.4),transparent),radial-gradient(1px 1px at 24% 88%,rgba(245,217,138,.4),transparent);background-repeat:no-repeat;opacity:.6;animation:vle-ember-drift 18s linear infinite}",
  "html[data-vle-chrome='ember'] .vle-body>*,html[data-vle-chrome='ember'] .vlf-body>*{position:relative;z-index:1}",
  // rising bubbles - a second layer of hollow pastel rings floating up
  "html[data-vle-chrome='ember'] .vle-body::before,html[data-vle-chrome='ember'] .vlf-body::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background-image:radial-gradient(circle at 18% 100%,transparent 4px,rgba(var(--vg-rgb),.12) 4.5px,transparent 6px),radial-gradient(circle at 62% 100%,transparent 5px,rgba(var(--vg2-rgb),.1) 5.5px,transparent 7px),radial-gradient(circle at 88% 100%,transparent 3px,rgba(240,184,208,.12) 3.5px,transparent 5px);background-repeat:no-repeat;animation:vle-ember-rise 22s linear infinite;opacity:.5}",
  "@keyframes vle-ember-drift{0%{transform:translateY(0);opacity:.6} 50%{opacity:.35} 100%{transform:translateY(-12px);opacity:.6}}",
  "@keyframes vle-ember-rise{0%{transform:translateY(0);opacity:0} 10%{opacity:.5} 90%{opacity:.4} 100%{transform:translateY(-160px);opacity:0}}",
  "html[data-vle-chrome='ember'][data-vle-motion='off'] .vle-body::after,html[data-vle-chrome='ember'][data-vle-motion='off'] .vlf-body::after,html[data-vle-chrome='ember'][data-vle-motion='off'] .vle-body::before,html[data-vle-chrome='ember'][data-vle-motion='off'] .vlf-body::before{animation:none;opacity:.4}",
  "@media (prefers-reduced-motion:reduce){html[data-vle-chrome='ember'] .vle-body::after,html[data-vle-chrome='ember'] .vlf-body::after,html[data-vle-chrome='ember'] .vle-body::before,html[data-vle-chrome='ember'] .vlf-body::before{animation:none;opacity:.4}}",
  // --- drawer head -> a luminous script title with a soft starlight glow ---
  "html[data-vle-chrome='ember'] .vle-head{font-family:var(--vserif);font-style:italic;font-weight:500;letter-spacing:1px;border-bottom:1px solid color-mix(in srgb,var(--vg) 26%,transparent)}",
  "html[data-vle-chrome='ember'] .vle-mark{text-shadow:0 0 14px rgba(var(--vg-rgb),.55)}",
  "html[data-vle-chrome='ember'] .vle-mark::after{content:'\\2726';margin-left:7px;color:var(--vg2);opacity:.75;font-size:.78em;text-shadow:0 0 8px rgba(var(--vg2-rgb),.5)}",
  "html[data-vle-chrome='ember'] .vle-stats{font-family:var(--vserif);font-style:italic;font-variant:small-caps;letter-spacing:1px;text-transform:lowercase;opacity:.65}",
  // --- tab bar -> rounded glow-pills; active = a luminous two-tone aurora ---
  "html[data-vle-chrome='ember'] .vle-tabbtn{border-radius:var(--rpill);text-transform:none;letter-spacing:.4px;font-family:var(--vserif);font-size:calc(13px * var(--vscale));font-weight:500}",
  "html[data-vle-chrome='ember'] .vle-tabbtn:hover{background:color-mix(in srgb,var(--vg) 10%,transparent);color:var(--vi)}",
  "html[data-vle-chrome='ember'] .vle-tabbtn.on{color:var(--vg);border-color:transparent;background:linear-gradient(120deg,color-mix(in srgb,var(--vg) 20%,transparent),color-mix(in srgb,var(--vg2) 18%,transparent));box-shadow:0 0 14px rgba(var(--vg-rgb),.22)}",
  "html[data-vle-chrome='ember'] .vle-tabicon.on{color:var(--vg);border-color:color-mix(in srgb,var(--vg) 40%,transparent);background:color-mix(in srgb,var(--vg) 16%,transparent);box-shadow:0 0 12px rgba(var(--vg-rgb),.2)}",
  // --- cards -> pillowy, soft-edged, with a faint pastel glow halo ---
  "html[data-vle-chrome='ember'] .vle-card,html[data-vle-chrome='ember'] .vle-rel-card,html[data-vle-chrome='ember'] .vld-sec,html[data-vle-chrome='ember'] .vld-pc{border-radius:18px;border-color:color-mix(in srgb,var(--vg) 22%,transparent);background:linear-gradient(168deg,rgba(24,24,40,.62),rgba(15,15,28,.58));box-shadow:0 0 18px rgba(var(--vg-rgb),.06),0 4px 18px rgba(0,0,0,.3)}",
  "html[data-vle-chrome='ember'] .vle-card:hover,html[data-vle-chrome='ember'] .vle-rel-card:hover{box-shadow:0 0 26px rgba(var(--vg-rgb),.14),0 6px 22px rgba(0,0,0,.36)}",
  // --- section eyebrows -> ethereal italic small-caps with a four-point star ---
  "html[data-vle-chrome='ember'] .vld-h,html[data-vle-chrome='ember'] .vle-sec-h{font-family:var(--vserif);font-style:italic;font-variant:small-caps;letter-spacing:1.5px;color:var(--vg);text-transform:none;text-shadow:0 0 10px rgba(var(--vg-rgb),.3)}",
  "html[data-vle-chrome='ember'] .vld-h::before,html[data-vle-chrome='ember'] .vle-sec-h::before{content:'\\2726 ';color:var(--vg2);opacity:.8}",
  // --- hero scene line -> dreamy italic serif wreathed in soft starlight ---
  "html[data-vle-chrome='ember'] .vld-hero{font-family:var(--vserif);font-style:italic;font-weight:600;letter-spacing:.3px;text-shadow:0 0 16px rgba(var(--vg-rgb),.32),0 0 32px rgba(var(--vg2-rgb),.18)}",
  "html[data-vle-chrome='ember'] .vld-hero::before{content:'\\275B ';color:var(--vg2);opacity:.7;font-style:normal}",
  "html[data-vle-chrome='ember'] .vld-sec--hero{background:linear-gradient(160deg,rgba(var(--vg-rgb),.12),rgba(var(--vg2-rgb),.1))!important;border-color:color-mix(in srgb,var(--vg) 26%,transparent)!important;border-radius:22px!important;box-shadow:0 0 30px rgba(var(--vg-rgb),.1)!important}",
  // --- tension -> glowing pastel orbs (lilac->mint), not alarming dots ---
  "html[data-vle-chrome='ember'] .vld-dot{border-radius:50%}",
  "html[data-vle-chrome='ember'] .vld-dot.on{background:radial-gradient(circle at 40% 35%,var(--vg),color-mix(in srgb,var(--vg) 50%,transparent));box-shadow:0 0 8px rgba(var(--vg-rgb),.55)}",
  // --- avatars -> luminous moon-medallions with a starlight halo when present ---
  "html[data-vle-chrome='ember'] .vle-av,html[data-vle-chrome='ember'] .vld-pc-av{border-radius:50%;background:radial-gradient(60% 55% at 40% 35%,color-mix(in srgb,var(--vg) 28%,transparent),color-mix(in srgb,var(--vg2) 20%,transparent));border:2px solid color-mix(in srgb,var(--vg) 42%,transparent);color:var(--vi);box-shadow:0 0 12px rgba(var(--vg-rgb),.2)}",
  "html[data-vle-chrome='ember'] .vle-card--present .vle-av{box-shadow:0 0 0 2px var(--vg),0 0 0 5px rgba(var(--vg-rgb),.2),0 0 18px rgba(var(--vg-rgb),.5)}",
  // --- twin bond meters -> glowing pastel strands (lilac affection, mint trust) ---
  "html[data-vle-chrome='ember'] .vle-tw-t{height:9px;border-radius:6px;background:rgba(255,255,255,.06)}",
  "html[data-vle-chrome='ember'] .vle-bm .vle-tw-f.tw-aff{background:linear-gradient(90deg,color-mix(in srgb,var(--vg) 55%,transparent),var(--vg));box-shadow:0 0 8px rgba(var(--vg-rgb),.35)}",
  "html[data-vle-chrome='ember'] .vle-bm .vle-tw-f.tw-trust{background:linear-gradient(90deg,color-mix(in srgb,var(--vg2) 55%,transparent),var(--vg2));box-shadow:0 0 8px rgba(var(--vg2-rgb),.3)}",
  // --- 'Latest' feed -> a stardust trail: dotted lilac stem with star nodes ---
  "html[data-vle-chrome='ember'] .vld-rec{position:relative;margin-left:calc(7px * var(--vscale));padding:calc(2px * var(--vscale)) 0 calc(11px * var(--vscale)) calc(18px * var(--vscale));border-left:2px dotted color-mix(in srgb,var(--vg) 28%,transparent)}",
  "html[data-vle-chrome='ember'] .vld-rec:last-child{border-left-color:transparent}",
  "html[data-vle-chrome='ember'] .vld-rec::before{content:'\\2726';position:absolute;left:-8px;top:calc(1px * var(--vscale));font-size:11px;color:var(--vg2);text-shadow:0 0 6px rgba(var(--vg2-rgb),.5)}",
  "html[data-vle-chrome='ember'] .vld-rec--journal::before{color:var(--v-pos-i)}html[data-vle-chrome='ember'] .vld-rec--knew::before{color:var(--v-info)}html[data-vle-chrome='ember'] .vld-rec--secret::before{color:var(--v-neg-i)}html[data-vle-chrome='ember'] .vld-rec--shift::before{color:var(--v-press-i)}",
  // --- chips soften to fully-rounded pastel lozenges with a faint glow ---
  "html[data-vle-chrome='ember'] .v-chip{border-radius:var(--rpill);box-shadow:0 0 8px rgba(var(--vg-rgb),.1)}",
  // --- modal + toasts pick up the luminous pastel treatment (read document attr) ---
  "html[data-vle-chrome='ember'] .vlfm{border-radius:22px;border-color:color-mix(in srgb,var(--vg) 34%,transparent);box-shadow:0 0 40px rgba(var(--vg-rgb),.18),0 24px 70px rgba(0,0,0,.6)}",
  "html[data-vle-chrome='ember'] .vlfm-head{font-family:var(--vserif);font-style:italic;text-transform:none;letter-spacing:1px;border-bottom:1px solid color-mix(in srgb,var(--vg) 28%,transparent)}",
  // --- float-only: a glowing star 'ember' close button + star flanking the title ---
  "html[data-vle-chrome='ember'] .vlf-x{border-radius:50%;background:radial-gradient(50% 45% at 40% 35%,var(--vg),color-mix(in srgb,var(--vg) 55%,#1a1a30));border:1px solid color-mix(in srgb,var(--vg) 55%,transparent);color:#1a1a30;box-shadow:0 0 12px rgba(var(--vg-rgb),.45)}",
  "html[data-vle-chrome='ember'] .vlf-x:hover{background:radial-gradient(50% 45% at 40% 35%,var(--vg2),color-mix(in srgb,var(--vg2) 55%,#1a1a30));border-color:color-mix(in srgb,var(--vg2) 55%,transparent);color:#1a1a30;box-shadow:0 0 14px rgba(var(--vg2-rgb),.5)}",
  "html[data-vle-chrome='ember'] .vlf-bar::before{content:'\\2726';position:absolute;left:calc(16px * var(--vscale));top:50%;transform:translateY(-50%);color:var(--vg2);opacity:.6;font-size:12px;pointer-events:none;text-shadow:0 0 8px rgba(var(--vg2-rgb),.5)}",

  // NOCTURNE — midnight botanical salon: static, engraved, architectural.
  "html[data-vle-chrome='nocturne'] .vle-root{font-family:var(--vserif);background-image:radial-gradient(circle at 12% 8%,rgba(185,207,238,.09) 0 1px,transparent 2px),radial-gradient(circle at 82% 16%,rgba(185,207,238,.12) 0 1px,transparent 2px),linear-gradient(145deg,rgba(12,34,70,.38),transparent 42%)}",
  "html[data-vle-chrome='nocturne'] .vlf-frame{border-color:rgba(var(--vg-rgb),.55);border-radius:var(--vradius);box-shadow:0 24px 70px rgba(0,3,14,.78),0 0 0 4px #07152d,0 0 0 5px rgba(var(--vg-rgb),.28),inset 0 0 38px rgba(20,58,111,.2)}",
  "html[data-vle-chrome='nocturne'] .vlf-frame::before{content:'';position:absolute;z-index:2;inset:7px;border:1px solid rgba(var(--vg-rgb),.32);box-shadow:inset 0 0 0 3px rgba(3,10,25,.72);pointer-events:none}",
  "html[data-vle-chrome='nocturne'] .vlf-frame::after{content:'✦  ·  ✧  ·  ✦';position:absolute;z-index:2;left:50%;bottom:7px;transform:translateX(-50%);color:rgba(var(--vg-rgb),.42);font-size:8px;letter-spacing:5px;white-space:nowrap;pointer-events:none}",
  "html[data-vle-chrome='nocturne'] .vlf-bar{background:linear-gradient(90deg,rgba(3,10,25,.95),rgba(31,67,119,.48),rgba(3,10,25,.95));border-bottom:3px double rgba(var(--vg-rgb),.34)}",
  "html[data-vle-chrome='nocturne'] .vlf-title,html[data-vle-chrome='nocturne'] .vle-head{font-family:var(--vserif);font-variant:small-caps;letter-spacing:2.2px;text-transform:none;text-shadow:0 1px 0 #000,0 0 12px rgba(var(--vg-rgb),.22)}",
  "html[data-vle-chrome='nocturne'] .vlf-bar::before{content:'❧';position:absolute;left:calc(16px * var(--vscale));top:50%;transform:translateY(-50%) rotate(-18deg);color:var(--vg);opacity:.62;font-size:15px}",
  "html[data-vle-chrome='nocturne'] .vlf-x{border-radius:2px;border:1px solid rgba(var(--vg-rgb),.48);background:#07152d;color:var(--vg);box-shadow:inset 0 0 0 2px #020817}",
  "html[data-vle-chrome='nocturne'] .vle-tabs{border-bottom:3px double rgba(var(--vg-rgb),.22)}",
  "html[data-vle-chrome='nocturne'] .vle-tabbtn{border-radius:2px;font-family:var(--vserif);font-variant:small-caps;letter-spacing:1px}",
  "html[data-vle-chrome='nocturne'] .vle-tabbtn.on{background:linear-gradient(180deg,rgba(var(--vg2-rgb),.42),rgba(2,8,23,.25));border-color:rgba(var(--vg-rgb),.5);box-shadow:inset 0 -2px 0 var(--vg)}",
  "html[data-vle-chrome='nocturne'] .vle-card,html[data-vle-chrome='nocturne'] .vle-rel-card,html[data-vle-chrome='nocturne'] .vld-sec,html[data-vle-chrome='nocturne'] .vld-pc{border-radius:3px;border:1px solid rgba(var(--vg-rgb),.24);background:linear-gradient(145deg,rgba(12,32,64,.78),rgba(3,10,25,.88));box-shadow:inset 0 0 0 2px rgba(2,8,23,.7),0 5px 16px rgba(0,0,0,.28)}",
  "html[data-vle-chrome='nocturne'] .vld-inner[data-layout='salon'][data-cols='2']{grid-template-columns:minmax(0,1.65fr) minmax(180px,.8fr);align-items:start;position:relative;padding:calc(8px * var(--vscale))}",
  "html[data-vle-chrome='nocturne'] .vld-inner[data-layout='salon'][data-cols='2']::before{content:'';position:absolute;top:8px;bottom:8px;left:calc(67.3% - 4px);width:3px;border-left:1px solid rgba(var(--vg-rgb),.38);border-right:1px solid rgba(var(--vg-rgb),.16);pointer-events:none}",
  "html[data-vle-chrome='nocturne'] .vld-inner[data-layout='salon'] .vld-sec--hero{grid-column:1/-1;border:3px double rgba(var(--vg-rgb),.38)!important;background:radial-gradient(100% 160% at 50% 0,rgba(var(--vg2-rgb),.35),rgba(3,10,25,.9) 62%)!important;box-shadow:inset 0 0 28px rgba(70,109,168,.2)!important}",
  "html[data-vle-chrome='nocturne'] .vld-inner[data-layout='salon'] .vld-sec:nth-child(n+5){grid-column:2}",
  "html[data-vle-chrome='nocturne'] .vld-h,html[data-vle-chrome='nocturne'] .vle-sec-h{font-family:var(--vserif);font-variant:small-caps;letter-spacing:1.8px;color:var(--vg);border-bottom:1px solid rgba(var(--vg-rgb),.2)}",
  "html[data-vle-chrome='nocturne'] .vld-h::before,html[data-vle-chrome='nocturne'] .vle-sec-h::before{content:'❦ ';color:var(--vg2)}",
  "html[data-vle-chrome='nocturne'] .vld-hero{font-family:var(--vserif);font-style:italic;text-shadow:0 2px 0 #000}",
  "html[data-vle-chrome='nocturne'] .vle-av,html[data-vle-chrome='nocturne'] .vld-pc-av{border-radius:50% 50% 46% 46%;border:3px double rgba(var(--vg-rgb),.55);background:radial-gradient(circle at 40% 35%,rgba(var(--vg-rgb),.2),#06142d 68%);box-shadow:0 0 0 2px #020817}",
  "html[data-vle-chrome='nocturne'] .vld-rec{border-left:1px solid rgba(var(--vg-rgb),.32);padding-left:18px;position:relative}",
  "html[data-vle-chrome='nocturne'] .vld-rec::before{content:'✦';position:absolute;left:-5px;color:var(--vg);font-size:8px;background:#06142d;padding:2px 0}",
  "html[data-vle-chrome='nocturne'] .v-chip{border-radius:2px;background:rgba(3,10,25,.55)}",
  "html[data-vle-chrome='nocturne'] .vlfm{border-radius:4px;border:3px double rgba(var(--vg-rgb),.5);box-shadow:0 25px 80px rgba(0,3,14,.8)}",
  "html[data-vle-chrome='nocturne'] .vlfm-head{font-family:var(--vserif);font-variant:small-caps;letter-spacing:2px;border-bottom:3px double rgba(var(--vg-rgb),.3)}",
  "@media(max-width:620px){html[data-vle-chrome='nocturne'] .vld-inner[data-layout='salon'][data-cols='2']{grid-template-columns:1fr}html[data-vle-chrome='nocturne'] .vld-inner[data-layout='salon'][data-cols='2']::before{display:none}html[data-vle-chrome='nocturne'] .vld-inner[data-layout='salon'] .vld-sec{grid-column:1!important}}",

  // ================= THEME: ATELIER ("The Dark-Academia Gallery") — float + drawer =================
  // A dim museum study at dusk hung with oil paintings. The float becomes a
  // GILT-FRAMED CANVAS (carved gold picture frame + inner mat + hanging cord);
  // headers are engraved BRASS PLACARDS; avatars sit in STATUE NICHES; the
  // Latest feed is a shelf of BOOK SPINES; tension reads as warm GALLERY LIGHTS.
  // Warm walnut/oxblood/olive/ochre — static & scholarly, only slow dust motes
  // drifting in a shaft of light. Distinct from Bloom(pastel), Ember(indigo glow),
  // Nocturne(cold navy). All chrome-scoped so BOTH surfaces re-skin.
  // --- theme-gallery picker tile: a tiny gilt frame with two hung plates ---
  ".vle-mode-sk.sk-atelier{flex-direction:column;gap:5px;padding:7px;background:linear-gradient(160deg,#2a2015,#160f09);box-shadow:inset 0 0 0 3px #6b4f22,inset 0 0 0 4px rgba(200,160,80,.6),inset 0 0 0 5px #2a2015}.vle-mode-sk.sk-atelier i{height:8px;border:1px solid rgba(176,136,64,.5);background:linear-gradient(90deg,rgba(164,80,63,.45),rgba(138,148,99,.4))}.vle-mode-sk.sk-atelier i:first-child{height:12px;background:linear-gradient(120deg,rgba(176,136,64,.5),rgba(125,59,46,.4))}",

  // --- shared: dim walnut gallery wall with a soft raking light from top-left ---
  "html[data-vle-chrome='atelier'] .vle-root{font-family:var(--vserif);background-image:radial-gradient(120% 80% at 8% -5%,rgba(176,136,64,.1),transparent 46%),radial-gradient(130% 100% at 100% 110%,rgba(0,0,0,.34),transparent 55%),linear-gradient(180deg,rgba(50,38,26,.32),rgba(18,13,9,.5))}",
  "html[data-vle-chrome='atelier'] .vlf-body{background-image:radial-gradient(120% 70% at 8% -5%,rgba(176,136,64,.08),transparent 46%),radial-gradient(130% 90% at 100% 110%,rgba(0,0,0,.3),transparent 55%)}",
  // --- the signature FLOAT frame: a carved gilt picture frame around an oil canvas ---
  "html[data-vle-chrome='atelier'] .vlf-frame{border:none;border-radius:3px;box-shadow:0 0 0 3px #120c07,0 0 0 10px #3a2a15,0 0 0 12px #6e5324,0 0 0 15px #c9a955,0 0 0 17px #7a5c28,0 0 0 19px #2a1e10,0 26px 70px rgba(0,0,0,.72),inset 0 0 60px rgba(0,0,0,.5),inset 0 0 0 1px rgba(200,160,80,.28)}",
  // carved bead-and-reel highlight along the gilt (a bright inner bevel line)
  "html[data-vle-chrome='atelier'] .vlf-frame::before{content:'';position:absolute;z-index:2;inset:5px;border-radius:2px;border:1px solid rgba(210,175,95,.4);box-shadow:inset 0 0 0 2px rgba(0,0,0,.45),inset 0 2px 14px rgba(0,0,0,.4);pointer-events:none}",
  // engraved museum placard hung below the frame + a hanging cord to a nail above
  "html[data-vle-chrome='atelier'] .vlf-frame::after{content:'A T E L I E R';position:absolute;z-index:3;left:50%;bottom:-2px;transform:translateX(-50%);font:600 7px/1 var(--vmono);letter-spacing:3px;color:#3a2c16;background:linear-gradient(180deg,#c9a955,#8a6a2c);border:1px solid #5f471f;border-radius:2px;padding:3px 10px;box-shadow:0 2px 5px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,235,180,.5);pointer-events:none;white-space:nowrap}",
  // title bar = a dim brass nameplate rail
  "html[data-vle-chrome='atelier'] .vlf-bar{background:linear-gradient(180deg,rgba(58,44,26,.6),rgba(30,22,14,.35));border-bottom:1px solid rgba(176,136,64,.35);box-shadow:inset 0 -1px 0 rgba(0,0,0,.4)}",
  "html[data-vle-chrome='atelier'] .vlf-title{font-family:var(--vserif);font-weight:600;font-size:calc(16px * var(--vscale));letter-spacing:4px;text-transform:uppercase;color:var(--vi);text-shadow:0 1px 0 #000,0 0 1px rgba(200,160,80,.5)}",
  "html[data-vle-chrome='atelier'] .vlf-mark{color:var(--vg);text-shadow:0 1px 0 #000}",
  // a small carved rosette flanking the title
  "html[data-vle-chrome='atelier'] .vlf-bar::before{content:'\\2766';position:absolute;left:calc(15px * var(--vscale));top:50%;transform:translateY(-50%);color:var(--vg);opacity:.7;font-size:14px;text-shadow:0 1px 0 #000}",
  // wax/brass close stud
  "html[data-vle-chrome='atelier'] .vlf-x{border-radius:50%;background:radial-gradient(50% 45% at 40% 35%,#c9a955,#6e5324);border:1px solid #5f471f;color:#2a1e10;box-shadow:0 1px 3px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,235,180,.5)}",
  "html[data-vle-chrome='atelier'] .vlf-x:hover{background:radial-gradient(50% 45% at 40% 35%,#c87a63,#7d3b2e);border-color:#4a2018;color:#160b08}",
  "html[data-vle-chrome='atelier'] .vlf-grip{background:none;border:none;right:9px;bottom:9px;width:11px;height:11px;border-right:2px solid rgba(200,160,80,.6);border-bottom:2px solid rgba(200,160,80,.6);border-radius:0}",
  "html[data-vle-chrome='atelier'] .vlf-launch{border-radius:0;border:1px solid #6e5324;border-right:none;box-shadow:-4px 4px 18px rgba(0,0,0,.5),inset 0 0 0 2px rgba(200,160,80,.35)}",

  // --- slow drifting dust motes in a shaft of gallery light (motion-gated) ---
  "html[data-vle-chrome='atelier'] .vle-body,html[data-vle-chrome='atelier'] .vlf-body{position:relative}",
  "html[data-vle-chrome='atelier'] .vle-body::after,html[data-vle-chrome='atelier'] .vlf-body::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background-image:radial-gradient(1.5px 1.5px at 20% 30%,rgba(230,205,150,.5),transparent),radial-gradient(1px 1px at 66% 22%,rgba(230,205,150,.4),transparent),radial-gradient(1.5px 1.5px at 44% 74%,rgba(210,180,120,.4),transparent),radial-gradient(1px 1px at 82% 60%,rgba(230,205,150,.35),transparent);background-repeat:no-repeat;opacity:.5;animation:vle-atelier-dust 26s linear infinite}",
  "html[data-vle-chrome='atelier'] .vle-body>*,html[data-vle-chrome='atelier'] .vlf-body>*{position:relative;z-index:1}",
  "@keyframes vle-atelier-dust{0%{transform:translate(0,0);opacity:.5}50%{opacity:.28}100%{transform:translate(6px,-14px);opacity:.5}}",
  "html[data-vle-chrome='atelier'][data-vle-motion='off'] .vle-body::after,html[data-vle-chrome='atelier'][data-vle-motion='off'] .vlf-body::after{animation:none;opacity:.32}",
  "@media (prefers-reduced-motion:reduce){html[data-vle-chrome='atelier'] .vle-body::after,html[data-vle-chrome='atelier'] .vlf-body::after{animation:none;opacity:.32}}",

  // --- drawer head -> an engraved museum wall-text with a gilt underrule ---
  "html[data-vle-chrome='atelier'] .vle-head{font-family:var(--vserif);font-weight:600;letter-spacing:3px;text-transform:uppercase;font-size:calc(20px * var(--vscale));border-bottom:1px solid rgba(176,136,64,.4);box-shadow:0 2px 0 rgba(176,136,64,.14);text-shadow:0 1px 0 #000}",
  "html[data-vle-chrome='atelier'] .vle-mark{color:var(--vg);text-shadow:0 1px 0 #000}",
  "html[data-vle-chrome='atelier'] .vle-mark::after{content:'\\2766';margin-left:8px;color:var(--vg2);opacity:.7;font-size:.72em}",
  "html[data-vle-chrome='atelier'] .vle-stats{font-family:var(--vserif);font-variant:small-caps;letter-spacing:1.4px;text-transform:lowercase;opacity:.7}",

  // --- tab bar -> incised brass gallery-room labels; active = a lit gilt plaque ---
  "html[data-vle-chrome='atelier'] .vle-tabs{border-bottom:1px solid rgba(176,136,64,.22)}",
  "html[data-vle-chrome='atelier'] .vle-tabbtn{border-radius:2px;font-family:var(--vserif);font-variant:small-caps;letter-spacing:1.2px;text-transform:none;font-size:calc(12.5px * var(--vscale))}",
  "html[data-vle-chrome='atelier'] .vle-tabbtn:hover{background:rgba(176,136,64,.1);color:var(--vi)}",
  "html[data-vle-chrome='atelier'] .vle-tabbtn.on{color:#2a1e10;border-color:#5f471f;background:linear-gradient(180deg,#c9a955,#9a7530);box-shadow:0 1px 3px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,235,180,.5);text-shadow:0 1px 0 rgba(255,235,180,.4)}",
  "html[data-vle-chrome='atelier'] .vle-tabicon.on{color:var(--vg);border-color:rgba(176,136,64,.5);background:rgba(176,136,64,.16)}",
  "html[data-vle-chrome='atelier'] .vlf-tab.on{color:var(--vg);background:rgba(176,136,64,.14);border-color:rgba(176,136,64,.4);border-bottom-color:transparent}",

  // --- cards -> framed plates: a thin gilt liner on a canvas ground, hung with a top shadow ---
  "html[data-vle-chrome='atelier'] .vle-card,html[data-vle-chrome='atelier'] .vle-rel-card,html[data-vle-chrome='atelier'] .vld-sec,html[data-vle-chrome='atelier'] .vld-pc{border-radius:2px;border:1px solid rgba(176,136,64,.45);background:linear-gradient(160deg,rgba(38,29,21,.9),rgba(24,18,12,.94));box-shadow:inset 0 0 0 2px rgba(20,14,9,.85),inset 0 0 0 3px rgba(176,136,64,.18),0 6px 16px rgba(0,0,0,.4)}",
  "html[data-vle-chrome='atelier'] .vle-card:hover,html[data-vle-chrome='atelier'] .vle-rel-card:hover{border-color:rgba(200,160,80,.7);box-shadow:inset 0 0 0 2px rgba(20,14,9,.85),inset 0 0 0 3px rgba(200,160,80,.3),0 8px 20px rgba(0,0,0,.46)}",

  // --- section eyebrows -> engraved brass placards (incised small-caps + a chisel mark) ---
  "html[data-vle-chrome='atelier'] .vld-h,html[data-vle-chrome='atelier'] .vle-sec-h{font-family:var(--vserif);font-variant:small-caps;letter-spacing:2px;text-transform:none;color:var(--vg);border-bottom:1px solid rgba(176,136,64,.2);padding-bottom:calc(3px * var(--vscale));text-shadow:0 1px 0 #000}",
  "html[data-vle-chrome='atelier'] .vld-h::before,html[data-vle-chrome='atelier'] .vle-sec-h::before{content:'\\29C9 ';color:var(--vg2);opacity:.75}",

  // --- hero scene -> the centerpiece oil: a richly framed canvas, brushed serif title ---
  "html[data-vle-chrome='atelier'] .vld-hero{font-family:var(--vserif);font-style:italic;font-weight:600;letter-spacing:.2px;text-shadow:0 2px 4px rgba(0,0,0,.6)}",
  "html[data-vle-chrome='atelier'] .vld-hero::first-letter{font-family:var(--vserif);font-weight:700;font-size:2.1em;line-height:.8;float:left;margin:2px 8px 0 0;color:var(--vg);text-shadow:0 2px 3px rgba(0,0,0,.7)}",
  "html[data-vle-chrome='atelier'] .vld-sec--hero{border:none!important;border-radius:2px!important;background:radial-gradient(120% 150% at 30% 0%,rgba(70,52,30,.6),rgba(22,16,10,.96) 70%)!important;box-shadow:0 0 0 2px #120c07,0 0 0 7px #4a3717,0 0 0 9px #8a6a2c,0 0 0 11px #3a2a15,inset 0 0 40px rgba(0,0,0,.55)!important;padding:calc(18px * var(--vscale)) calc(20px * var(--vscale))!important;margin:calc(4px * var(--vscale)) 0 calc(10px * var(--vscale))!important}",

  // --- tension -> a row of warm gallery picture-lights (unlit = dim bulbs) ---
  "html[data-vle-chrome='atelier'] .vld-dot{border-radius:50% 50% 40% 40%;background:rgba(176,136,64,.12)}",
  "html[data-vle-chrome='atelier'] .vld-dot.on{background:radial-gradient(circle at 50% 30%,#ffe6a6,var(--vg) 70%);box-shadow:0 0 8px rgba(200,160,80,.6),0 3px 5px rgba(0,0,0,.4)}",

  // --- avatars -> marble busts in arched statue niches (double gilt ring when present) ---
  "html[data-vle-chrome='atelier'] .vle-av,html[data-vle-chrome='atelier'] .vld-pc-av,html[data-vle-chrome='atelier'] .vle-strip-av{border-radius:50% 50% 46% 46%;background:radial-gradient(60% 55% at 40% 30%,rgba(236,224,200,.28),rgba(30,22,14,.9) 72%);border:1px solid rgba(176,136,64,.55);color:var(--vi);box-shadow:inset 0 -3px 8px rgba(0,0,0,.5),0 0 0 3px rgba(20,14,9,.8)}",
  "html[data-vle-chrome='atelier'] .vle-card--present .vle-av{box-shadow:inset 0 -3px 8px rgba(0,0,0,.5),0 0 0 2px var(--vg),0 0 0 4px #2a1e10,0 0 0 6px rgba(176,136,64,.4)}",

  // --- twin bond meters -> inlaid enamel strips (olive affection, slate-teal trust) ---
  "html[data-vle-chrome='atelier'] .vle-tw-t{height:8px;border-radius:1px;background:rgba(0,0,0,.4);box-shadow:inset 0 0 0 1px rgba(176,136,64,.2)}",
  "html[data-vle-chrome='atelier'] .vle-bm .vle-tw-f.tw-aff{background:linear-gradient(90deg,color-mix(in srgb,var(--v-pos) 60%,transparent),var(--v-pos-i))}",
  "html[data-vle-chrome='atelier'] .vle-bm .vle-tw-f.tw-trust{background:linear-gradient(90deg,color-mix(in srgb,var(--v-info) 60%,transparent),var(--v-info))}",

  // --- 'Latest' feed -> a shelf of leaning book spines (gilt-lettered, ribbon markers) ---
  "html[data-vle-chrome='atelier'] .vld-rec{position:relative;margin-left:calc(6px * var(--vscale));padding:calc(4px * var(--vscale)) calc(4px * var(--vscale)) calc(10px * var(--vscale)) calc(18px * var(--vscale));border-left:5px solid var(--vg);border-top:none;box-shadow:inset 3px 0 0 rgba(20,14,9,.6),inset 8px 0 0 rgba(176,136,64,.28)}",
  "html[data-vle-chrome='atelier'] .vld-rec::before{content:'';position:absolute;left:-5px;top:0;bottom:6px;width:5px;background:repeating-linear-gradient(180deg,transparent 0 5px,rgba(0,0,0,.25) 5px 6px)}",
  "html[data-vle-chrome='atelier'] .vld-rec--journal{border-left-color:var(--v-pos)}html[data-vle-chrome='atelier'] .vld-rec--knew{border-left-color:var(--v-info)}html[data-vle-chrome='atelier'] .vld-rec--secret{border-left-color:var(--v-neg)}html[data-vle-chrome='atelier'] .vld-rec--shift{border-left-color:var(--v-press)}",

  // --- chips -> incised brass tags (square, hairline gilt) ---
  "html[data-vle-chrome='atelier'] .v-chip{border-radius:2px;background:rgba(176,136,64,.1);box-shadow:inset 0 0 0 1px rgba(0,0,0,.4)}",

  // --- GALLERY layout: hung plates spaced on the wall; hero is the centerpiece ---
  "html[data-vle-chrome='atelier'] .vld-inner[data-layout='gallery']{gap:calc(20px * var(--vscale))}",
  "html[data-vle-chrome='atelier'] .vld-inner[data-layout='gallery'] .vld-sec{position:relative}",
  // each plate wears a small brass hanging-nail above it (except the hero, which is self-framed)
  "html[data-vle-chrome='atelier'] .vld-inner[data-layout='gallery'] .vld-sec:not(.vld-sec--hero)::before{content:'';position:absolute;top:-11px;left:50%;transform:translateX(-50%);width:6px;height:6px;border-radius:50%;background:radial-gradient(circle at 40% 30%,#e6cd96,#7a5c28);box-shadow:0 1px 2px rgba(0,0,0,.6)}",

  // --- modal + toasts pick up the framed brass treatment (read document attr) ---
  "html[data-vle-chrome='atelier'] .vlfm{border-radius:3px;border:none;box-shadow:0 0 0 2px #120c07,0 0 0 8px #4a3717,0 0 0 10px #8a6a2c,0 0 0 12px #2a1e10,0 26px 80px rgba(0,0,0,.75)}",
  "html[data-vle-chrome='atelier'] .vlfm-head{font-family:var(--vserif);font-variant:small-caps;letter-spacing:2px;text-transform:none;border-bottom:1px solid rgba(176,136,64,.3)}",

].join('\n');
