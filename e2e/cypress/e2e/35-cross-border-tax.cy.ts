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
 * France — see `countries/data/fr.json (section "channelPolicy")`), but fixing the date removes any doubt and keeps this
 * file readable without re-reading that rule.
 *
 * VIES: the test backend runs with `VAT_VALIDATION_FAKE=1` (backend/.env.test) — a FAKE,
 * deterministic client, NEVER a real network call, that answers VALID for a syntactically correct
 * VAT number (see `clients.module.ts` and `documents/tax/vat-validation.ts`'s own header): this is
 * what makes the VALID -> reverse-charge transition observable through a real browser, which the
 * Null client (the default under NODE_ENV=test) could not show.
 */
const api = Cypress.env("apiUrl");

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

/**
 * Declares where this company's intra-Community DISTANCE SALES to consumers are taxed — the seller's
 * own country ("ORIGIN", Directive 2006/112/EC art. 32 while art. 59c(1) disapplies art. 33(a) below
 * EUR 10 000 of EU-wide sales to consumers) or the buyer's ("DESTINATION", art. 33(a), once that
 * threshold is crossed or the art. 59c(3) option is taken). Only the B2C GOODS test below needs it:
 * a seller that has declared NOTHING is refused by name at send time
 * (`resolve-invoice-tax.ts#UndeclaredDistanceSalesRegimeError`), since the threshold counts sales
 * this instance has never seen and the option is a legal act — neither is guessable here.
 *
 * Sent as a request rather than driven through the Settings screen's own selector, deliberately: this
 * file's own `setInvoiceTransport` above already establishes that SETUP for a case goes through the
 * API while the case's ACTION goes through the screen. The selector itself
 * (`company-distance-sales-regime-select`) is settings-screen surface with no coverage of its own
 * yet — see this repo's Cypress conventions before adding one.
 */
function setDistanceSalesRegime(regime: "ORIGIN" | "DESTINATION") {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { distanceSalesRegime: regime },
		})
		.then((res) => {
			expect(res.status, "distance-sales regime declared").to.be.oneOf([
				200, 201,
			]);
		});
}

/**
 * The Tax & identifiers step's own VAT field, for a buyer's country: required-and-filled (a real
 * B2B VAT number, driving reverse charge), offered-but-left-empty (B2C, the exact shape that makes
 * `resolveBuyerRole` treat the buyer as a consumer), or not offered at all (no
 * `country-identifiers/data/*.json` file for that country - see `tax-unions/` reference table's own
 * design note on why that is a SEPARATE fact from this one).
 */
type VatFieldExpectation =
	| { kind: "required"; value: string }
	| { kind: "offered-empty" }
	| { kind: "not-offered" };

/**
 * The client-creation flow THROUGH THE SCREEN shared by every cross-border case below (not the
 * unresolvable-country one, which creates its client directly via the API on purpose - see that
 * test's own header for why). Extracted to de-duplicate the identical name/country/address/VAT-
 * field/currency/email/submit sequence that used to differ, across the German reverse-charge,
 * German B2C and United States export cases, only in these field VALUES.
 */
function createClientThroughScreen(opts: {
	name: string;
	countryLabel: string;
	address: string;
	postalCode: string;
	city: string;
	vat: VatFieldExpectation;
	email: string;
}) {
	cy.visit("/clients");
	cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
	cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

	cy.get('[name="name"]').clear().type(opts.name);
	cy.continueSteppedDialog("client-dialog");

	cy.selectCountry("client-country-select", opts.countryLabel);
	cy.get('[name="address"]').clear().type(opts.address);
	cy.get('[name="postalCode"]').clear().type(opts.postalCode);
	cy.get('[name="city"]').clear().type(opts.city);
	cy.continueSteppedDialog("client-dialog");

	if (opts.vat.kind === "not-offered") {
		// No `country-identifiers/data/*.json` file for this country at all - the "unknown country"
		// message is shown INSTEAD of a field, never both, never neither.
		cy.get('[data-cy="client-identifiers-unknown-country"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="client-identifier-VAT"]').should("not.exist");
	} else {
		cy.get('[data-cy="client-identifiers-unknown-country"]').should("not.exist");
		cy.get('[data-cy="client-identifier-VAT"]', { timeout: 10000 }).should("exist");
		if (opts.vat.kind === "required") {
			cy.get('[data-cy="client-identifier-VAT"]').clear().type(opts.vat.value);
		}
	}

	cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
	cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
	cy.get('[data-cy="client-currency-select"] input').type("Euro");
	cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
	cy.continueSteppedDialog("client-dialog");

	cy.get('[name="contacts.0.email"]').clear().type(opts.email);
	cy.continueSteppedDialog("client-dialog");

	cy.get('[data-cy="client-submit"]').click();
	cy.get('[data-cy="client-dialog"]').should("not.exist");
	cy.contains(opts.name, { timeout: 10000 });
}

/**
 * The send-and-download sequence shared by every cross-border case below that actually sends: real
 * click on "Send" (never a direct call to the action), the Draft -> Sent transition on the list, the
 * downloaded CII XML as the proof of the RESOLVED treatment (never the rate typed at draft time).
 * `mentionText` is optional - the B2C/OSS case (standard-rated, category S) carries no cross-border
 * legal mention at all, unlike the reverse-charge and export cases either side of it.
 */
function sendAndDownloadCii(
	invoiceId: string,
	expected: {
		ratePercent: number;
		categoryCode: string;
		mentionText?: string;
		vatTotalStr: string;
		grandTotalStr: string;
	},
) {
	cy.visit("/documents/invoice");
	cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
		.find('[data-cy="document-status-badge"]')
		.should("contain.text", "Draft");

	cy.runDocumentRowAction(invoiceId, "send");

	cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
		.find('[data-cy="document-status-badge"]')
		.should("contain.text", "Sent");

	cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));
	cy.intercept({
		method: "GET",
		pathname: `/api/documents/${invoiceId}/formats/cii`,
	}).as("xmlCii");
	cy.openDocumentRowMenu(invoiceId);
	cy.get(`[data-cy="document-xml-button-${invoiceId}"]`, { timeout: 10000 }).click();
	cy.get(`[data-cy="document-xml-cii-${invoiceId}"]`, { timeout: 10000 })
		.should("be.visible")
		.click();
	cy.wait("@xmlCii", { timeout: 20000 }).then((x) => {
		expect(x.response?.statusCode, "le téléchargement CII réussit").to.eq(200);
		const body = String(x.response?.body);
		// BT-152/BT-151 - the RESOLVED rate and category, never what was typed at draft time.
		expect(body).to.match(
			new RegExp(`<ram:RateApplicablePercent>${expected.ratePercent}</ram:RateApplicablePercent>`),
		);
		expect(body).to.contain(`<ram:CategoryCode>${expected.categoryCode}</ram:CategoryCode>`);
		// BG-1 (BT-22) - the engine's own mention, the benchmark text, AS IS, when this treatment
		// carries one at all.
		if (expected.mentionText) {
			expect(body).to.contain(expected.mentionText);
		}
		expect(body).to.match(
			new RegExp(
				`<ram:TaxTotalAmount currencyID="EUR">${expected.vatTotalStr.replace(".", "\\.")}</ram:TaxTotalAmount>`,
			),
		);
		expect(body).to.match(
			new RegExp(`<ram:GrandTotalAmount>${expected.grandTotalStr.replace(".", "\\.")}</ram:GrandTotalAmount>`),
		);
	});
}

/**
 * The simple post-send settlement check shared by the OSS and export cases below: the STORED,
 * RESOLVED gross total (never the rate typed at draft time) is what `/settlement` reports. The
 * reverse-charge case has its own, richer version of this same check (a REAL payment is recorded
 * first, so it also asserts `paidMinor`/`outstandingMinor`/`settled`) and does not call this helper.
 */
function assertSettlementGross(invoiceId: string, grossMinor: number, label: string) {
	cy.request({
		url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice`,
	})
		.its("body")
		.then((body) => {
			expect(body.totals.grossMinor, label).to.eq(grossMinor);
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
		createClientThroughScreen({
			name: "Deutsche Autoliquidation GmbH",
			countryLabel: "Germany",
			address: "Friedrichstraße 42",
			postalCode: "10117",
			city: "Berlin",
			// checksum-valid (ISO 7064 Mod 11,10) - see vat-syntax.spec.ts
			vat: { kind: "required", value: "DE136695976" },
			email: "buchhaltung@deutsche-autoliquidation.example",
		});

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

					// 3. The downloaded XML - the proof: 0%, category AE, reverse-charge mention. The
					// mention text below is `tax-engine.ts`'s own `MENTION.reverseCharge` entry,
					// asserted verbatim, including its own em dash: never rewritten to match a style
					// rule, it must match production byte for byte.
					sendAndDownloadCii(invoiceId, {
						ratePercent: 0,
						categoryCode: "AE",
						mentionText: "Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC",
						vatTotalStr: "0.00",
						grandTotalStr: "1000.00",
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
					cy.openDocument(invoiceId);
					cy.get('[data-cy="document-totals-gross"]', { timeout: 10000 })
						.should("contain", "1000.00")
						.and("not.contain", "1200.00");
					// Back to the list: the PDF button below is the ROW's own.
					cy.visit("/documents/invoice");

					// 5. The RE-downloaded PDF — a second download, after the fact, not just the one
					// that accompanied the send — also carries the resolved treatment (0%): the
					// network request the click triggers succeeds, on the SAME document already "sent".
					cy.intercept({
						method: "GET",
						pathname: `/api/documents/${invoiceId}/pdf`,
					}).as("pdfCrossBorderReDownload");
					cy.openDocumentRowMenu(invoiceId);
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
					cy.openDocument(invoiceId);
					cy.runDocumentAction("record-payment");
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

				cy.runDocumentRowAction(invoiceId, "send");

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
	// (`countries/data/de.json (section "taxSystem")`'s own `provenance`), so a B2C sale of GOODS to a
	// German consumer with NO VAT number no longer hits `UnsupportedOssDestinationError` — it now
	// resolves to DE's own destination rate. Same discipline as the first test in this file: the
	// client is created BY THE SCREEN, the invoice is sent BY A REAL CLICK, and the assertion that
	// counts is the actual downloaded XML.
	it("a German client WITHOUT a VAT number (B2C) — FR→DE invoice via email, OSS charges the READ German rate (19%), gross total computed", () => {
		setInvoiceTransport("email");
		// DESTINATION — without it this send is now refused by name (see the helper's own comment):
		// 19% is DE's rate under art. 33(a), which only governs once the seller is past the EUR 10 000
		// threshold or has opted in. A seller under it would owe FRENCH VAT on this very sale.
		setDistanceSalesRegime("DESTINATION");

		// The VAT field is OFFERED (same countries/data/de.json (section "identifiers") as the first
		// test) but deliberately left EMPTY - this is what makes `resolveBuyerRole` treat this buyer
		// as B2C (`resolve-invoice-tax.ts`'s own contract: no VAT value at all -> B2C, before VIES is
		// even consulted), which is exactly the shape the OSS branch (not reverse charge) needs.
		createClientThroughScreen({
			name: "Privatkunde Ohne USt-IdNr",
			countryLabel: "Germany",
			address: "Alexanderplatz 1",
			postalCode: "10178",
			city: "Berlin",
			vat: { kind: "offered-empty" },
			email: "privatkunde@ohne-ustidnr.example",
		});

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

					// The downloaded XML — the proof: 19% (the German rate READ from TEDB), category
					// S (standard-rated, at destination), never the 20% typed at draft time and never
					// an `UnsupportedOssDestinationError` block. No cross-border mention here - a
					// standard-rated OSS line carries none.
					sendAndDownloadCii(invoiceId, {
						ratePercent: 19,
						categoryCode: "S",
						vatTotalStr: "190.00",
						grandTotalStr: "1190.00",
					});

					// And this is indeed what gets stored and can be reconciled — same discipline as
					// the first test: the assertion that matters reads back the API, against the
					// RESOLVED and STORED totals.
					assertSettlementGross(invoiceId, 119000, "total résolu : 1190,00 € (19% OSS DE)");
				});
			});
	});

	// Issue #603 (PR A, EU/GCC reference table): the export case, the other half of the cross-border
	// pair this PR's own report proves unchanged. A US buyer is neither EU nor GCC
	// (`tax/tax-unions/data/tax-unions.json` carries no row for "US" at all) - the engine falls
	// through to the export branch, never reverse charge or OSS. Same discipline as the two tests
	// above: the client is created BY THE SCREEN, the invoice is sent BY A REAL CLICK, the assertion
	// that counts is the downloaded XML.
	it("a United States client - FR->US invoice via email, export goods, 0%, category G, art. 146 mention", () => {
		setInvoiceTransport("email");

		// The US has no country file under countries/data/ at all - no identifier scheme is known
		// for it, which is a SEPARATE fact from this PR's own reference table (see "EU/GCC
		// membership and Peppol EAS live in a reference table, not a country file" in
		// adding-a-country.md): a country can be absent from both, absent from one, or present in
		// both, independently. No VAT field is offered - never one left blank on purpose.
		createClientThroughScreen({
			name: "American Exports Inc",
			countryLabel: "United States",
			address: "350 Fifth Avenue",
			postalCode: "10118",
			city: "New York",
			vat: { kind: "not-offered" },
			email: "ap@american-exports.example",
		});

		// The invoice - a GOODS line, so the engine resolves EXPORT (category G, art. 146), not the
		// SERVICES out-of-scope branch (category O) this same table also keeps unchanged (see
		// `resolve-invoice-tax.spec.ts`'s own "FR->US export: G/O, art. 146" block - not re-proven
		// through the screen here; this spec exercises exactly one of the two, the way tests 1/2
		// above each exercise exactly one branch of their own pair).
		cy.request({
			url: `${api}/api/documents/references/client/search?q=American`,
		})
			.its("body")
			.then((clients: { id: string; label: string }[]) => {
				const client = clients.find((c) => c.label.includes("American Exports Inc"));
				expect(client, "le client américain créé ci-dessus se retrouve par la recherche").to
					.exist;

				const data = {
					client: client!.id,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [
						{
							description: "Matériel informatique",
							quantity: 1,
							unit: "unit",
							unitPrice: 2000,
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

					// The downloaded XML - the proof: 0%, category G, export mention, never the 20%
					// typed at draft time and never AE/K (this buyer is not an EU/GCC member at all).
					// The mention text below is `tax-engine.ts`'s own generic `MENTION.exportGoods`
					// entry (country-blind, an EU directive citation, not a per-country fact) -
					// asserted verbatim, including its own em dash: never rewritten to match a style
					// rule, it must match production byte for byte.
					sendAndDownloadCii(invoiceId, {
						ratePercent: 0,
						categoryCode: "G",
						mentionText: "Export — zero-rated, Art. 146 Directive 2006/112/EC",
						vatTotalStr: "0.00",
						grandTotalStr: "2000.00",
					});

					assertSettlementGross(invoiceId, 200000, "total résolu : 2000,00 € (0% export G)");
				});
			});
	});
});
