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

/**
 * Creating an invoice through the form is by far the most expensive thing this spec does, and it
 * runs last, when the Electron renderer has been alive for ten minutes. Four full form fills were
 * enough to crash it in a full-suite run while the same spec passed in isolation. Two invoices are
 * created once, up front, and reused: the failure state is set per test through the task, which is
 * what each test is actually about.
 */
function createInvoice(note: string) {
  // Instrumented through cy.task, which prints from the Node process: the renderer crash that has
  // killed this spec in every measured run takes the browser console with it, so anything logged
  // in the browser is lost exactly when it becomes interesting.
  const step = (m: string) => cy.task('logStep', `17/createInvoice: ${m}`);

  step('visit /invoices');
  cy.visit('/invoices');
  step('click add');
  cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
  step('await dialog');
  cy.get('[data-cy="invoice-dialog"]', { timeout: 5000 }).should('be.visible');

  step('open client select');
  cy.get('[data-cy="invoice-client-select"] button').first().click();
  cy.get('[data-cy="invoice-client-select-options"]').should('be.visible');
  step('pick client');
  cy.get('[data-cy="invoice-client-select-options"] button').first().click();

  step('type notes');
  cy.get('[name="notes"]').type(note);
  step('add item row');
  cy.contains('button', /Add Item|Ajouter/i).click();
  step('fill item');
  cy.get('[name="items.0.name"]').type('Consulting', { force: true });
  cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
  cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('100', { force: true });
  cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });

  step('submit');
  cy.get('[data-cy="invoice-submit"]').click();
  step('await dialog closed');
  cy.get('[data-cy="invoice-dialog"]').should('not.exist');
  step('done');
}

/** Opens the newest invoice's detail dialog. */
function openLatest() {
  cy.visit('/invoices');
  cy.get('[data-cy="invoice-name"]', { timeout: 10000 }).first().click();
}

describe('F-008: an authority failure is visible on the invoice', () => {
  /**
   * No `before()` hook on purpose. Combining one with the file-level `beforeEach(cy.login)` — which
   * uses cy.session — crashed the Electron renderer deterministically here. The invoice is created
   * inside the first test instead and reused by the next two: `failLastInvoice` targets the newest
   * invoice, so driving the same row into three successive failure states costs one form fill, not
   * three.
   */
  it('shows a rejection in the list and on the detail view, with the authority wording', () => {
    createInvoice('failure subject');
    cy.task('failLastInvoice', {
      status: 'REJECTED',
      detail: 'scarto - codice 00200 file non conforme',
    });
    cy.visit('/invoices');

    // 1. The invoice is STILL LISTED under the default filter. This is the assertion that catches
    //    the worse half of the bug: leaving "rejected" out of the default set makes a rejected
    //    invoice disappear from the list entirely, which is worse than mislabelling it.
    cy.get('[data-cy="invoice-name"]', { timeout: 10000 }).should('have.length.greaterThan', 0);

    // 2. The badge says rejected — not "Sent", which is what the status→filter fallthrough used to
    //    produce. Asserted on the row's own status cell: "Sent" also names a filter chip that is
    //    always rendered, so a page-wide not.exist would assert nothing.
    cy.contains(/rejected|rejet/i, { timeout: 10000 }).should('exist');
    cy.get('[data-cy="invoice-status"]').first().should('not.match', /^sent$|^envoyée$/i);

    // 3. The detail view carries the banner AND the authority's own wording, so the user learns why
    //    and not merely that.
    cy.get('[data-cy="invoice-name"]').first().click();
    cy.get('[data-cy="invoice-failure-banner"]', { timeout: 10000 })
      .should('be.visible')
      .and('have.attr', 'data-status', 'REJECTED');
    cy.get('[data-cy="invoice-failure-reason"]').should('contain', 'codice 00200');
  });

  it('shows a transmission failure with its own wording, distinct from a rejection', () => {
    cy.task('failLastInvoice', { status: 'TRANSMISSION_FAILED', detail: 'aucun canal configuré' });
    openLatest();

    // The three outcomes are deliberately not folded into one: a transmission failure is retried,
    // a rejection is terminal. The banner must say which one this is.
    cy.get('[data-cy="invoice-failure-banner"]', { timeout: 10000 })
      .should('be.visible')
      .and('have.attr', 'data-status', 'TRANSMISSION_FAILED');
    cy.contains(/not transmitted|non transmise/i).should('be.visible');
  });

  it('shows a buyer refusal with its reason', () => {
    cy.task('failLastInvoice', { status: 'REFUSED', detail: 'refusée par le destinataire' });
    openLatest();

    cy.get('[data-cy="invoice-failure-banner"]', { timeout: 10000 })
      .should('be.visible')
      .and('have.attr', 'data-status', 'REFUSED');
    cy.get('[data-cy="invoice-failure-reason"]').should('contain', 'destinataire');
  });

  it('shows no banner at all on a healthy invoice', () => {
    // The other half of the contract: a banner that is always on is the same lie in the other
    // direction. A fresh invoice is created here so it is the newest, and never failed.
    createInvoice('healthy invoice');
    openLatest();
    cy.get('[data-cy="invoice-failure-banner"]').should('not.exist');
  });
});
