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

    // Adapted to the generic document model (frontend/src/components/documents/): the old, bespoke
    // invoice form ("invoice-dialog", "items.N.*") is gone, replaced by the descriptor-driven
    // DocumentForm every document type now shares (documents/[typeId].tsx). The INTENT this test
    // proves is unchanged — picking a catalog article really fills a line's own fields, with real
    // values asserted, not just "a callback fired" — only the path to it changed: the generic
    // `prefillFrom` mechanism (descriptors/types.ts, backend; field-renderers/array-field.tsx,
    // frontend) that the invoice/quote descriptors declare for their `lines` array field, backed by
    // a NEW `article` reference provider (backend/src/modules/documents/references/
    // article-reference.provider.ts). The core names neither "article" nor "invoice" anywhere in
    // that mechanism — this spec is what proves the WIRING of it for this one, real, concrete case.
    describe('Selection in invoice line items', () => {
        it('prefills an invoice line when an article is picked from the catalog', () => {
            const articleName = `Web Design Day ${Date.now()}`;

            // Create a reusable article first — the /articles page and its own form are untouched by
            // the document-model refactor (articles/ is the one module that survived it as-is).
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

            // Pick it from the catalog while creating an invoice, through the generic form.
            cy.visit('/documents/invoice', { timeout: 20000 });
            cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
            cy.get('[data-cy="document-form"]', { timeout: 15000 }).should('be.visible');

            // The "client" reference field — same generic SearchSelect pattern every other spec in
            // this suite uses for one (see 20-document-totals.cy.ts's own comment on why the BUTTON,
            // not the container, is what opens the popover).
            cy.get('[data-cy="document-field-client-input"] button').first().click({ force: true });
            cy.get('[data-cy="document-field-client-input-options"]', { timeout: 10000 }).should(
                'be.visible',
            );
            cy.get('[data-cy="document-field-client-input-options"] button').first().click();

            cy.get('[data-cy="document-field-lines-add-row"]').click();
            cy.get('[data-cy="document-field-lines-row-0"]').should('exist');

            // The GENERIC "from catalog" picker — one per row, offered because invoice.descriptor.ts
            // declares `prefillFrom: { entity: 'article', map: {...} }` on `lines`, not a bespoke
            // article widget wired into this one form.
            cy.get('[data-cy="document-field-lines-row-0-prefill"] button').first().click({ force: true });
            cy.get('[data-cy="document-field-lines-row-0-prefill-options"]', { timeout: 10000 }).should(
                'be.visible',
            );
            cy.contains(
                '[data-cy="document-field-lines-row-0-prefill-options"] button',
                articleName,
            ).click({ force: true });

            // What actually got filled: the mapped fields, with the article's real values —
            // `description` from the article's `name` (this line shape has one designation field,
            // not the old separate name+description pair), `unitPrice` from its `unitPrice`, and
            // `vatRate` (a catalog-backed SearchSelect, not a plain input) showing the picked rate.
            cy.get('input[name="lines.0.description"]').should('have.value', articleName);
            cy.get('input[name="lines.0.unitPrice"]').should('have.value', '800');
            cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-vatRate-input"] button').should(
                'contain',
                '20',
            );

            // And rien d'autre: `map` names exactly description/unitPrice/vatRate — quantity and the
            // line's own discount are NOT in it, so they must stay untouched by this action.
            cy.get('input[name="lines.0.quantity"]').should('have.value', '');
            cy.get('input[name="lines.0.discountPercent"]').should('have.value', '');
        });
    });
});
