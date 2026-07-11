/**
 * Macro-lite resolver for preset prompt budget estimation.
 * 
 * Expands simple macros ({{var::x}}, {{if}}, {{pick}}) to get an honest token
 * estimate without running the host's full macro engine. This is estimation only
 * — we don't have runtime context, so we make reasonable defaults:
 * 
 * - {{var::name}} → look up the variable's current selected value
 * - {{if::X}}A{{else}}B{{/if}} → pick the if-branch (no runtime context)
 * - {{pick::a::b::c}} → pick the first option
 * 
 * Advanced host macros ({{and}}, {{ne}}, etc.) pass through unchanged — we can't
 * resolve them without full context, but they're rare and small.
 */

/**
 * Expand simple macros in preset block content for token estimation.
 * 
 * @param content - Raw block content with macros
 * @param vars - Map of variable names to their current selected values
 * @returns Expanded text (macros replaced with their likely runtime values)
 */
export function expandMacros(content: string, vars: Record<string, string>): string {
  let out = content;
  
  // 1. {{var::name}} -> vars[name] ?? '{{var::name}}' (leave unexpanded if unknown)
  out = out.replace(/\{\{var::(\w+)\}\}/g, (_, name) => vars[name] ?? `{{var::${name}}}`);
  
  // 2. {{if::X}}A{{else}}B{{/if}} -> A (default to if-branch for estimation)
  //    Handle with-else first, then without-else
  out = out.replace(/\{\{if::[^}]+\}\}(.*?)\{\{else\}\}.*?\{\{\/if\}\}/gs, '$1');
  out = out.replace(/\{\{if::[^}]+\}\}(.*?)\{\{\/if\}\}/gs, '$1');
  
  // 3. {{pick::a::b::c}} -> a (first option)
  out = out.replace(/\{\{pick::([^:}]+)(?:::[^}]*)?\}\}/g, '$1');
  
  return out;
}
