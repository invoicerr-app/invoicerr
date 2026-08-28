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
import {
  type AttachmentPredicate,
  type OperationNature,
  type OperationParties,
  evaluateAll,
} from './attachment-predicate';
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

const CONFIDENCE_ORDER: Confidence[] = ['OFFICIAL', 'BEST_EFFORT', 'PLANNED', 'FALLBACK', 'UNVERIFIED'];

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
    warnings.push(`No compliance profile for buyer country "${ctx.buyer.countryCode}" — using FALLBACK.`);

  const buyerRole = ctx.buyer.role;
  const supplyTypes = [...new Set(ctx.lines.map((l) => l.supplyType))];
  const crossBorder = ctx.supplier.countryCode.toUpperCase() !== ctx.buyer.countryCode.toUpperCase();

  // Tax — the only step that reads both profiles deeply.
  const tax = determineTax(ctx, sp, vat, bp);

  // P2-T03 — the attachment of the two parties, and the nature of the supply, as the predicate
  // evaluates them. This is what `appliesTo` could not express: it selects on the buyer's ROLE and
  // the supply type, never on "both parties attached to France".
  //
  // The country used is the one the profile registry RESOLVED, not the raw one on the party. That
  // matters for delegation: Monaco has no profile of its own and delegates to France
  // (`delegatedFrom: 'MC'`), which is the repository's existing decision that a Monegasque
  // operation is governed by French rules. Evaluating the predicate on the raw 'MC' would silently
  // reverse that decision here, and this is not the place to re-litigate it.
  //
  // Note the limit, and it is a real one: CGI art. 290 I 4° a) lists FR↔Monaco operations under
  // e-reporting explicitly, so the treatment of Monaco deserves its own sourced pass. Following the
  // existing delegation preserves today's behaviour rather than inventing a rule.
  const parties: OperationParties = {
    supplier: sp.countryCode.toUpperCase(),
    buyer: bp.countryCode.toUpperCase(),
  };
  const nature: OperationNature = {
    // An intra-Community supply as CGI art. 262 ter I 1° means it: goods leaving for another EU
    // member state, between taxable persons. Derived from the tax treatment the engine already
    // computed rather than re-deduced, so the two can never disagree.
    intraCommunitySupply: tax.reportingFlags.includes('EC_SALES_LIST'),
  };

  // Regime — supplier-driven, by date, classification AND attachment.
  const regime =
    pickWithSelector(sp.regime, ctx.issueDate, buyerRole, supplyTypes, parties, nature, warnings) ??
    fallbackRegime(sp, warnings);

  // Channels — resolved BEFORE artifacts so buildArtifacts() can cross-check them (F-7). The same
  // predicate gates them: the channel is what actually routes the document, so a regime alone would
  // still have offered a PDP for an operation outside the mandate.
  const transmission = pickWithSelector(
    sp.transmission,
    ctx.issueDate,
    buyerRole,
    supplyTypes,
    parties,
    nature,
    warnings,
  );
  const channels: ChannelSpec[] = transmission?.channels ?? [{ type: 'EMAIL' }];

  // Formats — supplier primary (+ human) plus buyer-mandated receive syntax when negotiable,
  // plus (F-7) a Peppol-transmittable artifact when the plan actually carries a PEPPOL channel.
  const fmt = pickWithSelector(sp.formats, ctx.issueDate, buyerRole, supplyTypes);
  const artifacts = buildArtifacts(fmt, bp, channels, warnings);

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
function pickWithSelector<T extends { appliesTo?: ClassificationSelector; attachment?: AttachmentPredicate[] }>(
  rules: Temporal<T>[],
  date: Date,
  buyerRole: PartyRole,
  supplyTypes: SupplyType[],
  parties?: OperationParties,
  nature?: OperationNature,
  warnings?: string[],
): T | null {
  const inForce = allByDate(rules, date)
    .filter((v) => selectorMatches(v.appliesTo, buyerRole, supplyTypes))
    .filter((v) => {
      // A rule with no attachment predicate is unconditional on attachment — every profile that has
      // not been migrated behaves exactly as before.
      if (!v.attachment || v.attachment.length === 0 || !parties) return true;
      const verdict = evaluateAll(v.attachment, parties, nature ?? {});
      if (verdict === null) {
        // Undecidable, never silently inapplicable. The attachment guard in invoices.helpers.ts
        // blocks before this point in the product path, so reaching here means a caller built a
        // context another way — worth saying out loud rather than dropping the rule.
        warnings?.push(
          `A rule's attachment could not be decided (supplier=${parties.supplier ?? '?'}, ` +
            `buyer=${parties.buyer ?? '?'}); it was not applied.`,
        );
        return false;
      }
      return verdict;
    });
  if (inForce.length === 0) return null;
  // Prefer a selector-specific rule over a wildcard one.
  const specific = inForce.find((v) => !!v.appliesTo);
  return specific ?? inForce[0];
}

function fallbackRegime(sp: CountryComplianceProfile, warnings: string[]): RegimeRule {
  warnings.push(`No regime rule matched for ${sp.countryCode} at the issue date; defaulting to POST_AUDIT.`);
  return { model: 'POST_AUDIT', blocking: false };
}

/**
 * Syntaxes the Peppol transmission provider accepts directly (peppol-transmission.ts's own
 * artifact search order: PEPPOL_BIS, then EN16931_UBL, then EN16931_CII). Any primary format
 * already in this set means the network is already reachable with what buildArtifacts() would
 * emit anyway — no extra artifact needed (this is what keeps FR, and every EN16931_UBL/CII
 * "post-audit Peppol" archetype country, from getting a duplicate).
 */
const PEPPOL_TRANSMITTABLE_SYNTAXES: ReadonlySet<string> = new Set([
  'PEPPOL_BIS',
  'EN16931_UBL',
  'EN16931_CII',
]);

function buildArtifacts(
  fmt: FormatRule | null,
  buyerProfile: CountryComplianceProfile,
  channels: ChannelSpec[],
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

  // F-7: cross the plan's *channels* against the artifacts actually built. A profile can declare
  // a PEPPOL channel (DE, ES...) while its primary/human/buyer syntaxes are all national-CIUS
  // formats the Peppol provider does not recognise (XRECHNUNG, ES_FACTURAE) — the send would be
  // SKIPPED on every attempt, silently, forever. When PEPPOL is actually in the plan's channels
  // and nothing already-built is Peppol-transmittable, add a PEPPOL_BIS artifact (UBL BIS 3.0 /
  // EN16931-UBL) built from the canonical invoice model by the same En16931FormatProvider used
  // for EN16931_UBL/CII (providers/format/providers.ts, SYNTAX_TO_XML_FORMAT['PEPPOL_BIS'] =
  // 'ubl') — never derived from another syntax's artifact (e.g. never from ES_FACTURAE). Gated on
  // the channel actually being present so every other document is unaffected (no bloat).
  const wantsPeppolChannel = channels.some((c) => c.type === 'PEPPOL');
  const alreadyPeppolTransmittable = artifacts.some((a) => PEPPOL_TRANSMITTABLE_SYNTAXES.has(a.syntax));
  if (wantsPeppolChannel && !alreadyPeppolTransmittable) {
    artifacts.push({ role: 'BUYER', syntax: 'PEPPOL_BIS' });
  }

  return artifacts;
}
