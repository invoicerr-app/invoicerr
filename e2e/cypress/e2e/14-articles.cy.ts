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

const api = Cypress.env('apiUrl');

/** Creates a stock-tracked article through the API and returns its id. */
function createCatalogArticle(name: string, unitPrice: number) {
    return cy
        .request({
            method: 'POST',
            url: `${api}/api/articles`,
            body: { name, unitPrice, vatRate: 20, quantity: 10, lowStockThreshold: 3 },
        })
        .then((res) => {
            expect(res.status, 'article created').to.be.oneOf([200, 201]);
            return res.body.id as string;
        });
}

/** Opens the invoice wizard, fills the Details step and lands on the Lines step. */
function openInvoiceLinesStep() {
    cy.visit('/documents/invoice', { timeout: 20000 });
    cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
    cy.get('[data-cy="document-form"]', { timeout: 15000 }).should('be.visible');
    cy.pickDocumentClient();
    cy.pickToday('[data-cy="document-field-issueDate-input"]');
    cy.pickToday('[data-cy="document-field-dueDate-input"]');
    cy.pickDocumentFieldOption('currency', 'eur');
    cy.continueDocumentWizard(); // Details -> Lines
}

const lineRow = (index: number) => `[data-cy="document-field-lines-row-${index}"]`;

/** Adds a line and types `search` into its Designation, leaving the catalog list open. */
function addLineAndSearch(index: number, search: string) {
    cy.get('[data-cy="document-field-lines-add-row"]').click();
    cy.get(lineRow(index)).should('exist');
    cy.get(`input[name="lines.${index}.description"]`).type(search);
    cy.get(`${lineRow(index)} [data-cy="catalog-search-option-0"]`, { timeout: 10000 }).should('be.visible');
}

function expectLinePrefilled(index: number, name: string, unitPrice: string) {
    cy.get(`input[name="lines.${index}.description"]`).should('have.value', name);
    cy.get(`input[name="lines.${index}.unitPrice"]`).should('have.value', unitPrice);
    cy.get(`${lineRow(index)} [data-cy="catalog-search-option-0"]`).should('not.exist');
}

function fillLineQuantityAndUnit(index: number) {
    cy.get(`input[name="lines.${index}.quantity"]`).clear().type('1');
    cy.get(`input[name="lines.${index}.unit"]`).clear().type('unit');
}

function pickLineVatRate(index: number) {
    cy.get(`${lineRow(index)} [data-cy="document-field-vatRate-input"] button`).first().scrollIntoView().click();
    cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should('be.visible');
    cy.contains('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]', /20\s?%/)
        .first()
        .click();
}

describe('Articles E2E', () => {
    describe('Page Load', () => {
        it('loads the articles page', () => {
            cy.visit('/articles');
            cy.contains('h1', 'Articles', { timeout: 10000 }).should('be.visible');
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

    describe('Selection in invoice line items', () => {
        it('prefills an invoice line when an article is picked from the designation suggestions', () => {
            const articleName = `Web Design Day ${Date.now()}`;

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

            openInvoiceLinesStep();

            addLineAndSearch(0, articleName);
            cy.get(`${lineRow(0)} [data-cy="document-field-lines-row-0-prefill"]`).should('not.exist');
            cy.contains(`${lineRow(0)} [data-cy="catalog-search-option-0"]`, articleName).click();

            cy.get('input[name="lines.0.description"]').should('have.value', articleName);
            cy.get('input[name="lines.0.unitPrice"]').should('have.value', '800');
            cy.get(`${lineRow(0)} [data-cy="document-field-vatRate-input"] button`).should('contain', '20');

            // The prefill map never names quantity or discount, so a pick must leave them untouched.
            cy.get('input[name="lines.0.quantity"]').should('have.value', '');
            cy.get('input[name="lines.0.discountPercent"]').should('have.value', '');
        });
    });
    describe('Type-to-search in the line Designation', () => {
        const stamp = Date.now();
        const nameA = `Alpha ${stamp} Widget`;
        const nameB = `Beta ${stamp} Gadget`;
        let articleA: string;

        before(() => {
            cy.login();
            createCatalogArticle(nameA, 800).then((id) => {
                articleA = id;
            });
            createCatalogArticle(nameB, 450);
        });

        it('proposes catalog matches while typing, applies a pick by keyboard and by mouse, keeps free text', () => {
            openInvoiceLinesStep();

            addLineAndSearch(0, `Alpha ${stamp}`);
            cy.get(`${lineRow(0)} [data-cy="catalog-search-option-1"]`).should('not.exist');
            cy.get('input[name="lines.0.description"]').type('{downArrow}{enter}');
            expectLinePrefilled(0, nameA, '800');
            cy.get(`${lineRow(0)} [data-cy="document-field-vatRate-input"] button`).should('contain', '20');
            fillLineQuantityAndUnit(0);

            addLineAndSearch(1, `Beta ${stamp}`);
            cy.contains(`${lineRow(1)} [data-cy="catalog-search-option-0"]`, nameB).click();
            expectLinePrefilled(1, nameB, '450');
            cy.get(`${lineRow(1)} [data-cy="document-field-vatRate-input"] button`).should('contain', '20');
            fillLineQuantityAndUnit(1);

            cy.get('[data-cy="document-field-lines-add-row"]').click();
            cy.get('input[name="lines.2.description"]').type('Hand typed line');
            cy.get(`${lineRow(2)} [data-cy="catalog-search-option-0"]`).should('not.exist');
            cy.get('input[name="lines.2.unitPrice"]').clear().type('42');
            fillLineQuantityAndUnit(2);
            pickLineVatRate(2);

            cy.continueDocumentWizard(); // Lines -> Options
            cy.continueDocumentWizard(); // Options -> Summary

            cy.intercept('POST', `${api}/api/documents/types/invoice/actions/save-draft`).as('saveDraft');
            cy.get('[data-cy="document-action-save-draft"]').click();
            cy.wait('@saveDraft').then(({ response }) => {
                expect(response?.statusCode, 'save-draft succeeded').to.be.oneOf([200, 201]);
                const id = response?.body?.document?.id as string;

                cy.request({ url: `${api}/api/documents/${id}?typeId=invoice` })
                    .its('body.data.lines')
                    .then((lines: Record<string, unknown>[]) => {
                        expect(lines).to.have.length(3);
                        expect(lines[0]).to.deep.include({ description: nameA, unitPrice: 800, articleId: articleA });
                        expect(lines[1]).to.deep.include({ description: nameB, unitPrice: 450 });
                        expect(String(lines[0].vatRate)).to.match(/20|standard/i);
                        expect(lines[2]).to.deep.include({ description: 'Hand typed line', unitPrice: 42 });
                        expect(lines[2]).to.not.have.property('articleId');
                    });
            });
        });

        it('closes the list on Escape and leaves the typed text alone', () => {
            openInvoiceLinesStep();

            addLineAndSearch(0, `Alpha ${stamp}`);
            cy.get('input[name="lines.0.description"]').type('{esc}');
            cy.get(`${lineRow(0)} [data-cy="catalog-search-option-0"]`).should('not.exist');
            cy.get('input[name="lines.0.description"]').should('have.value', `Alpha ${stamp}`);
        });
    });

    describe('Catalog assist on received invoices', () => {
        const stamp = Date.now();
        const name = `Supplier Part ${stamp}`;

        it('prefills a received invoice line from the catalog without touching stock', () => {
            createCatalogArticle(name, 120).then((articleId) => {
                cy.visit('/documents/received-invoice', { timeout: 20000 });
                cy.get('[data-cy="received-invoice-upload-button"]', { timeout: 15000 }).click();
                cy.get('[data-cy="received-invoice-upload-dropzone"]').selectFile(
                    'cypress/fixtures/received-invoices/supplier-invoice-plain.pdf',
                    { action: 'drag-drop' },
                );
                cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should('be.visible');

                addLineAndSearch(0, `Supplier Part ${stamp}`);
                cy.get('input[name="lines.0.description"]').type('{downArrow}{enter}');
                expectLinePrefilled(0, name, '120');
                cy.get('input[name="lines.0.vatRate"]').should('have.value', '20');

                cy.continueDocumentWizard(); // Lines -> Options
                cy.continueDocumentWizard(); // Options -> Summary

                cy.intercept('POST', `${api}/api/documents/types/received-invoice/actions/receive`).as('receive');
                cy.get('[data-cy="document-action-receive"]').click();
                cy.wait('@receive').then(({ response }) => {
                    expect(response?.statusCode, 'receive succeeded').to.be.oneOf([200, 201]);
                    const id = response?.body?.document?.id as string;

                    cy.request({ url: `${api}/api/documents/${id}?typeId=received-invoice` })
                        .its('body.data.lines')
                        .then((lines: Record<string, unknown>[]) => {
                            expect(lines).to.have.length(1);
                            expect(lines[0]).to.deep.include({ description: name, unitPrice: 120 });
                            expect(lines[0]).to.not.have.property('articleId');
                        });
                });

                cy.request({ url: `${api}/api/articles/${articleId}` }).its('body.quantity').should('eq', 10);
            });
        });
    });
});
