/**
 * ReportingStore port — abstract persistence contract for compliance reports.
 *
 * Idempotence: find(kind, periodKey, companyId, invoiceRef) before create().
 * Proof of filing: markSubmitted(id, ref) stores the authority reference.
 */

export interface ReportRecord {
  id: string;
  kind: string;
  periodKey: string;
  companyId: string | null;
  invoiceRef: string | null;
  status: 'PENDING' | 'SUBMITTED' | 'FILED';
  payload: unknown;
  submittedRef: string | null;
  submittedAt: Date | null;
  createdAt: Date;
}

export interface ReportingStore {
  /** Returns an existing record for this idempotence key, or null. */
  find(
    kind: string,
    periodKey: string,
    companyId: string | null,
    invoiceRef: string | null,
  ): Promise<ReportRecord | null>;

  /** Persists a new report record and returns it. */
  create(record: Omit<ReportRecord, 'id' | 'createdAt'>): Promise<ReportRecord>;

  /** Records the authority submission reference + transitions status to SUBMITTED. */
  markSubmitted(id: string, ref: string, submittedAt?: Date): Promise<void>;
}

/** No-op store — used in unit tests and as the default when Prisma is not wired. */
export class NullReportingStore implements ReportingStore {
  async find(): Promise<ReportRecord | null> {
    return null;
  }
  async create(record: Omit<ReportRecord, 'id' | 'createdAt'>): Promise<ReportRecord> {
    return { ...record, id: 'null-store', createdAt: new Date() };
  }
  async markSubmitted(): Promise<void> {
    // no-op
  }
}
