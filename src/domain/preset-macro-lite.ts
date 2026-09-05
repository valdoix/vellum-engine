/**
 * Deterministic macro subset for preset-budget estimation. It resolves the
 * prompt-variable control flow ARGENT uses while leaving host/runtime macros
 * visible. Unknown runtime predicates choose the enabled branch so estimates
 * remain conservative.
 */

function truthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('{{')) return true;
  return !['', '0', 'false', 'off', 'none', 'null', 'undefined'].includes(normalized);
}

function splitArgs(value: string): string[] {
  return value.split('::').map((part) => part.trim());
}

function resolveLeafExpressions(input: string): string {
  let out = input;
  const leaf = /\{\{(eq|ne|and|or|not|includes|lt|gt|lower)::([^{}]*)\}\}/g;
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    out = out.replace(leaf, (_whole, op: string, raw: string) => {
      changed = true;
      const args = splitArgs(raw);
      if (op === 'eq') return args[0] === args[1] ? '1' : '';
      if (op === 'ne') return args[0] !== args[1] ? '1' : '';
      if (op === 'and') return args.every(truthy) ? '1' : '';
      if (op === 'or') return args.some(truthy) ? '1' : '';
      if (op === 'not') return truthy(args[0] ?? '') ? '' : '1';
      if (op === 'includes') return (args[0] ?? '').includes(args[1] ?? '') ? '1' : '';
      if (op === 'lt') return Number(args[0]) < Number(args[1]) ? '1' : '';
      if (op === 'gt') return Number(args[0]) > Number(args[1]) ? '1' : '';
      return (args[0] ?? '').toLowerCase();
    });
    if (!changed) break;
  }
  return out;
}

function macroClose(input: string, start: number): number {
  let depth = 0;
  for (let i = start; i < input.length - 1; i++) {
    if (input.startsWith('{{', i)) { depth++; i++; continue; }
    if (input.startsWith('}}', i)) {
      depth--;
      if (depth === 0) return i + 2;
      i++;
    }
  }
  return -1;
}

function resolveIfBlocks(input: string): string {
  let out = input;
  for (let pass = 0; pass < 100; pass++) {
    const start = out.lastIndexOf('{{if::');
    if (start < 0) break;
    const headerEnd = macroClose(out, start);
    if (headerEnd < 0) break;
    const end = out.indexOf('{{/if}}', headerEnd);
    if (end < 0) break;
    const condition = out.slice(start + '{{if::'.length, headerEnd - 2);
    const body = out.slice(headerEnd, end);
    const elseAt = body.indexOf('{{else}}');
    const yes = elseAt < 0 ? body : body.slice(0, elseAt);
    const no = elseAt < 0 ? '' : body.slice(elseAt + '{{else}}'.length);
    out = out.slice(0, start) + (truthy(condition) ? yes : no) + out.slice(end + '{{/if}}'.length);
  }
  return out;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length - 1; i++) {
    if (value.startsWith('{{', i)) { depth++; i++; continue; }
    if (value.startsWith('}}', i) && depth > 0) { depth--; i++; continue; }
    if (depth === 0 && value.startsWith('::', i)) {
      parts.push(value.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function resolveSwitches(input: string): string {
  let out = input;
  for (let pass = 0; pass < 100; pass++) {
    const start = out.lastIndexOf('{{switch::');
    if (start < 0) break;
    const end = macroClose(out, start);
    if (end < 0) break;
    const raw = out.slice(start + '{{switch::'.length, end - 2);
    const parts = splitTopLevel(raw);
    const selected = (parts.shift() ?? '').trim();
    let replacement = '';
    for (let i = 0; i + 1 < parts.length; i += 2) {
      if (parts[i]!.trim() === selected) { replacement = parts[i + 1]!; break; }
    }
    out = out.slice(0, start) + replacement + out.slice(end);
  }
  return out;
}

export function expandMacros(content: string, vars: Record<string, string>): string {
  let out = content.replace(/\{\{var::(\w+)\}\}/g, (_whole, name: string) => vars[name] ?? `{{var::${name}}}`);
  out = resolveLeafExpressions(out);
  out = resolveIfBlocks(out);
  out = resolveSwitches(out);
  out = resolveLeafExpressions(out);
  return out.replace(/\{\{pick::([^:}]+)(?:::[^}]*)?\}\}/g, '$1');
}
