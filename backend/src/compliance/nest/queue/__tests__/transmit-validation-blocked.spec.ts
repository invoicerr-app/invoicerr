import { Job } from 'bullmq';
import { PartyRole } from '../../../types';
import { PartyTaxProfile, TransactionContext } from '../../../canonical/canonical-document';
import { resolve } from '../../../engine/compliance-engine';
import { ComplianceExecutor } from '../../../execution/executor';
import { FormatValidationError } from '../../../execution/types';
import { ComplianceService } from '../../../operations/compliance-service';
import { InMemoryComplianceDocumentStore } from '../../../operations/document-store';
import { PrismaComplianceDocumentStore } from '../../../persistence/prisma-document-store';
import { ApplySignalService } from '../../apply-signal';
import { TransmitProcessor } from '../processors/transmit.processor';
import { TransmitJobData } from '../queue.constants';

/**
 * M-1 async-path parity (follow-up to format-validation-blocking.spec.ts, which covers the SYNC
 * `ComplianceService.send()` path). The primary FR/PL/IT markets transmit over ASYNC channels
 * (PDP/KSeF/SdI/Peppol) which enqueue a `compliance-transmit` job instead of sending synchronously,
 * so the block goes through `TransmitProcessor.process()` — NOT `send()`.
 *
 * Proves the processor is now consistent with the sync path: an invalid artifact
 *   1. records a first-class VALIDATION_BLOCKED event (same shared ComplianceService method / event
 *      shape as send()),
 *   2. does NOT throw out of process() — a deterministic validation failure must never trigger a
 *      BullMQ retry (retrying rebuilds the same invalid artifact and fails identically), and
 *   3. leaves the document at ISSUED (never transmitted; ApplySignalService.apply() is never called).
 *
 * And the complementary guarantee: any OTHER (transient) error DOES rethrow so BullMQ still retries.
 *
 * Pure unit test — `process()` is driven directly with a fake Job and fakes for its collaborators
 * (no Redis, no Postgres). The one InMemoryComplianceDocumentStore is shared as both the processor's
 * docStore AND the ComplianceService's store, exactly as prod DI wires them (compliance-core.module
 * .ts: ComplianceService is built with `store: <the same PrismaComplianceDocumentStore>`).
 */
function party(country: string, role: PartyRole = 'B2B'): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }],
  };
}

function frCtx(): TransactionContext {
  return {
    supplier: party('FR'),
    buyer: party('FR'),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
  };
}

/** Executor that aborts exactly where the real ComplianceExecutor.execute() does on a bad artifact. */
function throwingExecutor(err: Error): ComplianceExecutor {
  return { execute: async () => Promise.reject(err) } as unknown as ComplianceExecutor;
}

function job(documentId: string): Job<TransmitJobData> {
  return { id: 'job-1', data: { documentId, idempotencyKey: 'idem-1' } } as unknown as Job<TransmitJobData>;
}

function harness(executor: ComplianceExecutor) {
  const store = new InMemoryComplianceDocumentStore();
  const service = new ComplianceService({ store, executor });
  const applySignal = { apply: jest.fn() };
  const processor = new TransmitProcessor(
    store as unknown as PrismaComplianceDocumentStore,
    service,
    applySignal as unknown as ApplySignalService,
  );
  return { store, applySignal, processor };
}

async function seedIssued(store: InMemoryComplianceDocumentStore, id: string): Promise<void> {
  const ctx = frCtx();
  const nowIso = new Date().toISOString();
  await store.save({
    id,
    kind: 'INVOICE',
    direction: 'OUTBOUND',
    status: 'ISSUED',
    ctx,
    plan: resolve(ctx),
    authorityIds: [],
    events: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

describe('M-1 — async transmit path blocks invalid documents (TransmitProcessor)', () => {
  it('records VALIDATION_BLOCKED, does NOT throw (no BullMQ retry), and leaves the document at ISSUED', async () => {
    const err = new FormatValidationError('format validation failed for EN16931_CII', [
      { syntax: 'EN16931_CII', role: 'AUTHORITATIVE', errors: ['[BR-06] Seller name is missing'] },
    ]);
    const { store, applySignal, processor } = harness(throwingExecutor(err));
    const id = 'async-fr-invalid';
    await seedIssued(store, id);

    // Must RESOLVE — BullMQ treats a resolved process() as success and does NOT retry the job.
    await expect(processor.process(job(id))).resolves.toBeUndefined();

    const after = await store.get(id);
    // Never advanced past ISSUED — the document was never transmitted (same state outcome as send()).
    expect(after!.status).toBe('ISSUED');
    const blocked = after!.events.find((e) => e.type === 'VALIDATION_BLOCKED');
    expect(blocked).toBeDefined();
    expect(blocked!.detail).toMatch(/EN16931_CII/);
    expect(blocked!.payload).toEqual(
      expect.arrayContaining([expect.objectContaining({ syntax: 'EN16931_CII' })]),
    );
    // The event-sourced transition path was never entered (nothing delivered/submitted for clearance).
    expect(applySignal.apply).not.toHaveBeenCalled();
  });

  it('rethrows a non-validation (transient) transmit error so BullMQ still retries', async () => {
    const { store, applySignal, processor } = harness(throwingExecutor(new Error('KSeF gateway 503')));
    const id = 'async-fr-transient';
    await seedIssued(store, id);

    await expect(processor.process(job(id))).rejects.toThrow(/KSeF gateway 503/);

    const after = await store.get(id);
    expect(after!.status).toBe('ISSUED');
    // A transient failure is NOT a validation block — no VALIDATION_BLOCKED event is recorded.
    expect(after!.events.some((e) => e.type === 'VALIDATION_BLOCKED')).toBe(false);
    expect(applySignal.apply).not.toHaveBeenCalled();
  });
});
