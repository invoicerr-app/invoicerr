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
// Fixture 7: IT B2B — FatturaPA (IT domestic)
// ---------------------------------------------------------------------------
export const IT_B2B: FormatFixture = {
  slug: 'it-b2b',
  description: 'Italian B2B, FatturaPA 1.2',
  data: {
    rawNumber: 'FT-2025-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Rossi SRL',
      description: 'IT services',
      foundedAt: new Date('2015-04-10'),
      currency: 'EUR',
      address: 'Via Roma 10',
      city: 'Milano',
      postalCode: '20100',
      country: 'Italy',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'IT12345678901' },
        { scheme: 'LEGAL_ID', value: 'MI1234567' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Bianchi SpA',
      description: 'Manufacturing client',
      foundedAt: new Date('2000-01-15'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Corso Italia 20',
      city: 'Roma',
      postalCode: '00100',
      country: 'Italy',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'IT98765432109' },
        { scheme: 'LEGAL_ID', value: 'RM7654321' },
      ],
    },
    items: [
      { name: 'Consulenza tecnica', quantity: 20, unitPrice: 150, vatRate: 22, type: 'SERVICE' },
      { name: 'Assistenza remota', quantity: 5, unitPrice: 80, vatRate: 22, type: 'HOUR' },
    ],
  },
  formats: {
    // National format tests added in national-format-validation.spec.ts
  },
};

// ---------------------------------------------------------------------------
// Fixture 8: MX B2B — CFDI 4.0 (MX domestic)
// ---------------------------------------------------------------------------
export const MX_B2B: FormatFixture = {
  slug: 'mx-b2b',
  description: 'Mexican B2B, CFDI 4.0 pre-stamp',
  data: {
    rawNumber: 'CFDI-2025-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Tech Solutions SA de CV',
      description: 'Software development',
      foundedAt: new Date('2017-06-01'),
      currency: 'MXN',
      address: 'Av Reforma 500',
      city: 'Ciudad de Mexico',
      postalCode: '06000',
      country: 'Mexico',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'TST101010100' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Comercializadora Lopez SA de CV',
      description: 'Distribution client',
      foundedAt: new Date('2005-03-20'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Blvd Insurgentes 300',
      city: 'Guadalajara',
      postalCode: '44100',
      country: 'Mexico',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'LOP8501011A9' },
      ],
    },
    items: [
      { name: 'Licencia software anual', quantity: 10, unitPrice: 5000, vatRate: 16, type: 'PRODUCT' },
      { name: 'Soporte técnico mensual', quantity: 3, unitPrice: 2000, vatRate: 16, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// ---------------------------------------------------------------------------
// Fixture 9: ES B2B — Facturae 3.2.2 (ES domestic)
// ---------------------------------------------------------------------------
export const ES_B2B: FormatFixture = {
  slug: 'es-b2b',
  description: 'Spanish B2B, Facturae 3.2.2',
  data: {
    rawNumber: 'FAC-2025-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Garcia Consultores SL',
      description: 'Management consulting',
      foundedAt: new Date('2012-09-15'),
      currency: 'EUR',
      address: 'Calle Gran Via 40',
      city: 'Barcelona',
      postalCode: '08015',
      country: 'Spain',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'ES12345678A' },
        { scheme: 'LEGAL_ID', value: 'B12345678' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Fernandez Industrial SA',
      description: 'Manufacturing client',
      foundedAt: new Date('1998-05-01'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Paseo de la Castellana 100',
      city: 'Madrid',
      postalCode: '28046',
      country: 'Spain',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'ES87654321B' },
        { scheme: 'LEGAL_ID', value: 'B87654321' },
      ],
    },
    items: [
      { name: 'Auditoría de sistemas', quantity: 1, unitPrice: 8000, vatRate: 21, type: 'SERVICE' },
      { name: 'Consultoría fiscal', quantity: 10, unitPrice: 200, vatRate: 21, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// ---------------------------------------------------------------------------
// Fixture 10: SA B2B — KSA UBL 2.1 (SA/ZATCA)
// ---------------------------------------------------------------------------
export const SA_B2B: FormatFixture = {
  slug: 'sa-b2b',
  description: 'Saudi B2B, KSA UBL 2.1 + QR',
  data: {
    rawNumber: 'INV-2025-SA-001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Al Faisal Trading Co',
      description: 'Import/export',
      foundedAt: new Date('2010-01-01'),
      currency: 'SAR',
      address: 'King Fahd Road 100',
      city: 'Riyadh',
      postalCode: '11564',
      country: 'Saudi Arabia',
      partyIdentifiers: [
        { scheme: 'VAT', value: '310123456700003' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Saudi Tech Solutions Ltd',
      description: 'IT services',
      foundedAt: new Date('2015-06-15'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Olaya Street 50',
      city: 'Riyadh',
      postalCode: '12211',
      country: 'Saudi Arabia',
      partyIdentifiers: [
        { scheme: 'VAT', value: '310987654300003' },
      ],
    },
    items: [
      { name: 'استشارات تقنية (Technical consulting)', quantity: 15, unitPrice: 500, vatRate: 15, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// ---------------------------------------------------------------------------
// Fixture 11: PL B2B — FA_VAT (PL/KSeF)
// ---------------------------------------------------------------------------
export const PL_B2B: FormatFixture = {
  slug: 'pl-b2b',
  description: 'Polish B2B, FA_VAT (FA(2)) for KSeF',
  data: {
    rawNumber: 'FV-2025-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Kowalski sp. z o.o.',
      description: 'IT solutions',
      foundedAt: new Date('2011-07-01'),
      currency: 'PLN',
      address: 'ul. Marszałkowska 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'Poland',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'PL1234567890' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Nowak Trading Sp. z o.o.',
      description: 'Wholesale',
      foundedAt: new Date('2008-03-10'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'ul. Złota 5',
      city: 'Kraków',
      postalCode: '31-010',
      country: 'Poland',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'PL0987654321' },
      ],
    },
    items: [
      { name: 'Usługi IT (IT services)', quantity: 40, unitPrice: 200, vatRate: 23, type: 'SERVICE' },
      { name: 'Szkolenie (Training)', quantity: 2, unitPrice: 3000, vatRate: 23, type: 'SERVICE' },
    ],
  },
  formats: {},
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
