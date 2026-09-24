export {}; // makes this spec a module, not a global script -- see tsconfig.json

beforeEach(() => {
    cy.login();
});

/**
 * Fills the article wizard's own three steps (article-upsert.tsx, a components/ui/stepped-dialog.tsx
 * wizard: Identity -> Price & VAT -> Stock, owner decision 2026-09-16) up to and including the LAST
 * one, without submitting — the caller clicks `article-submit` itself. Assumes the dialog is already
 * open, on the identity step.
 */
function fillArticleWizard(opts: {
    name: string;
    description?: string;
    selectType?: RegExp;
    unitPrice?: string;
    vatRate?: string;
}) {
    cy.get('input[name="name"]').clear().type(opts.name);
    if (opts.description !== undefined) {
        cy.get('textarea[name="description"]').clear().type(opts.description);
    }
    cy.continueSteppedDialog('article-dialog'); // identity -> pricing

    if (opts.selectType) {
        cy.get('[data-cy="article-type-trigger"]').click();
        cy.wait(200);
        cy.get('[role="option"]').contains(opts.selectType).click();
    }
    if (opts.unitPrice !== undefined) {
        cy.get('input[name="unitPrice"]').clear().type(opts.unitPrice);
    }
    if (opts.vatRate !== undefined) {
        cy.get('input[name="vatRate"]').clear().type(opts.vatRate);
    }
    cy.continueSteppedDialog('article-dialog'); // pricing -> stock (the wizard's last step)
}

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
        it('opens the create dialog with all form fields, across its three steps', () => {
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('[data-cy="article-dialog"]').should('be.visible');
            cy.get('input[name="name"]').should('exist');
            cy.get('textarea[name="description"]').should('exist');

            // The identity step's own "name" is required — leaving it empty would block Continue
            // (Validation describe block below covers that on its own), so a NAME here is what lets
            // this test walk forward to inspect the later steps' fields.
            cy.get('input[name="name"]').type(`Field Check ${Date.now()}`);
            cy.continueSteppedDialog('article-dialog');
            cy.get('[data-cy="article-type-trigger"]').should('exist');
            cy.get('input[name="unitPrice"]').should('exist');
            cy.get('input[name="vatRate"]').should('exist');

            cy.continueSteppedDialog('article-dialog');
            cy.get('input[name="quantity"]').should('exist');
            cy.get('input[name="lowStockThreshold"]').should('exist');
        });

        it('creates an article and the dialog closes', () => {
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);

            const uniqueName = `Consulting Hour ${Date.now()}`;
            fillArticleWizard({
                name: uniqueName,
                description: 'One hour of consulting',
                unitPrice: '120',
                vatRate: '20',
            });

            cy.get('[data-cy="article-submit"]').click();
            cy.wait(1500);

            cy.get('[data-cy="article-dialog"]').should('not.exist');
            cy.contains(uniqueName, { timeout: 10000 });
        });
    });

    describe('Validation', () => {
        it('shows an error for an empty name and blocks leaving the identity step', () => {
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('input[name="name"]').clear();
            cy.get('[data-cy="article-dialog-continue"]').click();
            cy.contains(/required|requis/i);

            // Still on the identity step — pricing's own fields never mounted, proving Continue
            // was actually refused rather than the dialog just being slow.
            cy.get('[data-cy="article-dialog"]').should('be.visible');
            cy.get('input[name="unitPrice"]').should('not.exist');
        });
    });

    describe('Type Selection', () => {
        it('can select the Product type', () => {
            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);

            cy.get('input[name="name"]').clear().type(`Type Check ${Date.now()}`);
            cy.continueSteppedDialog('article-dialog');

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
            fillArticleWizard({ name: originalName, unitPrice: '50', vatRate: '10' });
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

            // The edit dialog's own steps all open already "done" (initialMaxReached, since the
            // record's existing values are already valid) — jump straight to the last one instead of
            // walking Continue twice, proving that shortcut actually works rather than just trusting
            // it from reading the component.
            cy.get('[data-cy="article-dialog-step-stock"]').click();
            cy.get('[data-cy="article-submit"]').click();
            cy.wait(1500);

            cy.contains(updatedName, { timeout: 10000 });
        });

        it('deletes an article', () => {
            const name = `Deletable Article ${Date.now()}`;

            cy.visit('/articles');
            cy.get('[data-cy="article-add-button"]', { timeout: 10000 }).click();
            cy.wait(500);
            fillArticleWizard({ name });
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
    // DocumentForm every document type now shares (documents/[typeId]/index.tsx). The INTENT this test
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
            fillArticleWizard({
                name: articleName,
                description: 'Full day of web design',
                selectType: /^day$/i,
                unitPrice: '800',
                vatRate: '20',
            });
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
            // Picking the client is not just a value change: the screen re-fetches its own descriptor
            // with that client (the country field overlays depend on the buyer) and rebuilds every field
            // node below when the answer lands. `pickDocumentClient` (support/commands.ts) waits for that
            // rebuild AND for the picker's own teardown, so the calendar opened on the next line is not
            // unmounted or dismissed under the command driving it.
            cy.pickDocumentClient();

            // "client"/"issueDate"/"dueDate"/"currency" (all `required`) are the invoice wizard's own
            // "Details" step (document-create-dialog.tsx's `buildFieldGroups`) — same fill as
            // 30-document-xml-format.cy.ts's own Details step, needed to reach "Lines" at all.
            cy.pickToday('[data-cy="document-field-issueDate-input"]');
            cy.pickToday('[data-cy="document-field-dueDate-input"]');
            cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
            cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should(
                'be.visible',
            );
            cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();
            cy.continueDocumentWizard(); // Details -> Lines

            cy.get('[data-cy="document-field-lines-add-row"]').click();
            cy.get('[data-cy="document-field-lines-row-0"]').should('exist');

            // The GENERIC "from catalog" picker — one per row, offered because invoice.descriptor.ts
            // declares `prefillFrom: { entity: 'article', map: {...} }` on `lines`, not a bespoke
            // article widget wired into this one form.
            //
            // The form has grown fields since this spec was last green (custom fields, attachments —
            // see the dialog's own comment history): on the default 1000x660 viewport this row now
            // sits below the fold of the dialog's own `overflow-y-auto`, so its trigger's real
            // bounding rect can be off-screen at click time. `force: true` alone (the repo's usual
            // SearchSelect-trigger pattern — see 20-document-totals.cy.ts's own comment) bypasses
            // Cypress's actionability check but does NOT fix that: Radix positions the popover off an
            // off-screen anchor, landing it somewhere unreachable too (Cypress's own suggestion on
            // that failure). `scrollIntoView()` first — same fix 05-clients.cy.ts and others already
            // use for a trigger far down a scrollable form — puts the anchor in view for real, which
            // is what a real user has to do here too.
            cy.get('[data-cy="document-field-lines-row-0-prefill"] button')
                .first()
                .scrollIntoView()
                .click({ force: true });
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
