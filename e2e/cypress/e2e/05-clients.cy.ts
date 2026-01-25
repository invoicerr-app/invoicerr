beforeEach(() => {
    cy.login();
});

describe('Clients E2E', () => {
    describe('Create Clients', () => {
        it('creates a company client', () => {
            cy.visit('/clients');
            // Wait for any modals to close
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('ACME Corporation');
            cy.get('[name="description"]').clear().type('A leading technology company');
            cy.get('[name="legalId"]').clear().type('US12345678901');

            cy.get('[data-cy="client-currency-select"] button').click({ force: true });
            cy.get('[data-cy="client-currency-select-options"]').should('be.visible');
            cy.get('[data-cy="client-currency-select"] input').type('Euro');
            cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click({ force: true });

            cy.get('[name="contactEmail"]').clear().type('contact@acme.org');
            cy.get('[name="contactPhone"]').clear().type('+1 23 456 7890');
            cy.get('[name="address"]').clear().type('123 Tech Boulevard');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('San Francisco');
            cy.get('[name="country"]').clear().type('USA');

            cy.get('[data-cy="client-submit"]').click({ force: true });

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('ACME Corporation', { timeout: 10000 });
        });

        it('creates an individual client', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="client-type-select"]').click({ force: true });
            cy.get('[data-cy="client-type-individual"]').click({ force: true });

            cy.get('[name="contactFirstname"]').clear().type('Jane');
            cy.get('[name="contactLastname"]').clear().type('Doe');
            cy.get('[name="description"]').clear().type('Freelance developer');

            cy.get('[data-cy="client-currency-select"] button').click({ force: true });
            cy.get('[data-cy="client-currency-select-options"]').should('be.visible');
            cy.get('[data-cy="client-currency-select"] input').type('Dollar');
            cy.get('[data-cy="client-currency-select-option-united-states-dollar-($)"]').click({ force: true });

            cy.get('[name="contactEmail"]').clear().type('jane.doe@freelance.org');
            cy.get('[name="contactPhone"]').clear().type('+1 98 765 4321');
            cy.get('[name="address"]').clear().type('456 Developer Lane');
            cy.get('[name="postalCode"]').clear().type('67890');
            cy.get('[name="city"]').clear().type('Los Angeles');
            cy.get('[name="country"]').clear().type('USA');

            cy.get('[data-cy="client-submit"]').click({ force: true });

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('Jane', { timeout: 10000 });
            cy.contains('Doe');
        });
    });

    describe('Validation Errors - Company', () => {
        it('shows error for empty company name', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear();
            cy.get('[name="legalId"]').clear().type('12345');
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');
            cy.get('[name="country"]').clear().type('Test Country');

            cy.get('[data-cy="client-submit"]').click({ force: true });
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|nom/i);
        });

        it('shows error for empty legalId (company)', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('Test Company');
            cy.get('[name="legalId"]').clear();
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');
            cy.get('[name="country"]').clear().type('Test Country');

            cy.get('[data-cy="client-submit"]').click({ force: true });
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|siret|legal/i);
        });
    });

    describe('Validation Errors - Individual', () => {
        it('shows error for empty firstname (individual)', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="client-type-select"]').click({ force: true });
            cy.get('[data-cy="client-type-individual"]').click({ force: true });

            cy.get('[name="contactFirstname"]').clear();
            cy.get('[name="contactLastname"]').clear().type('Smith');
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');
            cy.get('[name="country"]').clear().type('Test Country');

            cy.get('[data-cy="client-submit"]').click({ force: true });
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|firstname|prénom/i);
        });

        it('shows error for empty lastname (individual)', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="client-type-select"]').click({ force: true });
            cy.get('[data-cy="client-type-individual"]').click({ force: true });

            cy.get('[name="contactFirstname"]').clear().type('John');
            cy.get('[name="contactLastname"]').clear();
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');
            cy.get('[name="country"]').clear().type('Test Country');

            cy.get('[data-cy="client-submit"]').click({ force: true });
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|lastname|nom/i);
        });
    });

    describe('Common Validation Errors', () => {
        it('shows error for empty email', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('Test Company');
            cy.get('[name="legalId"]').clear().type('12345');
            cy.get('[name="contactEmail"]').clear();
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');
            cy.get('[name="country"]').clear().type('Test Country');

            cy.get('[data-cy="client-submit"]').click({ force: true });
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|email/i);
        });

        it('shows error for invalid email format', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="contactEmail"]').clear().type('not-an-email');
            cy.get('[data-cy="client-submit"]').click({ force: true });
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/format|invalid|invalide|email/i);
        });

        it('shows error for invalid postal code format', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="name"]').clear().type('Test Company');
            cy.get('[name="legalId"]').clear().type('12345');
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('AB');
            cy.get('[name="city"]').clear().type('Test City');
            cy.get('[name="country"]').clear().type('Test Country');

            cy.get('[data-cy="client-submit"]').click({ force: true });
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/format|invalid|invalide|postal|code/i);
        });

        it('shows error for invalid VAT format', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="name"]').clear().type('Test Company');
            cy.get('[name="legalId"]').clear().type('12345');
            cy.get('[name="VAT"]').clear().type('123456');
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');
            cy.get('[name="country"]').clear().type('Test Country');

            cy.get('[data-cy="client-submit"]').click({ force: true });
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/format|invalid|invalide|vat|tva/i);
        });
    });

    describe('Edge Cases', () => {
        it('handles special characters in name', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type("O'Reilly & Associates, Inc.");
            cy.get('[name="legalId"]').clear().type('US98765432101');
            cy.get('[name="contactEmail"]').clear().type('info@oreilly.com');
            cy.get('[name="address"]').clear().type('789 Publishing Way');
            cy.get('[name="postalCode"]').clear().type('11111');
            cy.get('[name="city"]').clear().type('New York');
            cy.get('[name="country"]').clear().type('USA');

            cy.get('[data-cy="client-submit"]').click({ force: true });

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains("O'Reilly", { timeout: 10000 });
        });

        it('handles unicode characters', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('Société Française SAS');
            cy.get('[name="legalId"]').clear().type('FR12345678901');
            cy.get('[name="VAT"]').clear().type('FR12345678901');
            cy.get('[name="contactEmail"]').clear().type('contact@societe.fr');
            cy.get('[name="address"]').clear().type('1 Rue de la Paix');
            cy.get('[name="postalCode"]').clear().type('75001');
            cy.get('[name="city"]').clear().type('Paris');
            cy.get('[name="country"]').clear().type('France');

            cy.get('[data-cy="client-submit"]').click({ force: true });

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('Société Française', { timeout: 10000 });
        });

        it('accepts valid EU VAT format', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('German Company GmbH');
            cy.get('[name="legalId"]').clear().type('DE123456789');
            cy.get('[name="VAT"]').clear().type('DE123456789');
            cy.get('[name="contactEmail"]').clear().type('contact@german.de');
            cy.get('[name="address"]').clear().type('Hauptstrasse 1');
            cy.get('[name="postalCode"]').clear().type('10115');
            cy.get('[name="city"]').clear().type('Berlin');
            cy.get('[name="country"]').clear().type('Germany');

            cy.get('[data-cy="client-submit"]').click({ force: true });

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('German Company', { timeout: 10000 });
        });
    });

    describe('Search Clients', () => {
        it('searches for a client by name', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);
            cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type('ACME');
            cy.wait(500);
            cy.contains('ACME Corporation');
        });

        it('searches for a client by email', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);
            cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type('jane.doe');
            cy.wait(500);
            cy.contains('Jane');
        });
    });

    describe('View Client Details', () => {
        it('views a client details', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);
            cy.get('[data-cy="view-client-button-jane.doe@freelance.org"]').click({ force: true });
            cy.contains('Jane Doe');
            cy.contains('jane.doe@freelance.org');
        });
    });

    describe('Edit Clients', () => {
        it('edits an existing client', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.get('[data-cy="edit-client-button-jane.doe@freelance.org"]').click({ force: true });

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="description"]').clear().type('A global technology leader');
            cy.get('[data-cy="client-submit"]').click({ force: true });

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.wait(2000);

            cy.get('[data-cy="edit-client-button-jane.doe@freelance.org"]').click({ force: true });
            cy.wait(2000);
            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="description"]').should('have.value', 'A global technology leader');

            cy.get('[data-cy="client-cancel"]').click({ force: true });
        });
    });

    describe('Delete Clients', () => {
        it('deletes a client', () => {
            cy.visit('/clients');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.get('[data-cy="delete-client-button-contact@german.de"]').click({ force: true });

            cy.get('[data-cy="confirm-delete-client-button"]', { timeout: 5000 }).should('be.visible');
            cy.get('[data-cy="confirm-delete-client-button"]').click({ force: true });

            cy.wait(2000);
            cy.get('[data-cy="client-status-inactive-contact@german.de"]').should('exist');
        });
    });
});
