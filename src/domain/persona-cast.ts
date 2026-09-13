export interface PersonaCastBinding {
  id: string;
  name: string;
}

/** Parse the per-chat cast member explicitly chosen as the player persona. */
export function parsePersonaCastBinding(value: unknown): PersonaCastBinding | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PersonaCastBinding>;
    const id = String(parsed?.id ?? '').trim().slice(0, 200);
    const name = String(parsed?.name ?? '').trim().slice(0, 200);
    return id && name ? { id, name } : null;
  } catch {
    return null;
  }
}

/** A manual cast assignment wins only for {{user}}; {{char}} stays unchanged. */
export function applyPersonaCastBinding(
  names: { user: string; char: string },
  binding: PersonaCastBinding | null,
): { user: string; char: string } {
  return binding ? { ...names, user: binding.name } : names;
}
