beforeEach(() => {
    cy.login();
});

describe('Payments E2E', () => {
    describe('Create Payments', () => {
        it('creates a payment from an invoice', () => {
            cy.visit('/payments');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="payment-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="payment-invoice-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="payment-invoice-select-options"]').should('be.visible');
            cy.get('[data-cy="payment-invoice-select-options"] button').first().click();

            cy.wait(500);

            cy.get('[data-cy="payment-submit"]').click();

            cy.get('[data-cy="payment-dialog"]').should('not.exist');
            cy.wait(2000);
        });

        it('creates a payment with a specific payment method', () => {
            cy.visit('/payments');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="payment-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="payment-invoice-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="payment-invoice-select-options"]').should('be.visible');
            cy.get('[data-cy="payment-invoice-select-options"] button').first().click();

            cy.wait(500);

            cy.get('button[role="combobox"][aria-label*="ayment"], select[name="paymentMethodId"]').first().click({ force: true });
            cy.get('[role="option"]').first().click();

            cy.get('[data-cy="payment-submit"]').click();

            cy.get('[data-cy="payment-dialog"]').should('not.exist');
            cy.wait(2000);
        });
    });

    describe('View Payments', () => {
        it('views payment list', () => {
            cy.visit('/payments');
            cy.wait(2000);

            cy.get('body').then($body => {
                if ($body.find('[class*="Card"], [class*="card"]').length > 0) {
                    cy.get('[class*="Card"], [class*="card"]').should('have.length.at.least', 1);
                } else {
                    cy.contains(/no payment|aucun paiement|empty/i);
                }
            });
        });
    });

    describe('Payment Actions', () => {
        it('opens payment view dialog', () => {
            cy.visit('/payments');
            cy.wait(2000);

            cy.get('body').then($body => {
                // Look for View PDF button (Receipt icon)
                const buttons = $body.find('button:has(svg.lucide-receipt)');
                if (buttons.length > 0) {
                    cy.wrap(buttons).first().click({ force: true });
                    cy.get('[role="dialog"]').should('be.visible');
                }
            });
        });
    });

    describe('Delete Payments', () => {
        it('deletes a payment', () => {
            cy.visit('/payments');
            cy.wait(2000);

            cy.get('body').then($body => {
                const deleteButtons = $body.find('button[tooltip*="Delete"], button[tooltip*="Supprimer"]');
                if (deleteButtons.length > 0) {
                    cy.wrap(deleteButtons).first().click({ force: true });
                    cy.get('[role="alertdialog"], [role="dialog"]').within(() => {
                        cy.contains('button', /delete|confirm|supprimer|confirmer/i).click();
                    });
                    cy.wait(2000);
                }
            });
        });
    });
});
