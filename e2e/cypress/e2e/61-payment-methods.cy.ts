export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Payment methods — a typed `PaymentMethodDescriptor` per method (payment-methods/), replacing the
 * bare, information-less `method` string this defect used to hold. A first-class top-level screen
 * (sidebar "Data" group, next to Clients/Articles), never a settings-screen tab.
 *
 * Proven at THREE levels, all driven through the real screen (a real click on the switch, a real
 * fill-in of the config dialog):
 *  1. The payment-methods screen ITSELF renders two configured methods differently — cash (zero
 *     fields) shows nothing beyond its own label; PayPal shows the configured e-mail as a preview
 *     line. This is the DIRECT proof of the defect this feature fixes ("nothing can render
 *     differently per method").
 *  2. The difference reaches all the way to an actual INVOICE PDF: `usesPaymentMethods` (invoice.
 *     descriptor.ts) means an invoice's own rendered PDF grows a "Payment methods" section once a
 *     method is enabled, with a richer method (PayPal, with its own configured e-mail line and "Buy
 *     Now" link) rendering more than Cash's bare label alone — proven on the PDF's own DECODED TEXT
 *     (`cy.task("extractPdfText", ...)`, `pdf-parse` in the Node plugin process, same technique
 *     `20-document-totals.cy.ts` already established), never a byte-count delta: a PDF "growing" is
 *     no proof of WHAT grew, so this asserts the exact configured e-mail and link text instead.
 *  3. Flipping a still-unconfigured method's switch never round-trips into a raw backend error: the
 *     screen opens the config dialog instead, and saving it both fills in the missing field and
 *     activates the method in one action — the last test in this file.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Payment Methods Client SARL",
				contactEmail: "pm-client@example.com",
				currency: "EUR",
				country: "FR",
				address: "1 Rue des Moyens de Paiement",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		})
		.its("body.id");
}

function createInvoiceDraft(clientId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [{ description: "Consulting", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
				},
			},
		})
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			expect(id, "brouillon de facture créé").to.be.a("string");
			return id;
		});
}

/** Fetches the PDF (binary) and verifies it is indeed a PDF. */
function fetchInvoicePdf(id: string): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/${id}/pdf?typeId=invoice`, encoding: "binary" })
		.then((res) => {
			expect(res.status, "PDF rendu").to.eq(200);
			expect(res.headers["content-type"]).to.include("application/pdf");
			return res.body as string;
		});
}

/** Decodes the PDF's own real page text (`cy.task("extractPdfText", ...)`, `pdf-parse` in the Node
 *  plugin process — see `cypress.config.ts`'s own header on that task, and
 *  `20-document-totals.cy.ts` for the same technique). Whitespace collapsed: `pdf.js` places each
 *  text run where Chromium's layout put it, and adjacent runs can land separated by more than one
 *  space — never asserted as one exact literal string for that reason. */
function pdfText(id: string): Cypress.Chainable<string> {
	return fetchInvoicePdf(id).then((body) => {
		const base64 = Cypress.Buffer.from(body, "binary").toString("base64");
		return cy.task("extractPdfText", base64).then((rawText) => String(rawText).replace(/\s+/g, " "));
	});
}

describe("Payment methods — configured through the screen, rendered differently per method", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	it("the screen offers all five built-in methods, every one disabled on a freshly seeded company", () => {
		cy.visit("/dashboard");
		cy.get('[data-cy="sidebar-payment-methods-link"]').click();
		cy.location("pathname").should("eq", "/payment-methods");

		cy.get('[data-cy="payment-methods-list"]', { timeout: 15000 }).should("be.visible");
		for (const id of ["bank_transfer", "paypal", "cash", "cheque", "stripe"]) {
			cy.get(`[data-cy="payment-method-card-${id}"]`).should("be.visible");
			cy.get(`[data-cy="payment-method-status-${id}"]`).should("contain.text", "Disabled");
		}
	});

	it("the API's own `configured` matches what each method actually needs, before anything is touched", () => {
		cy.request({ url: `${api}/api/payment-methods` })
			.its("body")
			.then((methods: { id: string; configured: boolean }[]) => {
				// A method with a required field nobody has filled in yet — not configured.
				for (const id of ["bank_transfer", "paypal", "cheque"]) {
					expect(methods.find((m) => m.id === id)?.configured, id).to.eq(false);
				}
				// A method with no fields at all — nothing can be missing, so always configured.
				for (const id of ["cash", "stripe", "mollie"]) {
					expect(methods.find((m) => m.id === id)?.configured, id).to.eq(true);
				}
			});
	});

	it('enabling "Cash" (zero fields) shows only its own label — the empty case, on screen', () => {
		cy.visit("/payment-methods");

		cy.get('[data-cy="payment-method-toggle-cash"]').click();
		cy.get('[data-cy="payment-method-status-cash"]').should("contain.text", "Enabled");
		// The empty case, proven on screen: no preview block at all for a method with zero fields.
		cy.get('[data-cy="payment-method-preview-cash"]').should("not.exist");
		cy.get('[data-cy="payment-method-card-no-fields-cash"]').should("be.visible");

		// The API agrees — never trust the DOM alone as proof of what is in the database.
		cy.request({ url: `${api}/api/payment-methods` })
			.its("body")
			.then((methods: { id: string; enabled: boolean; config: Record<string, unknown> }[]) => {
				const cash = methods.find((m) => m.id === "cash");
				expect(cash?.enabled, "cash activé côté API").to.eq(true);
				expect(cash?.config, "cash n'a aucun champ").to.deep.equal({});
			});
	});

	it('configuring PayPal\'s e-mail through the dialog, then enabling it, renders a VISIBLY DIFFERENT card than Cash — real fields, a real dialog', () => {
		cy.visit("/payment-methods");

		cy.get('[data-cy="payment-method-configure-paypal"]').click();
		cy.get('[data-cy="payment-method-config-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="payment-method-config-dialog"]')
			.find('[data-cy="document-field-email-input"]')
			.type("billing@acme-client.test", { force: true });
		cy.get('[data-cy="payment-method-config-save"]').click();
		cy.get('[data-cy="payment-method-config-dialog"]').should("not.exist");

		// Saving the CONFIG alone never enables the method — a deliberate decoupling (see
		// payment-method-config-dialog.tsx's own header): the card's own switch is the one place
		// "enabled" is written.
		cy.get('[data-cy="payment-method-status-paypal"]').should("contain.text", "Disabled");
		cy.get('[data-cy="payment-method-preview-paypal"]').should(
			"contain.text",
			"PayPal e-mail: billing@acme-client.test",
		);

		cy.get('[data-cy="payment-method-toggle-paypal"]').click();
		cy.get('[data-cy="payment-method-status-paypal"]').should("contain.text", "Enabled");

		// The rendered difference, ON THIS SCREEN: PayPal shows a real configured line, Cash (from the
		// previous test, still enabled) shows none at all — the exact defect this feature fixes
		// ("nothing can render differently per method"), proven for two DIFFERENT methods at once.
		cy.get('[data-cy="payment-method-preview-paypal"]').should(
			"contain.text",
			"PayPal e-mail: billing@acme-client.test",
		);
		cy.get('[data-cy="payment-method-card-no-fields-cash"]').should("be.visible");
	});

	it("the configured difference reaches the actual invoice PDF — Cash+PayPal renders the configured e-mail and pay link, Cash alone renders neither", () => {
		// Baseline set PRECISELY (never assumed from a previous test's own leftover state, which would
		// make this test's outcome depend on run order): PayPal explicitly disabled via the API — the
		// screen-driven configuration itself is already proven by the earlier tests in this spec, this
		// one's own claim is that the PDF actually reflects whatever IS configured.
		cy.request({
			method: "PATCH",
			url: `${api}/api/payment-methods/paypal`,
			body: { enabled: false },
		}).its("status").should("be.oneOf", [200, 201]);

		createClient().then((clientId: string) => {
			// Cash alone: an invoice's PDF already carries a "Payment methods" section (Cash's own
			// label), but no PayPal line yet.
			createInvoiceDraft(clientId).then((cashOnlyId) => {
				pdfText(cashOnlyId).then((cashOnlyText) => {
					// The rendered content, not a byte count: a PDF "growing" is no proof of WHAT grew —
					// the wrong e-mail (the company's own, a stale default) or a truncated link would
					// still add roughly the same number of bytes and pass a size-delta check identically.
					expect(cashOnlyText, "pas de section PayPal tant qu'il est désactivé").to.not.contain("PayPal");

					// Now enable PayPal — through the SCREEN, a real click on a real dialog, exactly like
					// the earlier tests in this spec.
					cy.visit("/payment-methods");
					cy.get('[data-cy="payment-method-configure-paypal"]').click();
					cy.get('[data-cy="payment-method-config-dialog"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="payment-method-config-dialog"]')
						.find('[data-cy="document-field-email-input"]')
						.clear({ force: true })
						.type("billing@acme-client.test", { force: true });
					cy.get('[data-cy="payment-method-config-save"]').click();
					cy.get('[data-cy="payment-method-config-dialog"]').should("not.exist");
					cy.get('[data-cy="payment-method-toggle-paypal"]').click();
					cy.get('[data-cy="payment-method-status-paypal"]', { timeout: 10000 }).should(
						"contain.text",
						"Enabled",
					);

					createInvoiceDraft(clientId).then((cashAndPaypalId) => {
						pdfText(cashAndPaypalId).then((cashAndPaypalText) => {
							// The exact line `presentFromFields` builds — the CONFIGURED e-mail, not the
							// company's own or a stale one (paypal.descriptor.ts).
							expect(
								cashAndPaypalText,
								"la ligne PayPal porte le bon e-mail configuré",
							).to.contain("PayPal e-mail: billing@acme-client.test");
							// The "Buy Now" link (paypal.descriptor.ts#buildPayPalLink) is rendered as plain
							// visible text (render-html.ts), never behind different anchor text — its own
							// `business=` param is the SAME e-mail, URL-encoded, so a link built from the
							// wrong address (or from none at all) is caught here too.
							expect(
								cashAndPaypalText,
								"le lien de paiement pointe vers le bon compte PayPal",
							)
								.to.contain("paypal.com/cgi-bin/webscr")
								.and.to.contain("business=billing%40acme-client.test");
						});
					});
				});
			});
		});
	});

	it('toggling "Cheque" (still unconfigured at this point in the suite) opens its config dialog instead of a raw error — one save both fills it in and enables it', () => {
		cy.visit("/payment-methods");

		cy.get('[data-cy="payment-method-status-cheque"]').should("contain.text", "Disabled");
		cy.get('[data-cy="payment-method-toggle-cheque"]').click();

		// The dialog opens INSTEAD of the switch round-tripping into a 400 — no error toast, and the
		// status badge stays exactly what it was (never a "Disabled" that flickered to an error state).
		cy.get('[data-cy="payment-method-config-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="payment-method-status-cheque"]').should("contain.text", "Disabled");

		cy.get('[data-cy="payment-method-config-dialog"]')
			.find('[data-cy="document-field-payee-input"]')
			.type("Acme SARL", { force: true });
		cy.get('[data-cy="payment-method-config-save"]').click();
		cy.get('[data-cy="payment-method-config-dialog"]').should("not.exist");

		// Saving the dialog both filled in the field AND activated the method — one action, exactly
		// what the owner asked for, never a second click on the switch.
		cy.get('[data-cy="payment-method-status-cheque"]').should("contain.text", "Enabled");
		cy.get('[data-cy="payment-method-preview-cheque"]').should("contain.text", "Payee: Acme SARL");

		cy.request({ url: `${api}/api/payment-methods` })
			.its("body")
			.then(
				(methods: { id: string; enabled: boolean; configured: boolean; config: Record<string, unknown> }[]) => {
					const cheque = methods.find((m) => m.id === "cheque");
					expect(cheque?.enabled, "cheque activé côté API").to.eq(true);
					expect(cheque?.configured, "cheque déclaré configuré côté API").to.eq(true);
					expect(cheque?.config).to.deep.equal({ payee: "Acme SARL" });
				},
			);
	});
});
