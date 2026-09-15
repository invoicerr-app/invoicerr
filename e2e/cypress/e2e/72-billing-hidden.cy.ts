export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Hosted billing (product decision 2026-09-15, `backend/src/modules/billing/`) is invisible and
 * inert on ANY instance that has not set `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` — which this
 * e2e environment never does (it is a self-hosted-shaped test stack, not the operator's own hosted
 * offering). This is the ONLY billing spec that runs in CI: the full trial/blocked/zipped/deleted
 * lifecycle, the seat sync, and the Polar webhook wiring are all proven by backend jest instead
 * (`billing/*.spec.ts`) — see this feature's own final report for why a real Cypress run against a
 * flag this environment never sets would prove nothing that a 404 doesn't already prove.
 *
 * Three independent proofs, matching `billing.module.ts`'s own "invisible and inert" guarantee:
 *  1. `GET /api/billing/status` answers 404 — `BillingModule` itself was never imported into
 *     `AppModule`, so Nest has no route at all for it (not a 403/501 — a genuine unmatched route).
 *  2. The Settings screen's desktop sidebar nav never offers a "Subscription" entry (the mobile
 *     `<Select>` dropdown lists the exact same `menuItems` array — `-[tab].tsx` — so this one check
 *     already covers both surfaces without a second, Radix-internals-dependent interaction to get
 *     right for no extra assurance).
 *  3. No trial/blocked banner is mounted anywhere in the authenticated app.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Hosted billing — invisible and inert without the flag", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login(); // OWNER (john.doe@acme.org)
	});

	it("GET /api/billing/status answers 404 — the route does not exist", () => {
		cy.request({ url: `${api}/api/billing/status`, failOnStatusCode: false }).then((response) => {
			expect(response.status, "no BillingModule imported, so no route at all").to.eq(404);
		});
	});

	it("Settings never offers a Subscription tab in the sidebar nav", () => {
		cy.visit("/settings");
		cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("exist"); // the default tab loaded

		cy.get("aside", { timeout: 15000 }).should("exist").and("not.contain.text", "Subscription");
	});

	it("no billing banner is mounted anywhere in the authenticated app", () => {
		cy.visit("/dashboard");
		cy.get('[data-cy="billing-banner"]').should("not.exist");

		cy.visit("/settings");
		cy.get('[data-cy="billing-banner"]').should("not.exist");
	});
});
