/**
 * The Country Compliance Profile — the declarative, versioned, temporal description of one
 * jurisdiction (COMPLIANCE_ARCHITECTURE.md §7). A profile references provider behaviour as data;
 * the engine resolves it against a point in time (the issue date).
 */
import type { AttachmentPredicate } from '../engine/attachment-predicate';
import type { ComplianceStatus } from '../lifecycle/state-machine';
import {
  ChannelType,
  Confidence,
  CorrectionModel,
  CorrectionRoute,
  DocumentKind,
  DocumentKindCode,
  DocumentSyntax,
  ISO3166Alpha2,
  NumberingModel,
  ObligationKind,
  PartyRole,
  RegimeModel,
  ReportingKind,
  RouteStatus,
  SupplyType,
  TaxScheme,
  VariationDirection,
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

/**
 * P3-T02 — one correction route, statused, with the text that says so.
 *
 * Two axes here are NOT the status, and both were learned the hard way in P3-T01:
 *
 * `transmission` — a route can be REQUIRED and its transmission FORBIDDEN at the same time. That is
 * precisely the French avoir interne on statuses Refusée/Rejetée and the Italian variazione contabile
 * after a scarto: the document must be produced and must NOT leave. Folding this into the status
 * would lose the half that matters, because today `correctInvoice()` issues and then transmits, which
 * is what P3-T03 has to stop.
 *
 * `direction` — whether the route serves an increase or a decrease. Undefined means both, which is
 * Poland's answer (one instrument for either way) and not an omission.
 */
export interface CorrectionRouteRule {
  route: CorrectionRoute;
  status: RouteStatus;
  /** Absent = the route says nothing about transmission; the channel plan decides as usual. */
  transmission?: 'REQUIRED' | 'FORBIDDEN';
  /** Absent = serves both directions. */
  direction?: VariationDirection;
  /** The case in which the status applies — free text, for the screen and for the reader. */
  appliesTo?: string;
  /**
   * P3-T03 — the machine-readable half of `appliesTo`, for the cases where the RUNTIME must act.
   *
   * "Sur les statuts Refusée ou Rejetée" is a rule about the ORIGINAL document, and prose cannot
   * gate a transmission. Only the routes that change what the engine does carry this; the rest stay
   * prose, because inventing a status list for a rule nobody has to enforce would be noise.
   */
  whenOriginalStatus?: ComplianceStatus[];
  /** The article, ruling or specification. REQUIRED unless the status is UNVERIFIED. */
  legalRef?: string;
  /** What would settle it. REQUIRED when the status is UNVERIFIED — guarded in data-integrity. */
  openQuestion?: string;
}

/**
 * A mention a country requires on every invoice — BG-1 in EN 16931 terms.
 *
 * France is the case that forced this: C. com. art. L441-9 I al. 5 puts THREE mentions in a single
 * sentence — the early-payment discount terms, the late-payment rate, and the fixed recovery
 * indemnity — and omitting them is an administrative offence (L441-9 II: up to 75 000 € for a
 * natural person, 375 000 € for a company). superpdp rejects the document outright.
 *
 * Declared as DATA, never as a branch on the country: the engine renders whatever the profile lists
 * and names no jurisdiction. A country that requires nothing simply lists nothing.
 *
 * `text` may carry `{placeholders}` resolved from `values` below — the late-payment rate changes
 * every six months, so freezing it in a string would silently print a stale rate.
 */
export interface InvoiceNoteRule {
  /** UNTDID 4451 subject code (BT-21). Optional: BT-22 alone is a valid note. */
  subjectCode?: string;
  /** BT-22. `{name}` placeholders are substituted from the resolved values. */
  text: string;
  /** The article this mention discharges — carried so a reader can check it, and shown in no UI. */
  legalRef: string;
  /**
   * Marks a mention the LAW supplies a value for, as opposed to one that states a commercial choice.
   * Only the former may be emitted without asking the user anything.
   */
  statutory: boolean;
}

/**
 * A value that changes on a calendar schedule and must be frozen at issue date, never recomputed.
 *
 * France's supplementary late-payment rate is the ECB main refinancing rate plus ten points, read at
 * 1 January for the first half-year and 1 July for the second (C. com. art. L441-10 II). An invoice
 * issued in July carries July's rate for ever; recomputing it in January would restate a document
 * that was correct when issued.
 */
export interface TemporalValue {
  validFrom: string;
  validTo?: string;
  value: string;
}

export interface LifecyclePolicy {
  immutableAfter: 'ISSUE' | 'CLEARANCE' | 'NEVER';
  /**
   * The single strategy that BUILDS a correcting document. Kept because six call sites read it —
   * but it is no longer authored by hand where `correctionRoutes` exists: data-integrity asserts it
   * equals `primaryCorrectionModel(correctionRoutes)`, so the two cannot drift. D-002 warned that
   * phase 3 must not add a THIRD representation of something the repo already models twice; a
   * derived-and-asserted value is the answer to that warning, not another instance of it.
   */
  correctionModel: CorrectionModel;
  /**
   * The full set, sourced. Optional because only the seven pivots carry it today: an absent list
   * means "not researched", which is honest, whereas an empty list would claim "no route exists".
   */
  correctionRoutes?: CorrectionRouteRule[];
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

  /**
   * Which document kinds this country's businesses use. Optional, and absent means "derive".
   *
   * The engine already knows part of the answer without anyone declaring it: `correctionModel`
   * fixes whether a correction is a credit note, a corrective invoice or a cancel-and-replace, so
   * the correction kind is derivable for all 108 profiles. What no profile knows is whether a
   * proforma is permitted here — hence the UNVERIFIED default rather than an invented AVAILABLE.
   */
  documentKinds?: Temporal<DocumentKindRule>[];
  /**
   * Mentions this country requires on every invoice (BG-1). Absent = none researched, which is the
   * state of every country but France today — and honest, since a missing list must not read as
   * "this country requires nothing".
   */
  invoiceNotes?: Temporal<InvoiceNoteRule>[];
  /**
   * Named values the notes interpolate, each on its own calendar. Keyed by placeholder name.
   */
  noteValues?: Record<string, TemporalValue[]>;

  /** Per-country required identifiers for companies/individuals. */
  requiredIdentifiers: IdentifierRequirement[];

  /** What this country's buyers are mandated to *receive* (drives buyer-format negotiation). */
  mandatoryReceiveSyntax?: DocumentSyntax;
}

/**
 * What a document KIND is in a given country, and whether the product should offer it.
 *
 * WHY THIS IS DATA. A proforma is not an invoice: it carries no number from the legal series, it is
 * never issued, never transmitted, never archived under a retention duty. A deposit invoice is the
 * opposite — it is a full legal document that happens to be partial. Putting both in one list
 * whose every other row is a legal document is a category error, and the line between them is not
 * the same everywhere. Hard-coding "hide proformas" in the interface would put a country's rule in
 * a React component, which is the one thing this architecture forbids.
 *
 * `legalDocument` is a PRODUCT fact and universal: it says whether this repository's pipeline
 * numbers, issues, transmits and archives the kind. `availability` is a COUNTRY fact, and mostly
 * unverified — which is why `UNVERIFIED` exists and is the default rather than a polite `AVAILABLE`.
 */
/**
 * When a document may be issued — a calendar constraint, not a legal claim.
 *
 * Exists because a jurisdiction can perfectly well say "this document is issued on the first of the
 * month" or "only in the first quarter", and expressing that must not require touching the engine.
 * Every field is optional and they AND together; an empty window means "whenever".
 */
export interface IssuanceWindow {
  /** Days of the month on which issuance is allowed, 1–31. */
  daysOfMonth?: number[];
  /** Months, 1–12. */
  months?: number[];
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  daysOfWeek?: number[];
  /** Shown to the user when the window blocks them. Free text, in the country's own words. */
  description?: string;
}

/** A document that must already exist, in a given state, before this one may be issued. */
export interface DocumentPrerequisite {
  kind: DocumentKindCode;
  /** e.g. 'SIGNED' for a quote. Absent = it need only exist. */
  state?: string;
  /** Shown when the prerequisite is not met. */
  description?: string;
}

export interface DocumentKindRule {
  kind: DocumentKindCode;
  /**
   * What to call it on screen when the shipped label does not fit — a country-specific document has
   * a country-specific name, and `FAKTURA_ZALICZKOWA` is not a label.
   */
  label?: string;
  /**
   * Documents that must exist first. This is what lets a profile say "no invoice without a signed
   * quote" without a single line of code knowing what a quote is.
   */
  requires?: DocumentPrerequisite[];
  /** When it may be issued. Absent = whenever. Sugar for a `calendarWindow` condition. */
  issuableOn?: IssuanceWindow;
  /**
   * Conditions on any action, as the general form the three fields above are sugar for.
   *
   * This is THE extension point. `requires` and `issuableOn` cover the two cases that come up
   * constantly and read better spelled out; everything else — a threshold on the amount, a status,
   * a rule only a plugin can express — goes here without the core learning a new field. Enumerating
   * one field per national quirk is how a schema becomes an N×N matrix with extra steps.
   */
  conditions?: Partial<
    Record<import('./action-conditions').DocumentAction, import('./action-conditions').ActionCondition[]>
  >;
  /**
   * Does this kind enter the legal series — numbered, issued, transmitted, archived?
   *
   * Not a country question. It describes what the product does with the kind, and it is what tells
   * an interface whether the document belongs beside invoices or beside quotes.
   */
  legalDocument: boolean;
  /**
   * Whether the country permits it, and this one IS a country question.
   *
   * `UNVERIFIED` is the honest default and covers almost everything today: nobody has sourced, per
   * country, whether a proforma is permitted, regulated or meaningless. A screen may still offer an
   * UNVERIFIED kind — the product has always offered them — but it must not claim the country
   * endorses it, and `openQuestion` says what would have to be read.
   */
  availability: 'AVAILABLE' | 'REQUIRED' | 'FORBIDDEN' | 'UNVERIFIED';
  openQuestion?: string;
}

export interface IdentifierRequirement {
  scheme: string;
  label: string;
  appliesTo: 'COMPANY' | 'INDIVIDUAL' | 'BOTH';
  required: boolean;
  pattern?: string;
  helpText?: string;
}
