import type { LlmMessageDTO } from 'lumiverse-spindle-types';

/**
 * Return only provider-visible prose. Hidden reasoning is deliberately ignored,
 * even when content is empty, so a style preview can never display chain of
 * thought as if it were the generated paragraph.
 */
export function visiblePreviewContent(response: unknown): string | null {
  const content = response && typeof response === 'object' && typeof (response as { content?: unknown }).content === 'string'
    ? (response as { content: string }).content.trim() : '';
  if (!content) return null;
  const cleaned = content
    .replace(/<reverie>[\s\S]*?<\/reverie>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<vellum>[\s\S]*?<\/vellum>/gi, '')
    .replace(/^```(?:markdown|md|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return cleaned || null;
}

/** Render a bounded, readable snapshot of the exact host dry-run messages. */
export function formatDryRunMessages(messages: readonly LlmMessageDTO[], maxChars = 48_000): string {
  return messages.map((message) => {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    return `[${message.role}]\n${content}`;
  }).join('\n\n').slice(0, Math.max(0, maxChars));
}
