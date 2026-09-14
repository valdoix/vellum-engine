/** Machine ids and display titles are deliberately separate. Subplot ids stay
 * stable snake_case references; titles are short, human-facing story hooks. */
const ID_SHAPE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

function words(value: string): string[] {
  return value.normalize('NFKC').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ').replace(/[^\p{L}\p{N}'’]+/gu, ' ').trim()
    .split(/\s+/u).filter(Boolean);
}

/** VELLUM's display convention: every word is capitalized ("This Is A Title"). */
export function subplotTitleCase(value: string): string {
  return words(value).map(word => /^[A-Z0-9]{2,5}$/.test(word)
    ? word
    : word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase()).join(' ');
}

export function machineSubplotTitle(value: string | undefined, id: string): boolean {
  const title = String(value ?? '').trim();
  return !title || title.toLocaleLowerCase() === id.trim().toLocaleLowerCase() || ID_SHAPE.test(title);
}

/** Deterministic fallback for providers that omit a creative title. The model is
 * still asked to author one; these story-shaped hooks prevent internal ids from
 * ever leaking into the UI or persisted derived state. */
export function creativeSubplotTitle(input: { id: string; name?: string; gist?: string; who?: string; where?: string }): string {
  if (!machineSubplotTitle(input.name, input.id)) return subplotTitleCase(input.name!);
  const text = `${input.gist ?? ''} ${input.who ?? ''} ${input.where ?? ''}`.toLocaleLowerCase();
  if (/\b(?:flee|flees|fleeing|escape|escapes|run|running|evade)\b/u.test(text)) return 'No Safe Road Home';
  if (/\b(?:destroy|destroys|destroyed|wreck|wrecked|shatter|shattered|ruin|ruined)\b/u.test(text)) return 'Ashes Of The Broken Mask';
  if (/\b(?:shelter|protect|protects|guard|guards|hide|hides|safe)\b/u.test(text)) return 'A Shelter Against The Dark';
  if (/\b(?:raid|raids|hunt|hunts|patrol|patrols|pursue|pursues|gang|biker)\b/u.test(text)) return 'Engines In The Night';
  if (/\b(?:search|searches|investigate|investigates|track|tracks|follow|follows)\b/u.test(text)) return 'The Trail Beneath The Silence';
  if (/\b(?:secret|message|letter|warning|whisper|whispers|rumor|rumour)\b/u.test(text)) return 'Whispers Before Dawn';
  if (/\b(?:ritual|spell|magic|curse|prophecy|portal)\b/u.test(text)) return 'The Hour Of Hidden Fire';
  if (/\b(?:deal|bargain|trade|alliance|meeting|negotiate)\b/u.test(text)) return 'Promises With A Price';
  const ignored = new Set(['about', 'after', 'again', 'against', 'along', 'around', 'because', 'before', 'being', 'could', 'from', 'into', 'their', 'there', 'these', 'they', 'this', 'through', 'under', 'until', 'where', 'while', 'with', 'would']);
  const anchor = words(input.gist ?? '').find(word => word.length >= 5 && !ignored.has(word.toLocaleLowerCase()));
  return anchor ? `Shadows Over ${subplotTitleCase(anchor)}` : 'A Thread In The Dark';
}
