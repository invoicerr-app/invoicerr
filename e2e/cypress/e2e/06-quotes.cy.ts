beforeEach(() => {
    cy.login();
});

describe('Quotes E2E', () => {
    describe('Create Quotes', () => {
        it('creates a simple quote with one item', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="title"]').type('Website Development Quote');

            cy.get('[data-cy="quote-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
            cy.get('[data-cy="quote-client-select-options"] button').first().click({ force: true });

            cy.get('[data-cy="quote-currency-select"] button').first().click({ force: true });
            cy.wait(200);
            cy.get('[data-cy="quote-currency-select"] input').type('USD');
            cy.wait(200);
            cy.get('[data-cy="quote-currency-select-option-united-states-dollar-($)"]').click({ force: true });

            cy.get('[name="notes"]').type('Thank you for your business!');

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Full website development');
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('5000', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="quote-submit"]').click({ force: true });

            cy.get('[data-cy="quote-dialog"]').should('not.exist');
            cy.contains('Website Development Quote', { timeout: 10000 });
        });

        it('creates a quote with multiple items', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="title"]').type('Software Development Project');

            cy.get('[data-cy="quote-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
            cy.get('[data-cy="quote-client-select-options"] button').first().click({ force: true });

            cy.get('[data-cy="quote-currency-select"] button').first().click({ force: true });
            cy.wait(200);
            cy.get('[data-cy="quote-currency-select"] input').type('EUR');
            cy.wait(200);
            cy.get('[data-cy="quote-currency-select-option-euro-(€)"]').click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Backend Development');
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('40', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.1.description"]').type('Frontend Development');
            cy.get('[name="items.1.quantity"]').clear({ force: true }).type('30', { force: true });
            cy.get('[name="items.1.unitPrice"]').clear({ force: true }).type('90', { force: true });
            cy.get('[name="items.1.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="quote-submit"]').click({ force: true });

            cy.get('[data-cy="quote-dialog"]').should('not.exist');
            cy.contains('Software Development Project', { timeout: 10000 });
        });
    });

    describe('Validation Errors', () => {
        it('shows error when no client is selected', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="title"]').type('Test Quote');

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Test Item');
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('0', { force: true });

            cy.get('[data-cy="quote-submit"]').click({ force: true });
            cy.get('[data-cy="quote-dialog"]').should('be.visible');
            cy.contains(/client|required|requis/i);
        });

        it('shows error for empty item description', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="quote-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
            cy.get('[data-cy="quote-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').clear({ force: true });
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });

            cy.get('[data-cy="quote-submit"]').click({ force: true });
            cy.get('[data-cy="quote-dialog"]').should('be.visible');
            cy.contains(/description|required|requis/i);
        });

        it('shows error for zero quantity', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="quote-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
            cy.get('[data-cy="quote-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Test Item');
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('0', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });

            cy.get('[data-cy="quote-submit"]').click({ force: true });
            cy.get('[data-cy="quote-dialog"]').should('be.visible');
            cy.contains(/quantity|min|least|minimum/i);
        });

        it('shows error for negative price', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="quote-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
            cy.get('[data-cy="quote-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Test Item');
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('-50', { force: true });

            cy.get('[data-cy="quote-submit"]').click({ force: true });
            cy.get('[data-cy="quote-dialog"]').should('be.visible');
            cy.contains(/price|min|negative|négatif|positif/i);
        });
    });

    describe('Edge Cases', () => {
        it('handles very large numbers', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="title"]').type('Big Project Quote');

            cy.get('[data-cy="quote-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
            cy.get('[data-cy="quote-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Enterprise Solution');
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1000', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('999.99', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

            cy.get('[data-cy="quote-submit"]').click({ force: true });

            cy.get('[data-cy="quote-dialog"]').should('not.exist');
            cy.contains('Big Project Quote', { timeout: 10000 });
        });

        it('handles decimal prices', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="title"]').type('Decimal Price Quote');

            cy.get('[data-cy="quote-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
            cy.get('[data-cy="quote-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Consulting per minute');
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('120', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('1.50', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('5.5', { force: true });

            cy.get('[data-cy="quote-submit"]').click({ force: true });

            cy.get('[data-cy="quote-dialog"]').should('not.exist');
            cy.contains('Decimal Price Quote', { timeout: 10000 });
        });

        it('handles special characters in title and description', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="title"]').type("O'Reilly's Special <Project> & More");

            cy.get('[data-cy="quote-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
            cy.get('[data-cy="quote-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Item with "quotes" & symbols €£¥');
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('0', { force: true });

            cy.get('[data-cy="quote-submit"]').click({ force: true });

            cy.get('[data-cy="quote-dialog"]').should('not.exist');
            cy.contains("O'Reilly", { timeout: 10000 });
        });
    });

    describe('Quote Actions', () => {
        it('views a quote', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.get('[data-cy="view-quote-website-development-quote"]', { timeout: 5000 }).first().click({ force: true });

            cy.get('[role="dialog"]').should('be.visible');
            cy.contains('Website Development Quote');
        });
    });

    describe('Edit Quotes', () => {
        it('edits an existing quote', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.get('[data-cy="edit-quote-decimal-price-quote"]', { timeout: 5000 }).first().click({ force: true });

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="title"]').clear({ force: true }).type('Updated Decimal Price Quote', { force: true });
            cy.get('[data-cy="quote-submit"]').click({ force: true });

            cy.get('[data-cy="quote-dialog"]').should('not.exist');
            cy.contains('Updated Decimal Price Quote', { timeout: 10000 });
        });
    });

    describe('Delete Quotes', () => {
        it('deletes a quote', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.wait(2000);

            cy.get('[data-cy="delete-quote-o\'reilly\'s-special-<project>-&-more"]', { timeout: 5000 }).first().click({ force: true });

            cy.get('[role="alertdialog"], [role="dialog"]').within(() => {
                cy.contains('button', /delete|confirm|supprimer|confirmer/i).click({ force: true });
            });

            cy.wait(2000);
            cy.contains("O'Reilly").should('not.exist');
        });
    });

    describe('Delete Items', () => {
        it('removes an item from a quote', () => {
            cy.visit('/quotes');
            cy.get('body').should('not.have.attr', 'data-scroll-locked');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click({ force: true });
            cy.wait(500);

            cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="title"]').type('Quote with removable item');

            cy.get('[data-cy="quote-client-select"] button').first().click({ force: true });
            cy.wait(300);
            cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
            cy.get('[data-cy="quote-client-select-options"] button').first().click({ force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.0.description"]').type('Item to keep');
            cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
            cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('0', { force: true });

            cy.contains('button', /Add Item|Ajouter/i).click({ force: true });
            cy.get('[name="items.1.description"]').type('Item to remove');
            cy.get('[name="items.1.quantity"]').clear({ force: true }).type('1', { force: true });
            cy.get('[name="items.1.unitPrice"]').clear({ force: true }).type('50', { force: true });
            cy.get('[name="items.1.vatRate"]').clear({ force: true }).type('0', { force: true });

            cy.get('[data-cy="remove-item-1"]').click({ force: true });

            cy.get('[name="items.1.description"]').should('not.exist');

            cy.get('[data-cy="quote-submit"]').click({ force: true });

            cy.get('[data-cy="quote-dialog"]').should('not.exist');
            cy.contains('Quote with removable item', { timeout: 10000 });
        });
    });
});
