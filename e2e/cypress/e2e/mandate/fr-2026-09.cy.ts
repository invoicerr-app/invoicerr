/**
 * France, once the mandate is in force.
 *
 * This spec lives OUTSIDE the normal glob (`cypress/e2e/*.cy.ts`) on purpose: it only tells the
 * truth when the whole stack believes it is past 2026-09-01, and it would fail — correctly — on any
 * ordinary run. Spec 18 asserts the mirror image, that the reception layer is absent today.
 *
 *   DATE_SHIFT_TO=2026-09-02T10:00:00Z \
 *   NODE_OPTIONS="--require $PWD/scripts/date-shift.cjs" \
 *   ./scripts/e2e-worktree.sh --browser firefox --spec "cypress/e2e/mandate/fr-2026-09.cy.ts"
 *
 * The shift has to reach BOTH sides. The server decides which obligations are in force — the engine
 * resolves the profile against the invoice's issue date, which is `new Date()` — and the browser
 * decides what a deadline reads as against "now". Shifting one and not the other would produce a
 * screen that contradicts itself.
 */
const api = Cypress.env('apiUrl') || 'http://localhost:4000';
const MANDATE_DAY = new Date('2026-09-02T10:00:00Z').getTime();

function frCompany(name: string, siret: string, vat: string) {
  return cy
    .request({
      method: 'POST',
      url: `${api}/api/companies`,
      body: {
        name,
        description: 'FR mandate showcase',
        phone: '+33123456789',
        email: 'contact.fr@example.org',
        address: '1 Rue de la Paix',
        city: 'Paris',
        postalCode: '75002',
        country: 'France',
        countryCode: 'FR',
        currency: 'EUR',
        identifiers: [
          { scheme: 'LEGAL_ID', value: siret },
          { scheme: 'VAT', value: vat },
        ],
      },
    })
    .then((res) => {
      expect(res.status, 'company created').to.be.oneOf([200, 201]);
      const companyId = res.body.id;
      return cy
        .request({ method: 'POST', url: `${api}/api/companies/switch`, body: { companyId } })
        .then(() =>
          cy.request({
            method: 'POST',
            url: `${api}/api/clients`,
            body: {
              name: 'Client France',
              contactEmail: 'client.fr@example.org',
              currency: 'EUR',
              country: 'FR',
              address: '2 Rue de la Paix',
              city: 'Paris',
              postalCode: '75002',
              isActive: true,
              type: 'COMPANY',
            },
          }),
        )
        .then((c) => cy.wrap(c.body.id as string));
    });
}

function issue(clientId: string) {
  return cy
    .request({
      method: 'POST',
      url: `${api}/api/invoices`,
      body: {
        clientId,
        currency: 'EUR',
        notes: '',
        discountRate: 0,
        items: [
          { name: 'Prestation', description: '', quantity: 1, unitPrice: 1000, vatRate: 20, type: 'SERVICE', order: 0 },
        ],
      },
    })
    .then((res) => {
      const id = res.body.id;
      return cy
        .request({ method: 'POST', url: `${api}/api/invoices/${id}/issue`, failOnStatusCode: false })
        .then((iss) => {
          expect(iss.status, `issued (${JSON.stringify(iss.body).slice(0, 200)})`).to.be.oneOf([200, 201]);
          return cy.wrap(id as string);
        });
    });
}

function openInvoice() {
  cy.visit('/invoices', {
    // The browser half of the shift. `['Date']` only — freezing timers as well would stall
    // TanStack Query's retries and the dialog would never finish loading.
    onBeforeLoad: (win) => {
      cy.clock(MANDATE_DAY, ['Date'], { log: false });
      void win;
    },
  });
  cy.get('[data-cy="invoice-name"]', { timeout: 20000 }).first().click();
  cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
  cy.wait(1200);
  cy.get('[data-cy="compliance-panels"]').scrollIntoView({ offset: { top: -80, left: 0 } });
  cy.wait(300);
}

describe('France on 2 September 2026 — the mandate is in force', () => {
  before(() => cy.resetAndSeed());
  beforeEach(() => cy.login());

  it('16 FR — the three obligation layers appear, each on its own clock', () => {
    frCompany('Mandat FR', '73282932000090', 'FR44732829330').then((clientId) => {
      issue(clientId as unknown as string).then(() => {
        openInvoice();
        // The same profile that showed one line on 28 August now shows three. Nothing was deployed
        // in between: the layers carry `validFrom: 2026-09-01` and the engine resolves by date.
        cy.get('[data-cy="obligation-ISSUANCE"]').should('be.visible');
        cy.get('[data-cy="obligation-RECEPTION"]').should('be.visible');
        cy.get('[data-cy="obligation-ARCHIVAL"]').should('be.visible');
        cy.screenshot('16-fr-mandate-three-layers', { capture: 'viewport', overwrite: true });
      });
    });
  });

  it('17 FR — the deadlines are real now: 24 h to issue, 24 h to acknowledge, 6 years to keep', () => {
    frCompany('Mandat FR 2', '73282932000091', 'FR44732829331').then((clientId) => {
      issue(clientId as unknown as string).then(() => {
        openInvoice();
        // Where 28 August said "no deadline established", the profile's own figures now apply —
        // DSE §3.6.5 and §3.6.6 for the two 24 h flows, LPF art. L102 B for the six years.
        cy.get('[data-cy="obligation-layers"]').should('contain.text', '24');
        cy.get('[data-cy="obligation-layers"]').should('contain.text', '6');
        cy.get('[data-cy="obligation-open-ISSUANCE"]').should('not.exist');
        cy.screenshot('17-fr-mandate-deadlines', { capture: 'viewport', overwrite: true });
      });
    });
  });

  it('18 FR — the routing changed with it: the invoice now goes to a PDP, not by email', () => {
    frCompany('Mandat FR 3', '73282932000092', 'FR44732829332').then((clientId) => {
      issue(clientId as unknown as string).then(() => {
        cy.visit('/invoices');
        cy.get('[data-cy="invoice-name"]', { timeout: 20000 }).first().click();
        cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
        cy.wait(1200);
        // Pre-mandate France is post-audit and sends by email. From 1 September the regime is
        // decentralised CTC and the document has to reach an accredited platform, so the action
        // itself is a different one — the label comes from `flow.sendLabelKey`.
        cy.contains('button', /send by email/i).should('not.exist');
        cy.screenshot('18-fr-mandate-routing', { capture: 'viewport', overwrite: true });
      });
    });
  });
});
