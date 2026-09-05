import { renderArtifact } from '../domain/artifacts.js';
import { hashStr } from '../core/ids.js';

export function installArtifacts(ctx: import('lumiverse-spindle-types').SpindleFrontendContext): () => void {
  const widgets = new Map<string, () => void>();
  const off = ctx.messages?.registerTagInterceptor?.({ tagName: 'artifact', removeFromMessage: true }, event => {
    if (!event.messageId || event.isUser || event.isStreaming) return;
    const html = renderArtifact(event.content);
    if (!html) return;
    const widgetId = 'argent-' + hashStr(event.content);
    const key = event.messageId + ':' + widgetId;
    if (widgets.has(key)) return;
    widgets.set(key, ctx.messages.renderWidget({ messageId: event.messageId, widgetId, html, minHeight: 100, maxHeight: 1800 }));
  });
  return () => { off?.(); for (const dispose of widgets.values()) dispose(); widgets.clear(); };
}
