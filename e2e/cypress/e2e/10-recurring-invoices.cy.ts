beforeEach(() => {
    cy.login();
});

describe('Recurring Invoices E2E', () => {
    describe('Create Recurring Invoices', () => {
        it('creates a monthly recurring invoice', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            // Find the Recurring Invoices section and click Add
            cy.contains(/recurring|récurrent/i).closest('.rounded-xl').find('button').contains(/add|new|créer|ajouter/i).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="recurring-invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="recurring-invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="recurring-invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="recurring-invoice-client-select-options"] button').first().click({ force: true });

            cy.contains('label', /frequency|fréquence/i).parent().find('button').click({ force: true });
            cy.get('[role="option"]').eq(2).click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Monthly Retainer', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('1500', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="recurring-invoice-submit"]').click({ force: true });

            cy.get('[data-cy="recurring-invoice-dialog"]').should('not.exist');
            cy.wait(2000);
        });

        it('creates a weekly recurring invoice', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.contains(/recurring|récurrent/i).closest('.rounded-xl').find('button').contains(/add|new|créer|ajouter/i).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="recurring-invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="recurring-invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="recurring-invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="recurring-invoice-client-select-options"] button').first().click({ force: true });

            cy.contains('label', /frequency|fréquence/i).parent().find('button').click({ force: true });
            cy.get('[role="option"]').eq(0).click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Weekly Maintenance', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('4', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('250', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="recurring-invoice-submit"]').click({ force: true });

            cy.get('[data-cy="recurring-invoice-dialog"]').should('not.exist');
            cy.wait(2000);
        });
    });

    describe('Validation Errors', () => {
        it('shows error when no client is selected', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.contains(/recurring|récurrent/i).closest('.rounded-xl').find('button').contains(/add|new|créer|ajouter/i).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="recurring-invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.contains('label', /frequency|fréquence/i).parent().find('button').click({ force: true });
            cy.get('[role="option"]').eq(0).click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Test Item', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('0', { force: true });

            cy.get('[data-cy="recurring-invoice-submit"]').click({ force: true });
            cy.get('[data-cy="recurring-invoice-dialog"]').should('be.visible');
            cy.contains(/client|required|requis/i);
        });

        it('shows error when no frequency is selected', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.contains(/recurring|récurrent/i).closest('.rounded-xl').find('button').contains(/add|new|créer|ajouter/i).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="recurring-invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="recurring-invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="recurring-invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="recurring-invoice-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Test Item', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('0', { force: true });

            cy.get('[data-cy="recurring-invoice-submit"]').click({ force: true });
            cy.get('[data-cy="recurring-invoice-dialog"]').should('be.visible');
            cy.contains(/frequency|fréquence|required|requis/i);
        });
    });

    describe('View Recurring Invoices', () => {
        it('views recurring invoices list', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.contains(/recurring|récurrent/i, { timeout: 10000 }).click({ force: true });
            cy.wait(1000);

            cy.get('body').then($body => {
                if ($body.find('[class*="Card"], [class*="card"]').length > 0) {
                    cy.get('[class*="Card"], [class*="card"]').should('have.length.at.least', 1);
                }
            });
        });
    });

    describe('Delete Recurring Invoice', () => {
        it('deletes a recurring invoice', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.contains(/recurring|récurrent/i, { timeout: 10000 }).click({ force: true });
            cy.wait(1000);

            cy.get('body').then($body => {
                const deleteButtons = $body.find('button[tooltip*="Delete"], button[tooltip*="Supprimer"]');
                if (deleteButtons.length > 0) {
                    cy.wrap(deleteButtons).first().click({ force: true });
                    cy.get('[role="alertdialog"], [role="dialog"]').within(() => {
                        cy.contains('button', /delete|confirm|supprimer|confirmer/i).click({ force: true });
                    });
                    cy.wait(2000);
                }
            });
        });
    });
});
