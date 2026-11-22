export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #605 - browser error reporting is off by default and needs each user's own, stored consent.
 *
 * The e2e backend has no `SENTRY_FRONTEND_DSN` (and must not: a real collection address has no place
 * in a test run), so it answers `available: false`. The API checks run against it as is: decisions
 * are stored, appended, and nothing about the error tracker comes back without a grant. The UI checks
 * stub the GET only, to stand in for an instance that collects reports, and let every PUT reach the
 * real backend, so what the banner and the setting send is what gets stored.
 */
const api = Cypress.env("apiUrl");
const CONSENT_URL = `${api}/api/error-tracking/consent`;

const ASKING = {
    available: true,
    granted: false,
    decisionRequired: true,
    textVersion: "test",
    decision: null,
    decidedAt: null,
    browser: null,
};

/**
 * Screenshots for the pull request, written under `cypress/screenshots/<spec>/pr-screens/` and uploaded by
 * the cypress-run job as the `pr-screenshots-shard-<n>` artifact. Viewport only, so each one shows what a
 * user sees at that step.
 */
function prScreenshot(name: string) {
    cy.screenshot(`pr-screens/${name}`, { capture: "viewport", overwrite: true });
}

function decide(granted: boolean, channel = "settings") {
    return cy.request({ method: "PUT", url: CONSENT_URL, body: { granted, channel } });
}

describe("Error tracking consent", () => {
    it("refuses an anonymous caller and never asks before sign-in", () => {
        cy.clearCookies();
        cy.request({ url: CONSENT_URL, failOnStatusCode: false }).its("status").should("eq", 401);

        cy.intercept("GET", "**/api/error-tracking/consent").as("consent");
        cy.visit("/auth/sign-in");
        cy.get('[data-cy="auth-email-input"]').should("be.visible");
        cy.get("@consent.all").should("have.length", 0);
        cy.get('[data-cy="error-tracking-consent-banner"]').should("not.exist");
    });

    describe("signed in", () => {
        beforeEach(() => {
            cy.login();
        });

        it("stores each decision as a new row and returns nothing about the tracker without a grant", () => {
            cy.request(CONSENT_URL).then(({ body }) => {
                expect(body.granted).to.eq(false);
                expect(body.browser).to.eq(null);
                expect(JSON.stringify(body)).not.to.match(/sentry|glitchtip|@/i);
            });

            decide(true).its("body").should("include", { decision: "granted", browser: null });
            decide(false).its("body").should("include", { decision: "withdrawn", granted: false, browser: null });
            decide(false).its("body").should("include", { decision: "refused" });

            cy.request({ method: "PUT", url: CONSENT_URL, body: { granted: "yes" }, failOnStatusCode: false })
                .its("status")
                .should("eq", 400);
        });

        it("asks with a banner where refusing is as easy as accepting, and stores the answer", () => {
            cy.intercept("GET", "**/api/error-tracking/consent", { body: ASKING }).as("consent");
            cy.intercept("PUT", "**/api/error-tracking/consent").as("decide");
            cy.visit("/dashboard");
            cy.wait("@consent");

            cy.get('[data-cy="error-tracking-consent-banner"]').should("be.visible");
            cy.get('[data-cy="error-tracking-consent-accept"]').should("be.visible");
            cy.get('[data-cy="error-tracking-consent-refuse"]').should("be.visible").click();

            cy.wait("@decide").then(({ request, response }) => {
                expect(request.body).to.deep.eq({ granted: false, channel: "banner" });
                expect(response?.statusCode).to.eq(200);
                expect(response?.body.decision).to.be.oneOf(["refused", "withdrawn"]);
            });
            cy.get('[data-cy="error-tracking-consent-banner"]').should("not.exist");
        });

        it("offers an account setting, off by default, that grants and withdraws", () => {
            cy.intercept("GET", "**/api/error-tracking/consent", {
                body: { ...ASKING, decisionRequired: false },
            }).as("consent");
            cy.intercept("PUT", "**/api/error-tracking/consent").as("decide");
            cy.visit("/account/preferences");
            cy.wait("@consent");

            cy.get('[data-cy="error-tracking-consent-switch"]').should("have.attr", "aria-checked", "false").click();
            cy.wait("@decide").then(({ request, response }) => {
                expect(request.body).to.deep.eq({ granted: true, channel: "settings" });
                expect(response?.body.decision).to.eq("granted");
            });

            cy.intercept("GET", "**/api/error-tracking/consent", {
                body: { ...ASKING, decisionRequired: false, granted: true, decision: "granted" },
            }).as("granted");
            cy.reload();
            cy.wait("@granted");
            cy.get('[data-cy="error-tracking-consent-switch"]').should("have.attr", "aria-checked", "true").click();
            cy.wait("@decide").then(({ request, response }) => {
                expect(request.body).to.deep.eq({ granted: false, channel: "settings" });
                expect(response?.body.decision).to.eq("withdrawn");
            });
        });

        it("shows the consent screens as a user sees them", () => {
            // Every answer is stubbed here: this test records what each state looks like, the ones above
            // check what is stored.
            const settled = { ...ASKING, decisionRequired: false };
            cy.intercept("GET", "**/api/error-tracking/consent", { body: ASKING }).as("asking");
            cy.visit("/dashboard");
            cy.wait("@asking");
            cy.get('[data-cy="error-tracking-consent-banner"]').should("be.visible");
            cy.get('[data-cy="error-tracking-consent-accept"]').should("be.visible");
            cy.get('[data-cy="error-tracking-consent-refuse"]').should("be.visible");
            prScreenshot("1-banner-after-sign-in");

            cy.intercept("GET", "**/api/error-tracking/consent", { body: settled }).as("settled");
            cy.visit("/account/preferences");
            cy.wait("@settled");
            cy.get('[data-cy="error-tracking-consent-banner"]').should("not.exist");
            cy.get('[data-cy="account-preferences-error-tracking-card"]').scrollIntoView();
            cy.get('[data-cy="error-tracking-consent-switch"]').should("have.attr", "aria-checked", "false");
            prScreenshot("2-preferences-off-by-default");

            cy.intercept("PUT", "**/api/error-tracking/consent", {
                body: { ...settled, granted: true, decision: "granted", decidedAt: new Date().toISOString() },
            }).as("grant");
            cy.get('[data-cy="error-tracking-consent-switch"]').click();
            cy.wait("@grant");
            cy.get('[data-cy="error-tracking-consent-switch"]').should("have.attr", "aria-checked", "true");
            prScreenshot("3-preferences-on-after-consent");

            cy.intercept("PUT", "**/api/error-tracking/consent", {
                body: { ...settled, decision: "withdrawn", decidedAt: new Date().toISOString() },
            }).as("withdraw");
            cy.get('[data-cy="error-tracking-consent-switch"]').click();
            cy.wait("@withdraw");
            cy.get('[data-cy="error-tracking-consent-switch"]').should("have.attr", "aria-checked", "false");
            prScreenshot("4-preferences-after-withdrawal");

            // The client portal lives outside the signed-in layout: it never asks, even when the account
            // would be asked.
            cy.intercept("GET", "**/api/error-tracking/consent", { body: ASKING }).as("portalConsent");
            cy.visit(`/portal/${"0".repeat(64)}`);
            cy.get("body").should("be.visible");
            cy.get('[data-cy="error-tracking-consent-banner"]').should("not.exist");
            cy.get("@portalConsent.all").should("have.length", 0);
            prScreenshot("5-portal-without-banner");
        });
    });
});
