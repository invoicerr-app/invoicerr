beforeEach(() => {
    cy.login();
});

describe('Company Settings E2E', () => {
    describe('1 - Initial Company Setup (Required for other tests)', () => {
        it('creates the company via onboarding', () => {
            cy.visit('/');

            cy.get('[data-cy="onboarding-dialog"]', { timeout: 10000 }).should('be.visible');

            // Step 1: Basic Info
            cy.get('[data-cy="onboarding-company-name-input"]').clear().type('Acme Corp');
            cy.get('[data-cy="onboarding-company-description-input"]').clear().type('A fictional company');

            cy.get('[data-cy="onboarding-company-currency-select"]').click();
            cy.get('[data-cy="onboarding-company-currency-select-option-euro-(€)"]').click();

            cy.get('[data-cy="onboarding-next-btn"]').click();

            // Step 2: Address
            cy.get('[data-cy="onboarding-company-address-input"]').clear().type('123 Main Street');
            cy.get('[data-cy="onboarding-company-city-input"]').clear().type('Paris');

            // Country is now a select component
            cy.get('[data-cy="onboarding-company-country-input"]').click();
            cy.contains('[role="option"]', 'France').click();

            cy.get('[data-cy="onboarding-company-postalcode-input"]').clear().type('75001');

            cy.get('[data-cy="onboarding-next-btn"]').click();

            // Step 3: Identifiers (dynamic based on country - France has SIRET, SIREN, etc.)
            // Wait for identifier fields to load
            cy.get('[data-cy="onboarding-company-siret-input"]', { timeout: 5000 }).should('be.visible');
            cy.get('[data-cy="onboarding-company-siret-input"]').clear().type('12345678901234');
            cy.get('[data-cy="onboarding-company-vat-input"]').clear().type('FR12345678901');

            cy.get('[data-cy="onboarding-next-btn"]').click();

            // Step 4: Contact
            cy.get('[data-cy="onboarding-company-phone-input"]').clear().type('+33123456789');
            cy.get('[data-cy="onboarding-company-email-input"]').clear().type('contact@acme.org');

            cy.get('[data-cy="onboarding-next-btn"]').click();

            // Step 5: Settings
            cy.get('[data-cy="onboarding-company-pdfformat-select"]').click();
            cy.get('[data-cy="onboarding-company-pdfformat-option-pdf"]').click();

            cy.get('[data-cy="onboarding-company-dateformat-select"]').click();
            cy.get('[data-cy="onboarding-company-dateformat-option-dd/MM/yyyy"]').click();

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

        // Note: Country is now read-only in settings (set during onboarding)
        // Skipping this test as country cannot be modified
        it.skip('shows error for empty country', () => {
            cy.visit('/settings/company');
            cy.get('[data-cy="company-country-input"]', { timeout: 10000 }).clear();
            cy.get('[data-cy="company-submit-btn"]').click();
            cy.contains(/required|empty|country/i);
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

    describe('3 - Edge Cases', () => {
        it('handles special characters in company name', () => {
            cy.visit('/settings/company');
            cy.get('[data-cy="company-name-input"]', { timeout: 10000 }).clear().type("O'Reilly & Associates");
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
            cy.get('[data-cy="company-description-input"]', { timeout: 10000 }).clear().type(tooLongDescription, { delay: 0 });
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

    describe('4 - Restore Valid State (Must run last)', () => {
        it('restores valid company settings for other tests', () => {
            cy.visit('/settings/company');
            cy.wait(3000);
            cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should('be.visible');

            cy.get('[data-cy="company-name-input"]').clear().type('Acme Corp');
            cy.get('[data-cy="company-description-input"]').clear().type('A fictional company');
            // Note: legalId and VAT fields may not be populated if company was created
            // via onboarding with dynamic identifiers - skipping these for now
            cy.get('[data-cy="company-phone-input"]').clear().type('+33123456789');
            cy.get('[data-cy="company-email-input"]').clear().type('contact@acme.org');
            cy.get('[data-cy="company-address-input"]').clear().type('123 Main St');
            cy.get('[data-cy="company-city-input"]').clear().type('Paris');
            cy.get('[data-cy="company-postalcode-input"]').clear().type('75001');
            // Note: country is now read-only in settings (set during onboarding)

            cy.get('[data-cy="company-currency-select"]').click();
            cy.get('[data-cy="company-currency-select-option-euro-(€)"]').click();

            cy.get('[data-cy="company-pdfformat-select"]').click();
            cy.get('[data-cy="company-pdfformat-option-pdf"]').click();

            cy.get('[data-cy="company-dateformat-select"]').click();
            cy.get('[data-cy="company-dateformat-option-dd-MM-yyyy"]').first().click();

            cy.get('[data-cy="company-submit-btn"]').click();
            cy.wait(5000);

            cy.visit('/settings/company');
            cy.wait(3000);
            cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should('be.visible');
            cy.get('[data-cy="company-name-input"]').should('have.value', 'Acme Corp');
        });
    });
});