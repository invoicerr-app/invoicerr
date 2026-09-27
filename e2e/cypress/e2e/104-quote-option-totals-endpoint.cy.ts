export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #487: `GET .../totals`, `GET .../settlement` and the MCP `get_document` tool used to run the
 * totals over EVERY line of a quote with options, so they reported the sum of all options, an
 * amount nobody agreed to. The quote below carries one common line plus two options:
 *   Setup 50 (common) + Basic 100   = 150 net, 180.00 gross
 *   Setup 50 (common) + Premium 200 = 250 net, 300.00 gross
 *   every line summed               = 350 net, 420.00 gross
 *
 * Before acceptance: no single total (top-level amounts null), one total per option, and the
 * settlement refuses with 409. The detail page, which computes its own figures, shows the same thing:
 * one total per option in the totals card and no amount in the header.
 * After a manual acceptance of "Premium" through the UI: the endpoint, the settlement and the MCP
 * tool all carry 300.00, the figure the header shows.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const CLIENT_EMAIL = "option-totals-487@example.com";

const LINES = [
	{ description: "Setup", quantity: 1, unitPrice: 50, vatRate: "20" },
	{
		description: "Basic plan",
		quantity: 1,
		unitPrice: 100,
		vatRate: "20",
		option: "Basic",
	},
	{
		description: "Premium plan",
		quantity: 1,
		unitPrice: 200,
		vatRate: "20",
		option: "Premium",
	},
];

type OptionEntry = { option: string; totals: { netMinor: number; grossMinor: number } };
type TotalsView = {
	netMinor: number | null;
	vatMinor: number | null;
	grossMinor: number | null;
	options: OptionEntry[] | null;
	acceptedOption: string | null;
};

function createClient(): Cypress.Chainable<string> {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Option Totals Client",
				contactEmail: CLIENT_EMAIL,
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Rue des Options",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.its("body.id");
}

function createSentQuote(clientId: string): Cypress.Chainable<string> {
	const data = {
		client: clientId,
		issueDate: new Date().toISOString().slice(0, 10),
		currency: "EUR",
		lines: LINES,
	};
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/quote/actions/save-draft`,
			body: { data },
		})
		.then((draft) => {
			const quoteId = draft.body?.document?.id as string;
			expect(quoteId, "quote draft created").to.be.a("string");
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/send`,
				body: { documentId: quoteId, data, params: { recipient: CLIENT_EMAIL } },
			});
			cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"]);
			return cy.wrap(quoteId);
		});
}

function totalsOf(quoteId: string): Cypress.Chainable<TotalsView> {
	return cy.request(`${api}/api/documents/${quoteId}/totals?typeId=quote`).its("body");
}

function perOption(view: { options: OptionEntry[] | null }) {
	return (view.options ?? []).map(({ option, totals }) => [option, totals.netMinor, totals.grossMinor]);
}

/** `get_document` over the real MCP endpoint (stateless streamable HTTP, JSON-RPC over one POST).
 *  The answer may come back as an SSE frame; the JSON is on its `data:` line. */
function mcpGetDocument(apiKey: string, quoteId: string): Cypress.Chainable<{ totals: TotalsView }> {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/mcp`,
			headers: {
				"x-api-key": apiKey,
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
			},
			body: {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "get_document", arguments: { typeId: "quote", documentId: quoteId } },
			},
		})
		.then((res) => {
			const raw = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
			const json = raw.includes("data:")
				? (raw
						.split("\n")
						.find((line) => line.startsWith("data:"))
						?.slice("data:".length) ?? "")
				: raw;
			const message = JSON.parse(json);
			expect(message.result?.isError, JSON.stringify(message)).to.not.eq(true);
			return message.result.structuredContent;
		});
}

function screenshotOnceFontsLoaded(name: string) {
	cy.document().its("fonts.status").should("eq", "loaded");
	cy.screenshot(name, { capture: "viewport" });
}

describe("Quotes with options: totals endpoint, settlement and MCP (issue #487)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.viewport(1280, 720);
		cy.login();
	});

	it("never sums the options: one total per option before acceptance, the accepted one after", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/api-keys`,
			body: { name: "mcp-487", scopes: ["quotes:read"] },
		})
			.its("body.key")
			.then((apiKey: string) => {
				createClient().then((clientId) => {
					createSentQuote(clientId).then((quoteId) => {
						// --- Before acceptance: no single total, one per option ---
						totalsOf(quoteId).then((view) => {
							expect(view.grossMinor, "no single gross before acceptance").to.eq(null);
							expect(view.netMinor).to.eq(null);
							expect(view.vatMinor).to.eq(null);
							expect(view.acceptedOption).to.eq(null);
							expect(perOption(view)).to.deep.eq([
								["Basic", 15000, 18000],
								["Premium", 25000, 30000],
							]);
						});
						cy.request({
							url: `${api}/api/documents/${quoteId}/settlement?typeId=quote`,
							failOnStatusCode: false,
						})
							.its("status")
							.should("eq", 409);
						mcpGetDocument(apiKey, quoteId).then(({ totals }) => {
							expect(totals.grossMinor, "MCP: no single gross before acceptance").to.eq(null);
							expect(perOption(totals)).to.deep.eq([
								["Basic", 15000, 18000],
								["Premium", 25000, 30000],
							]);
						});

						// The web app says the same thing: one total per option, no headline amount.
						cy.visit(`/documents/quote/${quoteId}`);
						cy.get('[data-cy="document-status-badge"]').should("contain.text", "Sent");
						cy.get('[data-cy="document-option-totals"]', { timeout: 10000 }).should("exist");
						cy.get('[data-cy="document-option-total-group"]').should("have.length", 2);
						cy.contains('[data-cy="document-option-total-group"]', "Basic").should(
							"contain.text",
							"180.00",
						);
						cy.contains('[data-cy="document-option-total-group"]', "Premium").should(
							"contain.text",
							"300.00",
						);
						cy.get('[data-cy="document-detail-amount"]').should("not.exist");
						cy.get('[data-cy="document-status-badge"]').scrollIntoView();
						screenshotOnceFontsLoaded("487-before-acceptance");

						// --- Manual acceptance of "Premium", through the UI ---
						cy.get('[data-cy="document-actions-menu"]').click();
						cy.get('[data-cy="document-accept-manually-button"]').should("be.visible").click();
						cy.get('[data-cy="mark-quote-accepted-dialog"]').should("be.visible");
						cy.get('[data-cy="mark-quote-accepted-option"]').should("be.visible").click();
						cy.contains('[data-cy="mark-quote-accepted-option-item"]', "Premium").click();
						cy.get('[data-cy="mark-quote-accepted-note"]').type("Accepted by phone: Premium.");
						cy.intercept("POST", "**/api/documents/types/quote/actions/accept-manually").as(
							"acceptManually",
						);
						cy.get('[data-cy="mark-quote-accepted-confirm"]').click();
						cy.wait("@acceptManually")
							.its("response.statusCode")
							.should("be.oneOf", [200, 201]);
						cy.get('[data-cy="document-status-badge"]').should("contain.text", "Accepted");
						cy.get('[data-cy="document-detail-amount"]').should("contain.text", "300.00");

						// --- After acceptance: the accepted option's total, common line included ---
						totalsOf(quoteId).then((view) => {
							expect(view.acceptedOption).to.eq("Premium");
							expect(view.netMinor).to.eq(25000);
							expect(view.vatMinor).to.eq(5000);
							expect(view.grossMinor, "Premium + common, never the 42000 sum").to.eq(30000);
							expect(perOption(view)).to.have.length(2);
						});
						cy.request(`${api}/api/documents/${quoteId}/settlement?typeId=quote`)
							.its("body")
							.then((body) => {
								expect(body.totals.grossMinor).to.eq(30000);
								expect(body.settlement.totalGrossMinor).to.eq(30000);
								expect(body.settlement.outstandingMinor).to.eq(30000);
							});
						mcpGetDocument(apiKey, quoteId).then(({ totals }) => {
							expect(totals.acceptedOption).to.eq("Premium");
							expect(totals.grossMinor, "MCP: the accepted option's gross").to.eq(30000);
						});

						cy.get('[data-cy="document-option-accepted-badge"]').should("exist");
						cy.get('[data-cy="document-status-badge"]').scrollIntoView();
						screenshotOnceFontsLoaded("487-after-acceptance");
					});
				});
			});
	});
});
