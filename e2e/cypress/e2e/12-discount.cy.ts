type QuoteItemInput = {
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
};

type CreateQuoteOptions = {
    baseTitle?: string;
    discountRate?: number;
    item?: QuoteItemInput;
};

type CreateInvoiceOptions = {
    discountRate?: number;
    item?: QuoteItemInput;
};

const defaultQuoteItem: QuoteItemInput = {
    description: 'Discounted Consulting',
    quantity: 5,
    unitPrice: 200,
    vatRate: 20,
};

function createQuote({ baseTitle = 'Discount Flow Test', discountRate = 10, item = defaultQuoteItem }: CreateQuoteOptions = {}) {
    const suffix = Date.now();
    const quoteTitle = `${baseTitle} ${suffix}`;
    const sanitizedTitle = quoteTitle.replace(/\s+/g, '-').toLowerCase();

    cy.visit('/quotes');
    cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
    cy.wait(500);

    cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

    cy.get('[name="title"]').type(quoteTitle);

    cy.get('[data-cy="quote-client-select"] button').first().click();
    cy.wait(300);
    cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
    cy.get('[data-cy="quote-client-select-options"] button').first().click();

    cy.get('[data-cy="quote-currency-select"] button').first().click();
    cy.wait(200);
    cy.get('[data-cy="quote-currency-select"] input').type('EUR');
    cy.wait(200);
    cy.get('[data-cy="quote-currency-select-option-euro-(€)"]').click();

    cy.get('[name="discountRate"]').clear({ force: true }).type(`{selectAll}${discountRate}`, { force: true }).blur({ force: true });

    cy.contains('button', /Add Item|Ajouter/i).click();
    cy.get('[name="items.0.description"]').type(item.description, { force: true });
    cy.get('[name="items.0.quantity"]').clear({ force: true }).type(String(item.quantity), { force: true });
    cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type(String(item.unitPrice), { force: true });
    cy.get('[name="items.0.vatRate"]').clear({ force: true }).type(String(item.vatRate), { force: true });

    cy.get('[data-cy="quote-submit"]').click();

    cy.get('[data-cy="quote-dialog"]').should('not.exist');

    cy.contains(quoteTitle, { timeout: 15000 }).should('exist');

    return cy.wrap({ quoteTitle, sanitizedTitle });
}

function createInvoice({ discountRate = 10, item = defaultQuoteItem }: CreateInvoiceOptions = {}) {
    cy.intercept('POST', '/api/invoices').as('createInvoice');

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

    cy.get('[name="discountRate"]').clear({ force: true }).type(`{selectAll}${discountRate}`, { force: true }).blur({ force: true });

    cy.contains('button', /Add Item|Ajouter/i).click();
    cy.get('[name="items.0.description"]').type(item.description, { force: true });
    cy.get('[name="items.0.quantity"]').clear({ force: true }).type(String(item.quantity), { force: true });
    cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type(String(item.unitPrice), { force: true });
    cy.get('[name="items.0.vatRate"]').clear({ force: true }).type(String(item.vatRate), { force: true });

    cy.get('[data-cy="invoice-submit"]').click();

    return cy.wait('@createInvoice').then(({ response }) => {
        cy.get('[data-cy="invoice-dialog"]').should('not.exist');
        expect(response?.body).to.exist;
        const invoice = response?.body || {};
        const invoiceLabel = String(invoice.rawNumber ?? invoice.number);
        return cy.wrap({ invoiceLabel, invoiceId: invoice.id });
    });
}

function createReceiptForInvoice(invoiceLabel: string) {
    cy.intercept('POST', '/api/receipts/create-from-invoice').as('createReceipt');

    cy.contains('[data-cy="invoice-row"]', invoiceLabel, { timeout: 20000 })
        .should('exist')
        .closest('[data-cy="invoice-row"]')
        .as('invoiceRow');

    cy.get('@invoiceRow').within(() => {
        cy.get('button')
            .filter((_, el) => Cypress.$(el).find('svg.lucide-plus').length > 0)
            .first()
            .click({ force: true });
    });

    return cy.wait('@createReceipt').then(({ response }) => {
        expect(response?.statusCode).to.be.oneOf([200, 201]);
        return cy.wrap({ receipt: response?.body });
    });
}

beforeEach(() => {
    cy.login();
});

describe('Discount Feature (Quote)', () => {
    it('applies the configured discount rate to quote totals', () => {
        createQuote({ discountRate: 10 }).then(({ sanitizedTitle }) => {
            cy.get(`[data-cy="view-quote-${sanitizedTitle}"]`).click();
            cy.get('[role="dialog"]').should('be.visible').within(() => {
                cy.contains('Discount Rate').parent().find('p.font-medium', { timeout: 10000 }).should('contain', '10%');
                cy.contains('Discount Amount').parent().find('p.font-medium').should('contain', '100.00EUR');
                cy.contains('Total \(excl. VAT\)').parent().find('p.font-medium').should('contain', '900.00EUR');
                cy.contains('VAT Amount').parent().find('p.font-medium').should('contain', '180.00EUR');
                cy.contains('Total (incl. VAT)').parent().find('p.font-medium').should('contain', '1080.00EUR');
            });
        });

        cy.get('body').type('{esc}');
    });

    it('validates discount rate boundaries within the quote form', () => {
        const suffix = Date.now();
        const quoteTitle = `Discount Validation Test ${suffix}`;

        cy.visit('/quotes');
        cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
        cy.wait(500);

        cy.get('[data-cy="quote-dialog"]', { timeout: 5000 }).should('be.visible');

        cy.get('[name="title"]').type(quoteTitle);

        cy.get('[data-cy="quote-client-select"] button').first().click();
        cy.get('[data-cy="quote-client-select-options"]').should('be.visible');
        cy.get('[data-cy="quote-client-select-options"] button').first().click();

        cy.get('[data-cy="quote-currency-select"] button').first().click();
        cy.get('[data-cy="quote-currency-select"] input').type('EUR');
        cy.get('[data-cy="quote-currency-select-option-euro-(€)"]').click();

        cy.contains('button', /Add Item|Ajouter/i).click();
        cy.get('[name="items.0.description"]').type('Validation Item', { force: true });
        cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
        cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
        cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

        cy.get('[name="discountRate"]').clear({ force: true }).type('-5', { force: true });
        cy.get('[data-cy="quote-submit"]').click();
        cy.contains('Discount cannot be negative').should('be.visible');

        cy.get('[name="discountRate"]').clear({ force: true }).type('150', { force: true });
        cy.get('[data-cy="quote-submit"]').click();
        cy.contains('Discount cannot exceed 100%').should('be.visible');

        cy.get('[name="discountRate"]').clear({ force: true }).type('5', { force: true });
        cy.get('[data-cy="quote-submit"]').click();

        cy.get('[data-cy="quote-dialog"]').should('not.exist');
        cy.contains(quoteTitle, { timeout: 15000 }).should('exist');
    });

    it('allows updating the discount rate on an existing quote', () => {
        cy.intercept('PATCH', '/api/quotes/*').as('updateQuote');

        createQuote({ baseTitle: 'Discount Edit Flow', discountRate: 10 }).then(({ sanitizedTitle }) => {
            cy.get(`[data-cy="view-quote-${sanitizedTitle}"]`).click();
            cy.get('[role="dialog"]').should('be.visible').within(() => {
                cy.contains('Discount Rate').parent().find('p.font-medium').should('contain', '10%');
                cy.contains('Discount Amount').parent().find('p.font-medium').should('contain', '0.00EUR');
                cy.contains('Total \(excl. VAT\)').parent().find('p.font-medium').should('contain', '900.00EUR');
                cy.contains('VAT Amount').parent().find('p.font-medium').should('contain', '180.00EUR');
                cy.contains('Total (incl. VAT)').parent().find('p.font-medium').should('contain', '1080.00EUR');
            });
            cy.get('body').type('{esc}');

            cy.get(`[data-cy="edit-quote-${sanitizedTitle}"]`).click();
            cy.get('[data-cy="quote-dialog"]').should('be.visible');
            cy.get('[name="discountRate"]').clear({ force: true }).type('{selectAll}15', { force: true }).blur({ force: true });
            cy.get('[data-cy="quote-submit"]').click();
            cy.wait('@updateQuote').its('response.statusCode').should('be.oneOf', [200, 201]);
            cy.get('[data-cy="quote-dialog"]').should('not.exist');
            cy.reload();
            cy.get(`[data-cy="view-quote-${sanitizedTitle}"]`, { timeout: 15000 }).should('exist').click();
            cy.get('[role="dialog"]').should('be.visible').within(() => {
                cy.contains('Discount Rate').parent().find('p.font-medium', { timeout: 10000 }).should('contain', '15%');
                cy.contains('Discount Amount').parent().find('p.font-medium').should('contain', '150.00EUR');
                cy.contains('Total \(excl. VAT\)').parent().find('p.font-medium').should('contain', '850.00EUR');
                cy.contains('VAT Amount').parent().find('p.font-medium').should('contain', '170.00EUR');
                cy.contains('Total (incl. VAT)').parent().find('p.font-medium').should('contain', '1020.00EUR');
            });
        });

        cy.get('body').type('{esc}');
    });
});

describe('Discount Feature (Invoice)', () => {
    it('applies the configured discount rate to invoice totals', () => {
        createInvoice({ discountRate: 10 }).then(({ invoiceLabel }) => {
            cy.reload();
            cy.contains('[data-cy="invoice-row"]', invoiceLabel, { timeout: 20000 })
                .should('exist')
                .closest('[data-cy="invoice-row"]')
                .as('invoiceRow');

            cy.get('@invoiceRow').find('button:has(svg.lucide-eye)').first().click();
            cy.get('[role="dialog"]').should('be.visible').within(() => {
                cy.contains('Discount Rate').parent().find('p.font-medium', { timeout: 10000 }).should('contain', '10%');
                cy.contains('Discount Amount').parent().find('p.font-medium').should('contain', '100.00EUR');
                cy.contains('Total \(excl. VAT\)').parent().find('p.font-medium').should('contain', '900.00EUR');
                cy.contains('VAT Amount').parent().find('p.font-medium').should('contain', '180.00EUR');
                cy.contains('Total (incl. VAT)').parent().find('p.font-medium').should('contain', '1080.00EUR');
            });
        });

        cy.get('body').type('{esc}');
    });
});

describe('Discount Feature (Receipts)', () => {
    it('applies the configured discount rate to receipt totals', () => {
        createInvoice({ discountRate: 10 }).then(({ invoiceLabel }) => {
            createReceiptForInvoice(invoiceLabel).then(() => {
                cy.visit('/receipts');
                cy.contains('span', invoiceLabel, { timeout: 20000 })
                    .should('exist')
                    .closest('div.p-4')
                    .as('receiptRow');

                cy.get('@receiptRow').contains('span', '1080.00EUR').should('exist');
            });
        });
    });
});
