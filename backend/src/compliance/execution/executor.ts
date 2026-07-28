/**
 * ComplianceExecutor — consumes a CompliancePlan and runs the full pipeline by dispatching to the
 * provider/handler registries (COMPLIANCE_ARCHITECTURE.md §10-§12). Provider bodies are stubs today
 * (they log TODO where an external integration is required), but every class, method and call exists
 * and is wired, so adding a real integration is "fill in one provider", never "rewire the pipeline".
 */
import { randomUUID } from 'node:crypto';
import { TransactionContext } from '../canonical/canonical-document';
import { validateContextIdentifiers } from '../canonical/identifier-validator';
import {
  IdentifierExistencePort,
  NullIdentifierExistenceClient,
} from '../canonical/identifier-existence.port';
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
import { AuthorityRangeSource, defaultAuthorityRangeSource } from '../lifecycle/authority-range-source';
import { ResponseTracker, defaultResponseTracker } from '../lifecycle/response';
import { DocumentSyntax } from '../types';
import { ComplianceLogger, defaultLogger } from './logger';
import { ExecutionResult, FormatValidationError, SignedArtifact } from './types';

/**
 * Artifact syntaxes rendered as a PDF container (Factur-X/ZUGFeRD hybrid PDF/A-3, or a plain PDF
 * human copy) — these get a PAdES signature, never XAdES (XAdES expects XML bytes; signing a PDF
 * as XML would throw and silently fall through unsigned).
 */
const PDF_ARTIFACT_SYNTAXES: ReadonlySet<DocumentSyntax> = new Set([
  'PLAIN_PDF',
  'FACTURX',
  'ZUGFERD',
  'PDF_A3',
]);

export interface ExecutorDeps {
  formats?: FormatProviderRegistry;
  signing?: SigningProviderRegistry;
  transmission?: TransmissionProviderRegistry;
  archive?: ArchiveProviderRegistry;
  regimes?: RegimeHandlerRegistry;
  taxSystems?: TaxSystemRegistry;
  reporting?: ReportingRegistry;
  numbering?: NumberingRegistry;
  /** F-9: same range source ComplianceService.issue() uses — see numbering step below. */
  rangeSource?: AuthorityRangeSource;
  response?: ResponseTracker;
  logger?: ComplianceLogger;
  /** Optional remote existence checker (VIES/SIRENE). Defaults to NullIdentifierExistenceClient (offline-safe). */
  existence?: IdentifierExistencePort;
}

export interface ExecuteOptions {
  idempotencyKey?: string;
  /**
   * F-9 numbering fix: the number ALREADY assigned to this document by ComplianceService.issue()
   * (which allocates the one and only authoritative number before any send). When set, execute()
   * reuses it verbatim and skips the ensureRange()/numbering.next() allocation block below entirely
   * — otherwise, since issue() and execute() share the same NumberingRegistry singleton in prod
   * (see the numbering step below), a second next() would burn a second counter value / consume a
   * second authority-issued folio for the SAME document, which is pure waste (execute()'s `number`
   * is never read downstream — see ComplianceService.computeSendOutcome(), which builds artifacts
   * from `ctx`, not from this return value). Left undefined for standalone/executor-spec usage with
   * no prior issue() call, in which case the current allocate-with-warning behavior is unchanged.
   */
  assignedNumber?: string;
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
  private readonly rangeSource: AuthorityRangeSource;
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
    this.rangeSource = deps.rangeSource ?? defaultAuthorityRangeSource;
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
              warnings.push(`[existence] ${label} SIRET "${id.value}" not found in SIRENE registry`);
            }
          }
        } catch {
          // Swallow — existence check must never block invoice processing
        }
      }
    }
    return warnings;
  }

  /** Whether the plan requires signed artifacts at all (clearance regime, or a signed-integrity archive). */
  private requiresSignature(plan: CompliancePlan): boolean {
    return plan.regime.blocking || plan.archival.integrity === 'SIGNED';
  }

  /**
   * Decide the signature algorithm for ONE artifact, dispatched by its DocumentSyntax — never a
   * single algo blindly applied to every artifact of the plan (F-5). The "gate" (whether signing is
   * required at all) still comes from the plan; the envelope comes from what the artifact actually
   * is:
   *   - FA_VAT (Poland/KSeF)  → always 'none', even when the gate says signed. KSeF authenticates by
   *     token and seals server-side; a <Signature> element breaks the schemat_FA2.xsd validation SdI
   *     performs. This override is unconditional and must never be reached by the generic branches
   *     below.
   *   - FATTURAPA (Italy/SdI) → CAdES (.p7m PKCS7 envelope) — what SdI expects; enveloped XAdES is
   *     the wrong container for this syntax.
   *   - PDF-container syntaxes (PLAIN_PDF, FACTURX, ZUGFERD, PDF_A3) → PAdES.
   *   - Everything else (ES_FACTURAE, the EN16931 XML family, and any other XML-based national
   *     syntax without a dedicated override) → XAdES enveloped, the general-purpose default.
   */
  private chooseSignAlgo(syntax: DocumentSyntax, gateSigned: boolean): SignAlgo {
    if (syntax === 'FA_VAT') return 'none';
    if (!gateSigned) return 'none';
    if (syntax === 'FATTURAPA') return 'CAdES';
    if (PDF_ARTIFACT_SYNTAXES.has(syntax)) return 'PAdES';
    return 'XAdES';
  }

  async execute(
    ctx: TransactionContext,
    plan: CompliancePlan,
    opts: ExecuteOptions = {},
  ): Promise<ExecutionResult> {
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
    // F-9 (fixed): when the caller already assigned an authoritative number (ComplianceService.issue()
    // runs before every send — see computeSendOutcome()), REUSE it and skip allocation entirely. issue()
    // and execute() share the same NumberingRegistry singleton in prod, so calling next() again here
    // would burn a second counter value (GAPLESS_SELF: a gap in a supposedly gap-less sequence) or
    // consume a second authority-issued folio (AUTHORITY_RANGE: half the limited pool wasted) for the
    // SAME document — pure waste, since this return value is never read downstream (artifacts are
    // built from `ctx`, not from executor.execute()'s `number` — see computeSendOutcome()).
    let number: string | undefined = opts.assignedNumber;
    if (number === undefined) {
      // No prior issue() in this call path (standalone/executor-spec usage) — allocate as before.
      const series = `${ctx.supplier.countryCode}-${ctx.documentKind ?? 'INVOICE'}`;
      await this.numbering.ensureRange(
        plan.numbering.model,
        ctx.supplierCompanyId,
        series,
        log,
        this.rangeSource,
      );
      try {
        number = this.numbering.get(plan.numbering.model).next(series, plan.numbering, log).value;
      } catch (e) {
        // Non-blocking here by design: this step runs again during send() (after issue() already
        // hard-blocked on the same failure — see ComplianceService.issue()), so by the time execute()
        // runs the document already has its authoritative number; a second allocation failure just
        // surfaces as a pipeline warning rather than re-blocking a document that is already ISSUED.
        warnings.push(`Numbering blocked: ${(e as Error).message}`);
      }
    }

    // 3. Build each planned artifact (authoritative / human / buyer).
    const artifacts = await this.formats.buildAll(ctx, plan, log);

    // 3b. M-1 (COMPLIANCE_AUDIT.md): a built artifact that FAILS format validation (XSD
    // structurally invalid, or Schematron fatal/error-level assertions) must never reach
    // signing/transmission — before this fix, provider.validate()'s result was discarded by
    // buildAll() and an invalid CII/FA_VAT/FatturaPA could be transmitted unchecked. Abort the
    // whole pipeline here, before step 4; the caller (ComplianceService.send()) turns this into a
    // recorded, non-swallowed event (F-9 sincerity pattern) instead of a silent partial send.
    // Warning-level Schematron findings never reach here (see providers.ts) — only genuine
    // failures do, so this cannot false-block a document whose only findings are advisory.
    const invalidArtifacts = artifacts.filter((a) => a.validation && !a.validation.valid);
    if (invalidArtifacts.length > 0) {
      const failures = invalidArtifacts.map((a) => ({
        syntax: a.syntax,
        role: a.role,
        errors: a.validation!.errors,
      }));
      const summary = failures
        .map((f) => `${f.syntax}/${f.role}: ${f.errors.slice(0, 2).join('; ')}`)
        .join(' | ');
      log.warn('executor/validate', `format validation blocked pipeline — ${summary}`);
      throw new FormatValidationError(`Format validation failed — ${summary}`, failures);
    }
    // Non-blocking (warning-level) findings still ride along as pipeline warnings.
    for (const a of artifacts) {
      if (a.validation?.warnings?.length) {
        for (const w of a.validation.warnings) warnings.push(`[validation:${a.syntax}] ${w}`);
      }
    }

    // 4. Sign (dispatched PER ARTIFACT by its DocumentSyntax — see chooseSignAlgo; F-5).
    const gateSigned = this.requiresSignature(plan);
    // certRef encodes the DB company ID so SigningCertificatesService can resolve
    // the per-company encrypted cert.  Falls back to countryCode-cert for contexts
    // without a DB company ID (e.g. unit tests that don't need a real cert).
    const certRef = ctx.supplierCompanyId ?? `${ctx.supplier.countryCode}-cert`;
    const signed: SignedArtifact[] = await Promise.all(
      artifacts.map((a) => {
        const algo = this.chooseSignAlgo(a.syntax, gateSigned);
        return this.signing.get(algo).sign(a, certRef, log);
      }),
    );

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
