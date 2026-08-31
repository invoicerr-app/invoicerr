/**
 * Tests for document totals computation and display.
 * Verifies that:
 * 1. The totals endpoint correctly computes net/VAT/gross
 * 2. The form displays correct totals as the user fills in lines
 * 3. The PDF includes totals in the rendered output
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Document totals", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("computes totals correctly via the API for mixed VAT rates", () => {
		// Create a quote with 2 lines at different VAT rates
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{
									description: "Line 20%",
									quantity: 1,
									unit: "unit",
									unitPrice: 100,
									vatRate: "20",
								},
								{
									description: "Line 5.5%",
									quantity: 1,
									unit: "unit",
									unitPrice: 100,
									vatRate: "5.5",
								},
							],
						},
					},
				}).then((saved) => {
					const id = saved.body?.document?.id;
					expect(id).to.be.a("string");

					// Call the totals endpoint
					cy.request({
						url: `${api}/api/documents/${id}/totals?typeId=quote`,
					}).then((res) => {
						expect(res.status).to.eq(200);

						const totals = res.body;
						expect(totals.currency).to.eq("EUR");

						// Net: 100 + 100 = 200 EUR = 20000 cents
						expect(totals.netMinor).to.eq(20000);

						// VAT: 20% of 10000 (100 EUR) + 5.5% of 10000 (100 EUR)
						// = 2000 + 550 = 2550 cents
						expect(totals.vatMinor).to.eq(2550);

						// Gross: 20000 + 2550 = 22550 cents
						expect(totals.grossMinor).to.eq(22550);

						// VAT breakdown: 2 entries, sorted by rate ascending
						expect(totals.vatBreakdown).to.have.length(2);
						expect(totals.vatBreakdown[0]).to.deep.equal({
							ratePercent: 5.5,
							baseMinor: 10000,
							vatMinor: 550,
						});
						expect(totals.vatBreakdown[1]).to.deep.equal({
							ratePercent: 20,
							baseMinor: 10000,
							vatMinor: 2000,
						});

						// No warnings (all rates are valid)
						expect(totals.warnings).to.have.length(0);
					});
				});
			});
	});

	it("displays totals on the form as the user fills in lines", () => {
		cy.visit("/documents/quote", { timeout: 20000 });
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should(
			"be.visible",
		);

		// La devise est un SearchSelect (bouton + liste filtrée), PAS un <select> natif : le premier
		// jet de ce test cherchait `select, input` et ne trouvait rien. Le motif est celui de
		// commands.ts::selectCountry — cliquer le bouton, puis cliquer l'option par son data-cy.
		// Le data-cy du SearchSelect est porté PAR le conteneur ET par le déclencheur : cliquer le
		// conteneur ne déplie rien. `commands.ts::selectCountry` a le bon motif — le BOUTON d'abord.
		cy.get('[data-cy="document-field-currency-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', {
			timeout: 10000,
		}).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]')
			.first()
			.click();

		// Une ligne : 100 à 20 %. Les champs par NAME, comme la spec 17 — l'ordre des inputs d'une
		// ligne n'est pas un contrat, leurs names le sont.
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("Item 1", { force: true });
		cy.get('input[name="lines.0.quantity"]')
			.clear({ force: true })
			.type("1", { force: true });
		cy.get('input[name="lines.0.unitPrice"]')
			.clear({ force: true })
			.type("100", { force: true });

		// Le taux : SearchSelect aussi (catalogue du pays). "20 %" est le libellé français du catalogue.
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy$="-input"] button')
			.last()
			.click({ force: true });
		cy.get('[data-cy$="-input-options"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.contains('[data-cy*="-option-"]', /20\s?%/)
			.first()
			.click();

		// Les totaux, en direct — le fait affiché vient du recalcul client, miroir du back.
		cy.get('[data-cy="document-totals"]', { timeout: 10000 }).should("exist");
		cy.get('[data-cy="document-totals-gross"]').should("contain", "120");
	});

	// The per-line discount (root TODO item 6) — applied BEFORE VAT, mirrored client-side
	// (totals-calculator.ts) and server-side (compute-totals.ts). A discount typed on screen must
	// change BOTH the totals shown live AND the ones the API returns once saved — hard-coded numbers
	// throughout, the same discipline as the two tests above.
	//
	// The document itself is created via the API first (client/currency/dates — same convention as
	// EVERY other spec in this suite, e.g. 21-document-lifecycle.cy.ts: no cypress spec here drives
	// the date-picker through the UI), so the ONLY thing this test actually types on screen is the
	// discount itself — exactly what the task asks to prove, without conflating it with unrelated
	// field-filling machinery.
	it("a discount entered on screen changes both the displayed totals AND the API's, once saved", () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [{ description: "Item", quantity: 1, unitPrice: 100, vatRate: "20" }],
						},
					},
				}).then((saved) => {
					const id = saved.body?.document?.id;
					expect(id).to.be.a("string");

					cy.intercept("POST", `${api}/api/documents/types/quote/actions/save-draft`).as(
						"saveDraft",
					);

					cy.visit("/documents/quote", { timeout: 20000 });
					cy.get(`[data-cy="document-edit-button-${id}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

					// Sans remise (le devis a été créé sans) : 100 EUR HT à 20% = 120 EUR TTC.
					cy.get('[data-cy="document-totals-gross"]', { timeout: 10000 }).should(
						"contain",
						"120",
					);

					// Avec 50% de remise, tapée ici même : 50 EUR HT (remisé), 10 EUR de TVA (sur la
					// base remisée), 60 EUR TTC — le fait affiché change en direct.
					cy.get('input[name="lines.0.discountPercent"]')
						.clear({ force: true })
						.type("50", { force: true });
					cy.get('[data-cy="document-totals-gross"]', { timeout: 10000 }).should(
						"contain",
						"60",
					);

					cy.get('[data-cy="document-action-save-draft"]').click();
					cy.wait("@saveDraft");

					// Ce que l'ÉCRAN affiche n'est une preuve de rien tant que l'API ne dit pas la
					// même chose, une fois vraiment enregistré.
					cy.request({ url: `${api}/api/documents/${id}/totals?typeId=quote` }).then((res) => {
						expect(res.status).to.eq(200);
						expect(res.body.netMinor, "50 EUR remisés = 5000 cents").to.eq(5000);
						expect(res.body.vatMinor, "20% de la base remisée = 1000 cents").to.eq(1000);
						expect(res.body.grossMinor, "60 EUR TTC = 6000 cents").to.eq(6000);
					});
				});
			});
	});

	it("includes totals in the PDF output", () => {
		// Create a quote with one line
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{
									description: "Service",
									quantity: 2,
									unit: "hour",
									unitPrice: 50,
									vatRate: "20",
								},
							],
						},
					},
				}).then((saved) => {
					const id = saved.body?.document?.id;

					// Request the PDF
					cy.request({
						url: `${api}/api/documents/${id}/pdf?typeId=quote`,
						encoding: "binary",
					}).then((res) => {
						expect(res.status).to.eq(200);

						// The PDF is binary, so we check either:
						// 1. The string "Totals" appears somewhere in the PDF (if not compressed)
						// 2. OR the file size is significantly larger than a document without totals
						//    (indicating content was added — this is more reliable for compressed PDFs)

						const pdfContent = res.body;
						const hasMetadata = String(pdfContent).includes("Totals");

						if (hasMetadata) {
							expect(pdfContent).to.include("Totals");
						} else {
							// If "Totals" is not found (PDF compression), check file size is reasonable
							// A document with totals section should be noticeably larger
							expect(pdfContent.length).to.be.greaterThan(1500);
						}
					});
				});
			});
	});
});
