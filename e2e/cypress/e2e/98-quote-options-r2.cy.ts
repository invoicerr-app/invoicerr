export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #373's SECOND follow-up round (PR #475's second review). Covers:
 *
 *  - point 3 ("wrong VAT line for VAT-exempt companies") - the one point of this round the owner
 *    asked for a screenshot on. `computeQuoteOptionTotals`/`computeCommonLineTotals`
 *    (backend/src/modules/documents/options/quote-options.ts) used to be called without
 *    `sellerExemptVat`, so a franchise-base seller (art. 293 B CGI) whose lines still carry a
 *    non-zero rate printed "VAT 20%" under EVERY option on the downloaded PDF, even though the
 *    screen (and the ordinary single-total PDF) already hid it.
 *  - point 4 ("option mode is not restricted to quotes") - the reviewer explicitly asked for an API
 *    test posting an INVOICE with option-tagged lines and getting a named 400 back, never a silently
 *    kept key. `rejectStrayOptionTag` (documents.service.ts#runAction) is what refuses it.
 *
 * Point 5 of this same round (the missing-currency placeholder) is a backend-only rendering concern
 * with its own render-html.spec.ts coverage - nothing about it is visible through the app UI, so no
 * e2e case is added for it here.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClient(name: string, contactEmail: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				contactEmail,
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
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "the created client has an id").to.be.a("string");
			return id;
		});
}

function saveAndSendOptionQuote(clientId: string, recipient: string) {
	const quoteData = {
		client: clientId,
		issueDate: new Date().toISOString().slice(0, 10),
		currency: "EUR",
		lines: [
			{ description: "Basic package", quantity: 1, unitPrice: 100, option: "Basic", vatRate: "20" },
			{ description: "Premium package", quantity: 1, unitPrice: 300, option: "Premium", vatRate: "20" },
		],
	};
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/quote/actions/save-draft`,
			body: { data: quoteData },
		})
		.then((draft) => {
			const quoteId = draft.body?.document?.id as string;
			expect(quoteId, "quote draft created").to.be.a("string");
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/send`,
					body: { documentId: quoteId, data: quoteData, params: { recipient } },
				})
				.then((res) => {
					expect(res.status, "send accepted").to.be.oneOf([200, 201]);
					return cy
						.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"])
						.then(() => quoteId);
				});
		});
}

describe("Quotes with options - PR #475's second review, point 3 (VAT-exempt PDF)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.viewport(1280, 720);
		cy.login();
	});

	afterEach(() => {
		// Never leak the exemption onto whatever spec runs next against this same seeded company -
		// the same discipline 20-document-totals.cy.ts's own exemptVat describe block already holds.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { exemptVat: false },
			failOnStatusCode: false,
		});
	});

	it("prints NO \"VAT 20%\" line under either option on a VAT-exempt company's sent quote PDF", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { exemptVat: true },
			failOnStatusCode: false,
		})
			.its("status")
			.should("be.oneOf", [200, 201]);

		createClient("Exempt Options Client", "exempt-options@example.com").then((clientId) => {
			saveAndSendOptionQuote(clientId, "exempt-options@example.com").then((quoteId) => {
				cy.request({
					url: `${api}/api/documents/${quoteId}/pdf?typeId=quote`,
					encoding: "binary",
				}).then((res) => {
					expect(res.status).to.eq(200);
					const base64 = Cypress.Buffer.from(res.body as string, "binary").toString("base64");
					cy.task("extractPdfText", base64).then((rawText) => {
						const text = String(rawText).replace(/\s+/g, " ");
						// THE assertion this round's review finding is about: the exemption must hide the
						// VAT breakdown under EVERY option, exactly like the single-total (non-option) path
						// already does for an ordinary exempt invoice (20-document-totals.cy.ts).
						expect(text, "no VAT rate line anywhere under either option").to.not.match(/VAT\s*\d/i);
						// The gross figures still print, unaffected by the display flag - each option's own
						// total is the arithmetic fact, only the breakdown row is display-hidden.
						expect(text, "Basic's own gross total").to.match(/120\.00\s*EUR/);
						expect(text, "Premium's own gross total").to.match(/360\.00\s*EUR/);
					});

					// The rasterised PDF is the actual screenshot artifact (see this repo's own raster2.mjs
					// harness, run outside Cypress) - this call only proves the TEXT is correct; saving the
					// bytes here lets the orchestrator rasterise the exact same PDF this test just checked.
					cy.writeFile(
						"cypress/downloads/475-r2-exempt-options.pdf",
						Cypress.Buffer.from(res.body as string, "binary"),
						{ encoding: null },
					);
				});
			});
		});
	});
});

// Review point #4 ("option mode is not restricted to quotes") - the reviewer's own required test:
// posting an INVOICE (never a quote) with option-tagged lines through the real API must be refused,
// never silently persisted with a stray key that would later confuse the PDF/email/totals paths.
describe("An invoice with option-tagged lines - PR #475's second review, point 4", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("refuses save-draft with a named 400 when a line carries an option tag", () => {
		createClient("Invoice Option Tag Client", "invoice-option-tag@example.com").then((clientId) => {
			const dataWithStrayOption = {
				client: clientId,
				issueDate: new Date().toISOString().slice(0, 10),
				dueDate: new Date().toISOString().slice(0, 10),
				currency: "EUR",
				lines: [
					{ description: "Widget", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20", option: "Basic" },
					{ description: "Gadget", quantity: 1, unit: "unit", unitPrice: 200, vatRate: "20", option: "Premium" },
				],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: dataWithStrayOption },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "refused, never silently persisted").to.eq(400);
				// `res.body.message` (never a raw JSON.stringify of the whole body) - the reviewer's own
				// required check: the field the descriptor never declares is NAMED in the refusal.
				expect(res.body.message, "names lines[0].option").to.contain("lines[0].option");
			});
		});
	});

	it("still saves an ordinary invoice with no option tag anywhere", () => {
		createClient("Invoice No Option Tag Client", "invoice-no-option-tag@example.com").then((clientId) => {
			const ordinaryData = {
				client: clientId,
				issueDate: new Date().toISOString().slice(0, 10),
				dueDate: new Date().toISOString().slice(0, 10),
				currency: "EUR",
				lines: [{ description: "Widget", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" }],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: ordinaryData },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "an ordinary invoice is unaffected").to.be.oneOf([200, 201]);
			});
		});
	});
});
