/**
 * AuthorityRangeSource — port that resolves the authority-allocated numbering range a company
 * consumes under the AUTHORITY_RANGE model (COMPLIANCE_ARCHITECTURE.md §11.2; audit F-9).
 *
 * AUTHORITY_RANGE countries (MX folio via PAC, CL CAF via SII, …) require the issuer to hold a
 * range obtained from the tax authority BEFORE any document can be numbered — unlike GAPLESS_SELF,
 * where the issuer just increments its own counter. `FolioPool` (./numbering.ts) enforces "never
 * reuse, block when exhausted" once a range is loaded; this port is how that range gets loaded in
 * the first place. It is only ever consulted for the AUTHORITY_RANGE model.
 *
 * Two implementations today, both credential-free:
 *   - NullAuthorityRangeSource   — offline default, never has a range (every AUTHORITY_RANGE
 *     issuance honestly blocks until a real source is configured/injected).
 *   - ConfigAuthorityRangeSource — manually-configured range (a company enters the folio/CAF range
 *     it obtained from its PAC/SAT/SII portal). In-memory today, same abstraction level as
 *     `GaplessSelfNumberer`'s in-memory counters (see its doc comment) — a real implementation
 *     persists ranges (and the consumed cursor) per company, and a later live PAC/SAT/CAF client
 *     fetching ranges automatically is a further, creds-gated implementation of this SAME port.
 */
import { ComplianceLogger } from '../execution/logger';

export interface FolioRange {
  from: number;
  to: number;
}

export interface AuthorityRangeSource {
  /**
   * Resolve the range configured for this company + numbering series, or null when none is
   * configured/available. Implementations must be idempotent (repeated calls return the same open
   * range) — consuming the "next" cursor within the range is FolioPool's job, not this port's.
   */
  getRange(companyId: string | undefined, series: string): Promise<FolioRange | null> | FolioRange | null;
}

/** Offline-safe default: no range is ever configured. Every AUTHORITY_RANGE issuance blocks
 * (loudly, not silently) until a real source is injected. */
export class NullAuthorityRangeSource implements AuthorityRangeSource {
  getRange(_companyId: string | undefined, _series: string): null {
    return null;
  }
}

/**
 * Manually-configured range source — the credential-free path (F-9): a company enters the
 * folio/CAF range it obtained from its PAC/SAT/SII portal (e.g. via company/channel settings) and
 * this port serves it back. Keyed by (companyId, series) so two companies (or two document series
 * for the same company) never share a range.
 */
export class ConfigAuthorityRangeSource implements AuthorityRangeSource {
  private readonly ranges = new Map<string, FolioRange>();

  private key(companyId: string | undefined, series: string): string {
    return `${companyId ?? '*'}::${series}`;
  }

  /** Register/replace the range a company configured for a series (e.g. from a settings form). */
  configure(companyId: string | undefined, series: string, range: FolioRange): void {
    if (range.from > range.to) {
      throw new Error(`Invalid range for "${series}": from (${range.from}) must be <= to (${range.to}).`);
    }
    this.ranges.set(this.key(companyId, series), range);
  }

  /** Remove a configured range (e.g. after it is fully consumed and the company must request a new one). */
  clear(companyId: string | undefined, series: string): void {
    this.ranges.delete(this.key(companyId, series));
  }

  getRange(companyId: string | undefined, series: string): FolioRange | null {
    return this.ranges.get(this.key(companyId, series)) ?? null;
  }
}

/** Default: offline-safe, never has a range. Replace with a config-backed / live source in DI. */
export const defaultAuthorityRangeSource: AuthorityRangeSource = new NullAuthorityRangeSource();

/**
 * Lazily hydrate a FolioPool from `source` for AUTHORITY_RANGE series — a no-op for GAPLESS_SELF
 * (which never needs a range) and a no-op if the pool already has a range loaded for this series
 * (loading twice would reset the "next" cursor and violate "never reuse"). Shared by
 * ComplianceService.issue() and ComplianceExecutor.execute() so both call sites hydrate the same
 * way regardless of which one runs first.
 */
export async function hydrateAuthorityRange(
  pool: { hasRange(series: string): boolean; loadRange(series: string, from: number, to: number): void },
  model: string,
  source: AuthorityRangeSource,
  companyId: string | undefined,
  series: string,
  log: ComplianceLogger,
): Promise<void> {
  if (model !== 'AUTHORITY_RANGE') return;
  if (pool.hasRange(series)) return;
  const range = await source.getRange(companyId, series);
  if (range) {
    pool.loadRange(series, range.from, range.to);
    log.info(
      'numbering/folio-pool',
      `loaded authority-allocated range ${range.from}-${range.to} for "${series}"`,
    );
  }
}
