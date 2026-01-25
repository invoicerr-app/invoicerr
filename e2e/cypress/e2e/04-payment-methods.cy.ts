beforeEach(() => {
    cy.login();
});

describe('Payment Methods E2E', () => {
    describe('Page Load', () => {
        it('loads payment methods page', () => {
            cy.visit('/payment-methods');
            // Wait for any modals to close
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains(/payment method|moyen de paiement/i, { timeout: 10000 });
        });

        it('shows add button', () => {
            cy.visit('/payment-methods');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|ajouter/i, { timeout: 10000 }).should('be.visible');
        });
    });

    describe('Create Dialog', () => {
        it('opens create dialog', () => {
            cy.visit('/payment-methods');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);
            cy.get('input[name="name"]').should('be.visible');
        });

        it('has all form fields', () => {
            cy.visit('/payment-methods');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);
            cy.get('input[name="name"]').should('exist');
            cy.get('input[name="details"]').should('exist');
            cy.get('button[role="combobox"]').should('exist');
        });

        it('creates a payment method and dialog closes', () => {
            cy.visit('/payment-methods');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            const uniqueName = `Bank Transfer ${Date.now()}`;
            cy.get('input[name="name"]').clear().type(uniqueName);
            cy.get('input[name="details"]').clear().type('IBAN: FR76 1234');

            cy.get('button[type="submit"]').last().click({ force: true });
            cy.wait(2000);

            cy.get('input[name="name"]').should('not.exist');
        });
    });

    describe('Validation', () => {
        it('shows error for empty name', () => {
            cy.visit('/payment-methods');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('input[name="name"]').clear();
            cy.get('button[type="submit"]').last().click({ force: true });
            cy.contains(/required|requis|name/i);
        });
    });

    describe('Type Selection', () => {
        it('can select PayPal type', () => {
            cy.visit('/payment-methods');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('button[role="combobox"]').click({ force: true });
            cy.wait(200);
            cy.get('[role="option"]').contains(/paypal/i).click({ force: true });
            cy.get('button[role="combobox"]').should('contain.text', 'PayPal');
        });

        it('can select Cash type', () => {
            cy.visit('/payment-methods');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('button[role="combobox"]').click({ force: true });
            cy.wait(200);
            cy.get('[role="option"]').contains(/cash|espèces/i).click({ force: true });
        });
    });
});
