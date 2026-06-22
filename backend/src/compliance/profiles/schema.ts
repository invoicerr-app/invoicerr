/**
 * The Country Compliance Profile — the declarative, versioned, temporal description of one
 * jurisdiction (COMPLIANCE_ARCHITECTURE.md §7). A profile references provider behaviour as data;
 * the engine resolves it against a point in time (the issue date).
 */
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
}

export interface TransmissionRule {
  channels: ChannelSpec[]; // ordered, with fallbacks
  deliverToBuyerWithinHours?: number;
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
  taxSystem: TaxSystemSpec;
  lifecycle: Temporal<LifecyclePolicy>[];
  archival: Temporal<ArchivalPolicy>[];
  reporting: Temporal<ReportingObligation>[];
  numbering: Temporal<NumberingRule>[];

  /** What this country's buyers are mandated to *receive* (drives buyer-format negotiation). */
  mandatoryReceiveSyntax?: DocumentSyntax;
}
