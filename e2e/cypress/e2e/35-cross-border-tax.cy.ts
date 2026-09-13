export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The cross-border case — the deepest boundary, proven through the screen.
 *
 * Same discipline as 30/32: the ACTION goes through a real click (create the client, click "Send",
 * click the XML download button), the ASSERTIONS that matter read back the API or intercept the
 * real network request the click triggers — never the screen alone as proof of what was computed
 * or sent.
 *
 * `issueDate` fixed BEFORE the FR/PDP mandate (2026-09-01) on BOTH invoices in this file — like
 * 30/32 — so the "email" transport (never "pdp") stays the path under test; the mandate itself
 * would not apply to an FR→DE sale anyway (the bilateral attachment requires BOTH parties to be in
 * France — see `channel-policy/data/fr.json`), but fixing the date removes any doubt and keeps this
 * file readable without re-reading that rule.
 *
 * VIES: the test backend runs with `VAT_VALIDATION_FAKE=1` (backend/.env.test) — a FAKE,
 * deterministic client, NEVER a real network call, that answers VALID for a syntactically correct
 * VAT number (see `clients.module.ts` and `documents/tax/vat-validation.ts`'s own header): this is
 * what makes the VALID -> reverse-charge transition observable through a real browser, which the
 * Null client (the default under NODE_ENV=test) could not show.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function setInvoiceTransport(transportId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: transportId },
		})
		.then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});
}

describe("The cross-border case, through the screen", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("a German client with an intra-Community VAT number (NEW field) — FR→DE invoice via email, 0%, category AE, art. 196 mention", () => {
		setInvoiceTransport("email");

		// 1. The German client, created THROUGH THE SCREEN — proof that the VAT field is now offered
		// for a country that had NO `country-identifiers/data/*.json` file at all before this task.
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Deutsche Autoliquidation GmbH");
		cy.selectCountry("client-country-select", "Germany");

		// Before this task, a country with no country-identifiers/data/xx.json showed only the
		// "unknown country" message — never a field. Proving it ABSENT is what distinguishes "the
		// field exists" from "the form just displays something".
		cy.get('[data-cy="client-identifiers-unknown-country"]').should(
			"not.exist",
		);
		cy.get('[data-cy="client-identifier-VAT"]', { timeout: 10000 })
			.should("exist")
			.clear()
			.type("DE136695976"); // checksum-valid (ISO 7064 Mod 11,10) — see vat-syntax.spec.ts

		cy.get('[name="contactEmail"]')
			.clear()
			.type("buchhaltung@deutsche-autoliquidation.example");
		cy.get('[name="address"]').clear().type("Friedrichstraße 42");
		cy.get('[name="postalCode"]').clear().type("10117");
		cy.get('[name="city"]').clear().type("Berlin");

		cy.get('[data-cy="client-currency-select"] button')
			.scrollIntoView()
			.click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Deutsche Autoliquidation GmbH", { timeout: 10000 });

		// 2. The FR→DE invoice — created via the API (same convention as 30/32: the data is
		// prepared via the API, the ACTION under test goes through the screen), with a SERVICES line
		// so the engine resolves reverse charge (AE, art. 196), not the intra-EU supply (K, art. 138).
		cy.request({
			url: `${api}/api/documents/references/client/search?q=Deutsche`,
		})
			.its("body")
			.then((clients: { id: string; label: string }[]) => {
				const client = clients.find((c) =>
					c.label.includes("Deutsche Autoliquidation"),
				);
				expect(
					client,
					"le client allemand créé ci-dessus se retrouve par la recherche",
				).to.exist;

				const data = {
					client: client!.id,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [
						{
							description: "Conseil stratégique",
							quantity: 1,
							unit: "day",
							unitPrice: 1000,
							vatRate: "20",
							supplyType: "SERVICES",
						},
					],
				};

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId).to.be.a("string");

					cy.visit("/documents/invoice");
					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, {
						timeout: 15000,
					})
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Draft");

					// THE ACTION: a real click on "Send" — never a direct call to the action.
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, {
						timeout: 15000,
					}).click();

					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, {
						timeout: 20000,
					})
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// 3. The downloaded XML — the proof: 0%, category AE, reverse-charge mention.
					cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));
					cy.intercept({
						method: "GET",
						pathname: `/api/documents/${invoiceId}/formats/cii`,
					}).as("xmlCiiCrossBorder");
					cy.get(`[data-cy="document-xml-button-${invoiceId}"]`, {
						timeout: 10000,
					}).click();
					cy.get(`[data-cy="document-xml-cii-${invoiceId}"]`, {
						timeout: 10000,
					})
						.should("be.visible")
						.click();
					cy.wait("@xmlCiiCrossBorder", { timeout: 20000 }).then((x) => {
						expect(
							x.response?.statusCode,
							"le téléchargement CII réussit",
						).to.eq(200);
						const body = String(x.response?.body);
						// BT-152/BT-151 — 0%, category AE, never the 20% originally typed.
						expect(body).to.match(
							/<ram:RateApplicablePercent>0<\/ram:RateApplicablePercent>/,
						);
						expect(body).to.contain("<ram:CategoryCode>AE</ram:CategoryCode>");
						// BG-1 (BT-22) — the engine's own mention, the benchmark text, AS IS.
						expect(body).to.contain(
							"Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC",
						);
						// The totals reflect the RESOLVED treatment (0%), never the draft's 20%.
						expect(body).to.match(
							/<ram:TaxTotalAmount currencyID="EUR">0\.00<\/ram:TaxTotalAmount>/,
						);
						expect(body).to.match(
							/<ram:GrandTotalAmount>1000\.00<\/ram:GrandTotalAmount>/,
						);
					});

					// And this is indeed what gets stored — the assertion that matters reads back the API.
					cy.request({
						url: `${api}/api/documents/${invoiceId}?typeId=invoice`,
					})
						.its("body")
						.then((doc) => {
							expect(doc.status).to.eq("sent");
						});

					// 4. THE DEFECT FROM TASK 16 (surgical fix) — the STORED data (what `instance.data`
					// now carries from the moment it enters "sending") must be the RESOLVED data: the
					// LIST (the dialog opened from a row) must display the RESOLVED total (€1000.00,
					// 0% VAT), never €1200.00 (the 20% typed at draft time). Before the fix,
					// `instance.data` kept the typed rate and this total would have shown 1200.00 —
					// this is the assertion that would have failed on the defect.
					cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, {
						timeout: 15000,
					}).click();
					cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should(
						"be.visible",
					);
					cy.get('[data-cy="document-totals-gross"]', { timeout: 10000 })
						.should("contain", "1000.00")
						.and("not.contain", "1200.00");
					cy.get("body").type("{esc}");
					cy.get('[data-cy="document-edit-dialog"]').should("not.exist");

					// 5. The RE-downloaded PDF — a second download, after the fact, not just the one
					// that accompanied the send — also carries the resolved treatment (0%): the
					// network request the click triggers succeeds, on the SAME document already "sent".
					cy.intercept({
						method: "GET",
						pathname: `/api/documents/${invoiceId}/pdf`,
					}).as("pdfCrossBorderReDownload");
					cy.get(`[data-cy="document-pdf-button-${invoiceId}"]`, {
						timeout: 10000,
					}).click();
					cy.wait("@pdfCrossBorderReDownload", { timeout: 20000 }).then((x) => {
						expect(
							x.response?.statusCode,
							"le PDF re-téléchargé réussit",
						).to.eq(200);
					});

					// 6. RECONCILING a cross-border invoice — a payment of €1000.00 (the RESOLVED
					// total, never €1200.00) fully settles the invoice: the badge becomes "Settled",
					// and the API confirms it against the STORED totals (never a hidden recomputation
					// that would mask the defect).
					cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, {
						timeout: 15000,
					}).click();
					cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should(
						"be.visible",
					);
					cy.get('[data-cy="document-action-record-payment"]', {
						timeout: 15000,
					}).click();
					cy.get('[data-cy="document-action-params-dialog"]', {
						timeout: 10000,
					}).should("be.visible");
					cy.get('[data-cy="document-action-params-dialog"]')
						.find('[data-cy="document-field-amount-input"]')
						.clear({ force: true })
						.type("1000", { force: true });
					cy.get('[data-cy="document-action-params-confirm"]').click();
					cy.get('[data-cy="document-action-params-dialog"]').should(
						"not.exist",
					);

					cy.get('[data-cy="document-settlement-badge"]', {
						timeout: 15000,
					}).should("contain.text", "Settled");

					cy.request({
						url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice`,
					})
						.its("body")
						.then((body) => {
							// €1000.00 resolved, never €1200.00 (20% from the draft) — the exact number
							// this defect used to get wrong before the fix.
							expect(
								body.totals.grossMinor,
								"total résolu : 1000,00 € (0 % AE)",
							).to.eq(100000);
							expect(body.settlement.paidMinor).to.eq(100000);
							expect(
								body.settlement.outstandingMinor,
								"réglée intégralement",
							).to.eq(0);
							expect(body.settlement.settled).to.eq(true);
						});
				});
			});
	});

	it("a client with no resolvable country — sending is refused ON SCREEN, a named message, never a silent 0%", () => {
		setInvoiceTransport("email");

		// The client FORM requires a country (zod validation on the screen side) — this client is
		// therefore created directly via the API, the way a scripted client would, to bring the
		// invoice into the state this test targets: it's the REFUSAL AT SEND that this test proves
		// through the screen, not the client creation itself (already proven by the previous test).
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Sans Pays SARL",
				contactEmail: `sans-pays-${Date.now()}@example.com`,
				address: "1 Rue Inconnue",
				postalCode: "00000",
				city: "Nulle Part",
				country: "",
				currency: "EUR",
				isActive: true,
				type: "COMPANY",
			},
		}).then((createdClient) => {
			expect(createdClient.status).to.be.oneOf([200, 201]);
			const clientId = createdClient.body?.id as string;
			expect(clientId).to.be.a("string");

			const data = {
				client: clientId,
				issueDate: "2026-08-30",
				dueDate: "2026-09-30",
				currency: "EUR",
				lines: [
					{
						description: "Conseil",
						quantity: 1,
						unit: "day",
						unitPrice: 1000,
						vatRate: "20",
					},
				],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data },
			}).then((saved) => {
				const invoiceId = saved.body?.document?.id as string;
				expect(invoiceId).to.be.a("string");

				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, {
					timeout: 15000,
				}).click();

				// The preflight blocks SYNCHRONOUSLY — a named toast says so immediately, the same
				// discipline as 32-channel-mandate.cy.ts for its own preflight refusal.
				cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
					"contain.text",
					"buyer's country could not be determined",
				);

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(
							doc.status,
							'jamais persisté au-delà de "draft" — bloqué avant toute écriture, jamais un 0% silencieux',
						).to.eq("draft");
					});
			});
		});
	});

	// The OSS gate's own real-world gap ("OSS hors FR"), closed 2026-09-01:
	// Germany's real standard VAT rate (19%) is sourced from the European Commission's TEDB
	// (`documents/tax/tax-systems/data/de.json`'s own `provenance`), so a B2C sale of GOODS to a
	// German consumer with NO VAT number no longer hits `UnsupportedOssDestinationError` — it now
	// resolves to DE's own destination rate. Same discipline as the first test in this file: the
	// client is created BY THE SCREEN, the invoice is sent BY A REAL CLICK, and the assertion that
	// counts is the actual downloaded XML.
	it("a German client WITHOUT a VAT number (B2C) — FR→DE invoice via email, OSS charges the READ German rate (19%), gross total computed", () => {
		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Privatkunde Ohne USt-IdNr");
		cy.selectCountry("client-country-select", "Germany");

		// The VAT field is OFFERED (same country-identifiers/data/de.json as the first test) but
		// deliberately left EMPTY — this is what makes `resolveBuyerRole` treat this buyer as B2C
		// (`resolve-invoice-tax.ts`'s own contract: no VAT value at all → B2C, before VIES is even
		// consulted), which is exactly the shape the OSS branch (not reverse charge) needs.
		cy.get('[data-cy="client-identifier-VAT"]', { timeout: 10000 }).should(
			"exist",
		);

		cy.get('[name="contactEmail"]')
			.clear()
			.type("privatkunde@ohne-ustidnr.example");
		cy.get('[name="address"]').clear().type("Alexanderplatz 1");
		cy.get('[name="postalCode"]').clear().type("10178");
		cy.get('[name="city"]').clear().type("Berlin");

		cy.get('[data-cy="client-currency-select"] button')
			.scrollIntoView()
			.click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Privatkunde Ohne USt-IdNr", { timeout: 10000 });

		// The invoice — a GOODS line (not SERVICES) so the engine actually reaches the OSS branch
		// (`tax-engine.ts`: B2C GOODS/DIGITAL across the union → `ossDestinationVat`; B2C SERVICES
		// falls back to the seller's own rate and never needs a destination table at all).
		cy.request({
			url: `${api}/api/documents/references/client/search?q=Privatkunde`,
		})
			.its("body")
			.then((clients: { id: string; label: string }[]) => {
				const client = clients.find((c) =>
					c.label.includes("Privatkunde Ohne USt-IdNr"),
				);
				expect(
					client,
					"le client allemand B2C créé ci-dessus se retrouve par la recherche",
				).to.exist;

				const data = {
					client: client!.id,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [
						{
							description: "Casque audio sans fil",
							quantity: 10,
							unit: "unit",
							unitPrice: 100,
							vatRate: "20",
							supplyType: "GOODS",
						},
					],
				};

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId).to.be.a("string");

					cy.visit("/documents/invoice");
					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, {
						timeout: 15000,
					})
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Draft");

					// THE ACTION: a real click on "Send".
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, {
						timeout: 15000,
					}).click();

					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, {
						timeout: 20000,
					})
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// The downloaded XML — the proof: 19% (the German rate READ from TEDB), category
					// S (standard-rated, at destination), never the 20% typed at draft time and never
					// an `UnsupportedOssDestinationError` block.
					cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));
					cy.intercept({
						method: "GET",
						pathname: `/api/documents/${invoiceId}/formats/cii`,
					}).as("xmlCiiOss");
					cy.get(`[data-cy="document-xml-button-${invoiceId}"]`, {
						timeout: 10000,
					}).click();
					cy.get(`[data-cy="document-xml-cii-${invoiceId}"]`, {
						timeout: 10000,
					})
						.should("be.visible")
						.click();
					cy.wait("@xmlCiiOss", { timeout: 20000 }).then((x) => {
						expect(
							x.response?.statusCode,
							"le téléchargement CII réussit",
						).to.eq(200);
						const body = String(x.response?.body);
						// BT-152/BT-151 — 19% (DE), category S, never the French seller's own 20%.
						expect(body).to.match(
							/<ram:RateApplicablePercent>19<\/ram:RateApplicablePercent>/,
						);
						expect(body).to.contain("<ram:CategoryCode>S</ram:CategoryCode>");
						// Totals: 10 × 100 = €1000.00 net, 19% VAT = €190.00, gross = €1190.00.
						expect(body).to.match(
							/<ram:TaxTotalAmount currencyID="EUR">190\.00<\/ram:TaxTotalAmount>/,
						);
						expect(body).to.match(
							/<ram:GrandTotalAmount>1190\.00<\/ram:GrandTotalAmount>/,
						);
					});

					// And this is indeed what gets stored and can be reconciled — same discipline as
					// the first test: the assertion that matters reads back the API, against the
					// RESOLVED and STORED totals.
					cy.request({
						url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice`,
					})
						.its("body")
						.then((body) => {
							expect(
								body.totals.grossMinor,
								"total résolu : 1190,00 € (19% OSS DE)",
							).to.eq(119000);
						});
				});
			});
	});

});
