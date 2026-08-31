/**
 * "request-deposit" (backend/src/modules/documents/actions/request-deposit.ts) proven by a REAL
 * click, same discipline as 21-document-lifecycle.cy.ts: the ACTION runs through the screen, the
 * ASSERTIONS read the record back through the API — never a DOM re-read as proof of what actually
 * got persisted.
 *
 * The scenario: a mono-rate quote (a single VAT rate across every line) sent, then a deposit
 * requested on it — the deposit invoice must exist in DRAFT, reference the quote via `origin`, carry
 * the EXACT computed amount (N% of the quote's own gross total), and reuse that one rate.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("request-deposit — a real click creates a draft deposit invoice", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	let quoteId: string;

	it("sends a mono-rate quote through the screen first — request-deposit needs \"sent\"", () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							// Une seule ligne, un seul taux — 200 EUR HT à 20% = 240 EUR TTC.
							lines: [{ description: "Conseil", quantity: 1, unitPrice: 200, vatRate: "20" }],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
					quoteId = saved.body?.document?.id;
					expect(quoteId, "le brouillon a un identifiant").to.be.a("string");

					cy.visit("/documents/quote");
					cy.get(`[data-cy="document-row-action-send-${quoteId}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should(
						"be.visible",
					);
					cy.get('[data-cy="document-field-recipient-input"]').clear().type("client@example.com");
					cy.get('[data-cy="document-action-params-confirm"]').click();

					cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");
					cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
						.its("body.status")
						.should("eq", "sent");
				});
			});
	});

	it("a real click on \"Request deposit\" creates an exact, referenced draft invoice", () => {
		expect(quoteId, "le devis du test précédent existe toujours").to.be.a("string");

		cy.intercept("POST", `${api}/api/documents/types/quote/actions/request-deposit`).as(
			"requestDeposit",
		);

		cy.visit("/documents/quote");
		cy.get(`[data-cy="document-row-action-request-deposit-${quoteId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-percent-input"]').clear().type("25", { force: true });
		cy.get('[data-cy="document-action-params-confirm"]').click();

		cy.wait("@requestDeposit").then((interception) => {
			const result = interception.response?.body;
			expect(result?.document?.typeId, "l'action a créé une FACTURE").to.eq("invoice");
			expect(result?.document?.status, "en brouillon").to.eq("draft");
			// Ni "multiple VAT rates" ni rien d'autre à choisir : un seul taux sur le devis.
			expect(result?.message, "le taux unique n'exige aucun choix").to.not.match(/multiple VAT rates/);

			const invoiceId = result.document.id;

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` }).then((res) => {
				expect(res.status).to.eq(200);
				const invoice = res.body;

				expect(invoice.status, "toujours en brouillon, relu depuis l'API").to.eq("draft");
				expect(invoice.data.origin, "référence le devis d'origine").to.deep.equal({
					entity: "quote",
					id: quoteId,
				});
				expect(invoice.data.lines, "une seule ligne d'acompte").to.have.length(1);

				// Devis : 200 EUR HT + 20% = 240 EUR TTC. Acompte 25% de 240 = 60 EUR — le montant
				// exact, pas une approximation, et le taux unique du devis repris tel quel.
				expect(invoice.data.lines[0].unitPrice, "montant exact de l'acompte").to.eq(60);
				expect(invoice.data.lines[0].vatRate, "taux repris du devis mono-taux").to.eq("20");
				expect(invoice.data.lines[0].description).to.match(/25%/);
			});
		});
	});
});
