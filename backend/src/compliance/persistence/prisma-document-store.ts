import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { TransactionContext } from '../canonical/canonical-document';
import { ComplianceStatus } from '../lifecycle/state-machine';
import { ComplianceDocumentEvent, ComplianceDocumentRecord } from '../operations/types';
import { ComplianceDocumentStore } from '../operations/document-store';
import { documentToRecord, documentToCreateInput, documentToUpdateInput } from './mappers';

export class PrismaComplianceDocumentStore implements ComplianceDocumentStore {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: ComplianceDocumentRecord): Promise<ComplianceDocumentRecord> {
    const create = documentToCreateInput(record);
    const update = documentToUpdateInput(record);
    const row = await this.prisma.complianceDocument.upsert({
      where: { id: record.id },
      create,
      update,
      include: { events: true, authorityIds: true },
    });
    return documentToRecord(row);
  }

  async get(id: string): Promise<ComplianceDocumentRecord | null> {
    const row = await this.prisma.complianceDocument.findUnique({
      where: { id },
      include: { events: true, authorityIds: true },
    });
    return row ? documentToRecord(row) : null;
  }

  async update(id: string, patch: Partial<ComplianceDocumentRecord>): Promise<ComplianceDocumentRecord> {
    const data: Prisma.ComplianceDocumentUpdateInput = {};
    if ('status' in patch) data.status = patch.status;
    if ('plan' in patch) data.plan = (patch.plan ?? null) as unknown as Prisma.InputJsonValue; // plain-null passthrough kept (see mappers.toNullableJson)
    if ('number' in patch) data.number = patch.number ?? null;
    if ('immutableHash' in patch) data.immutableHash = patch.immutableHash ?? null;
    if ('previousHash' in patch) data.previousHash = patch.previousHash ?? null;
    // Invariant: TransactionContext is JSON-serializable (issueDate persists as an ISO string).
    if ('ctx' in patch) data.ctx = patch.ctx as unknown as Prisma.InputJsonValue;
    if ('correctsId' in patch) data.correctsId = patch.correctsId ?? null;
    if ('authorityIds' in patch) {
      data.authorityIds = {
        deleteMany: {},
        create: patch.authorityIds!.map((a) => ({ scheme: a.scheme, value: a.value })),
      };
    }
    data.updatedAt = new Date();

    const row = await this.prisma.complianceDocument.update({
      where: { id },
      data,
      include: { events: true, authorityIds: true },
    });

    // Append-only events: only create events whose IDs are not yet persisted
    if ('events' in patch && patch.events) {
      const existingIds = (
        await this.prisma.complianceEvent.findMany({
          where: { documentId: id },
          select: { id: true },
        })
      ).map((e) => e.id);
      const newEvents = patch.events.filter((e) => !existingIds.includes(e.id));
      if (newEvents.length > 0) {
        await this.prisma.complianceEvent.createMany({
          data: newEvents.map((e) => ({
            id: e.id,
            documentId: id,
            type: e.type,
            at: new Date(e.at),
            actor: e.actor ?? null,
            detail: e.detail ?? null,
            payload: (e.payload ?? null) as unknown as Prisma.InputJsonValue, // plain-null passthrough kept
          })),
        });
      }
      // Re-read to include newly created events (the row exists — we just updated it)
      const refreshed = await this.prisma.complianceDocument.findUnique({
        where: { id },
        include: { events: true, authorityIds: true },
      });
      return documentToRecord(refreshed!);
    }

    return documentToRecord(row);
  }

  /**
   * M-12b: optimistic compare-and-swap transition. `ComplianceDocument` has no version column, so
   * the `status` column itself doubles as the CAS token — the write is conditioned on the document
   * STILL being in `expectedStatus` (the status the caller originally read). Guards against two
   * concurrent signals (e.g. a poll and a webhook racing to apply CLEAR vs REJECT, or two identical
   * webhook deliveries) both computing an effect from the same stale read: only the FIRST writer's
   * `updateMany` matches a row (`count === 1`); every later one matches nothing (`count === 0` — the
   * status has already moved on) and returns `{ applied: false }` without writing anything at all —
   * no status clobber, no dropped/duplicated event.
   *
   * The event append is a separate write (nested Prisma `create` can't run inside `updateMany`), but
   * it only ever runs once the CAS has already won, so a losing caller never reaches it and the
   * document's event log never gets a second, conflicting terminal event appended.
   */
  async transitionIfStatus(
    id: string,
    expectedStatus: ComplianceStatus,
    patch: { status: ComplianceStatus; events?: ComplianceDocumentEvent[] },
  ): Promise<{ applied: boolean; record?: ComplianceDocumentRecord }> {
    const updatedAt = new Date();
    const { count } = await this.prisma.complianceDocument.updateMany({
      where: { id, status: expectedStatus },
      data: { status: patch.status, updatedAt },
    });
    if (count === 0) {
      return { applied: false };
    }

    // CAS won — append any new events (same append-only semantics as update() above).
    if (patch.events && patch.events.length > 0) {
      const existingIds = (
        await this.prisma.complianceEvent.findMany({
          where: { documentId: id },
          select: { id: true },
        })
      ).map((e) => e.id);
      const newEvents = patch.events.filter((e) => !existingIds.includes(e.id));
      if (newEvents.length > 0) {
        await this.prisma.complianceEvent.createMany({
          data: newEvents.map((e) => ({
            id: e.id,
            documentId: id,
            type: e.type,
            at: new Date(e.at),
            actor: e.actor ?? null,
            detail: e.detail ?? null,
            payload: (e.payload ?? null) as unknown as Prisma.InputJsonValue,
          })),
        });
      }
    }

    const row = await this.prisma.complianceDocument.findUnique({
      where: { id },
      include: { events: true, authorityIds: true },
    });
    return { applied: true, record: row ? documentToRecord(row) : undefined };
  }

  async findLastInSeries(seriesKey: string): Promise<ComplianceDocumentRecord | null> {
    // Load recent non-DRAFT documents that have a hash, then find the first matching the series
    const rows = await this.prisma.complianceDocument.findMany({
      where: { immutableHash: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { events: true, authorityIds: true },
    });
    const match = rows.find((r) => {
      // Invariant: the ctx Json column always stores a serialized TransactionContext.
      const ctx = r.ctx as unknown as TransactionContext;
      return r.status !== 'DRAFT' && `${ctx.supplier?.countryCode}-${r.kind}` === seriesKey;
    });
    return match ? documentToRecord(match) : null;
  }

  async list(): Promise<ComplianceDocumentRecord[]> {
    const rows = await this.prisma.complianceDocument.findMany({
      include: { events: true, authorityIds: true },
    });
    return rows.map((r) => documentToRecord(r));
  }

  /**
   * Tenant-scoped list. ComplianceDocument has no direct companyId column — it's scoped via
   * the `invoice` relation (invoiceId → Invoice.companyId). Documents with invoiceId == null
   * (no linked Invoice — e.g. future non-invoice kinds or period aggregates) are intentionally
   * excluded from any per-company view: there is no tenant they can be safely attributed to.
   */
  async listByCompany(companyId: string): Promise<ComplianceDocumentRecord[]> {
    const rows = await this.prisma.complianceDocument.findMany({
      where: { invoice: { companyId } },
      include: { events: true, authorityIds: true },
    });
    return rows.map((r) => documentToRecord(r));
  }
}
