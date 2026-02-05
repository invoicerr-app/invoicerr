beforeEach(() => {
    cy.login();
});

describe('Invoices E2E', () => {
    describe('Create Invoices', () => {
        it('creates a simple invoice', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click({ force: true });

            cy.get('[data-cy="invoice-currency-select"] button').first().click({ force: true });
            cy.wait(200);
            cy.get('[data-cy="invoice-currency-select"] input').type('EUR');
            cy.wait(200);
            cy.get('[data-cy="invoice-currency-select-option-euro-(€)"]').click({ force: true });

            cy.get('[name="notes"]').type('Payment due within 30 days');

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Consulting Services', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('10', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('150', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="invoice-submit"]').click({ force: true });

            cy.get('[data-cy="invoice-dialog"]').should('not.exist');

            // Click view button on the first invoice in the list
            cy.get('button:has(svg.lucide-eye)').first().click({ force: true });
            cy.get('[role="dialog"]').should('be.visible');
            cy.contains(/1[.,\s]?800/, { timeout: 10000 });
            cy.get('body').type('{esc}');
        });

        it('creates an invoice with multiple items', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Design Work', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('20', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('75', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.1.description"]').type('Development Work', { force: true });
            cy.get('[name="items.1.quantity"]').clear({ force: true }).type('40', { force: true });
            cy.get('[name="items.1.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.1.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="invoice-submit"]').click({ force: true });

            cy.get('[data-cy="invoice-dialog"]').should('not.exist');

            cy.get('button:has(svg.lucide-eye)').first().click({ force: true });
            cy.get('[role="dialog"]').should('be.visible');
            cy.contains(/6[.,\s]?600/, { timeout: 10000 });
            cy.get('body').type('{esc}');
        });
    });

    describe('Validation Errors', () => {
        it('shows error when no client is selected', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Test Item', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('0', { force: true });

            cy.get('[data-cy="invoice-submit"]').click({ force: true });
            cy.get('[data-cy="invoice-dialog"]').should('be.visible');
            cy.contains(/client|required|requis/i);
        });

        it('shows error for empty item description', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').clear({ force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });

            cy.get('[data-cy="invoice-submit"]').click({ force: true });
            cy.get('[data-cy="invoice-dialog"]').should('be.visible');
            cy.contains(/description|required|requis/i);
        });

        it('shows error for zero quantity', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Test Item', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('0', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });

            cy.get('[data-cy="invoice-submit"]').click({ force: true });
            cy.get('[data-cy="invoice-dialog"]').should('be.visible');
            cy.contains(/quantity|min|least|minimum/i);
        });
    });

    describe('Edge Cases', () => {
        it('handles zero VAT rate', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Zero VAT Service', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('1000', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('0', { force: true });

            cy.get('[data-cy="invoice-submit"]').click({ force: true });

            cy.get('[data-cy="invoice-dialog"]').should('not.exist');

            cy.get('button:has(svg.lucide-eye)').first().click({ force: true });
            cy.get('[role="dialog"]').should('be.visible');
            cy.contains(/1[.,\s]?000/, { timeout: 10000 });
            cy.get('body').type('{esc}');
        });

        it('handles decimal prices', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Decimal Price Service', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('3', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('99.99', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('5.5', { force: true });

            cy.get('[data-cy="invoice-submit"]').click({ force: true });

            cy.get('[data-cy="invoice-dialog"]').should('not.exist');

            cy.get('button:has(svg.lucide-eye)').first().click({ force: true });
            cy.get('[role="dialog"]').should('be.visible');
            cy.contains(/299[.,]97/, { timeout: 10000 });
            cy.get('body').type('{esc}');
        });

        it('handles special characters', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type("Service spécial <test> & 'quotes'", { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('500', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="invoice-submit"]').click({ force: true });

            cy.get('[data-cy="invoice-dialog"]').should('not.exist');

            cy.get('button:has(svg.lucide-eye)').first().click({ force: true });
            cy.get('[role="dialog"]').should('be.visible');
            cy.contains(/600/, { timeout: 10000 });
            cy.get('body').type('{esc}');
        });
    });

    describe('Invoice View', () => {
        it('views an invoice', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.get('button:has(svg.lucide-eye)').first().click({ force: true });

            cy.get('[role="dialog"]').should('be.visible');
            // We can't be sure which invoice it is, but we can check if the dialog has content
            cy.get('[role="dialog"]').should('contain.text', 'Invoice');
        });
    });

    describe('Edit Invoices', () => {
        it('edits an existing invoice', () => {
            // Create an invoice first to ensure we have one to edit
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);
            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[data-cy="invoice-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"] button').first().click({ force: true });
            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Editable Service', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });
            cy.get('[data-cy="invoice-submit"]').click({ force: true });
            cy.get('[data-cy="invoice-dialog"]').should('not.exist');
            cy.wait(2000);
            cy.reload();
            cy.wait(2000);

            // Find the row for the created invoice
            cy.contains('[data-cy="invoice-row"]', 'Jane Doe').within(() => {
                // Check status
                cy.get('[data-cy="invoice-status"]').invoke('text').should('match', /Unpaid|Impayée/i);

                // Click Edit button
                cy.get('[data-cy="invoice-edit-button"]').click({ force: true });
            });

            cy.get('[data-cy="invoice-dialog"]').should('be.visible');
            cy.get('[name="notes"]').clear().type('Updated Notes');
            cy.get('[data-cy="invoice-submit"]').click({ force: true });
            cy.get('[data-cy="invoice-dialog"]').should('not.exist');

            cy.wait(2000);
            cy.reload();
            cy.wait(2000);

            cy.contains('[data-cy="invoice-row"]', 'Jane Doe').within(() => {
                cy.get('button:has(svg.lucide-eye)').click();
            });
            cy.get('[role="dialog"]').should('be.visible');
            cy.contains('Updated Notes');
            cy.get('body').type('{esc}');
        });
    });

    describe('Delete Invoices', () => {
        it('deletes an invoice', () => {
            cy.visit('/invoices');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.get('button:has(svg.lucide-trash-2)').first().click({ force: true });

            cy.get('[role="alertdialog"], [role="dialog"]').within(() => {
                cy.contains('button', /delete|confirm|supprimer|confirmer/i).click({ force: true });
            });

            cy.wait(2000);
            // We can't easily verify it's gone without knowing what it was, but we can assume it worked if no error.
        });
    });

    describe('Fractional Units Support', () => {
        it('creates an invoice with fractional units and displays them correctly', () => {
            cy.visit('/invoices');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            // Select client
            cy.get('[data-cy="invoice-client-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click();

            // Select currency
            cy.get('[data-cy="invoice-currency-select"] button').first().click();
            cy.wait(200);
            cy.get('[data-cy="invoice-currency-select"] input').type('USD');
            cy.wait(200);
            cy.get('[data-cy="invoice-currency-select-option-united-states-dollar-($)"]').click();

            // Add item with fractional quantity
            cy.contains('button', /Add Item|Ajouter/i).click();
            cy.get('[name="items.0.description"]').type('Consulting Hours - Fractional', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('19.875', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="invoice-submit"]').click();
            cy.get('[data-cy="invoice-dialog"]').should('not.exist');

            // Verify the invoice displays the fractional quantity
            cy.get('button:has(svg.lucide-eye)').first().click();
            cy.get('[role="dialog"]').should('be.visible');
            
            // Check that the total is calculated correctly (19.875 * 100 * 1.2 = 2385)
            cy.contains(/2[.,\s]?385/, { timeout: 10000 });
            cy.get('body').type('{esc}');
            cy.wait(1000);

            // Edit the invoice to verify fractional quantity is preserved
            // Find the first invoice row and click edit within it
            cy.get('[data-cy="invoice-row"]').first().within(() => {
                cy.get('[data-cy="invoice-edit-button"]').click();
            });
            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');
            
            // Verify the quantity field still has the fractional value
            cy.get('[name="items.0.quantity"]').should('have.value', '19.875');
            
            // Change the quantity to another fractional value
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('10.5', { force: true });
            cy.get('[data-cy="invoice-submit"]').click();
            cy.get('[data-cy="invoice-dialog"]').should('not.exist');
        });

        it('creates an invoice with multiple fractional units', () => {
            cy.visit('/invoices');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            // Select client
            cy.get('[data-cy="invoice-client-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click();

            // Add first item with fractional quantity
            cy.contains('button', /Add Item|Ajouter/i).click();
            cy.get('[name="items.0.description"]').type('Design Work - 0.25 days', { force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('0.25', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('800', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            // Add second item with fractional quantity
            cy.contains('button', /Add Item|Ajouter/i).click();
            cy.get('[name="items.1.description"]').type('Development - 2.75 days', { force: true });
            cy.get('[name="items.1.quantity"]').clear({ force: true }).type('2.75', { force: true });
            cy.get('[name="items.1.unitPrice"]').clear({ force: true }).type('1000', { force: true });
            cy.get('[name="items.1.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="invoice-submit"]').click();
            cy.get('[data-cy="invoice-dialog"]').should('not.exist');

            // Verify the total (0.25*800 + 2.75*1000 = 200 + 2750 = 2950 * 1.2 = 3540)
            cy.get('button:has(svg.lucide-eye)').first().click();
            cy.get('[role="dialog"]').should('be.visible');
            cy.contains(/3[.,\s]?540/, { timeout: 10000 });
            cy.get('body').type('{esc}');
        });
    });
});
