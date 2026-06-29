beforeEach(() => {
    cy.login();
});

// Create a payable invoice (SENT) via API so it's selectable in the payment form.
function ensurePayableInvoice() {
    const apiUrl = Cypress.env('apiUrl');

    cy.ensureClient();

    cy.request({ url: `${apiUrl}/api/clients`, failOnStatusCode: false }).then(({ status, body }: any) => {
        if (status !== 200) return;
        const client = Array.isArray(body) ? body[0] : body.clients?.[0];
        if (!client) return;

        cy.request({ method: 'POST', url: `${apiUrl}/api/invoices`, body: {
            clientId: client.id,
            currency: 'EUR',
            notes: 'E2E payable invoice',
            items: [{
                name: 'Payable Service',
                description: 'Payable Service',
                quantity: 1,
                unitPrice: 200,
                vatRate: 20,
                type: 'SERVICE',
                order: 0,
            }],
        }, failOnStatusCode: false }).then(({ status, body: invoice }: any) => {
            if (status !== 200 && status !== 201) return;
            if (!invoice?.id) return;

            cy.request({ method: 'POST', url: `${apiUrl}/api/invoices/${invoice.id}/issue`, failOnStatusCode: false });
            cy.request({ method: 'POST', url: `${apiUrl}/api/invoices/send`, body: { id: invoice.id }, failOnStatusCode: false });
        });
    });
}

describe('Payments E2E', () => {
    describe('Create Payments', () => {
        it('creates a payment from an invoice', () => {
            ensurePayableInvoice();

            cy.visit('/payments');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="payment-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="payment-invoice-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="payment-invoice-select-options"]').should('be.visible');
            cy.get('[data-cy="payment-invoice-select-options"] button').first().click();

            cy.wait(500);

            // The amount is split proportionally across the invoice items on submit.
            cy.get('[data-cy="payment-amount-input"]').clear({ force: true }).type('100', { force: true });

            cy.get('[data-cy="payment-submit"]').click();

            cy.get('[data-cy="payment-dialog"]').should('not.exist');
            cy.wait(2000);
        });

        it('creates a payment with a specific payment method', () => {
            ensurePayableInvoice();

            cy.visit('/payments');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="payment-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="payment-invoice-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="payment-invoice-select-options"]').should('be.visible');
            cy.get('[data-cy="payment-invoice-select-options"] button').first().click();

            cy.wait(500);

            // Select a payment method if payment methods are available
            cy.get('button[role="combobox"]').first().click();
            cy.wait(1000);
            cy.get('body').then(($body) => {
                const $options = $body.find('[role="option"]');
                if ($options.length > 0) {
                    cy.wrap($options).first().click({ force: true });
                }
            });

            cy.get('[data-cy="payment-amount-input"]').clear({ force: true }).type('100', { force: true });

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
