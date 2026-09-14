/**
 * TimeEntriesService in isolation, mocked at `@/prisma/prisma.service` — same discipline
 * articles.service.spec.ts/projects.service.spec.ts already hold. `billToInvoice` is the property
 * this whole feature exists to guarantee (TODO_FEATURES.md rank 11: "that last property is the one
 * to test hardest — double-billing a client is the failure that matters"), so it gets the deepest
 * coverage here: every pre-flight refusal, the happy path's exact persisted shape, AND the real
 * concurrency guard — simulated by making the mocked `$transaction`'s own `timeEntry.updateMany`
 * claim FEWER rows than requested, exactly what a genuine Postgres race would produce (see
 * `billToInvoice`'s own header for why that is the actual guarantee, not the pre-flight checks).
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { TimeEntriesService } from './time-entries.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    timeEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    project: { findFirst: jest.fn() },
    client: { findFirst: jest.fn() },
    company: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const mockedPrisma = prisma as unknown as {
  timeEntry: {
    findFirstOrThrow: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  project: { findFirst: jest.Mock };
  client: { findFirst: jest.Mock };
  company: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

function project(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    companyId: 'company-1',
    clientId: 'client-1',
    hourlyRateMinor: null,
    ...overrides,
  };
}

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'entry-1',
    companyId: 'company-1',
    projectId: 'project-1',
    date: new Date('2026-06-01'),
    durationMinutes: 60,
    description: null,
    billable: true,
    hourlyRateMinor: null,
    invoiceId: null,
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    project: { id: 'project-1', name: 'Website redesign', clientId: 'client-1' },
    ...overrides,
  };
}

/** A `tx` double exposing exactly the two calls `billToInvoice` makes on it — the mocked
 *  `$transaction` invokes the caller's own callback with this, the same way Prisma's real
 *  `$transaction` invokes it with an interactive `TransactionClient`. */
function makeTx(opts: { updateManyCount: number }) {
  return {
    documentInstance: {
      create: jest.fn().mockResolvedValue({ id: 'invoice-1', typeId: 'invoice', status: 'draft' }),
    },
    timeEntry: { updateMany: jest.fn().mockResolvedValue({ count: opts.updateManyCount }) },
  };
}

describe('TimeEntriesService', () => {
  let service: TimeEntriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TimeEntriesService();
    mockedPrisma.company.findUnique.mockResolvedValue({ currency: 'EUR' });
  });

  describe('create', () => {
    it('refuses a non-positive duration', async () => {
      await expect(
        service.create('company-1', { projectId: 'project-1', date: '2026-06-01', durationMinutes: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a fractional duration (must be whole minutes)', async () => {
      await expect(
        service.create('company-1', { projectId: 'project-1', date: '2026-06-01', durationMinutes: 30.5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s for a project belonging to another company', async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(null);
      await expect(
        service.create('company-1', { projectId: 'foreign', date: '2026-06-01', durationMinutes: 60 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('defaults billable to true', async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(project());
      mockedPrisma.timeEntry.create.mockResolvedValue(entry());

      await service.create('company-1', { projectId: 'project-1', date: '2026-06-01', durationMinutes: 60 });

      expect(mockedPrisma.timeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ billable: true }) }),
      );
    });
  });

  describe('effectiveHourlyRate — what a screen must show, vs. hourlyRate — what an edit form must show', () => {
    it('falls back to the project default when the entry sets no override of its own', async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(project());
      mockedPrisma.timeEntry.create.mockResolvedValue(
        entry({
          hourlyRateMinor: null,
          project: { id: 'project-1', name: 'Website redesign', clientId: 'client-1', hourlyRateMinor: 8000 },
        }),
      );

      const result = await service.create('company-1', {
        projectId: 'project-1',
        date: '2026-06-01',
        durationMinutes: 60,
      });

      expect(result.hourlyRate).toBeNull();
      expect(result.effectiveHourlyRate).toBe(80);
    });

    it("the entry's own override wins in effectiveHourlyRate too, and is what hourlyRate reports", async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(project());
      mockedPrisma.timeEntry.create.mockResolvedValue(
        entry({
          hourlyRateMinor: 15000,
          project: { id: 'project-1', name: 'Website redesign', clientId: 'client-1', hourlyRateMinor: 8000 },
        }),
      );

      const result = await service.create('company-1', {
        projectId: 'project-1',
        date: '2026-06-01',
        durationMinutes: 60,
        hourlyRate: 150,
      });

      expect(result.hourlyRate).toBe(150);
      expect(result.effectiveHourlyRate).toBe(150);
    });

    it('is null when NEITHER the entry nor its project has a rate at all', async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(project());
      mockedPrisma.timeEntry.create.mockResolvedValue(
        entry({
          hourlyRateMinor: null,
          project: { id: 'project-1', name: 'Website redesign', clientId: 'client-1', hourlyRateMinor: null },
        }),
      );

      const result = await service.create('company-1', {
        projectId: 'project-1',
        date: '2026-06-01',
        durationMinutes: 60,
      });

      expect(result.effectiveHourlyRate).toBeNull();
    });
  });

  describe('update/remove refuse an already-billed entry', () => {
    it('update() 409s once invoiceId is set', async () => {
      mockedPrisma.timeEntry.findFirst.mockResolvedValue(entry({ invoiceId: 'invoice-1' }));
      await expect(service.update('company-1', 'entry-1', { description: 'edited' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockedPrisma.timeEntry.update).not.toHaveBeenCalled();
    });

    it('remove() 409s once invoiceId is set', async () => {
      mockedPrisma.timeEntry.findFirst.mockResolvedValue(entry({ invoiceId: 'invoice-1' }));
      await expect(service.remove('company-1', 'entry-1')).rejects.toBeInstanceOf(ConflictException);
      expect(mockedPrisma.timeEntry.delete).not.toHaveBeenCalled();
    });

    it('an unbilled entry can still be freely edited and deleted', async () => {
      mockedPrisma.timeEntry.findFirst.mockResolvedValue(entry({ invoiceId: null }));
      mockedPrisma.timeEntry.updateMany.mockResolvedValue({ count: 1 });
      mockedPrisma.timeEntry.findFirstOrThrow.mockResolvedValue(entry({ description: 'edited' }));
      await expect(service.update('company-1', 'entry-1', { description: 'edited' })).resolves.toBeDefined();

      mockedPrisma.timeEntry.findFirst.mockResolvedValue(entry({ invoiceId: null }));
      mockedPrisma.timeEntry.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.remove('company-1', 'entry-1')).resolves.toEqual({ id: 'entry-1' });
    });

    // The two tests above prove the check refuses an entry ALREADY billed when the call starts. They
    // cannot see the window between that read and the write, which is exactly where `billToInvoice`
    // lands. These two pin the guard that now lives IN the write.
    it('update() refuses with 409 when billing claims the entry between the read and the write', async () => {
      mockedPrisma.timeEntry.findFirst.mockResolvedValue(entry({ invoiceId: null }));
      mockedPrisma.timeEntry.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.update('company-1', 'entry-1', { durationMinutes: 90 })).rejects.toThrow(
        ConflictException,
      );
      expect(mockedPrisma.timeEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ invoiceId: null, companyId: 'company-1' }),
        }),
      );
    });

    it('remove() refuses in the same window, and never hard-deletes a row an invoice line came from', async () => {
      mockedPrisma.timeEntry.findFirst.mockResolvedValue(entry({ invoiceId: null }));
      mockedPrisma.timeEntry.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('company-1', 'entry-1')).rejects.toThrow(ConflictException);
      expect(mockedPrisma.timeEntry.deleteMany).toHaveBeenCalledWith({
        where: { id: 'entry-1', companyId: 'company-1', invoiceId: null },
      });
    });
  });

  describe('billToInvoice — the double-billing guard', () => {
    beforeEach(() => {
      mockedPrisma.client.findFirst.mockResolvedValue({ id: 'client-1', companyId: 'company-1' });
    });

    it('refuses an empty selection', async () => {
      await expect(
        service.billToInvoice('company-1', { clientId: 'client-1', entryIds: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('404s for a client belonging to another company', async () => {
      mockedPrisma.client.findFirst.mockResolvedValue(null);
      await expect(
        service.billToInvoice('company-1', { clientId: 'foreign', entryIds: ['entry-1'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses when a selected id does not resolve to a real entry of this company', async () => {
      mockedPrisma.timeEntry.findMany.mockResolvedValue([entry({ id: 'entry-1' })]); // one short
      await expect(
        service.billToInvoice('company-1', { clientId: 'client-1', entryIds: ['entry-1', 'ghost'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with 409 — never silently re-bills — when an entry was already billed', async () => {
      mockedPrisma.timeEntry.findMany.mockResolvedValue([entry({ invoiceId: 'invoice-0' })]);
      await expect(
        service.billToInvoice('company-1', { clientId: 'client-1', entryIds: ['entry-1'] }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a non-billable entry', async () => {
      mockedPrisma.timeEntry.findMany.mockResolvedValue([entry({ billable: false })]);
      await expect(
        service.billToInvoice('company-1', { clientId: 'client-1', entryIds: ['entry-1'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an entry whose project belongs to a DIFFERENT client than the one billed', async () => {
      mockedPrisma.timeEntry.findMany.mockResolvedValue([
        entry({ project: { id: 'project-1', name: 'X', clientId: 'other-client' } }),
      ]);
      await expect(
        service.billToInvoice('company-1', { clientId: 'client-1', entryIds: ['entry-1'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when a selected entry has no resolvable hourly rate', async () => {
      mockedPrisma.timeEntry.findMany.mockResolvedValue([entry({ hourlyRateMinor: null })]);
      await expect(
        service.billToInvoice('company-1', { clientId: 'client-1', entryIds: ['entry-1'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('happy path: creates ONE draft invoice with one line per entry, and claims every entry', async () => {
      const e1 = entry({ id: 'e1', durationMinutes: 60, hourlyRateMinor: 10000, description: 'Layout' });
      const e2 = entry({ id: 'e2', durationMinutes: 120, hourlyRateMinor: 10000, description: 'API' });
      mockedPrisma.timeEntry.findMany.mockResolvedValue([e1, e2]);
      const tx = makeTx({ updateManyCount: 2 });
      mockedPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      const result = await service.billToInvoice('company-1', {
        clientId: 'client-1',
        entryIds: ['e1', 'e2'],
      });

      expect(tx.documentInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'company-1',
            typeId: 'invoice',
            status: 'draft',
            data: expect.objectContaining({
              client: 'client-1',
              currency: 'EUR',
              lines: [
                { description: 'Website redesign — Layout', quantity: 1, unit: 'hour', unitPrice: 100 },
                { description: 'Website redesign — API', quantity: 2, unit: 'hour', unitPrice: 100 },
              ],
            }),
          }),
        }),
      );
      expect(tx.timeEntry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['e1', 'e2'] }, companyId: 'company-1', invoiceId: null },
        data: { invoiceId: 'invoice-1' },
      });
      expect(result).toEqual({
        invoice: { id: 'invoice-1', typeId: 'invoice', status: 'draft' },
        billedEntryIds: ['e1', 'e2'],
      });
    });

    it("an entry's own rate override is used over the project's default when both are billed together", async () => {
      // computeGeneratedInvoiceLines reads `project.hourlyRateMinor` — attach it directly on the row
      // the way the real Prisma `include` would (project sub-object carrying its own column, see
      // billToInvoice's own `select` for why this is the ONE query in this file that includes it).
      const overridden = entry({
        id: 'e1',
        hourlyRateMinor: 20000,
        project: { id: 'project-1', name: 'Website redesign', clientId: 'client-1', hourlyRateMinor: 5000 },
      });
      const usesDefault = entry({
        id: 'e2',
        hourlyRateMinor: null,
        project: { id: 'project-1', name: 'Website redesign', clientId: 'client-1', hourlyRateMinor: 5000 },
      });
      mockedPrisma.timeEntry.findMany.mockResolvedValue([overridden, usesDefault]);
      const tx = makeTx({ updateManyCount: 2 });
      mockedPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      await service.billToInvoice('company-1', { clientId: 'client-1', entryIds: ['e1', 'e2'] });

      const lines = tx.documentInstance.create.mock.calls[0][0].data.data.lines;
      expect(lines[0].unitPrice).toBe(200); // e1: its own 20000 minor override
      expect(lines[1].unitPrice).toBe(50); // e2: falls back to the project's 5000 minor default
    });

    it('THE CORE GUARANTEE: a concurrent claim on the same entry rolls the whole transaction back with 409, never a second invoice', async () => {
      mockedPrisma.timeEntry.findMany.mockResolvedValue([entry({ hourlyRateMinor: 10000 })]);
      // Simulates the real Postgres race this comment in billToInvoice documents: another
      // transaction committed its own claim on this row first, so THIS transaction's own
      // `updateMany` (re-evaluated after the row lock is released) matches zero rows.
      const tx = makeTx({ updateManyCount: 0 });
      mockedPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

      await expect(
        service.billToInvoice('company-1', { clientId: 'client-1', entryIds: ['entry-1'] }),
      ).rejects.toBeInstanceOf(ConflictException);
      // The invoice was tentatively created INSIDE the transaction, but since the transaction as a
      // whole rejected, a real Prisma client would roll it back too — asserted here as "the create
      // call happened only inside the same failed unit of work", not as a fabricated second guarantee.
      expect(tx.documentInstance.create).toHaveBeenCalledTimes(1);
    });
  });
});
