import fs from 'node:fs';
import path from 'node:path';
import { evaluateArgent } from '../src/eval/argent.js';
import type { internalGenerate } from '../src/host/generation.js';

const endpoint = process.env.ARGENT_EVAL_URL;
const models = (process.env.ARGENT_EVAL_MODELS ?? process.env.ARGENT_EVAL_MODEL ?? '').split(',').map(x => x.trim()).filter(Boolean);
if (!endpoint || !models.length) throw new Error('Set ARGENT_EVAL_URL to a chat-completions endpoint and ARGENT_EVAL_MODEL (or comma-separated ARGENT_EVAL_MODELS). Optional ARGENT_EVAL_KEY stays in the Authorization header.');
const generateFor = (model: string): typeof internalGenerate => async (messages, parameters, _user, options) => {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.ARGENT_EVAL_KEY ? { Authorization: `Bearer ${process.env.ARGENT_EVAL_KEY}` } : {}) }, body: JSON.stringify({ model, messages, ...parameters, ...(options?.responseFormat ? { response_format: options.responseFormat } : {}) }), signal: AbortSignal.timeout(options?.timeoutMs ?? 45000) });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const body = await response.json() as any;
    return { ok: true, value: body.choices?.[0]?.message?.content ?? '' };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
};
const preset = JSON.parse(fs.readFileSync(new URL('../presets/argent-loom.json', import.meta.url), 'utf8'));
const runs = [];
for (const model of models) {
  console.log(`MODEL ${model}`);
  const results = await evaluateArgent(preset.blocks, generateFor(model), r => console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id}: ${r.violations.join('; ')}`));
  runs.push({ model, results });
}
const target = path.resolve('eval/results', `argent-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify({ models, presetVersion: preset.presetVersion, sourceHash: preset.metadata.vellum_engine.sourceHash, live: true, runs }, null, 2) + '\n');
console.log(target);
process.exitCode = runs.some(run => run.results.some(r => !r.pass)) ? 1 : 0;
