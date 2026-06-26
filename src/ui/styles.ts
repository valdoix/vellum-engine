/**
 * Themed CSS for the VELLUM shell. Illuminated-manuscript palette via CSS
 * variables so skins and the host theme can override. Kept as a single string
 * loaded through spindle.dom.addStyle.
 */
export const STYLES = [
  ":root{--vle-gold:#cda84e;--vle-gold-soft:rgba(205,168,78,.16);--vle-ink:#e7d6ad;--vle-bg:rgba(20,18,14,.55)}",
  ".vle-root{font-family:'Cormorant Garamond',Georgia,serif;color:var(--vle-ink);padding:10px 12px}",
  ".vle-head{display:flex;align-items:center;gap:7px;font-size:18px;letter-spacing:1px;padding-bottom:8px;border-bottom:1px solid var(--vle-gold-soft);margin-bottom:10px}",
  ".vle-mark{color:var(--vle-gold)}",
  ".vle-ver{margin-left:auto;font:600 9px/1 'JetBrains Mono',monospace;letter-spacing:1px;text-transform:uppercase;opacity:.6;color:var(--vle-gold)}",
  ".vle-empty{padding:24px 8px;text-align:center;opacity:.65;font-size:14px;line-height:1.6}",
  ".vle-empty span{font-size:11px;opacity:.7}",
  ".vle-stat-row{display:flex;gap:8px;margin-bottom:10px}",
  ".vle-stat{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 4px;border:1px solid var(--vle-gold-soft);border-radius:9px;background:linear-gradient(170deg,rgba(28,25,20,.5),rgba(18,16,12,.4))}",
  ".vle-stat-v{font-size:20px;font-weight:600;color:var(--vle-gold)}",
  ".vle-stat-l{font:600 8px/1 'JetBrains Mono',monospace;letter-spacing:1px;text-transform:uppercase;opacity:.6}",
  ".vle-scene{font-size:14px;font-style:italic;opacity:.85;padding:6px 2px}",
  ".vle-tension{font:600 9px/1 'JetBrains Mono',monospace;color:#c96a6a;letter-spacing:.5px;margin-left:6px}",
  ".vle-note{margin-top:10px;font-size:10px;line-height:1.5;opacity:.45}",
  ".vle-sec-h{font:600 9px/1 'JetBrains Mono',monospace;letter-spacing:1px;text-transform:uppercase;opacity:.5;margin:12px 0 5px}",
  ".vle-chips{display:flex;flex-wrap:wrap;gap:5px}",
  ".vle-chip{font-size:11px;padding:3px 9px;border-radius:20px;border:1px solid var(--vle-gold-soft);background:rgba(28,25,20,.4);opacity:.8}",
  ".vle-chip.on{border-color:var(--vle-gold);color:var(--vle-gold);opacity:1;box-shadow:0 0 6px rgba(205,168,78,.25)}",
  ".vle-chip.more{opacity:.5;font-family:'JetBrains Mono',monospace;font-size:9px}",
  ".vle-rels{display:flex;flex-direction:column;gap:4px}",
  ".vle-rel{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;padding:4px 8px;border-left:2px solid var(--vle-gold-soft);background:rgba(20,18,14,.35);border-radius:0 6px 6px 0}",
  ".vle-rel-cat{font:600 9px/1 'JetBrains Mono',monospace;color:var(--vle-gold);opacity:.85;white-space:nowrap}",
  ".vlm-comp-error{padding:8px;font-size:11px;color:#e09090;border:1px solid rgba(201,106,106,.3);border-radius:8px;background:rgba(201,106,106,.08)}",
  ".vlm-comp-error span{opacity:.7;font-size:10px}",
].join('\n');
