beforeEach(() => {
    cy.login();
});

describe('Receipts E2E', () => {
    describe('Create Receipts', () => {
        it('creates a receipt from an invoice', () => {
            cy.visit('/receipts');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="receipt-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="receipt-invoice-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="receipt-invoice-select-options"]').should('be.visible');
            cy.get('[data-cy="receipt-invoice-select-options"] button').first().click();

            cy.wait(500);

            cy.get('[data-cy="receipt-submit"]').click();

            cy.get('[data-cy="receipt-dialog"]').should('not.exist');
            cy.wait(2000);
        });

        it('creates a receipt with a specific payment method', () => {
            cy.visit('/receipts');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="receipt-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="receipt-invoice-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="receipt-invoice-select-options"]').should('be.visible');
            cy.get('[data-cy="receipt-invoice-select-options"] button').first().click();

            cy.wait(500);

            cy.get('button[role="combobox"][aria-label*="ayment"], select[name="paymentMethodId"]').first().click({ force: true });
            cy.get('[role="option"]').first().click();

            cy.get('[data-cy="receipt-submit"]').click();

            cy.get('[data-cy="receipt-dialog"]').should('not.exist');
            cy.wait(2000);
        });
    });

    describe('View Receipts', () => {
        it('views receipt list', () => {
            cy.visit('/receipts');
            cy.wait(2000);

            cy.get('body').then($body => {
                if ($body.find('[class*="Card"], [class*="card"]').length > 0) {
                    cy.get('[class*="Card"], [class*="card"]').should('have.length.at.least', 1);
                } else {
                    cy.contains(/no receipt|aucun reçu|empty/i);
                }
            });
        });
    });

    describe('Receipt Actions', () => {
        it('opens receipt view dialog', () => {
            cy.visit('/receipts');
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

    describe('Delete Receipts', () => {
        it('deletes a receipt', () => {
            cy.visit('/receipts');
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
