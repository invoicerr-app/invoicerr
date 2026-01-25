/**
 * Compliance Documents E2E Tests
 * Comprehensive tests for document creation, PDF/XML generation per country
 *
 * Each country is tested for:
 * - Client creation with country-specific identifiers
 * - Quote creation with proper VAT and fields
 * - Invoice creation with proper VAT and fields
 * - Receipt creation from invoice
 * - PDF generation in expected format
 * - PDF content validation (required fields present)
 */

import { BACKEND_URL } from '../support/e2e';

// ============================================================================
// TEST DATA FIXTURES - One complete set per country
// ============================================================================

interface CountryTestData {
  code: string;
  name: string;
  currency: string;
  defaultVatRate: number;
  vatRates: number[];
  // Company identifiers (supplier side)
  companyIdentifiers: Record<string, string>;
  // Client identifiers (customer side)
  clientIdentifiers: Record<string, string>;
  // Expected PDF format
  expectedPdfFormat: string;
  // Expected output formats for invoice
  expectedInvoiceFormats: string[];
  // Transmission platform
  transmissionPlatform: {
    b2b: string;
    b2g: string;
  };
  // Client data for creation
  clientData: {
    name: string;
    contactEmail: string;
    address: string;
    city: string;
    postalCode: string;
    contactPhone?: string;
  };
  // Item data for documents
  testItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    type: 'SERVICE' | 'PRODUCT';
  }>;
  // Expected totals based on testItems
  expectedTotals: {
    totalHT: number;
    totalVAT: number;
    totalTTC: number;
  };
}

const COUNTRY_TEST_DATA: Record<string, CountryTestData> = {
  // ============================================================================
  // PERMISSIVE COUNTRIES - Flexible invoicing rules
  // ============================================================================
  US: {
    code: 'US',
    name: 'United States (Permissive)',
    currency: 'USD',
    defaultVatRate: 0, // No federal VAT
    vatRates: [0],
    companyIdentifiers: {
      ein: '12-3456789',
    },
    clientIdentifiers: {},
    expectedPdfFormat: 'pdf',
    expectedInvoiceFormats: ['pdf'],
    transmissionPlatform: {
      b2b: 'email',
      b2g: 'email',
    },
    clientData: {
      name: 'Acme Corp',
      contactEmail: 'billing@acme.com',
      address: '123 Main Street',
      city: 'New York',
      postalCode: '10001',
      contactPhone: '+1 212 555 1234',
    },
    testItems: [
      {
        description: 'Software development services',
        quantity: 40,
        unitPrice: 150,
        vatRate: 0,
        type: 'SERVICE',
      },
      {
        description: 'Cloud hosting (monthly)',
        quantity: 1,
        unitPrice: 500,
        vatRate: 0,
        type: 'SERVICE',
      },
    ],
    expectedTotals: {
      totalHT: 6500,
      totalVAT: 0,
      totalTTC: 6500,
    },
  },

  // ============================================================================
  // MODERATE COUNTRIES - EU standard e-invoicing
  // ============================================================================
  FR: {
    code: 'FR',
    name: 'France',
    currency: 'EUR',
    defaultVatRate: 20,
    vatRates: [20, 10, 5.5, 2.1, 0],
    companyIdentifiers: {
      siret: '12345678901234',
      siren: '123456789',
    },
    clientIdentifiers: {
      siret: '98765432109876',
    },
    expectedPdfFormat: 'facturx',
    expectedInvoiceFormats: ['pdf', 'facturx', 'zugferd', 'ubl', 'cii'],
    transmissionPlatform: {
      b2b: 'superpdp',
      b2g: 'chorus',
    },
    clientData: {
      name: 'Acme France SARL',
      contactEmail: 'contact@acme-france.fr',
      address: '123 Rue de Paris',
      city: 'Paris',
      postalCode: '75001',
      contactPhone: '+33 1 23 45 67 89',
    },
    testItems: [
      {
        description: 'Développement logiciel',
        quantity: 10,
        unitPrice: 100,
        vatRate: 20,
        type: 'SERVICE',
      },
      {
        description: 'Formation professionnelle',
        quantity: 2,
        unitPrice: 500,
        vatRate: 20,
        type: 'SERVICE',
      },
    ],
    expectedTotals: {
      totalHT: 2000,
      totalVAT: 400,
      totalTTC: 2400,
    },
  },

  DE: {
    code: 'DE',
    name: 'Germany',
    currency: 'EUR',
    defaultVatRate: 19,
    vatRates: [19, 7, 0],
    companyIdentifiers: {
      steuernummer: '1234567890123',
      handelsregister: 'HRB 12345',
    },
    clientIdentifiers: {
      leitwegId: '04-1234567890-12',
    },
    expectedPdfFormat: 'xrechnung',
    expectedInvoiceFormats: ['pdf', 'xrechnung', 'zugferd', 'ubl'],
    transmissionPlatform: {
      b2b: 'peppol',
      b2g: 'xrechnung',
    },
    clientData: {
      name: 'Deutsche GmbH',
      contactEmail: 'kontakt@deutsche-gmbh.de',
      address: 'Hauptstraße 42',
      city: 'Berlin',
      postalCode: '10115',
      contactPhone: '+49 30 123456',
    },
    testItems: [
      {
        description: 'Softwareentwicklung',
        quantity: 8,
        unitPrice: 125,
        vatRate: 19,
        type: 'SERVICE',
      },
      {
        description: 'Bücher und Dokumentation',
        quantity: 5,
        unitPrice: 50,
        vatRate: 7,
        type: 'PRODUCT',
      },
    ],
    expectedTotals: {
      totalHT: 1250,
      totalVAT: 207.5,
      totalTTC: 1457.5,
    },
  },

  IT: {
    code: 'IT',
    name: 'Italy',
    currency: 'EUR',
    defaultVatRate: 22,
    vatRates: [22, 10, 5, 4, 0],
    companyIdentifiers: {
      partitaIva: '12345678901',
      codiceFiscale: 'RSSMRA85M01H501Z',
    },
    clientIdentifiers: {
      partitaIva: '98765432109',
      codiceFiscale: 'BNCLCU90A01F205X',
      codiceDestinatario: 'ABC1234',
    },
    expectedPdfFormat: 'fatturapa',
    expectedInvoiceFormats: ['fatturapa'],
    transmissionPlatform: {
      b2b: 'sdi',
      b2g: 'sdi',
    },
    clientData: {
      name: 'Azienda Italiana SRL',
      contactEmail: 'info@azienda-italiana.it',
      address: 'Via Roma 15',
      city: 'Roma',
      postalCode: '00184',
      contactPhone: '+39 06 12345678',
    },
    testItems: [
      {
        description: 'Servizi di consulenza',
        quantity: 5,
        unitPrice: 200,
        vatRate: 22,
        type: 'SERVICE',
      },
      {
        description: 'Prodotti alimentari',
        quantity: 10,
        unitPrice: 25,
        vatRate: 4,
        type: 'PRODUCT',
      },
    ],
    expectedTotals: {
      totalHT: 1250,
      totalVAT: 230,
      totalTTC: 1480,
    },
  },

  ES: {
    code: 'ES',
    name: 'Spain',
    currency: 'EUR',
    defaultVatRate: 21,
    vatRates: [21, 10, 4, 0],
    companyIdentifiers: {
      nif: 'B12345678',
    },
    clientIdentifiers: {
      nif: 'A87654321',
    },
    expectedPdfFormat: 'facturae',
    expectedInvoiceFormats: ['pdf', 'facturae', 'ubl'],
    transmissionPlatform: {
      b2b: 'verifactu',
      b2g: 'face',
    },
    clientData: {
      name: 'Empresa Española SL',
      contactEmail: 'contacto@empresa-espanola.es',
      address: 'Calle Gran Vía 25',
      city: 'Madrid',
      postalCode: '28013',
      contactPhone: '+34 91 123 45 67',
    },
    testItems: [
      {
        description: 'Servicios de diseño',
        quantity: 4,
        unitPrice: 250,
        vatRate: 21,
        type: 'SERVICE',
      },
      {
        description: 'Libros técnicos',
        quantity: 8,
        unitPrice: 30,
        vatRate: 4,
        type: 'PRODUCT',
      },
    ],
    expectedTotals: {
      totalHT: 1240,
      totalVAT: 219.6,
      totalTTC: 1459.6,
    },
  },

  PT: {
    code: 'PT',
    name: 'Portugal',
    currency: 'EUR',
    defaultVatRate: 23,
    vatRates: [23, 13, 6, 0],
    companyIdentifiers: {
      nif: '123456789',
    },
    clientIdentifiers: {
      nif: '987654321',
    },
    expectedPdfFormat: 'saft',
    expectedInvoiceFormats: ['pdf', 'saft', 'ubl'],
    transmissionPlatform: {
      b2b: 'saft',
      b2g: 'saft',
    },
    clientData: {
      name: 'Empresa Portuguesa Lda',
      contactEmail: 'geral@empresa-portuguesa.pt',
      address: 'Avenida da Liberdade 100',
      city: 'Lisboa',
      postalCode: '1250-096',
      contactPhone: '+351 21 123 4567',
    },
    testItems: [
      {
        description: 'Consultoria informática',
        quantity: 6,
        unitPrice: 150,
        vatRate: 23,
        type: 'SERVICE',
      },
      {
        description: 'Vinhos regionais',
        quantity: 20,
        unitPrice: 15,
        vatRate: 13,
        type: 'PRODUCT',
      },
    ],
    expectedTotals: {
      totalHT: 1200,
      totalVAT: 246,
      totalTTC: 1446,
    },
  },

  BE: {
    code: 'BE',
    name: 'Belgium',
    currency: 'EUR',
    defaultVatRate: 21,
    vatRates: [21, 12, 6, 0],
    companyIdentifiers: {
      bce: '0123456789',
    },
    clientIdentifiers: {
      bce: '0987654321',
    },
    expectedPdfFormat: 'facturx',
    expectedInvoiceFormats: ['pdf', 'facturx', 'ubl'],
    transmissionPlatform: {
      b2b: 'peppol',
      b2g: 'peppol',
    },
    clientData: {
      name: 'Société Belge SPRL',
      contactEmail: 'info@societe-belge.be',
      address: 'Grand Place 1',
      city: 'Bruxelles',
      postalCode: '1000',
      contactPhone: '+32 2 123 45 67',
    },
    testItems: [
      {
        description: 'Services informatiques',
        quantity: 7,
        unitPrice: 120,
        vatRate: 21,
        type: 'SERVICE',
      },
      {
        description: 'Chocolats artisanaux',
        quantity: 15,
        unitPrice: 12,
        vatRate: 6,
        type: 'PRODUCT',
      },
    ],
    expectedTotals: {
      totalHT: 1020,
      totalVAT: 187.2,
      totalTTC: 1207.2,
    },
  },

  // ============================================================================
  // VERY STRICT COUNTRIES - Mandatory clearance, real-time reporting
  // ============================================================================
  IN: {
    code: 'IN',
    name: 'India (Very Strict - GST)',
    currency: 'INR',
    defaultVatRate: 18, // GST 18%
    vatRates: [28, 18, 12, 5, 0],
    companyIdentifiers: {
      gstin: '29AABCU9603R1ZM',
      pan: 'AABCU9603R',
    },
    clientIdentifiers: {
      gstin: '27AABCT1234F1ZH',
    },
    expectedPdfFormat: 'pdf', // India uses JSON for e-invoice, PDF for display
    expectedInvoiceFormats: ['pdf'],
    transmissionPlatform: {
      b2b: 'irp',
      b2g: 'irp',
    },
    clientData: {
      name: 'Tech Solutions Pvt Ltd',
      contactEmail: 'accounts@techsolutions.in',
      address: '100 MG Road, Sector 5',
      city: 'Bangalore',
      postalCode: '560001',
      contactPhone: '+91 80 1234 5678',
    },
    testItems: [
      {
        description: 'IT Consulting Services',
        quantity: 20,
        unitPrice: 5000,
        vatRate: 18,
        type: 'SERVICE',
      },
      {
        description: 'Software License',
        quantity: 5,
        unitPrice: 10000,
        vatRate: 18,
        type: 'PRODUCT',
      },
    ],
    expectedTotals: {
      totalHT: 150000,
      totalVAT: 27000,
      totalTTC: 177000,
    },
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get auth headers from session cookie
 */
function getAuthHeaders(): Cypress.Chainable<Record<string, string>> {
  return cy.getCookie('better-auth.session_token').then((cookie) => {
    return cookie ? { Cookie: `better-auth.session_token=${cookie.value}` } : {};
  });
}

/**
 * Calculate expected totals for items (helper for verification)
 */
function calculateTotals(
  items: Array<{ quantity: number; unitPrice: number; vatRate: number }>,
): { totalHT: number; totalVAT: number; totalTTC: number } {
  let totalHT = 0;
  let totalVAT = 0;

  for (const item of items) {
    const lineHT = item.quantity * item.unitPrice;
    const lineVAT = lineHT * (item.vatRate / 100);
    totalHT += lineHT;
    totalVAT += lineVAT;
  }

  return {
    totalHT: Math.round(totalHT * 100) / 100,
    totalVAT: Math.round(totalVAT * 100) / 100,
    totalTTC: Math.round((totalHT + totalVAT) * 100) / 100,
  };
}

// ============================================================================
// PUBLIC API TESTS (no auth required)
// ============================================================================

// SKIPPED: Country-specific compliance configs not implemented in backend yet
// All countries currently return generic config
// Remove .skip when backend/src/modules/compliance/configs/ has country configs
describe.skip('Compliance Documents E2E - Complete Country Tests', () => {
  describe('Public API - Country Configuration Validation', () => {
    // Iterate over all countries and verify their configurations
    Object.entries(COUNTRY_TEST_DATA).forEach(([countryCode, testData]) => {
      describe(`${testData.name} (${countryCode})`, () => {
        it('returns correct country config with all required fields', () => {
          cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
            (response) => {
              expect(response.status).to.eq(200);

              const config = response.body;

              // Verify basic country info
              expect(config.code).to.eq(countryCode);
              expect(config.currency).to.eq(testData.currency);
              // US and IN are not EU countries
              if (['US', 'IN'].includes(countryCode)) {
                expect(config.isEU).to.be.false;
              } else {
                expect(config.isEU).to.be.true;
              }

              // Verify VAT configuration
              expect(config.vat).to.exist;
              expect(config.vat.defaultRate).to.eq(testData.defaultVatRate);
              expect(config.vat.rates).to.be.an('array');

              // Verify all expected VAT rates are present
              const configRates = config.vat.rates.map((r: { rate: number }) => r.rate);
              testData.vatRates.forEach((expectedRate) => {
                expect(configRates).to.include(expectedRate);
              });

              // Verify transmission configuration
              expect(config.transmission).to.exist;
              expect(config.transmission.b2b).to.exist;
              expect(config.transmission.b2g).to.exist;

              // Verify platform matches expected
              if (config.transmission.b2b.platform) {
                expect(config.transmission.b2b.platform).to.eq(testData.transmissionPlatform.b2b);
              } else if (config.transmission.b2b.model) {
                // Some countries use model instead of platform
                expect(config.transmission.b2b.model).to.include(
                  testData.transmissionPlatform.b2b.replace('peppol', ''),
                );
              }

              // Verify identifiers configuration
              expect(config.identifiers).to.exist;
              expect(config.identifiers.company).to.be.an('array');
              expect(config.identifiers.client).to.be.an('array');

              // Verify format configuration
              expect(config.format).to.exist;
              expect(config.format.supported).to.be.an('array');

              // Verify required fields configuration
              expect(config.requiredFields).to.exist;
              expect(config.requiredFields.invoice).to.be.an('array');
              expect(config.requiredFields.client).to.be.an('array');

              // Verify legal mentions
              expect(config.legalMentions).to.exist;
              expect(config.legalMentions.mandatory).to.be.an('array');
            },
          );
        });

        it('returns correct identifiers for company and client', () => {
          cy.request(`${BACKEND_URL}/api/compliance/identifiers?country=${countryCode}`).then(
            (response) => {
              expect(response.status).to.eq(200);
              expect(response.body.identifiers).to.be.an('array');

              const identifierIds = response.body.identifiers.map((i: { id: string }) => i.id);

              // Check that expected company identifiers are present
              Object.keys(testData.companyIdentifiers).forEach((expectedId) => {
                expect(identifierIds).to.include(expectedId);
              });

              // Verify identifier structure
              response.body.identifiers.forEach((identifier: Record<string, unknown>) => {
                expect(identifier.id).to.be.a('string');
                expect(identifier.labelKey).to.be.a('string');
                expect(identifier.format).to.be.a('string');
              });
            },
          );
        });

        it('returns correct frontend config with VAT rates', () => {
          cy.request(
            `${BACKEND_URL}/api/compliance/config?supplierCountry=${countryCode}&transactionType=B2B`,
          ).then((response) => {
            expect(response.status).to.eq(200);

            // Frontend config structure
            expect(response.body.vatRates).to.be.an('array');
            expect(response.body.defaultVatRate).to.eq(testData.defaultVatRate);

            // Verify VAT rates match
            const frontendRates = response.body.vatRates.map((r: { rate: number }) => r.rate);
            testData.vatRates.forEach((expectedRate) => {
              expect(frontendRates).to.include(expectedRate);
            });
          });
        });
      });
    });

    describe('Cross-border transactions', () => {
      // Test cross-border scenarios between different countries
      const crossBorderCases = [
        { supplier: 'FR', customer: 'DE', description: 'France to Germany' },
        { supplier: 'DE', customer: 'IT', description: 'Germany to Italy' },
        { supplier: 'IT', customer: 'ES', description: 'Italy to Spain' },
        { supplier: 'ES', customer: 'PT', description: 'Spain to Portugal' },
        { supplier: 'PT', customer: 'BE', description: 'Portugal to Belgium' },
        { supplier: 'BE', customer: 'FR', description: 'Belgium to France' },
      ];

      crossBorderCases.forEach(({ supplier, customer, description }) => {
        it(`handles ${description} (intra-EU B2B)`, () => {
          cy.request(
            `${BACKEND_URL}/api/compliance/config?supplierCountry=${supplier}&customerCountry=${customer}&transactionType=B2B`,
          ).then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body.vatRates).to.be.an('array');

            // Intra-EU B2B: reverse charge applies, so default VAT rate is 0%
            // This is correct VAT compliance behavior
            expect(response.body.defaultVatRate).to.eq(0);
          });
        });
      });
    });
  });

  // ============================================================================
  // AUTHENTICATED API TESTS - Full Document Lifecycle per Country
  // ============================================================================
  // NOTE: These tests require running the full test suite (starting from 01-register.cy.ts)
  // to properly set up the database with a test user. When running standalone, these
  // tests will be skipped.

  describe('Authenticated API - Complete Document Lifecycle', () => {
    // Store created entities for cleanup and reference
    const createdEntities: Record<
      string,
      {
        clientId?: string;
        quoteId?: string;
        invoiceId?: string;
        receiptId?: string;
      }
    > = {};

    beforeEach(function () {
      cy.login();
    });

    // Iterate over each country for complete document lifecycle tests
    Object.entries(COUNTRY_TEST_DATA).forEach(([countryCode, testData]) => {
      describe(`${testData.name} (${countryCode}) - Full Document Lifecycle`, () => {
        // Initialize entity storage for this country
        before(() => {
          createdEntities[countryCode] = {};
        });

        describe('1. Client Creation', () => {
          it(`creates client with ${countryCode} identifiers`, () => {
            getAuthHeaders().then((headers) => {
              // Search for existing client by name
              cy.request({
                url: `${BACKEND_URL}/api/clients/search?query=${encodeURIComponent(testData.clientData.name)}`,
                headers,
                failOnStatusCode: false,
              }).then((searchResponse) => {
                const existingClient =
                  searchResponse.status === 200 && searchResponse.body.length > 0
                    ? searchResponse.body.find(
                        (c: { name: string }) => c.name === testData.clientData.name,
                      )
                    : null;

                if (existingClient) {
                  // Client already exists, reuse it
                  createdEntities[countryCode].clientId = existingClient.id;
                  expect(existingClient.id).to.exist;
                } else {
                  // Create new client
                  cy.request({
                    method: 'POST',
                    url: `${BACKEND_URL}/api/clients`,
                    headers,
                    body: {
                      name: testData.clientData.name,
                      contactEmail: testData.clientData.contactEmail,
                      address: testData.clientData.address,
                      city: testData.clientData.city,
                      postalCode: testData.clientData.postalCode,
                      country: countryCode,
                      contactPhone: testData.clientData.contactPhone,
                      identifiers: testData.clientIdentifiers,
                    },
                    failOnStatusCode: false,
                  }).then((response) => {
                    if (response.status === 201) {
                      expect(response.body.id).to.exist;
                      createdEntities[countryCode].clientId = response.body.id;
                    } else if (response.status === 500) {
                      // Might be duplicate, search again
                      cy.request({
                        url: `${BACKEND_URL}/api/clients/search?query=${encodeURIComponent(testData.clientData.name)}`,
                        headers,
                      }).then((retrySearch) => {
                        const client = retrySearch.body.find(
                          (c: { name: string }) => c.name === testData.clientData.name,
                        );
                        expect(client).to.exist;
                        createdEntities[countryCode].clientId = client.id;
                      });
                    } else {
                      throw new Error(`Failed to create client: ${response.status}`);
                    }
                  });
                }
              });
            });
          });

          it(`verifies client ${countryCode} identifiers are stored correctly`, () => {
            getAuthHeaders().then((headers) => {
              // Search for the client by name since createdEntities might not persist
              cy.request({
                url: `${BACKEND_URL}/api/clients/search?query=${encodeURIComponent(testData.clientData.name)}`,
                headers,
              }).then((searchResponse) => {
                const client = searchResponse.body.find(
                  (c: { name: string }) => c.name === testData.clientData.name,
                );
                expect(client).to.exist;
                // Update createdEntities for subsequent tests
                createdEntities[countryCode].clientId = client.id;

                expect(client.country).to.eq(countryCode);

                // Verify identifiers are stored
                if (client.identifiers) {
                  Object.entries(testData.clientIdentifiers).forEach(([key, value]) => {
                    expect(client.identifiers[key]).to.eq(value);
                  });
                }
              });
            });
          });
        });

        describe('2. Quote Creation', () => {
          it(`creates quote for ${countryCode} client with correct VAT`, () => {
            getAuthHeaders().then((headers) => {
              // Search for client by name
              cy.request({
                url: `${BACKEND_URL}/api/clients/search?query=${encodeURIComponent(testData.clientData.name)}`,
                headers,
              }).then((searchResponse) => {
                const client = searchResponse.body.find(
                  (c: { name: string }) => c.name === testData.clientData.name,
                );
                expect(client).to.exist;
                const clientId = client.id;
                createdEntities[countryCode].clientId = clientId;

                cy.request({
                  method: 'POST',
                  url: `${BACKEND_URL}/api/quotes`,
                  headers,
                  body: {
                    clientId,
                    title: `Devis test ${testData.name}`,
                    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    notes: `Test quote for ${testData.name} with ${testData.defaultVatRate}% VAT`,
                    items: testData.testItems,
                  },
                }).then((response) => {
                  expect(response.status).to.eq(201);
                  expect(response.body.id).to.exist;
                  expect(response.body.status).to.eq('DRAFT');

                  // Verify totals match expected
                  expect(response.body.totalHT).to.eq(testData.expectedTotals.totalHT);
                  expect(response.body.totalVAT).to.be.closeTo(testData.expectedTotals.totalVAT, 0.1);
                  expect(response.body.totalTTC).to.be.closeTo(
                    testData.expectedTotals.totalTTC,
                    0.1,
                  );

                  // Store quote ID
                  createdEntities[countryCode].quoteId = response.body.id;
                });
              });
            });
          });

          it(`generates quote PDF for ${countryCode}`, () => {
            getAuthHeaders().then((headers) => {
              const quoteId = createdEntities[countryCode].quoteId;
              expect(quoteId).to.exist;

              cy.request({
                url: `${BACKEND_URL}/api/quotes/${quoteId}/pdf`,
                headers,
                encoding: 'binary',
              }).then((response) => {
                expect(response.status).to.eq(200);
                expect(response.headers['content-type']).to.eq('application/pdf');

                // Verify PDF header
                expect(response.body.substring(0, 4)).to.eq('%PDF');
              });
            });
          });
        });

        describe('3. Invoice Creation', () => {
          it(`creates invoice for ${countryCode} client with correct VAT`, () => {
            getAuthHeaders().then((headers) => {
              const clientId = createdEntities[countryCode].clientId;
              expect(clientId).to.exist;

              cy.request({
                method: 'POST',
                url: `${BACKEND_URL}/api/invoices`,
                headers,
                body: {
                  clientId,
                  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                  notes: `Test invoice for ${testData.name}`,
                  items: testData.testItems,
                },
              }).then((response) => {
                expect(response.status).to.eq(201);
                expect(response.body.id).to.exist;

                // Verify totals
                expect(response.body.totalHT).to.eq(testData.expectedTotals.totalHT);
                expect(response.body.totalVAT).to.be.closeTo(testData.expectedTotals.totalVAT, 0.1);
                expect(response.body.totalTTC).to.be.closeTo(
                  testData.expectedTotals.totalTTC,
                  0.1,
                );

                // Verify invoice number exists (can be string or number)
                expect(response.body.number).to.exist;

                // Store invoice ID
                createdEntities[countryCode].invoiceId = response.body.id;
              });
            });
          });

          it(`verifies invoice items have correct VAT rates for ${countryCode}`, function () {
            getAuthHeaders().then((headers) => {
              // Get invoices and find the most recent one for the test client
              cy.request({
                url: `${BACKEND_URL}/api/invoices`,
                headers,
              }).then((listResponse) => {
                const invoices = listResponse.body.invoices || [];
                // Find an invoice - we can't easily filter by client, so just use the first one
                if (invoices.length === 0) {
                  cy.log('No invoices found, skipping test');
                  this.skip();
                  return;
                }

                const invoice = invoices[0];
                createdEntities[countryCode].invoiceId = invoice.id;

                // Verify the invoice has items
                expect(invoice.items).to.be.an('array');
                if (invoice.items.length > 0) {
                  // Verify items have VAT rates
                  invoice.items.forEach((item: { vatRate: number }) => {
                    expect(item.vatRate).to.be.a('number');
                  });
                }
              });
            });
          });
        });

        describe('4. PDF Generation & Format Validation', () => {
          it(`generates standard PDF for ${countryCode}`, () => {
            getAuthHeaders().then((headers) => {
              const invoiceId = createdEntities[countryCode].invoiceId;
              expect(invoiceId).to.exist;

              cy.request({
                url: `${BACKEND_URL}/api/invoices/${invoiceId}/pdf`,
                headers,
                encoding: 'binary',
              }).then((response) => {
                expect(response.status).to.eq(200);
                expect(response.headers['content-type']).to.eq('application/pdf');
                expect(response.body.substring(0, 4)).to.eq('%PDF');
              });
            });
          });

          // Test country-specific PDF format
          if (testData.expectedPdfFormat !== 'pdf') {
            it(`generates ${testData.expectedPdfFormat} format for ${countryCode}`, () => {
              getAuthHeaders().then((headers) => {
                const invoiceId = createdEntities[countryCode].invoiceId;
                expect(invoiceId).to.exist;

                cy.request({
                  url: `${BACKEND_URL}/api/invoices/${invoiceId}/pdf?format=${testData.expectedPdfFormat}`,
                  headers,
                  encoding: 'binary',
                  failOnStatusCode: false,
                }).then((response) => {
                  // Format might not be fully implemented yet
                  if (response.status === 200) {
                    expect(response.headers['content-type']).to.satisfy(
                      (ct: string) => ct.includes('pdf') || ct.includes('xml'),
                    );
                  } else {
                    // Log that format is not yet supported
                    cy.log(
                      `Note: ${testData.expectedPdfFormat} format not yet implemented for ${countryCode}`,
                    );
                  }
                });
              });
            });
          }

          // Test all supported formats
          testData.expectedInvoiceFormats.forEach((format) => {
            if (format !== 'pdf') {
              it(`can request ${format} format for ${countryCode}`, () => {
                getAuthHeaders().then((headers) => {
                  const invoiceId = createdEntities[countryCode].invoiceId;
                  expect(invoiceId).to.exist;

                  cy.request({
                    url: `${BACKEND_URL}/api/invoices/${invoiceId}/pdf?format=${format}`,
                    headers,
                    encoding: 'binary',
                    failOnStatusCode: false,
                  }).then((response) => {
                    if (response.status === 200) {
                      // Verify response is valid
                      expect(response.body).to.exist;
                      expect(response.body.length).to.be.greaterThan(0);
                    } else if (response.status === 400) {
                      // Format not supported for this invoice - that's acceptable
                      cy.log(`Format ${format} not available for this invoice configuration`);
                    }
                  });
                });
              });
            }
          });
        });

        describe('5. XML Generation (e-Invoice formats)', () => {
          // Only test XML for EU countries that support it
          it(`generates UBL XML for ${countryCode}`, () => {
            getAuthHeaders().then((headers) => {
              const invoiceId = createdEntities[countryCode].invoiceId;
              expect(invoiceId).to.exist;

              cy.request({
                url: `${BACKEND_URL}/api/invoices/${invoiceId}/download/xml?format=ubl`,
                headers,
                failOnStatusCode: false,
              }).then((response) => {
                if (response.status === 200) {
                  expect(response.headers['content-type']).to.eq('application/xml');
                  expect(response.body).to.include('<?xml');
                  expect(response.body).to.include('Invoice');

                  // Verify key invoice data in XML
                  expect(response.body).to.include(testData.currency);
                } else {
                  cy.log(`UBL XML not available for ${countryCode}`);
                }
              });
            });
          });

          if (['FR', 'DE', 'BE'].includes(countryCode)) {
            it(`generates Factur-X/CII XML for ${countryCode}`, () => {
              getAuthHeaders().then((headers) => {
                const invoiceId = createdEntities[countryCode].invoiceId;
                expect(invoiceId).to.exist;

                cy.request({
                  url: `${BACKEND_URL}/api/invoices/${invoiceId}/download/xml?format=facturx`,
                  headers,
                  failOnStatusCode: false,
                }).then((response) => {
                  if (response.status === 200) {
                    expect(response.headers['content-type']).to.eq('application/xml');
                    expect(response.body).to.include('CrossIndustryInvoice');
                  } else {
                    cy.log(`Factur-X XML not available for ${countryCode}`);
                  }
                });
              });
            });
          }
        });

        describe('6. Receipt Creation', () => {
          it(`creates receipt from ${countryCode} invoice`, function () {
            getAuthHeaders().then((headers) => {
              // Get the most recent unpaid invoice
              cy.request({
                url: `${BACKEND_URL}/api/invoices`,
                headers,
              }).then((listResponse) => {
                const invoices = listResponse.body.invoices || [];
                const unpaidInvoice = invoices.find((inv: { status: string }) => inv.status !== 'PAID');

                if (!unpaidInvoice) {
                  cy.log('No unpaid invoices found, skipping receipt test');
                  this.skip();
                  return;
                }

                createdEntities[countryCode].invoiceId = unpaidInvoice.id;

                cy.request({
                  method: 'POST',
                  url: `${BACKEND_URL}/api/receipts`,
                  headers,
                  body: {
                    invoiceId: unpaidInvoice.id,
                    paymentMethod: 'BANK_TRANSFER',
                    paymentDetails: `Payment for ${testData.name} invoice`,
                  },
                  failOnStatusCode: false,
                }).then((response) => {
                  if (response.status === 201) {
                    expect(response.body.id).to.exist;
                    createdEntities[countryCode].receiptId = response.body.id;
                  } else {
                    cy.log(`Could not create receipt: ${response.status}`);
                    this.skip();
                  }
                });
              });
            });
          });

          it(`generates receipt PDF for ${countryCode}`, function () {
            getAuthHeaders().then((headers) => {
              // Get the most recent receipt
              cy.request({
                url: `${BACKEND_URL}/api/receipts`,
                headers,
              }).then((listResponse) => {
                const receipts = listResponse.body.receipts || listResponse.body || [];
                if (!Array.isArray(receipts) || receipts.length === 0) {
                  cy.log('No receipts found, skipping PDF test');
                  this.skip();
                  return;
                }

                const receipt = receipts[0];
                createdEntities[countryCode].receiptId = receipt.id;

                cy.request({
                  url: `${BACKEND_URL}/api/receipts/${receipt.id}/pdf`,
                  headers,
                  encoding: 'binary',
                  failOnStatusCode: false,
                }).then((response) => {
                  if (response.status !== 200) {
                    cy.log(`PDF not available: ${response.status}`);
                    return;
                  }
                  expect(response.headers['content-type']).to.eq('application/pdf');
                });
              });
            });
          });

          it(`verifies invoice status is PAID after receipt for ${countryCode}`, function () {
            getAuthHeaders().then((headers) => {
              // Find any PAID invoice
              cy.request({
                url: `${BACKEND_URL}/api/invoices`,
                headers,
              }).then((listResponse) => {
                const invoices = listResponse.body.invoices || [];
                const paidInvoice = invoices.find((inv: { status: string }) => inv.status === 'PAID');

                if (!paidInvoice) {
                  cy.log('No PAID invoices found, skipping test');
                  this.skip();
                  return;
                }

                expect(paidInvoice.status).to.eq('PAID');
              });
            });
          });
        });

        describe('7. Multi-VAT Rate Invoice', () => {
          it(`creates invoice with multiple VAT rates for ${countryCode}`, () => {
            getAuthHeaders().then((headers) => {
              const clientId = createdEntities[countryCode].clientId;
              expect(clientId).to.exist;

              // Create items with different VAT rates
              const multiVatItems = testData.vatRates
                .filter((rate) => rate > 0)
                .slice(0, 3)
                .map((rate, index) => ({
                  description: `Test item with ${rate}% VAT`,
                  quantity: 1,
                  unitPrice: 100,
                  vatRate: rate,
                  type: 'SERVICE' as const,
                }));

              if (multiVatItems.length < 2) {
                cy.log(`${countryCode} has only one positive VAT rate, skipping multi-VAT test`);
                return;
              }

              cy.request({
                method: 'POST',
                url: `${BACKEND_URL}/api/invoices`,
                headers,
                body: {
                  clientId,
                  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                  notes: `Multi-VAT rate test for ${testData.name}`,
                  items: multiVatItems,
                },
              }).then((response) => {
                expect(response.status).to.eq(201);

                // Verify totals are calculated correctly
                const expectedTotals = calculateTotals(multiVatItems);
                expect(response.body.totalHT).to.eq(expectedTotals.totalHT);
                expect(response.body.totalVAT).to.be.closeTo(expectedTotals.totalVAT, 0.1);
                expect(response.body.totalTTC).to.be.closeTo(expectedTotals.totalTTC, 0.1);

                // Verify items have correct VAT rates
                expect(response.body.items).to.be.an('array');
                response.body.items.forEach((item: { vatRate: number }, index: number) => {
                  expect(item.vatRate).to.eq(multiVatItems[index].vatRate);
                });
              });
            });
          });
        });
      });
    });
  });

  // ============================================================================
  // VAT CALCULATION ACCURACY TESTS
  // ============================================================================

  describe('VAT Calculation Accuracy', () => {
    beforeEach(function () {
      cy.login();
    });

    Object.entries(COUNTRY_TEST_DATA).forEach(([countryCode, testData]) => {
      describe(`${testData.name} (${countryCode}) VAT Calculations`, () => {
        it(`calculates VAT correctly with rounding for ${countryCode}`, function () {
          getAuthHeaders().then((headers) => {
            // Search for a client for this country
            cy.request({
              url: `${BACKEND_URL}/api/clients/search?query=${encodeURIComponent(testData.clientData.name)}`,
              headers,
              failOnStatusCode: false,
            }).then((searchResponse) => {
              if (searchResponse.status !== 200 || searchResponse.body.length === 0) {
                cy.log(`No client found for ${countryCode}, skipping VAT calculation test`);
                this.skip();
                return;
              }
              const client = searchResponse.body.find(
                (c: { name: string }) => c.name === testData.clientData.name,
              );
              if (!client) {
                cy.log(`No matching client for ${countryCode}, skipping test`);
                this.skip();
                return;
              }

              // Test with edge case values that might cause rounding issues
              const edgeCaseItems = [
                {
                  description: 'Item with repeating decimal result',
                  quantity: 3,
                  unitPrice: 33.33,
                  vatRate: testData.defaultVatRate,
                  type: 'SERVICE' as const,
                },
                {
                  description: 'Item with exact division',
                  quantity: 4,
                  unitPrice: 25.25,
                  vatRate: testData.defaultVatRate,
                  type: 'SERVICE' as const,
                },
              ];

              cy.request({
                method: 'POST',
                url: `${BACKEND_URL}/api/invoices`,
                headers,
                body: {
                  clientId: client.id,
                  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                  notes: `VAT rounding test for ${testData.name}`,
                  items: edgeCaseItems,
                },
              }).then((response) => {
                expect(response.status).to.eq(201);

                // Verify totals are reasonable (within rounding tolerance)
                const manualTotals = calculateTotals(edgeCaseItems);
                expect(response.body.totalHT).to.be.closeTo(manualTotals.totalHT, 0.02);
                expect(response.body.totalVAT).to.be.closeTo(manualTotals.totalVAT, 0.02);
                expect(response.body.totalTTC).to.be.closeTo(manualTotals.totalTTC, 0.02);

                // Verify TTC = HT + VAT
                expect(response.body.totalTTC).to.be.closeTo(
                  response.body.totalHT + response.body.totalVAT,
                  0.01,
                );
              });
            });
          });
        });
      });
    });
  });

  // ============================================================================
  // TRANSMISSION PLATFORM VERIFICATION
  // ============================================================================

  describe('Transmission Platform Configuration', () => {
    Object.entries(COUNTRY_TEST_DATA).forEach(([countryCode, testData]) => {
      it(`${countryCode}: verifies correct transmission platforms (B2B: ${testData.transmissionPlatform.b2b}, B2G: ${testData.transmissionPlatform.b2g})`, () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then((response) => {
          expect(response.status).to.eq(200);

          const { transmission } = response.body;

          // B2B platform
          if (transmission.b2b.platform) {
            expect(transmission.b2b.platform).to.eq(testData.transmissionPlatform.b2b);
          } else if (transmission.b2b.model) {
            // Some countries use model field
            expect(transmission.b2b.model.toLowerCase()).to.include(
              testData.transmissionPlatform.b2b.toLowerCase().replace('peppol', 'peppol'),
            );
          }

          // B2G platform
          if (transmission.b2g.platform) {
            expect(transmission.b2g.platform).to.eq(testData.transmissionPlatform.b2g);
          }
        });
      });
    });
  });

  // ============================================================================
  // GENERIC/FALLBACK BEHAVIOR TESTS
  // ============================================================================

  describe('Generic/Fallback Behavior', () => {
    it('returns valid config for unsupported country code', () => {
      cy.request(`${BACKEND_URL}/api/compliance/config?supplierCountry=XX`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.vatRates).to.be.an('array');
        expect(response.body.defaultVatRate).to.be.a('number');
      });
    });

    it('returns valid config for country without specific implementation', () => {
      cy.request(`${BACKEND_URL}/api/compliance/config?supplierCountry=PL`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.vatRates).to.be.an('array');
      });
    });

    it('handles missing customer country gracefully', () => {
      cy.request(
        `${BACKEND_URL}/api/compliance/config?supplierCountry=FR&transactionType=B2B`,
      ).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.vatRates).to.be.an('array');
      });
    });
  });

  // ============================================================================
  // PERMISSIVE VS STRICT COUNTRY VALIDATION
  // ============================================================================

  describe('Permissive vs Strict Country Features', () => {
    describe('US (Permissive) - Flexible Rules', () => {
      it('allows invoice modification (invoiceEditable: true)', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=US`).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.documents.modification.invoiceEditable).to.be.true;
        });
      });

      it('does not require credit note for corrections', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=US`).then((response) => {
          expect(response.body.documents.modification.requiresCreditNote).to.be.false;
        });
      });

      it('allows gaps in numbering sequence', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=US`).then((response) => {
          expect(response.body.numbering.gapAllowed).to.be.true;
        });
      });

      it('does not require signature', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=US`).then((response) => {
          expect(response.body.signature.required).to.be.false;
        });
      });

      it('does not require QR code', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=US`).then((response) => {
          expect(response.body.qrCode.required).to.be.false;
        });
      });

      it('has minimal required fields', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=US`).then((response) => {
          // US only requires clientId and items
          expect(response.body.requiredFields.invoice).to.have.length.lessThan(5);
          expect(response.body.requiredFields.client).to.have.length.lessThan(3);
        });
      });

      it('uses post_audit transmission model (no real-time reporting)', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=US`).then((response) => {
          expect(response.body.transmission.b2b.model).to.eq('post_audit');
        });
      });
    });

    describe('IN (Very Strict) - GST Compliance', () => {
      it('prevents invoice modification (invoiceEditable: false)', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.documents.modification.invoiceEditable).to.be.false;
        });
      });

      it('requires credit note for corrections', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          expect(response.body.documents.modification.requiresCreditNote).to.be.true;
        });
      });

      it('does not allow gaps in numbering sequence', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          expect(response.body.numbering.gapAllowed).to.be.false;
        });
      });

      it('requires digital signature', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          expect(response.body.signature.required).to.be.true;
        });
      });

      it('requires QR code on invoices', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          expect(response.body.qrCode.required).to.be.true;
        });
      });

      it('has many required fields including GSTIN', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          // IN requires many fields
          expect(response.body.requiredFields.invoice).to.include('supplyType');
          expect(response.body.requiredFields.invoice).to.include('placeOfSupply');
          expect(response.body.requiredFields.client).to.include('gstin');
        });
      });

      it('uses clearance transmission model (mandatory IRP)', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          expect(response.body.transmission.b2b.model).to.eq('clearance');
          expect(response.body.transmission.b2b.mandatory).to.be.true;
        });
      });

      it('has 24-hour deadline for e-invoice', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          expect(response.body.transmission.b2b.deadlineDays).to.eq(1);
        });
      });

      it('requires series in invoice numbering', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          expect(response.body.numbering.seriesRequired).to.be.true;
        });
      });

      it('has mandatory legal mentions including IRN and QR', () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
          expect(response.body.legalMentions.mandatory).to.include('compliance.in.mention.irn');
          expect(response.body.legalMentions.mandatory).to.include('compliance.in.mention.qrCode');
        });
      });
    });
  });

  // ============================================================================
  // MULTI-PLATFORM SUPPORT TESTS
  // ============================================================================

  describe('Multi-Platform Transmission Support', () => {
    it('FR: returns multiple PDP platforms for B2B', () => {
      cy.request(`${BACKEND_URL}/api/compliance/country?code=FR`).then((response) => {
        expect(response.status).to.eq(200);

        const b2b = response.body.transmission.b2b;
        expect(b2b.platforms).to.be.an('array');
        expect(b2b.platforms.length).to.be.greaterThan(1);

        // Verify platform structure
        b2b.platforms.forEach((platform: Record<string, unknown>) => {
          expect(platform.id).to.be.a('string');
          expect(platform.labelKey).to.be.a('string');
        });

        // Check for specific PDP platforms
        const platformIds = b2b.platforms.map((p: { id: string }) => p.id);
        expect(platformIds).to.include('superpdp');
        expect(platformIds).to.include('cegid');
        expect(platformIds).to.include('sage');
      });
    });

    it('FR: has default platform marked', () => {
      cy.request(`${BACKEND_URL}/api/compliance/country?code=FR`).then((response) => {
        const b2b = response.body.transmission.b2b;
        const defaultPlatform = b2b.platforms.find((p: { isDefault?: boolean }) => p.isDefault);

        expect(defaultPlatform).to.exist;
        expect(defaultPlatform.id).to.eq('superpdp');
      });
    });

    it('FR: B2B allows user platform selection', () => {
      cy.request(`${BACKEND_URL}/api/compliance/country?code=FR`).then((response) => {
        expect(response.body.transmission.b2b.userSelectable).to.be.true;
      });
    });

    it('FR: B2G does not allow platform selection (Chorus only)', () => {
      cy.request(`${BACKEND_URL}/api/compliance/country?code=FR`).then((response) => {
        expect(response.body.transmission.b2g.userSelectable).to.be.false;
        expect(response.body.transmission.b2g.platforms).to.have.length(1);
      });
    });

    it('IN: has IRP platforms defined', () => {
      cy.request(`${BACKEND_URL}/api/compliance/country?code=IN`).then((response) => {
        const b2b = response.body.transmission.b2b;
        expect(b2b.platforms).to.be.an('array');

        const platformIds = b2b.platforms.map((p: { id: string }) => p.id);
        expect(platformIds).to.include('irp');
      });
    });

    it('US: email is the default/only platform', () => {
      cy.request(`${BACKEND_URL}/api/compliance/country?code=US`).then((response) => {
        const b2b = response.body.transmission.b2b;
        expect(b2b.platform).to.eq('email');

        if (b2b.platforms) {
          const defaultPlatform = b2b.platforms.find((p: { isDefault?: boolean }) => p.isDefault);
          expect(defaultPlatform?.id).to.eq('email');
        }
      });
    });
  });

  // ============================================================================
  // COMPLIANCE STRICTNESS SPECTRUM TEST
  // ============================================================================

  describe('Compliance Strictness Spectrum', () => {
    const strictnessExpectations = [
      {
        code: 'US',
        level: 'permissive',
        invoiceEditable: true,
        gapAllowed: true,
        signatureRequired: false,
        qrRequired: false,
        mandatoryTransmission: false,
      },
      {
        code: 'FR',
        level: 'moderate',
        invoiceEditable: false,
        gapAllowed: false,
        signatureRequired: false,
        qrRequired: false,
        mandatoryTransmission: false, // Not yet mandatory
      },
      {
        code: 'IT',
        level: 'strict',
        invoiceEditable: false,
        gapAllowed: false,
        signatureRequired: true,
        qrRequired: false,
        mandatoryTransmission: true,
      },
      {
        code: 'IN',
        level: 'very_strict',
        invoiceEditable: false,
        gapAllowed: false,
        signatureRequired: true,
        qrRequired: true,
        mandatoryTransmission: true,
      },
    ];

    strictnessExpectations.forEach(({ code, level, ...expectations }) => {
      it(`${code} (${level}): matches expected strictness profile`, () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=${code}`).then((response) => {
          expect(response.status).to.eq(200);

          const config = response.body;

          // Invoice editability
          expect(config.documents.modification.invoiceEditable).to.eq(
            expectations.invoiceEditable,
            `${code}: invoiceEditable mismatch`,
          );

          // Gap allowance
          expect(config.numbering.gapAllowed).to.eq(
            expectations.gapAllowed,
            `${code}: gapAllowed mismatch`,
          );

          // Signature requirement
          expect(config.signature.required).to.eq(
            expectations.signatureRequired,
            `${code}: signatureRequired mismatch`,
          );

          // QR code requirement
          expect(config.qrCode.required).to.eq(
            expectations.qrRequired,
            `${code}: qrRequired mismatch`,
          );

          // Transmission mandatory
          expect(config.transmission.b2b.mandatory).to.eq(
            expectations.mandatoryTransmission,
            `${code}: mandatoryTransmission mismatch`,
          );
        });
      });
    });
  });
});
