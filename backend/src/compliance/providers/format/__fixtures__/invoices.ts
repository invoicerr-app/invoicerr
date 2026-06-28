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

// Fixture 12: CL B2B — Chile DTE (SII)
// ---------------------------------------------------------------------------
export const CL_B2B: FormatFixture = {
  slug: 'cl-b2b',
  description: 'Chilean B2B, DTE (SII) e-invoice',
  data: {
    rawNumber: 'DTE-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'SpA Soluciones',
      description: 'Tech services',
      foundedAt: new Date('2015-01-15'),
      currency: 'CLP',
      address: 'Av. Providencia 123',
      city: 'Santiago',
      postalCode: '7500000',
      country: 'Chile',
      partyIdentifiers: [
        { scheme: 'VAT', value: '76123456-7' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Importadora del Sur',
      description: 'Import/export',
      foundedAt: new Date('2010-05-20'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Calle Los Leones 456',
      city: 'Santiago',
      postalCode: '7500001',
      country: 'Chile',
      partyIdentifiers: [
        { scheme: 'VAT', value: '87654321-0' },
      ],
    },
    items: [
      { name: 'Consultoría IT', quantity: 10, unitPrice: 50000, vatRate: 19, type: 'SERVICE' },
      { name: 'Licencia software', quantity: 5, unitPrice: 120000, vatRate: 19, type: 'GOODS' },
    ],
  },
  formats: {},
};

// Fixture 13: AR B2B — Argentina Factura Electronica (AFIP/ARCA)
// ---------------------------------------------------------------------------
export const AR_B2B: FormatFixture = {
  slug: 'ar-b2b',
  description: 'Argentine B2B, Factura Electronica (AFIP/ARCA)',
  data: {
    rawNumber: 'FE-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Tecnología SRL',
      description: 'Software development',
      foundedAt: new Date('2012-09-01'),
      currency: 'ARS',
      address: 'Av. Corrientes 1000',
      city: 'Buenos Aires',
      postalCode: 'C1043',
      country: 'Argentina',
      partyIdentifiers: [
        { scheme: 'VAT', value: '30-71234567-9' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Comercial Norte SA',
      description: 'Distribution',
      foundedAt: new Date('2005-11-15'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Av. Santa Fe 2000',
      city: 'Buenos Aires',
      postalCode: 'C1123',
      country: 'Argentina',
      partyIdentifiers: [
        { scheme: 'VAT', value: '30-98765432-1' },
      ],
    },
    items: [
      { name: 'Desarrollo web', quantity: 80, unitPrice: 15000, vatRate: 21, type: 'SERVICE' },
      { name: 'Soporte técnico', quantity: 20, unitPrice: 8000, vatRate: 21, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// Fixture 14: EC B2B — Ecuador Factura Electronica (SRI)
// ---------------------------------------------------------------------------
export const EC_B2B: FormatFixture = {
  slug: 'ec-b2b',
  description: 'Ecuadorian B2B, Factura Electronica (SRI)',
  data: {
    rawNumber: 'FE-EC-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Ecuatoriana de Servicios SA',
      description: 'IT consulting',
      foundedAt: new Date('2014-03-22'),
      currency: 'USD',
      address: 'Av. Amazonas N36-50',
      city: 'Quito',
      postalCode: '170135',
      country: 'Ecuador',
      partyIdentifiers: [
        { scheme: 'VAT', value: '1792345678001' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Constructora Andina Cía Ltda',
      description: 'Construction',
      foundedAt: new Date('2008-07-10'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Av. Eloy Alfaro 1234',
      city: 'Quito',
      postalCode: '170201',
      country: 'Ecuador',
      partyIdentifiers: [
        { scheme: 'VAT', value: '1798765432001' },
      ],
    },
    items: [
      { name: 'Servicios de consultoría', quantity: 40, unitPrice: 85, vatRate: 15, type: 'SERVICE' },
      { name: 'Licencias anuales', quantity: 10, unitPrice: 250, vatRate: 15, type: 'GOODS' },
    ],
  },
  formats: {},
};

// Fixture 15: BR B2B — Brazil NF-e/NFS-e (SEFAZ)
// ---------------------------------------------------------------------------
export const BR_B2B: FormatFixture = {
  slug: 'br-b2b',
  description: 'Brazilian B2B, NF-e (SEFAZ) e-invoice',
  data: {
    rawNumber: 'NF-e-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Tech Brasil Ltda',
      description: 'Software house',
      foundedAt: new Date('2013-04-10'),
      currency: 'BRL',
      address: 'Av. Paulista 1000',
      city: 'São Paulo',
      postalCode: '01310-100',
      country: 'Brazil',
      partyIdentifiers: [
        { scheme: 'VAT', value: '12.345.678/0001-90' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Comércio Digital ME',
      description: 'E-commerce',
      foundedAt: new Date('2019-08-05'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Rua das Flores 500',
      city: 'Porto Alegre',
      postalCode: '90010-300',
      country: 'Brazil',
      partyIdentifiers: [
        { scheme: 'VAT', value: '98.765.432/0001-10' },
      ],
    },
    items: [
      { name: 'Desenvolvimento de sistema', quantity: 1, unitPrice: 25000, vatRate: 17, type: 'SERVICE' },
      { name: 'Suporte mensal', quantity: 3, unitPrice: 2000, vatRate: 17, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// Fixture 16: TR B2B — Turkey e-Fatura (GİB)
// ---------------------------------------------------------------------------
export const TR_B2B: FormatFixture = {
  slug: 'tr-b2b',
  description: 'Turkish B2B, e-Fatura (GİB)',
  data: {
    rawNumber: 'EF-2025-001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Teknoloji A.Ş.',
      description: 'Software & consulting',
      foundedAt: new Date('2011-06-15'),
      currency: 'TRY',
      address: 'Bağdat Caddesi 100',
      city: 'Istanbul',
      postalCode: '34000',
      country: 'Turkey',
      partyIdentifiers: [
        { scheme: 'VAT', value: '1234567890' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'İthalat Ticaret Ltd. Şti.',
      description: 'Trading',
      foundedAt: new Date('2009-12-01'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'İstiklal Caddesi 200',
      city: 'Istanbul',
      postalCode: '34430',
      country: 'Turkey',
      partyIdentifiers: [
        { scheme: 'VAT', value: '0987654321' },
      ],
    },
    items: [
      { name: 'Yazılım geliştirme', quantity: 120, unitPrice: 500, vatRate: 20, type: 'SERVICE' },
      { name: 'Eğitim hizmeti', quantity: 5, unitPrice: 8000, vatRate: 20, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// Fixture 17: IN B2B — India IRP (GST e-Invoice)
// ---------------------------------------------------------------------------
export const IN_B2B: FormatFixture = {
  slug: 'in-b2b',
  description: 'Indian B2B, GST e-Invoice (IRP)',
  data: {
    rawNumber: 'INV-2025-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'InfoTech Pvt Ltd',
      description: 'IT services',
      foundedAt: new Date('2014-02-20'),
      currency: 'INR',
      address: 'Plot 42, Sector 5',
      city: 'Gurugram',
      postalCode: '122001',
      country: 'India',
      partyIdentifiers: [
        { scheme: 'VAT', value: '06AABCT1234F1Z5' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Global Solutions Ltd',
      description: 'Enterprise',
      foundedAt: new Date('2006-08-10'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Tower B, Floor 12',
      city: 'Mumbai',
      postalCode: '400001',
      country: 'India',
      partyIdentifiers: [
        { scheme: 'VAT', value: '27AAACG9876E1Z9' },
      ],
    },
    items: [
      { name: 'Software development services', quantity: 200, unitPrice: 5000, vatRate: 18, type: 'SERVICE' },
      { name: 'Annual maintenance', quantity: 12, unitPrice: 10000, vatRate: 18, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// Fixture 18: GR B2B — Greece myDATA (AADE)
// ---------------------------------------------------------------------------
export const GR_B2B: FormatFixture = {
  slug: 'gr-b2b',
  description: 'Greek B2B, myDATA (AADE) e-invoice',
  data: {
    rawNumber: 'MYP-2025-001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Ελληνική Τεχνολογία AE',
      description: 'IT services',
      foundedAt: new Date('2013-05-10'),
      currency: 'EUR',
      address: 'Leof. Syngrou 50',
      city: 'Athens',
      postalCode: '11737',
      country: 'Greece',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'EL801234567' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Διεθνής Εμπορική ΑΕ',
      description: 'Trading',
      foundedAt: new Date('2009-11-20'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Ermou 100',
      city: 'Athens',
      postalCode: '10557',
      country: 'Greece',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'EL987654321' },
      ],
    },
    items: [
      { name: 'Ανάπτυξη λογισμικού', quantity: 60, unitPrice: 100, vatRate: 24, type: 'SERVICE' },
      { name: 'Υποστήριξη συστημάτων', quantity: 10, unitPrice: 500, vatRate: 24, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// Fixture 19: HU B2B — Hungary Online Számla (NAV)
// ---------------------------------------------------------------------------
export const HU_B2B: FormatFixture = {
  slug: 'hu-b2b',
  description: 'Hungarian B2B, Online Számla (NAV)',
  data: {
    rawNumber: 'SZLA-2025-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Magyar IT Kft.',
      description: 'Software development',
      foundedAt: new Date('2012-03-15'),
      currency: 'HUF',
      address: 'Váci út 42',
      city: 'Budapest',
      postalCode: '1132',
      country: 'Hungary',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'HU12345678' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Nagy Kereskedelmi Zrt.',
      description: 'Wholesale',
      foundedAt: new Date('2006-08-22'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Andrássy út 200',
      city: 'Budapest',
      postalCode: '1061',
      country: 'Hungary',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'HU87654321' },
      ],
    },
    items: [
      { name: 'Szoftverfejlesztés (Software dev)', quantity: 100, unitPrice: 15000, vatRate: 27, type: 'SERVICE' },
      { name: 'Karbantartás (Maintenance)', quantity: 6, unitPrice: 50000, vatRate: 27, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// Fixture 20: CN B2B — China e-Fapiao (Golden Tax IV)
// ---------------------------------------------------------------------------
export const CN_B2B: FormatFixture = {
  slug: 'cn-b2b',
  description: 'Chinese B2B, e-Fapiao (Golden Tax System IV)',
  data: {
    rawNumber: 'FAP-2025-0001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: '北京科技有限公司',
      description: 'Technology',
      foundedAt: new Date('2010-06-15'),
      currency: 'CNY',
      address: '朝阳区建国路88号',
      city: 'Beijing',
      postalCode: '100022',
      country: 'China',
      partyIdentifiers: [
        { scheme: 'VAT', value: '91110000MA01XXXXX' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: '上海贸易有限公司',
      description: 'Trading',
      foundedAt: new Date('2008-03-20'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: '浦东新区陆家嘴100号',
      city: 'Shanghai',
      postalCode: '200120',
      country: 'China',
      partyIdentifiers: [
        { scheme: 'VAT', value: '91310000MA01YYYYY' },
      ],
    },
    items: [
      { name: '软件开发服务', quantity: 1, unitPrice: 80000, vatRate: 13, type: 'SERVICE' },
      { name: '年度维护', quantity: 12, unitPrice: 5000, vatRate: 13, type: 'SERVICE' },
    ],
  },
  formats: {},
};

// Fixture 21: EG B2B — Egypt ETA e-invoice
// ---------------------------------------------------------------------------
export const EG_B2B: FormatFixture = {
  slug: 'eg-b2b',
  description: 'Egyptian B2B, ETA e-invoice',
  data: {
    rawNumber: 'ETA-2025-001',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Arab Digital Solutions',
      description: 'IT services',
      foundedAt: new Date('2015-09-01'),
      currency: 'EGP',
      address: '5th Settlement, New Cairo',
      city: 'Cairo',
      postalCode: '11835',
      country: 'Egypt',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'EG-123456789' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Delta Commerce Co.',
      description: 'Import/export',
      foundedAt: new Date('2011-04-10'),
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Alexandria Corniche',
      city: 'Alexandria',
      postalCode: '21599',
      country: 'Egypt',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'EG-987654321' },
      ],
    },
    items: [
      { name: 'System development', quantity: 1, unitPrice: 120000, vatRate: 14, type: 'SERVICE' },
      { name: 'Technical support', quantity: 6, unitPrice: 15000, vatRate: 14, type: 'SERVICE' },
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
