import protocol from './state-protocol.json';

export type EvidenceMode = keyof typeof protocol.evidenceModes;
export type StateFamilyLayer = keyof typeof protocol.families;
export type StateWireShape = keyof typeof protocol.wireShapes;

export interface EngineValidationCapabilities {
  providerEvidenceFields: 'include' | 'omit';
  requireEvidence: boolean;
  validateEvidenceGrounding: boolean;
  validateCanon: boolean;
  validateChronology: boolean;
  validateCausality: boolean;
  validateIdentity: boolean;
}

function assertProtocol(): void {
  if (!Number.isSafeInteger(protocol.version) || protocol.version < 1) throw new Error('State protocol version must be a positive integer');
  for (const mode of ['evidence', 'none'] as const) {
    const capabilities = protocol.evidenceModes[mode];
    if (!capabilities) throw new Error(`State protocol is missing Engine Pass mode: ${mode}`);
    // No-evidence is a quotation policy, never a semantic-safety bypass.
    for (const gate of ['validateCanon', 'validateChronology', 'validateCausality', 'validateIdentity'] as const) {
      if (!capabilities[gate]) throw new Error(`Engine Pass mode ${mode} must keep ${gate} enabled`);
    }
  }
  for (const [layer, families] of Object.entries(protocol.families)) {
    for (const [family, descriptor] of Object.entries(families)) {
      if (!descriptor.ownership || !descriptor.omission || !descriptor.identity || !descriptor.evidence) {
        throw new Error(`Incomplete state protocol descriptor: ${layer}.${family}`);
      }
    }
  }
}

assertProtocol();

/** Executable wire-protocol registry shared by runtime code and preset builders. */
export const STATE_PROTOCOL = protocol;
export const STATE_PROTOCOL_VERSION = protocol.version as 4;
export const STATE_DELTA_FAMILIES = Object.freeze(Object.keys(protocol.families.delta));
export const STATE_EXTENSION_FAMILIES = Object.freeze(Object.keys(protocol.families.extension));
export const SUBPLOT_TITLE_CONTRACT = protocol.subplotTitleContract;

export function engineValidationCapabilities(mode: EvidenceMode = 'evidence'): EngineValidationCapabilities {
  return protocol.evidenceModes[mode] as EngineValidationCapabilities;
}

export function stateFamilyContract(layer: StateFamilyLayer, family: string) {
  return (protocol.families[layer] as Record<string, { ownership: string; omission: string; identity: string; evidence: string }>)[family];
}
