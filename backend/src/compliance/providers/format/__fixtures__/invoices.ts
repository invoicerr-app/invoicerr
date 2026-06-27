import { InvoiceRenderData } from '@/modules/invoice-rendering/invoice-rendering.service';

/** Pure-XML export format or hybrid PDF/A-3 format. */
export type ExportableFormat = 'ubl' | 'cii' | 'xrechnung' | 'facturx' | 'zugferd';

/**
 * Expected validation outcome for a given format.
 *
 * Validation strategy depends on syntax family (see format-validation.spec.ts):
 *   - UBL:       round-trip fromXml → validate(BUSINESS) — the parser works.
 *   - XRechnung: round-trip fromXml → validate(BUSINESS) — UBL-based, round-trip OK,
 *                but data gaps → known set of BR-DE error codes.
 *   - CII family (cii / facturx / zugferd): do NOT round-trip (fromXml bug in
 *                @fin.cx/einvoice 5.2.x/6.x). Validate in-memory + structural
 *                byte assertions. Authoritative byte-level validation via L2/L3.
 */
export interface ExpectedResult {
  valid: boolean;
  /**
   * XRechnung only: expected BR-DE error codes from round-trip validation.
   * The gate asserts that the error set matches exactly — if the set grows
   * (regression) or shrinks (fields added to the model), the test signals it.
   */
  knownGap?: string[];
  /**
   * When true, the harness only tests the XML export path (`exportXml()`), not
   * `embedInPdf()`. Needed for Factur-X / ZUGFeRD when the Jest VM cannot run
   * the PDF embedder (`--experimental-vm-modules` required).
   */
  xmlOnly?: boolean;
}

export interface FormatFixture {
  slug: string;
  description: string;
  data: InvoiceRenderData;
  formats: Partial<Record<ExportableFormat, ExpectedResult>>;
}

const NOW = new Date('2025-06-15T10:00:00Z');

const FR_COMPANY_PARTY = [
  { scheme: 'VAT', value: 'FR12345678901' },
  { scheme: 'LEGAL_ID', value: '123456789' },
];

const DE_COMPANY_PARTY = [
  { scheme: 'VAT', value: 'DE123456789' },
  { scheme: 'LEGAL_ID', value: 'HRB 123456' },
];

// ---------------------------------------------------------------------------
// Fixture 1: FR B2B — standard single-rate VAT
// ---------------------------------------------------------------------------
export const FR_B2B_STANDARD: FormatFixture = {
  slug: 'fr-b2b-standard',
  description: 'French B2B, single 20 % VAT rate',
  data: {
    rawNumber: 'INV-2025-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Dupont Consulting SARL',
      description: 'IT consulting',
      foundedAt: new Date('2018-03-01'),
      currency: 'EUR',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: FR_COMPANY_PARTY,
    },
    client: {
      type: 'COMPANY',
      name: 'Acme GmbH',
      description: 'Industrial client',
      foundedAt: new Date('2010-06-15'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Friedrichstr. 42',
      city: 'Berlin',
      postalCode: '10117',
      country: 'Germany',
      partyIdentifiers: DE_COMPANY_PARTY,
    },
    items: [
      { name: 'Conseil stratégique', quantity: 10, unitPrice: 1200, vatRate: 20, type: 'SERVICE' },
      { name: 'Formation équipe', quantity: 2, unitPrice: 800, vatRate: 20, type: 'HOUR' },
    ],
  },
  formats: {
    ubl: { valid: true },
    cii: { valid: true, xmlOnly: true },
    xrechnung: {
      valid: false,
      knownGap: ['BR-DE-11', 'BR-DE-12', 'BR-DE-13', 'BR-DE-14'],
    },
    facturx: { valid: true, xmlOnly: true },
    zugferd: { valid: true, xmlOnly: true },
  },
};

// ---------------------------------------------------------------------------
// Fixture 2: FR B2B — multi-rate VAT
// ---------------------------------------------------------------------------
export const FR_B2B_MULTI_VAT: FormatFixture = {
  slug: 'fr-b2b-multi-vat',
  description: 'French B2B, multiple VAT rates (20 % + 10 % + 5.5 %)',
  data: {
    rawNumber: 'INV-2025-0002',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Dupont Consulting SARL',
      description: 'IT consulting',
      foundedAt: new Date('2018-03-01'),
      currency: 'EUR',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: FR_COMPANY_PARTY,
    },
    client: {
      type: 'COMPANY',
      name: 'Acme GmbH',
      description: 'Industrial client',
      foundedAt: new Date('2010-06-15'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Friedrichstr. 42',
      city: 'Berlin',
      postalCode: '10117',
      country: 'Germany',
      partyIdentifiers: DE_COMPANY_PARTY,
    },
    items: [
      { name: 'Licence logiciel', quantity: 5, unitPrice: 200, vatRate: 20, type: 'PRODUCT' },
      { name: 'Support technique', quantity: 20, unitPrice: 50, vatRate: 10, type: 'SERVICE' },
      { name: 'Documentation', quantity: 1, unitPrice: 30, vatRate: 5.5, type: 'PRODUCT' },
    ],
  },
  formats: {
    ubl: { valid: true },
    cii: { valid: true, xmlOnly: true },
    xrechnung: {
      valid: false,
      knownGap: ['BR-DE-11', 'BR-DE-12', 'BR-DE-13', 'BR-DE-14'],
    },
    facturx: { valid: true, xmlOnly: true },
    zugferd: { valid: true, xmlOnly: true },
  },
};

// ---------------------------------------------------------------------------
// Fixture 3: FR B2B — with line-item discount
// ---------------------------------------------------------------------------
export const FR_B2B_DISCOUNT: FormatFixture = {
  slug: 'fr-b2b-discount',
  description: 'French B2B, line item with discount',
  data: {
    rawNumber: 'INV-2025-0003',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Dupont Consulting SARL',
      description: 'IT consulting',
      foundedAt: new Date('2018-03-01'),
      currency: 'EUR',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: FR_COMPANY_PARTY,
    },
    client: {
      type: 'COMPANY',
      name: 'Beta SAS',
      description: 'Retail client',
      foundedAt: new Date('2015-01-20'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: '20 Avenue des Champs',
      city: 'Lyon',
      postalCode: '69001',
      country: 'France',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR98765432109' }],
    },
    items: [
      { name: 'Audit sécurité', quantity: 1, unitPrice: 5000, vatRate: 20, type: 'SERVICE' },
      { name: 'Remise fidélité', quantity: 1, unitPrice: -500, vatRate: 20, type: 'SERVICE' },
    ],
  },
  formats: {
    ubl: { valid: true },
    cii: { valid: true, xmlOnly: true },
    xrechnung: {
      valid: false,
      knownGap: ['BR-DE-11', 'BR-DE-12', 'BR-DE-13', 'BR-DE-14'],
    },
    facturx: { valid: true, xmlOnly: true },
    zugferd: { valid: true, xmlOnly: true },
  },
};

// ---------------------------------------------------------------------------
// Fixture 4: DE B2B — German seller (XRechnung-native)
// ---------------------------------------------------------------------------
export const DE_B2B: FormatFixture = {
  slug: 'de-b2b',
  description: 'German B2B, seller in DE (XRechnung-native)',
  data: {
    rawNumber: 'RE-2025-0100',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Schmidt Software GmbH',
      description: 'SaaS provider',
      foundedAt: new Date('2012-09-01'),
      currency: 'EUR',
      address: 'Friedrichstr. 100',
      city: 'Berlin',
      postalCode: '10117',
      country: 'Germany',
      partyIdentifiers: DE_COMPANY_PARTY,
    },
    client: {
      type: 'COMPANY',
      name: 'Dupont Consulting SARL',
      description: 'IT consulting',
      foundedAt: new Date('2018-03-01'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: FR_COMPANY_PARTY,
    },
    items: [
      { name: 'SaaS licence mensuelle', quantity: 12, unitPrice: 99.9, vatRate: 19, type: 'SERVICE' },
    ],
  },
  formats: {
    ubl: { valid: true },
    cii: { valid: true, xmlOnly: true },
    xrechnung: {
      valid: false,
      knownGap: ['BR-DE-11', 'BR-DE-12', 'BR-DE-13', 'BR-DE-14'],
    },
    facturx: { valid: true, xmlOnly: true },
    zugferd: { valid: true, xmlOnly: true },
  },
};

// ---------------------------------------------------------------------------
// Fixture 5: EU B2B — reverse-charge
// ---------------------------------------------------------------------------
export const EU_B2B_REVERSE_CHARGE: FormatFixture = {
  slug: 'eu-b2b-reverse-charge',
  description: 'Intra-EU B2B, reverse charge (FR → DE, 0 % VAT)',
  data: {
    rawNumber: 'INV-2025-RC-001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Dupont Consulting SARL',
      description: 'IT consulting',
      foundedAt: new Date('2018-03-01'),
      currency: 'EUR',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: FR_COMPANY_PARTY,
    },
    client: {
      type: 'COMPANY',
      name: 'München Tech AG',
      description: 'Bavarian manufacturer',
      foundedAt: new Date('2005-11-10'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Marienplatz 1',
      city: 'München',
      postalCode: '80331',
      country: 'Germany',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'DE987654321' },
        { scheme: 'LEGAL_ID', value: 'HRB 987654' },
      ],
    },
    items: [
      { name: 'Conseil transfrontalier', quantity: 5, unitPrice: 1500, vatRate: 0, type: 'SERVICE' },
    ],
  },
  formats: {
    ubl: { valid: true },
    cii: { valid: true, xmlOnly: true },
    xrechnung: {
      valid: false,
      knownGap: ['BR-DE-11', 'BR-DE-12', 'BR-DE-13', 'BR-DE-14'],
    },
    facturx: { valid: true, xmlOnly: true },
    zugferd: { valid: true, xmlOnly: true },
  },
};

// ---------------------------------------------------------------------------
// Fixture 6: B2C — individual consumer
// ---------------------------------------------------------------------------
export const B2C_INDIVIDUAL: FormatFixture = {
  slug: 'b2c-individual',
  description: 'B2C individual consumer, FR, 20 % VAT',
  data: {
    rawNumber: 'INV-2025-B2C-001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Dupont Consulting SARL',
      description: 'IT consulting',
      foundedAt: new Date('2018-03-01'),
      currency: 'EUR',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: FR_COMPANY_PARTY,
    },
    client: {
      type: 'INDIVIDUAL',
      name: '',
      description: null,
      foundedAt: null,
      contactFirstname: 'Jean',
      contactLastname: 'Dupont',
      salutation: 'Mr',
      sex: 'male',
      title: null,
      isActive: true,
      address: '45 Rue du Faubourg',
      city: 'Marseille',
      postalCode: '13001',
      country: 'France',
      partyIdentifiers: [],
    },
    items: [
      { name: 'Formation en ligne', quantity: 1, unitPrice: 299, vatRate: 20, type: 'SERVICE' },
      { name: 'Support prioritaire (3 mois)', quantity: 1, unitPrice: 49, vatRate: 20, type: 'SERVICE' },
    ],
  },
  formats: {
    ubl: { valid: true },
    cii: { valid: true, xmlOnly: true },
    xrechnung: {
      valid: false,
      knownGap: ['BR-DE-11', 'BR-DE-12', 'BR-DE-13', 'BR-DE-14'],
    },
    facturx: { valid: true, xmlOnly: true },
    zugferd: { valid: true, xmlOnly: true },
  },
};

// ---------------------------------------------------------------------------
// All fixtures — ordered for the harness
// ---------------------------------------------------------------------------
export const FIXTURES: FormatFixture[] = [
  FR_B2B_STANDARD,
  FR_B2B_MULTI_VAT,
  FR_B2B_DISCOUNT,
  DE_B2B,
  EU_B2B_REVERSE_CHARGE,
  B2C_INDIVIDUAL,
];
