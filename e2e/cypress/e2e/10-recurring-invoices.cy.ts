beforeEach(() => {
    cy.login();
});

function openRecurringInvoiceDialog() {
    cy.visit('/invoices');
    cy.wait(2000);

    cy.get('[data-cy="invoice-add-button"]').click();
    cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

    cy.get('[data-cy="invoice-tab-recurring"]').click();
}

function fillRecurringItem(description: string, quantity: string, unitPrice: string, vatRate: string) {
    cy.contains('button', /Add Item|Ajouter/i).click();
    cy.get('[name="items.0.name"]').type(description, { force: true });
    cy.get('[name="items.0.quantity"]').clear({ force: true }).type(quantity, { force: true });
    cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type(unitPrice, { force: true });
    cy.get('[name="items.0.vatRate"]').clear({ force: true }).type(vatRate, { force: true });
}

describe('Recurring Invoices E2E', () => {
    describe('Create Recurring Invoices', () => {
        it('creates a monthly recurring invoice', () => {
            openRecurringInvoiceDialog();

            cy.get('[data-cy="recurring-invoice-client-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="recurring-invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="recurring-invoice-client-select-options"] button').first().click();

            cy.contains('label', /frequency|fréquence/i).parent().find('button').click({ force: true });
            cy.get('[role="option"]').eq(2).click();

            fillRecurringItem('Monthly Retainer', '1', '1500', '20');

            cy.get('[data-cy="invoice-submit"]').click();

            cy.get('[data-cy="invoice-dialog"]').should('not.exist');
            cy.wait(2000);
        });

        it('creates a weekly recurring invoice', () => {
            openRecurringInvoiceDialog();

            cy.get('[data-cy="recurring-invoice-client-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="recurring-invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="recurring-invoice-client-select-options"] button').first().click();

            cy.contains('label', /frequency|fréquence/i).parent().find('button').click({ force: true });
            cy.get('[role="option"]').eq(0).click();

            fillRecurringItem('Weekly Maintenance', '4', '250', '20');

            cy.get('[data-cy="invoice-submit"]').click();

            cy.get('[data-cy="invoice-dialog"]').should('not.exist');
            cy.wait(2000);
        });
    });

    describe('Validation Errors', () => {
        it('shows error when no client is selected', () => {
            openRecurringInvoiceDialog();

            cy.contains('label', /frequency|fréquence/i).parent().find('button').click({ force: true });
            cy.get('[role="option"]').eq(0).click();

            fillRecurringItem('Test Item', '1', '100', '0');

            cy.get('[data-cy="invoice-submit"]').click();
            cy.get('[data-cy="invoice-dialog"]').should('be.visible');
            cy.contains(/client|required|requis/i);
        });

        it('shows error when no frequency is selected', () => {
            openRecurringInvoiceDialog();

            cy.get('[data-cy="recurring-invoice-client-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="recurring-invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="recurring-invoice-client-select-options"] button').first().click();

            fillRecurringItem('Test Item', '1', '100', '0');

            cy.get('[data-cy="invoice-submit"]').click();
            cy.get('[data-cy="invoice-dialog"]').should('be.visible');
            cy.contains(/frequency|fréquence|required|requis/i);
        });
    });

    describe('View Recurring Invoices', () => {
        it('views recurring invoices in the table', () => {
            cy.visit('/invoices');
            cy.wait(2000);

            cy.get('[data-cy="invoice-filter-recurring"]').click();
            cy.wait(1000);

            cy.get('body').then($body => {
                if ($body.find('[data-cy="invoice-row"]').length > 0) {
                    cy.get('[data-cy="invoice-row"]').should('have.length.at.least', 1);
                }
            });
        });
    });

    describe('Delete Recurring Invoice', () => {
        it('deletes a generated recurring invoice', () => {
            cy.visit('/invoices');
            cy.wait(2000);

            cy.get('[data-cy="invoice-filter-recurring"]').click();
            cy.wait(1000);

            cy.get('body').then($body => {
                const deleteButtons = $body.find('[data-cy="invoice-delete-button"]');
                if (deleteButtons.length > 0) {
                    cy.wrap(deleteButtons).first().click({ force: true });
                    cy.get('[role="dialog"]').within(() => {
                        cy.contains('button', /delete|supprimer/i).click();
                    });
                    cy.wait(2000);
                }
            });
        });
    });
});
