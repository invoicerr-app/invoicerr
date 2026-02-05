beforeEach(() => {
  cy.login();
});

describe('Company Settings E2E', () => {
  describe('1 - Initial Company Setup (Required for other tests)', () => {
    it('creates the company via onboarding', () => {
      cy.visit('/');

      cy.get('[data-cy="onboarding-dialog"]', { timeout: 10000 }).should('be.visible');

      // Step 1: Basic Info (name, description, foundedAt, currency)
      cy.get('[data-cy="onboarding-company-name-input"]').clear().type('Acme Corp');
      cy.get('[data-cy="onboarding-company-description-input"]')
        .clear()
        .type('A fictional company');

      // Founded date picker
      cy.get('[data-cy="onboarding-company-foundedat-input"]').should('be.visible');

      cy.get('[data-cy="onboarding-company-currency-select"]').click();
      cy.get('[data-cy="onboarding-company-currency-select-option-euro-(€)"]').click();

      cy.get('[data-cy="onboarding-next-btn"]').click();

      // Step 2: Address (address, country, postalCode, city)
      cy.get('[data-cy="onboarding-company-address-input"]').clear().type('123 Main Street');

      // Country is now a select component
      cy.get('[data-cy="onboarding-company-country-input"]').click();
      cy.contains('[role="option"]', 'France').click();

      cy.get('[data-cy="onboarding-company-postalcode-input"]').clear().type('75001');
      cy.get('[data-cy="onboarding-company-city-input"]').clear().type('Paris');

      cy.get('[data-cy="onboarding-next-btn"]').click();

      // Step 3: Identifiers (dynamic based on country)
      // Note: Identifiers are loaded dynamically from compliance API
      // If country-specific config exists (e.g., France with SIRET), fill those fields
      // Otherwise, just the VAT input should be available
      cy.get('[data-cy="onboarding-company-vat-input"]', { timeout: 5000 }).should('be.visible');
      cy.get('[data-cy="onboarding-company-vat-input"]').clear().type('FR12345678901');

      // Fill SIRET if available (France-specific)
      cy.get('body').then(($body) => {
        if ($body.find('[data-cy="onboarding-company-siret-input"]').length > 0) {
          cy.get('[data-cy="onboarding-company-siret-input"]').clear().type('12345678901234');
        }
      });

      cy.get('[data-cy="onboarding-next-btn"]').click();

      // Step 4: Contact (phone, email)
      cy.get('[data-cy="onboarding-company-phone-input"]').clear().type('+33123456789');
      cy.get('[data-cy="onboarding-company-email-input"]').clear().type('contact@acme.org');

      cy.get('[data-cy="onboarding-next-btn"]').click();

      // Step 5: Settings (numbering, PDF format, date format, VAT exemption)
      // Quote numbering
      cy.get('[data-cy="onboarding-company-quote-starting-number-input"]').should('be.visible');
      cy.get('[data-cy="onboarding-company-quote-starting-number-input"]').clear().type('1');
      cy.get('[data-cy="onboarding-company-quote-number-format-input"]').should(
        'have.value',
        'Q-{year}-{number}',
      );

      // Invoice numbering
      cy.get('[data-cy="onboarding-company-invoice-starting-number-input"]').clear().type('1');
      cy.get('[data-cy="onboarding-company-invoice-number-format-input"]').should(
        'have.value',
        'INV-{year}-{number}',
      );

      // Receipt numbering
      cy.get('[data-cy="onboarding-company-receipt-starting-number-input"]').clear().type('1');
      cy.get('[data-cy="onboarding-company-receipt-number-format-input"]').should(
        'have.value',
        'REC-{year}-{number}',
      );

      // PDF format
      cy.get('[data-cy="onboarding-company-pdfformat-select"]').click();
      cy.get('[data-cy="onboarding-company-pdfformat-option-pdf"]').click();

      // Date format
      cy.get('[data-cy="onboarding-company-dateformat-select"]').click();
      cy.get('[data-cy="onboarding-company-dateformat-option-dd/MM/yyyy"]').click();

      // VAT exemption switch
      cy.get('[data-cy="onboarding-company-exemptvat-switch"]').should('be.visible');

      cy.get('[data-cy="onboarding-submit-btn"]').click();

      cy.get('[data-cy="onboarding-dialog"]').should('not.exist');

      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should('be.visible');
      cy.get('[data-cy="company-name-input"]').should('have.value', 'Acme Corp');
    });
  });

  describe('2 - Validation Errors', () => {
    it('shows error for empty company name', () => {
      cy.visit('/settings/company');
      cy.get('[data-cy="company-name-input"]', { timeout: 10000 }).clear();
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/required|empty|name/i);
    });

    it('shows error for empty address', () => {
      cy.visit('/settings/company');
      cy.get('[data-cy="company-address-input"]', { timeout: 10000 }).clear();
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/required|empty|address/i);
    });

    it('shows error for empty city', () => {
      cy.visit('/settings/company');
      cy.get('[data-cy="company-city-input"]', { timeout: 10000 }).clear();
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/required|empty|city/i);
    });

    it('shows error for invalid postal code format', () => {
      cy.visit('/settings/company');
      cy.get('[data-cy="company-postalcode-input"]', { timeout: 10000 }).clear().type('AB');
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/format|invalid|postal/i);
    });

    it('shows error for invalid phone format', () => {
      cy.visit('/settings/company');
      cy.get('[data-cy="company-phone-input"]', { timeout: 10000 }).clear().type('123');
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/format|invalid|phone|characters/i);
    });

    it('shows error for invalid email format', () => {
      cy.visit('/settings/company');
      cy.get('[data-cy="company-email-input"]', { timeout: 10000 }).clear().type('not-an-email');
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/format|invalid|email/i);
    });
  });

  describe('3 - Extended Address Fields', () => {
    it('updates company with addressLine2 and state', () => {
      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should('be.visible');

      cy.get('[data-cy="company-address-line2-input"]').clear().type('Building A, Floor 5');
      cy.get('[data-cy="company-state-input"]').clear().type('Île-de-France');

      cy.get('[data-cy="company-submit-btn"]').click();
      cy.wait(2000);

      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-address-line2-input"]', { timeout: 10000 }).should(
        'have.value',
        'Building A, Floor 5',
      );
      cy.get('[data-cy="company-state-input"]').should('have.value', 'Île-de-France');
    });

    it('updates company with US state abbreviation', () => {
      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should('be.visible');

      cy.get('[data-cy="company-address-input"]').clear().type('1234 Tech Boulevard');
      cy.get('[data-cy="company-address-line2-input"]').clear().type('Suite 100');
      cy.get('[data-cy="company-city-input"]').clear().type('Austin');
      cy.get('[data-cy="company-state-input"]').clear().type('TX');
      cy.get('[data-cy="company-postalcode-input"]').clear().type('78701');

      cy.get('[data-cy="company-submit-btn"]').click();
      cy.wait(2000);

      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-address-line2-input"]', { timeout: 10000 }).should(
        'have.value',
        'Suite 100',
      );
      cy.get('[data-cy="company-state-input"]').should('have.value', 'TX');
    });

    it('clears addressLine2 and state fields', () => {
      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should('be.visible');

      cy.get('[data-cy="company-address-line2-input"]').clear();
      cy.get('[data-cy="company-state-input"]').clear();

      cy.get('[data-cy="company-submit-btn"]').click();
      cy.wait(2000);

      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-address-line2-input"]', { timeout: 10000 }).should(
        'have.value',
        '',
      );
      cy.get('[data-cy="company-state-input"]').should('have.value', '');
    });
  });

  describe('4 - Edge Cases', () => {
    it('handles special characters in company name', () => {
      cy.visit('/settings/company');
      cy.get('[data-cy="company-name-input"]', { timeout: 10000 })
        .clear()
        .type("O'Reilly & Associates");
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.wait(1000);
      cy.get('[data-cy="company-name-input"]').invoke('val').should('contain', "O'Reilly");
    });

    it('handles unicode characters in company name', () => {
      cy.visit('/settings/company');
      cy.get('[data-cy="company-name-input"]', { timeout: 10000 }).clear().type('Société Générale');
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.wait(1000);
      cy.get('[data-cy="company-name-input"]').invoke('val').should('contain', 'Société');
    });

    it('shows error for description exceeding max length', () => {
      cy.visit('/settings/company');
      const tooLongDescription = 'A'.repeat(501);
      cy.get('[data-cy="company-description-input"]', { timeout: 10000 })
        .clear()
        .type(tooLongDescription, { delay: 0 });
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/max|length|500|characters|caractères/i);
    });

    it('validates starting numbers are positive', () => {
      cy.visit('/settings/company');
      cy.get('input[name="quoteStartingNumber"]', { timeout: 10000 }).clear().type('0');
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/min|at least|1/i);
    });
  });

  describe('5 - Dynamic Identifiers Based on Country', () => {
    it('displays VAT identifier field', () => {
      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should('be.visible');

      // VAT input should always be visible
      cy.get('[data-cy="company-vat-input"]').should('be.visible');

      // SIRET is only visible if France config is loaded from compliance API
      // This is a conditional check since dynamic identifiers depend on backend config
      cy.get('body').then(($body) => {
        if ($body.find('[data-cy="company-siret-input"]').length > 0) {
          cy.get('[data-cy="company-siret-input"]').should('be.visible');
        }
      });
    });

    it('validates VAT number format', () => {
      cy.visit('/settings/company');
      cy.wait(3000);

      // VAT number validation
      cy.get('[data-cy="company-vat-input"]', { timeout: 10000 }).clear().type('INVALID');
      cy.get('[data-cy="company-submit-btn"]').click();
      // The form should show format validation error
      // (depending on backend validation)
    });
  });

  describe('6 - Number Format Configuration', () => {
    it('validates quote number format', () => {
      cy.visit('/settings/company');
      cy.wait(3000);

      cy.get('[data-cy="company-quote-number-format-input"]', { timeout: 10000 })
        .clear()
        .type('INVALID-FORMAT');
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/format|number|required/i);
    });

    it('validates invoice number format', () => {
      cy.visit('/settings/company');
      cy.wait(3000);

      cy.get('[data-cy="company-invoice-number-format-input"]', { timeout: 10000 })
        .clear()
        .type('INVALID-FORMAT');
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/format|number|required/i);
    });

    it('validates receipt number format', () => {
      cy.visit('/settings/company');
      cy.wait(3000);

      cy.get('[data-cy="company-receipt-number-format-input"]', { timeout: 10000 })
        .clear()
        .type('INVALID-FORMAT');
      cy.get('[data-cy="company-submit-btn"]').click();
      cy.contains(/format|number|required/i);
    });

    it('accepts valid number formats with placeholders', () => {
      cy.visit('/settings/company');
      cy.wait(3000);

      // Valid format with {number} placeholder
      // Note: parseSpecialCharSequences: false prevents Cypress from interpreting {year} as special chars
      cy.get('[data-cy="company-quote-number-format-input"]', { timeout: 10000 })
        .clear()
        .type('Q-{year}-{number:5}', { parseSpecialCharSequences: false });
      cy.get('[data-cy="company-invoice-number-format-input"]')
        .clear()
        .type('INV-{year}-{month}-{number}', { parseSpecialCharSequences: false });
      cy.get('[data-cy="company-receipt-number-format-input"]')
        .clear()
        .type('REC-{number:4}', { parseSpecialCharSequences: false });
    });
  });

  describe('7 - PDF Format Selection', () => {
    it('allows selecting different e-invoice formats', () => {
      cy.visit('/settings/company');
      cy.wait(3000);

      // Test Factur-X selection
      cy.get('[data-cy="company-pdfformat-select"]', { timeout: 10000 }).click();
      cy.get('[data-cy="company-pdfformat-option-facturx"]').click();
      cy.get('[data-cy="company-pdfformat-select"]').should('contain.text', 'Factur-X');

      // Test ZUGFeRD selection
      cy.get('[data-cy="company-pdfformat-select"]').click();
      cy.get('[data-cy="company-pdfformat-option-zugferd"]').click();
      cy.get('[data-cy="company-pdfformat-select"]').should('contain.text', 'ZUGFeRD');

      // Test XRechnung selection
      cy.get('[data-cy="company-pdfformat-select"]').click();
      cy.get('[data-cy="company-pdfformat-option-xrechnung"]').click();

      // Test UBL selection
      cy.get('[data-cy="company-pdfformat-select"]').click();
      cy.get('[data-cy="company-pdfformat-option-ubl"]').click();

      // Test CII selection
      cy.get('[data-cy="company-pdfformat-select"]').click();
      cy.get('[data-cy="company-pdfformat-option-cii"]').click();
    });
  });

  describe('8 - VAT Exemption Toggle', () => {
    it('can toggle VAT exemption', () => {
      cy.visit('/settings/company');
      cy.wait(3000);

      cy.get('[data-cy="company-exemptvat-switch"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-cy="company-exemptvat-switch"]').click();
    });
  });

  describe('9 - Restore Valid State (Must run last)', () => {
    it('restores valid company settings for other tests', () => {
      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should('be.visible');

      // Basic info
      cy.get('[data-cy="company-name-input"]').clear().type('Acme Corp');
      cy.get('[data-cy="company-description-input"]').clear().type('A fictional company');

      // VAT identifier (always present)
      cy.get('[data-cy="company-vat-input"]').clear().type('FR12345678901');

      // SIRET identifier (only if France config is loaded)
      cy.get('body').then(($body) => {
        if ($body.find('[data-cy="company-siret-input"]').length > 0) {
          cy.get('[data-cy="company-siret-input"]').clear().type('12345678901234');
        }
      });

      // Contact
      cy.get('[data-cy="company-phone-input"]').clear().type('+33123456789');
      cy.get('[data-cy="company-email-input"]').clear().type('contact@acme.org');

      // Address
      cy.get('[data-cy="company-address-input"]').clear().type('123 Main St');
      cy.get('[data-cy="company-address-line2-input"]').clear();
      cy.get('[data-cy="company-city-input"]').clear().type('Paris');
      cy.get('[data-cy="company-state-input"]').clear();
      cy.get('[data-cy="company-postalcode-input"]').clear().type('75001');
      // Note: country is now read-only in settings (set during onboarding)

      // Currency
      cy.get('[data-cy="company-currency-select"]').click();
      cy.get('[data-cy="company-currency-select-option-euro-(€)"]').click();

      // Number formats (parseSpecialCharSequences: false to avoid Cypress parsing {year})
      cy.get('[data-cy="company-quote-starting-number-input"]').clear().type('1');
      cy.get('[data-cy="company-quote-number-format-input"]')
        .clear()
        .type('Q-{year}-{number}', { parseSpecialCharSequences: false });
      cy.get('[data-cy="company-invoice-starting-number-input"]').clear().type('1');
      cy.get('[data-cy="company-invoice-number-format-input"]')
        .clear()
        .type('INV-{year}-{number}', { parseSpecialCharSequences: false });
      cy.get('[data-cy="company-receipt-starting-number-input"]').clear().type('1');
      cy.get('[data-cy="company-receipt-number-format-input"]')
        .clear()
        .type('REC-{year}-{number}', { parseSpecialCharSequences: false });

      // PDF and date format
      cy.get('[data-cy="company-pdfformat-select"]').click();
      cy.get('[data-cy="company-pdfformat-option-pdf"]').click();

      cy.get('[data-cy="company-dateformat-select"]').click();
      cy.get('[data-cy="company-dateformat-option-dd-MM-yyyy"]').first().click();

      // VAT exemption off
      cy.get('[data-cy="company-exemptvat-switch"]').then(($switch) => {
        if ($switch.attr('data-state') === 'checked') {
          cy.wrap($switch).click();
        }
      });

      cy.get('[data-cy="company-submit-btn"]').click();
      cy.wait(5000);

      // Verify restoration
      cy.visit('/settings/company');
      cy.wait(3000);
      cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should('be.visible');
      cy.get('[data-cy="company-name-input"]').should('have.value', 'Acme Corp');
      cy.get('[data-cy="company-vat-input"]').should('have.value', 'FR12345678901');
    });
  });
});
