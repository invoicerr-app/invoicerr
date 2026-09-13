/**
 * RECONCILIATION / SETTLEMENT (root TODO, item 8) — a "sent" credit note reduces what an invoice
 * owes, a "draft" one settles nothing. Same discipline as 17/21/24: the ACTIONS that matter go
 * through the interface (a REAL click on "send" for the credit note), the ASSERTIONS that matter
 * read the record via the API, never a DOM re-read as proof of what's in the database.
 *
 * The fixture (invoice + draft credit note referencing its line) is created via the API — the
 * credit note's own form doesn't offer anything more useful to prove with a click for the CREATION
 * itself (a reference field, a line-selection checkbox); it's the draft -> sent transition that is
 * the heart of the task, and THAT one goes through a real click.
 *
 * An invoice with TWO lines, €120.00 gross total (12000 minor units):
 *  - line A: €60 net + 20% VAT = €72 gross (7200 minor units) — the one the credit note corrects;
 *  - line B: €40 net + 20% VAT = €48 gross (4800 minor units) — paid in cash.
 * In order:
 *  1. invoice sent (API — its own "send" is already covered by 21/24), a payment of €48.00
 *     recorded via a REAL click (action dialog);
 *  2. a DRAFT credit note, created via the API, referencing line A — the balance does NOT move
 *     (API assertion): paidMinor stays at 4800, creditedMinor stays at 0;
 *  3. the credit note sent via a REAL click from the credit-note list → the INVOICE's balance
 *     drops (4800 paid + 7200 credited = 12000, outstandingMinor: 0, settled: true), paidMinor
 *     stays EXACTLY at what was actually paid (4800) — never inflated by the credit note;
 *  4. on screen (the invoice dialog): the THREE blocks (payments, credits, balance) are
 *     displayed, never mixed together, and the badge becomes "Settled".
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const INVOICE_GROSS_MINOR = 12000; // 60+40 € net, 20% VAT on each line.
const LINE_A_GROSS_MINOR = 7200; // what the credit note corrects.
const PAYMENT_MINOR = 4800; // what is actually paid, on line B.

describe("Settlement — a SENT credit note reduces what an invoice owes, a DRAFT one settles nothing", () => {
	before(() => {
		cy.resetAndSeed();

		// "send" on an invoice needs a configured transport (see invoice-actions.ts) — the same
		// setup as 21/24 for their own suites.
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

	let invoiceId: string;
	let lineARowId: string;
	let creditNoteId: string;

	it('a two-line invoice is sent, and a PARTIAL payment (line B) is recorded via a real click', () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{ description: "Ligne A", quantity: 1, unit: "unit", unitPrice: 60, vatRate: "20" },
								{ description: "Ligne B", quantity: 1, unit: "unit", unitPrice: 40, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					invoiceId = saved.body?.document?.id;
					expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: invoiceId, data: saved.body.document.data },
						failOnStatusCode: false,
					}).then((sent) => {
						expect(sent.status, "facture envoyée").to.be.oneOf([200, 201]);

						// Line A received a stable $rowId at the moment of this save
						// (row-selection.ts's stampRowIds) — read back here to build the credit note
						// below, never guessed.
						const lines = sent.body.document.data.lines as { $rowId: string; description: string }[];
						const lineA = lines.find((line) => line.description === "Ligne A");
						expect(lineA, "la ligne A existe et porte un $rowId").to.not.be.undefined;
						lineARowId = lineA?.$rowId as string;

						cy.visit("/documents/invoice");
						cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
						cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

						cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
						cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
						const dialog = () => cy.get('[data-cy="document-action-params-dialog"]');
						dialog()
							.find('[data-cy="document-field-amount-input"]')
							.clear({ force: true })
							.type("48", { force: true });
						cy.get('[data-cy="document-action-params-confirm"]').click();
						cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");

						cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should(
							"contain.text",
							"Partially paid",
						);

						cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
							.its("body")
							.then((body) => {
								expect(body.totals.grossMinor, "brut : 100 € net + 20 % de TVA").to.eq(
									INVOICE_GROSS_MINOR,
								);
								expect(body.settlement.paidMinor).to.eq(PAYMENT_MINOR);
								expect(body.settlement.outstandingMinor).to.eq(
									INVOICE_GROSS_MINOR - PAYMENT_MINOR,
								);
							});
					});
				});
			});
	});

	it("a DRAFT credit note, created via the API and referencing line A, changes NOTHING in the balance (API assertion)", () => {
		expect(invoiceId, "la facture du test précédent existe toujours").to.be.a("string");
		expect(lineARowId, "le $rowId de la ligne A a été relevé").to.be.a("string");

		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: {
				data: {
					invoice: invoiceId,
					issueDate: "2026-09-01",
					currency: "EUR",
					correctedLines: [lineARowId],
				},
			},
			failOnStatusCode: false,
		}).then((saved) => {
			expect(saved.status, "brouillon d'avoir créé").to.be.oneOf([200, 201]);
			creditNoteId = saved.body?.document?.id;
			expect(creditNoteId, "le brouillon d'avoir a un identifiant").to.be.a("string");
			expect(saved.body.document.status, "l'avoir est bien un brouillon").to.eq("draft");

			// The INVOICE's balance does not move as long as the credit note stays a draft — this is
			// the exact comment from the old code (settlement.ts, avant-refonte-documents): a
			// document the user hasn't finished settles nothing.
			cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
				.its("body")
				.then((body) => {
					expect(body.settlement.paidMinor).to.eq(PAYMENT_MINOR);
					expect(body.settlement.creditedMinor, "un avoir en brouillon ne crédite rien").to.eq(0);
					expect(body.settlement.outstandingMinor).to.eq(INVOICE_GROSS_MINOR - PAYMENT_MINOR);
					expect(body.settlement.settled).to.eq(false);
					expect(body.credits, "aucun avoir compté tant qu'il est en brouillon").to.have.length(0);
				});
		});
	});

	it('a REAL click on "Send" for the credit note lowers the invoice\'s balance — paidMinor NEVER inflated by the credit note', () => {
		expect(creditNoteId, "l'avoir du test précédent existe toujours").to.be.a("string");

		cy.visit("/documents/credit-note");
		cy.get(`[data-cy="document-row-action-send-${creditNoteId}"]`, { timeout: 15000 }).click();

		// Waits for the screen to reflect the mutation (the click only triggers the request —
		// the `cy.request` below is a direct Node call, able to outrace the browser's own fetch
		// if it isn't awaited first) before reading back the API, the same reasoning as 21's own
		// "the displayed status changes...".
		cy.get(`[data-cy="document-list-row-${creditNoteId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Sent");

		cy.request({ url: `${api}/api/documents/${creditNoteId}?typeId=credit-note` })
			.its("body.status")
			.should("eq", "sent");

		cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
			.its("body")
			.then((body) => {
				// The two lines stay SEPARATE — never merged — and their SUM settles the invoice.
				expect(body.settlement.paidMinor, "paidMinor n'a pas bougé — l'avoir n'est pas un paiement").to.eq(
					PAYMENT_MINOR,
				);
				expect(body.settlement.creditedMinor).to.eq(LINE_A_GROSS_MINOR);
				expect(body.settlement.paidMinor + body.settlement.creditedMinor).to.eq(INVOICE_GROSS_MINOR);
				expect(body.settlement.outstandingMinor).to.eq(0);
				expect(body.settlement.excessMinor, "réglée exactement, aucun excédent").to.eq(0);
				expect(body.settlement.settled).to.eq(true);

				expect(body.credits).to.have.length(1);
				expect(body.credits[0]).to.include({ id: creditNoteId, amountMinor: LINE_A_GROSS_MINOR });
				expect(body.payments).to.have.length(1);
				expect(body.payments[0]).to.include({ amountMinor: PAYMENT_MINOR });
			});
	});

	it('on screen: the THREE blocks (payments, credits, balance) are displayed separately, and the badge becomes "Settled"', () => {
		expect(invoiceId, "la facture des tests précédents existe toujours").to.be.a("string");

		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-settlement-section"]', { timeout: 15000 })
			.scrollIntoView()
			.should("be.visible");

		// The badge says "Settled" as soon as outstanding=0 — never "Paid" (nothing was fully
		// paid: part of it comes from a credit note) — see document-settlement.tsx.
		cy.get('[data-cy="document-settlement-badge"]').should("contain.text", "Settled");
		cy.get('[data-cy="document-settlement-outstanding"]').should("contain.text", "0.00 EUR");

		// Block 1: the payment — a single one, the €48.00 one.
		cy.get('[data-cy="document-settlement-payments-list"]').within(() => {
			cy.get('[data-cy^="document-settlement-payment-"]').should("have.length", 1);
		});
		cy.get('[data-cy="document-settlement-payments-list"]').should("contain.text", "48.00 EUR");

		// Block 2: the credit note — SEPARATE from the payments list above, never mixed in, with
		// its own identifier (the "visual link" to the credit note) and its own amount.
		cy.get('[data-cy="document-settlement-credits-list"]').within(() => {
			cy.get('[data-cy^="document-settlement-credit-"]').should("have.length", 1);
		});
		cy.get(`[data-cy="document-settlement-credit-${creditNoteId}"]`).should("contain.text", "72.00 EUR");
		cy.get(`[data-cy="document-settlement-credit-${creditNoteId}"]`).should("contain.text", creditNoteId);

		// Block 3: the balance itself — paid and credited stay two distinct lines.
		cy.get('[data-cy="document-settlement-paid"]').should("contain.text", "48.00 EUR");
		cy.get('[data-cy="document-settlement-credited"]').should("contain.text", "72.00 EUR");
	});
});

/**
 * This file's own header, above, used to say the credit note's CREATION
 * form had "nothing more useful to prove with a click" beyond a reference field and a checkbox:
 * true once, no longer true now that `currency` (credit-note.descriptor.ts) declares
 * `lockedFromReference` — THIS is the one screen behaviour that only shows up by actually creating
 * an avoir through the dialog, never through the API-only fixture the rest of this file uses.
 *
 * A separate `describe` (its own invoice, its own credit note) rather than folding into the suite
 * above — that suite's `invoiceId`/`creditNoteId` are shared, mutable `let`s threaded through an
 * ORDERED sequence of `it`s (line A/line B, partial payment, settlement); this only needs one
 * throwaway invoice, created fresh, with no bearing on that sequence.
 */
describe("A credit note created ON SCREEN follows the currency of the invoice it corrects", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("the currency field pre-fills and locks onto the chosen invoice's own currency, never a second independent choice", () => {
		// A USD invoice — deliberately DIFFERENT from the seeded company's own EUR default, so
		// "the currency follows the invoice" is unambiguous (never a coincidence with some other
		// default this test didn't control for).
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string; label: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);
				const client = clients[0];

				const data = {
					client: client.id,
					issueDate: "2026-03-01",
					dueDate: "2026-03-31",
					currency: "USD",
					lines: [
						{ description: "Consulting", quantity: 1, unit: "day", unitPrice: 500, vatRate: "0" },
					],
				};

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId).to.be.a("string");

					// THE SCREEN, from a blank "New credit note" — the exact flow a user follows.
					cy.visit("/documents/credit-note");
					cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
					cy.get('[data-cy="document-create-dialog"]', { timeout: 5000 }).should("be.visible");

					// BEFORE picking an invoice: the currency select is a normal, EDITABLE, empty
					// select — the lock only engages once there is something concrete to follow.
					cy.get('[data-cy="document-field-currency-input"] button')
						.should("not.be.disabled")
						.and("contain.text", "Currency");

					cy.get('[data-cy="document-field-invoice-input"] button').first().click({ force: true });
					cy.get('[data-cy="document-field-invoice-input-options"]', { timeout: 10000 }).should(
						"be.visible",
					);
					cy.get('[data-cy="document-field-invoice-input"] input').type(client.label || client.id);
					cy.get('[data-cy="document-field-invoice-input-options"] button', { timeout: 10000 })
						.first()
						.click();

					// THE PROOF: the currency field now reads "USD" — the invoice's own currency, never
					// left blank or at some unrelated default — and is DISABLED, so the user cannot
					// even attempt to type a mismatch.
					cy.get('[data-cy="document-field-currency-input"] button', { timeout: 10000 })
						.should("be.disabled")
						.and("contain.text", "USD");

					// Fill in what the descriptor still requires — issueDate (a real calendar click,
					// "today") and one corrected line (the invoice's own single line, ROW_ID_KEY-
					// stamped by save-draft above) — so the record actually persists.
					cy.get('[data-cy="document-field-issueDate-input"]').click();
					const today = new Date().toLocaleDateString();
					cy.get(`[data-day="${today}"]`).click();

					cy.get('[data-cy^="document-field-correctedLines-row-"][data-cy$="-checkbox"]', {
						timeout: 10000,
					})
						.first()
						.check({ force: true });

					cy.intercept("POST", `${api}/api/documents/types/credit-note/actions/save-draft`).as(
						"saveCreditNoteDraft",
					);
					cy.get('[data-cy="document-action-save-draft"]').scrollIntoView().click();
					cy.wait("@saveCreditNoteDraft").then((interception) => {
						expect(interception.response?.statusCode, "l'avoir se crée sans le blocage de devise").to.be
							.oneOf([200, 201]);
						const creditNoteId = interception.response?.body?.document?.id as string;
						expect(creditNoteId).to.be.a("string");

						// The proof that matters: PERSISTED in USD, never silently overwritten by
						// another choice — the same "never the screen alone as proof" discipline this
						// file's own header documents for the rest of the suite.
						cy.request({ url: `${api}/api/documents/${creditNoteId}?typeId=credit-note` })
							.its("body")
							.then((doc) => {
								expect(doc.data?.currency, "l'avoir est bien en USD, comme sa facture").to.eq(
									"USD",
								);
							});
					});
				});
			});
	});
});
