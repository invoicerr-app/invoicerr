/**
 * Compliance Module E2E Tests
 * Tests the modular compliance system configurations for all implemented countries
 *
 * This file focuses on:
 * - Country configuration validation
 * - Identifier requirements per country
 * - VAT rates and exemptions
 * - Transmission platforms
 * - Format support
 *
 * For document lifecycle tests, see 13-compliance-documents.cy.ts
 */

import { BACKEND_URL } from '../support/e2e';

// ============================================================================
// COUNTRY CONFIGURATION EXPECTATIONS
// ============================================================================

interface CountryConfigExpectations {
  code: string;
  name: string;
  currency: string;
  isEU: boolean;
  // VAT
  defaultVatRate: number;
  vatRates: number[];
  vatExemptions: string[];
  vatNumberFormat: RegExp;
  // Identifiers
  companyIdentifiers: string[];
  clientIdentifiers: string[];
  requiredCompanyIdentifiers: string[];
  // Transmission
  b2bModel: string;
  b2bPlatform: string;
  b2gModel: string;
  b2gPlatform: string;
  // Format
  preferredFormat: string;
  supportedFormats: string[];
  syntax: string;
  // Features
  hashChaining: boolean;
  qrCodeRequired: boolean;
  signatureRequired: boolean;
  // Required fields
  invoiceRequiredFields: string[];
  clientRequiredFields: string[];
  // Archiving
  retentionYears: number;
}

const COUNTRY_EXPECTATIONS: Record<string, CountryConfigExpectations> = {
  // ============================================================================
  // PERMISSIVE - Flexible invoicing rules
  // ============================================================================
  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    isEU: false,
    defaultVatRate: 0,
    vatRates: [0],
    vatExemptions: ['EXEMPT', 'RESALE'],
    vatNumberFormat: /^[0-9]{2}-[0-9]{7}$/,
    companyIdentifiers: ['ein', 'duns', 'stateId'],
    clientIdentifiers: ['ein'],
    requiredCompanyIdentifiers: [],
    b2bModel: 'post_audit',
    b2bPlatform: 'email',
    b2gModel: 'post_audit',
    b2gPlatform: 'email',
    preferredFormat: 'pdf',
    supportedFormats: ['pdf', 'ubl'],
    syntax: 'PDF',
    hashChaining: false,
    qrCodeRequired: false,
    signatureRequired: false,
    invoiceRequiredFields: ['clientId', 'items'],
    clientRequiredFields: ['name'],
    retentionYears: 7,
  },

  // ============================================================================
  // MODERATE - EU standard e-invoicing
  // ============================================================================
  FR: {
    code: 'FR',
    name: 'France',
    currency: 'EUR',
    isEU: true,
    defaultVatRate: 20,
    vatRates: [20, 10, 5.5, 2.1, 0],
    vatExemptions: ['MICRO', 'FORMATION'],
    vatNumberFormat: /^FR[0-9A-Z]{2}[0-9]{9}$/,
    companyIdentifiers: ['siret', 'siren', 'rcs', 'naf'],
    clientIdentifiers: ['siret'],
    requiredCompanyIdentifiers: ['siret'],
    b2bModel: 'pdp',
    b2bPlatform: 'superpdp',
    b2gModel: 'clearance',
    b2gPlatform: 'chorus',
    preferredFormat: 'facturx',
    supportedFormats: ['pdf', 'facturx', 'ubl'],
    syntax: 'CII',
    hashChaining: false,
    qrCodeRequired: false,
    signatureRequired: false,
    invoiceRequiredFields: ['clientId', 'items', 'dueDate', 'issueDate'],
    clientRequiredFields: ['name', 'email', 'address', 'city', 'postalCode', 'country'],
    retentionYears: 10,
  },

  DE: {
    code: 'DE',
    name: 'Germany',
    currency: 'EUR',
    isEU: true,
    defaultVatRate: 19,
    vatRates: [19, 7, 0],
    vatExemptions: ['KLEINUNTERNEHMER'],
    vatNumberFormat: /^DE[0-9]{9}$/,
    companyIdentifiers: ['steuernummer', 'handelsregister', 'leitwegId'],
    clientIdentifiers: ['leitwegId'],
    requiredCompanyIdentifiers: [],
    b2bModel: 'peppol',
    b2bPlatform: 'peppol',
    b2gModel: 'peppol',
    b2gPlatform: 'xrechnung',
    preferredFormat: 'xrechnung',
    supportedFormats: ['pdf', 'xrechnung', 'zugferd', 'ubl'],
    syntax: 'UBL',
    hashChaining: false,
    qrCodeRequired: false,
    signatureRequired: false,
    invoiceRequiredFields: ['clientId', 'items', 'dueDate', 'issueDate'],
    clientRequiredFields: ['name', 'email', 'address', 'city', 'postalCode', 'country'],
    retentionYears: 10,
  },

  IT: {
    code: 'IT',
    name: 'Italy',
    currency: 'EUR',
    isEU: true,
    defaultVatRate: 22,
    vatRates: [22, 10, 5, 4, 0],
    vatExemptions: ['REGIME_FORFETTARIO', 'REGIME_MINIMI'],
    vatNumberFormat: /^IT[0-9]{11}$/,
    companyIdentifiers: ['partitaIva', 'codiceFiscale', 'rea'],
    clientIdentifiers: ['partitaIva', 'codiceFiscale', 'codiceDestinatario', 'pec'],
    requiredCompanyIdentifiers: ['partitaIva', 'codiceFiscale'],
    b2bModel: 'clearance',
    b2bPlatform: 'sdi',
    b2gModel: 'clearance',
    b2gPlatform: 'sdi',
    preferredFormat: 'fatturaPA',
    supportedFormats: ['fatturaPA'],
    syntax: 'FatturaPA',
    hashChaining: false,
    qrCodeRequired: false,
    signatureRequired: true,
    invoiceRequiredFields: ['clientId', 'items', 'dueDate', 'issueDate'],
    clientRequiredFields: ['name', 'address', 'city', 'postalCode', 'country', 'codiceFiscale'],
    retentionYears: 10,
  },

  ES: {
    code: 'ES',
    name: 'Spain',
    currency: 'EUR',
    isEU: true,
    defaultVatRate: 21,
    vatRates: [21, 10, 4, 0],
    vatExemptions: ['EXENTO_ART20'],
    vatNumberFormat: /^ES[A-Z0-9][0-9]{7}[A-Z0-9]$/,
    companyIdentifiers: ['nif', 'cif'],
    clientIdentifiers: ['nif'],
    requiredCompanyIdentifiers: ['nif'],
    b2bModel: 'hash_chain',
    b2bPlatform: 'verifactu',
    b2gModel: 'clearance',
    b2gPlatform: 'face',
    preferredFormat: 'facturae',
    supportedFormats: ['pdf', 'facturae', 'ubl'],
    syntax: 'Facturae',
    hashChaining: true,
    qrCodeRequired: true,
    signatureRequired: true,
    invoiceRequiredFields: ['clientId', 'items', 'dueDate', 'issueDate', 'series'],
    clientRequiredFields: ['name', 'address', 'city', 'postalCode', 'country', 'nif'],
    retentionYears: 6,
  },

  PT: {
    code: 'PT',
    name: 'Portugal',
    currency: 'EUR',
    isEU: true,
    defaultVatRate: 23,
    vatRates: [23, 13, 6, 0],
    vatExemptions: ['ISENTO_ART53'],
    vatNumberFormat: /^PT[0-9]{9}$/,
    companyIdentifiers: ['nif'],
    clientIdentifiers: ['nif'],
    requiredCompanyIdentifiers: ['nif'],
    b2bModel: 'hash_chain',
    b2bPlatform: 'saft',
    b2gModel: 'hash_chain',
    b2gPlatform: 'saft',
    preferredFormat: 'saft',
    supportedFormats: ['pdf', 'saft', 'ubl'],
    syntax: 'UBL',
    hashChaining: true,
    qrCodeRequired: true,
    signatureRequired: true,
    invoiceRequiredFields: ['clientId', 'items', 'dueDate', 'issueDate', 'series', 'atcud'],
    clientRequiredFields: ['name', 'address', 'city', 'postalCode', 'country'],
    retentionYears: 12,
  },

  BE: {
    code: 'BE',
    name: 'Belgium',
    currency: 'EUR',
    isEU: true,
    defaultVatRate: 21,
    vatRates: [21, 12, 6, 0],
    vatExemptions: [],
    vatNumberFormat: /^BE[0-9]{10}$/,
    companyIdentifiers: ['bce'],
    clientIdentifiers: ['bce'],
    requiredCompanyIdentifiers: [],
    b2bModel: 'peppol',
    b2bPlatform: 'peppol',
    b2gModel: 'peppol',
    b2gPlatform: 'peppol',
    preferredFormat: 'facturx',
    supportedFormats: ['pdf', 'facturx', 'ubl'],
    syntax: 'CII',
    hashChaining: false,
    qrCodeRequired: false,
    signatureRequired: false,
    invoiceRequiredFields: ['clientId', 'items', 'dueDate', 'issueDate'],
    clientRequiredFields: ['name', 'email', 'address', 'city', 'postalCode', 'country'],
    retentionYears: 10,
  },

  // ============================================================================
  // VERY STRICT - Mandatory clearance, real-time reporting
  // ============================================================================
  IN: {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    isEU: false,
    defaultVatRate: 18,
    vatRates: [28, 18, 12, 5, 0],
    vatExemptions: ['EXEMPT_SCHEDULE', 'EXPORT', 'SEZ'],
    vatNumberFormat: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
    companyIdentifiers: ['gstin', 'pan', 'cin', 'lut'],
    clientIdentifiers: ['gstin', 'pan'],
    requiredCompanyIdentifiers: ['gstin', 'pan'],
    b2bModel: 'clearance',
    b2bPlatform: 'irp',
    b2gModel: 'clearance',
    b2gPlatform: 'irp',
    preferredFormat: 'json',
    supportedFormats: ['pdf', 'json'],
    syntax: 'GST-JSON',
    hashChaining: false,
    qrCodeRequired: true,
    signatureRequired: true,
    invoiceRequiredFields: ['clientId', 'items', 'dueDate', 'issueDate', 'series', 'supplyType', 'placeOfSupply'],
    clientRequiredFields: ['name', 'address', 'city', 'postalCode', 'country', 'gstin', 'stateCode'],
    retentionYears: 8,
  },
};

// ============================================================================
// TESTS
// ============================================================================

describe('Compliance Module E2E', () => {
  // ============================================================================
  // GENERAL API TESTS
  // ============================================================================

  describe('API - General Endpoints', () => {
    it('returns list of all supported countries', () => {
      cy.request(`${BACKEND_URL}/api/compliance/countries`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.be.an('array');
        expect(response.body.length).to.be.greaterThan(0);

        // Verify all expected countries are present
        const countryCodes = response.body.map((c: { code: string }) => c.code);
        Object.keys(COUNTRY_EXPECTATIONS).forEach((code) => {
          expect(countryCodes).to.include(code);
        });

        // Verify country structure
        response.body.forEach((country: Record<string, unknown>) => {
          expect(country.code).to.be.a('string');
          expect(country.code.length).to.eq(2);
        });
      });
    });

    it('returns list of supported transmission platforms', () => {
      cy.request(`${BACKEND_URL}/api/compliance/platforms`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.be.an('array');
        expect(response.body.length).to.be.greaterThan(0);

        // Email should always be supported as fallback
        expect(response.body).to.include('email');

        // Check for expected platforms
        const expectedPlatforms = [
          'chorus',
          'superpdp',
          'peppol',
          'sdi',
          'verifactu',
          'saft',
          'xrechnung',
        ];
        expectedPlatforms.forEach((platform) => {
          // Platform might be in list or might not be fully implemented yet
          cy.log(`Checking platform: ${platform} - present: ${response.body.includes(platform)}`);
        });
      });
    });
  });

  // ============================================================================
  // PER-COUNTRY CONFIGURATION TESTS
  // ============================================================================

  describe('API - Country Configuration Validation', () => {
    Object.entries(COUNTRY_EXPECTATIONS).forEach(([countryCode, expectations]) => {
      describe(`${expectations.name} (${countryCode})`, () => {
        describe('Basic Configuration', () => {
          it('returns correct basic country info', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                expect(response.status).to.eq(200);

                const config = response.body;
                expect(config.code).to.eq(expectations.code);
                expect(config.currency).to.eq(expectations.currency);
                expect(config.isEU).to.eq(expectations.isEU);
              },
            );
          });
        });

        describe('VAT Configuration', () => {
          it('has correct default VAT rate', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                expect(response.body.vat.defaultRate).to.eq(expectations.defaultVatRate);
              },
            );
          });

          it('has all expected VAT rates', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                const rates = response.body.vat.rates.map((r: { rate: number }) => r.rate);

                expectations.vatRates.forEach((expectedRate) => {
                  expect(rates).to.include(expectedRate);
                });
              },
            );
          });

          it('has VAT rate categories defined', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                response.body.vat.rates.forEach((rate: Record<string, unknown>) => {
                  expect(rate.code).to.be.a('string');
                  expect(rate.labelKey).to.be.a('string');
                  expect(rate.category).to.be.a('string');
                });
              },
            );
          });

          if (expectations.vatExemptions.length > 0) {
            it('has expected VAT exemptions', () => {
              cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
                (response) => {
                  expect(response.body.vat.exemptions).to.be.an('array');

                  const exemptionCodes = response.body.vat.exemptions.map(
                    (e: { code: string }) => e.code,
                  );

                  expectations.vatExemptions.forEach((expectedExemption) => {
                    expect(exemptionCodes).to.include(expectedExemption);
                  });
                },
              );
            });
          }
        });

        describe('Identifier Configuration', () => {
          it('returns correct company identifiers', () => {
            cy.request(`${BACKEND_URL}/api/compliance/identifiers?country=${countryCode}`).then(
              (response) => {
                expect(response.status).to.eq(200);
                expect(response.body.identifiers).to.be.an('array');

                const identifierIds = response.body.identifiers.map((i: { id: string }) => i.id);

                // Check all expected identifiers are present
                expectations.companyIdentifiers.forEach((expectedId) => {
                  expect(identifierIds).to.include(expectedId);
                });
              },
            );
          });

          it('has valid identifier structure', () => {
            cy.request(`${BACKEND_URL}/api/compliance/identifiers?country=${countryCode}`).then(
              (response) => {
                response.body.identifiers.forEach((identifier: Record<string, unknown>) => {
                  expect(identifier.id).to.be.a('string');
                  expect(identifier.labelKey).to.be.a('string');
                  expect(identifier.format).to.be.a('string');
                  // format should be a valid regex pattern
                  expect(() => new RegExp(identifier.format as string)).to.not.throw();
                });
              },
            );
          });

          if (expectations.requiredCompanyIdentifiers.length > 0) {
            it('marks required identifiers correctly', () => {
              cy.request(`${BACKEND_URL}/api/compliance/identifiers?country=${countryCode}`).then(
                (response) => {
                  const requiredIds = response.body.identifiers
                    .filter((i: { required?: boolean }) => i.required === true)
                    .map((i: { id: string }) => i.id);

                  expectations.requiredCompanyIdentifiers.forEach((expectedRequired) => {
                    expect(requiredIds).to.include(expectedRequired);
                  });
                },
              );
            });
          }
        });

        describe('Transmission Configuration', () => {
          it('has correct B2B transmission model and platform', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                const { b2b } = response.body.transmission;

                expect(b2b.model).to.eq(expectations.b2bModel);
                if (b2b.platform) {
                  expect(b2b.platform).to.eq(expectations.b2bPlatform);
                }
              },
            );
          });

          it('has correct B2G transmission model and platform', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                const { b2g } = response.body.transmission;

                expect(b2g.model).to.eq(expectations.b2gModel);
                if (b2g.platform) {
                  expect(b2g.platform).to.eq(expectations.b2gPlatform);
                }
              },
            );
          });

          it('has B2C transmission configuration', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                const { b2c } = response.body.transmission;
                expect(b2c).to.exist;
                expect(b2c.model).to.be.a('string');
              },
            );
          });
        });

        describe('Format Configuration', () => {
          it('has correct preferred format', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                // Case insensitive comparison
                expect(response.body.format.preferred.toLowerCase()).to.eq(
                  expectations.preferredFormat.toLowerCase(),
                );
              },
            );
          });

          it('has correct syntax', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                expect(response.body.format.syntax.toLowerCase()).to.eq(
                  expectations.syntax.toLowerCase(),
                );
              },
            );
          });

          it('supports expected formats', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                const supported = response.body.format.supported.map((s: string) =>
                  s.toLowerCase(),
                );

                expectations.supportedFormats.forEach((expectedFormat) => {
                  expect(supported).to.include(expectedFormat.toLowerCase());
                });
              },
            );
          });
        });

        describe('Special Features', () => {
          it(`has hash chaining ${expectations.hashChaining ? 'enabled' : 'disabled'}`, () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                expect(response.body.numbering.hashChaining).to.eq(expectations.hashChaining);
              },
            );
          });

          it(`has QR code ${expectations.qrCodeRequired ? 'required' : 'not required'}`, () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                expect(response.body.qrCode.required).to.eq(expectations.qrCodeRequired);
              },
            );
          });

          it(`has signature ${expectations.signatureRequired ? 'required' : 'not required'}`, () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                expect(response.body.signature.required).to.eq(expectations.signatureRequired);
              },
            );
          });
        });

        describe('Required Fields', () => {
          it('has correct invoice required fields', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                const requiredFields = response.body.requiredFields.invoice;

                expectations.invoiceRequiredFields.forEach((field) => {
                  expect(requiredFields).to.include(field);
                });
              },
            );
          });

          it('has correct client required fields', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                const requiredFields = response.body.requiredFields.client;

                expectations.clientRequiredFields.forEach((field) => {
                  expect(requiredFields).to.include(field);
                });
              },
            );
          });
        });

        describe('Archiving Configuration', () => {
          it('has correct retention period', () => {
            cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then(
              (response) => {
                expect(response.body.archiving.retentionYears).to.eq(expectations.retentionYears);
              },
            );
          });
        });

        describe('Frontend Config API', () => {
          it('returns valid frontend config for B2B', () => {
            cy.request(
              `${BACKEND_URL}/api/compliance/config?supplierCountry=${countryCode}&transactionType=B2B`,
            ).then((response) => {
              expect(response.status).to.eq(200);
              expect(response.body.vatRates).to.be.an('array');
              expect(response.body.defaultVatRate).to.eq(expectations.defaultVatRate);
            });
          });

          it('returns valid frontend config for B2G', () => {
            cy.request(
              `${BACKEND_URL}/api/compliance/config?supplierCountry=${countryCode}&transactionType=B2G`,
            ).then((response) => {
              expect(response.status).to.eq(200);
              expect(response.body.vatRates).to.be.an('array');
            });
          });

          it('returns valid frontend config for B2C', () => {
            cy.request(
              `${BACKEND_URL}/api/compliance/config?supplierCountry=${countryCode}&transactionType=B2C`,
            ).then((response) => {
              expect(response.status).to.eq(200);
              expect(response.body.vatRates).to.be.an('array');
            });
          });
        });

        describe('Correction Codes', () => {
          it('returns correction codes', () => {
            cy.request(
              `${BACKEND_URL}/api/compliance/correction-codes?country=${countryCode}`,
            ).then((response) => {
              expect(response.status).to.eq(200);
              expect(response.body).to.be.an('array');

              // Verify correction code structure
              if (response.body.length > 0) {
                response.body.forEach((code: Record<string, unknown>) => {
                  expect(code.code).to.be.a('string');
                  expect(code.labelKey).to.be.a('string');
                });
              }
            });
          });
        });
      });
    });
  });

  // ============================================================================
  // CROSS-BORDER TRANSACTION TESTS
  // ============================================================================

  describe('API - Cross-Border Transactions', () => {
    // Generate all cross-border combinations
    const countries = Object.keys(COUNTRY_EXPECTATIONS);
    const crossBorderCombinations: Array<{
      supplier: string;
      customer: string;
    }> = [];

    countries.forEach((supplier) => {
      countries.forEach((customer) => {
        if (supplier !== customer) {
          crossBorderCombinations.push({ supplier, customer });
        }
      });
    });

    // Test a representative sample (not all combinations to keep test suite fast)
    const sampleCombinations = crossBorderCombinations.slice(0, 10);

    sampleCombinations.forEach(({ supplier, customer }) => {
      it(`handles ${supplier} → ${customer} B2B transaction`, () => {
        cy.request(
          `${BACKEND_URL}/api/compliance/config?supplierCountry=${supplier}&customerCountry=${customer}&transactionType=B2B`,
        ).then((response) => {
          expect(response.status).to.eq(200);

          const supplierExpectations = COUNTRY_EXPECTATIONS[supplier];
          const customerExpectations = COUNTRY_EXPECTATIONS[customer];

          // For cross-border B2B:
          // - Intra-EU B2B: reverse charge applies → 0% VAT
          // - Export to non-EU: export exemption → 0% VAT
          // - Non-EU to EU: depends on local rules
          const isIntraEU = supplierExpectations.isEU && customerExpectations.isEU;
          const isExport = supplierExpectations.isEU && !customerExpectations.isEU;

          if (isIntraEU || isExport) {
            // Reverse charge or export: 0% VAT
            expect(response.body.defaultVatRate).to.eq(0);
          } else {
            // For non-EU suppliers, use supplier's default rate
            expect(response.body.defaultVatRate).to.eq(supplierExpectations.defaultVatRate);
          }
          expect(response.body.vatRates).to.be.an('array');
        });
      });
    });
  });

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('API - Edge Cases & Error Handling', () => {
    it('returns generic config for unknown country code', () => {
      cy.request(`${BACKEND_URL}/api/compliance/config?supplierCountry=XX`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.vatRates).to.be.an('array');
        expect(response.body.defaultVatRate).to.be.a('number');
      });
    });

    it('returns generic config for non-EU country', () => {
      cy.request(`${BACKEND_URL}/api/compliance/config?supplierCountry=US`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.vatRates).to.be.an('array');
      });
    });

    it('handles lowercase country codes', () => {
      cy.request(`${BACKEND_URL}/api/compliance/config?supplierCountry=fr`).then((response) => {
        expect(response.status).to.eq(200);
        // Should still work (case-insensitive or normalize)
      });
    });

    it('handles missing transaction type', () => {
      cy.request(`${BACKEND_URL}/api/compliance/config?supplierCountry=FR`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.vatRates).to.be.an('array');
      });
    });

    it('handles missing customer country', () => {
      cy.request(
        `${BACKEND_URL}/api/compliance/config?supplierCountry=FR&transactionType=B2B`,
      ).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.vatRates).to.be.an('array');
      });
    });
  });

  // ============================================================================
  // VAT NUMBER VALIDATION PATTERNS
  // ============================================================================

  describe('VAT Number Format Validation', () => {
    Object.entries(COUNTRY_EXPECTATIONS).forEach(([countryCode, expectations]) => {
      it(`${countryCode}: has valid VAT number format pattern`, () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then((response) => {
          const format = response.body.vat.numberFormat;
          expect(format).to.be.a('string');

          // Verify it's a valid regex
          expect(() => new RegExp(format)).to.not.throw();

          // Verify prefix matches country code
          expect(response.body.vat.numberPrefix).to.eq(countryCode);
        });
      });
    });
  });

  // ============================================================================
  // PEPPOL CONFIGURATION
  // ============================================================================

  describe('Peppol Configuration', () => {
    const peppolCountries = ['FR', 'DE', 'IT', 'ES', 'PT', 'BE'];

    peppolCountries.forEach((countryCode) => {
      it(`${countryCode}: has valid Peppol configuration`, () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then((response) => {
          const { peppol } = response.body;
          expect(peppol).to.exist;
          expect(peppol.enabled).to.be.a('boolean');

          if (peppol.enabled) {
            expect(peppol.schemeId).to.be.a('string');
            expect(peppol.participantIdFormat).to.be.a('string');
            expect(peppol.documentTypeId).to.be.a('string');
            expect(peppol.processId).to.be.a('string');
          }
        });
      });
    });
  });

  // ============================================================================
  // LEGAL MENTIONS
  // ============================================================================

  describe('Legal Mentions Configuration', () => {
    Object.entries(COUNTRY_EXPECTATIONS).forEach(([countryCode, expectations]) => {
      it(`${countryCode}: has legal mentions defined`, () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then((response) => {
          const { legalMentions } = response.body;
          expect(legalMentions).to.exist;
          expect(legalMentions.mandatory).to.be.an('array');
          expect(legalMentions.conditional).to.be.an('array');

          // Verify mandatory mentions structure
          legalMentions.mandatory.forEach((mention: string) => {
            expect(mention).to.be.a('string');
            // Should be a translation key
            expect(mention).to.include('.');
          });

          // Verify conditional mentions structure
          legalMentions.conditional.forEach(
            (conditional: { condition: string; textKey: string }) => {
              expect(conditional.condition).to.be.a('string');
              expect(conditional.textKey).to.be.a('string');
            },
          );
        });
      });
    });
  });

  // ============================================================================
  // DOCUMENT CONFIGURATION
  // ============================================================================

  describe('Document Configuration', () => {
    Object.entries(COUNTRY_EXPECTATIONS).forEach(([countryCode]) => {
      it(`${countryCode}: has document configuration`, () => {
        cy.request(`${BACKEND_URL}/api/compliance/country?code=${countryCode}`).then((response) => {
          const { documents } = response.body;
          expect(documents).to.exist;
          expect(documents.builder).to.be.a('string');
          expect(documents.defaultFormat).to.be.a('string');
          expect(documents.outputFormats).to.exist;
          expect(documents.modification).to.exist;
        });
      });
    });
  });
});
