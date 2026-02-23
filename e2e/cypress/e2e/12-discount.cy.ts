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

    cy.get('[name="discountRate"]').clear({ force: true }).type(`{selectAll}${discountRate}`, { force: true });

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

beforeEach(() => {
    cy.login();
});

describe('Discount Feature', () => {
    it('applies the configured discount rate to quote totals', () => {
        createQuote({ discountRate: 10 }).then(({ sanitizedTitle }) => {
            cy.get(`[data-cy="view-quote-${sanitizedTitle}"]`).click();
            cy.get('[role="dialog"]').should('be.visible').within(() => {
                cy.contains('Discount Rate').parent().find('p.font-medium').should('contain', '10%');
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
            cy.get('[name="discountRate"]').clear({ force: true }).type('{selectAll}15', { force: true });
            cy.wait(150);
            cy.get('[data-cy="quote-submit"]').click();
            cy.get('[data-cy="quote-dialog"]').should('not.exist');
            cy.wait(150);
            cy.get(`[data-cy="view-quote-${sanitizedTitle}"]`, { timeout: 15000 }).should('exist').click();
            cy.get('[role="dialog"]').should('be.visible').within(() => {
                cy.contains('Discount Rate').parent().find('p.font-medium').should('contain', '15%');
                cy.contains('Discount Amount').parent().find('p.font-medium').should('contain', '150.00EUR');
                cy.contains('Total \(excl. VAT\)').parent().find('p.font-medium').should('contain', '850.00EUR');
                cy.contains('VAT Amount').parent().find('p.font-medium').should('contain', '170.00EUR');
                cy.contains('Total (incl. VAT)').parent().find('p.font-medium').should('contain', '1020.00EUR');
            });
        });

        cy.get('body').type('{esc}');
    });
});
