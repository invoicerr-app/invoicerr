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

  /**
   * Returns all PENDING records whose period closed before `now`.
   * "Closed" means the periodKey is strictly less than the current period for
   * that frequency (monthly: "2026-06" < current month; quarterly: "2026-Q2" < current quarter).
   */
  findPendingForClosedPeriods(now: Date): Promise<ReportRecord[]>;

  /**
   * ES-D1: the most recent record of `kind` for `companyId`, newest first, or null.
   *
   * This is the seam the Veri*Factu hash chain was missing. The huella algorithm was already
   * conformant — it reproduces AEAT's published test vectors byte-for-byte — but nothing ever fed
   * it a previous link, so every record was emitted with an empty `Huella=` and declared itself
   * `PrimerRegistro='S'`. A chain of length one, repeated, where RD 1007/2023 art. 8.2.b requires
   * each record to be tied to the one before it.
   *
   * The chain is scoped per (kind, companyId) because that is the issuer chain AEAT audits: one
   * obligated taxpayer, one continuous sequence of registros. A null companyId has no chain and
   * must return null rather than accidentally chaining across tenants.
   */
  findLastByKindAndCompany(kind: string, companyId: string | null): Promise<ReportRecord | null>;
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
  async findPendingForClosedPeriods(): Promise<ReportRecord[]> {
    return [];
  }
  async findLastByKindAndCompany(): Promise<ReportRecord | null> {
    return null;
  }
}
