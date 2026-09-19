export {}; // makes this spec a module, not a global script -- see tsconfig.json

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

	it("shows the totals on the wizard's Summary step, recomputed from the lines just entered", () => {
		cy.visit("/documents/quote", { timeout: 20000 });
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should(
			"be.visible",
		);

		// "client"/"issueDate"/"currency" (all `required`) are the wizard's own "Details" step —
		// see document-create-dialog.tsx's `buildFieldGroups`. Client: whichever the seed's default
		// search already surfaces, same pattern as 66-purchase-orders.cy.ts's own "supplier" fill.
		cy.get('[data-cy="document-field-client-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-client-input-options"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="document-field-client-input-options"] button').first().click();
		cy.pickToday('[data-cy="document-field-issueDate-input"]');

		// The currency is a SearchSelect (button + filtered list), NOT a native <select>: the first
		// draft of this test looked for `select, input` and found nothing. The pattern is the same as
		// commands.ts::selectCountry — click the button, then click the option by its data-cy.
		// The SearchSelect's data-cy is carried BY the container AND by the trigger: clicking the
		// container unfolds nothing. `commands.ts::selectCountry` has the right pattern — the BUTTON first.
		cy.get('[data-cy="document-field-currency-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', {
			timeout: 10000,
		}).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]')
			.first()
			.click();

		cy.continueDocumentWizard(); // Details -> Lines

		// One line: 100 at 20%. Fields addressed by NAME, like spec 17 — a line's input order is not
		// a contract, their names are.
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("Item 1", { force: true });
		cy.get('input[name="lines.0.quantity"]')
			.clear({ force: true })
			.type("1", { force: true });
		cy.get('input[name="lines.0.unitPrice"]')
			.clear({ force: true })
			.type("100", { force: true });

		// The rate: also a SearchSelect (the country's own catalog). "20 %" is the catalog's French label.
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy$="-input"] button')
			.last()
			.click({ force: true });
		cy.get('[data-cy$="-input-options"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.contains('[data-cy*="-option-"]', /20\s?%/)
			.first()
			.click();

		cy.continueDocumentWizard(); // Lines -> Options (dueDate/notes/clientReference, nothing required)
		cy.continueDocumentWizard(); // Options -> Summary

		// The totals, on the Summary step — the displayed fact comes from the client-side
		// recalculation (document-totals.tsx), mirroring the backend.
		cy.get('[data-cy="document-totals"]', { timeout: 10000 }).should("exist");
		// Anchored, not a bare substring: `formatTotal` renders exactly "120.00 EUR" for 100 net @
		// 20% — a `"contain", "120"` check would pass identically for a x10 amplification bug
		// rendering "1200.00 EUR".
		cy.get('[data-cy="document-totals-gross"]').invoke("text").should("match", /^120\.00 EUR$/);
	});

	// A due date sits a full year (or more) past its issue date often enough in real invoicing —
	// net-60 terms crossing a year boundary, an invoice raised in December — so the calendar has to
	// reach next year from the Details step, not just the current one.
	it("lets an invoice's due date be set a year ahead, through the Details step's own dropdowns", () => {
		cy.visit("/documents/invoice", { timeout: 20000 });
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("be.visible");

		// client/issueDate/dueDate/currency are all `required` on the invoice descriptor, so all
		// four sit on this first ("Details") step — see invoice.descriptor.ts's own field list.
		cy.get('[data-cy="document-field-client-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-client-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-client-input-options"] button').first().click();
		cy.pickToday('[data-cy="document-field-issueDate-input"]');

		const nextYear = new Date().getFullYear() + 1;
		const dueDate = `${nextYear}-03-15`;
		cy.pickDate('[data-cy="document-field-dueDate-input"]', dueDate);
		// The trigger's own displayed label proves the calendar actually landed on next year, before
		// the document is even saved — not just that a request eventually carries the right value.
		cy.get('[data-cy="document-field-dueDate-input"]').should("contain.text", String(nextYear));

		cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();

		cy.continueDocumentWizard(); // Details -> Lines
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("Item 1", { force: true });
		cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("1", { force: true });
		// Unlike the quote descriptor above, an invoice line's `unit` is `required` — left blank, the
		// wizard's own per-step `form.trigger` refuses to advance past this step at all.
		cy.get('input[name="lines.0.unit"]').type("unit", { force: true });
		cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("100", { force: true });

		// Targeted by its OWN data-cy, not `[data-cy$="-input"] button` + `.last()`: a French seller's
		// lines now also carry an optional "Supply type" select (country-fields' `supplyType` overlay),
		// a second `-input`-suffixed button in the same row that `.last()` would land on instead of
		// this one.
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.contains('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]', /20\s?%/)
			.first()
			.click();

		cy.continueDocumentWizard(); // Lines -> Options
		cy.continueDocumentWizard(); // Options -> Summary

		cy.intercept("POST", `${api}/api/documents/types/invoice/actions/save-draft`).as("saveDraft");
		cy.get('[data-cy="document-action-save-draft"]').click();
		cy.wait("@saveDraft").then(({ response }) => {
			const id = response?.body?.document?.id;
			expect(id, "the invoice was created").to.be.a("string");

			// What the SCREEN showed proves nothing until the API says the same thing — the record
			// actually persisted, read back independently of the form that wrote it. `listDocuments`
			// returns a page (`{ items, total, page, pageSize }`), not a bare array.
			cy.request({ url: `${api}/api/documents?typeId=invoice` })
				.its("body.items")
				.then((docs: { id: string; data: Record<string, unknown> }[]) => {
					const created = docs.find((doc) => doc.id === id);
					expect(created, "the saved invoice is in the list").to.exist;
					// `DateField`'s own onChange serializes the PICKED DAY via `Date#toISOString()`, which
					// shifts to UTC — in a positive-offset timezone (this run's own), local midnight on
					// the 15th prints as the 14th late in the evening. Comparing against the SAME
					// `new Date(y, m, d).toISOString()` conversion (not a "03-15" string prefix) is
					// correct regardless of which timezone this happens to run in.
					expect(created?.data.dueDate, "dueDate carries the day picked on screen").to.eq(
						new Date(nextYear, 2, 15).toISOString(),
					);
				});
		});
	});

	// The per-line discount — applied BEFORE VAT, mirrored client-side
	// (totals-calculator.ts) and server-side (compute-totals.ts). A discount typed on screen must
	// change BOTH the totals shown live AND the ones the API returns once saved — hard-coded numbers
	// throughout, the same discipline as the two tests above.
	//
	// The document itself is created via the API first (client/currency/dates — same convention as
	// EVERY other spec in this suite, e.g. 21-document-lifecycle.cy.ts: no cypress spec here drives
	// the date-picker through the UI), so the ONLY thing this test actually types on screen is the
	// discount itself — without conflating it with unrelated
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
					cy.openDocument(id);

					// With no discount (the quote was created without one): 100 EUR net at 20% = 120 EUR gross.
					cy.get('[data-cy="document-totals-gross"]', { timeout: 10000 }).should(
						"contain",
						"120",
					);

					// With a 50% discount, typed right here: 50 EUR net (discounted), 10 EUR VAT (on the
					// discounted base), 60 EUR gross — the displayed fact changes live.
					cy.get('input[name="lines.0.discountPercent"]')
						.clear({ force: true })
						.type("50", { force: true });
					cy.get('[data-cy="document-totals-gross"]', { timeout: 10000 }).should(
						"contain",
						"60",
					);

					cy.get('[data-cy="document-action-save-draft"]').click();
					cy.wait("@saveDraft");

					// What the SCREEN shows proves nothing until the API says the same thing, once
					// actually saved.
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

						// Chromium's own PDF writer compresses the content stream (FlateDecode), so the
						// string "Totals" almost never appears verbatim in the raw bytes — the file-size
						// fallback this used to have would stay green whether the totals block rendered the
						// RIGHT numbers, the WRONG numbers, or none at all, as long as the byte count
						// happened to land above the threshold. Decode the actual page text instead
						// (`cy.task("extractPdfText", ...)`, `pdf-parse` in the Node plugin process — see
						// `cypress.config.ts`'s own header on that task) and assert the real amounts:
						// 2 hours x 50 = 100.00 net, 20% VAT = 20.00, gross = 120.00
						// (`render-html.ts`'s own `netDisplay`/`vatDisplay`/`grossDisplay`, "<amount> EUR").
						const base64 = Cypress.Buffer.from(res.body as string, "binary").toString("base64");
						cy.task("extractPdfText", base64).then((rawText) => {
							// Collapse whitespace: `pdf.js` places each text run where Chromium's layout put
							// it, and a number and its currency code can land in ADJACENT runs joined by more
							// than one space (or, per PDF viewer, a stray newline) — never asserted as one
							// exact literal string for that reason.
							const text = String(rawText).replace(/\s+/g, " ");
							// Verified against a real run: the rendered page's own CSS uppercases this label
							// (`.totals-label`, `render-html.ts`) — `pdf-parse`/`pdf.js` extracts the text as
							// Chromium actually PAINTED it, "TOTALS", never the DOM's original-case string —
							// matched case-insensitively for that reason, not loosened to `/total/i` (which
							// would also match the "Total" row label right below it, proving nothing extra).
							expect(text.toUpperCase(), "the totals section's own label is present").to.contain(
								"TOTALS",
							);
							expect(text, "net amount (100.00 EUR)").to.match(/100\.00\s*EUR/);
							expect(text, "VAT amount (20.00 EUR, 20% of the net base)").to.match(/20\.00\s*EUR/);
							expect(text, "gross amount (120.00 EUR)").to.match(/120\.00\s*EUR/);
						});
					});
				});
			});
	});
});

// VAT display for a VAT-exempt company (`Company.exemptVat`, e.g. FR's "franchise en base", art.
// 293 B CGI) — the screen must stop showing a "Net"/"VAT ... 0.00" pair once the company ticks the
// exemption, even for a draft the tax engine hasn't resolved yet (see `compute-totals.ts`'s own
// `DocumentTotals.showVat`). A separate top-level `describe`, not nested in "Document totals" above,
// so its own `beforeEach` (login only, no reset — the exemption toggle below is this block's own
// state, reverted in its own `afterEach`) never touches the other describe's baseline.
describe("VAT display for a VAT-exempt company", () => {
	before(() => {
		// "send" needs a configured transport (invoice-actions.ts) — same setup as
		// 25-document-settlement.cy.ts's own `before` for the same reason.
		cy.login();
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		})
			.its("status")
			.should("be.oneOf", [200, 201]);
	});

	beforeEach(() => {
		cy.login();
	});

	afterEach(() => {
		// Never leak the exemption onto whatever spec runs next against this same seeded company.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { exemptVat: false },
			failOnStatusCode: false,
		});
	});

	it("hides the Net/VAT rows on screen once the company is marked VAT-exempt — even on a still-unresolved draft", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { exemptVat: true },
			failOnStatusCode: false,
		})
			.its("status")
			.should("be.oneOf", [200, 201]);

		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [{ description: "Item", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" }],
						},
					},
				}).then((saved) => {
					const id = saved.body?.document?.id;
					expect(id).to.be.a("string");

					cy.visit("/documents/invoice", { timeout: 20000 });
					cy.openDocument(id);

					cy.get('[data-cy="document-totals"]', { timeout: 10000 }).should("exist");
					cy.get('[data-cy="document-totals-net"]').should("not.exist");
					cy.get('[data-cy="document-totals-vat"]').should("not.exist");
					// The total itself is untouched by this display flag — see this describe's own
					// header and compute-totals.ts's own `DocumentTotals.showVat`.
					cy.get('[data-cy="document-totals-gross"]').invoke("text").should("match", /^120\.00 EUR$/);
				});
			});
	});

	it("a SENT invoice's PDF shows no VAT line and carries the franchise-en-base legal mention, never a 0.00 VAT row", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { exemptVat: true },
			failOnStatusCode: false,
		})
			.its("status")
			.should("be.oneOf", [200, 201]);

		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [{ description: "Item", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" }],
						},
					},
				}).then((saved) => {
					const id = saved.body?.document?.id;
					expect(id).to.be.a("string");

					// "send" is what actually runs the tax engine's FRANCHISE_BASE branch
					// (tax/resolve-invoice-tax.ts#applyDomesticTaxScheme) — the line's own vatRate (still
					// "20" on the draft above) is rewritten to 0% and the art. 293 B mention persisted,
					// synchronously, before this request returns (see that module's own header).
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: id, data: saved.body.document.data },
						failOnStatusCode: false,
					})
						.its("status")
						.should("be.oneOf", [200, 201]);

					cy.request({
						url: `${api}/api/documents/${id}/pdf?typeId=invoice`,
						encoding: "binary",
					}).then((res) => {
						expect(res.status).to.eq(200);
						const base64 = Cypress.Buffer.from(res.body as string, "binary").toString("base64");
						cy.task("extractPdfText", base64).then((rawText) => {
							const text = String(rawText).replace(/\s+/g, " ");
							// No VAT amount printed at all — not even a "VAT 0% on ... 0.00" row. The negative
							// lookbehind matters: the real (correct) total below IS "100.00 EUR", which itself
							// ends in the substring "0.00 EUR" — a bare /0\.00\s*EUR/ would false-positive on
							// its own last digit, so this only flags a STANDALONE "0.00 EUR" (not preceded by
							// another digit).
							expect(text, "no VAT row of any kind").to.not.match(/VAT\s*\d/i);
							expect(text, "no residual standalone 0.00 amount either").to.not.match(
								/(?<!\d)0\.00\s*EUR/,
							);
							// The mandatory small-business exemption mention still prints — hiding the
							// redundant AMOUNT is not the same as hiding the LEGAL FACT behind it.
							expect(text, "the franchise-en-base mention is printed").to.contain("293 B");
							// One line, 100 net, 0% VAT: the total is the net amount, printed once.
							expect(text, "the (VAT-free) total").to.match(/100\.00\s*EUR/);
						});
					});
				});
			});
	});
});
