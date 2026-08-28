/**
 * The Country Compliance Profile — the declarative, versioned, temporal description of one
 * jurisdiction (COMPLIANCE_ARCHITECTURE.md §7). A profile references provider behaviour as data;
 * the engine resolves it against a point in time (the issue date).
 */
import type { AttachmentPredicate } from '../engine/attachment-predicate';
import {
  ChannelType,
  Confidence,
  CorrectionModel,
  DocumentSyntax,
  ISO3166Alpha2,
  NumberingModel,
  PartyRole,
  RegimeModel,
  ReportingKind,
  SupplyType,
  TaxScheme,
  ObligationKind,
} from '../types';

/** Every rule list is temporal. `validTo` is EXCLUSIVE; absence means "open-ended". */
export interface Temporal<T> {
  validFrom: string; // ISO date
  validTo?: string; // ISO date, exclusive
  value: T;
}

/** Narrows a rule to a class of transactions (undefined field = wildcard). */
export interface ClassificationSelector {
  roles?: PartyRole[];
  supply?: SupplyType[];
}

export interface RegimeRule {
  model: RegimeModel;
  appliesTo?: ClassificationSelector;
  /**
   * P2-T02 — which OPERATIONS this regime catches, by the attachment of the parties.
   *
   * `appliesTo` selects on the buyer's ROLE and the supply type; it cannot say "when both parties
   * are attached to France". That gap is why FR→IT and FR→US resolve to DECENTRALIZED_CTC today and
   * are routed to a PDP, where CGI art. 289 bis I reserves e-invoicing to parties BOTH attached to
   * France, and art. 290 puts those supplies under e-reporting.
   *
   * All predicates must hold. An unresolved attachment makes the rule UNDECIDABLE rather than
   * inapplicable — see evaluateAll — so a missing country can never quietly select a regime.
   */
  attachment?: AttachmentPredicate[];
  /**
   * P2-T03 — WHICH duty this rule expresses, when the model alone does not say.
   *
   * Left out, it is derived from `model` (see obligationKindFor). The override exists because the
   * mapping is a convention, not a law: a country could run a CLEARANCE model to discharge a
   * reporting duty rather than an invoicing one, and a profile must be able to say so without the
   * engine guessing from the mechanism.
   */
  obligation?: ObligationKind;
  blocking: boolean; // clearance: is the invoice invalid until authorised?
}

export interface FormatSpec {
  syntax: DocumentSyntax;
  version?: string;
}

export interface FormatRule {
  appliesTo?: ClassificationSelector;
  primary: FormatSpec; // the legally-required artifact
  human?: FormatSpec; // human-readable companion
  buyerNegotiable: boolean; // may add the buyer's mandated receive-syntax
}

export interface ChannelSpec {
  type: ChannelType;
  /**
   * Optional exact provider id (e.g. 'ksef', 'sdi', 'zatca'). Lets a profile pick a specific
   * national-portal provider when several share the same generic ChannelType (GOV_PORTAL_API).
   * When omitted, the registry resolves by ChannelType.
   */
  providerId?: string;
}

/**
 * P2-T02 — the three layers an obligation can sit in.
 *
 * A country's duties do not all attach to the same moment. Issuing carries one (get the invoice or
 * its data to the authority), receiving carries another (return a status the sender is entitled to),
 * and keeping carries a third (retain, in a given form, for a given time). They have different
 * deadlines and different failure modes, and flattening them into one `regime` is why the profile
 * could express "France runs a decentralized CTC model" and not "France expects a status back
 * within N days".
 */
export type ObligationLayer = 'ISSUANCE' | 'RECEPTION' | 'ARCHIVAL';

/** A deadline with its unit, because hours are wrong for a ten-year retention. */
export interface ObligationDeadline {
  value: number;
  unit: 'HOURS' | 'DAYS' | 'YEARS';
}

/**
 * One duty, as the PROFILE declares it.
 *
 * `deadline: null` is a first-class answer and not a hole to be filled with a plausible number: it
 * says the duty exists and its timing has not been established from a primary source. `openQuestion`
 * then carries what would have to be read to establish it. A wrong deadline is worse than an absent
 * one — it would be enforced.
 */
export interface ObligationRule {
  layer: ObligationLayer;
  kind: ObligationKind;
  deadline: ObligationDeadline | null;
  openQuestion?: string;
  appliesTo?: ClassificationSelector;
  attachment?: AttachmentPredicate[];
}

export interface TransmissionRule {
  /**
   * P2-T07 — WHICH duty these channels discharge.
   *
   * Omitted, they carry the INVOICE: that is what every profile written before this field meant,
   * and what `plan.channels` has always held. `serves: 'E_REPORTING'` marks channels that carry
   * DATA to the administration instead — France's flux F10, the "encaissée" status of art. 290 III.
   *
   * The two are genuinely different destinations for the same operation. A domestic B2C sale is
   * outside the e-invoicing mandate, so its invoice must NOT go to a PDP (art. 289 bis I covers
   * B2B/B2G only) — while its payment data must. One list cannot say both, and trying to make it
   * do so is what put a PDP on the B2C invoice.
   */
  serves?: ObligationKind;
  channels: ChannelSpec[]; // ordered, with fallbacks
  deliverToBuyerWithinHours?: number;
  /**
   * P2-T02 — the buyer role and supply type, as every other rule kind already carries.
   * TransmissionRule did not have it, so channels could not be selected by role: a domestic B2C
   * sale is bilaterally attached to France and still outside the e-invoicing mandate (art. 289 bis I
   * covers the operations of art. 289 I 1 a and d — B2B and B2G), yet it was offered a PDP.
   */
  appliesTo?: ClassificationSelector;
  /**
   * P2-T02 — same predicate, on the channels. A regime alone is not enough: France must not offer a
   * PDP channel for an operation that is outside the e-invoicing mandate, because the channel is
   * what actually routes the document.
   */
  attachment?: AttachmentPredicate[];
}

export interface ResponsePolicy {
  window?: { hours: number };
  defaultOnSilence?: 'ACCEPT' | 'NONE';
  statuses?: string[]; // mandatory status set (FR: déposée, rejetée, refusée, encaissée)
}

export interface LifecyclePolicy {
  immutableAfter: 'ISSUE' | 'CLEARANCE' | 'NEVER';
  correctionModel: CorrectionModel;
  cancellation: {
    allowed: boolean;
    windowHours?: number;
    requiresAuthorityAck: boolean;
    requiresBuyerConsent?: boolean;
  };
  response?: ResponsePolicy; // §11.1 bidirectional
  contingency?: { mode: string; offlineIssue: boolean; submitWithinHours: number };
}

export interface ArchivalPolicy {
  retentionYears: number;
  residency?: ISO3166Alpha2; // null/undefined = anywhere
  archivedForm: 'AUTHORITATIVE_XML' | 'HYBRID_PDF' | 'BOTH';
  integrity: 'NONE' | 'HASH_CHAIN' | 'SIGNED';
}

export interface ReportingObligation {
  kinds: ReportingKind[];
  appliesTo?: ClassificationSelector;
}

export interface NumberingRule {
  model: NumberingModel;
  hashChain?: boolean;
  seriesScope?: 'ENTITY' | 'BRANCH_POS' | 'DOC_TYPE' | 'YEAR';
}

export interface VatSystemSpec {
  kind: 'VAT' | 'GST';
  standardRate: number;
  reducedRates?: number[];
  /**
   * Does this country levy a domestic ZERO RATE — a taxable supply at 0% that still carries the
   * right to deduct input tax — as opposed to an EXEMPTION, which is untaxed and deducts nothing?
   *
   * This exists because the RATE CANNOT ANSWER IT. Both are 0, and EN 16931 keeps them apart:
   * `Z` answers to BR-Z-*, `E` to BR-E-* and additionally demands an exemption reason
   * (BT-120 text or BT-121 code, BR-E-10). A document that calls an exemption a zero-rated supply
   * is wrong in a way no validator downstream can repair, because both are internally consistent.
   *
   * Three states, and the third is the point:
   *   `true`      the country has a zero rate — a 0% domestic line may legitimately be `Z`.
   *   `false`     it has none — a 0% domestic line is NOT `Z`; it is an exemption or out of scope.
   *   `undefined` NOT ESTABLISHED for this country. The engine keeps its previous answer rather
   *               than reclassifying ~100 archetype profiles nobody has sourced. Absence of a
   *               declaration is not a declaration of absence.
   */
  hasDomesticZeroRate?: boolean;
  schemes?: TaxScheme[];
  requiresTaxCurrency?: string;
}

export interface SalesTaxSystemSpec {
  kind: 'SALES_TAX';
  stateRates: Record<string, number>; // subdivision -> base rate %
  nexusSubdivisions?: string[]; // where the supplier must collect
  economicNexusNote?: string;
}

export interface NoTaxSystemSpec {
  kind: 'NONE';
}

export type TaxSystemSpec = VatSystemSpec | SalesTaxSystemSpec | NoTaxSystemSpec;

export interface CountryComplianceProfile {
  countryCode: ISO3166Alpha2;
  displayName: string;
  schemaVersion: string;
  /** Delegate to another jurisdiction's profile (Monaco→FR, San Marino↔IT). */
  delegatesTo?: ISO3166Alpha2;
  confidence: Confidence;

  regime: Temporal<RegimeRule>[];
  formats: Temporal<FormatRule>[];
  transmission: Temporal<TransmissionRule>[];
  /**
   * P2-T02 — duties by LAYER. Optional, and France is the only profile that carries it: the other
   * 107 keep their current shape, and the engine derives an ISSUANCE obligation from their regime
   * exactly as before. Migrating them is a per-country sourcing job, not a refactor.
   */
  obligations?: Temporal<ObligationRule>[];
  taxSystem: TaxSystemSpec;
  lifecycle: Temporal<LifecyclePolicy>[];
  archival: Temporal<ArchivalPolicy>[];
  reporting: Temporal<ReportingObligation>[];
  numbering: Temporal<NumberingRule>[];

  /** Per-country required identifiers for companies/individuals. */
  requiredIdentifiers: IdentifierRequirement[];

  /** What this country's buyers are mandated to *receive* (drives buyer-format negotiation). */
  mandatoryReceiveSyntax?: DocumentSyntax;
}

export interface IdentifierRequirement {
  scheme: string;
  label: string;
  appliesTo: 'COMPANY' | 'INDIVIDUAL' | 'BOTH';
  required: boolean;
  pattern?: string;
  helpText?: string;
}
