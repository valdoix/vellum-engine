export interface PresetRequestScope {
  requestId: string;
  presetId?: string;
  chatId?: string;
}

/** Accept a backend reply only for the latest operation and editor/chat scope. */
export function matchesPresetResponse(payload: unknown, expected: PresetRequestScope): boolean {
  if (!expected.requestId || !payload || typeof payload !== 'object') return false;
  const value = payload as Record<string, unknown>;
  if (String(value.requestId ?? '') !== expected.requestId) return false;
  if (expected.presetId !== undefined && String(value.presetId ?? '') !== expected.presetId) return false;
  if (expected.chatId !== undefined && String(value.chatId ?? '') !== expected.chatId) return false;
  return true;
}
