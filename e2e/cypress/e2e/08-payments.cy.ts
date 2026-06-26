beforeEach(() => {
    cy.login();
});

// Draft and archived invoices can't receive a payment, so they aren't selectable in
// the payment form. Create an invoice via the UI and send it so it becomes SENT.
function ensurePayableInvoice() {
    cy.visit('/invoices');
    cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
    cy.wait(500);

    cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

    cy.get('[data-cy="invoice-client-select"] button').first().click();
    cy.wait(300);
    cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
    cy.get('[data-cy="invoice-client-select-options"] button').first().click();

    cy.get('[data-cy="invoice-currency-select"] button').first().click();
    cy.wait(200);
    cy.get('[data-cy="invoice-currency-select"] input').type('EUR');
    cy.wait(200);
    cy.get('[data-cy="invoice-currency-select-option-euro-(€)"]').click();

    cy.contains('button', /Add Item|Ajouter/i).click();
    cy.get('[name="items.0.name"]').type('Payable Service', { force: true });
    cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
    cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('200', { force: true });
    cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

    cy.get('[data-cy="invoice-submit"]').click();
    cy.get('[data-cy="invoice-dialog"]').should('not.exist');
    cy.wait(1000);

    // Switch to the progression view: DRAFT → ISSUED → SENT.
    cy.get('[data-cy="invoice-view-progression"]').click();

    cy.get('[data-cy="invoice-progression-row"]', { timeout: 10000 }).should('have.length.at.least', 1);

    // Step 1: Issue the invoice (DRAFT → ISSUED)
    cy.get('[data-cy="invoice-progression-row"]').first().within(() => {
        cy.get('[data-cy="invoice-progression-issue"]').click();
    });
    cy.get('[role="alertdialog"]').should('be.visible').within(() => {
        cy.get('[data-cy="invoice-progression-confirm-action"]').click();
    });

    // Step 2: Send the invoice (ISSUED → SENT)
    cy.get('[data-cy="invoice-progression-row"]').first().within(() => {
        cy.get('[data-cy="invoice-progression-send"]', { timeout: 15000 }).should('exist').click();
    });
    cy.get('[role="alertdialog"]').should('be.visible').within(() => {
        cy.get('[data-cy="invoice-progression-confirm-action"]').click();
    });

    // Wait until the row exposes the "Payment received" action, meaning the invoice is now SENT.
    cy.get('[data-cy="invoice-progression-row"]').first().within(() => {
        cy.get('[data-cy="invoice-progression-paymentReceived"]', { timeout: 15000 }).should('exist');
    });

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
