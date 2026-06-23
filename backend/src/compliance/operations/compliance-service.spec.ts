import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { NumberingRegistry } from '../lifecycle/numbering';
import { RecordingComplianceLogger } from '../execution/logger';
import { ComplianceExecutor } from '../execution/executor';
import { ComplianceService } from './compliance-service';
import { InMemoryComplianceDocumentStore } from './document-store';

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
  it('creates a draft, issues it (number + ISSUED), and freezes editing', () => {
    const { service } = svc();
    const draft = service.createDraft(FR());
    expect(draft.status).toBe('DRAFT');
    service.editDraft(draft.id, FR()); // allowed in DRAFT

    const { document } = service.issue(draft.id);
    expect(document.status).toBe('ISSUED');
    expect(document.number).toBeDefined(); // gapless self-numbering
    expect(document.immutableHash).toBeDefined();

    expect(() => service.editDraft(draft.id, FR())).toThrow(/Cannot edit/);
  });
});

describe('ComplianceService — sending by regime', () => {
  it('FR (non-blocking CTC) issueAndSend → DELIVERED then AWAITING_RESPONSE (mandatory statuses)', () => {
    const { service } = svc();
    const { document, execution } = service.issueAndSend(FR());
    expect(document.status).toBe('AWAITING_RESPONSE');
    expect(execution.transmissions.some((t) => t.channel === 'PDP')).toBe(true);
  });

  it('US (post-audit) issueAndSend → DELIVERED', () => {
    const { service } = svc();
    expect(service.issueAndSend(US()).document.status).toBe('DELIVERED');
  });

  it('MX (blocking clearance) send → PENDING_CLEARANCE, then markCleared → CLEARED', () => {
    const { service } = svc();
    const draft = service.createDraft(MX());
    service.issue(draft.id);
    expect(service.send(draft.id).document.status).toBe('PENDING_CLEARANCE');
    expect(service.markCleared(draft.id).document.status).toBe('CLEARED');
  });

  it('can force a single channel (e.g. PRINT a B2C receipt)', () => {
    const { service } = svc();
    const d = service.createDraft(FR());
    service.issue(d.id);
    const r = service.sendViaChannel(d.id, 'PRINT');
    expect(r.transmissions[0].channel).toBe('PRINT');
  });
});

describe('ComplianceService — modification & corrections', () => {
  it('issues a credit note that references the original (original stays immutable)', () => {
    const { service } = svc();
    const { document } = service.issueAndSend(FR());
    const { original, correction } = service.correct(document.id);
    expect(correction.kind).toBe('CREDIT_NOTE');
    expect(correction.correctsId).toBe(document.id);
    expect(original.events.some((e) => e.type === 'CORRECTION_INITIATED')).toBe(true);
  });

  it('supports debit notes and corrective invoices', () => {
    const { service } = svc();
    const a = service.issueAndSend(FR()).document;
    expect(service.issueDebitNote(a.id).correction.kind).toBe('DEBIT_NOTE');
    const b = service.issueAndSend(FR()).document;
    expect(service.issueCorrectiveInvoice(b.id).correction.kind).toBe('CORRECTIVE_INVOICE');
  });

  it('cancellation is policy-gated: MX needs buyer consent', () => {
    const { service } = svc();
    const d = service.createDraft(MX());
    service.issue(d.id);
    service.send(d.id);
    service.markCleared(d.id);

    expect(service.cancel(d.id).accepted).toBe(false); // no consent
    const ok = service.cancel(d.id, { buyerConsent: true });
    expect(ok.accepted).toBe(true);
    expect(ok.document.status).toBe('CANCELLED');
  });
});

describe('ComplianceService — bidirectional response & inbound', () => {
  it('records a buyer refusal', () => {
    const { service } = svc();
    const { document } = service.issueAndSend(FR());
    const refused = service.applyResponse(document.id, { status: 'REFUSE', source: 'BUYER' });
    expect(refused.status).toBe('REFUSED');
  });

  it('receives an inbound e-invoice (we are the buyer)', () => {
    const { service } = svc();
    const r = service.receive({ channel: 'SDI', ctx: ctx('IT', 'FR', 'B2B', 'GOODS', '2027-01-15') });
    expect(r.document.direction).toBe('INBOUND');
    expect(r.document.status).toBe('DELIVERED');
    expect(r.validation).toBeDefined();
  });
});

describe('ComplianceService — reporting, payment, archive', () => {
  it('emits reporting side-effects (FR→IT queues the EC Sales List)', () => {
    const { service } = svc();
    const { document } = service.issueAndSend(ctx('FR', 'IT', 'B2B', 'SERVICES', '2027-01-15'));
    const { results } = service.report(document.id);
    expect(results.map((r) => r.kind)).toContain('EC_SALES_LIST');
  });

  it('markPaid triggers the cashed status for France (encaissée)', () => {
    const { service, log } = svc();
    const { document } = service.issueAndSend(FR());
    const paid = service.markPaid(document.id, { paidAt: '2027-02-01T00:00:00.000Z' });
    expect(paid.events.some((e) => e.type === 'PAID')).toBe(true);
    expect(log.hasScope('operations/markPaid')).toBe(true);
  });

  it('archives the document and reports a receipt', () => {
    const { service } = svc();
    const d = service.createDraft(MX());
    service.issue(d.id);
    expect(service.archiveDocument(d.id).receipt.region).toBe('MX');
  });

  it('validates a document', () => {
    const { service } = svc();
    const d = service.createDraft(FR());
    service.issue(d.id);
    expect(service.validate(d.id).valid).toBe(true);
  });
});
