export {}; // makes this spec a module, not a global script - see tsconfig.json

/**
 * Issue #527 - the Channels settings screen redesigned as design C ("legal channel, then operator"),
 * with design A's obligation banner on top. This spec is the SCREEN-LEVEL proof that:
 *
 *  1. the banner states this company's OWN country situation, sourced from
 *     `channel-policy/data/<cc>.json` via the backend (`channels.service.ts#legalChannels`), never
 *     recomputed in the frontend - a mandated country (FR), a merely-suggested one (PL), and a country
 *     with NO channel mandate at all (DE) each get a truthful banner, never an empty screen;
 *  2. level 1 (legal channels) and level 2 (the operators implementing the selected one, from the
 *     operator catalogue, issue #526) render as two distinct levels, with a search field above level 2;
 *  3. a channel outside this company's own invoicing country stays visible, browsable, but not
 *     connectable, and explains itself without ever naming a foreign platform as an option;
 *  4. a previously-connected channel the current mandate now refuses shows the dedicated warning and
 *     its own disconnect action (state 4 of #527);
 *  5. declarations (`reportingObligations`, e.g. pt-at) render in their OWN section, never mixed with
 *     delivery channels;
 *  6. the connect side sheet is built ENTIRELY from `GET /api/documents/transports`'s own
 *     `credentialFields` (issue #526) - `PROVIDER_FIELDS` is gone, so this is the one proof that a
 *     provider's connect form still collects exactly the fields its own transport parser reads.
 *
 * `31-national-channels.cy.ts`/`32-channel-mandate.cy.ts` already cover the full connect → pick
 * transport → send → disconnect round trip through the new screen for PDP/KSeF/SdI/Chorus Pro - this
 * spec does not repeat that; it proves the states 31/32 never needed (outside-country, blocked,
 * declarations, search, banner tone) and the countries they never visit (DE, PT).
 */
const api = Cypress.env("apiUrl");

/** Switches the seeded company's own country - same helper (and reasoning) as
 *  `31-national-channels.cy.ts`'s own `setCompanyCountry`. */
function setCompanyCountry(country: string, countryCode: string, identifiers?: { scheme: string; value: string }[]) {
	return cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: { name: "Acme Corp", country, countryCode, ...(identifiers ? { identifiers } : {}) },
	});
}

describe("Channels settings - legal channel, then operator (issue #527)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("FR (mandated): the banner states the obligation with its source, PDP is home and lawful, declarations render apart from delivery channels", () => {
		cy.visit("/settings/channels");

		cy.get('[data-cy="channels-banner"]', { timeout: 15000 })
			.should("contain.text", "France")
			.and("contain.text", "2026-09-01")
			.and("contain.text", "plateforme agréée");

		cy.get('[data-cy="channel-nav-pdp"]').should("exist").click();
		cy.get('[data-cy="channel-nav-pdp-badge"]').should("contain.text", "Mandatory from 2026-09-01");
		cy.get('[data-cy="channel-detail-pdp"]').should("exist");

		// Level 2 - every "pdp" operator the catalogue carries (issue #526), read WITHOUT any extra
		// request (the same reference-data fetch backs every legal channel tab).
		cy.get('[data-cy="operator-superpdp-row"]', { timeout: 10000 }).should("exist");
		cy.get('[data-cy="operator-billit-row"]').should("exist");
		cy.get('[data-cy="operator-iopole-row"]').should("exist");

		// The search field above level 2 narrows the operator list, never the level-1 nav.
		cy.get('[data-cy="channel-detail-pdp-search"]').type("Iopole");
		cy.get('[data-cy="operator-iopole-row"]').should("exist");
		cy.get('[data-cy="operator-superpdp-row"]').should("not.exist");
		cy.get('[data-cy="channel-nav-sdi"]').should("exist"); // level 1 untouched by the search
		cy.get('[data-cy="channel-detail-pdp-search"]').clear();

		// A legal channel outside France (SdI, Italy's own mandate) stays visible, its own reason
		// written on the button, never a tooltip - and never a foreign platform offered instead.
		cy.get('[data-cy="channel-nav-sdi"]').click();
		cy.get('[data-cy="channel-nav-sdi-badge"]').should("contain.text", "Outside your invoicing country");
		cy.get('[data-cy="channel-detail-sdi-outside"]')
			.should("contain.text", "Italy")
			.and("contain.text", "domestic operations only");
		cy.get('[data-cy="operator-sdi-connect-button"]')
			.should("be.disabled")
			.and("contain.text", "Outside your invoicing country");

		// Declarations - pt-at is never seeded for a French company, but France's OWN reporting
		// obligations (pdp / fr-ereporting, reporting/data/fr.json) still render, apart from the
		// delivery-channel nav above (never inside `[data-cy^="channel-nav-"]`).
		cy.get('[data-cy="channels-declarations"]').should("exist");
		cy.get('[data-cy="declaration-pdp"]').should("exist");
		cy.get('[data-cy="declaration-fr-ereporting"]').should("have.length", 1);
	});

	it('connects an operator via the side sheet built entirely from `credentialFields` - PROVIDER_FIELDS is gone, the fields come from GET /api/documents/transports', () => {
		cy.intercept("GET", `${api}/api/documents/transports`).as("transports");
		cy.visit("/settings/channels");
		cy.wait("@transports", { timeout: 15000 });

		cy.get('[data-cy="channel-nav-pdp"]', { timeout: 15000 }).click();
		cy.get('[data-cy="operator-iopole-connect-button"]', { timeout: 10000 }).click();

		// Iopole's own three fields (`iopole-transport.ts#IOPOLE_CREDENTIAL_FIELDS`) - no baseUrl, a
		// field PDP's own sheet has and Iopole's does not: proof this sheet renders per-transport
		// fields, never one hard-coded shape reused for every provider.
		cy.get('[data-cy="channel-iopole-clientid-input"]', { timeout: 10000 }).should("exist");
		cy.get('[data-cy="channel-iopole-customerid-input"]').should("exist");
		cy.get('[data-cy="channel-iopole-baseurl-input"]').should("not.exist");

		cy.get('[data-cy="channel-iopole-clientid-input"]').type("iopole-e2e@example.com");
		cy.get('[data-cy="channel-iopole-customerid-input"]').type("00000000-0000-0000-0000-000000000000");
		cy.get('[data-cy="channel-iopole-clientsecret-input"]').type("e2e-fake-secret");
		cy.get('[data-cy="channel-iopole-connect-button"]').click();

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Channel connected");
		cy.get('[data-cy="operator-iopole-status"]', { timeout: 10000 }).should("contain.text", "Connected");

		// "Edit" starts empty - the secret is never echoed back (channels.service.ts's own "GET never
		// leaks a secret" guarantee).
		cy.get('[data-cy="operator-iopole-menu"]').scrollIntoView().click({ force: true });
		cy.get('[data-cy="operator-iopole-edit-button"]').click({ force: true });
		cy.get('[data-cy="channel-iopole-clientid-input"]', { timeout: 10000 }).should("have.value", "");
		cy.get('[data-cy="channel-iopole-customerid-input"]').should("have.value", "");

		// Cleanup - never pollute a later test in this file.
		cy.request({ method: "DELETE", url: `${api}/api/company/channels/iopole` });
	});

	it("blocked state: a previously-connected A-Cube (sdi) no longer sends anything for a French company - a warning, and a working disconnect", () => {
		// Connected directly through the API - the exact shape a company could have reached BEFORE
		// this pass (or a support-assisted connection): the point under test is the WARNING and its
		// disconnect action, never how the row got there. The Channels screen itself, since issue
		// #527, never offers "Connect" for a not-lawful channel - see the FR test above.
		cy.request({
			method: "PUT",
			url: `${api}/api/company/channels/acube`,
			body: { environment: "TEST", config: { email: "acube-e2e@example.com", password: "e2e-fake" } },
		}).its("status").should("be.oneOf", [200, 201]);

		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-nav-sdi"]', { timeout: 15000 }).click();
		cy.get('[data-cy="channel-nav-sdi-badge"]').should("contain.text", "No longer accepted");
		cy.get('[data-cy="channel-detail-sdi-blocked"]', { timeout: 10000 })
			.should("contain.text", "A-Cube")
			.and("contain.text", "no longer sends anything");

		cy.get('[data-cy="channel-detail-sdi-blocked-disconnect"]').click();
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Channel disconnected");
		cy.get('[data-cy="channel-detail-sdi-blocked"]', { timeout: 10000 }).should("not.exist");
		cy.get('[data-cy="channel-nav-sdi-badge"]').should("contain.text", "Outside your invoicing country");

		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then((body: { configured: { providerId: string }[] }) => {
				expect(body.configured.find((c) => c.providerId === "acube"), "acube fully disconnected").to.be
					.undefined;
			});
	});

	it("DE (no channel mandate): the banner states the truth - no empty screen - and every legal channel reads outside the invoicing country", () => {
		setCompanyCountry("Germany", "DE");
		cy.visit("/settings/channels");

		cy.get('[data-cy="channels-banner"]', { timeout: 15000 })
			.should("contain.text", "Germany")
			.and("contain.text", "lawful");

		for (const id of ["pdp", "sdi", "ksef", "chorus-pro"]) {
			cy.get(`[data-cy="channel-nav-${id}-badge"]`).should("contain.text", "Outside your invoicing country");
		}
		// No declarations for Germany - reporting/data/ has no de.json.
		cy.get('[data-cy="channels-declarations"]').should("not.exist");
	});

	it("PL (suggested, not mandated): the banner and nav both say \"recommended\", never \"mandatory\" - the data genuinely stops short of a mandate", () => {
		setCompanyCountry("Poland", "PL", [{ scheme: "VAT", value: "PL5260001246" }]);
		cy.visit("/settings/channels");

		cy.get('[data-cy="channels-banner"]', { timeout: 15000 })
			.should("contain.text", "Poland")
			.and("contain.text", "recommends");
		cy.get('[data-cy="channel-nav-ksef"]').click();
		cy.get('[data-cy="channel-nav-ksef-badge"]')
			.should("contain.text", "Recommended for your country")
			.and("not.contain.text", "Mandatory");
		cy.get('[data-cy="operator-ksef-connect-button"]').should("not.be.disabled");
	});

	it("IT (mandated since 2019): SdI is home and lawful, KSeF is not", () => {
		setCompanyCountry("Italy", "IT", [
			{ scheme: "VAT", value: "IT01234567897" },
			{ scheme: "LEGAL_ID", value: "11223344554" },
		]);
		cy.visit("/settings/channels");

		cy.get('[data-cy="channels-banner"]', { timeout: 15000 })
			.should("contain.text", "Italy")
			.and("contain.text", "2019-01-01");
		cy.get('[data-cy="channel-nav-sdi"]').click();
		cy.get('[data-cy="channel-nav-sdi-badge"]').should("contain.text", "Mandatory from 2019-01-01");
		cy.get('[data-cy="operator-sdi-connect-button"]').should("not.be.disabled");
		cy.get('[data-cy="channel-nav-ksef-badge"]').should("contain.text", "Outside your invoicing country");
	});

	it("PT (declaration, never a channel): no legal channel is home, and pt-at renders only in the Declarations section", () => {
		setCompanyCountry("Portugal", "PT", [{ scheme: "VAT", value: "PT501964843" }]);
		cy.visit("/settings/channels");

		cy.get('[data-cy="channels-banner"]', { timeout: 15000 }).should("contain.text", "Portugal");
		for (const id of ["pdp", "sdi", "ksef", "chorus-pro"]) {
			cy.get(`[data-cy="channel-nav-${id}-badge"]`).should("contain.text", "Outside your invoicing country");
		}
		cy.get('[data-cy="channel-nav-pt-at"]').should("not.exist"); // never a level-1 legal channel

		cy.get('[data-cy="channels-declarations"]').should("exist");
		cy.get('[data-cy="declaration-pt-at"]').should("exist").and("contain.text", "Declaration");
	});
});
