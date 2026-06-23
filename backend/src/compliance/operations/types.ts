/**
 * Operation-layer types (COMPLIANCE_ARCHITECTURE.md §11/§12). The ComplianceService exposes one
 * method per lifecycle operation (issue, send, correct, cancel, respond, receive, report…); these
 * are the inputs/outputs. The in-memory ComplianceDocumentRecord is the aggregate a real DB layer
 * (Prisma) will later persist.
 */
import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { ComplianceStatus } from '../lifecycle/state-machine';
import {
  ArchiveReceipt,
  AuthorityIdentifier,
  ExecutionResult,
  ReportingResult,
  TransmissionResult,
  ValidationReport,
} from '../execution/types';
import { ChannelType, DocumentKind } from '../types';

export type Direction = 'OUTBOUND' | 'INBOUND';

export interface ComplianceDocumentEvent {
  type: string;
  at: string;
  detail?: string;
}

/** The lifecycle aggregate for one document (issued by us, or received). */
export interface ComplianceDocumentRecord {
  id: string;
  kind: DocumentKind;
  direction: Direction;
  status: ComplianceStatus;
  ctx: TransactionContext;
  plan?: CompliancePlan;
  number?: string;
  immutableHash?: string;
  previousHash?: string;
  authorityIds: AuthorityIdentifier[];
  correctsId?: string; // for credit/corrective documents
  events: ComplianceDocumentEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface IssueOptions {
  kind?: DocumentKind;
  idempotencyKey?: string;
}

export interface IssueResult {
  document: ComplianceDocumentRecord;
}

export interface SendResult {
  document: ComplianceDocumentRecord;
  execution: ExecutionResult;
}

export interface TransmitResult {
  document: ComplianceDocumentRecord;
  transmissions: TransmissionResult[];
}

export interface CorrectionRequest {
  reason?: string;
  kind?: DocumentKind; // override (CREDIT_NOTE / DEBIT_NOTE / CORRECTIVE_INVOICE)
}

export interface CorrectionResult {
  original: ComplianceDocumentRecord;
  correction: ComplianceDocumentRecord;
}

export interface CancellationRequest {
  reason?: string;
  buyerConsent?: boolean;
}

export interface CancellationResult {
  document: ComplianceDocumentRecord;
  accepted: boolean;
  reason?: string;
}

export interface ClearanceResult {
  document: ComplianceDocumentRecord;
  authorityIds: AuthorityIdentifier[];
}

export interface ResponseEvent {
  status: string; // ACCEPT | REFUSE | DISPUTE | a national status (refusée, encaissée…)
  source: 'BUYER' | 'AUTHORITY';
}

export interface InboundDocument {
  channel: ChannelType;
  ctx: TransactionContext;
  raw?: Uint8Array;
}

export interface ReceptionResult {
  document: ComplianceDocumentRecord;
  validation: ValidationReport;
}

export interface PaymentInfo {
  amountMinor?: number;
  paidAt?: string;
  method?: string;
}

export interface ReportResult {
  document: ComplianceDocumentRecord;
  results: ReportingResult[];
}

export interface ArchiveResult {
  document: ComplianceDocumentRecord;
  receipt: ArchiveReceipt;
}
