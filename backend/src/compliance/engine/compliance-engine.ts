/**
 * The Compliance Engine — COMPLIANCE_ARCHITECTURE.md §8.
 * Pure function: (transaction + profile registry + clock) -> CompliancePlan. No I/O, fully testable.
 * Execution (format build, signing, transmission, archive) consumes the plan elsewhere.
 */
import { TransactionContext } from '../canonical/canonical-document';
import {
  ArchivalPolicy,
  ChannelSpec,
  ClassificationSelector,
  CountryComplianceProfile,
  FormatRule,
  LifecyclePolicy,
  NumberingRule,
  RegimeRule,
  Temporal,
} from '../profiles/schema';
import { ProfileRegistry, defaultRegistry } from '../profiles/registry';
import { allByDate, pickByDate } from '../profiles/temporal';
import { TrustFlagVatValidator, VatValidator, selectorMatches } from './classification';
import { DocumentTaxResult, determineTax } from './tax-engine';
import { ArtifactRole, Confidence, PartyRole, ReportingKind, SupplyType, TaxSystemKind } from '../types';

export interface PlannedArtifact {
  role: ArtifactRole;
  syntax: string;
  version?: string;
}

export interface CompliancePlan {
  supplier: { country: string; confidence: Confidence; delegatedFrom?: string };
  buyer: { country: string; confidence: Confidence };
  classification: { buyerRole: string; crossBorder: boolean; supplyTypes: SupplyType[] };
  tax: DocumentTaxResult;
  taxSystemKind: TaxSystemKind;
  regime: RegimeRule;
  artifacts: PlannedArtifact[];
  channels: ChannelSpec[];
  numbering: NumberingRule;
  lifecycle: LifecyclePolicy;
  archival: ArchivalPolicy;
  reporting: ReportingKind[];
  confidence: Confidence;
  warnings: string[];
}

export interface ResolveDeps {
  registry?: ProfileRegistry;
  vat?: VatValidator;
}

const CONFIDENCE_ORDER: Confidence[] = [
  'OFFICIAL',
  'BEST_EFFORT',
  'PLANNED',
  'FALLBACK',
  'UNVERIFIED',
];

function minConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_ORDER.indexOf(a) >= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

const DEFAULT_LIFECYCLE: LifecyclePolicy = {
  immutableAfter: 'ISSUE',
  correctionModel: 'CREDIT_NOTE',
  cancellation: { allowed: true, requiresAuthorityAck: false },
};

const DEFAULT_ARCHIVAL: ArchivalPolicy = {
  retentionYears: 10,
  archivedForm: 'HYBRID_PDF',
  integrity: 'NONE',
};

export function resolve(ctx: TransactionContext, deps: ResolveDeps = {}): CompliancePlan {
  const registry = deps.registry ?? defaultRegistry;
  const vat = deps.vat ?? new TrustFlagVatValidator();
  const warnings: string[] = [];

  const s = registry.resolve(ctx.supplier.countryCode);
  const b = registry.resolve(ctx.buyer.countryCode);
  const sp = s.profile;
  const bp = b.profile;

  if (s.isFallback)
    warnings.push(
      `No compliance profile for supplier country "${ctx.supplier.countryCode}" — using FALLBACK.`,
    );
  if (b.isFallback)
    warnings.push(
      `No compliance profile for buyer country "${ctx.buyer.countryCode}" — using FALLBACK.`,
    );

  const buyerRole = ctx.buyer.role;
  const supplyTypes = [...new Set(ctx.lines.map((l) => l.supplyType))];
  const crossBorder =
    ctx.supplier.countryCode.toUpperCase() !== ctx.buyer.countryCode.toUpperCase();

  // Tax — the only step that reads both profiles deeply.
  const tax = determineTax(ctx, sp, vat, bp);

  // Regime — supplier-driven, by date AND classification.
  const regime =
    pickWithSelector(sp.regime, ctx.issueDate, buyerRole, supplyTypes) ??
    fallbackRegime(sp, warnings);

  // Formats — supplier primary (+ human) plus buyer-mandated receive syntax when negotiable.
  const fmt = pickWithSelector(sp.formats, ctx.issueDate, buyerRole, supplyTypes);
  const artifacts = buildArtifacts(fmt, bp, warnings);

  // Channels.
  const transmission = pickByDate(sp.transmission, ctx.issueDate);
  const channels: ChannelSpec[] = transmission?.channels ?? [{ type: 'EMAIL' }];

  // Lifecycle, archival & numbering.
  const lifecycle = pickByDate(sp.lifecycle, ctx.issueDate) ?? DEFAULT_LIFECYCLE;
  const archival = pickByDate(sp.archival, ctx.issueDate) ?? DEFAULT_ARCHIVAL;
  const numbering = pickByDate(sp.numbering, ctx.issueDate) ?? { model: 'GAPLESS_SELF' as const };

  // Reporting = supplier obligations (by date+class) ∪ tax-driven flags.
  const repObl = pickWithSelector(sp.reporting, ctx.issueDate, buyerRole, supplyTypes);
  const reporting = [...new Set<ReportingKind>([...(repObl?.kinds ?? []), ...tax.reportingFlags])];

  // Confidence is the minimum over every profile consulted (supplier ⊓ buyer).
  let confidence = minConfidence(sp.confidence, bp.confidence);
  // Buyer confidence only matters when the buyer's rules actually influenced the plan (cross-border).
  if (!crossBorder) confidence = sp.confidence;

  return {
    supplier: { country: sp.countryCode, confidence: sp.confidence, delegatedFrom: s.delegatedFrom },
    buyer: { country: bp.countryCode, confidence: bp.confidence },
    classification: { buyerRole, crossBorder, supplyTypes },
    tax,
    taxSystemKind: sp.taxSystem.kind,
    regime,
    artifacts,
    channels,
    numbering,
    lifecycle,
    archival,
    reporting,
    confidence,
    warnings,
  };
}

/** Pick the rule in force at the date whose selector matches the transaction class. */
function pickWithSelector<T extends { appliesTo?: ClassificationSelector }>(
  rules: Temporal<T>[],
  date: Date,
  buyerRole: PartyRole,
  supplyTypes: SupplyType[],
): T | null {
  const inForce = allByDate(rules, date).filter((v) =>
    selectorMatches(v.appliesTo, buyerRole, supplyTypes),
  );
  if (inForce.length === 0) return null;
  // Prefer a selector-specific rule over a wildcard one.
  const specific = inForce.find((v) => !!v.appliesTo);
  return specific ?? inForce[0];
}

function fallbackRegime(sp: CountryComplianceProfile, warnings: string[]): RegimeRule {
  warnings.push(`No regime rule matched for ${sp.countryCode} at the issue date; defaulting to POST_AUDIT.`);
  return { model: 'POST_AUDIT', blocking: false };
}

function buildArtifacts(
  fmt: FormatRule | null,
  buyerProfile: CountryComplianceProfile,
  warnings: string[],
): PlannedArtifact[] {
  if (!fmt) {
    warnings.push('No format rule matched; defaulting to PLAIN_PDF.');
    return [{ role: 'AUTHORITATIVE', syntax: 'PLAIN_PDF' }];
  }
  const artifacts: PlannedArtifact[] = [
    { role: 'AUTHORITATIVE', syntax: fmt.primary.syntax, version: fmt.primary.version },
  ];
  if (fmt.human) artifacts.push({ role: 'HUMAN', syntax: fmt.human.syntax });
  if (
    fmt.buyerNegotiable &&
    buyerProfile.mandatoryReceiveSyntax &&
    buyerProfile.mandatoryReceiveSyntax !== fmt.primary.syntax
  ) {
    artifacts.push({ role: 'BUYER', syntax: buyerProfile.mandatoryReceiveSyntax });
  }
  return artifacts;
}
