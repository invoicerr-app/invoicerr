/**
 * ComplianceService — the application facade exposing ONE method per lifecycle operation
 * (COMPLIANCE_ARCHITECTURE.md §11). Every type of issuance, sending, modification, correction,
 * cancellation, response, reception, reporting and payment is anticipated here. Bodies wire the
 * existing machinery (engine, executor, state machine, registries) where it exists, and log TODO
 * where an external integration or DB is still required. A NestJS service will wrap this and back the
 * store with Prisma.
 */
import { randomUUID, createHash } from 'node:crypto';
import { TransactionContext } from '../canonical/canonical-document';
import { primaryObligation, resolve } from '../engine/compliance-engine';
import { ComplianceExecutor, defaultExecutor } from '../execution/executor';
import { ComplianceLogger, defaultLogger } from '../execution/logger';
import {
  AuthorityIdentifier,
  ExecutionResult,
  FormatBuildError,
  FormatValidationError,
  SignedArtifact,
  TransmissionResult,
} from '../execution/types';
import { AuthorityRangeSource, defaultAuthorityRangeSource } from '../lifecycle/authority-range-source';
import { defaultCorrectionRegistry, CorrectionRegistry } from '../lifecycle/corrections';
import { defaultNumberingRegistry, NumberingRegistry } from '../lifecycle/numbering';
import { defaultResponseTracker, ResponseTracker } from '../lifecycle/response';
import { ComplianceEvent, ComplianceStateMachine, ComplianceStatus } from '../lifecycle/state-machine';
import { defaultArchiveRegistry, ArchiveProviderRegistry } from '../providers/archive/registry';
import { defaultFormatRegistry, FormatProviderRegistry } from '../providers/format/registry';
import {
  defaultTransmissionRegistry,
  TransmissionProviderRegistry,
} from '../providers/transmission/registry';
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
  /** F-9: resolves the AUTHORITY_RANGE range a company holds for a series. Defaults to the
   * offline-safe Null source (no range ever configured) — inject a config-backed / live source to
   * actually enable MX/CL issuance. */
  rangeSource?: AuthorityRangeSource;
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

/**
 * F-4: TransmissionStatus values that count as "the channel actually accepted the document".
 * SKIPPED (never attempted — no config/provider) and REJECTED (attempted, refused) do NOT count.
 * QUEUED is a mid-status used by sendStatus()/poll() lifecycle pushes, not the initial send() —
 * excluded here deliberately so a plain "we queued it locally" cannot masquerade as delivery.
 */
const ACCEPTED_TRANSMISSION_STATUSES: ReadonlySet<TransmissionResult['status']> = new Set([
  'SENT',
  'PENDING',
  'CLEARED',
]);

export class ComplianceService {
  private readonly store: ComplianceDocumentStore;
  private readonly executor: ComplianceExecutor;
  private readonly log: ComplianceLogger;
  private readonly numbering: NumberingRegistry;
  private readonly rangeSource: AuthorityRangeSource;
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
    this.rangeSource = deps.rangeSource ?? defaultAuthorityRangeSource;
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

  private async transition(
    rec: ComplianceDocumentRecord,
    event: ComplianceEvent,
    detail?: string,
    actor?: string,
  ): Promise<ComplianceDocumentRecord> {
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

  /**
   * Create an editable draft (no compliance obligations attached yet).
   *
   * @param correctsId M-4: the id of the ComplianceDocument this one corrects, when the caller
   * already knows it (e.g. InvoicesService.correctInvoice() resolving the original's
   * ComplianceDocument before creating the correction's). Threaded straight to
   * ComplianceDocumentRecord.correctsId so a national builder (PL's faktura korygująca) and the
   * runtime can trace a correction back to what it corrects without a second lookup.
   */
  async createDraft(
    ctx: TransactionContext,
    kind: DocumentKind = 'INVOICE',
    invoiceId?: string,
    correctsId?: string,
  ): Promise<ComplianceDocumentRecord> {
    return this.createRecord(ctx, kind, 'OUTBOUND', correctsId, invoiceId);
  }

  /** Free edit — allowed ONLY in DRAFT (immutability after issuance is enforced here). */
  async editDraft(id: string, ctx: TransactionContext): Promise<ComplianceDocumentRecord> {
    const rec = await this.require(id);
    if (!new ComplianceStateMachine(rec.status).canEdit()) {
      throw new Error(`Cannot edit document "${id}" in status ${rec.status}; issue a correction instead.`);
    }
    return this.store.update(id, {
      ctx,
      events: [...rec.events, { id: randomUUID(), type: 'EDITED', at: now(), actor: 'system' }],
    });
  }

  /** Freeze the draft: resolve the plan, assign the number, hash-chain, transition DRAFT → ISSUED. */
  async issue(id: string): Promise<IssueResult> {
    const rec = await this.require(id);
    if (rec.status !== 'DRAFT') throw new Error(`Only DRAFT documents can be issued (was ${rec.status}).`);
    const plan = resolve(rec.ctx);

    const series = `${rec.ctx.supplier.countryCode}-${rec.kind}`;
    // F-9: hydrate the AUTHORITY_RANGE pool from the injected range source before allocating (no-op
    // for GAPLESS_SELF / once already loaded).
    await this.numbering.ensureRange(
      plan.numbering.model,
      rec.ctx.supplierCompanyId,
      series,
      this.log,
      this.rangeSource,
    );

    let number: string;
    try {
      number = this.numbering.get(plan.numbering.model).next(series, plan.numbering, this.log).value;
    } catch (e) {
      // F-9: a numbering failure now HARD-BLOCKS issuance — the document must never reach ISSUED
      // with `number: undefined` (the old behavior: warn and continue). It stays DRAFT (a legal
      // pre-issue state) with the reason recorded as a first-class event, and the error is rethrown
      // so the caller cannot silently treat this as success (aligned with the F-4 sincerity
      // principle: don't swallow a real failure into a log line).
      const reason = (e as Error).message;
      await this.store.update(id, {
        events: [
          ...rec.events,
          { id: randomUUID(), type: 'ISSUE_BLOCKED', at: now(), actor: 'system', detail: reason },
        ],
      });
      this.log.warn('operations/issue', `numbering blocked: ${reason}`);
      throw new Error(`Cannot issue document "${id}": ${reason}`);
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

  /**
   * QUEUE_IMPL_PLAN.md §5.1 — the "transmit" half of `send()`, extracted so the real event-sourced
   * path (`TransmitProcessor` → `ApplySignalService.apply()`) can drive the exact same honesty logic
   * (F-4: accepted somewhere vs TRANSMISSION_FAIL) without going through `send()`'s own
   * `ComplianceStateMachine` transitions. `send()` below is unchanged in signature/behavior — it
   * still calls this internally — so the ~120 specs that call `send()` directly keep passing.
   *
   * Does NOT persist anything (no store.update, no transition) — the caller decides how to apply the
   * outcome (send() via ComplianceStateMachine; the processor via ApplySignalService/LifecycleRuntime).
   */
  async computeSendOutcome(
    rec: ComplianceDocumentRecord,
    opts: IssueOptions = {},
  ): Promise<{ event: ComplianceEvent; transmitRef?: string; execution: ExecutionResult }> {
    const plan = rec.plan ?? resolve(rec.ctx);
    // M-12a: when the caller doesn't supply an idempotencyKey, derive a STABLE one from the document
    // identity + its CURRENT status, instead of letting the executor fall back to its random default
    // (executor.ts:167 — deliberately random there so unrelated callers never accidentally dedup).
    // `transmitAll` (providers/transmission/registry.ts) keys its in-memory dedup Map on
    // `${idempotencyKeyBase}:${provider.id}:${i}` — a random base means two concurrent/rapid send()
    // calls on the SAME document-in-the-SAME-status never collide, so a genuine double-send (retry
    // race, double-click) re-fires the real transmission. `${rec.id}:${rec.status}` is stable across
    // such a race (same id, same status) but changes the moment the document legitimately transitions
    // (e.g. TRANSMISSION_FAILED → retry, or a fresh ISSUED after a correction) — so a real resend is
    // never suppressed, only an accidental duplicate of the SAME logical send.
    const idempotencyKey = opts.idempotencyKey ?? `${rec.id}:${rec.status}`;
    // F-9 numbering fix: issue() already allocated the ONE authoritative number for this document
    // (before any send() is ever reachable — see issue()'s hard-block on numbering failure). Pass it
    // through so the executor reuses it instead of allocating a second one from the SAME
    // NumberingRegistry singleton (a burned GAPLESS_SELF counter value / a second AUTHORITY_RANGE
    // folio consumed for nothing — the executor's own number was never read downstream anyway).
    // `rec.number` is only absent for a document that somehow reached ISSUED without going through
    // issue() (shouldn't happen) — fall through to allocation rather than crash.
    const execution = await this.executor.execute(rec.ctx, plan, {
      idempotencyKey,
      assignedNumber: rec.number,
    });

    // F-4: "accepted somewhere" means at least one channel came back SENT/PENDING/CLEARED; if every
    // channel was SKIPPED/REJECTED, nothing was actually submitted/delivered — do not pretend
    // otherwise. transmitRef is the accepted channel's authority/transmission ref (used to correlate
    // later polls/callbacks — QUEUE_IMPL_PLAN.md F-2/F-3).
    const acceptedTransmission = execution.transmissions.find((t) =>
      ACCEPTED_TRANSMISSION_STATUSES.has(t.status),
    );

    const event: ComplianceEvent = !acceptedTransmission
      ? 'TRANSMISSION_FAIL'
      : primaryObligation(plan).blocking
        ? 'SUBMIT_CLEARANCE'
        : 'DELIVER';

    return { event, transmitRef: acceptedTransmission?.ref, execution };
  }

  /**
   * M-1: record a first-class, persisted VALIDATION_BLOCKED event for a document whose artifact
   * failed format validation — the executor already aborted before signing/transmission (see
   * ComplianceExecutor.execute()). Mirrors the F-9 sincerity pattern used for numbering failures in
   * issue(): a genuine validation failure is surfaced as an event, never swallowed into a log line.
   * Leaves the document's status untouched (it never reached DELIVERED/PENDING_CLEARANCE/
   * TRANSMISSION_FAILED).
   *
   * Shared by BOTH transmit paths so the event shape lives in ONE place: the sync path (`send()`
   * records then rethrows) and the async path (`TransmitProcessor` records then returns without
   * retrying — a deterministic validation failure must not trigger a BullMQ retry).
   */
  async recordValidationBlocked(id: string, err: FormatValidationError): Promise<ComplianceDocumentRecord> {
    const rec = await this.require(id);
    const reason = err.message;
    const updated = await this.store.update(id, {
      events: [
        ...rec.events,
        {
          id: randomUUID(),
          type: 'VALIDATION_BLOCKED',
          at: now(),
          actor: 'system',
          detail: reason,
          payload: err.failures,
        },
      ],
    });
    this.log.warn('operations/validation', `format validation blocked for ${id}: ${reason}`);
    return updated;
  }

  /**
   * The artifact could not be built at all — record it and stop.
   *
   * Sibling of `recordValidationBlocked`, and deterministic for the same reason: the renderer will
   * refuse the same document from the same data every time, so a queue retry only delays the moment
   * nobody is told. Before this existed the failure escaped as an anonymous library error, was
   * retried three times, and left the document at ISSUED with no event — which is the state a user
   * cannot distinguish from "nothing happened yet".
   */
  async recordBuildFailed(id: string, err: FormatBuildError): Promise<ComplianceDocumentRecord> {
    const rec = await this.require(id);
    const updated = await this.store.update(id, {
      events: [
        ...rec.events,
        {
          id: randomUUID(),
          type: 'BUILD_FAILED',
          at: now(),
          actor: 'system',
          detail: err.message,
          payload: { syntax: err.syntax, role: err.role, details: err.details },
        },
      ],
    });
    this.log.warn('operations/build', `artifact build failed for ${id}: ${err.message}`);
    return updated;
  }

  /**
   * M-2: report a compliance side-effect that failed on a NON-BLOCKING integration path — the
   * invoice-facing caller (e.g. InvoicesService.issueInvoice(), PaymentsService.createPayment())
   * already committed its own write and deliberately does not rethrow, so without this the
   * document's intended transition (issue/send/audit/markPaid…) silently never happens and the
   * document can sit at its current status (often DRAFT) forever with nothing surfaced to the UI.
   * Appends a first-class WIRING_FAILED event — mirrors the F-9/M-1 sincerity pattern (a real
   * failure is a persisted event, never a bare log line) — and leaves status untouched: the
   * document's own state machine never ran here, so there is nothing to transition.
   *
   * MUST NEVER THROW. This is an error *reporter* invoked from inside a caller's non-blocking catch
   * block; if it throws, the original failure gets masked by a new one instead of surfaced. Any
   * problem while recording (unknown document id, a store failure) is logged at `error` and
   * swallowed here — it does not propagate and does not replace the original error the caller is
   * already handling.
   */
  /**
   * P3-T03 — record that this correction must never be transmitted, and why.
   *
   * Written to the log rather than inferred at send time, for a reason that is legal before it is
   * technical: on statuses Refusée and Rejetée the French supplier is REQUIRED to produce an
   * accounting credit note and REQUIRED not to send it. "We did not transmit" is therefore a fact
   * the business may have to evidence, and an append-only event is evidence. A guard that merely
   * refused at send time would leave no trace that the refusal was the correct behaviour.
   */
  async recordTransmissionSuppressed(docId: string, legalRef: string, appliesTo?: string): Promise<void> {
    const rec = await this.store.get(docId);
    if (!rec) {
      this.log.error('operations/suppress', `cannot record suppression — document "${docId}" not found`);
      return;
    }
    await this.store.update(docId, {
      events: [
        ...rec.events,
        {
          id: randomUUID(),
          type: 'TRANSMISSION_SUPPRESSED',
          at: now(),
          actor: 'system',
          detail: appliesTo ? `${appliesTo} — ${legalRef}` : legalRef,
        },
      ],
    });
    this.log.info('operations/suppress', `document ${docId} is internal-only: ${legalRef}`);
  }

  async recordWiringFailure(docId: string, operation: string, err: unknown): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      const rec = await this.store.get(docId);
      if (!rec) {
        this.log.error(
          'operations/wiring',
          `cannot record wiring failure — document "${docId}" not found (operation=${operation}): ${reason}`,
        );
        return;
      }
      await this.store.update(docId, {
        events: [
          ...rec.events,
          {
            id: randomUUID(),
            type: 'WIRING_FAILED',
            at: now(),
            actor: 'system',
            detail: `${operation}: ${reason}`,
          },
        ],
      });
      this.log.error('operations/wiring', `${operation} failed for document "${docId}": ${reason}`);
    } catch (recordingError) {
      // The reporter itself failed (e.g. store.update threw) — log it and return; never throw out
      // of a non-blocking catch block.
      const recordingReason =
        recordingError instanceof Error ? recordingError.message : String(recordingError);
      this.log.error(
        'operations/wiring',
        `failed to record WIRING_FAILED for document "${docId}" (operation=${operation}, original=${reason}): ${recordingReason}`,
      );
    }
  }

  /** Run the full pipeline (build → sign → regime → transmit → archive → report) and move state. */
  async send(id: string, opts: IssueOptions = {}): Promise<SendResult> {
    const rec = await this.require(id);
    // M-12a: guard BEFORE the real network side effect (executor.execute()). Before this guard, a
    // racing double-call (or a resend() on a document that already succeeded) re-fired the real
    // transmission and was only rejected AFTERWARDS, by the state-machine guard inside transition()
    // — too late, the side effect already happened. ISSUED is the normal entry point;
    // TRANSMISSION_FAILED is also accepted so a later resend() can retry a document whose previous
    // send() honestly failed (see the sincerity check below).
    if (rec.status !== 'ISSUED' && rec.status !== 'TRANSMISSION_FAILED') {
      throw new Error(
        `Cannot send document "${id}" in status ${rec.status}; expected ISSUED (or TRANSMISSION_FAILED to retry).`,
      );
    }
    const plan = rec.plan ?? resolve(rec.ctx);
    let outcome: { event: ComplianceEvent; transmitRef?: string; execution: ExecutionResult };
    try {
      outcome = await this.computeSendOutcome(rec, opts);
    } catch (e) {
      if (e instanceof FormatValidationError) {
        // M-1: an artifact failed format validation — the executor already aborted before
        // signing/transmission. Record the first-class VALIDATION_BLOCKED event (shared with the
        // async TransmitProcessor path so the event shape lives in one place), leave the document's
        // status untouched, and rethrow so the caller cannot mistake this for a successful send.
        await this.recordValidationBlocked(id, e);
      }
      throw e;
    }
    const execution = outcome.execution;

    let current = await this.store.update(id, {
      plan,
      authorityIds: [...rec.authorityIds, ...execution.regime.authorityIds],
    });

    if (outcome.event === 'TRANSMISSION_FAIL') {
      const reasons = execution.transmissions.flatMap((t) => t.notes);
      current = await this.transition(
        current,
        'TRANSMISSION_FAIL',
        reasons.length > 0 ? reasons.join('; ') : 'no transmission channel accepted the document',
      );
    } else if (outcome.event === 'SUBMIT_CLEARANCE') {
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
    return { document: current, execution, transmissionFailed: outcome.event === 'TRANSMISSION_FAIL' };
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
    const artifacts = (await this.formats.buildAll(rec.ctx, plan, this.log)) as SignedArtifact[];
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
    // P2-T07 — a lifecycle STATUS is reporting data, not the invoice, so it follows the reporting
    // channel where the profile declares one. Falling back to the invoice channel keeps every
    // profile that does not separate the two behaving exactly as before.
    const spec = plan.reportingChannels?.[0] ?? plan.channels?.[0];
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
    this.log.todo(
      'operations/contingency',
      `issue offline (e.g. BR EPEC) and queue late submission for ${id}`,
    );
    return this.transition(await this.require(id), 'ENTER_CONTINGENCY');
  }

  async resubmitFromContingency(id: string): Promise<ClearanceResult> {
    this.log.todo(
      'operations/contingency',
      `submit the contingency document ${id} now the authority is back`,
    );
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
    const correction = await this.createRecord(
      original.ctx,
      req.kind ?? outcome.newKind,
      'OUTBOUND',
      original.id,
    );
    const updatedOriginal = await this.store.update(original.id, {
      events: [
        ...original.events,
        { id: randomUUID(), type: 'CORRECTION_INITIATED', at: now(), actor: 'system', detail: correction.id },
      ],
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
    const replacement = await this.createRecord(
      cancelled.document.ctx,
      cancelled.document.kind,
      'OUTBOUND',
      id,
    );
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
      return this.store.update(id, {
        events: [
          ...rec.events,
          { id: randomUUID(), type: `STATUS:${event.status}`, at: now(), actor: event.source.toLowerCase() },
        ],
      });
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
    return this.store.update(id, {
      events: [...rec.events, { id: randomUUID(), type: `ACK:${status}`, at: now(), actor: 'system' }],
    });
  }

  // ─────────────────────────── reporting / payment / archive ───────────────────────────

  /** Emit the reporting side-effects for a document (EC Sales List, OSS, e-reporting, SAF-T…). */
  async report(id: string): Promise<ReportResult> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const results = await this.reporting.reportAll(rec.ctx, plan, this.log);
    const next = new ComplianceStateMachine(rec.status).can('REPORT')
      ? await this.transition(rec, 'REPORT')
      : rec;
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
        this.log.warn(
          'operations/markPaid',
          `status transmission skipped for ${id}: ${(e as Error).message}`,
        );
      }
    }

    return this.store.update(id, { events: [...rec.events, ...newEvents] });
  }

  /** Archive the authoritative artifact (retention + residency routing). */
  async archiveDocument(id: string): Promise<ArchiveResult> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const artifacts = (await this.formats.buildAll(rec.ctx, plan, this.log)) as SignedArtifact[];
    const receipt = this.archive.store(artifacts, plan.archival, this.log);
    return { document: rec, receipt };
  }

  /**
   * Pre-flight validation of the document against its format rules — builds every planned
   * artifact and aggregates each provider's real ValidationReport (M-1). Read-only: never mutates
   * the document or blocks anything by itself — callers that need enforcement go through
   * issue()/send(), where ComplianceExecutor.execute() actually aborts on a FormatValidationError.
   */
  async validate(id: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const rec = await this.require(id);
    const plan = rec.plan ?? resolve(rec.ctx);
    const artifacts = await this.formats.buildAll(rec.ctx, plan, this.log); // each provider runs its own validate()
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const a of artifacts) {
      const report = a.validation;
      if (!report) continue;
      if (!report.valid) errors.push(...report.errors.map((e) => `[${a.syntax}/${a.role}] ${e}`));
      if (report.warnings.length)
        warnings.push(...report.warnings.map((w) => `[${a.syntax}/${a.role}] ${w}`));
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  /** Append a custom audit event to a document without any state machine transition. */
  async recordAuditEvent(
    id: string,
    type: string,
    detail?: string,
    actor?: string,
  ): Promise<ComplianceDocumentRecord> {
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

  /** Tenant-scoped variant of {@link list} — see {@link ComplianceDocumentStore.listByCompany}. */
  listByCompany(companyId: string): Promise<ComplianceDocumentRecord[]> {
    return this.store.listByCompany(companyId);
  }
}

export const defaultComplianceService = new ComplianceService();
