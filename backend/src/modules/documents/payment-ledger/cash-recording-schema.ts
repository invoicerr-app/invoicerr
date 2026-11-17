/**
 * A country's rules for software that records payments from consumers: what it must guarantee,
 * who is out of scope, the attestation a publisher may issue, and the notice that goes with an
 * archive. `countries/data/<cc>.json#cashRecording`. Nothing here is read as a country code in code:
 * the attestation and archive notice are rendered from whatever the company's country file says.
 */

export interface CashRecordingLegalProvenance {
  kind: 'legal';
  sourceText: string;
  sourceCheckedAt: string;
}

export interface CashRecordingUnverifiedProvenance {
  kind: 'unverified';
  resolutionNote: string;
}

export type CashRecordingProvenance = CashRecordingLegalProvenance | CashRecordingUnverifiedProvenance;

export const CASH_RECORDING_CONDITIONS = ['inalterability', 'security', 'retention', 'archiving'] as const;
export type CashRecordingCondition = (typeof CASH_RECORDING_CONDITIONS)[number];

/** Values the attestation renderer fills in; anything else in braces is refused at load time. */
export const ATTESTATION_PLACEHOLDERS = [
  'softwareName',
  'softwareVersion',
  'publisherName',
  'publisherRepresentative',
  'publisherCity',
  'marketedSince',
  'companyName',
  'generatedOn',
] as const;
export type AttestationPlaceholder = (typeof ATTESTATION_PLACEHOLDERS)[number];

export interface CashRecordingRule {
  id: string;
  summary: string;
  provenance: CashRecordingProvenance;
}

export interface AttestationBlock {
  heading?: string;
  text: string;
}

export interface CountryCashRecordingFile {
  countryCode: string;
  obligation: {
    conditions: CashRecordingCondition[];
    summary: string;
    provenance: CashRecordingProvenance;
  };
  /** Who the obligation does not reach. Informational: the ledger is append-only for everyone. */
  exclusions: CashRecordingRule[];
  attestation: {
    /** ISO date from which a publisher attestation is accepted as proof. */
    availableFrom: string;
    provenance: CashRecordingProvenance;
    model: {
      reference: string;
      /** Base name of the downloaded file, without extension. */
      fileName: string;
      blocks: AttestationBlock[];
      provenance: CashRecordingProvenance;
    };
  };
  archive: {
    /** BCP 47 language of `notice`. */
    language: string;
    notice: string;
    provenance: CashRecordingProvenance;
  };
  notes?: string;
}

export class InvalidCashRecordingSectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCashRecordingSectionError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLACEHOLDER = /\{([^{}]*)\}/g;
const FILE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set(ATTESTATION_PLACEHOLDERS);
const KNOWN_CONDITIONS: ReadonlySet<string> = new Set(CASH_RECORDING_CONDITIONS);

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertProvenance(
  provenance: CashRecordingProvenance | undefined,
  where: string,
  fail: (r: string) => never,
) {
  if (!provenance) fail(`${where}: provenance is required`);
  if (provenance.kind === 'legal') {
    if (!nonEmpty(provenance.sourceText)) fail(`${where}: legal provenance needs a sourceText`);
    if (!ISO_DATE.test(provenance.sourceCheckedAt ?? '')) {
      fail(`${where}: legal provenance needs a yyyy-mm-dd sourceCheckedAt`);
    }
    return;
  }
  if (provenance.kind === 'unverified') {
    if (!nonEmpty(provenance.resolutionNote)) fail(`${where}: unverified provenance needs a resolutionNote`);
    return;
  }
  fail(`${where}: unknown provenance kind`);
}

type Fail = (reason: string) => never;

function assertObligation(obligation: CountryCashRecordingFile['obligation'], fail: Fail) {
  if (!obligation || !Array.isArray(obligation.conditions) || obligation.conditions.length === 0) {
    fail('obligation.conditions must list at least one condition');
  }
  for (const condition of obligation.conditions) {
    if (!KNOWN_CONDITIONS.has(condition)) fail(`obligation.conditions: unknown condition "${condition}"`);
  }
  if (!nonEmpty(obligation.summary)) fail('obligation.summary is required');
  assertProvenance(obligation.provenance, 'obligation', fail);
}

function assertExclusions(exclusions: CountryCashRecordingFile['exclusions'], fail: Fail) {
  if (!Array.isArray(exclusions)) fail('exclusions must be an array');
  const ids = new Set<string>();
  for (const rule of exclusions) {
    if (!nonEmpty(rule.id) || ids.has(rule.id)) fail(`exclusions: missing or duplicate id "${rule.id}"`);
    ids.add(rule.id);
    if (!nonEmpty(rule.summary)) fail(`exclusions[${rule.id}].summary is required`);
    assertProvenance(rule.provenance, `exclusions[${rule.id}]`, fail);
  }
}

function assertAttestationModel(
  model: CountryCashRecordingFile['attestation']['model'] | undefined,
  fail: Fail,
) {
  if (!model || !nonEmpty(model.reference)) fail('attestation.model.reference is required');
  if (!FILE_NAME.test(model.fileName ?? ''))
    fail('attestation.model.fileName must be lowercase, digits and dashes');
  if (!Array.isArray(model.blocks) || model.blocks.length === 0) fail('attestation.model.blocks is empty');
  model.blocks.forEach((block, index) => {
    if (!nonEmpty(block.text)) fail(`attestation.model.blocks[${index}].text is required`);
    for (const match of `${block.heading ?? ''}${block.text}`.matchAll(PLACEHOLDER)) {
      if (!KNOWN_PLACEHOLDERS.has(match[1])) {
        fail(`attestation.model.blocks[${index}]: unknown placeholder {${match[1]}}`);
      }
    }
  });
  assertProvenance(model.provenance, 'attestation.model', fail);
}

function assertAttestation(attestation: CountryCashRecordingFile['attestation'], fail: Fail) {
  if (!attestation) fail('attestation is required');
  if (!ISO_DATE.test(attestation.availableFrom ?? '')) fail('attestation.availableFrom must be yyyy-mm-dd');
  assertProvenance(attestation.provenance, 'attestation', fail);
  assertAttestationModel(attestation.model, fail);
}

function assertArchive(archive: CountryCashRecordingFile['archive'], fail: Fail) {
  if (!archive || !nonEmpty(archive.language) || !nonEmpty(archive.notice)) {
    fail('archive.language and archive.notice are required');
  }
  assertProvenance(archive.provenance, 'archive', fail);
}

export function assertValidCashRecordingSection(file: CountryCashRecordingFile, context: string): void {
  const fail: Fail = (reason) => {
    throw new InvalidCashRecordingSectionError(`${context}: ${reason}`);
  };

  assertObligation(file.obligation, fail);
  assertExclusions(file.exclusions, fail);
  assertAttestation(file.attestation, fail);
  assertArchive(file.archive, fail);
}
