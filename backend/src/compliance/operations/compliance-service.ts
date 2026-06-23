/**
 * ComplianceService — the application facade exposing ONE method per lifecycle operation
 * (COMPLIANCE_ARCHITECTURE.md §11). Every type of issuance, sending, modification, correction,
 * cancellation, response, reception, reporting and payment is anticipated here. Bodies wire the
 * existing machinery (engine, executor, state machine, registries) where it exists, and log TODO
 * where an external integration or DB is still required. A NestJS service will wrap this and back the
 * store with Prisma.
 */
import { TransactionContext } from '../canonical/canonical-document';
import { resolve } from '../engine/compliance-engine';
import { ComplianceExecutor, defaultExecutor } from '../execution/executor';
import { ComplianceLogger, defaultLogger } from '../execution/logger';
import { AuthorityIdentifier, SignedArtifact } from '../execution/types';
import { defaultCorrectionRegistry, CorrectionRegistry } from '../lifecycle/corrections';
import { defaultNumberingRegistry, NumberingRegistry } from '../lifecycle/numbering';
import { defaultResponseTracker, ResponseTracker } from '../lifecycle/response';
import { ComplianceEvent, ComplianceStateMachine, ComplianceStatus } from '../lifecycle/state-machine';
import { defaultArchiveRegistry, ArchiveProviderRegistry } from '../providers/archive/registry';
import { defaultFormatRegistry, FormatProviderRegistry } from '../providers/format/registry';
import { defaultTransmissionRegistry, TransmissionProviderRegistry } from '../providers/transmission/registry';
import { defaultReportingRegistry, ReportingRegistry } from '../reporting/registry';
import { defaultReceptionService, ReceptionService } from '../reception/reception-service';
import { ChannelType, DocumentKind } from '../types';
import { ComplianceDocumentStore, InMemoryComplianceDocumentStore } from './document-store';
import {
  ArchiveResult,
  CancellationRequest,
  CancellationResult,
  ClearanceResult,
  ComplianceDocumentRecord,
  CorrectionRequest,
  CorrectionResult,
  Direction,
  InboundDocument,
  IssueOptions,
  IssueResult,
  PaymentInfo,
  ReceptionResult,
  ReportResult,
  ResponseEvent,
  SendResult,
  TransmitResult,
} from './types';

export interface ComplianceServiceDeps {
  store?: ComplianceDocumentStore;
  executor?: ComplianceExecutor;
  logger?: ComplianceLogger;
  numbering?: NumberingRegistry;
  corrections?: CorrectionRegistry;
  response?: ResponseTracker;
  reporting?: ReportingRegistry;
  archive?: ArchiveProviderRegistry;
  formats?: FormatProviderRegistry;
  transmission?: TransmissionProviderRegistry;
  reception?: ReceptionService;
}

let counter = 0;
function genId(prefix = 'doc'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}
function now(): string {
  return new Date().toISOString();
}

export class ComplianceService {
  private readonly store: ComplianceDocumentStore;
  private readonly executor: ComplianceExecutor;
  private readonly log: ComplianceLogger;
  private readonly numbering: NumberingRegistry;
  private readonly corrections: CorrectionRegistry;
  private readonly response: ResponseTracker;
  private readonly reporting: ReportingRegistry;
  private readonly archive: ArchiveProviderRegistry;
  private readonly formats: FormatProviderRegistry;
  private readonly transmission: TransmissionProviderRegistry;
  private readonly reception: ReceptionService;

  constructor(deps: ComplianceServiceDeps = {}) {
    this.store = deps.store ?? new InMemoryComplianceDocumentStore();
    this.executor = deps.executor ?? defaultExecutor;
    this.log = deps.logger ?? defaultLogger;
    this.numbering = deps.numbering ?? defaultNumberingRegistry;
    this.corrections = deps.corrections ?? defaultCorrectionRegistry;
    this.response = deps.response ?? defaultResponseTracker;
    this.reporting = deps.reporting ?? defaultReportingRegistry;
    this.archive = deps.archive ?? defaultArchiveRegistry;
    this.formats = deps.formats ?? defaultFormatRegistry;
    this.transmission = deps.transmission ?? defaultTransmissionRegistry;
    this.reception = deps.reception ?? defaultReceptionService;
  }

  // ─────────────────────────── helpers ───────────────────────────

  private createRecord(
    ctx: TransactionContext,
    kind: DocumentKind,
    direction: Direction,
    correctsId?: string,
  ): ComplianceDocumentRecord {
    const ts = now();
    return this.store.save({
      id: genId(),
      kind,
      direction,
      status: 'DRAFT',
      ctx,
      authorityIds: [],
      correctsId,
      events: [{ type: 'CREATED', at: ts }],
      createdAt: ts,
      updatedAt: ts,
    });
  }

  private require(id: string): ComplianceDocumentRecord {
    const rec = this.store.get(id);
    if (!rec) throw new Error(`ComplianceDocument "${id}" not found`);
    return rec;
  }

  private transition(rec: ComplianceDocumentRecord, event: ComplianceEvent, detail?: string): ComplianceDocumentRecord {
    const sm = new ComplianceStateMachine(rec.status);
    sm.apply(event); // throws on illegal transition
    return this.store.update(rec.id, {
      status: sm.status,
      events: [...rec.events, { type: event, at: now(), detail }],
    });
  }

  private hash(ctx: TransactionContext): string {
    this.log.todo('operations/issue', 'compute a real content hash (+ hash-chain link for FR/PT)');
    return `sha256:stub:${JSON.stringify(ctx).length}`;
  }

  // ─────────────────────────── issuance ───────────────────────────

  /** Create an editable draft (no compliance obligations attached yet). */
  createDraft(ctx: TransactionContext, kind: DocumentKind = 'INVOICE'): ComplianceDocumentRecord {
    return this.createRecord(ctx, kind, 'OUTBOUND');
  }

  /** Free edit — allowed ONLY in DRAFT (immutability after issuance is enforced here). */
  editDraft(id: string, ctx: TransactionContext): ComplianceDocumentRecord {
    const rec = this.require(id);
    if (!new ComplianceStateMachine(rec.status).canEdit()) {
      throw new Error(`Cannot edit document "${id}" in status ${rec.status}; issue a correction instead.`);
    }
    return this.store.update(id, { ctx, events: [...rec.events, { type: 'EDITED', at: now() }] });
  }

  /** Freeze the draft: resolve the plan, assign the number, hash-chain, transition DRAFT → ISSUED. */
  issue(id: string): IssueResult {
    const rec = this.require(id);
    if (rec.status !== 'DRAFT') throw new Error(`Only DRAFT documents can be issued (was ${rec.status}).`);
    const plan = resolve(rec.ctx);

    let number: string | undefined;
    const series = `${rec.ctx.supplier.countryCode}-${rec.kind}`;
    try {
      number = this.numbering.get(plan.numbering.model).next(series, plan.numbering, this.log).value;
    } catch (e) {
      this.log.warn('operations/issue', `numbering blocked: ${(e as Error).message}`);
    }

    this.store.update(id, { plan, number, immutableHash: this.hash(rec.ctx) });
    const issued = this.transition(this.require(id), 'ISSUE');
    return { document: issued };
  }

  // ─────────────────────────── sending ───────────────────────────

  /** Run the full pipeline (build → sign → regime → transmit → archive → report) and move state. */
  send(id: string, opts: IssueOptions = {}): SendResult {
    const rec = this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const execution = this.executor.execute(rec.ctx, plan, { idempotencyKey: opts.idempotencyKey });

    let current = this.store.update(id, {
      plan,
      authorityIds: [...rec.authorityIds, ...execution.regime.authorityIds],
    });

    if (plan.regime.blocking) {
      current = this.transition(current, 'SUBMIT_CLEARANCE', 'awaiting clearance');
    } else {
      current = this.transition(current, 'DELIVER');
      if (plan.lifecycle.response) {
        this.response.open(plan.lifecycle.response, rec.ctx.issueDate, this.log);
        current = this.transition(current, 'OPEN_RESPONSE');
      }
    }
    return { document: current, execution };
  }

  /** Convenience: create + issue + send in one call. */
  issueAndSend(ctx: TransactionContext, opts: IssueOptions = {}): SendResult {
    const draft = this.createDraft(ctx, opts.kind ?? 'INVOICE');
    this.issue(draft.id);
    return this.send(draft.id, opts);
  }

  /** Re-transmit an already-issued document (idempotent at the transport layer). */
  resend(id: string, opts: IssueOptions = {}): SendResult {
    this.log.info('operations/resend', `re-transmitting ${id}`);
    return this.send(id, opts);
  }

  /** Force delivery over a single channel (e.g. PRINT a B2C receipt, email a copy). */
  sendViaChannel(id: string, channel: ChannelType): TransmitResult {
    const rec = this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const artifacts = this.formats.buildAll(rec.ctx, plan, this.log) as SignedArtifact[];
    const provider = this.transmission.get(channel);
    if (!provider) {
      this.log.warn('operations/sendViaChannel', `no provider for channel ${channel}`);
      return { document: rec, transmissions: [{ channel, status: 'SKIPPED', notes: ['no provider'] }] };
    }
    const result = provider.transmit(artifacts, rec.ctx, plan, `${id}:${channel}`, this.log);
    return { document: rec, transmissions: [result] };
  }

  // ─────────────────────────── clearance (blocking regimes) ───────────────────────────

  submitForClearance(id: string): ComplianceDocumentRecord {
    this.log.todo('operations/clearance', `enqueue ${id} to the clearance outbox`);
    return this.transition(this.require(id), 'SUBMIT_CLEARANCE');
  }

  pollClearance(id: string): ClearanceResult {
    const rec = this.require(id);
    this.log.todo('operations/clearance', `poll authority for ${id} clearance result`);
    return { document: rec, authorityIds: rec.authorityIds };
  }

  /** Authority authorised the document (UUID/folio/protocol/IRN returned). */
  markCleared(id: string, authorityIds: AuthorityIdentifier[] = []): ClearanceResult {
    const rec = this.require(id);
    const merged = [...rec.authorityIds, ...authorityIds];
    this.store.update(id, { authorityIds: merged });
    const cleared = this.transition(this.require(id), 'CLEAR');
    return { document: cleared, authorityIds: merged };
  }

  markRejected(id: string, reason: string): ComplianceDocumentRecord {
    return this.transition(this.require(id), 'REJECT', reason);
  }

  enterContingency(id: string): ComplianceDocumentRecord {
    this.log.todo('operations/contingency', `issue offline (e.g. BR EPEC) and queue late submission for ${id}`);
    return this.transition(this.require(id), 'ENTER_CONTINGENCY');
  }

  resubmitFromContingency(id: string): ClearanceResult {
    this.log.todo('operations/contingency', `submit the contingency document ${id} now the authority is back`);
    const cleared = this.transition(this.require(id), 'CLEAR');
    return { document: cleared, authorityIds: cleared.authorityIds };
  }

  // ─────────────────────────── modification / corrections ───────────────────────────

  /** Correct an issued document via the profile's correction model (credit note / corrective / replace). */
  correct(id: string, req: CorrectionRequest = {}): CorrectionResult {
    const original = this.require(id);
    const plan = original.plan ?? resolve(original.ctx);
    const strategy = this.corrections.get(plan.lifecycle.correctionModel);
    const outcome = strategy.correct(original.id, original.ctx, this.log);
    const correction = this.createRecord(original.ctx, req.kind ?? outcome.newKind, 'OUTBOUND', original.id);
    const updatedOriginal = this.store.update(original.id, {
      events: [...original.events, { type: 'CORRECTION_INITIATED', at: now(), detail: correction.id }],
    });
    return { original: updatedOriginal, correction };
  }

  issueCreditNote(id: string, req: CorrectionRequest = {}): CorrectionResult {
    return this.correct(id, { ...req, kind: 'CREDIT_NOTE' });
  }

  issueDebitNote(id: string, req: CorrectionRequest = {}): CorrectionResult {
    return this.correct(id, { ...req, kind: 'DEBIT_NOTE' });
  }

  issueCorrectiveInvoice(id: string, req: CorrectionRequest = {}): CorrectionResult {
    return this.correct(id, { ...req, kind: 'CORRECTIVE_INVOICE' });
  }

  /** Cancel an issued document, gated by the profile's cancellation policy (window/ack/consent). */
  cancel(id: string, req: CancellationRequest = {}): CancellationResult {
    const rec = this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const pol = plan.lifecycle.cancellation;
    if (!pol.allowed) {
      return { document: rec, accepted: false, reason: 'Cancellation not allowed; issue a credit note.' };
    }
    if (pol.requiresBuyerConsent && !req.buyerConsent) {
      return { document: rec, accepted: false, reason: 'Buyer consent required to cancel.' };
    }
    if (pol.requiresAuthorityAck) {
      this.log.todo('operations/cancel', `request authority cancellation acknowledgement for ${id}`);
    }
    const cancelled = this.transition(rec, 'CANCEL', req.reason);
    return { document: cancelled, accepted: true };
  }

  /** Cancel the original and issue a replacement (clearance systems with substitution). */
  cancelAndReplace(id: string, req: CancellationRequest = {}): CorrectionResult {
    const cancelled = this.cancel(id, { ...req, buyerConsent: true });
    const replacement = this.createRecord(cancelled.document.ctx, cancelled.document.kind, 'OUTBOUND', id);
    return { original: cancelled.document, correction: replacement };
  }

  // ─────────────────────────── bidirectional response ───────────────────────────

  openResponseWindow(id: string): ComplianceDocumentRecord {
    const rec = this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    this.response.open(plan.lifecycle.response, rec.ctx.issueDate, this.log);
    return this.transition(rec, 'OPEN_RESPONSE');
  }

  /** Record an inbound buyer/authority status (accept / refuse / dispute / national status). */
  applyResponse(id: string, event: ResponseEvent): ComplianceDocumentRecord {
    this.response.applyStatus(event.status, this.log);
    const map: Record<string, ComplianceEvent> = { ACCEPT: 'ACCEPT', REFUSE: 'REFUSE', DISPUTE: 'DISPUTE' };
    const transition = map[event.status.toUpperCase()];
    if (!transition) {
      // National status with no state change (e.g. FR "encaissée") — record it only.
      const rec = this.require(id);
      return this.store.update(id, { events: [...rec.events, { type: `STATUS:${event.status}`, at: now() }] });
    }
    return this.transition(this.require(id), transition, event.status);
  }

  /** Fired by the scheduler when the response deadline elapses (silence = acceptance in CL/CO/FR). */
  handleResponseTimeout(id: string): ComplianceDocumentRecord {
    const rec = this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const window = this.response.open(plan.lifecycle.response, rec.ctx.issueDate, this.log);
    if (this.response.onSilence(window, this.log) === 'ACCEPTED') {
      return this.transition(rec, 'ACCEPT', 'silence=acceptance');
    }
    return rec;
  }

  // ─────────────────────────── inbound reception ───────────────────────────

  /** Receive an e-invoice addressed to us (we are the buyer). */
  receive(inbound: InboundDocument): ReceptionResult {
    const ingest = this.reception.ingest(inbound, this.log);
    const ts = now();
    const record = this.store.save({
      id: genId('in'),
      kind: 'INVOICE',
      direction: 'INBOUND',
      status: 'DELIVERED',
      ctx: ingest.canonical,
      authorityIds: [],
      events: [{ type: 'RECEIVED', at: ts }],
      createdAt: ts,
      updatedAt: ts,
    });
    return { document: record, validation: ingest.validation };
  }

  /** Emit the mandated buyer-side acknowledgement for a received document. */
  acknowledgeInbound(id: string, status: string): ComplianceDocumentRecord {
    const rec = this.require(id);
    this.reception.emitBuyerStatus(status, this.log);
    return this.store.update(id, { events: [...rec.events, { type: `ACK:${status}`, at: now() }] });
  }

  // ─────────────────────────── reporting / payment / archive ───────────────────────────

  /** Emit the reporting side-effects for a document (EC Sales List, OSS, e-reporting, SAF-T…). */
  report(id: string): ReportResult {
    const rec = this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const results = this.reporting.reportAll(rec.ctx, plan, this.log);
    const next = new ComplianceStateMachine(rec.status).can('REPORT') ? this.transition(rec, 'REPORT') : rec;
    return { document: next, results };
  }

  /** Mark paid — triggers payment reporting and the "cashed" status where mandated (FR "encaissée"). */
  markPaid(id: string, info: PaymentInfo = {}): ComplianceDocumentRecord {
    const rec = this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    if (plan.lifecycle.response?.statuses?.includes('encaissée')) {
      this.log.todo('operations/markPaid', `emit "encaissée" status + payment e-reporting for ${id}`);
    }
    return this.store.update(id, {
      events: [...rec.events, { type: 'PAID', at: info.paidAt ?? now() }],
    });
  }

  /** Archive the authoritative artifact (retention + residency routing). */
  archiveDocument(id: string): ArchiveResult {
    const rec = this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const artifacts = this.formats.buildAll(rec.ctx, plan, this.log) as SignedArtifact[];
    const receipt = this.archive.store(artifacts, plan.archival, this.log);
    return { document: rec, receipt };
  }

  /** Pre-flight validation of the document against its format rules. */
  validate(id: string): { valid: boolean; errors: string[]; warnings: string[] } {
    const rec = this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    this.formats.buildAll(rec.ctx, plan, this.log); // each provider runs its own validate()
    this.log.todo('operations/validate', 'aggregate per-artifact ValidationReports');
    return { valid: true, errors: [], warnings: ['validation aggregation is stubbed'] };
  }

  // ─────────────────────────── queries ───────────────────────────

  getDocument(id: string): ComplianceDocumentRecord | null {
    return this.store.get(id);
  }

  getStatus(id: string): ComplianceStatus {
    return this.require(id).status;
  }

  list(): ComplianceDocumentRecord[] {
    return this.store.list();
  }
}

export const defaultComplianceService = new ComplianceService();
