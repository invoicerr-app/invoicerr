/**
 * Document numbering (COMPLIANCE_ARCHITECTURE.md §11.2). Two models:
 *  - GAPLESS_SELF: issuer-sequenced, strictly gap-controlled (FR/PT + most post-audit/EU).
 *  - AUTHORITY_RANGE: the authority pre-allocates ranges the issuer consumes (CL CAF, AR CAE, MX folio).
 */
import { ComplianceLogger } from '../execution/logger';
import { NumberingRule } from '../profiles/schema';

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
}

export const defaultNumberingRegistry = new NumberingRegistry();
