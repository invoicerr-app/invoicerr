import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { NumberingRegistry } from '../lifecycle/numbering';
import { RecordingComplianceLogger } from '../execution/logger';
import { ComplianceExecutor } from '../execution/executor';
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

function ctx(supplier: string, buyer: string, role: PartyRole, supply: SupplyType, date: string): TransactionContext {
  return {
    supplier: party(supplier, 'B2B'),
    buyer: party(buyer, role),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }],
    issueDate: new Date(date),
    currency: 'EUR',
  };
}

function svc() {
  const log = new RecordingComplianceLogger();
  const service = new ComplianceService({
    store: new InMemoryComplianceDocumentStore(),
    numbering: new NumberingRegistry(),
    executor: new ComplianceExecutor({ logger: log, numbering: new NumberingRegistry() }),
    logger: log,
  });
  return { service, log };
}

const FR = () => ctx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15');
const US = () => ctx('US', 'US', 'B2B', 'GOODS', '2027-01-15');
const MX = () => ctx('MX', 'MX', 'B2B', 'GOODS', '2024-06-01');

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
    const { service } = svc();
    const draft = await service.createDraft(MX());
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
    const { service } = svc();
    const d = await service.createDraft(MX());
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
    const draft = await service.createDraft(FR());
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

  it('markPaid triggers the cashed status for France (encaissée)', async () => {
    const { service, log } = svc();
    const { document } = await service.issueAndSend(FR());
    const paid = await service.markPaid(document.id, { paidAt: '2027-02-01T00:00:00.000Z' });
    expect(paid.events.some((e) => e.type === 'PAID')).toBe(true);
    expect(log.hasScope('operations/markPaid')).toBe(true);
  });

  it('archives the document and reports a receipt', async () => {
    const { service } = svc();
    const d = await service.createDraft(MX());
    await service.issue(d.id);
    expect((await service.archiveDocument(d.id)).receipt.region).toBe('MX');
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
    const { service } = svc();
    const d = await service.createDraft(MX());
    await service.issue(d.id);
    await service.send(d.id);
    await service.markCleared(d.id);

    const result = await service.cancel(d.id);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/consent/i);
  });

  it('cancel() accepts MX with buyer consent', async () => {
    const { service } = svc();
    const d = await service.createDraft(MX());
    await service.issue(d.id);
    await service.send(d.id);
    await service.markCleared(d.id);

    const result = await service.cancel(d.id, { buyerConsent: true });
    expect(result.accepted).toBe(true);
    expect(result.document.status).toBe('CANCELLED');
  });
});
