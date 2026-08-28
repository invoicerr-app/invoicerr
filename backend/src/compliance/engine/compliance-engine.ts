/**
 * The Compliance Engine — COMPLIANCE_ARCHITECTURE.md §8.
 * Pure function: (transaction + profile registry + clock) -> CompliancePlan. No I/O, fully testable.
 * Execution (format build, signing, transmission, archive) consumes the plan elsewhere.
 */
import { TransactionContext } from '../canonical/canonical-document';
import {
  ArchivalPolicy,
  ChannelSpec,
  ObligationDeadline,
  ObligationLayer,
  ObligationRule,
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
import {
  ArtifactRole,
  Confidence,
  ObligationKind,
  PartyRole,
  RegimeModel,
  ReportingKind,
  SupplyType,
  TaxSystemKind,
} from '../types';

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
  /**
   * P2-T03 — the duties this operation carries. Plural, because they genuinely are.
   *
   * `regime` below is the FIRST of these, kept so the sixteen existing readers across eight files
   * keep working untouched; `primaryObligation(plan)` is the accessor they migrate to, lot by lot,
   * after which `regime` goes. Today `obligations` almost always holds one entry — the profiles
   * were written against a singular model — and that is the point: the shape changes before the
   * data does, so the migration is not also a behaviour change.
   */
  obligations: ResolvedObligation[];
  artifacts: PlannedArtifact[];
  channels: ChannelSpec[];
  /**
   * P2-T07 — where the DATA goes, as distinct from where the invoice goes.
   *
   * Empty for almost every profile, and that is not a gap: only a country that separates the two
   * destinations needs it. France does — art. 290 III sends the "encaissée" status to the
   * administration through the accredited platform for operations whose INVOICE never touches it.
   */
  reportingChannels: ChannelSpec[];
  numbering: NumberingRule;
  lifecycle: LifecyclePolicy;
  archival: ArchivalPolicy;
  reporting: ReportingKind[];
  confidence: Confidence;
  warnings: string[];
}

/** One duty, resolved for this operation. */
export interface ResolvedObligation {
  kind: ObligationKind;
  /**
   * P2-T02 — WHEN the duty attaches. Regime-derived obligations are ISSUANCE by construction: a
   * regime describes how an invoice reaches the authority. RECEPTION and ARCHIVAL come from the
   * profile's own `obligations` list, which only France carries today.
   */
  layer: ObligationLayer;
  /** How it is discharged — the historical `RegimeModel`. Absent for non-issuance layers. */
  model?: RegimeModel;
  /** Clearance: is the invoice invalid until the authority has authorised it? */
  blocking: boolean;
  /** null = the duty exists and its timing is not sourced. See `openQuestion`. */
  deadline: ObligationDeadline | null;
  /** What would have to be read to establish an absent deadline. */
  openQuestion?: string;
}

/**
 * Which duty a regime model expresses, when the profile has not said.
 *
 * A convention, and named as one so a profile can override it: CLEARANCE and DECENTRALIZED_CTC are
 * mechanisms for getting the INVOICE to the authority, the two reporting models are mechanisms for
 * getting DATA there, and POST_AUDIT is the absence of either duty rather than a third kind of it.
 */
export function obligationKindFor(model: RegimeModel): ObligationKind {
  switch (model) {
    case 'CLEARANCE':
    case 'DECENTRALIZED_CTC':
      return 'E_INVOICING';
    case 'REAL_TIME_REPORTING':
    case 'PERIODIC_REPORTING':
      return 'E_REPORTING';
    case 'POST_AUDIT':
      return 'NONE';
  }
}

/**
 * The one obligation the pre-P2-T03 code assumed. Readers migrate to this before `regime` is
 * removed, so the removal is a deletion and not a rewrite.
 */
/**
 * The selected rule first, then any other rule that also matched, de-duplicated.
 *
 * The selected rule leads because it is the answer `plan.regime` used to give: keeping it first is
 * what made the migration a shape change rather than a behaviour change, and it stays first now
 * that the field is gone so the removal did not quietly reorder anything either.
 */
function obligationsFrom(regime: RegimeRule, matching: RegimeRule[]): ResolvedObligation[] {
  const ordered = [regime, ...matching.filter((r) => r !== regime)];
  const seen = new Set<string>();
  const out: ResolvedObligation[] = [];
  for (const r of ordered) {
    const kind = r.obligation ?? obligationKindFor(r.model);
    const key = `${kind}|${r.model}|${r.blocking}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Regime-derived duties are ISSUANCE, and their deadline is null rather than invented: no
    // regime model carries one, and guessing "24 h" because the French reform is often summarised
    // that way would put a number nobody sourced into an enforced field.
    out.push({
      kind,
      layer: 'ISSUANCE',
      model: r.model,
      blocking: r.blocking,
      deadline: null,
      openQuestion:
        kind === 'NONE'
          ? undefined
          : 'Issuance deadline not established from a primary source for this jurisdiction.',
    });
  }
  return out;
}

/**
 * P2-T02 — the regime-derived ISSUANCE duty, enriched by what the profile declares, plus the layers
 * the regime cannot express.
 *
 * The two sources overlap on exactly one point: issuance. A regime says HOW an invoice reaches the
 * authority and carries no deadline; a profile's ISSUANCE obligation carries the deadline and
 * nothing about the mechanism. Merging them rather than listing both keeps `primaryObligation()`
 * meaning what every migrated reader expects — the issuance duty, singular — while giving it the
 * timing it never had.
 *
 * Profiles that declare nothing (107 of 108) produce a plan identical to before.
 */
function mergeObligations(
  fromRegime: ResolvedObligation[],
  fromProfile: ObligationRule[],
): ResolvedObligation[] {
  const declaredIssuance = fromProfile.find((r) => r.layer === 'ISSUANCE');
  const merged = fromRegime.map((o, i) =>
    i === 0 && declaredIssuance
      ? { ...o, deadline: declaredIssuance.deadline, openQuestion: declaredIssuance.openQuestion }
      : o,
  );
  const others = fromProfile
    .filter((r) => r !== declaredIssuance)
    .map((r) => ({
      kind: r.kind,
      layer: r.layer,
      blocking: false,
      deadline: r.deadline,
      openQuestion: r.openQuestion,
    }));
  return [...merged, ...others];
}

export function primaryObligation(plan: Pick<CompliancePlan, 'obligations'>): ResolvedObligation {
  // `resolve` always produces at least one — the POST_AUDIT default — so this cannot be empty for
  // a plan it built. A non-null assertion would hide the day that stops being true.
  const first = plan.obligations[0];
  if (!first) {
    throw new Error('CompliancePlan carries no obligation; resolve() always produces at least one.');
  }
  return first;
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
  // P2-T03 — every regime rule in force that matches, in profile order, turned into obligations.
  // Today the French rules are mutually exclusive so this yields one; the shape is what changes.
  const matchingRegimes = allWithSelector(
    sp.regime,
    ctx.issueDate,
    buyerRole,
    supplyTypes,
    parties,
    nature,
    warnings,
  );
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
  // P2-T07 — the channels that carry the INVOICE. A rule marked `serves: 'E_REPORTING'` carries
  // DATA instead and must not be picked here, or a domestic B2C invoice ends up on a PDP again by
  // the other door.
  const invoiceRule =
    transmission && transmission.serves !== 'E_REPORTING'
      ? transmission
      : allWithSelector(sp.transmission, ctx.issueDate, buyerRole, supplyTypes, parties, nature).find(
          (r) => r.serves !== 'E_REPORTING',
        );
  const channels: ChannelSpec[] = invoiceRule?.channels ?? [{ type: 'EMAIL' }];

  // Where the DATA goes, when the profile says so. Empty is a legitimate answer — most countries
  // have no separate reporting destination — and callers fall back to the invoice channel, which is
  // the behaviour every profile had before this field existed.
  const reportingChannels: ChannelSpec[] = allWithSelector(
    sp.transmission,
    ctx.issueDate,
    buyerRole,
    supplyTypes,
    parties,
    nature,
  )
    .filter((r) => r.serves === 'E_REPORTING')
    .flatMap((r) => r.channels);

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
    // P2-T06 — `regime` is gone; `obligations` is the single source. The primary one is built from
    // the rule `regime` used to expose, so the removal is a deletion and not a change of answer.
    obligations: mergeObligations(
      obligationsFrom(regime, matchingRegimes),
      allWithSelector(sp.obligations ?? [], ctx.issueDate, buyerRole, supplyTypes, parties, nature),
    ),
    artifacts,
    channels,
    reportingChannels,
    numbering,
    lifecycle,
    archival,
    reporting,
    confidence,
    warnings,
  };
}

/** Pick the rule in force at the date whose selector matches the transaction class. */
/**
 * P2-T03 — EVERY rule in force that matches, not just the first.
 *
 * `regime` is singular and that singularity is a modelling choice, not a fact: France carries two
 * duties over the same operation — e-invoicing (flux F1, art. 289 bis) and e-reporting (flux F10,
 * art. 290) — and they are discharged differently, on different deadlines, through different
 * corrections. Returning one rule forces them to be modelled as mutually exclusive, which is why
 * the transmission block in profiles/data/fr.ts documents a B2C sale being offered a PDP as a
 * limit it cannot express: one channel list serves both "where the invoice goes" and "where the
 * data goes".
 *
 * This returns the set. `pickWithSelector` below keeps the historical single answer on top of it,
 * which is how the sixteen readers across eight files were migrated without a behaviour change
 * hiding inside the refactor.
 */
function allWithSelector<
  T extends { appliesTo?: ClassificationSelector; attachment?: AttachmentPredicate[] },
>(
  rules: Temporal<T>[],
  date: Date,
  buyerRole: PartyRole,
  supplyTypes: SupplyType[],
  parties?: OperationParties,
  nature?: OperationNature,
  warnings?: string[],
): T[] {
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
  return inForce;
}

/**
 * The single rule that applies — the historical behaviour, unchanged.
 *
 * Prefer a selector-specific rule over a wildcard one.
 */
function pickWithSelector<
  T extends { appliesTo?: ClassificationSelector; attachment?: AttachmentPredicate[] },
>(
  rules: Temporal<T>[],
  date: Date,
  buyerRole: PartyRole,
  supplyTypes: SupplyType[],
  parties?: OperationParties,
  nature?: OperationNature,
  warnings?: string[],
): T | null {
  const inForce = allWithSelector(rules, date, buyerRole, supplyTypes, parties, nature, warnings);
  if (inForce.length === 0) return null;
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
