/** Shared types produced/consumed by the execution layer (COMPLIANCE_ARCHITECTURE.md §10-§12). */
import { Money } from '../canonical/canonical-document';
import { ArtifactRole, ChannelType, DocumentSyntax, RegimeModel, ReportingKind } from '../types';

export interface RenderedArtifact {
  role: ArtifactRole;
  syntax: DocumentSyntax;
  mime: string;
  bytes: Uint8Array;
  /**
   * M-1 (COMPLIANCE_AUDIT.md): populated by FormatProviderRegistry.buildAll() from
   * provider.validate() — makes format validity a first-class part of the artifact instead of a
   * discarded return value. ComplianceExecutor.execute() reads this to block before sign/transmit.
   */
  validation?: ValidationReport;
}

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * M-1: thrown by ComplianceExecutor.execute() when a built artifact fails format validation (XSD
 * structural invalidity, or Schematron fatal/error-level assertions). Mirrors the F-9 sincerity
 * pattern already used for numbering failures (ComplianceService.issue()): a genuine validation
 * failure must abort the pipeline before signing/transmission, not be swallowed into a log line.
 * Schematron warning-level findings never reach here — they stay on RenderedArtifact.validation
 * .warnings and are surfaced without blocking.
 */
export class FormatValidationError extends Error {
  constructor(
    message: string,
    public readonly failures: Array<{ syntax: DocumentSyntax; role: ArtifactRole; errors: string[] }>,
  ) {
    super(message);
    this.name = 'FormatValidationError';
  }
}

export interface AuthorityIdentifier {
  scheme: string; // UUID | IRN | SDI | CHNFE | CUFE | CDR | PROTOCOL | FOLIO ...
  value: string;
}

export interface SignatureInfo {
  algo: string; // XAdES | CAdES | PAdES | none
  certRef: string;
}

export interface SignedArtifact extends RenderedArtifact {
  signature?: SignatureInfo;
}

export type TransmissionStatus = 'SENT' | 'QUEUED' | 'PENDING' | 'CLEARED' | 'REJECTED' | 'SKIPPED';

export interface TransmissionResult {
  channel: ChannelType;
  status: TransmissionStatus;
  ref?: string;
  authorityIds?: AuthorityIdentifier[];
  notes: string[];
}

export type ReportingStatus = 'EMITTED' | 'QUEUED' | 'SKIPPED';

export interface ReportingResult {
  kind: ReportingKind;
  status: ReportingStatus;
  ref?: string;
  /**
   * True when the payload was generated and persisted but NOT actually submitted to the authority
   * — the submission seam is still a `log.todo`. Without this, `status: 'EMITTED'` was
   * indistinguishable from a real filing, and the only trace of the mock was a log line no caller
   * reads. Audit F-016.
   */
  mocked?: boolean;
}

export interface RegimeResult {
  model: RegimeModel;
  clearanceRequired: boolean;
  cleared: boolean;
  authorityIds: AuthorityIdentifier[];
  notes: string[];
}

export interface ArchiveReceipt {
  providerId: string;
  region: string;
  uri: string;
  retentionUntil: string;
  contentHash: string;
}

export interface MoneyTotals {
  net: Money;
  tax: Money;
  gross: Money;
}

export interface ExecutionResult {
  number?: string;
  totals?: MoneyTotals;
  artifacts: RenderedArtifact[];
  signed: SignedArtifact[];
  regime: RegimeResult;
  transmissions: TransmissionResult[];
  archive?: ArchiveReceipt;
  reporting: ReportingResult[];
  warnings: string[];
}
