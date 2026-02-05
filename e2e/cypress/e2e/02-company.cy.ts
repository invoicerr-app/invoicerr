beforeEach(() => {
    cy.login();
});

describe('Company Settings E2E', () => {
    describe('1 - Initial Company Setup (Required for other tests)', () => {
        it('creates the company via onboarding', () => {
            cy.visit('/');

            cy.get('[data-cy="onboarding-dialog"]', { timeout: 10000 }).should('be.visible');

            cy.get('[data-cy="onboarding-company-name-input"]').clear().type('Acme Corp');
            cy.get('[data-cy="onboarding-company-description-input"]').clear().type('A fictional company');
            cy.get('[data-cy="onboarding-company-legalid-input"]').clear().type('LEGAL123456');
            cy.get('[data-cy="onboarding-company-vat-input"]').clear().type('FR12345678901');

            cy.get('[data-cy="onboarding-company-currency-select"]').click();
            cy.get('[data-cy="onboarding-company-currency-select-option-euro-(€)"]').click();

            cy.get('[data-cy="onboarding-next-btn"]').click();

            cy.get('[data-cy="onboarding-company-address-input"]').clear().type('123 Main Street');
            cy.get('[data-cy="onboarding-company-postalcode-input"]').clear().type('75001');
            cy.get('[data-cy="onboarding-company-city-input"]').clear().type('Paris');
            cy.get('[data-cy="onboarding-company-country-input"]').clear().type('France');

            cy.get('[data-cy="onboarding-next-btn"]').click();

            cy.get('[data-cy="onboarding-company-phone-input"]').clear().type('+33123456789');
            cy.get('[data-cy="onboarding-company-email-input"]').clear().type('contact@acme.org');

            cy.get('[data-cy="onboarding-next-btn"]').click();

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

        it('shows error for empty country', () => {
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

    describe('Extended Address Fields', () => {
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
            cy.get('[data-cy="company-address-line2-input"]', { timeout: 10000 }).should('have.value', 'Building A, Floor 5');
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
            cy.get('[data-cy="company-country-input"]').clear().type('USA');

            cy.get('[data-cy="company-submit-btn"]').click();
            cy.wait(2000);

            cy.visit('/settings/company');
            cy.wait(3000);
            cy.get('[data-cy="company-address-line2-input"]', { timeout: 10000 }).should('have.value', 'Suite 100');
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
            cy.get('[data-cy="company-address-line2-input"]', { timeout: 10000 }).should('have.value', '');
            cy.get('[data-cy="company-state-input"]').should('have.value', '');
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
            cy.get('[data-cy="company-legalid-input"]').clear().type('LEGAL123456');
            cy.get('[data-cy="company-vat-input"]').clear().type('FR12345678901');
            cy.get('[data-cy="company-phone-input"]').clear().type('+33123456789');
            cy.get('[data-cy="company-email-input"]').clear().type('contact@acme.org');
            cy.get('[data-cy="company-address-input"]').clear().type('123 Main St');
            cy.get('[data-cy="company-address-line2-input"]').clear();
            cy.get('[data-cy="company-city-input"]').clear().type('Paris');
            cy.get('[data-cy="company-state-input"]').clear();
            cy.get('[data-cy="company-postalcode-input"]').clear().type('75001');
            cy.get('[data-cy="company-country-input"]').clear().type('France');

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