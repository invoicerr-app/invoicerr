/**
 * ComplianceService — the application facade exposing ONE method per lifecycle operation
 * (COMPLIANCE_ARCHITECTURE.md §11). Every type of issuance, sending, modification, correction,
 * cancellation, response, reception, reporting and payment is anticipated here. Bodies wire the
 * existing machinery (engine, executor, state machine, registries) where it exists, and log TODO
 * where an external integration or DB is still required. A NestJS service will wrap this and back the
 * store with Prisma.
 */
import { randomUUID, createHash } from 'crypto';
import { TransactionContext } from '../canonical/canonical-document';
import { resolve } from '../engine/compliance-engine';
import { ComplianceExecutor, defaultExecutor } from '../execution/executor';
import { ComplianceLogger, defaultLogger } from '../execution/logger';
import { AuthorityIdentifier, SignedArtifact, TransmissionResult } from '../execution/types';
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

  private async createRecord(
    ctx: TransactionContext,
    kind: DocumentKind,
    direction: Direction,
    correctsId?: string,
    invoiceId?: string,
  ): Promise<ComplianceDocumentRecord> {
    const ts = now();
    return this.store.save({
      id: genId(),
      kind,
      direction,
      status: 'DRAFT',
      ctx,
      authorityIds: [],
      correctsId,
      invoiceId,
      events: [{ id: randomUUID(), type: 'CREATED', at: ts, actor: 'system' }],
      createdAt: ts,
      updatedAt: ts,
    });
  }

  private async require(id: string): Promise<ComplianceDocumentRecord> {
    const rec = await this.store.get(id);
    if (!rec) throw new Error(`ComplianceDocument "${id}" not found`);
    return rec;
  }

  private async transition(rec: ComplianceDocumentRecord, event: ComplianceEvent, detail?: string, actor?: string): Promise<ComplianceDocumentRecord> {
    const sm = new ComplianceStateMachine(rec.status);
    sm.apply(event); // throws on illegal transition
    return this.store.update(rec.id, {
      status: sm.status,
      events: [...rec.events, { id: randomUUID(), type: event, at: now(), actor: actor ?? 'system', detail }],
    });
  }

  private hash(ctx: TransactionContext, previousHash?: string): string {
    const input = JSON.stringify(ctx) + (previousHash ?? '');
    return `sha256:${createHash('sha256').update(input, 'utf8').digest('hex')}`;
  }

  // ─────────────────────────── issuance ───────────────────────────

  /** Create an editable draft (no compliance obligations attached yet). */
  async createDraft(ctx: TransactionContext, kind: DocumentKind = 'INVOICE', invoiceId?: string): Promise<ComplianceDocumentRecord> {
    return this.createRecord(ctx, kind, 'OUTBOUND', undefined, invoiceId);
  }

  /** Free edit — allowed ONLY in DRAFT (immutability after issuance is enforced here). */
  async editDraft(id: string, ctx: TransactionContext): Promise<ComplianceDocumentRecord> {
    const rec = await this.require(id);
    if (!new ComplianceStateMachine(rec.status).canEdit()) {
      throw new Error(`Cannot edit document "${id}" in status ${rec.status}; issue a correction instead.`);
    }
    return this.store.update(id, { ctx, events: [...rec.events, { id: randomUUID(), type: 'EDITED', at: now(), actor: 'system' }] });
  }

  /** Freeze the draft: resolve the plan, assign the number, hash-chain, transition DRAFT → ISSUED. */
  async issue(id: string): Promise<IssueResult> {
    const rec = await this.require(id);
    if (rec.status !== 'DRAFT') throw new Error(`Only DRAFT documents can be issued (was ${rec.status}).`);
    const plan = resolve(rec.ctx);

    let number: string | undefined;
    const series = `${rec.ctx.supplier.countryCode}-${rec.kind}`;
    try {
      number = this.numbering.get(plan.numbering.model).next(series, plan.numbering, this.log).value;
    } catch (e) {
      this.log.warn('operations/issue', `numbering blocked: ${(e as Error).message}`);
    }

    // Hash-chain: find the previous document in the series and link to it
    let immutableHash: string;
    let previousHash: string | undefined;
    const previous = await this.store.findLastInSeries(series);
    if (previous && previous.immutableHash) {
      previousHash = previous.immutableHash;
      immutableHash = this.hash(rec.ctx, previousHash);
    } else {
      immutableHash = this.hash(rec.ctx);
    }

    await this.store.update(id, { plan, number, immutableHash, previousHash });
    const issued = await this.transition(await this.require(id), 'ISSUE');
    // Archive the issued document for conservation (providers are stubs — non-blocking)
    try {
      await this.archiveDocument(id);
    } catch {
      this.log.warn('operations/issue', `archival skipped for ${id}`);
    }
    return { document: issued };
  }

  // ─────────────────────────── sending ───────────────────────────

  /** Run the full pipeline (build → sign → regime → transmit → archive → report) and move state. */
  async send(id: string, opts: IssueOptions = {}): Promise<SendResult> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const execution = await this.executor.execute(rec.ctx, plan, { idempotencyKey: opts.idempotencyKey });

    let current = await this.store.update(id, {
      plan,
      authorityIds: [...rec.authorityIds, ...execution.regime.authorityIds],
    });

    if (plan.regime.blocking) {
      current = await this.transition(current, 'SUBMIT_CLEARANCE', 'awaiting clearance');
    } else {
      current = await this.transition(current, 'DELIVER');
      if (plan.lifecycle.response) {
        this.response.open(plan.lifecycle.response, rec.ctx.issueDate, this.log);
        current = await this.transition(current, 'OPEN_RESPONSE');
      }
    }
    // Archive after delivery/clearance (non-blocking, stubs for now)
    try {
      await this.archiveDocument(id);
    } catch {
      this.log.warn('operations/send', `archival skipped for ${id}`);
    }
    return { document: current, execution };
  }

  /** Convenience: create + issue + send in one call. */
  async issueAndSend(ctx: TransactionContext, opts: IssueOptions = {}): Promise<SendResult> {
    const draft = await this.createDraft(ctx, opts.kind ?? 'INVOICE');
    await this.issue(draft.id);
    return this.send(draft.id, opts);
  }

  /** Re-transmit an already-issued document (idempotent at the transport layer). */
  async resend(id: string, opts: IssueOptions = {}): Promise<SendResult> {
    this.log.info('operations/resend', `re-transmitting ${id}`);
    return this.send(id, opts);
  }

  /** Force delivery over a single channel (e.g. PRINT a B2C receipt, email a copy). */
  async sendViaChannel(id: string, channel: ChannelType): Promise<TransmitResult> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const artifacts = await this.formats.buildAll(rec.ctx, plan, this.log) as SignedArtifact[];
    const provider = this.transmission.get(channel);
    if (!provider) {
      this.log.warn('operations/sendViaChannel', `no provider for channel ${channel}`);
      return { document: rec, transmissions: [{ channel, status: 'SKIPPED', notes: ['no provider'] }] };
    }
    const result = await provider.transmit(artifacts, rec.ctx, plan, `${id}:${channel}`, this.log);
    return { document: rec, transmissions: [result] };
  }

  /** Push a lifecycle status (e.g. FR "encaissée") to the primary channel that supports outbound status. */
  async transmitStatus(id: string, status: string): Promise<TransmissionResult | null> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const spec = plan.channels?.[0];
    const provider = spec ? this.transmission.resolve(spec) : null;
    if (!provider?.sendStatus) {
      this.log.todo('operations/transmitStatus', `no outbound-status channel for "${status}" on ${id}`);
      return null;
    }
    return Promise.resolve(provider.sendStatus(id, status, rec.ctx, plan, this.log));
  }

  // ─────────────────────────── clearance (blocking regimes) ───────────────────────────

  async submitForClearance(id: string): Promise<ComplianceDocumentRecord> {
    this.log.todo('operations/clearance', `enqueue ${id} to the clearance outbox`);
    return this.transition(await this.require(id), 'SUBMIT_CLEARANCE');
  }

  async pollClearance(id: string): Promise<ClearanceResult> {
    const rec = await this.require(id);
    this.log.todo('operations/clearance', `poll authority for ${id} clearance result`);
    return { document: rec, authorityIds: rec.authorityIds };
  }

  /** Authority authorised the document (UUID/folio/protocol/IRN returned). */
  async markCleared(id: string, authorityIds: AuthorityIdentifier[] = []): Promise<ClearanceResult> {
    const rec = await this.require(id);
    const merged = [...rec.authorityIds, ...authorityIds];
    await this.store.update(id, { authorityIds: merged });
    const cleared = await this.transition(await this.require(id), 'CLEAR');
    return { document: cleared, authorityIds: merged };
  }

  async markRejected(id: string, reason: string): Promise<ComplianceDocumentRecord> {
    return this.transition(await this.require(id), 'REJECT', reason);
  }

  async enterContingency(id: string): Promise<ComplianceDocumentRecord> {
    this.log.todo('operations/contingency', `issue offline (e.g. BR EPEC) and queue late submission for ${id}`);
    return this.transition(await this.require(id), 'ENTER_CONTINGENCY');
  }

  async resubmitFromContingency(id: string): Promise<ClearanceResult> {
    this.log.todo('operations/contingency', `submit the contingency document ${id} now the authority is back`);
    const cleared = await this.transition(await this.require(id), 'CLEAR');
    return { document: cleared, authorityIds: cleared.authorityIds };
  }

  // ─────────────────────────── modification / corrections ───────────────────────────

  /** Correct an issued document via the profile's correction model (credit note / corrective / replace). */
  async correct(id: string, req: CorrectionRequest = {}): Promise<CorrectionResult> {
    const original = await this.require(id);
    const plan = original.plan ?? resolve(original.ctx);
    const strategy = this.corrections.get(plan.lifecycle.correctionModel);
    const outcome = strategy.correct(original.id, original.ctx, this.log);
    const correction = await this.createRecord(original.ctx, req.kind ?? outcome.newKind, 'OUTBOUND', original.id);
    const updatedOriginal = await this.store.update(original.id, {
      events: [...original.events, { id: randomUUID(), type: 'CORRECTION_INITIATED', at: now(), actor: 'system', detail: correction.id }],
    });
    return { original: updatedOriginal, correction };
  }

  async issueCreditNote(id: string, req: CorrectionRequest = {}): Promise<CorrectionResult> {
    return this.correct(id, { ...req, kind: 'CREDIT_NOTE' });
  }

  async issueDebitNote(id: string, req: CorrectionRequest = {}): Promise<CorrectionResult> {
    return this.correct(id, { ...req, kind: 'DEBIT_NOTE' });
  }

  async issueCorrectiveInvoice(id: string, req: CorrectionRequest = {}): Promise<CorrectionResult> {
    return this.correct(id, { ...req, kind: 'CORRECTIVE_INVOICE' });
  }

  /** Cancel an issued document, gated by the profile's cancellation policy (window/ack/consent). */
  async cancel(id: string, req: CancellationRequest = {}): Promise<CancellationResult> {
    const rec = await this.require(id);
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
    const cancelled = await this.transition(rec, 'CANCEL', req.reason);
    return { document: cancelled, accepted: true };
  }

  /** Cancel the original and issue a replacement (clearance systems with substitution). */
  async cancelAndReplace(id: string, req: CancellationRequest = {}): Promise<CorrectionResult> {
    const cancelled = await this.cancel(id, { ...req, buyerConsent: true });
    const replacement = await this.createRecord(cancelled.document.ctx, cancelled.document.kind, 'OUTBOUND', id);
    return { original: cancelled.document, correction: replacement };
  }

  // ─────────────────────────── bidirectional response ───────────────────────────

  async openResponseWindow(id: string): Promise<ComplianceDocumentRecord> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    this.response.open(plan.lifecycle.response, rec.ctx.issueDate, this.log);
    return this.transition(rec, 'OPEN_RESPONSE');
  }

  /** Record an inbound buyer/authority status (accept / refuse / dispute / national status). */
  async applyResponse(id: string, event: ResponseEvent): Promise<ComplianceDocumentRecord> {
    this.response.applyStatus(event.status, this.log);
    const map: Record<string, ComplianceEvent> = { ACCEPT: 'ACCEPT', REFUSE: 'REFUSE', DISPUTE: 'DISPUTE' };
    const transition = map[event.status.toUpperCase()];
    if (!transition) {
      // National status with no state change (e.g. FR "encaissée") — record it only.
      const rec = await this.require(id);
      return this.store.update(id, { events: [...rec.events, { id: randomUUID(), type: `STATUS:${event.status}`, at: now(), actor: event.source.toLowerCase() }] });
    }
    return this.transition(await this.require(id), transition, event.status);
  }

  /** Fired by the scheduler when the response deadline elapses (silence = acceptance in CL/CO/FR). */
  async handleResponseTimeout(id: string): Promise<ComplianceDocumentRecord> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const window = this.response.open(plan.lifecycle.response, rec.ctx.issueDate, this.log);
    if (this.response.onSilence(window, this.log) === 'ACCEPTED') {
      return this.transition(rec, 'ACCEPT', 'silence=acceptance');
    }
    return rec;
  }

  // ─────────────────────────── inbound reception ───────────────────────────

  /** Receive an e-invoice addressed to us (we are the buyer). */
  async receive(inbound: InboundDocument): Promise<ReceptionResult> {
    const ingest = this.reception.ingest(inbound, this.log);
    const ts = now();
    const record = await this.store.save({
      id: genId('in'),
      kind: 'INVOICE',
      direction: 'INBOUND',
      status: 'DELIVERED',
      ctx: ingest.canonical,
      authorityIds: [],
      events: [{ id: randomUUID(), type: 'RECEIVED', at: ts, actor: 'system' }],
      createdAt: ts,
      updatedAt: ts,
    });
    return { document: record, validation: ingest.validation };
  }

  /** Emit the mandated buyer-side acknowledgement for a received document. */
  async acknowledgeInbound(id: string, status: string): Promise<ComplianceDocumentRecord> {
    const rec = await this.require(id);
    this.reception.emitBuyerStatus(status, this.log);
    return this.store.update(id, { events: [...rec.events, { id: randomUUID(), type: `ACK:${status}`, at: now(), actor: 'system' }] });
  }

  // ─────────────────────────── reporting / payment / archive ───────────────────────────

  /** Emit the reporting side-effects for a document (EC Sales List, OSS, e-reporting, SAF-T…). */
  async report(id: string): Promise<ReportResult> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const results = this.reporting.reportAll(rec.ctx, plan, this.log);
    const next = new ComplianceStateMachine(rec.status).can('REPORT') ? await this.transition(rec, 'REPORT') : rec;
    return { document: next, results };
  }

  /** Mark paid — triggers payment reporting and the "cashed" status where mandated (FR "encaissée"). */
  async markPaid(id: string, info: PaymentInfo = {}): Promise<ComplianceDocumentRecord> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const paidAt = info.paidAt ?? now();

    const newEvents: Array<{ id: string; type: string; at: string; actor: string }> = [
      { id: randomUUID(), type: 'PAID', at: paidAt, actor: 'system' },
    ];

    if (plan.lifecycle.response?.statuses?.includes('encaissée')) {
      newEvents.push({ id: randomUUID(), type: 'STATUS:encaissée', at: paidAt, actor: 'system' });
      this.reporting.reportAll(rec.ctx, plan, this.log);
      try {
        await this.transmitStatus(id, 'encaissée');
      } catch (e) {
        this.log.warn('operations/markPaid', `status transmission skipped for ${id}: ${(e as Error).message}`);
      }
    }

    return this.store.update(id, { events: [...rec.events, ...newEvents] });
  }

  /** Archive the authoritative artifact (retention + residency routing). */
  async archiveDocument(id: string): Promise<ArchiveResult> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const artifacts = await this.formats.buildAll(rec.ctx, plan, this.log) as SignedArtifact[];
    const receipt = this.archive.store(artifacts, plan.archival, this.log);
    return { document: rec, receipt };
  }

  /** Pre-flight validation of the document against its format rules. */
  async validate(id: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    await this.formats.buildAll(rec.ctx, plan, this.log); // each provider runs its own validate()
    this.log.todo('operations/validate', 'aggregate per-artifact ValidationReports');
    return { valid: true, errors: [], warnings: ['validation aggregation is stubbed'] };
  }

  /** Append a custom audit event to a document without any state machine transition. */
  async recordAuditEvent(id: string, type: string, detail?: string, actor?: string): Promise<ComplianceDocumentRecord> {
    const rec = await this.require(id);
    return this.store.update(id, {
      events: [...rec.events, { id: randomUUID(), type, at: now(), actor: actor ?? 'system', detail }],
    });
  }

  // ─────────────────────────── queries ───────────────────────────

  getDocument(id: string): Promise<ComplianceDocumentRecord | null> {
    return this.store.get(id);
  }

  async getStatus(id: string): Promise<ComplianceStatus> {
    return (await this.require(id)).status;
  }

  list(): Promise<ComplianceDocumentRecord[]> {
    return this.store.list();
  }
}

export const defaultComplianceService = new ComplianceService();
