import { PrismaService } from '@/prisma/prisma.service';
import { ComplianceDocumentRecord } from '../operations/types';
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
    return documentToRecord(row as any);
  }

  async get(id: string): Promise<ComplianceDocumentRecord | null> {
    const row = await this.prisma.complianceDocument.findUnique({
      where: { id },
      include: { events: true, authorityIds: true },
    });
    return row ? documentToRecord(row as any) : null;
  }

  async update(id: string, patch: Partial<ComplianceDocumentRecord>): Promise<ComplianceDocumentRecord> {
    const data: any = {};
    if ('status' in patch) data.status = patch.status;
    if ('plan' in patch) data.plan = patch.plan ?? null;
    if ('number' in patch) data.number = patch.number ?? null;
    if ('immutableHash' in patch) data.immutableHash = patch.immutableHash ?? null;
    if ('previousHash' in patch) data.previousHash = patch.previousHash ?? null;
    if ('ctx' in patch) data.ctx = patch.ctx as any;
    if ('correctsId' in patch) data.correctsId = patch.correctsId ?? null;
    if ('events' in patch) {
      data.events = {
        deleteMany: {},
        create: patch.events!.map((e) => ({ type: e.type, at: new Date(e.at), detail: e.detail ?? null })),
      };
    }
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
    return documentToRecord(row as any);
  }

  async list(): Promise<ComplianceDocumentRecord[]> {
    const rows = await this.prisma.complianceDocument.findMany({
      include: { events: true, authorityIds: true },
    });
    return rows.map((r) => documentToRecord(r as any));
  }
}
