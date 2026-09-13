/**
 * Numbering — proven by the screen, not merely in memory. Same discipline as 17/21: the ACTIONS go
 * through the interface (a real click on "Send"), the ASSERTIONS that matter read the record back
 * via the API, never a DOM re-read as proof of what is in the database.
 *
 * Three facts, in order (state carries across the `it`s in this file — `resetAndSeed` replays only
 * once, in `before`, exactly as 17/21 do):
 *  1. a freshly created quote has NO number at all — neither on the API side (`number: null`) nor
 *     fabricated on screen (the translated "no number yet" label shows instead);
 *  2. a real click on "Send" makes `number: 1` and a `displayNumber` matching the default format
 *     (`QUOTE-{year}-{number:4}`) appear, and the list shows it; a second sent quote gets
 *     `2`, never `1` again;
 *  3. re-saving the first quote (its "save-draft" stays offered even once "sent" — see
 *     quote.descriptor.ts) then re-reading it changes neither its number nor its display.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// QUOTE-2026-0001 — the year is never hardcoded here: it comes from the same clock as the backend
// that assigned the number, not from a date picked for the test.
const DEFAULT_QUOTE_DISPLAY_NUMBER = (n: number) =>
	new RegExp(`^QUOTE-\\d{4}-${String(n).padStart(4, "0")}$`);

describe("Document numbering — never before leaving draft, never twice", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	let firstQuoteId: string;
	let secondQuoteId: string;

	function createDraftQuote(): Cypress.Chainable<string> {
		return cy
			.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

				return cy
					.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/save-draft`,
						body: {
							data: {
								client: clients[0].id,
								issueDate: "2026-08-30",
								currency: "EUR",
								lines: [{ description: "Conseil", quantity: 1, unitPrice: 500 }],
							},
						},
						failOnStatusCode: false,
					})
					.then((saved) => {
						expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
						const id = saved.body?.document?.id;
						expect(id, "le brouillon a un identifiant").to.be.a("string");
						// The draft has NO number at all — never 0, never a fabricated value.
						expect(saved.body?.document?.number, "un brouillon n'a pas de numéro").to.be.null;
						expect(
							saved.body?.document?.displayNumber,
							"un brouillon n'a pas de displayNumber",
						).to.be.null;
						return id as string;
					});
			});
	}

	it("a created quote has NO number — neither on the API side, nor fabricated on screen", () => {
		createDraftQuote().then((id) => {
			firstQuoteId = id;

			cy.visit("/documents/quote");
			cy.get(`[data-cy="document-list-row-${firstQuoteId}"]`, { timeout: 15000 }).should("exist");

			// On screen: the translated label, never a plausible-but-fake number.
			cy.get(`[data-cy="document-number-${firstQuoteId}"]`).should("have.text", "Draft — no number yet");

			// On the API, read back again (not only at creation time): still null.
			cy.request({ url: `${api}/api/documents/${firstQuoteId}?typeId=quote` })
				.its("body")
				.then((doc) => {
					expect(doc.number, "toujours pas de numéro après relecture").to.be.null;
					expect(doc.displayNumber).to.be.null;
				});
		});
	});

	it('a REAL click on "Send" makes number: 1 and a displayNumber matching the default format appear', () => {
		expect(firstQuoteId, "le devis du test précédent existe toujours").to.be.a("string");

		cy.visit("/documents/quote");
		cy.get(`[data-cy="document-row-action-send-${firstQuoteId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-recipient-input"]').clear().type("client@example.com");
		cy.get('[data-cy="document-action-params-confirm"]').click();

		// The list shows it, once the request has settled...
		cy.get(`[data-cy="document-number-${firstQuoteId}"]`, { timeout: 15000 })
			.invoke("text")
			.should("match", DEFAULT_QUOTE_DISPLAY_NUMBER(1));

		// ...and it is indeed what is recorded, not merely what the screen claims.
		cy.request({ url: `${api}/api/documents/${firstQuoteId}?typeId=quote` })
			.its("body")
			.then((doc) => {
				expect(doc.number, "le premier devis envoyé prend le numéro 1").to.eq(1);
				expect(doc.displayNumber).to.match(DEFAULT_QUOTE_DISPLAY_NUMBER(1));
			});
	});

	it('a second sent quote gets number 2 — never 1 again', () => {
		createDraftQuote().then((id) => {
			secondQuoteId = id;

			cy.visit("/documents/quote");
			cy.get(`[data-cy="document-row-action-send-${secondQuoteId}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
			cy.get('[data-cy="document-field-recipient-input"]').clear().type("second-client@example.com");
			cy.get('[data-cy="document-action-params-confirm"]').click();

			cy.get(`[data-cy="document-number-${secondQuoteId}"]`, { timeout: 15000 })
				.invoke("text")
				.should("match", DEFAULT_QUOTE_DISPLAY_NUMBER(2));

			cy.request({ url: `${api}/api/documents/${secondQuoteId}?typeId=quote` })
				.its("body")
				.then((doc) => {
					expect(doc.number, "le second devis envoyé prend le numéro 2, jamais 1 à nouveau").to.eq(2);
					expect(doc.displayNumber).to.match(DEFAULT_QUOTE_DISPLAY_NUMBER(2));
				});
		});
	});

	it("re-saving then re-reading the first quote changes neither its number nor its display", () => {
		expect(firstQuoteId, "le premier devis existe toujours").to.be.a("string");

		cy.visit("/documents/quote");
		// "save-draft" stays offered even once "sent" (quote.descriptor.ts: the transition starts from
		// ANY status) — clicked directly from the list row, a real click,
		// exactly as 21-document-lifecycle.cy.ts does for "send".
		cy.get(`[data-cy="document-row-action-save-draft-${firstQuoteId}"]`, { timeout: 15000 }).click();

		// The list keeps showing the SAME number, never a new one or an empty one.
		cy.get(`[data-cy="document-number-${firstQuoteId}"]`, { timeout: 15000 })
			.invoke("text")
			.should("match", DEFAULT_QUOTE_DISPLAY_NUMBER(1));

		cy.request({ url: `${api}/api/documents/${firstQuoteId}?typeId=quote` })
			.its("body")
			.then((doc) => {
				expect(doc.number, "le numéro ne change jamais une fois pris").to.eq(1);
				expect(doc.displayNumber).to.match(DEFAULT_QUOTE_DISPLAY_NUMBER(1));
			});

		// And the second quote, for its part, keeps its own number — rewriting the first one did not
		// advance the sequence for everyone.
		cy.request({ url: `${api}/api/documents/${secondQuoteId}?typeId=quote` })
			.its("body.number")
			.should("eq", 2);
	});
});
