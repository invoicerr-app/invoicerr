/**
 * ComplianceExecutor — consumes a CompliancePlan and runs the full pipeline by dispatching to the
 * provider/handler registries (COMPLIANCE_ARCHITECTURE.md §10-§12). Provider bodies are stubs today
 * (they log TODO where an external integration is required), but every class, method and call exists
 * and is wired, so adding a real integration is "fill in one provider", never "rewire the pipeline".
 */
import { randomUUID } from 'crypto';
import { TransactionContext } from '../canonical/canonical-document';
import { validateContextIdentifiers } from '../canonical/identifier-validator';
import { IdentifierExistencePort, NullIdentifierExistenceClient } from '../canonical/identifier-existence.port';
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
  /** Optional remote existence checker (VIES/SIRENE). Defaults to NullIdentifierExistenceClient (offline-safe). */
  existence?: IdentifierExistencePort;
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
  private readonly existence: IdentifierExistencePort;

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
    this.existence = deps.existence ?? new NullIdentifierExistenceClient();
  }

  /**
   * Run remote existence checks for supplier VAT and FR SIRET identifiers.
   * Returns advisory warning strings; never throws; uses the injected (possibly
   * cached or null) client so the default is always offline-safe.
   */
  private async checkIdentifierExistence(ctx: TransactionContext): Promise<string[]> {
    const warnings: string[] = [];
    const parties = [
      { label: 'supplier', party: ctx.supplier },
      { label: 'buyer', party: ctx.buyer },
    ];
    for (const { label, party } of parties) {
      for (const id of party.identifiers) {
        try {
          if (id.scheme === 'VAT') {
            const res = await this.existence.checkVat(id.value);
            if (res.exists === false) {
              warnings.push(
                `[existence] ${label} VAT "${id.value}" not found in ${res.source.toUpperCase()} registry`,
              );
            }
          } else if (id.scheme === 'SIRET') {
            const res = await this.existence.checkSiret(id.value);
            if (res.exists === false) {
              warnings.push(
                `[existence] ${label} SIRET "${id.value}" not found in SIRENE registry`,
              );
            }
          }
        } catch {
          // Swallow — existence check must never block invoice processing
        }
      }
    }
    return warnings;
  }

  /** Decide the signature algorithm from the plan (clearance or signed-archive ⇒ XAdES). */
  private chooseSignAlgo(plan: CompliancePlan): SignAlgo {
    if (plan.regime.blocking || plan.archival.integrity === 'SIGNED') return 'XAdES';
    return 'none';
  }

  async execute(ctx: TransactionContext, plan: CompliancePlan, opts: ExecuteOptions = {}): Promise<ExecutionResult> {
    const log = this.log;
    const warnings: string[] = [...plan.warnings];
    // randomUUID() ensures the default key is globally unique even if two executions start
    // within the same millisecond (prevents accidental idempotency-dedup in fast test runs).
    const idempotencyKey = opts.idempotencyKey ?? `${ctx.supplier.countryCode}-${randomUUID()}`;

    // 0. Offline identifier validation — checksum-validates all party identifiers, updates the
    //    `validated` flag, and surfaces warnings for any failures.  Does NOT block transmission
    //    (a bad check digit is a data-quality issue, not a hard stop), but the warning will
    //    appear in ExecutionResult.warnings so the caller / UI can surface it.
    const { ctx: validatedCtx, warnings: idWarnings } = validateContextIdentifiers(ctx);
    if (idWarnings.length > 0) {
      for (const w of idWarnings) log.warn('executor/identifiers', w);
      warnings.push(...idWarnings);
    }
    ctx = validatedCtx;

    // 0b. Optional remote existence checks (VIES for EU VAT, SIRENE for FR SIRET).
    //     Default: NullIdentifierExistenceClient → exists: null → no warning (offline-safe).
    //     A real client adds a warning when exists === false (not-found in registry).
    //     Never blocks transmission — just adds advisory warnings.
    const existenceWarnings = await this.checkIdentifierExistence(ctx);
    if (existenceWarnings.length > 0) {
      for (const w of existenceWarnings) log.warn('executor/existence', w);
      warnings.push(...existenceWarnings);
    }

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
    const artifacts = await this.formats.buildAll(ctx, plan, log);

    // 4. Sign (when the regime/archive requires it).
    const algo = this.chooseSignAlgo(plan);
    const signer = this.signing.get(algo);
    // certRef encodes the DB company ID so SigningCertificatesService can resolve
    // the per-company encrypted cert.  Falls back to countryCode-cert for contexts
    // without a DB company ID (e.g. unit tests that don't need a real cert).
    const certRef = ctx.supplierCompanyId ?? `${ctx.supplier.countryCode}-cert`;
    const signed: SignedArtifact[] = await Promise.all(artifacts.map((a) => signer.sign(a, certRef, log)));

    // 5. Regime-specific handling (clearance gates validity; CTC routes & e-reports).
    const regime = this.regimes.get(plan.regime.model).handle(ctx, plan, signed, log);

    // 6. Transmit over every planned channel.
    const transmissions = await this.transmission.transmitAll(signed, ctx, plan, idempotencyKey, log);

    // 7. Archive the authoritative artifact (retention + residency routing).
    const archive = this.archive.store(signed, plan.archival, log);

    // 8. Reporting side-effects (async — store-backed idempotence).
    const reporting = await this.reporting.reportAll(ctx, plan, log);

    // 9. Open the bidirectional response window when the profile mandates statuses.
    if (plan.lifecycle.response) {
      this.response.open(plan.lifecycle.response, ctx.issueDate, log);
    }

    return { number, totals, artifacts, signed, regime, transmissions, archive, reporting, warnings };
  }
}

export const defaultExecutor = new ComplianceExecutor();
