beforeEach(() => {
    cy.login();
});

describe('Articles E2E', () => {
    describe('Page Load', () => {
        it('loads the articles page', () => {
            cy.visit('/articles');
            cy.contains(/articles/i, { timeout: 10000 });
        });

        it('shows the add button', () => {
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).should('be.visible');
        });

        it('has a sidebar link to articles', () => {
            cy.visit('/dashboard');
            cy.get('[data-cy="sidebar-articles-link"]', { timeout: 10000 }).should('be.visible').click();
            cy.url().should('include', '/articles');
        });
    });

    describe('Create Dialog', () => {
        it('opens the create dialog with all form fields', () => {
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="article-dialog"]').should('be.visible');
            cy.get('input[name="name"]').should('exist');
            cy.get('textarea[name="description"]').should('exist');
            cy.get('[data-cy="article-type-trigger"]').should('exist');
            cy.get('input[name="unitPrice"]').should('exist');
            cy.get('input[name="vatRate"]').should('exist');
        });

        it('creates an article and the dialog closes', () => {
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);

            const uniqueName = `Consulting Hour ${Date.now()}`;
            cy.get('input[name="name"]').clear().type(uniqueName);
            cy.get('textarea[name="description"]').clear().type('One hour of consulting');
            cy.get('input[name="unitPrice"]').clear().type('120');
            cy.get('input[name="vatRate"]').clear().type('20');

            cy.get('[data-cy="article-submit"]').click();
            cy.wait(1500);

            cy.get('[data-cy="article-dialog"]').should('not.exist');
            cy.contains(uniqueName, { timeout: 10000 });
        });
    });

    describe('Validation', () => {
        it('shows an error for an empty name', () => {
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('input[name="name"]').clear();
            cy.get('[data-cy="article-submit"]').click();
            cy.contains(/required|requis/i);

            cy.get('[data-cy="article-dialog"]').should('be.visible');
        });
    });

    describe('Type Selection', () => {
        it('can select the Product type', () => {
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="article-type-trigger"]').click();
            cy.wait(200);
            cy.get('[role="option"]').contains(/product/i).click();
            cy.get('[data-cy="article-type-trigger"]').should('contain.text', 'Product');
        });
    });

    describe('Edit & Delete', () => {
        it('edits an existing article', () => {
            const originalName = `Editable Article ${Date.now()}`;
            const updatedName = `${originalName} (updated)`;

            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);
            cy.get('input[name="name"]').clear().type(originalName);
            cy.get('input[name="unitPrice"]').clear().type('50');
            cy.get('input[name="vatRate"]').clear().type('10');
            cy.get('[data-cy="article-submit"]').click();
            cy.wait(1500);

            cy.contains(originalName, { timeout: 10000 })
                .closest('[data-cy="article-item"]')
                .within(() => {
                    cy.get('[data-cy="article-edit-button"]').click();
                });
            cy.wait(500);

            cy.get('[data-cy="article-dialog"]').should('be.visible');
            cy.get('input[name="name"]').clear().type(updatedName);
            cy.get('[data-cy="article-submit"]').click();
            cy.wait(1500);

            cy.contains(updatedName, { timeout: 10000 });
        });

        it('deletes an article', () => {
            const name = `Deletable Article ${Date.now()}`;

            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);
            cy.get('input[name="name"]').clear().type(name);
            cy.get('[data-cy="article-submit"]').click();
            cy.wait(1500);

            cy.contains(name, { timeout: 10000 })
                .closest('[data-cy="article-item"]')
                .within(() => {
                    cy.get('[data-cy="article-delete-button"]').click();
                });
            cy.wait(300);

            cy.contains('button', /delete|supprimer/i).last().click();
            cy.wait(1500);

            cy.contains(name).should('not.exist');
        });
    });

    describe('Selection in invoice line items', () => {
        it('prefills an invoice line when an article is picked from the catalog', () => {
            const articleName = `Web Design Day ${Date.now()}`;

            // Create a reusable article first
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);
            cy.get('input[name="name"]').clear().type(articleName);
            cy.get('textarea[name="description"]').clear().type('Full day of web design');
            cy.get('[data-cy="article-type-trigger"]').click();
            cy.wait(200);
            cy.get('[role="option"]').contains(/^day$/i).click();
            cy.get('input[name="unitPrice"]').clear().type('800');
            cy.get('input[name="vatRate"]').clear().type('20');
            cy.get('[data-cy="article-submit"]').click();
            cy.wait(1500);
            cy.get('[data-cy="article-dialog"]').should('not.exist');

            // Pick it from the catalog while creating an invoice
            cy.visit('/invoices');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="invoice-client-select"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
            cy.get('[data-cy="invoice-client-select-options"] button').first().click();

            cy.get('[data-cy="article-picker"] button').first().click();
            cy.wait(300);
            cy.get('[data-cy="article-picker-options"]').should('be.visible');
            cy.contains('[data-cy="article-picker-options"] button', articleName).click();

            cy.get('[name="items.0.name"]').should('have.value', articleName);
            cy.get('[name="items.0.description"]').should('have.value', 'Full day of web design');
            cy.get('[name="items.0.unitPrice"]').should('have.value', '800');
            cy.get('[name="items.0.vatRate"]').should('have.value', '20');
        });
    });
});
