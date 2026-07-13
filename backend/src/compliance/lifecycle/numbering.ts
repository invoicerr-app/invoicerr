/**
 * Document numbering (COMPLIANCE_ARCHITECTURE.md §11.2). Two models:
 *  - GAPLESS_SELF: issuer-sequenced, strictly gap-controlled (FR/PT + most post-audit/EU; also AR
 *    since F-9 — AFIP auto-numbers and grants a CAE authorization a posteriori, it does not
 *    pre-allocate a number range, so AR was requalified out of AUTHORITY_RANGE).
 *  - AUTHORITY_RANGE: the authority pre-allocates a range the issuer consumes (CL CAF, MX folio).
 *    See ./authority-range-source.ts (F-9) for how a range is loaded into the pool below.
 */
import { ComplianceLogger } from '../execution/logger';
import { NumberingRule } from '../profiles/schema';
import {
  AuthorityRangeSource,
  defaultAuthorityRangeSource,
  hydrateAuthorityRange,
} from './authority-range-source';

export interface AssignedNumber {
  value: string;
  series: string;
  model: NumberingRule['model'];
}

export interface Numberer {
  readonly model: NumberingRule['model'];
  next(series: string, rule: NumberingRule, log: ComplianceLogger): AssignedNumber;
}

/** In-memory gapless counter. A real implementation does this inside the issue() DB transaction. */
export class GaplessSelfNumberer implements Numberer {
  readonly model = 'GAPLESS_SELF' as const;
  private readonly counters = new Map<string, number>();

  next(series: string, rule: NumberingRule, log: ComplianceLogger): AssignedNumber {
    const current = (this.counters.get(series) ?? 0) + 1;
    this.counters.set(series, current);
    if (rule.hashChain) {
      log.todo('numbering/gapless', `hash-chain link to the previous document in series "${series}"`);
    }
    return { value: String(current).padStart(6, '0'), series, model: this.model };
  }
}

/** Consumes authority-allocated folio ranges; blocks issuance when exhausted (never reuses). */
export class FolioPool implements Numberer {
  readonly model = 'AUTHORITY_RANGE' as const;
  private readonly pools = new Map<string, { from: number; to: number; next: number }>();

  /** Register a range obtained from the authority (CAF / CAE / folio grant). */
  loadRange(series: string, from: number, to: number): void {
    this.pools.set(series, { from, to, next: from });
  }

  /** Whether a range is already loaded for this series (hydrate-once guard — see F-9). */
  hasRange(series: string): boolean {
    return this.pools.has(series);
  }

  next(series: string, _rule: NumberingRule, log: ComplianceLogger): AssignedNumber {
    const pool = this.pools.get(series);
    if (!pool) {
      log.todo('numbering/folio-pool', `request a new folio range from the authority for series "${series}"`);
      throw new Error(`No folio range loaded for series "${series}" (request one from the authority).`);
    }
    if (pool.next > pool.to) {
      log.todo('numbering/folio-pool', `range exhausted for "${series}"; request a new range before issuing`);
      throw new Error(`Folio range exhausted for series "${series}".`);
    }
    const value = pool.next;
    pool.next += 1;
    return { value: String(value), series, model: this.model };
  }
}

export class NumberingRegistry {
  private readonly gapless = new GaplessSelfNumberer();
  private readonly folio = new FolioPool();

  get(model: NumberingRule['model']): Numberer {
    return model === 'AUTHORITY_RANGE' ? this.folio : this.gapless;
  }

  get folioPool(): FolioPool {
    return this.folio;
  }

  /**
   * F-9: lazily loads the authority-allocated range for `series` from `source` before `next()` is
   * called — the fix for `loadRange()` having no caller. No-op for GAPLESS_SELF and no-op once a
   * range is already loaded (never reloads mid-series). Callers still get an honest failure from
   * `next()` afterwards if no range was available (source returned null) or it is exhausted.
   */
  async ensureRange(
    model: NumberingRule['model'],
    companyId: string | undefined,
    series: string,
    log: ComplianceLogger,
    source: AuthorityRangeSource = defaultAuthorityRangeSource,
  ): Promise<void> {
    await hydrateAuthorityRange(this.folio, model, source, companyId, series, log);
  }
}

export const defaultNumberingRegistry = new NumberingRegistry();
