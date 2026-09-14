import protocol from './state-protocol.json';

/** Canonical wire-protocol registry shared by runtime code and preset builders. */
export const STATE_PROTOCOL_VERSION = protocol.version as 3;
export const STATE_DELTA_FAMILIES = protocol.deltaFamilies;
export const STATE_EXTENSION_FAMILIES = protocol.extensionFamilies;
export const SUBPLOT_TITLE_CONTRACT = protocol.subplotTitleContract;
