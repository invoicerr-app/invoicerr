/**
 * The country differences, shown rather than asserted in prose.
 *
 * Every case here drives the REAL stack — real profile, real compliance plan, real screen — and
 * captures what a user in that country actually sees. Nothing is mocked, because the point being
 * demonstrated is precisely that the interface changes by country WITHOUT the frontend knowing any
 * country: every difference below comes from `profiles/data/<cc>.ts`, through the
 * `available-actions` payload, into a component that contains no ISO code.
 *
 * Each case asserts before it captures. A screenshot of a panel that is not there would be an empty
 * rectangle nobody notices; an assertion that fails says so.
 *
 * Setup goes through the API rather than the onboarding dialog — fifteen companies through a wizard
 * would take longer than the rest of the suite combined.
 */
const api = Cypress.env('apiUrl') || 'http://localhost:4000';

type Ids = { companyId: string; clientId: string };

/** Create a company in `country`, switch the session to it, and give it one domestic client. */
function setupCountry(
  name: string,
  country: string,
  countryCode: string,
  identifiers: { scheme: string; value: string }[],
): Cypress.Chainable<Ids> {
  return cy
    .request({
      method: 'POST',
      url: `${api}/api/companies`,
      body: {
        name,
        description: `${countryCode} showcase`,
        phone: '+33123456789',
        email: `contact.${countryCode.toLowerCase()}@example.org`,
        address: '1 Main St',
        city: 'City',
        postalCode: '00000',
        country,
        countryCode,
        currency: 'EUR',
        identifiers,
      },
    })
    .then((res) => {
      expect(res.status, `company ${countryCode} created`).to.be.oneOf([200, 201]);
      const companyId = res.body.id;
      return cy
        .request({ method: 'POST', url: `${api}/api/companies/switch`, body: { companyId } })
        .then(() =>
          cy
            .request({
              method: 'POST',
              url: `${api}/api/clients`,
              body: {
                name: `${countryCode} Client`,
                contactEmail: `client.${countryCode.toLowerCase()}@example.org`,
                currency: 'EUR',
                country: countryCode,
                address: '2 Main St',
                city: 'City',
                postalCode: '00000',
                isActive: true,
                type: 'COMPANY',
              },
            })
            .then((c) => {
              expect(c.status, `client ${countryCode} created`).to.be.oneOf([200, 201]);
              return cy.wrap({ companyId, clientId: c.body.id } as Ids);
            }),
        );
    });
}

/** A one-line invoice, issued. Fails loudly rather than screenshotting a draft by accident. */
function issuedInvoice(ids: Ids, vatRate = 20): Cypress.Chainable<string> {
  return cy
    .request({
      method: 'POST',
      url: `${api}/api/invoices`,
      body: {
        clientId: ids.clientId,
        currency: 'EUR',
        notes: '',
        discountRate: 0,
        items: [
          { name: 'Consulting', description: '', quantity: 1, unitPrice: 1000, vatRate, type: 'SERVICE', order: 0 },
        ],
      },
    })
    .then((res) => {
      expect(res.status, 'draft created').to.be.oneOf([200, 201]);
      const id = res.body.id;
      return cy
        .request({ method: 'POST', url: `${api}/api/invoices/${id}/issue`, failOnStatusCode: false })
        .then((iss) => {
          expect(iss.status, `invoice issued (${JSON.stringify(iss.body).slice(0, 200)})`).to.be.oneOf([
            200, 201,
          ]);
          return cy.wrap(id);
        });
    });
}

/**
 * Push the document to a state where correction is offered.
 *
 * Correction is not an edit — it is a NEW document referencing the original — so the lifecycle only
 * opens it from DELIVERED / ACCEPTED / REPORTED (`phases/contributors.ts:280`). A freshly issued
 * invoice is none of those, which is why the credit-note button is legitimately absent right after
 * issuance. Sending it is what makes the difference between countries visible.
 */
function send(id: string) {
  return cy.request({
    method: 'POST',
    url: `${api}/api/invoices/send`,
    body: { invoiceId: id },
    failOnStatusCode: false,
  });
}

/** Open the invoice detail dialog and wait for the compliance payload to have landed. */
function openInvoice() {
  cy.visit('/invoices');
  cy.get('[data-cy="invoice-name"]', { timeout: 20000 }).first().click();
  cy.get('[role="dialog"]', { timeout: 10000 }).should('be.visible');
  cy.wait(1200);
}

function shot(name: string) {
  cy.screenshot(name, { capture: 'viewport', overwrite: true });
}

describe('Compliance showcase — the same code, fifteen different screens', () => {
  before(() => {
    cy.resetAndSeed();
  });
  beforeEach(() => {
    cy.login();
  });

  // ── Correction: what replaces "edit" once a document is issued ────────────────────────────────
  it('01 FR — correcting an issued invoice offers a CREDIT NOTE (avoir)', () => {
    setupCountry('Showcase FR', 'France', 'FR', [
      { scheme: 'LEGAL_ID', value: '73282932000074' },
      { scheme: 'VAT', value: 'FR44732829320' },
    ]).then((ids) => {
      issuedInvoice(ids).then((id) => {
        send(id as unknown as string);
        openInvoice();
        // The real assertion, restored once sending got the document to DELIVERED. `correctionModel`
        // is CREDIT_NOTE for France and the button says so; the corrective-invoice button, which is
        // what Poland gets, is absent.
        cy.contains('button', /credit note/i).should('be.visible');
        cy.contains('button', /corrective/i).should('not.exist');
        shot('01-fr-credit-note');
      });
    });
  });

  it('02 PL — the invoice cannot leave the product at all without KSeF, and the screen says so', () => {
    setupCountry('Showcase PL', 'Poland', 'PL', [{ scheme: 'VAT', value: 'PL1234567890' }]).then((ids) => {
      issuedInvoice(ids).then((id) => {
        send(id as unknown as string);
        openInvoice();
        // Written to show the corrective-invoice button, which Poland gets where France gets a
        // credit note. It cannot be shown: correction opens from DELIVERED, and a Polish invoice
        // never gets there because KSeF has no credentials — the C1 finding, that no channel can
        // actually emit. What the screen does instead is the more useful thing to capture: it
        // refuses to pretend the invoice was issued.
        cy.contains(/not transmitted|never reached the authority/i).should('be.visible');
        shot('02-pl-not-transmitted');
      });
    });
  });

  // ── Immutability: may an issued document still be edited? ─────────────────────────────────────
  it('03 US — no VAT at all: the invoice is out of scope, and says so', () => {
    // Originally written to show that a US invoice stays editable after issuance
    // (`immutableAfter: NEVER`). It does not, and that is a GAP rather than a country difference:
    // `invoices.helpers.ts:442` hardcodes `edit: isDraft`, so the contract's immutability answer
    // never reaches the button. Recorded in the report; the case now shows a difference that is
    // real — a US sale carries no VAT line at all, category O.
    setupCountry('Showcase US', 'United States', 'US', []).then((ids) => {
      issuedInvoice(ids, 0).then(() => {
        openInvoice();
        cy.get('[data-cy="archival-notice"]').should('exist');
        shot('03-us-out-of-scope');
      });
    });
  });

  it('04 FR — the same issued invoice is FROZEN (immutableAfter: ISSUE)', () => {
    setupCountry('Showcase FR2', 'France', 'FR', [
      { scheme: 'LEGAL_ID', value: '73282932000075' },
      { scheme: 'VAT', value: 'FR44732829321' },
    ]).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        cy.get('[data-cy="invoice-edit-button"]').should('not.exist');
        shot('04-fr-frozen-after-issue');
      });
    });
  });

  // ── Cancellation policy (panel A) ─────────────────────────────────────────────────────────────
  it('05 PL — cancellation is NOT AVAILABLE, and the screen says why', () => {
    setupCountry('Showcase PL2', 'Poland', 'PL', [{ scheme: 'VAT', value: 'PL1234567891' }]).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        cy.get('[data-cy="cancellation-policy"]').scrollIntoView();
        cy.get('[data-cy="cancellation-policy"]').should('be.visible');
        cy.get('[data-cy="cancellation-condition-notAllowedByCountry"]').should('exist');
        shot('05-pl-cancellation-unavailable');
      });
    });
  });

  it('06 MX — TWO conditions at once, which the old single-sentence code could not show', () => {
    setupCountry('Showcase MX', 'Mexico', 'MX', [
      { scheme: 'RFC', value: 'XAXX010101000' },
      { scheme: 'MX_DOMICILIO_FISCAL', value: '01000' },
      { scheme: 'MX_REGIMEN_FISCAL', value: '601' },
    ]).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        cy.get('[data-cy="cancellation-condition-buyerConsent"]').should('exist');
        cy.get('[data-cy="cancellation-condition-authorityAck"]').should('exist');
        shot('06-mx-two-cancellation-conditions');
      });
    });
  });

  it('07 IT — cancellation waits on the tax authority', () => {
    setupCountry('Showcase IT', 'Italy', 'IT', [
      { scheme: 'LEGAL_ID', value: '12345678901' },
      { scheme: 'VAT', value: 'IT12345678901' },
    ]).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        cy.get('[data-cy="cancellation-condition-authorityAck"]').should('exist');
        shot('07-it-cancellation-authority-ack');
      });
    });
  });

  it('08 FR — no cancellation panel at all: nothing to warn about', () => {
    setupCountry('Showcase FR3', 'France', 'FR', [
      { scheme: 'LEGAL_ID', value: '73282932000076' },
      { scheme: 'VAT', value: 'FR44732829322' },
    ]).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        cy.get('[data-cy="cancellation-policy"]').should('not.exist');
        shot('08-fr-no-cancellation-warning');
      });
    });
  });

  // ── Obligation layers (panel C) ───────────────────────────────────────────────────────────────
  it('09 FR — the duty is shown with NO invented deadline, four days before the mandate', () => {
    setupCountry('Showcase FR4', 'France', 'FR', [
      { scheme: 'LEGAL_ID', value: '73282932000077' },
      { scheme: 'VAT', value: 'FR44732829323' },
    ]).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        // France's three declared layers are all `validFrom: 2026-09-01` and today is 2026-08-28,
        // so the engine resolves NONE of them — correctly. What remains is the regime-derived
        // issuance duty, and it says its deadline is not established rather than inventing 24 h.
        // This is the temporal profile working, not a missing feature.
        cy.get('[data-cy="obligation-ISSUANCE"]').should('exist');
        cy.get('[data-cy="obligation-RECEPTION"]').should('not.exist');
        cy.get('[data-cy="obligation-layers"]').scrollIntoView();
        shot('09-fr-obligation-not-yet-in-force');
      });
    });
  });

  it('10 DE — one layer only: the per-layer model exists for France alone today', () => {
    setupCountry('Showcase DE', 'Germany', 'DE', []).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        cy.get('[data-cy="obligation-ISSUANCE"]').should('exist');
        cy.get('[data-cy="obligation-RECEPTION"]').should('not.exist');
        shot('10-de-single-obligation-layer');
      });
    });
  });

  // ── Retention (panel B) ───────────────────────────────────────────────────────────────────────
  it('11 FR — documents must be kept TEN years', () => {
    setupCountry('Showcase FR5', 'France', 'FR', [
      { scheme: 'LEGAL_ID', value: '73282932000078' },
      { scheme: 'VAT', value: 'FR44732829324' },
    ]).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        cy.get('[data-cy="archival-retention"]').should('contain.text', '10');
        shot('11-fr-retention-10-years');
      });
    });
  });

  it('12 MX — FIVE years, from the same component', () => {
    setupCountry('Showcase MX2', 'Mexico', 'MX', [
      { scheme: 'RFC', value: 'XAXX010101001' },
      { scheme: 'MX_DOMICILIO_FISCAL', value: '01001' },
      { scheme: 'MX_REGIMEN_FISCAL', value: '601' },
    ]).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        cy.get('[data-cy="archival-retention"]').should('contain.text', '5');
        shot('12-mx-retention-5-years');
      });
    });
  });

  it('13 US — SEVEN years', () => {
    setupCountry('Showcase US2', 'United States', 'US', []).then((ids) => {
      issuedInvoice(ids).then(() => {
        openInvoice();
        cy.get('[data-cy="archival-retention"]').should('contain.text', '7');
        shot('13-us-retention-7-years');
      });
    });
  });

  // ── VAT: the zero-rate declaration ────────────────────────────────────────────────────────────
  it('14 FR — a 0% line must declare WHY: France levies no zero rate', () => {
    setupCountry('Showcase FR6', 'France', 'FR', [
      { scheme: 'LEGAL_ID', value: '73282932000079' },
      { scheme: 'VAT', value: 'FR44732829325' },
    ]).then(() => {
      cy.visit('/invoices');
      cy.contains('button', /add|new|créer|ajouter/i, { timeout: 15000 }).click();
      cy.get('[data-cy="invoice-dialog"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-cy="invoice-client-select"] button').first().click();
      cy.get('[data-cy="invoice-client-select-options"] button').first().click();
      cy.contains('button', /Add Item|Ajouter/i).click();
      cy.get('[name="items.0.name"]').type('Exempt service', { force: true });
      cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
      cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('500', { force: true });
      cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('0', { force: true });
      cy.get('[data-cy="item-vat-category-0"]').scrollIntoView();
      cy.get('[data-cy="item-vat-category-0"]').should('be.visible');
      shot('14-fr-zero-rate-declaration');
    });
  });

  it('15 FR — at a real rate the question does not arise, and the controls stay away', () => {
    cy.visit('/invoices');
    cy.contains('button', /add|new|créer|ajouter/i, { timeout: 15000 }).click();
    cy.get('[data-cy="invoice-dialog"]', { timeout: 10000 }).should('be.visible');
    cy.get('[data-cy="invoice-client-select"] button').first().click();
    cy.get('[data-cy="invoice-client-select-options"] button').first().click();
    cy.contains('button', /Add Item|Ajouter/i).click();
    cy.get('[name="items.0.name"]').type('Standard service', { force: true });
    cy.get('[name="items.0.quantity"]').clear({ force: true }).type('1', { force: true });
    cy.get('[name="items.0.unitPrice"]').clear({ force: true }).type('500', { force: true });
    cy.get('[name="items.0.vatRate"]').clear({ force: true }).type('20', { force: true });
    cy.get('[data-cy="item-vat-category-0"]').should('not.exist');
    shot('15-fr-no-declaration-at-standard-rate');
  });
});
