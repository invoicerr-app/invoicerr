/**
 * F-008 — an authority failure has to be VISIBLE on the invoice.
 *
 * The defect this pins is not that the projection was missing. It is that the screen actively
 * manufactured the appearance of success: the invoice list's status→filter mapping ended in a
 * `: "sent"` fallthrough, so any status it did not model read as a successfully sent invoice, and
 * the default filter set (draft/issued/sent/paid) would have hidden a rejected invoice entirely.
 *
 * The backend projection is covered by 19 jest tests. None of them can tell whether the badge, the
 * banner and the default filter behave — and the frontend has no test runner of its own (F-019),
 * so this spec is the only net over four UI elements that changed twice in two sessions.
 *
 * The failure state is set through a task rather than a real authority because no channel has
 * credentials offline (F-009/F-013). The task writes the same rows ApplySignalService writes.
 */
beforeEach(() => {
  cy.login();
});

function createInvoice(title: string) {
  cy.visit('/invoices');
  cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
  cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

  cy.get('[data-cy="invoice-client-select"] button').first().click();
  cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
  cy.get('[data-cy="invoice-client-select-options"] button').first().click();

  cy.get('[name="notes"]').type(title);
  cy.contains('button', /Add Item|Ajouter/i).click();
  cy.get('[name="items.0.name"]').type('Consulting', { force: true });
  cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
  cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
  cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

  cy.get('[data-cy="invoice-submit"]').click();
  cy.get('[data-cy="invoice-dialog"]').should('not.exist');
}

describe('F-008: an authority failure is visible on the invoice', () => {
  it('shows a rejection in the list and on the detail view, with the authority wording', () => {
    createInvoice('rejection spec');
    cy.task('failLastInvoice', {
      status: 'REJECTED',
      detail: 'scarto - codice 00200 file non conforme',
    });

    cy.visit('/invoices');

    // 1. The invoice is STILL LISTED under the default filter. This is the assertion that would
    //    have caught the worse half of the bug: leaving "rejected" out of the default set makes a
    //    rejected invoice disappear from the list entirely, which is worse than mislabelling it.
    cy.get('[data-cy="invoice-name"]', { timeout: 10000 }).should('have.length.greaterThan', 0);

    // 2. The badge says rejected — not "Sent", which is what the status→filter fallthrough used
    //    to produce. Scoped to the row: "Sent" also names a filter chip, which is always rendered,
    //    so a page-wide `should('not.exist')` asserts nothing about this invoice.
    cy.contains(/rejected|rejet/i, { timeout: 10000 }).should('exist');
    // "Sent" also names a filter chip that is always rendered, so a page-wide not.exist would
    // assert nothing. Assert on the STATUS CELL of the row instead.
    cy.get('[data-cy="invoice-status"]').first().should('not.match', /^sent$|^envoyée$/i);

    // 3. The detail view carries the banner AND the authority's own wording, so the user learns
    //    why and not merely that.
    cy.get('[data-cy="invoice-name"]').first().click();
    cy.get('[data-cy="invoice-failure-banner"]', { timeout: 10000 })
      .should('be.visible')
      .and('have.attr', 'data-status', 'REJECTED');
    cy.get('[data-cy="invoice-failure-reason"]').should('contain', 'codice 00200');
  });

  it('shows a transmission failure with its own wording, distinct from a rejection', () => {
    createInvoice('transmission failure spec');
    cy.task('failLastInvoice', {
      status: 'TRANSMISSION_FAILED',
      detail: 'aucun canal configuré',
    });

    cy.visit('/invoices');
    cy.get('[data-cy="invoice-name"]', { timeout: 10000 }).first().click();

    // The three outcomes are deliberately not folded into one: a transmission failure is retried,
    // a rejection is terminal. The banner must say which one this is.
    cy.get('[data-cy="invoice-failure-banner"]', { timeout: 10000 })
      .should('be.visible')
      .and('have.attr', 'data-status', 'TRANSMISSION_FAILED');
    cy.contains(/not transmitted|non transmise/i).should('be.visible');
  });

  it('shows a buyer refusal, and no banner at all on a healthy invoice', () => {
    createInvoice('refusal spec');
    cy.task('failLastInvoice', { status: 'REFUSED', detail: 'refusée par le destinataire' });

    cy.visit('/invoices');
    cy.get('[data-cy="invoice-name"]', { timeout: 10000 }).first().click();
    cy.get('[data-cy="invoice-failure-banner"]', { timeout: 10000 })
      .should('be.visible')
      .and('have.attr', 'data-status', 'REFUSED');
    cy.get('[data-cy="invoice-failure-reason"]').should('contain', 'destinataire');
    cy.get('body').type('{esc}');

    // The other half of the contract: a healthy invoice must show no banner. A banner that is
    // always on is the same lie in the other direction.
    createInvoice('healthy invoice');
    cy.visit('/invoices');
    cy.get('[data-cy="invoice-name"]', { timeout: 10000 }).first().click();
    cy.get('[data-cy="invoice-failure-banner"]').should('not.exist');
  });
});
