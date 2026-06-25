beforeEach(() => {
    cy.login();
});

// Draft and archived invoices can't receive a payment, so they aren't selectable in
// the payment form. Create an invoice via the API and send it so it becomes SENT.
function ensurePayableInvoice() {
    cy.request('/api/clients?page=1').then(({ body }) => {
        const clients = body.clients || [];
        // Prefer a client with an email so /api/invoices/send actually flips the status to SENT.
        const client = clients.find((c: any) => c.contactEmail) || clients[0];
        expect(client, 'at least one client must exist').to.exist;

        cy.request('POST', '/api/invoices', {
            clientId: client.id,
            notes: 'E2E payable invoice',
            currency: 'EUR',
            items: [{
                description: 'Payable Service',
                quantity: 1,
                unitPrice: 200,
                vatRate: 20,
                type: 'SERVICE',
                order: 0,
            }],
        }).then(({ body: invoice }) => {
            expect(invoice.id, 'created invoice id').to.exist;
            cy.request('POST', '/api/invoices/send', { id: invoice.id }).then(({ status }) => {
                expect(status).to.be.oneOf([200, 201]);
            });
        });
    });
    // Give the backend / React Query cache a moment to settle before the UI reads it.
    cy.wait(500);
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

            cy.get('button[role="combobox"][aria-label*="ayment"], select[name="paymentMethodId"]').first().click({ force: true });
            cy.get('[role="option"]').first().click();

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
