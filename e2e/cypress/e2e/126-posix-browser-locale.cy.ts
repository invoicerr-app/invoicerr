export {}; // makes this spec a module, not a global script -- see tsconfig.json
import { companyLawFor } from "../fixtures/company-law";

/**
 * Issue #718 - a POSIX browser locale must not crash a page.
 *
 * Headless Chromium on a C/POSIX OS reports `en-US@posix`, which every `Intl` constructor rejects
 * with "Invalid language tag". Company settings and the ATCUD screen both pass `i18n.language`
 * straight to `Intl.DisplayNames`, so both used to land in the error boundary. The unit tests cover
 * normalisation; this spec proves the two pages a person actually opens.
 */
const api = Cypress.env("apiUrl");

/** Boots the app as a POSIX browser: navigator reports `en-US@posix`, and no stored language wins. */
function visitAsPosixBrowser(path: string) {
    cy.visit(path, {
        onBeforeLoad(win) {
            win.localStorage.removeItem("i18nextLng");
            Object.defineProperty(win.navigator, "languages", {
                value: ["en-US@posix"],
                configurable: true,
            });
            Object.defineProperty(win.navigator, "language", {
                value: "en-US@posix",
                configurable: true,
            });
        },
    });
}

/** The ATCUD tab only exists for a company whose country declares the ATCUD validation code. */
function switchSellerToPortugal() {
    cy.request({
        method: "POST",
        url: `${api}/api/company/info`,
        body: {
            name: "Acme Corp",
            country: "Portugal",
            countryCode: "PT",
            companyLaw: companyLawFor("PT"),
            invoiceTransportId: "email",
            identifiers: [
                { scheme: "LEGAL_ID", value: "509442661" },
                { scheme: "VAT", value: "PT509442661" },
            ],
        },
    })
        .its("status")
        .should("be.oneOf", [200, 201]);
}

describe("Issue #718 - POSIX browser locale", () => {
    beforeEach(() => {
        cy.login();
    });

    it("opens company and ATCUD settings with en-US@posix, with no error boundary", () => {
        visitAsPosixBrowser("/settings/company");
        cy.get('[data-cy="company-name-input"]', { timeout: 30000 }).should("be.visible").and("have.value", "Acme Corp");
        cy.contains("Something went wrong").should("not.exist");
        cy.contains("Invalid language tag").should("not.exist");

        cy.viewport(1280, 720);
        cy.screenshot("718-after-company-settings-posix", { capture: "viewport" });

        switchSellerToPortugal();
        cy.request(`${api}/api/company/info`)
            .its("body.documentValidationCode.scheme")
            .should("eq", "ATCUD");

        visitAsPosixBrowser("/settings/atcud");
        // The section frame exists before `GET /api/company/info` answers, with the
        // "not applicable" message; this card only renders once Portugal's fact has loaded.
        cy.get('[data-cy="atcud-credit-note-number-format-pattern"]', { timeout: 30000 }).should("be.visible");
        cy.contains("Something went wrong").should("not.exist");
        cy.contains("Invalid language tag").should("not.exist");

        cy.viewport(1280, 720);
        cy.screenshot("718-after-atcud-settings-posix", { capture: "viewport" });
    });
});
