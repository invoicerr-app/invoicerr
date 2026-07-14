import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { NumberingRegistry } from '../lifecycle/numbering';
import { ConfigAuthorityRangeSource, NullAuthorityRangeSource } from '../lifecycle/authority-range-source';
import { RecordingComplianceLogger } from '../execution/logger';
import { ComplianceExecutor } from '../execution/executor';
import { TransmissionProvider } from '../providers/transmission/transmission-provider';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { InvoiceMailPort } from '../providers/transmission/invoice-mail-port';
import { ComplianceService } from './compliance-service';
import { InMemoryComplianceDocumentStore } from './document-store';
import { resolve } from '../engine/compliance-engine';

function party(country: string, role: PartyRole): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: role === 'B2B' ? [{ scheme: 'VAT', value: `${country}1`, validated: true }] : [],
  };
}

function ctx(
  supplier: string,
  buyer: string,
  role: PartyRole,
  supply: SupplyType,
  date: string,
): TransactionContext {
  return {
    supplier: party(supplier, 'B2B'),
    buyer: party(buyer, role),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }],
    issueDate: new Date(date),
    currency: 'EUR',
    // M-18: needed for EmailTransmissionProvider's real-send branch (`this.mail && ctx.externalRef`)
    // — without it, EMAIL always falls into the no-port fallback, which is honestly SKIPPED post-M-18.
    externalRef: `${supplier}-${buyer}-${date}`,
  };
}

/** Always-accepting InvoiceMailPort mock — mirrors the real gateway that IS injected in prod. */
function mailMock(): InvoiceMailPort {
  return { sendInvoiceEmail: async () => ({ sent: true }) };
}

/**
 * F-9: pre-configures a generous MX folio range for both the no-company MX() context and the
 * MX_CONFIGURED() ('mx-test-co') context, so the many pre-existing MX tests below (which exercise
 * transmission/clearance/cancellation/archival, NOT numbering) keep reaching ISSUED exactly like
 * before AUTHORITY_RANGE was wired up. Numbering-specific behavior (no range / exhaustion) has its
 * own dedicated describe block further down, using a bare NullAuthorityRangeSource instead.
 */
function mxRangeSource(): ConfigAuthorityRangeSource {
  const src = new ConfigAuthorityRangeSource();
  src.configure(undefined, 'MX-INVOICE', { from: 1, to: 999999 });
  src.configure('mx-test-co', 'MX-INVOICE', { from: 1, to: 999999 });
  return src;
}

function svc() {
  const log = new RecordingComplianceLogger();
  // M-18: EmailTransmissionProvider's no-port fallback is now honestly SKIPPED (never SENT), so a
  // bare registry no longer provides free acceptance for FR/US EMAIL-carrying plans. Wire a mock
  // InvoiceMailPort — matching prod, where the mail gateway IS injected — so these "happy path"
  // tests keep exercising a genuinely-accepted send() instead of relying on the removed lie. MX
  // only ever plans a PAC channel (see F-4 sincerity test below), so it is unaffected by this.
  const transmission = new TransmissionProviderRegistry({ mail: mailMock() });
  const service = new ComplianceService({
    store: new InMemoryComplianceDocumentStore(),
    numbering: new NumberingRegistry(),
    rangeSource: mxRangeSource(),
    executor: new ComplianceExecutor({ logger: log, numbering: new NumberingRegistry(), transmission }),
    logger: log,
  });
  return { service, log };
}

/**
 * F-4: send() is now honest about the transmission outcome, so a MX (PAC) test that wants to reach
 * PENDING_CLEARANCE needs a channel that genuinely accepts the document — `svc()` above has no
 * transmission credentials configured, so PAC always comes back SKIPPED (see the dedicated F-4
 * sincerity test below, which exercises exactly that unconfigured path on purpose). This variant
 * wires a company id + a mocked-but-accepting PAC provider so the "happy path" MX tests keep
 * covering PENDING_CLEARANCE → markCleared → CLEARED like they did before the fix.
 */
function svcMx() {
  const log = new RecordingComplianceLogger();
  const pacMock: TransmissionProvider = {
    id: 'pac',
    channel: 'PAC',
    feedback: 'ASYNC_POLL',
    configSchema: { fields: [] },
    transmit: async () => ({
      channel: 'PAC',
      status: 'CLEARED',
      ref: 'mx-test-co|test-uuid',
      authorityIds: [{ scheme: 'UUID', value: 'test-uuid' }],
      notes: ['uuid: test-uuid'],
    }),
  };
  const credentials = {
    resolve: async () => null,
    resolveActive: async () => ({
      providerId: 'pac',
      channel: 'PAC' as const,
      environment: 'test',
      config: { baseUrl: 'https://pac.example.test', apiKey: 'k', rfc: 'AAA010101AAA' },
      isActive: true,
    }),
  };
  const transmission = new TransmissionProviderRegistry({ credentials });
  (transmission as unknown as { byId: Map<string, TransmissionProvider> }).byId.set('pac', pacMock);
  (transmission as unknown as { byChannel: Map<string, TransmissionProvider> }).byChannel.set('PAC', pacMock);
  const service = new ComplianceService({
    store: new InMemoryComplianceDocumentStore(),
    numbering: new NumberingRegistry(),
    rangeSource: mxRangeSource(),
    executor: new ComplianceExecutor({
      logger: log,
      numbering: new NumberingRegistry(),
      transmission,
    }),
    logger: log,
  });
  return { service, log };
}

/**
 * Like svcMx(), but the mocked PAC provider SKIPS the first transmit() call and only accepts from
 * the second call onward — used to prove the TRANSMISSION_FAILED → (resend) → PENDING_CLEARANCE
 * retry path actually re-invokes the executor rather than replaying a cached outcome.
 */
function svcMxFlaky() {
  const log = new RecordingComplianceLogger();
  let attempt = 0;
  // M-12a: records the idempotencyKey (transmitAll's 4th positional arg to provider.transmit — see
  // registry.ts transmitAll) each real transmit() call actually received, so tests can assert the
  // stable-key derivation reaches all the way down to the transport layer.
  const transmitKeys: string[] = [];
  const pacMock: TransmissionProvider = {
    id: 'pac',
    channel: 'PAC',
    feedback: 'ASYNC_POLL',
    configSchema: { fields: [] },
    transmit: async (_artifacts, _ctx, _plan, idempotencyKey) => {
      transmitKeys.push(idempotencyKey);
      attempt += 1;
      if (attempt === 1) {
        return { channel: 'PAC', status: 'SKIPPED', notes: ['pac: sandbox not yet warmed up'] };
      }
      return {
        channel: 'PAC',
        status: 'CLEARED',
        ref: 'mx-test-co|test-uuid',
        authorityIds: [{ scheme: 'UUID', value: 'test-uuid' }],
        notes: ['uuid: test-uuid'],
      };
    },
  };
  const credentials = {
    resolve: async () => null,
    resolveActive: async () => ({
      providerId: 'pac',
      channel: 'PAC' as const,
      environment: 'test',
      config: { baseUrl: 'https://pac.example.test', apiKey: 'k', rfc: 'AAA010101AAA' },
      isActive: true,
    }),
  };
  const transmission = new TransmissionProviderRegistry({ credentials });
  (transmission as unknown as { byId: Map<string, TransmissionProvider> }).byId.set('pac', pacMock);
  (transmission as unknown as { byChannel: Map<string, TransmissionProvider> }).byChannel.set('PAC', pacMock);
  const service = new ComplianceService({
    store: new InMemoryComplianceDocumentStore(),
    numbering: new NumberingRegistry(),
    rangeSource: mxRangeSource(),
    executor: new ComplianceExecutor({
      logger: log,
      numbering: new NumberingRegistry(),
      transmission,
    }),
    logger: log,
  });
  return { service, log, transmitKeys };
}

const FR = () => ctx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15');
const US = () => ctx('US', 'US', 'B2B', 'GOODS', '2027-01-15');
const MX = () => ctx('MX', 'MX', 'B2B', 'GOODS', '2024-06-01');
/** MX context carrying a supplierCompanyId so transmitAll() actually resolves per-company config. */
const MX_CONFIGURED = (): TransactionContext => ({ ...MX(), supplierCompanyId: 'mx-test-co' });

describe('ComplianceService — issuance & immutability', () => {
  it('creates a draft, issues it (number + ISSUED), and freezes editing', async () => {
    const { service } = svc();
    const draft = await service.createDraft(FR());
    expect(draft.status).toBe('DRAFT');
    await service.editDraft(draft.id, FR()); // allowed in DRAFT

    const { document } = await service.issue(draft.id);
    expect(document.status).toBe('ISSUED');
    expect(document.number).toBeDefined(); // gapless self-numbering
    expect(document.immutableHash).toBeDefined();

    await expect(service.editDraft(draft.id, FR())).rejects.toThrow(/Cannot edit/);
  });
});

describe('ComplianceService — sending by regime', () => {
  it('FR (non-blocking CTC) issueAndSend → DELIVERED then AWAITING_RESPONSE (mandatory statuses)', async () => {
    const { service } = svc();
    const { document, execution } = await service.issueAndSend(FR());
    expect(document.status).toBe('AWAITING_RESPONSE');
    expect(execution.transmissions.some((t) => t.channel === 'PDP')).toBe(true);
  });

  it('US (post-audit) issueAndSend → DELIVERED', async () => {
    const { service } = svc();
    expect((await service.issueAndSend(US())).document.status).toBe('DELIVERED');
  });

  it('MX (blocking clearance) send → PENDING_CLEARANCE, then markCleared → CLEARED', async () => {
    // F-4: send() only reaches PENDING_CLEARANCE when a channel genuinely accepted the document —
    // svcMx()/MX_CONFIGURED() wire a company id + a mocked-but-accepting PAC provider for that.
    const { service } = svcMx();
    const draft = await service.createDraft(MX_CONFIGURED());
    await service.issue(draft.id);
    expect((await service.send(draft.id)).document.status).toBe('PENDING_CLEARANCE');
    expect((await service.markCleared(draft.id)).document.status).toBe('CLEARED');
  });

  it('can force a single channel (e.g. PRINT a B2C receipt)', async () => {
    const { service } = svc();
    const d = await service.createDraft(FR());
    await service.issue(d.id);
    const r = await service.sendViaChannel(d.id, 'PRINT');
    expect(r.transmissions[0].channel).toBe('PRINT');
  });
});

describe('ComplianceService — F-4: send() sincerity (transmission failure is visible, not swallowed)', () => {
  it('MX send() with no PAC channel configured → TRANSMISSION_FAILED, not PENDING_CLEARANCE', async () => {
    // svc()/MX() (no supplierCompanyId, no transmission credentials) is exactly the "nothing is
    // configured" scenario: every planned channel (just PAC here) comes back SKIPPED. Before F-4,
    // send() ignored this and transitioned to PENDING_CLEARANCE anyway because plan.regime.blocking
    // was true — a document that was never actually submitted to anyone.
    const { service } = svc();
    const draft = await service.createDraft(MX());
    await service.issue(draft.id);
    const sent = await service.send(draft.id);

    expect(sent.execution.transmissions.every((t) => t.status === 'SKIPPED' || t.status === 'REJECTED')).toBe(
      true,
    );
    expect(sent.document.status).toBe('TRANSMISSION_FAILED');
    expect(sent.transmissionFailed).toBe(true);

    // The failure is a first-class, persisted ComplianceEvent (not just a log line) so the
    // UI/pipeline can surface it — detail carries the transmission notes as the failure reason.
    const failEvent = sent.document.events.find((e) => e.type === 'TRANSMISSION_FAIL');
    expect(failEvent).toBeDefined();
    expect(failEvent!.detail).toBeTruthy();
  });

  it('is retryable: a later resend() can succeed after an earlier TRANSMISSION_FAILED', async () => {
    // A PAC provider whose first attempt is SKIPPED (e.g. sandbox not warmed up yet) and whose
    // second attempt is genuinely accepted — proves both that TRANSMISSION_FAILED → PENDING_CLEARANCE
    // is a legal state-machine transition, and that resend() truly re-invokes the executor rather
    // than replaying a cached result.
    const { service } = svcMxFlaky();
    const draft = await service.createDraft(MX_CONFIGURED());
    await service.issue(draft.id);

    const first = await service.send(draft.id);
    expect(first.document.status).toBe('TRANSMISSION_FAILED');

    const retried = await service.resend(draft.id);
    expect(retried.document.status).toBe('PENDING_CLEARANCE');
  });

  it('a successful (accepted) send() does not report transmissionFailed', async () => {
    const { service } = svc();
    const sent = await service.issueAndSend(US());
    expect(sent.transmissionFailed).toBe(false);
  });
});

describe('ComplianceService — M-12a: send() precondition guards the real network side effect', () => {
  it('rejects a non-ISSUED document (e.g. DRAFT) before ever calling the executor', async () => {
    const { service } = svc();
    const draft = await service.createDraft(FR());
    const innerExecutor = (service as unknown as { executor: { execute: jest.Mock } }).executor;
    const realExecuteSpy = jest.spyOn(innerExecutor, 'execute');

    await expect(service.send(draft.id)).rejects.toThrow(/ISSUED/);
    expect(realExecuteSpy).not.toHaveBeenCalled();
    realExecuteSpy.mockRestore();
  });

  it('rejects a second send() on an already-DELIVERED document before re-invoking the executor', async () => {
    const { service } = svc();
    const { document } = await service.issueAndSend(US());
    expect(document.status).toBe('DELIVERED');

    const innerExecutor = (service as unknown as { executor: { execute: jest.Mock } }).executor;
    const realExecuteSpy = jest.spyOn(innerExecutor, 'execute');

    await expect(service.send(document.id)).rejects.toThrow(/DELIVERED/);
    expect(realExecuteSpy).not.toHaveBeenCalled();
    realExecuteSpy.mockRestore();
  });
});

describe('ComplianceService — M-12a: stable idempotency key engages the transport dedup', () => {
  it('two computeSendOutcome() calls on the same doc+status pass the SAME idempotencyKey to the executor; a status change yields a DIFFERENT key', async () => {
    const { service } = svc();
    const draft = await service.createDraft(US());
    await service.issue(draft.id);
    const rec = (await service.getDocument(draft.id))!;
    expect(rec.status).toBe('ISSUED');

    const innerExecutor = (service as unknown as { executor: { execute: jest.Mock } }).executor;
    const executeSpy = jest.spyOn(innerExecutor, 'execute');

    // Two concurrent/rapid computeSendOutcome() calls on the SAME record — same id, same status.
    await service.computeSendOutcome(rec);
    await service.computeSendOutcome(rec);

    expect(executeSpy).toHaveBeenCalledTimes(2);
    const key1 = executeSpy.mock.calls[0][2]?.idempotencyKey;
    const key2 = executeSpy.mock.calls[1][2]?.idempotencyKey;
    expect(key1).toBe(`${rec.id}:ISSUED`);
    expect(key1).toBe(key2); // same doc + same status → SAME stable key

    // A LEGITIMATE resend after the status legitimately changed (e.g. TRANSMISSION_FAILED → retry)
    // must get a fresh key — it is derived from `rec.status`, which is now different.
    const failedRec = { ...rec, status: 'TRANSMISSION_FAILED' as const };
    await service.computeSendOutcome(failedRec);
    const key3 = executeSpy.mock.calls[2][2]?.idempotencyKey;
    expect(key3).toBe(`${rec.id}:TRANSMISSION_FAILED`);
    expect(key3).not.toBe(key1);

    executeSpy.mockRestore();
  });

  it("actually engages transmitAll()'s dedup: a second same-status computeSendOutcome() comes back SKIPPED on every channel, never a real second submission", async () => {
    // Uses the REAL (un-spied) TransmissionProviderRegistry — proves the stable key propagates all the
    // way through executor.execute() -> transmitAll() and is recognized by its in-memory dedup Map
    // (registry.ts: `_isDuplicate`/`_markSeen`, keyed on `${idempotencyKeyBase}:${provider.id}:${i}`).
    const { service } = svc();
    const draft = await service.createDraft(US());
    await service.issue(draft.id);
    const rec = (await service.getDocument(draft.id))!;

    const first = await service.computeSendOutcome(rec);
    expect(
      first.execution.transmissions.some(
        (t) => t.status === 'SENT' || t.status === 'PENDING' || t.status === 'CLEARED',
      ),
    ).toBe(true); // the first call genuinely reaches the (mocked) mail gateway

    const second = await service.computeSendOutcome(rec); // SAME rec: same id, same status
    expect(second.execution.transmissions.length).toBeGreaterThan(0);
    expect(second.execution.transmissions.every((t) => t.status === 'SKIPPED')).toBe(true);
    expect(second.execution.transmissions.some((t) => t.notes.some((n) => n.includes('idempotency')))).toBe(
      true,
    );
  });

  it('resend() after a real TRANSMISSION_FAILED transition passes a genuinely DIFFERENT transport-layer key than the original send (real state-machine transition, not a hand-built rec)', async () => {
    const { service, transmitKeys } = svcMxFlaky();
    const draft = await service.createDraft(MX_CONFIGURED());
    await service.issue(draft.id);

    const first = await service.send(draft.id);
    expect(first.document.status).toBe('TRANSMISSION_FAILED'); // svcMxFlaky's first attempt SKIPS

    const retried = await service.resend(draft.id);
    expect(retried.document.status).toBe('PENDING_CLEARANCE'); // svcMxFlaky's second attempt accepts

    // registry.ts transmitAll(): iKey = `${idempotencyKeyBase}:${provider.id}:${i}`, where
    // idempotencyKeyBase is what ComplianceService.computeSendOutcome() derived (`${rec.id}:${rec.status}`).
    expect(transmitKeys).toHaveLength(2);
    expect(transmitKeys[0]).toBe(`${draft.id}:ISSUED:pac:0`);
    expect(transmitKeys[1]).toBe(`${draft.id}:TRANSMISSION_FAILED:pac:0`);
    expect(transmitKeys[0]).not.toBe(transmitKeys[1]);
  });
});

describe('ComplianceService — modification & corrections', () => {
  it('issues a credit note that references the original (original stays immutable)', async () => {
    const { service } = svc();
    const { document } = await service.issueAndSend(FR());
    const { original, correction } = await service.correct(document.id);
    expect(correction.kind).toBe('CREDIT_NOTE');
    expect(correction.correctsId).toBe(document.id);
    expect(original.events.some((e) => e.type === 'CORRECTION_INITIATED')).toBe(true);
  });

  it('supports debit notes and corrective invoices', async () => {
    const { service } = svc();
    const a = (await service.issueAndSend(FR())).document;
    expect((await service.issueDebitNote(a.id)).correction.kind).toBe('DEBIT_NOTE');
    const b = (await service.issueAndSend(FR())).document;
    expect((await service.issueCorrectiveInvoice(b.id)).correction.kind).toBe('CORRECTIVE_INVOICE');
  });

  it('cancellation is policy-gated: MX needs buyer consent', async () => {
    const { service } = svcMx(); // F-4: needs a genuinely-accepted channel to reach CLEARED via send()
    const d = await service.createDraft(MX_CONFIGURED());
    await service.issue(d.id);
    await service.send(d.id);
    await service.markCleared(d.id);

    expect((await service.cancel(d.id)).accepted).toBe(false); // no consent
    const ok = await service.cancel(d.id, { buyerConsent: true });
    expect(ok.accepted).toBe(true);
    expect(ok.document.status).toBe('CANCELLED');
  });
});

describe('ComplianceService — bidirectional response & inbound', () => {
  it('records a buyer refusal', async () => {
    const { service } = svc();
    const { document } = await service.issueAndSend(FR());
    const refused = await service.applyResponse(document.id, { status: 'REFUSE', source: 'BUYER' });
    expect(refused.status).toBe('REFUSED');
  });

  it('receives an inbound e-invoice (we are the buyer)', async () => {
    const { service } = svc();
    const r = await service.receive({ channel: 'SDI', ctx: ctx('IT', 'FR', 'B2B', 'GOODS', '2027-01-15') });
    expect(r.document.direction).toBe('INBOUND');
    expect(r.document.status).toBe('DELIVERED');
    expect(r.validation).toBeDefined();
  });
});

describe('ComplianceService — event append-only (round-trip)', () => {
  it('successive transitions append events without duplicates or loss', async () => {
    const { service } = svc();
    const draft = await service.createDraft(US());
    // After create: 1 event (CREATED)
    expect(draft.events).toHaveLength(1);
    expect(draft.events[0].type).toBe('CREATED');

    // After issue: 2 events (CREATED, ISSUE)
    const { document: issued } = await service.issue(draft.id);
    expect(issued.events).toHaveLength(2);
    expect(issued.events.map((e) => e.type)).toEqual(['CREATED', 'ISSUE']);

    // After markPaid: 3 events (CREATED, ISSUE, PAID)
    const paid = await service.markPaid(issued.id, { paidAt: '2027-02-01T00:00:00.000Z' });
    expect(paid.events).toHaveLength(3);
    expect(paid.events.map((e) => e.type)).toEqual(['CREATED', 'ISSUE', 'PAID']);

    // Verify every event has an id and actor
    paid.events.forEach((e) => {
      expect(e.id).toBeDefined();
      expect(e.actor).toBe('system');
    });
  });
});

describe('ComplianceService — reporting, payment, archive', () => {
  it('emits reporting side-effects (FR→IT queues the EC Sales List)', async () => {
    const { service } = svc();
    const { document } = await service.issueAndSend(ctx('FR', 'IT', 'B2B', 'SERVICES', '2027-01-15'));
    const { results } = await service.report(document.id);
    expect(results.map((r) => r.kind)).toContain('EC_SALES_LIST');
  });

  it('markPaid triggers the cashed status for France (encaissée) + e-reporting', async () => {
    const { service, log } = svc();
    const { document } = await service.issueAndSend(ctx('FR', 'FR', 'B2C', 'SERVICES', '2027-01-15'));
    const paid = await service.markPaid(document.id, { paidAt: '2027-02-01T00:00:00.000Z' });
    expect(paid.events.some((e) => e.type === 'PAID')).toBe(true);
    expect(paid.events.some((e) => e.type === 'STATUS:encaissée')).toBe(true);
    expect(log.hasScope('reporting/E_REPORTING')).toBe(true);
  });

  it('archives the document and reports a receipt', async () => {
    const { service } = svc();
    const d = await service.createDraft(MX());
    await service.issue(d.id);
    const { receipt } = await service.archiveDocument(d.id);
    expect(receipt.region).toBe('MX');
    // M-3: the receipt carries a real SHA-256 over the archived artifacts, not a fabricated hash.
    expect(receipt.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.uri).not.toContain('/stub');
  });

  it('validates a document', async () => {
    const { service } = svc();
    const d = await service.createDraft(FR());
    await service.issue(d.id);
    expect((await service.validate(d.id)).valid).toBe(true);
  });
});

describe('ComplianceService — PART IV: correction ↔ original round-trip', () => {
  it('credit note references original; original stays immutable; correction is a new issued doc', async () => {
    const { service } = svc();
    const original = (await service.issueAndSend(FR())).document;
    expect(original.status).not.toBe('DRAFT');

    const { original: updatedOriginal, correction } = await service.correct(original.id);
    expect(correction.kind).toBe('CREDIT_NOTE');
    expect(correction.correctsId).toBe(original.id);
    expect(correction.status).toBe('DRAFT'); // correction starts as draft until issued
    expect(updatedOriginal.events.some((e) => e.type === 'CORRECTION_INITIATED')).toBe(true);

    // The original document is immutable (no edit possible)
    await expect(service.editDraft(original.id, FR())).rejects.toThrow(/Cannot edit/);
  });

  it('corrective invoice references original with CORRECTIVE_INVOICE kind', async () => {
    const { service } = svc();
    const original = (await service.issueAndSend(FR())).document;
    const { correction } = await service.issueCorrectiveInvoice(original.id);
    expect(correction.kind).toBe('CORRECTIVE_INVOICE');
    expect(correction.correctsId).toBe(original.id);
  });

  it('cancel-and-replace: cancels original and creates replacement doc', async () => {
    const { service } = svc();
    // Use US (post-audit, no response window) so the doc stays at DELIVERED where CANCEL is allowed
    const original = (await service.issueAndSend(US())).document;
    expect(original.status).toBe('DELIVERED');
    const result = await service.cancelAndReplace(original.id);
    expect(result.original.status).toBe('CANCELLED');
    expect(result.correction.correctsId).toBe(original.id);
    expect(result.correction.kind).toBe(original.kind); // replacement is same kind
  });

  it('multiple corrections can reference the same original', async () => {
    const { service } = svc();
    const original = (await service.issueAndSend(FR())).document;
    const c1 = (await service.correct(original.id)).correction;
    const c2 = (await service.issueDebitNote(original.id)).correction;
    expect(c1.correctsId).toBe(original.id);
    expect(c2.correctsId).toBe(original.id);
    expect(c1.id).not.toBe(c2.id);
  });
});

describe('ComplianceService — PART IV: available-actions resolution', () => {
  it('FR plan: correctionModel = CREDIT_NOTE, cancellation allowed', () => {
    const plan = resolve(FR());
    expect(plan.lifecycle.correctionModel).toBe('CREDIT_NOTE');
    expect(plan.lifecycle.cancellation.allowed).toBe(true);
    expect(plan.lifecycle.immutableAfter).toBe('ISSUE');
  });

  it('MX plan: cancellation requires buyer consent + authority ack', () => {
    const plan = resolve(MX());
    expect(plan.lifecycle.cancellation.allowed).toBe(true);
    expect(plan.lifecycle.cancellation.requiresBuyerConsent).toBe(true);
    expect(plan.lifecycle.cancellation.requiresAuthorityAck).toBe(true);
  });

  it('cancel() rejects MX without buyer consent', async () => {
    const { service } = svcMx(); // F-4: needs a genuinely-accepted channel to reach CLEARED via send()
    const d = await service.createDraft(MX_CONFIGURED());
    await service.issue(d.id);
    await service.send(d.id);
    await service.markCleared(d.id);

    const result = await service.cancel(d.id);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/consent/i);
  });

  it('cancel() accepts MX with buyer consent', async () => {
    const { service } = svcMx(); // F-4: needs a genuinely-accepted channel to reach CLEARED via send()
    const d = await service.createDraft(MX_CONFIGURED());
    await service.issue(d.id);
    await service.send(d.id);
    await service.markCleared(d.id);

    const result = await service.cancel(d.id, { buyerConsent: true });
    expect(result.accepted).toBe(true);
    expect(result.document.status).toBe('CANCELLED');
  });
});

describe('ComplianceService — outgoing lifecycle status (sendStatus)', () => {
  it('transmitStatus pushes "encaissée" via the primary PDP channel for FR', async () => {
    const { service, log } = svc();
    const { document } = await service.issueAndSend(FR());
    const result = await service.transmitStatus(document.id, 'encaissée');
    expect(result).not.toBeNull();
    expect(result!.channel).toBe('PDP');
    expect(result!.status).toBe('QUEUED');
    expect(log.hasScope('transmission/pdp')).toBe(true);
  });

  it('transmitStatus returns null for EMAIL channel (no sendStatus impl)', async () => {
    const { service, log } = svc();
    const { document } = await service.issueAndSend(US());
    const result = await service.transmitStatus(document.id, 'encaissée');
    expect(result).toBeNull();
    expect(log.hasScope('operations/transmitStatus')).toBe(true);
  });

  it('markPaid on FR triggers sendStatus for "encaissée" alongside e-reporting', async () => {
    const { service, log } = svc();
    const { document } = await service.issueAndSend(ctx('FR', 'FR', 'B2C', 'SERVICES', '2027-01-15'));
    const paid = await service.markPaid(document.id, { paidAt: '2027-02-01T00:00:00.000Z' });
    expect(paid.events.some((e) => e.type === 'STATUS:encaissée')).toBe(true);
    expect(log.hasScope('reporting/E_REPORTING')).toBe(true);
    expect(log.hasScope('transmission/pdp')).toBe(true);
  });
});

describe('ComplianceService — F-9: AUTHORITY_RANGE numbering (loadRange wiring + hard block)', () => {
  it('MX plan still requires AUTHORITY_RANGE numbering', () => {
    expect(resolve(MX()).numbering.model).toBe('AUTHORITY_RANGE');
  });

  it('with a configured range, issue() allocates sequential numbers from it', async () => {
    const rangeSource = new ConfigAuthorityRangeSource();
    rangeSource.configure('range-co', 'MX-INVOICE', { from: 1000, to: 1002 });
    const service = new ComplianceService({
      store: new InMemoryComplianceDocumentStore(),
      numbering: new NumberingRegistry(),
      rangeSource,
    });
    const mxCtx = { ...MX(), supplierCompanyId: 'range-co' };

    const d1 = await service.createDraft(mxCtx);
    const { document: issued1 } = await service.issue(d1.id);
    expect(issued1.status).toBe('ISSUED');
    expect(issued1.number).toBe('1000');

    const d2 = await service.createDraft(mxCtx);
    const { document: issued2 } = await service.issue(d2.id);
    expect(issued2.number).toBe('1001'); // next folio in the same loaded range
  });

  it('range exhausted → issue() hard-fails instead of silently reusing/skipping a folio', async () => {
    const rangeSource = new ConfigAuthorityRangeSource();
    rangeSource.configure('exhaust-co', 'MX-INVOICE', { from: 1, to: 1 }); // a single-folio range
    const service = new ComplianceService({
      store: new InMemoryComplianceDocumentStore(),
      numbering: new NumberingRegistry(),
      rangeSource,
    });
    const mxCtx = { ...MX(), supplierCompanyId: 'exhaust-co' };

    const d1 = await service.createDraft(mxCtx);
    const { document: issued1 } = await service.issue(d1.id);
    expect(issued1.number).toBe('1'); // consumes the only folio

    const d2 = await service.createDraft(mxCtx);
    await expect(service.issue(d2.id)).rejects.toThrow(/exhausted/i);
    const after = await service.getDocument(d2.id);
    expect(after!.status).toBe('DRAFT');
    expect(after!.number).toBeUndefined();
  });

  it('with NO range configured, issue() hard-fails — the document must never reach ISSUED with number: undefined', async () => {
    const service = new ComplianceService({
      store: new InMemoryComplianceDocumentStore(),
      numbering: new NumberingRegistry(),
      rangeSource: new NullAuthorityRangeSource(), // offline-safe default: never has a range
    });
    const draft = await service.createDraft(MX());

    await expect(service.issue(draft.id)).rejects.toThrow(/no folio range loaded/i);

    // F-9: the old behavior swallowed this into a warn and still transitioned to ISSUED with
    // number: undefined. Now the document must stay in a pre-issue state (DRAFT) with no number.
    const after = await service.getDocument(draft.id);
    expect(after!.status).toBe('DRAFT');
    expect(after!.number).toBeUndefined();

    // The failure is a first-class, persisted event (not just a log line) — aligned with the F-4
    // sincerity principle of surfacing real failures instead of swallowing them.
    const blocked = after!.events.find((e) => e.type === 'ISSUE_BLOCKED');
    expect(blocked).toBeDefined();
    expect(blocked!.detail).toMatch(/no folio range loaded/i);
  });

  it('AR is requalified to GAPLESS_SELF (AFIP self-numbers; CAE is granted a posteriori, not a range)', async () => {
    const arCtx = ctx('AR', 'AR', 'B2B', 'GOODS', '2027-01-15');
    expect(resolve(arCtx).numbering.model).toBe('GAPLESS_SELF');

    // Issues successfully with NO range configured anywhere — AR must never consult FolioPool.
    const service = new ComplianceService({
      store: new InMemoryComplianceDocumentStore(),
      numbering: new NumberingRegistry(),
      rangeSource: new NullAuthorityRangeSource(),
    });
    const draft = await service.createDraft(arCtx);
    const { document } = await service.issue(draft.id);
    expect(document.status).toBe('ISSUED');
    expect(document.number).toBeDefined();
  });
});

describe('ComplianceService — M-2: recordWiringFailure (non-blocking integration points)', () => {
  it('appends a first-class WIRING_FAILED event carrying the operation label + error message, and leaves status untouched', async () => {
    const { service } = svc();
    const draft = await service.createDraft(FR());
    expect(draft.status).toBe('DRAFT');

    await service.recordWiringFailure(draft.id, 'issueInvoice', new Error('SMTP gateway unreachable'));

    const after = await service.getDocument(draft.id);
    expect(after!.status).toBe('DRAFT'); // untouched — no state-machine transition happened
    const failure = after!.events.find((e) => e.type === 'WIRING_FAILED');
    expect(failure).toBeDefined();
    expect(failure!.detail).toBe('issueInvoice: SMTP gateway unreachable');
    expect(failure!.actor).toBe('system');
  });

  it('stringifies a non-Error thrown value into the event detail', async () => {
    const { service } = svc();
    const draft = await service.createDraft(FR());

    await service.recordWiringFailure(draft.id, 'markPaid', 'plain string rejection');

    const after = await service.getDocument(draft.id);
    const failure = after!.events.find((e) => e.type === 'WIRING_FAILED');
    expect(failure!.detail).toBe('markPaid: plain string rejection');
  });

  it('appends WIRING_FAILED on top of existing events without disturbing them (append-only)', async () => {
    const { service } = svc();
    const draft = await service.createDraft(FR());
    const { document: issued } = await service.issue(draft.id);
    expect(issued.events.map((e) => e.type)).toEqual(['CREATED', 'ISSUE']);

    await service.recordWiringFailure(issued.id, 'send', new Error('transmission wiring failed'));

    const after = await service.getDocument(issued.id);
    expect(after!.events.map((e) => e.type)).toEqual(['CREATED', 'ISSUE', 'WIRING_FAILED']);
    expect(after!.status).toBe('ISSUED');
  });

  it('never throws when the document id is unknown — logs at error and returns', async () => {
    const { service, log } = svc();

    await expect(
      service.recordWiringFailure('does-not-exist', 'createDraft', new Error('boom')),
    ).resolves.toBeUndefined();

    const errorEntries = log.entries.filter((e) => e.level === 'error');
    expect(errorEntries.length).toBeGreaterThan(0);
    expect(errorEntries.some((e) => e.message.includes('does-not-exist'))).toBe(true);
  });

  it('never throws when the underlying store fails to persist the event — logs at error and returns', async () => {
    const log = new RecordingComplianceLogger();
    const draft = { id: 'doc-1', status: 'DRAFT', events: [] } as any;
    const failingStore = {
      get: async () => draft,
      update: async () => {
        throw new Error('store unavailable');
      },
      save: async (r: any) => r,
      list: async () => [],
      listByCompany: async () => [],
      findLastInSeries: async () => null,
    };
    const service = new ComplianceService({ store: failingStore as any, logger: log });

    await expect(
      service.recordWiringFailure('doc-1', 'issue', new Error('original failure')),
    ).resolves.toBeUndefined();

    const errorEntries = log.entries.filter((e) => e.level === 'error');
    expect(errorEntries.length).toBeGreaterThan(0);
    expect(errorEntries.some((e) => e.message.includes('store unavailable'))).toBe(true);
    // The original failure reason must still be visible in the (swallowed) recording log — it is
    // not replaced by the recording error.
    expect(errorEntries.some((e) => e.message.includes('original failure'))).toBe(true);
  });
});
