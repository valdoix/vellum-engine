import { summarizeFromPlan } from "../src/bus/summarize.js";
import { planChapter } from "../src/domain/memory.js";
import { freshState } from "../src/domain/types.js";

// GENERATION PERMISSION OFF → does fallback look like "short versions of turns"?
(globalThis as any).spindle = {
  permissions: { getGranted: async () => [] },  // no generation
  connections: { list: async () => [] },
  generate: { quiet: async () => ({ content: "SHOULD NOT BE CALLED" }) },
  log: { info(){}, warn(){} },
};

const s = freshState();
s.turns = 10;
for (let i=1;i<=8;i++) s.memories.push({ id:"m"+i, tier:"turn", text:"Turn "+i+": Alice met Bob and they argued about the map.", keys:[], turn:i } as any);
const plan = planChapter(s, 8)!;
const r = await summarizeFromPlan(s, "u1", plan, { user:"Alice", char:"Bob" }, undefined, "chapter");
const rec = r.events.find((e:any)=>e.kind==="memory.record") as any;
console.log("GIST:", JSON.stringify(rec.text));
console.log("DETAIL:", JSON.stringify(rec.detail));
