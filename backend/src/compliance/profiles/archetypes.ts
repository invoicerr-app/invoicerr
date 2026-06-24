/**
 * Archetype builders — typed factories that turn a few parameters into a full, well-typed
 * CountryComplianceProfile (COMPLIANCE_ARCHITECTURE.md §15). Every country in documentation/compliance maps to
 * one of these archetypes, so wiring a country is a one-line declaration, not a bespoke file. Bespoke
 * profiles (FR, US, MX, IT, PL) stay hand-written for their richer specifics.
 */
import { Confidence, ChannelType, DocumentSyntax, NumberingModel } from '../types';
import {
  ArchivalPolicy,
  CountryComplianceProfile,
  FormatRule,
  LifecyclePolicy,
  NoTaxSystemSpec,
  NumberingRule,
  RegimeRule,
  ReportingObligation,
  ResponsePolicy,
  Temporal,
  TransmissionRule,
  TaxSystemSpec,
  VatSystemSpec,
} from './schema';
import { ReportingKind } from '../types';

const OPEN = '1900-01-01';

// --- Tax-system helpers ---
export function vat(standardRate: number, reducedRates: number[] = []): VatSystemSpec {
  return { kind: 'VAT', standardRate, reducedRates, schemes: ['STANDARD'] };
}
export function gst(standardRate: number, reducedRates: number[] = []): VatSystemSpec {
  return { kind: 'GST', standardRate, reducedRates, schemes: ['STANDARD'] };
}
export function noTax(): NoTaxSystemSpec {
  return { kind: 'NONE' };
}

interface CommonOpts {
  tax?: TaxSystemSpec;
  retentionYears?: number;
  residency?: string;
  confidence?: Confidence;
}

// --- small typed builders for the temporal sub-lists ---
function archival(years: number, residency: string | undefined, integrity: ArchivalPolicy['integrity']): Temporal<ArchivalPolicy>[] {
  return [
    {
      validFrom: OPEN,
      value: {
        retentionYears: years,
        residency,
        archivedForm: integrity === 'SIGNED' ? 'AUTHORITATIVE_XML' : 'HYBRID_PDF',
        integrity,
      },
    },
  ];
}
function numbering(model: NumberingModel): Temporal<NumberingRule>[] {
  return [{ validFrom: OPEN, value: { model } }];
}
function lifecycle(
  immutableAfter: LifecyclePolicy['immutableAfter'],
  response?: ResponsePolicy,
): Temporal<LifecyclePolicy>[] {
  return [
    {
      validFrom: OPEN,
      value: {
        immutableAfter,
        correctionModel: 'CREDIT_NOTE',
        cancellation: { allowed: true, requiresAuthorityAck: immutableAfter === 'CLEARANCE' },
        ...(response ? { response } : {}),
      },
    },
  ];
}
function meta(cc: string, name: string, confidence: Confidence) {
  return { countryCode: cc, displayName: name, schemaVersion: '1.0', confidence };
}

/** Post-audit: EN 16931 + Peppol/email, B2B voluntary, no clearance. Most EU today. */
export function postAudit(
  cc: string,
  name: string,
  o: CommonOpts & { primary?: DocumentSyntax; receiveSyntax?: DocumentSyntax } = {},
): CountryComplianceProfile {
  return {
    ...meta(cc, name, o.confidence ?? 'BEST_EFFORT'),
    regime: [{ validFrom: OPEN, value: { model: 'POST_AUDIT', blocking: false } }],
    formats: [{ validFrom: OPEN, value: { primary: { syntax: o.primary ?? 'EN16931_UBL' }, human: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true } }],
    transmission: [{ validFrom: OPEN, value: { channels: [{ type: 'PEPPOL' }, { type: 'EMAIL' }] } }],
    taxSystem: o.tax ?? vat(20),
    lifecycle: lifecycle('ISSUE'),
    archival: archival(o.retentionYears ?? 10, o.residency, 'NONE'),
    reporting: [],
    numbering: numbering('GAPLESS_SELF'),
    mandatoryReceiveSyntax: o.receiveSyntax,
  };
}

/** No e-invoicing mandate (post-audit, plain PDF). e.g. ZA, GB, VA. */
export function noMandate(cc: string, name: string, o: CommonOpts = {}): CountryComplianceProfile {
  return {
    ...meta(cc, name, o.confidence ?? 'OFFICIAL'),
    regime: [{ validFrom: OPEN, value: { model: 'POST_AUDIT', blocking: false } }],
    formats: [{ validFrom: OPEN, value: { primary: { syntax: 'PLAIN_PDF' }, human: { syntax: 'EN16931_UBL' }, buyerNegotiable: true } }],
    transmission: [{ validFrom: OPEN, value: { channels: [{ type: 'EMAIL' }] } }],
    taxSystem: o.tax ?? vat(20),
    lifecycle: lifecycle('ISSUE'),
    archival: archival(o.retentionYears ?? 7, o.residency, 'NONE'),
    reporting: [],
    numbering: numbering('GAPLESS_SELF'),
  };
}

/** Announced mandate, format/timeline not settled yet → interim post-audit, confidence PLANNED. */
export function planned(cc: string, name: string, o: CommonOpts = {}): CountryComplianceProfile {
  return { ...noMandate(cc, name, { ...o, confidence: o.confidence ?? 'PLANNED' }) };
}

/** Decentralized CTC / Peppol 5-corner (FR-style), phasing in at `ctcFrom`. */
export function peppolCtc(
  cc: string,
  name: string,
  o: CommonOpts & { ctcFrom: string },
): CountryComplianceProfile {
  const regime: Temporal<RegimeRule>[] = [
    { validFrom: OPEN, validTo: o.ctcFrom, value: { model: 'POST_AUDIT', blocking: false } },
    { validFrom: o.ctcFrom, value: { model: 'DECENTRALIZED_CTC', appliesTo: { roles: ['B2B', 'B2G'] }, blocking: false } },
    { validFrom: o.ctcFrom, value: { model: 'REAL_TIME_REPORTING', appliesTo: { roles: ['B2C'] }, blocking: false } },
  ];
  const reporting: Temporal<ReportingObligation>[] = [
    { validFrom: o.ctcFrom, value: { kinds: ['E_REPORTING'] as ReportingKind[], appliesTo: { roles: ['B2C'] } } },
  ];
  return {
    ...meta(cc, name, o.confidence ?? 'BEST_EFFORT'),
    regime,
    formats: [{ validFrom: OPEN, value: { primary: { syntax: 'PEPPOL_BIS' }, human: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true } }],
    transmission: [{ validFrom: OPEN, value: { channels: [{ type: 'PEPPOL' }, { type: 'EMAIL' }] } }],
    taxSystem: o.tax ?? vat(20),
    lifecycle: lifecycle('ISSUE'),
    archival: archival(o.retentionYears ?? 10, o.residency, 'NONE'),
    reporting,
    numbering: numbering('GAPLESS_SELF'),
    mandatoryReceiveSyntax: 'PEPPOL_BIS',
  };
}

/** Blocking clearance (MX/BR/CL/IT-style): authority must authorise before the invoice is valid. */
export function clearance(
  cc: string,
  name: string,
  o: CommonOpts & {
    from?: string;
    syntax?: DocumentSyntax;
    channel?: ChannelType;
    providerId?: string;
    numbering?: NumberingModel;
    signed?: boolean;
    response?: ResponsePolicy;
  } = {},
): CountryComplianceProfile {
  const from = o.from ?? OPEN;
  const syntax: DocumentSyntax = o.syntax ?? 'NATIONAL_XML';
  const channel: ChannelType = o.channel ?? 'GOV_PORTAL_API';
  const signed = o.signed ?? true;

  const regime: Temporal<RegimeRule>[] =
    from === OPEN
      ? [{ validFrom: OPEN, value: { model: 'CLEARANCE', blocking: true } }]
      : [
          { validFrom: OPEN, validTo: from, value: { model: 'POST_AUDIT', blocking: false } },
          { validFrom: from, value: { model: 'CLEARANCE', blocking: true } },
        ];
  const formats: Temporal<FormatRule>[] =
    from === OPEN
      ? [{ validFrom: OPEN, value: { primary: { syntax }, human: { syntax: 'PLAIN_PDF' }, buyerNegotiable: false } }]
      : [
          { validFrom: OPEN, validTo: from, value: { primary: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true } },
          { validFrom: from, value: { primary: { syntax }, human: { syntax: 'PLAIN_PDF' }, buyerNegotiable: false } },
        ];
  const transmission: Temporal<TransmissionRule>[] =
    from === OPEN
      ? [{ validFrom: OPEN, value: { channels: [{ type: channel, providerId: o.providerId }] } }]
      : [
          { validFrom: OPEN, validTo: from, value: { channels: [{ type: 'EMAIL' }] } },
          { validFrom: from, value: { channels: [{ type: channel, providerId: o.providerId }] } },
        ];
  return {
    ...meta(cc, name, o.confidence ?? 'BEST_EFFORT'),
    regime,
    formats,
    transmission,
    taxSystem: o.tax ?? vat(20),
    lifecycle: lifecycle('CLEARANCE', o.response),
    archival: archival(o.retentionYears ?? 10, o.residency, signed ? 'SIGNED' : 'NONE'),
    reporting: [],
    numbering: numbering(o.numbering ?? 'GAPLESS_SELF'),
    mandatoryReceiveSyntax: syntax,
  };
}

/** Real-time / near-real-time reporting (invoice valid without approval): KE/RW/ES-SII style. */
export function realTime(
  cc: string,
  name: string,
  o: CommonOpts & { from?: string; channel?: ChannelType; syntax?: DocumentSyntax; providerId?: string } = {},
): CountryComplianceProfile {
  const from = o.from ?? OPEN;
  const channel: ChannelType = o.channel ?? 'GOV_PORTAL_API';
  const syntax: DocumentSyntax = o.syntax ?? 'NATIONAL_XML';
  const regime: Temporal<RegimeRule>[] =
    from === OPEN
      ? [{ validFrom: OPEN, value: { model: 'REAL_TIME_REPORTING', blocking: false } }]
      : [
          { validFrom: OPEN, validTo: from, value: { model: 'POST_AUDIT', blocking: false } },
          { validFrom: from, value: { model: 'REAL_TIME_REPORTING', blocking: false } },
        ];
  return {
    ...meta(cc, name, o.confidence ?? 'BEST_EFFORT'),
    regime,
    formats: [{ validFrom: OPEN, value: { primary: { syntax }, human: { syntax: 'PLAIN_PDF' }, buyerNegotiable: false } }],
    transmission: [{ validFrom: OPEN, value: { channels: [{ type: channel, providerId: o.providerId }] } }],
    taxSystem: o.tax ?? vat(20),
    lifecycle: lifecycle('ISSUE'),
    archival: archival(o.retentionYears ?? 7, o.residency, 'NONE'),
    reporting: [{ validFrom: from, value: { kinds: ['SALES_PURCHASE_LEDGER'] as ReportingKind[] } }],
    numbering: numbering('GAPLESS_SELF'),
  };
}

/** Periodic reporting (SAF-T / ledgers): AO/MZ style. */
export function periodic(cc: string, name: string, o: CommonOpts = {}): CountryComplianceProfile {
  return {
    ...meta(cc, name, o.confidence ?? 'BEST_EFFORT'),
    regime: [{ validFrom: OPEN, value: { model: 'PERIODIC_REPORTING', blocking: false } }],
    formats: [{ validFrom: OPEN, value: { primary: { syntax: 'EN16931_UBL' }, human: { syntax: 'PLAIN_PDF' }, buyerNegotiable: true } }],
    transmission: [{ validFrom: OPEN, value: { channels: [{ type: 'GOV_PORTAL_API' }, { type: 'EMAIL' }] } }],
    taxSystem: o.tax ?? vat(20),
    lifecycle: lifecycle('ISSUE'),
    archival: archival(o.retentionYears ?? 10, o.residency, 'NONE'),
    reporting: [{ validFrom: OPEN, value: { kinds: ['SAFT'] as ReportingKind[] } }],
    numbering: numbering('GAPLESS_SELF'),
  };
}

/** Delegate to another jurisdiction's profile (Monaco→FR, etc.). */
export function delegate(cc: string, name: string, target: string): CountryComplianceProfile {
  return {
    ...meta(cc, name, 'OFFICIAL'),
    delegatesTo: target,
    regime: [],
    formats: [],
    transmission: [],
    taxSystem: noTax(),
    lifecycle: [],
    archival: [],
    reporting: [],
    numbering: [],
  };
}
