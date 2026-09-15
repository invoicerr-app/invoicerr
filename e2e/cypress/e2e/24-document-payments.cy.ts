export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * PAYMENTS — proven through the screen, not just in memory. Same discipline as 17/21/22: the
 * ACTIONS go through the interface (a real click on "Send", a real fill-in of the "record-payment"
 * action dialog), the ASSERTIONS that matter read the record back via the API, never a re-read of
 * the DOM as proof of what is in the database.
 *
 * A payment is NOT a document type (no lifecycle, no draft) — it is a
 * record attached to an invoice. The resulting BALANCE is a PROJECTION displayed on
 * screen (a derived badge), never a document status: the invoice stays "sent" from the first to the
 * last euro paid — see backend/.../descriptors/invoice.descriptor.ts.
 *
 * An invoice at 120.00 € gross (100 € net + 20% VAT = 20 €, i.e. 12000 minor units), in
 * order:
 *  1. draft created by the API, sent by a REAL click (transport "email" configured beforehand);
 *  2. a PARTIAL payment of 60 € through the action dialog (real fields) → "Partially paid" badge,
 *     exact balance verified by the API (computed by hand here, not copied from the code);
 *  3. the payment completed (60 € more) → "Settled" badge (renamed from "Paid" as part of
 *     reconciliation: see 25-document-settlement.cy.ts), `outstandingMinor: 0`;
 *  4. a payment in another currency (USD) is refused — visible on screen (error message), with
 *     no effect at all on the already-recorded balance;
 *  5. on a draft, the action is not offered on screen, and the API refuses it too (409).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// 100 € net, 20% VAT -> net 10000, VAT 2000, gross 12000 (minor units).
const GROSS_MINOR = 12000;

describe("An invoice's payments — a record, not a document type", () => {
	before(() => {
		cy.resetAndSeed();

		// "send" on an invoice needs a transport configured (see invoice-actions.ts) — set up once
		// here, as 17/21 do for their own suites.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	function createDraftInvoice(): Cypress.Chainable<string> {
		return cy
			.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

				return cy
					.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/save-draft`,
						body: {
							data: {
								client: clients[0].id,
								issueDate: "2026-08-30",
								dueDate: "2026-09-30",
								currency: "EUR",
								lines: [
									{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" },
								],
							},
						},
						failOnStatusCode: false,
					})
					.then((saved) => {
						expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
						const id = saved.body?.document?.id;
						expect(id, "le brouillon a un identifiant").to.be.a("string");
						return id as string;
					});
			});
	}

	let invoiceId: string;

	it('a REAL click on "Send" moves the invoice to "sent", and the initial balance is due in full', () => {
		createDraftInvoice().then((id) => {
			invoiceId = id;

			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

			cy.get('[data-cy="document-action-send"]', { timeout: 15000 }).click();
			// The proof that sending genuinely succeeded: "record-payment" is only offered on a
			// "sent" invoice (availableWhen: ['sent']) — its mere appearance is enough.
			cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).should("exist");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body.status")
				.should("eq", "sent");

			// The balance, on screen: nothing paid, never settled. `scrollIntoView()`: the section lives
			// in the scrollable dialog (document-upsert-dialog.tsx, `overflow-y-auto`), below the
			// fold until the dialog has scrolled — same pattern as 21's transition-hint.
			cy.get('[data-cy="document-settlement-section"]', { timeout: 15000 })
				.scrollIntoView()
				.should("be.visible");
			cy.get('[data-cy="document-settlement-badge"]').should("contain.text", "Unpaid");
			cy.get('[data-cy="document-settlement-empty"]').should("exist");

			cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
				.its("body")
				.then((body) => {
					expect(body.totals.grossMinor, "brut : 100 € + 20 % de TVA").to.eq(GROSS_MINOR);
					expect(body.settlement).to.deep.equal({
						totalGrossMinor: GROSS_MINOR,
						paidMinor: 0,
						creditedMinor: 0,
						outstandingMinor: GROSS_MINOR,
						excessMinor: 0,
						settled: false,
					});
					expect(body.payments).to.have.length(0);
				});
		});
	});

	it("a PARTIAL payment, through the action dialog (real fields), makes the \"Partially paid\" badge appear", () => {
		expect(invoiceId, "la facture du test précédent existe toujours").to.be.a("string");

		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");

		// Fields SCOPED to the action dialog: the invoice itself ALSO has a "currency" field (its
		// own document field) — `document-field-currency-input` therefore exists twice in the DOM at
		// the same time (the background form AND the action's params). Without this scope, a global
		// `cy.get` grabs the FIRST of the two, the document's, not the action's.
		const dialog = () => cy.get('[data-cy="document-action-params-dialog"]');

		// `currency` is pre-filled with the invoice's own (EUR) by the defaults resolver — it is not
		// touched here, exactly the expected behavior for an ordinary payment.
		dialog().find('[data-cy="document-field-amount-input"]').clear({ force: true }).type("60", { force: true });

		// `method`: a real SearchSelect, a real click on a real option.
		dialog().find('[data-cy="document-field-method-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-method-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-method-input-option-bank-transfer"]').click();

		cy.get('[data-cy="document-action-params-confirm"]').click();
		cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");

		cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should(
			"contain.text",
			"Partially paid",
		);
		cy.get('[data-cy="document-settlement-paid"]').should("contain.text", "60.00 EUR");
		cy.get('[data-cy="document-settlement-outstanding"]').should("contain.text", "60.00 EUR");

		// The exact balance, computed by hand here (60 € paid out of 120 € due), not copied from the backend code.
		cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
			.its("body")
			.then((body) => {
				expect(body.settlement).to.deep.equal({
					totalGrossMinor: GROSS_MINOR,
					paidMinor: 6000,
					creditedMinor: 0,
					outstandingMinor: 6000,
					excessMinor: 0,
					settled: false,
				});
				expect(body.payments).to.have.length(1);
				expect(body.payments[0]).to.include({ amountMinor: 6000, currency: "EUR", method: "bank_transfer" });
			});
	});

	it('completing the payment makes the "Settled" badge appear and outstandingMinor: 0', () => {
		expect(invoiceId, "la facture des tests précédents existe toujours").to.be.a("string");

		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
		// The exact remainder — not a cent more, to prove an EXACT settlement, not an
		// overpayment (covered separately by computeSettlement's own jest tests).
		cy.get('[data-cy="document-action-params-dialog"]')
			.find('[data-cy="document-field-amount-input"]')
			.clear({ force: true })
			.type("60", { force: true });
		cy.get('[data-cy="document-action-params-confirm"]').click();
		cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");

		// Renamed from "Paid" — see document-settlement.tsx's own header: nothing "Paid" would be true
		// of a document settled by CREDIT instead, so the terminal badge state is named "Settled" now,
		// regardless of how the balance actually got to zero.
		cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should("contain.text", "Settled");
		cy.get('[data-cy="document-settlement-outstanding"]').should("contain.text", "0.00 EUR");

		cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
			.its("body.settlement")
			.then((settlement) => {
				expect(settlement.paidMinor).to.eq(GROSS_MINOR);
				expect(settlement.outstandingMinor).to.eq(0);
				expect(settlement.settled).to.eq(true);
			});

		// The invoice stays "sent" — the balance is a PROJECTION, never a status (see invoice.descriptor.ts).
		cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
			.its("body.status")
			.should("eq", "sent");
	});

	it("a payment in a different currency than the invoice's own is refused, and the error is VISIBLE on screen", () => {
		expect(invoiceId, "la facture des tests précédents existe toujours").to.be.a("string");

		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");

		// Scoped to the dialog — see the previous test's own comment: the invoice ALSO has its own
		// "currency" field, which coexists in the DOM with the action's own while the dialog
		// is open.
		const dialog = () => cy.get('[data-cy="document-action-params-dialog"]');

		dialog().find('[data-cy="document-field-amount-input"]').clear({ force: true }).type("10", { force: true });

		// A currency DIFFERENT from the invoice's own (EUR) is chosen — a real click on a real
		// option, exactly what a user could do by mistake.
		dialog().find('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-usd"]').first().click();

		cy.get('[data-cy="document-action-params-confirm"]').click();

		// Visible on screen: the backend's own error message, as-is (toast, sonner). `contain.text`
		// rather than `cy.contains(selector, regex)` — the latter fails here for no apparent reason
		// (the text is genuinely there, confirmed by a manual screenshot); `get` + `contain.text`
		// is the pattern already proven elsewhere in this suite for text inside a given container.
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should(
			"contain.text",
			"does not match this invoice's own currency",
		);

		// Refused before writing anything at all: the balance hasn't moved — still settled at 120 €,
		// never a phantom payment in USD.
		cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
			.its("body")
			.then((body) => {
				expect(body.settlement.paidMinor, "aucun effet du paiement refusé").to.eq(GROSS_MINOR);
				expect(body.payments, "toujours exactement les deux paiements EUR d'avant").to.have.length(2);
			});
	});

	it("the \"record-payment\" action is not offered on a draft, and the API refuses it too (409)", () => {
		createDraftInvoice().then((id) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-edit-button-${id}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

			// ON SCREEN: no button at all for a "draft" invoice.
			cy.get('[data-cy="document-action-record-payment"]').should("not.exist");
			cy.get('[data-cy="document-settlement-section"]').should("not.exist");

			// ON THE API: a scripted client that would ignore the screen is refused the same way — 409.
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/record-payment`,
				body: {
					documentId: id,
					data: {},
					params: { amount: 10, currency: "EUR", paidAt: "2026-08-30" },
				},
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, `refusée — ${JSON.stringify(res.body).slice(0, 200)}`).to.eq(409);
			});
		});
	});

	// "rates exist, but payments and credit notes still don't
	// convert" is closed: a payment in a different currency is no longer refused
	// outright (see the previous test, which stays true in the ABSENCE of a configured rate) — once a
	// DATED rate is entered for the pair, it CONVERTS, instead of refusing.
	describe("a payment in ANOTHER currency, with a dated rate configured — it CONVERTS instead of refusing", () => {
		it("a 50 USD payment on a 120.00 € invoice converts at the dated rate — exact outstanding balance, verified by the API", () => {
			// The rate — entered via the API (only the PAYMENT itself has to go through the screen
			// here; e2e spec 27 already covers entering a rate THROUGH THE SCREEN). Dated BEFORE the
			// payment further down, so resolveLatestRate finds it exactly.
			cy.request({
				method: "POST",
				url: `${api}/api/company/currency-rates`,
				body: { from: "USD", to: "EUR", rate: 0.8, asOf: "2026-08-01T00:00:00.000Z" },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "taux USD→EUR enregistré").to.be.oneOf([200, 201]);
			});

			createDraftInvoice().then((id) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-edit-button-${id}"]`, { timeout: 15000 }).click();
				cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");
				cy.get('[data-cy="document-action-send"]', { timeout: 15000 }).click();
				cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).should("exist");

				cy.get('[data-cy="document-action-record-payment"]').click();
				cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
				const dialog = () => cy.get('[data-cy="document-action-params-dialog"]');

				// 50.00 USD, a REAL click on a REAL currency option — exactly the gesture the
				// refusal test (above) proves refused WITHOUT a configured rate; HERE a rate exists.
				dialog()
					.find('[data-cy="document-field-amount-input"]')
					.clear({ force: true })
					.type("50", { force: true });
				dialog().find('[data-cy="document-field-currency-input"] button').first().click({ force: true });
				cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
				cy.get('[data-cy^="document-field-currency-input-option-usd"]').first().click();

				cy.get('[data-cy="document-action-params-confirm"]').click();
				cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");

				// 50 USD @ 0.8 = 40.00 € — outstanding balance: 120.00 € - 40.00 € = 80.00 €. Displayed...
				cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should(
					"contain.text",
					"Partially paid",
				);
				cy.get('[data-cy="document-settlement-outstanding"]').should("contain.text", "80.00 EUR");

				// ...and exact via the API — the EXACT amount, never a range (toBeCloseTo).
				cy.request({ url: `${api}/api/documents/${id}/settlement?typeId=invoice` })
					.its("body")
					.then((body) => {
						expect(body.settlement).to.deep.equal({
							totalGrossMinor: GROSS_MINOR,
							paidMinor: 4000, // 40.00 € — the CONVERTED amount, never 5000 (50 USD unconverted).
							creditedMinor: 0,
							outstandingMinor: GROSS_MINOR - 4000,
							excessMinor: 0,
							settled: false,
						});
						expect(body.payments).to.have.length(1);
						// The audit trail keeps the REAL payment (50 USD); the converted field carries the EUR.
						expect(body.payments[0]).to.include({
							amountMinor: 5000,
							currency: "USD",
							documentAmountMinor: 4000,
							conversionRate: 0.8,
						});
					});
			});
		});
	});
});
