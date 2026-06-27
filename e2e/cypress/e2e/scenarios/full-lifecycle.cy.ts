import { SCENARIOS, IdentifierScheme } from '../../fixtures/scenarios';

const scenarioId = Cypress.env('scenario') as string;
const s = SCENARIOS[scenarioId];
const api = Cypress.env('apiUrl');

function fillCompanyIdentifier(legalId: string, scheme?: IdentifierScheme) {
  const selector = scheme === 'VAT' ? 'company-vat-input' : 'company-legalid-input';
  cy.get('body').then(($body) => {
    if ($body.find(`[data-cy="${selector}"]`).length) {
      cy.get(`[data-cy="${selector}"]`).scrollIntoView().clear({ force: true }).type(legalId, { force: true });
    }
  });
}

function assertCompliance(invoiceId: string, attempts = 5) {
  cy.request(`${api}/api/invoices/${invoiceId}`).its('body').then((inv) => {
    const doc = inv.complianceDocuments?.[0];
    if (!doc && attempts > 0) {
      cy.wait(1000);
      return assertCompliance(invoiceId, attempts - 1);
    }
    expect(doc, 'compliance document created').to.exist;
    expect(doc.status, 'compliance status present').to.exist;
  });
}

describe(`Full lifecycle — ${scenarioId}`, () => {
  before(() => {
    cy.task('resetDatabase');
    cy.visit('/auth/sign-up');
    cy.get('[data-cy="auth-firstname-input"]', { timeout: 10000 }).type('John');
    cy.get('[data-cy="auth-lastname-input"]').type('Doe');
    cy.get('[data-cy="auth-email-input"]').type('john.doe@acme.org');
    cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
    cy.get('[data-cy="auth-submit-btn"]').click();
    cy.url({ timeout: 20000 }).should('include', '/auth/sign-in');
    cy.login();
  });

  it(`runs ${scenarioId} end-to-end`, () => {
    // 1. Onboarding society (supplier country)
    cy.visit('/');
    cy.wait(3000);
    cy.document().then((doc) => {
      if (doc.querySelector('[data-cy="onboarding-dialog"]')) {
        cy.get('[data-cy="onboarding-company-name-input"]').clear().type(s.company.name);
        cy.selectCountry('onboarding-company-country-input', s.company.country);
        cy.get('[data-cy="onboarding-submit-btn"]').click();
      }
    });

    // 2. Company profile (self-sufficient — mirrors completeCompanyProfile from 02-company)
    cy.visit('/settings/company');
    cy.wait(3000);
    cy.get('[data-cy="company-name-input"]', { timeout: 10000 }).should('be.visible');
    cy.get('[data-cy="company-name-input"]').clear({ force: true }).type(s.company.name, { force: true });
    cy.selectCountry('company-country-input', s.company.country);
    cy.wait(500);
    cy.get('[data-cy="company-phone-input"]').clear({ force: true }).type('+123456789', { force: true });
    cy.get('[data-cy="company-email-input"]').clear({ force: true }).type('company@example.com', { force: true });
    cy.get('[data-cy="company-address-input"]').clear({ force: true }).type('1 Main St', { force: true });
    cy.get('[data-cy="company-city-input"]').clear({ force: true }).type('City', { force: true });
    cy.get('[data-cy="company-postalcode-input"]').clear({ force: true }).type('10000', { force: true });

    // Currency (explicit select — useCountryToCurrency hook is unreliable in tests)
    cy.get('[data-cy="company-currency-select"] button').first().click();
    cy.wait(300);
    cy.get('[data-cy="company-currency-select-options"]').should('be.visible');
    const currencyLabel = s.company.currency === 'EUR' ? 'euro-(€)' : s.company.currency === 'USD' ? 'us-dollar-($)' : s.company.currency === 'MXN' ? 'mexican-peso-(mx$)' : 'euro-(€)';
    cy.get(`[data-cy="company-currency-select-option-${currencyLabel}"]`).click();

    // Legal id (conditional on country scheme)
    fillCompanyIdentifier(s.company.legalId, s.company.identifierScheme);

    // PDF format + date format (required by zod schema)
    cy.get('[data-cy="company-pdfformat-select"]').click();
    cy.get('[data-cy="company-pdfformat-option-pdf"]').click();
    cy.get('[data-cy="company-dateformat-select"]').click();
    cy.get('[data-cy="company-dateformat-option-dd-MM-yyyy"]').first().click();

    cy.get('[data-cy="company-submit-btn"]').click();
    cy.wait(5000);

    // 3. Client via API (country/type/vat from scenario, currency from scenario)
    const clientBody: Record<string, unknown> = {
      name: s.client.type === 'COMPANY' ? s.client.name : '',
      contactEmail: s.client.email,
      type: s.client.type,
      country: s.client.country,
      address: s.client.address,
      postalCode: s.client.postalCode,
      city: s.client.city,
      currency: s.client.currency,
      isActive: true,
    };
    if (s.client.type === 'INDIVIDUAL') {
      clientBody.contactFirstname = s.client.contactFirstname;
      clientBody.contactLastname = s.client.contactLastname;
    }
    if (s.client.vat) {
      clientBody.identifiers = [{ scheme: 'VAT', value: s.client.vat }];
    }

    cy.request({ method: 'POST', url: `${api}/api/clients`, body: clientBody, failOnStatusCode: false })
      .its('body').then((client) => {
        // 4. Quote + item (currency from scenario, notes required)
        cy.request({
          method: 'POST',
          url: `${api}/api/quotes`,
          body: {
            clientId: client.id,
            currency: s.client.currency,
            title: `Quote ${scenarioId}`,
            notes: `Quote for ${scenarioId}`,
            items: [{
              name: s.item.name,
              description: s.item.name,
              quantity: s.item.quantity,
              unitPrice: s.item.unitPrice,
              vatRate: s.item.vatRate,
              type: s.item.type,
              order: 0,
            }],
          },
        }).its('body').then((quote) => {
          // 5. Signature: request → otp → fetch OTP via mailpit → sign
          cy.clearEmails();
          cy.request('POST', `${api}/api/signatures`, { quoteId: quote.id })
            .its('body.signature.id').then((sigId) => {
              cy.request('POST', `${api}/api/signatures/${sigId}/otp`, {});
              cy.getLastEmail().then((email) => {
                const text = email.Text || email.HTML || '';
                const otp = (text.match(/\d{4}-?\d{4}/) || [])[0]?.replace('-', '') || '';
                expect(otp, 'OTP 8 digits in mail').to.have.length(8);
                cy.request('POST', `${api}/api/signatures/${sigId}/sign`, { otpCode: otp });
              });
            });

          // 6. Verify quote SIGNED (no GET /api/quotes/:id — use table endpoint)
          cy.request(`${api}/api/quotes/table`).its('body').then((quotes) => {
            const q = quotes.find((q: { id: string }) => q.id === quote.id);
            expect(q, 'quote found in table').to.exist;
            expect(q.status).to.eq('SIGNED');
          });

          // 7. Create invoice from quote
          cy.request('POST', `${api}/api/invoices/create-from-quote`, {
            quoteId: quote.id,
            items: [{ quoteItemId: quote.items[0].id, quantity: s.item.quantity }],
          }).its('body').then((invoice) => {
            // 8. Issue + send
            cy.request({ method: 'POST', url: `${api}/api/invoices/${invoice.id}/issue`, failOnStatusCode: false });
            cy.request('POST', `${api}/api/invoices/send`, { id: invoice.id });

            // 9. Verify status SENT/UNPAID + compliance doc exists with status
            cy.request(`${api}/api/invoices/${invoice.id}`).its('body').then((inv) => {
              expect(inv.status).to.be.oneOf(['SENT', 'UNPAID']);
              assertCompliance(invoice.id);
            });
          });
        });
      });
  });
});
