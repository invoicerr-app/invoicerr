export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #416 ("payment methods per client") - a client can be restricted to a SUBSET of the
 * company's own enabled payment methods, never a method the company has not enabled. Proven here at
 * the three places the brief names:
 *
 *  1. The restriction is set THROUGH THE SCREEN (client row menu -> "Payment methods" dialog): a
 *     real click on the "Restrict payment methods" switch, a real click on the "Bank transfer"
 * checkbox, a real "Save" - never seeded straight into the database. The dialog's own
 *     "restricted but nothing picked" validation state (Save disabled, a hint shown) is also
 *     produced on purpose, not skipped, since it is the one state a casual click-through would
 *     never reach on its own.
 *  2. Document rendering: the invoice PDF's own "Payment methods" section, read on its DECODED TEXT
 *     (`cy.task("extractPdfText", ...)`, the same technique 61-payment-methods.cy.ts already
 * established) - both methods before any restriction, only "Bank transfer" after.
 *  3. The client portal: the SAME invoice's PDF, fetched through the portal's own bearer-token route
 *     (`GET /api/portal/documents/invoice/:id/pdf`, the same route 56-client-portal.cy.ts already
 * proves is scoped per client) - never a second, portal-only rendering path, so this is really
 *     proving `renderDocumentInstance` is the ONE place both the staff download and the portal
 *     download go through.
 *
 * This is also the one spec this feature's own PR relies on for its "break it, see red; restore it,
 * see green" proof - see the PR description for the exact command and the real output of each run.
 */
const api = Cypress.env("apiUrl");

function setTheme(theme: "light" | "dark") {
  cy.window().then((win) => {
    win.document.documentElement.classList.remove("light", "dark");
    win.document.documentElement.classList.add(theme);
  });
}

/** `send` 501s with no transport configured at all - the same baseline 56-client-portal.cy.ts's own
 *  `configureEmailTransport` sets up for the identical reason. */
function configureEmailTransport() {
  cy.request({
    method: "POST",
    url: `${api}/api/company/info`,
    body: { invoiceTransportId: "email" },
    failOnStatusCode: false,
  }).then((res) => {
    expect(res.status, "transport configured").to.be.oneOf([200, 201]);
  });
}

function enableCompanyMethods() {
  cy.request({
    method: "PATCH",
    url: `${api}/api/payment-methods/bank_transfer`,
    body: { enabled: true, config: { iban: "FR1420041010050500013M02606" } },
  })
    .its("status")
    .should("be.oneOf", [200, 201]);
  cy.request({
    method: "PATCH",
    url: `${api}/api/payment-methods/paypal`,
    body: { enabled: true, config: { email: "billing@acme-client.test" } },
  })
    .its("status")
    .should("be.oneOf", [200, 201]);
}

function createClient(name: string) {
  return cy
    .request({
      method: "POST",
      url: `${api}/api/clients`,
      body: {
        name,
        contactEmail: "restricted-client@example.com",
        currency: "EUR",
        country: "FR",
        address: "1 Rue de la Restriction",
        city: "Paris",
        postalCode: "75001",
        isActive: true,
        type: "COMPANY",
        identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
      },
    })
    .its("body.id");
}

const INVOICE_DATA = (clientId: string) => ({
  client: clientId,
  issueDate: "2026-08-30",
  dueDate: "2026-09-30",
  currency: "EUR",
  lines: [{ description: "Consulting", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
});

function createInvoiceDraft(clientId: string) {
  return cy
    .request({
      method: "POST",
      url: `${api}/api/documents/types/invoice/actions/save-draft`,
      body: { data: INVOICE_DATA(clientId) },
    })
    .then((saved) => {
      const id = saved.body?.document?.id as string;
      expect(id, "invoice draft created").to.be.a("string");
      return id;
    });
}

function sendInvoice(id: string, clientId: string) {
  cy.request({
    method: "POST",
    url: `${api}/api/documents/types/invoice/actions/send`,
    body: { documentId: id, data: INVOICE_DATA(clientId) },
  })
    .its("status")
    .should("be.oneOf", [200, 201]);
  cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
}

/** Decodes the PDF's own real page text, whitespace collapsed - see 61-payment-methods.cy.ts's own
 *  header for why this, rather than a byte-count delta, is what actually proves WHAT a PDF renders. */
function pdfText(url: string, headers?: Record<string, string>): Cypress.Chainable<string> {
  return cy.request({ url, encoding: "binary", headers }).then((res) => {
    expect(res.status, `PDF rendered - ${url}`).to.eq(200);
    expect(res.headers["content-type"]).to.include("application/pdf");
    const base64 = Cypress.Buffer.from(res.body as string, "binary").toString("base64");
    return cy.task("extractPdfText", base64).then((rawText) => String(rawText).replace(/\s+/g, " "));
  });
}

describe("Client payment-method restriction (issue #416)", () => {
  before(() => {
    cy.resetAndSeed();
  });

  beforeEach(() => {
    cy.login();
    configureEmailTransport();
    enableCompanyMethods();
  });

  it("restricts a client to bank transfer through the screen - the PDF and the portal then offer only bank transfer", () => {
    createClient("Bank Transfer Only SARL").then((clientId: string) => {
      // BEFORE any restriction: a fresh invoice to this client already offers BOTH company-enabled
      // methods - the baseline this whole test exists to change.
      createInvoiceDraft(clientId).then((beforeInvoiceId: string) => {
        sendInvoice(beforeInvoiceId, clientId);
        pdfText(`${api}/api/documents/${beforeInvoiceId}/pdf?typeId=invoice`).then((text) => {
          expect(text, "both methods before any restriction").to.contain("Bank transfer");
          expect(text, "both methods before any restriction").to.contain("PayPal");
        });

        // --- Set the restriction THROUGH THE SCREEN ---
        cy.viewport(1280, 720);
        setTheme("light");
        cy.visit("/clients");
        cy.get('[data-cy="clients-search"]').type("Bank Transfer Only SARL");
        cy.contains('[data-cy^="client-row-"]', "Bank Transfer Only SARL").should("be.visible");
        cy.contains('[data-cy^="client-row-"]', "Bank Transfer Only SARL")
          .find('[data-cy^="client-row-menu-"]')
          .click();
        cy.get('[data-cy^="payment-methods-client-button-"]').click();
        cy.get('[data-cy="client-payment-methods-dialog"]', { timeout: 15000 }).should("be.visible");

        // The "unrestricted" default - every company-enabled method is what this client already
        // gets, exactly like any other client, before anything here is touched.
        cy.get('[data-cy="client-payment-methods-restrict-switch"]').should(
          "have.attr",
          "data-state",
          "unchecked",
        );
        cy.screenshot("01-client-payment-methods-dialog-before-light-desktop", { capture: "viewport" });
        setTheme("dark");
        cy.screenshot("02-client-payment-methods-dialog-before-dark-desktop", { capture: "viewport" });
        setTheme("light");
        cy.viewport("iphone-x");
        cy.screenshot("03-client-payment-methods-dialog-before-light-phone", { capture: "viewport" });
        setTheme("dark");
        cy.screenshot("04-client-payment-methods-dialog-before-dark-phone", { capture: "viewport" });
        cy.viewport(1280, 720);
        setTheme("light");

        // The hard-to-reach validation state, produced on purpose: restricted, but nothing picked
        // yet - Save is disabled and a hint explains why, rather than silently saving an empty
        // array (which the backend would read back as UNRESTRICTED, the opposite of what the
        // switch still shows).
        cy.get('[data-cy="client-payment-methods-restrict-switch"]').click();
        cy.get('[data-cy="client-payment-methods-empty-selection-hint"]').should("be.visible");
        cy.get('[data-cy="client-payment-methods-save"]').should("be.disabled");
        cy.screenshot("05-client-payment-methods-dialog-empty-selection-light-desktop", {
          capture: "viewport",
        });

        // Restrict to Bank transfer only.
        cy.get('[data-cy="client-payment-method-checkbox-bank_transfer"]').click();
        cy.get('[data-cy="client-payment-methods-save"]').should("not.be.disabled");
        cy.screenshot("06-client-payment-methods-dialog-after-light-desktop", { capture: "viewport" });
        setTheme("dark");
        cy.screenshot("07-client-payment-methods-dialog-after-dark-desktop", { capture: "viewport" });
        setTheme("light");
        cy.viewport("iphone-x");
        cy.screenshot("08-client-payment-methods-dialog-after-light-phone", { capture: "viewport" });
        setTheme("dark");
        cy.screenshot("09-client-payment-methods-dialog-after-dark-phone", { capture: "viewport" });
        cy.viewport(1280, 720);
        setTheme("light");

        cy.get('[data-cy="client-payment-methods-save"]').click();
        cy.get('[data-cy="client-payment-methods-dialog"]').should("not.exist");

        // The truth is in the database - read back via the API, never trusted from the DOM alone.
        cy.request({ url: `${api}/api/payment-methods/clients/${clientId}` })
          .its("body.methodIds")
          .should("deep.equal", ["bank_transfer"]);

        // --- Client view: the "Payment methods" section now reads "restricted" ---
        cy.contains("button", "Bank Transfer Only SARL").click();
        cy.get('[data-cy="client-view-dialog"]', { timeout: 15000 }).should("be.visible");
        cy.get('[data-cy="client-view-payment-methods-summary"]').should("contain.text", "Bank transfer");
        cy.get('[data-cy="client-view-payment-methods-summary"]').should("not.contain.text", "PayPal");
        // The section sits below the fold in the dialog's own scroll container - scrolled into view
        // before each screenshot so the subject is actually what the image shows, not a dialog header.
        cy.get('[data-cy="client-view-payment-methods-summary"]').scrollIntoView();
        cy.screenshot("10-client-view-payment-methods-after-light-desktop", { capture: "viewport" });
        setTheme("dark");
        cy.screenshot("11-client-view-payment-methods-after-dark-desktop", { capture: "viewport" });
        setTheme("light");
        cy.viewport("iphone-x");
        cy.get('[data-cy="client-view-payment-methods-summary"]').scrollIntoView();
        cy.screenshot("12-client-view-payment-methods-after-light-phone", { capture: "viewport" });
        setTheme("dark");
        cy.screenshot("13-client-view-payment-methods-after-dark-phone", { capture: "viewport" });
        cy.viewport(1280, 720);
        setTheme("light");
        cy.get("body").type("{esc}");
        cy.get('[data-cy="client-view-dialog"]').should("not.exist");

        // --- Document rendering honours the restriction: a NEW invoice to this client ---
        createInvoiceDraft(clientId).then((afterInvoiceId: string) => {
          sendInvoice(afterInvoiceId, clientId);

          pdfText(`${api}/api/documents/${afterInvoiceId}/pdf?typeId=invoice`).then((text) => {
            expect(text, "only Bank transfer after the restriction").to.contain("Bank transfer");
            expect(text, "PayPal must be gone once restricted").to.not.contain("PayPal");
          });

          // --- The client portal honours it too - the SAME invoice, fetched through the portal's
          // own bearer-token route, never a second rendering path. ---
          cy.request({
            method: "POST",
            url: `${api}/api/clients/${clientId}/portal-access`,
          })
            .its("body.token")
            .then((token: string) => {
              pdfText(`${api}/api/portal/documents/invoice/${afterInvoiceId}/pdf`, {
                Authorization: `Bearer ${token}`,
              }).then((text) => {
                expect(text, "the portal's own download also offers only Bank transfer")
                  .to.contain("Bank transfer")
                  .and.not.contain("PayPal");
              });
            });

          // --- A SENT invoice's PDF is the archived legal copy, served verbatim
          // (`documents.service.ts#renderInstancePdf`'s own `findArchivedPdfArtifact` - "the archive
          // IS the legal copy" for any issued status), never re-rendered on each download. A
          // restriction created AFTER this first invoice was sent must NOT rewrite a legal document
          // already issued: re-downloading it still shows BOTH methods, exactly as it did the moment
          // it was sent - the restriction only ever changes what a FUTURE document offers, matching
          // the same immutability this codebase already holds for legal mentions frozen at issue
          // date. ---
          pdfText(`${api}/api/documents/${beforeInvoiceId}/pdf?typeId=invoice`).then((text) => {
            expect(text, "the already-issued invoice's archived PDF is unchanged by a later restriction")
              .to.contain("Bank transfer")
              .and.to.contain("PayPal");
          });
        });
      });
    });
  });
});
