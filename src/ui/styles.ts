/**
 * Themed CSS for the VELLUM shell + components. Illuminated-manuscript palette
 * via CSS variables so skins/host theme can override. Single string loaded via
 * spindle.dom.addStyle.
 */
export const STYLES = [
  ":root{--vle-gold:#cda84e;--vle-gold-soft:rgba(205,168,78,.16);--vle-ink:#e7d6ad;--vle-bg:rgba(20,18,14,.55)}",
  ".vle-root{font-family:'Cormorant Garamond',Georgia,serif;color:var(--vle-ink);padding:10px 12px}",
  ".vle-head{display:flex;align-items:center;gap:7px;font-size:18px;letter-spacing:1px;padding-bottom:8px;border-bottom:1px solid var(--vle-gold-soft)}",
  ".vle-mark{color:var(--vle-gold)}",
  ".vle-ver{font:600 9px/1 'JetBrains Mono',monospace;letter-spacing:1px;text-transform:uppercase;opacity:.6;color:var(--vle-gold)}",
  ".vle-stats{margin-left:auto;font:600 9px/1 'JetBrains Mono',monospace;letter-spacing:.5px;opacity:.55}",
  // tab bar
  ".vle-tabbar{display:flex;gap:4px;margin:9px 0;flex-wrap:wrap}",
  ".vle-tabbtn{font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:.5px;text-transform:uppercase;color:#cdbfa0;background:rgba(205,168,78,.07);border:1px solid var(--vle-gold-soft);border-radius:7px;padding:6px 11px;cursor:pointer;opacity:.7;transition:opacity .15s,background .15s}",
  ".vle-tabbtn:hover{opacity:.95}",
  ".vle-tabbtn.on{opacity:1;background:rgba(205,168,78,.2);border-color:rgba(205,168,78,.45);color:var(--vle-gold)}",
  ".vle-body{min-height:60px}",
  ".vle-empty{padding:24px 8px;text-align:center;opacity:.65;font-size:14px;line-height:1.6}",
  ".vle-empty.sm{padding:10px;font-size:12px}",
  // section headers + counts
  ".vle-sec-h{font:600 9px/1 'JetBrains Mono',monospace;letter-spacing:1px;text-transform:uppercase;opacity:.5;margin:12px 0 6px;display:flex;align-items:center;gap:6px}",
  ".vle-n{font-size:8px;background:var(--vle-gold-soft);color:var(--vle-gold);border-radius:8px;padding:2px 6px}",
  ".vle-scene{font-size:14px;font-style:italic;opacity:.85;padding:4px 2px}",
  ".vle-tension{font:600 9px/1 'JetBrains Mono',monospace;color:#c96a6a;letter-spacing:.5px;margin-left:6px}",
  // cast cards
  ".vle-cards{display:flex;flex-direction:column;gap:5px}",
  ".vle-card{display:flex;align-items:center;gap:9px;padding:7px 9px;border:1px solid var(--vle-gold-soft);border-radius:9px;background:linear-gradient(170deg,rgba(28,25,20,.45),rgba(18,16,12,.35))}",
  ".vle-card.on{border-color:var(--vle-gold);box-shadow:0 0 8px rgba(205,168,78,.18)}",
  ".vle-av{flex:none;width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:rgba(205,168,78,.18);color:var(--vle-gold);font-weight:600;font-size:12px}",
  ".vle-card-main{display:flex;flex-direction:column;gap:1px;min-width:0}",
  ".vle-card-n{font-size:14px}",
  ".vle-star{color:var(--vle-gold);font-size:9px}",
  ".vle-card-meta{font:600 9px/1.2 'JetBrains Mono',monospace;opacity:.6}",
  ".vle-card-app{font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // tracks + memory
  ".vle-track{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:3px 8px;border-left:2px solid var(--vle-gold-soft);margin-bottom:3px}",
  ".vle-track-s{font:600 9px/1.3 'JetBrains Mono',monospace;color:var(--vle-gold);opacity:.8}",
  ".vle-mem{display:flex;gap:7px;font-size:12px;padding:4px 0;line-height:1.45;align-items:baseline}",
  ".vle-mem-tier{flex:none;font:600 7px/1 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.5px;padding:2px 5px;border-radius:5px;opacity:.85}",
  ".vle-mem-tier.t-turn{color:#8c8478;border:1px solid rgba(140,132,120,.4)}",
  ".vle-mem-tier.t-chapter{color:#7ea6b0;border:1px solid rgba(126,166,176,.4)}",
  ".vle-mem-tier.t-arc{color:var(--vle-gold);border:1px solid rgba(205,168,78,.4)}",
  // relations
  ".vle-rel-grid{display:flex;flex-direction:column;gap:7px}",
  ".vle-rel-card{border:1px solid var(--vle-gold-soft);border-radius:9px;padding:8px 10px;background:rgba(22,20,16,.4)}",
  ".vle-rel-top{display:flex;justify-content:space-between;align-items:center;gap:8px}",
  ".vle-rel-pair{font-size:14px}",
  ".vle-rel-sent{font:600 9px/1 'JetBrains Mono',monospace;opacity:.7}",
  ".vle-rel-label{font-size:12px;font-style:italic;opacity:.75;margin:3px 0}",
  ".vle-cats{display:flex;flex-wrap:wrap;gap:4px;margin:5px 0}",
  ".vle-cat{font:600 8px/1 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:6px;color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}",
  ".vle-st{font:600 8px/1 'JetBrains Mono',monospace;text-transform:uppercase;padding:2px 6px;border-radius:6px;opacity:.6;border:1px solid var(--vle-gold-soft)}",
  ".vle-bars{display:flex;flex-direction:column;gap:3px;margin-top:4px}",
  ".vle-bar{display:flex;align-items:center;gap:6px}",
  ".vle-bar-l{flex:none;width:30px;font:600 8px/1 'JetBrains Mono',monospace;opacity:.6}",
  ".vle-bar-t{position:relative;flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.06)}",
  ".vle-bar-mid{position:absolute;left:50%;top:-1px;width:1px;height:7px;background:rgba(255,255,255,.2)}",
  ".vle-bar-f{position:absolute;top:0;height:5px;border-radius:3px}",
  ".vle-bar-f.pos{background:#8fa67e}.vle-bar-f.neg{background:#c96a6a}",
  ".vle-bar-v{flex:none;width:30px;text-align:right;font:600 8px/1 'JetBrains Mono',monospace}",
  ".vle-bar-v.pos{color:#a9c089}.vle-bar-v.neg{color:#e09090}",
  // error boundary
  ".vlm-comp-error{padding:8px;font-size:11px;color:#e09090;border:1px solid rgba(201,106,106,.3);border-radius:8px;background:rgba(201,106,106,.08)}",
  ".vlm-comp-error span{opacity:.7;font-size:10px}",
].join('\n');
