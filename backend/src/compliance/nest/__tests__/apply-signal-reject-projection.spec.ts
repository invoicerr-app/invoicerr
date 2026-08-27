/**
 * F-008 — an authority rejection must reach the invoice the USER looks at.
 *
 * Before this projection, `apply-signal.ts` wrote only `ComplianceDocument.status`; there was no
 * `prisma.invoice.update` anywhere under `src/compliance`. An invoice rejected by KSeF or scartata
 * by the SdI therefore went on displaying SENT in the invoice list, and the rejection existed only
 * in a table the main screen does not read. The user believed they had invoiced.
 *
 * These tests follow the rejection all the way to what the screen consumes:
 *   authority signal → lifecycle runtime → ComplianceDocument.status
 *                    → Invoice.status → the getInvoice() payload the invoice view renders.
 *
 * They also pin the non-regression the projection must never break: all ten pre-existing writes to
 * `Invoice.status` are USER actions, and a late authority signal must not walk back over any of
 * them.
 *
 * Offline: no Postgres, no Redis, no BullMQ. The Prisma double implements only the delegate calls
 * this flow issues (same technique as apply-signal-callback-correlation.spec.ts).
 */
import { PrismaService } from '@/prisma/prisma.service';
import { PartyRole } from '../../types';
import { PartyTaxProfile, TransactionContext } from '../../canonical/canonical-document';
import { resolve } from '../../engine/compliance-engine';
import { RecordingComplianceLogger } from '../../execution/logger';
import { ApplySignalService } from '../apply-signal';

function party(country: string, role: PartyRole): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }],
  };
}

/** Italy → Italy: SdI clearance, so PENDING_CLEARANCE → REJECT is a legal transition. */
function itCtx(): TransactionContext {
  return {
    supplier: party('IT', 'B2B'),
    buyer: party('IT', 'B2B'),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' }],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
  };
}

/**
 * The statuses this projection is the ONLY writer of, in declaration order. Established by auditing
 * all fifteen writes to Invoice.status in the backend — thirteen in invoices.service.ts, two in
 * payments.service.ts, every one of them a user action. PENDING_CLEARANCE and CLEARED appear in
 * none of them, which is why they belong here.
 */
const PROJECTION_OWNED_ORDER = ['REJECTED', 'REFUSED', 'TRANSMISSION_FAILED', 'PENDING_CLEARANCE', 'CLEARED'];

/** What a FAILURE may be written over: in-flight, or another projection-written status. */
const FAILURE_OVER = ['ISSUED', 'SENT', 'PENDING_CLEARANCE', 'UNPAID', 'OVERDUE', ...PROJECTION_OWNED_ORDER];

/** The Invoice.status values a user action can leave behind, none of which the projection may touch. */
const USER_OWNED_STATUSES = ['DRAFT', 'PAID', 'CANCELLED', 'CORRECTED', 'ARCHIVED'] as const;

class FakePrisma {
  private readonly docs = new Map<string, Record<string, unknown>>();
  private readonly events = new Map<string, Array<Record<string, unknown>>>();
  readonly invoices = new Map<string, Record<string, unknown>>();
  /** Every `where` this test's projection issued, so we can assert the guard, not just the effect. */
  readonly invoiceUpdateAttempts: Array<Record<string, unknown>> = [];

  seedDocument(rec: Record<string, unknown> & { id: string }): void {
    this.docs.set(rec.id, {
      number: null,
      immutableHash: null,
      previousHash: null,
      correctsId: null,
      invoiceId: null,
      ...rec,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.events.set(rec.id, []);
  }

  seedInvoice(id: string, status: string): void {
    this.invoices.set(id, { id, status });
  }

  eventsFor(documentId: string): Array<Record<string, unknown>> {
    return this.events.get(documentId) ?? [];
  }

  docStatus(id: string): unknown {
    return this.docs.get(id)?.status;
  }

  private row(id: string): Record<string, unknown> | null {
    const doc = this.docs.get(id);
    if (!doc) return null;
    return { ...doc, events: this.events.get(id) ?? [], authorityIds: [] };
  }

  complianceDocument = {
    findUnique: async ({ where }: { where: { id: string } }) => this.row(where.id),
    update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const { authorityIds: _ignored, ...fields } = data;
      this.docs.set(where.id, { ...this.docs.get(where.id), ...fields });
      return this.row(where.id);
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status?: string };
      data: Record<string, any>;
    }) => {
      const doc = this.docs.get(where.id);
      if (!doc || (where.status !== undefined && doc.status !== where.status)) return { count: 0 };
      this.docs.set(where.id, { ...doc, ...data });
      return { count: 1 };
    },
  };

  complianceEvent = {
    findMany: async ({ where }: { where: { documentId: string } }) =>
      (this.events.get(where.documentId) ?? []).map((e) => ({ id: e.id })),
    createMany: async ({ data }: { data: Array<Record<string, any>> }) => {
      for (const e of data) {
        const list = this.events.get(e.documentId as string) ?? [];
        list.push(e);
        this.events.set(e.documentId as string, list);
      }
      return { count: data.length };
    },
  };

  /**
   * `updateMany` with the real Postgres semantics that matter here: the `status: { in: [...] }`
   * predicate is part of the WHERE, so a row outside the in-flight set matches zero and is left
   * untouched. That predicate IS the non-regression guard, which is why the double honours it
   * rather than blindly writing.
   */
  invoice = {
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status?: { in: string[] } };
      data: Record<string, any>;
    }) => {
      this.invoiceUpdateAttempts.push(where);
      const inv = this.invoices.get(where.id);
      if (!inv) return { count: 0 };
      if (where.status?.in && !where.status.in.includes(inv.status as string)) return { count: 0 };
      this.invoices.set(where.id, { ...inv, ...data });
      return { count: 1 };
    },
  };

  scheduledJob = {
    create: async ({ data }: { data: Record<string, any> }) => data,
    updateMany: async () => ({ count: 0 }),
  };

  complianceCallbackRegistration = {
    create: async ({ data }: { data: Record<string, any> }) => data,
    updateMany: async () => ({ count: 0 }),
  };

  async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function seedDocumentAt(fake: FakePrisma, id: string, invoiceId: string | null, status: string) {
  const ctx = itCtx();
  fake.seedDocument({
    id,
    kind: 'INVOICE',
    direction: 'OUTBOUND',
    status,
    ctx,
    plan: resolve(ctx),
    invoiceId,
  });
}

function seedRejectableDocument(fake: FakePrisma, id: string, invoiceId: string | null) {
  seedDocumentAt(fake, id, invoiceId, 'PENDING_CLEARANCE');
}

function service(fake: FakePrisma): ApplySignalService {
  return new ApplySignalService(
    fake as unknown as PrismaService,
    undefined,
    undefined,
    new RecordingComplianceLogger(),
  );
}

describe('F-008: an authority rejection reaches the invoice the user looks at', () => {
  it('projects REJECTED onto Invoice.status, and carries the authority wording to the screen payload', async () => {
    const fake = new FakePrisma();
    seedRejectableDocument(fake, 'f008-1', 'inv-1');
    fake.seedInvoice('inv-1', 'SENT'); // the exact lie: rejected by the SdI, displayed as "Sent"

    await service(fake).apply('f008-1', {
      type: 'INBOUND_STATUS',
      status: 'scarto - codice 00200 file non conforme',
    });

    // 1. the document records the rejection (this already worked)
    expect(fake.docStatus('f008-1')).toBe('REJECTED');

    // 2. the invoice row the list reads now says so too (this is the finding)
    expect(fake.invoices.get('inv-1')).toMatchObject({ status: 'REJECTED' });

    // 3. the authority's own wording survives onto the event, which is what getInvoice() selects
    //    (`events: { select: { type, at, actor, detail } }`) and what the detail view renders as
    //    the rejection reason. Without this the screen could say "rejected" but never say why.
    const rejectionEvents = fake.eventsFor('f008-1').filter((e) => e.type === 'REJECT');
    expect(rejectionEvents).toHaveLength(1);
    expect(rejectionEvents[0].detail).toBe('scarto - codice 00200 file non conforme');
  });

  it('records the rejection with no reason when the signal carries none, rather than inventing one', async () => {
    const fake = new FakePrisma();
    seedRejectableDocument(fake, 'f008-2', 'inv-2');
    fake.seedInvoice('inv-2', 'SENT');

    // A poll-detected rejection: the provider returns a normalised status and no text at all.
    await service(fake).apply('f008-2', { type: 'POLL_RESULT', status: 'REJECTED' });

    expect(fake.invoices.get('inv-2')).toMatchObject({ status: 'REJECTED' });
    const [ev] = fake.eventsFor('f008-2').filter((e) => e.type === 'REJECT');
    expect(ev.detail).toBeNull(); // absent, not a plausible sentence
  });

  it.each(
    USER_OWNED_STATUSES,
  )('never overwrites a user-owned invoice status (%s) with a late rejection', async (userStatus) => {
    const fake = new FakePrisma();
    seedRejectableDocument(fake, `f008-guard-${userStatus}`, `inv-${userStatus}`);
    fake.seedInvoice(`inv-${userStatus}`, userStatus);

    await service(fake).apply(`f008-guard-${userStatus}`, {
      type: 'INBOUND_STATUS',
      status: 'scarto',
    });

    // The document still records the rejection — the authority's verdict is never discarded …
    expect(fake.docStatus(`f008-guard-${userStatus}`)).toBe('REJECTED');
    // … but the user's own decision on the invoice stands.
    expect(fake.invoices.get(`inv-${userStatus}`)).toMatchObject({ status: userStatus });
    // And the guard is in the WHERE, not in a branch we could forget: the write was attempted
    // and matched zero rows, which is what makes this safe under a real concurrent update.
    expect(fake.invoiceUpdateAttempts).toHaveLength(1);
    // A FAILURE may be written over an in-flight invoice or over another projection-written
    // failure (a retry that fails again, a transmission failure that later becomes a rejection).
    // It may never be written over anything else, which is what this list encodes.
    expect(fake.invoiceUpdateAttempts[0].status).toEqual({ in: FAILURE_OVER });
  });

  it('leaves the invoice alone on a non-rejection outcome', async () => {
    const fake = new FakePrisma();
    seedRejectableDocument(fake, 'f008-3', 'inv-3');
    fake.seedInvoice('inv-3', 'SENT');

    await service(fake).apply('f008-3', { type: 'POLL_RESULT', status: 'CLEARED' });

    expect(fake.docStatus('f008-3')).toBe('CLEARED');
    expect(fake.invoices.get('inv-3')).toMatchObject({ status: 'SENT' });
    // Updated with the residual: CLEARED is now a RECOVERY target, so an attempt IS made — but it
    // is scoped to projection-written failures only, matches zero rows here, and leaves the invoice
    // exactly as the user left it. The original assertion (no attempt at all) encoded the
    // unidirectional design and would have hidden that scoping rather than checked it.
    expect(fake.invoiceUpdateAttempts).toHaveLength(1);
    expect(fake.invoiceUpdateAttempts[0].status).toEqual({ in: PROJECTION_OWNED_ORDER });
  });

  it('does not attempt an invoice write for a document with no invoice', async () => {
    const fake = new FakePrisma();
    seedRejectableDocument(fake, 'f008-4', null); // inbound/reception documents have no Invoice row

    await service(fake).apply('f008-4', { type: 'INBOUND_STATUS', status: 'scarto' });

    expect(fake.docStatus('f008-4')).toBe('REJECTED');
    expect(fake.invoiceUpdateAttempts).toHaveLength(0);
  });
});

describe('F-008 residual: TRANSMISSION_FAILED and REFUSED, and coming back from failure', () => {
  it('shows a transmission failure on the invoice', async () => {
    const fake = new FakePrisma();
    seedDocumentAt(fake, 'f008-tf', 'inv-tf', 'ISSUED');
    fake.seedInvoice('inv-tf', 'SENT');

    await service(fake).apply('f008-tf', { type: 'COMMAND', event: 'TRANSMISSION_FAIL' });

    expect(fake.docStatus('f008-tf')).toBe('TRANSMISSION_FAILED');
    expect(fake.invoices.get('inv-tf')).toMatchObject({ status: 'TRANSMISSION_FAILED' });
  });

  /**
   * The bidirectional case. TRANSMISSION_FAILED is the one failure the state machine lets a
   * document leave (SUBMIT_CLEARANCE and DELIVER both exit it), so a successful retry MUST clear
   * the invoice too — otherwise the fix for one lie installs another: an invoice stuck showing
   * "transmission failed" after the transmission has succeeded.
   */
  it('clears TRANSMISSION_FAILED from the invoice when a retry succeeds', async () => {
    const fake = new FakePrisma();
    seedDocumentAt(fake, 'f008-retry', 'inv-retry', 'ISSUED');
    fake.seedInvoice('inv-retry', 'SENT');

    await service(fake).apply('f008-retry', { type: 'COMMAND', event: 'TRANSMISSION_FAIL' });
    expect(fake.invoices.get('inv-retry')).toMatchObject({ status: 'TRANSMISSION_FAILED' });

    // The retry: send() succeeds this time and the document submits for clearance.
    await service(fake).apply('f008-retry', { type: 'COMMAND', event: 'SUBMIT_CLEARANCE' });

    expect(fake.docStatus('f008-retry')).toBe('PENDING_CLEARANCE');
    expect(fake.invoices.get('inv-retry')).toMatchObject({ status: 'PENDING_CLEARANCE' });

    // The recovery write was scoped to projection-owned statuses ONLY — it can never reach an
    // invoice that is merely in flight, let alone a user-owned one.
    expect(fake.invoiceUpdateAttempts[1].status).toEqual({ in: PROJECTION_OWNED_ORDER });
  });

  it.each(
    USER_OWNED_STATUSES,
  )('a recovery never writes over a user-owned invoice status (%s)', async (userStatus) => {
    const fake = new FakePrisma();
    // The document failed transmission and then recovered — but meanwhile the user acted on the
    // invoice. The user's decision wins, in this direction too.
    seedDocumentAt(fake, `f008-rec-${userStatus}`, `inv-rec-${userStatus}`, 'TRANSMISSION_FAILED');
    fake.seedInvoice(`inv-rec-${userStatus}`, userStatus);

    await service(fake).apply(`f008-rec-${userStatus}`, {
      type: 'COMMAND',
      event: 'SUBMIT_CLEARANCE',
    });

    expect(fake.docStatus(`f008-rec-${userStatus}`)).toBe('PENDING_CLEARANCE');
    expect(fake.invoices.get(`inv-rec-${userStatus}`)).toMatchObject({ status: userStatus });
    expect(fake.invoiceUpdateAttempts).toHaveLength(1);
  });

  /**
   * The chain gap this ownership audit uncovered. A retry runs
   * TRANSMISSION_FAILED -> PENDING_CLEARANCE -> CLEARED. With PENDING_CLEARANCE missing from
   * PROJECTION_OWNED, the second hop could not be written and the invoice stayed on
   * PENDING_CLEARANCE while its document was cleared — the recovery stopping half way.
   */
  it('follows a retry all the way through to CLEARED', async () => {
    const fake = new FakePrisma();
    seedDocumentAt(fake, 'f008-chain', 'inv-chain', 'ISSUED');
    fake.seedInvoice('inv-chain', 'SENT');
    const svc = service(fake);

    await svc.apply('f008-chain', { type: 'COMMAND', event: 'TRANSMISSION_FAIL' });
    expect(fake.invoices.get('inv-chain')).toMatchObject({ status: 'TRANSMISSION_FAILED' });

    await svc.apply('f008-chain', { type: 'COMMAND', event: 'SUBMIT_CLEARANCE' });
    expect(fake.invoices.get('inv-chain')).toMatchObject({ status: 'PENDING_CLEARANCE' });

    await svc.apply('f008-chain', { type: 'POLL_RESULT', status: 'CLEARED' });
    expect(fake.docStatus('f008-chain')).toBe('CLEARED');
    expect(fake.invoices.get('inv-chain')).toMatchObject({ status: 'CLEARED' });
  });

  it('does not touch an in-flight invoice on a clearance that never failed', async () => {
    const fake = new FakePrisma();
    seedDocumentAt(fake, 'f008-happy', 'inv-happy', 'PENDING_CLEARANCE');
    fake.seedInvoice('inv-happy', 'SENT');

    await service(fake).apply('f008-happy', { type: 'POLL_RESULT', status: 'CLEARED' });

    expect(fake.docStatus('f008-happy')).toBe('CLEARED');
    // A recovery entry exists for CLEARED, but it may only overwrite a projection-written failure.
    // This invoice never failed, so the happy path is left exactly as the user left it.
    expect(fake.invoices.get('inv-happy')).toMatchObject({ status: 'SENT' });
    expect(fake.invoiceUpdateAttempts).toHaveLength(1);
    expect(fake.invoiceUpdateAttempts[0].status).toEqual({ in: PROJECTION_OWNED_ORDER });
  });

  it('shows a buyer refusal on the invoice', async () => {
    const fake = new FakePrisma();
    seedDocumentAt(fake, 'f008-ref', 'inv-ref', 'AWAITING_RESPONSE');
    fake.seedInvoice('inv-ref', 'SENT');

    await service(fake).apply('f008-ref', {
      type: 'INBOUND_STATUS',
      status: 'refusée par le destinataire',
    });

    expect(fake.docStatus('f008-ref')).toBe('REFUSED');
    expect(fake.invoices.get('inv-ref')).toMatchObject({ status: 'REFUSED' });
    // REFUSED: { CORRECT: 'CORRECTED' } — its only exit is a user action, and CORRECTED is not a
    // recovery target, so the projection can never silently un-refuse an invoice.
    const [ev] = fake.eventsFor('f008-ref').filter((e) => e.type === 'REFUSE');
    expect(ev.detail).toBe('refusée par le destinataire');
  });
});
