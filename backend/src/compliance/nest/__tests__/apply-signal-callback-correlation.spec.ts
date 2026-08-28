/**
 * F-2 (QUEUE_IMPL_PLAN.md §5.2, Phase 4) — offline unit spec, no Redis/Postgres required.
 *
 * Proves two things about `ApplySignalService.apply()`'s AWAIT_CALLBACK handling:
 *  1. correlationKey fix: an AWAIT_CALLBACK armed with `ctx.transmitRef = 'EXTREF-123'` persists a
 *     CallbackRegistration whose `correlationKey === 'EXTREF-123'` — the authority's EXTERNAL ref —
 *     not the internal documentId. `InboundRouter.receive()` (real pure router + a real
 *     `PrismaCallbackStore` wired to an in-memory Prisma double) then MATCHES an inbound message
 *     carrying that external ref, and reports UNMATCHED for one carrying the (pre-fix) documentId —
 *     the exact regression this test guards against.
 *  2. ASYNC_CALLBACK fallback POLL: the same apply() call ALSO arms a belt-and-suspenders
 *     SCHEDULE_POLL using the resolved provider's own `pollPolicy` (no invented cadence).
 *
 * The "Prisma store double" is a minimal in-memory object implementing just the delegate calls
 * `ApplySignalService`/`PrismaComplianceDocumentStore`/`PrismaPollJobStore`/`PrismaCallbackStore`
 * actually issue for this flow (same technique as compliance-pipeline.service.spec.ts's fake
 * `prisma` object) — no real Postgres connection, no Redis, no BullMQ.
 */
import { PrismaService } from '@/prisma/prisma.service';
import { PartyRole } from '../../types';
import { PartyTaxProfile, TransactionContext } from '../../canonical/canonical-document';
import { primaryObligation, resolve } from '../../engine/compliance-engine';
import { RecordingComplianceLogger } from '../../execution/logger';
import { InboundRouter } from '../../lifecycle/drivers/inbound-router';
import { PrismaCallbackStore } from '../../persistence/prisma-callback-store';
import { ApplySignalService } from '../apply-signal';

function party(country: string, role: PartyRole): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }],
  };
}

interface SeedDoc {
  id: string;
  kind: string;
  direction: string;
  status: string;
  ctx: TransactionContext;
  plan: unknown;
  authorityIds?: unknown[];
  events?: Array<{ id: string; type: string; at: string; actor?: string }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Minimal in-memory double for the Prisma delegate calls `ApplySignalService.apply()` issues via
 * `PrismaComplianceDocumentStore`/`PrismaPollJobStore`/`PrismaTimerJobStore`/`PrismaCallbackStore`.
 * `$transaction` just invokes the callback with `this` (no real transactional semantics needed for
 * this single-threaded, single-call test).
 */
class FakePrisma {
  private readonly docs = new Map<string, Record<string, unknown>>();
  private readonly events = new Map<string, Array<Record<string, unknown>>>();
  private readonly authorityIds = new Map<string, Array<Record<string, unknown>>>();
  private readonly jobs = new Map<string, Record<string, unknown>>();
  private readonly callbackRegs = new Map<string, Record<string, unknown>>();
  private readonly inboundMessages: Array<Record<string, unknown>> = [];

  seedDocument(rec: SeedDoc): void {
    this.docs.set(rec.id, {
      id: rec.id,
      kind: rec.kind,
      direction: rec.direction,
      status: rec.status,
      ctx: rec.ctx,
      plan: rec.plan,
      number: null,
      immutableHash: null,
      previousHash: null,
      correctsId: null,
      invoiceId: null,
      createdAt: new Date(rec.createdAt),
      updatedAt: new Date(rec.updatedAt),
    });
    this.events.set(
      rec.id,
      (rec.events ?? []).map((e) => ({ ...e, documentId: rec.id, at: new Date(e.at) })),
    );
    this.authorityIds.set(
      rec.id,
      (rec.authorityIds ?? []).map((a) => ({ ...(a as object), documentId: rec.id })),
    );
  }

  scheduledJobsFor(documentId: string): Array<Record<string, unknown>> {
    return [...this.jobs.values()].filter((j) => j.documentId === documentId);
  }

  callbackRegistrationsFor(documentId: string): Array<Record<string, unknown>> {
    return [...this.callbackRegs.values()].filter((r) => r.documentId === documentId);
  }

  private row(id: string): Record<string, unknown> | null {
    const doc = this.docs.get(id);
    if (!doc) return null;
    return { ...doc, events: this.events.get(id) ?? [], authorityIds: this.authorityIds.get(id) ?? [] };
  }

  complianceDocument = {
    findUnique: async ({ where }: { where: { id: string } }) => this.row(where.id),
    update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const { authorityIds, ...fields } = data;
      this.docs.set(where.id, { ...this.docs.get(where.id), ...fields });
      if (authorityIds?.create) {
        this.authorityIds.set(
          where.id,
          authorityIds.create.map((a: object) => ({ ...a, documentId: where.id })),
        );
      }
      return this.row(where.id);
    },
    // M-12b: backs PrismaComplianceDocumentStore.transitionIfStatus's CAS (`updateMany({ where: {
    // id, status: expectedStatus }, ... })`) — matches (and writes) only when the seeded document's
    // current status equals `where.status`, exactly like the real Postgres `updateMany` semantics
    // this fake is standing in for.
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status?: string };
      data: Record<string, any>;
    }) => {
      const doc = this.docs.get(where.id);
      if (!doc || (where.status !== undefined && doc.status !== where.status)) {
        return { count: 0 };
      }
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

  scheduledJob = {
    create: async ({ data }: { data: Record<string, any> }) => {
      const row: Record<string, any> = { ...data };
      delete row.document;
      row.documentId = data.document?.connect?.id ?? data.documentId;
      this.jobs.set(row.id, row);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      let count = 0;
      for (const [id, row] of this.jobs) {
        if (row.documentId !== where.documentId) continue;
        if (where.kind && row.kind !== where.kind) continue;
        if (where.status?.in && !where.status.in.includes(row.status)) continue;
        this.jobs.set(id, { ...row, ...data });
        count++;
      }
      return { count };
    },
  };

  complianceCallbackRegistration = {
    create: async ({ data }: { data: Record<string, any> }) => {
      const row: Record<string, any> = { ...data };
      delete row.document;
      row.documentId = data.document?.connect?.id ?? data.documentId;
      this.callbackRegs.set(row.id, row);
      return row;
    },
    findFirst: async ({ where }: { where: Record<string, any> }) => {
      const rows = [...this.callbackRegs.values()].filter(
        (r) =>
          r.channel === where.channel &&
          r.correlationKey === where.correlationKey &&
          where.status.in.includes(r.status),
      );
      return rows[0] ?? null;
    },
    updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      let count = 0;
      for (const [id, row] of this.callbackRegs) {
        if (row.documentId !== where.documentId) continue;
        if (where.status?.in && !where.status.in.includes(row.status)) continue;
        this.callbackRegs.set(id, { ...row, ...data });
        count++;
      }
      return { count };
    },
  };

  complianceInboundMessage = {
    findFirst: async ({ where }: { where: Record<string, any> }) =>
      this.inboundMessages.find((m) => m.channel === where.channel && m.rawRef === where.rawRef) ?? null,
    create: async ({ data }: { data: Record<string, any> }) => {
      this.inboundMessages.push(data);
      return data;
    },
  };

  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

function itCtx(): TransactionContext {
  return {
    supplier: party('IT', 'B2B'),
    buyer: party('IT', 'B2B'),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' }],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
  };
}

describe('F-2: AWAIT_CALLBACK correlates on ctx.transmitRef (the external ref), not the documentId', () => {
  it('apply() persists a CallbackRegistration keyed on EXTREF-123, and InboundRouter matches only that key', async () => {
    const fake = new FakePrisma();
    const applySignal = new ApplySignalService(
      fake as unknown as PrismaService,
      undefined, // defaultTransmissionRegistry — SdI/PDP/Peppol are registered regardless of credentials
      undefined, // no BullMQ dispatcher needed for this assertion (persisted row is what we check)
      new RecordingComplianceLogger(),
    );

    const ctx = itCtx();
    const plan = resolve(ctx);
    expect(primaryObligation(plan).blocking).toBe(true); // IT/SdI clearance — SUBMIT_CLEARANCE is legal from ISSUED

    const id = 'f2-it-1';
    const nowIso = new Date().toISOString();
    fake.seedDocument({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'ISSUED',
      ctx,
      plan,
      authorityIds: [],
      events: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await applySignal.apply(id, { type: 'COMMAND', event: 'SUBMIT_CLEARANCE' }, undefined, {
      transmitRef: 'EXTREF-123',
    });

    const regs = fake.callbackRegistrationsFor(id);
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({
      documentId: id,
      channel: 'SDI',
      correlationKey: 'EXTREF-123',
      status: 'WAITING',
    });
    // The regression this test guards: correlationKey must NOT fall back to the internal documentId
    // now that ctx.transmitRef is available.
    expect(regs[0].correlationKey).not.toBe(id);

    // InboundRouter (real pure router) + a real PrismaCallbackStore wired to the same fake Prisma —
    // this is the actual webhook-handling path (ComplianceController's inbound endpoints call
    // router.receive()).
    const store = new PrismaCallbackStore(fake as unknown as PrismaService);
    const applied: Array<[string, unknown]> = [];
    const router = new InboundRouter({
      applySignal: (docId, signal) => {
        applied.push([docId, signal]);
      },
      store,
    });

    // The webhook carries the authority's ref (what a real PDP/SdI push actually contains).
    const routed = await router.receive({
      channel: 'SDI',
      correlationKey: 'EXTREF-123',
      status: 'notifica - consegnata',
      rawRef: 'sdi-msg-1',
    });
    expect(routed).toMatchObject({ kind: 'ROUTED', documentId: id });
    expect(applied).toHaveLength(1);

    // Sanity/regression guard: an inbound keyed on the OLD (pre-fix) correlation — the internal
    // documentId — must NOT match now that the registration is keyed on the external ref.
    const unmatched = await router.receive({
      channel: 'SDI',
      correlationKey: id,
      status: 'notifica - consegnata',
      rawRef: 'sdi-msg-2',
    });
    expect(unmatched).toEqual({ kind: 'UNMATCHED', correlationKey: id });
  });

  it('without ctx.transmitRef, correlationKey still falls back to documentId (unchanged prior behavior)', async () => {
    const fake = new FakePrisma();
    const applySignal = new ApplySignalService(fake as unknown as PrismaService, undefined, undefined);

    const ctx = itCtx();
    const plan = resolve(ctx);
    const id = 'f2-it-2';
    const nowIso = new Date().toISOString();
    fake.seedDocument({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'ISSUED',
      ctx,
      plan,
      authorityIds: [],
      events: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await applySignal.apply(id, { type: 'COMMAND', event: 'SUBMIT_CLEARANCE' }); // no ctx at all

    const regs = fake.callbackRegistrationsFor(id);
    expect(regs).toHaveLength(1);
    expect(regs[0].correlationKey).toBe(id);
  });

  it("also arms a fallback SCHEDULE_POLL using the provider's own pollPolicy (belt-and-suspenders)", async () => {
    const fake = new FakePrisma();
    const applySignal = new ApplySignalService(
      fake as unknown as PrismaService,
      undefined,
      undefined,
      new RecordingComplianceLogger(),
    );

    const ctx = itCtx();
    const plan = resolve(ctx);
    const id = 'f2-it-3';
    const nowIso = new Date().toISOString();
    fake.seedDocument({
      id,
      kind: 'INVOICE',
      direction: 'OUTBOUND',
      status: 'ISSUED',
      ctx,
      plan,
      authorityIds: [],
      events: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await applySignal.apply(id, { type: 'COMMAND', event: 'SUBMIT_CLEARANCE' }, undefined, {
      transmitRef: 'EXTREF-456',
    });

    const jobs = fake.scheduledJobsFor(id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'POLL',
      providerId: 'sdi',
      channel: 'SDI',
      ref: 'EXTREF-456',
      status: 'PENDING',
      // SdiTransmissionProvider.pollPolicy (providers/transmission/sdi-transmission.ts) — reused
      // verbatim, no invented "every 15 min" constant.
      policy: { everySeconds: 60, timeoutHours: 72, backoff: 'EXPONENTIAL' },
    });
  });
});
