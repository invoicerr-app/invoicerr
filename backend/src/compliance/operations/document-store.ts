import { ComplianceDocumentRecord } from './types';

/**
 * Persistence port for compliance documents. The in-memory implementation backs tests and dev; a
 * Prisma-backed implementation will replace it when the module is wired into the app (the
 * ComplianceDocument/ComplianceEvent tables from COMPLIANCE_ARCHITECTURE.md §13).
 */
export interface ComplianceDocumentStore {
  save(record: ComplianceDocumentRecord): ComplianceDocumentRecord;
  get(id: string): ComplianceDocumentRecord | null;
  update(id: string, patch: Partial<ComplianceDocumentRecord>): ComplianceDocumentRecord;
  list(): ComplianceDocumentRecord[];
}

export class InMemoryComplianceDocumentStore implements ComplianceDocumentStore {
  private readonly docs = new Map<string, ComplianceDocumentRecord>();

  save(record: ComplianceDocumentRecord): ComplianceDocumentRecord {
    this.docs.set(record.id, record);
    return record;
  }

  get(id: string): ComplianceDocumentRecord | null {
    return this.docs.get(id) ?? null;
  }

  update(id: string, patch: Partial<ComplianceDocumentRecord>): ComplianceDocumentRecord {
    const current = this.docs.get(id);
    if (!current) throw new Error(`ComplianceDocument "${id}" not found`);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.docs.set(id, next);
    return next;
  }

  list(): ComplianceDocumentRecord[] {
    return [...this.docs.values()];
  }
}
