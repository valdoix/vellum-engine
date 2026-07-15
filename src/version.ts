/**
 * SINGLE SOURCE OF TRUTH for the extension version string. `vellum_ping` and any
 * other in-code reference read this instead of hard-coding a literal, so they
 * can't drift. Keep this in sync with the `version` field in `spindle.json` and
 * `package.json` when cutting a release (currently 2.1.0-beta.4).
 */
export const VELLUM_VERSION = '2.1.0-beta.4';
