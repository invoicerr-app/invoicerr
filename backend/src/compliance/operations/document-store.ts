import { ComplianceDocumentRecord } from './types';

/**
 * Persistence port for compliance documents. The in-memory implementation backs tests and dev; a
 * Prisma-backed implementation will replace it when the module is wired into the app (the
 * ComplianceDocument/ComplianceEvent tables from COMPLIANCE_ARCHITECTURE.md §13).
 */
export interface ComplianceDocumentStore {
  save(record: ComplianceDocumentRecord): Promise<ComplianceDocumentRecord>;
  get(id: string): Promise<ComplianceDocumentRecord | null>;
  update(id: string, patch: Partial<ComplianceDocumentRecord>): Promise<ComplianceDocumentRecord>;
  list(): Promise<ComplianceDocumentRecord[]>;
}

export class InMemoryComplianceDocumentStore implements ComplianceDocumentStore {
  private readonly docs = new Map<string, ComplianceDocumentRecord>();

  save(record: ComplianceDocumentRecord): Promise<ComplianceDocumentRecord> {
    this.docs.set(record.id, record);
    return Promise.resolve(record);
  }

  get(id: string): Promise<ComplianceDocumentRecord | null> {
    return Promise.resolve(this.docs.get(id) ?? null);
  }

  async update(id: string, patch: Partial<ComplianceDocumentRecord>): Promise<ComplianceDocumentRecord> {
    const current = this.docs.get(id);
    if (!current) throw new Error(`ComplianceDocument "${id}" not found`);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.docs.set(id, next);
    return next;
  }

  list(): Promise<ComplianceDocumentRecord[]> {
    return Promise.resolve([...this.docs.values()]);
  }
}
