/**
 * ComplianceExecutor — consumes a CompliancePlan and runs the full pipeline by dispatching to the
 * provider/handler registries (COMPLIANCE_ARCHITECTURE.md §10-§12). Provider bodies are stubs today
 * (they log TODO where an external integration is required), but every class, method and call exists
 * and is wired, so adding a real integration is "fill in one provider", never "rewire the pipeline".
 */
import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { ArchiveProviderRegistry, defaultArchiveRegistry } from '../providers/archive/registry';
import { FormatProviderRegistry, defaultFormatRegistry } from '../providers/format/registry';
import { SigningProviderRegistry, defaultSigningRegistry } from '../providers/signing/registry';
import { SignAlgo } from '../providers/signing/signing-provider';
import {
  TransmissionProviderRegistry,
  defaultTransmissionRegistry,
} from '../providers/transmission/registry';
import { RegimeHandlerRegistry, defaultRegimeRegistry } from '../regimes/registry';
import { ReportingRegistry, defaultReportingRegistry } from '../reporting/registry';
import { TaxSystemRegistry, defaultTaxSystemRegistry } from '../taxsystems/registry';
import { NumberingRegistry, defaultNumberingRegistry } from '../lifecycle/numbering';
import { ResponseTracker, defaultResponseTracker } from '../lifecycle/response';
import { ComplianceLogger, defaultLogger } from './logger';
import { ExecutionResult, SignedArtifact } from './types';

export interface ExecutorDeps {
  formats?: FormatProviderRegistry;
  signing?: SigningProviderRegistry;
  transmission?: TransmissionProviderRegistry;
  archive?: ArchiveProviderRegistry;
  regimes?: RegimeHandlerRegistry;
  taxSystems?: TaxSystemRegistry;
  reporting?: ReportingRegistry;
  numbering?: NumberingRegistry;
  response?: ResponseTracker;
  logger?: ComplianceLogger;
}

export interface ExecuteOptions {
  idempotencyKey?: string;
}

export class ComplianceExecutor {
  private readonly formats: FormatProviderRegistry;
  private readonly signing: SigningProviderRegistry;
  private readonly transmission: TransmissionProviderRegistry;
  private readonly archive: ArchiveProviderRegistry;
  private readonly regimes: RegimeHandlerRegistry;
  private readonly taxSystems: TaxSystemRegistry;
  private readonly reporting: ReportingRegistry;
  private readonly numbering: NumberingRegistry;
  private readonly response: ResponseTracker;
  private readonly log: ComplianceLogger;

  constructor(deps: ExecutorDeps = {}) {
    this.formats = deps.formats ?? defaultFormatRegistry;
    this.signing = deps.signing ?? defaultSigningRegistry;
    this.transmission = deps.transmission ?? defaultTransmissionRegistry;
    this.archive = deps.archive ?? defaultArchiveRegistry;
    this.regimes = deps.regimes ?? defaultRegimeRegistry;
    this.taxSystems = deps.taxSystems ?? defaultTaxSystemRegistry;
    this.reporting = deps.reporting ?? defaultReportingRegistry;
    this.numbering = deps.numbering ?? defaultNumberingRegistry;
    this.response = deps.response ?? defaultResponseTracker;
    this.log = deps.logger ?? defaultLogger;
  }

  /** Decide the signature algorithm from the plan (clearance or signed-archive ⇒ XAdES). */
  private chooseSignAlgo(plan: CompliancePlan): SignAlgo {
    if (plan.regime.blocking || plan.archival.integrity === 'SIGNED') return 'XAdES';
    return 'none';
  }

  execute(ctx: TransactionContext, plan: CompliancePlan, opts: ExecuteOptions = {}): ExecutionResult {
    const log = this.log;
    const warnings: string[] = [...plan.warnings];
    const idempotencyKey = opts.idempotencyKey ?? `${ctx.supplier.countryCode}-${Date.now()}`;

    // 1. Monetary totals via the tax-system handler.
    const totals = this.taxSystems.get(plan.taxSystemKind).computeTotals(ctx, plan.tax, log);

    // 2. Numbering (gapless self-counter, or authority folio range which blocks when exhausted).
    const series = `${ctx.supplier.countryCode}-${ctx.documentKind ?? 'INVOICE'}`;
    let number: string | undefined;
    try {
      number = this.numbering.get(plan.numbering.model).next(series, plan.numbering, log).value;
    } catch (e) {
      warnings.push(`Numbering blocked: ${(e as Error).message}`);
    }

    // 3. Build each planned artifact (authoritative / human / buyer).
    const artifacts = this.formats.buildAll(ctx, plan, log);

    // 4. Sign (when the regime/archive requires it).
    const algo = this.chooseSignAlgo(plan);
    const signer = this.signing.get(algo);
    const certRef = `${ctx.supplier.countryCode}-cert`;
    const signed: SignedArtifact[] = artifacts.map((a) => signer.sign(a, certRef, log));

    // 5. Regime-specific handling (clearance gates validity; CTC routes & e-reports).
    const regime = this.regimes.get(plan.regime.model).handle(ctx, plan, signed, log);

    // 6. Transmit over every planned channel.
    const transmissions = this.transmission.transmitAll(signed, ctx, plan, idempotencyKey, log);

    // 7. Archive the authoritative artifact (retention + residency routing).
    const archive = this.archive.store(signed, plan.archival, log);

    // 8. Reporting side-effects.
    const reporting = this.reporting.reportAll(ctx, plan, log);

    // 9. Open the bidirectional response window when the profile mandates statuses.
    if (plan.lifecycle.response) {
      this.response.open(plan.lifecycle.response, ctx.issueDate, log);
    }

    return { number, totals, artifacts, signed, regime, transmissions, archive, reporting, warnings };
  }
}

export const defaultExecutor = new ComplianceExecutor();
