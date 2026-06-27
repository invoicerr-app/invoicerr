/** Shared types produced/consumed by the execution layer (COMPLIANCE_ARCHITECTURE.md §10-§12). */
import { Money } from '../canonical/canonical-document';
import { ArtifactRole, ChannelType, DocumentSyntax, RegimeModel, ReportingKind } from '../types';

export interface RenderedArtifact {
  role: ArtifactRole;
  syntax: DocumentSyntax;
  mime: string;
  bytes: Uint8Array;
}

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
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

export type TransmissionStatus =
  | 'SENT'
  | 'QUEUED'
  | 'PENDING'
  | 'CLEARED'
  | 'REJECTED'
  | 'SKIPPED';

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
