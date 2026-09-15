export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Bank reconciliation by statement import — "jugée la plus importante par
 * les utilisateurs dans les comparatifs". Proven through the screen for the ACTIONS (a real file
 * upload, a real column-mapping form, a real click to confirm the match), the API for the ASSERTIONS
 * — same discipline as the rest of this suite (17/24/52).
 *
 * One sent invoice (1200.00 € gross), one CSV line whose amount matches exactly and whose label
 * carries the invoice's own `displayNumber` (the "reference" match signal — see the backend's own
 * `bank-reconciliation/matching.ts` header): the import offers it as a suggestion, confirming it
 * creates a REAL `DocumentPayment` through the exact same "record-payment" action a hand-entered
 * payment uses (verified via `GET .../settlement`, never re-derived from the screen). A second
 * reconciliation attempt on the SAME line, replayed directly against the API, is refused (409) — the
 * concrete proof "the same line cannot be reconciled twice".
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// 1000.00 € net, 20% VAT -> 1200.00 € gross (120000 minor units).
const GROSS_MINOR = 120000;

interface InvoiceInstance {
	id: string;
	status: string;
	displayNumber?: string | null;
}

function csvContents(displayNumber: string): string {
	// French-style export: `;` delimiter, DD/MM/YYYY date, comma decimal — exactly the mapping
	// dialog's own defaults, so the test never has to touch the dateFormat/decimalSeparator selects.
	return ["Date;Montant;Libelle", `20/08/2026;1200,00;VIR ${displayNumber}`].join("\n");
}

describe("Bank reconciliation — import a statement through the screen, confirm a match, refuse a second reconciliation", () => {
	let invoiceId: string;
	let displayNumber: string;

	before(() => {
		cy.resetAndSeed();

		// "send" needs a transport configured — same setup 24/52 already do for their own suites.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
		}).then((res) => expect(res.status, "transport configured").to.be.oneOf([200, 201]));

		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "the seeded world carries a client").to.have.length.greaterThan(0);

				const data = {
					client: clients[0].id,
					issueDate: "2026-08-15",
					dueDate: "2026-09-15",
					currency: "EUR",
					lines: [
						{ description: "Prestation", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" },
					],
				};

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					invoiceId = saved.body.document.id as string;

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: invoiceId, data },
					}).then((sent) => expect(sent.status, "invoice sent").to.be.oneOf([200, 201]));

					cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

					cy.request<InvoiceInstance>({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` }).then(
						(res) => {
							expect(res.body.displayNumber, "the sent invoice was numbered").to.be.a("string");
							displayNumber = res.body.displayNumber as string;
						},
					);
				});
			});
	});

	beforeEach(() => {
		cy.login();
		cy.visit("/bank-reconciliation");
	});

	it("importing a CSV suggests the match by reference, confirming it creates a real payment, and a replayed reconciliation is refused", () => {
		cy.get('[data-cy="bank-reconciliation-import-button"]').click();
		cy.get('[data-cy="bank-reconciliation-import-dialog"]', { timeout: 10000 }).should("be.visible");

		cy.get('[data-cy="bank-reconciliation-import-file-input"]').selectFile(
			{
				contents: Cypress.Buffer.from(csvContents(displayNumber)),
				fileName: "releve.csv",
				mimeType: "text/csv",
			},
			{ force: true },
		);

		// The mapping form appeared (a CSV file, never OFX) — populated from the file's OWN header row.
		cy.get('[data-cy="bank-reconciliation-import-mapping"]', { timeout: 10000 }).should("exist");

		// Currency — explicit, through the real searchable picker.
		cy.get('[data-cy="bank-reconciliation-import-currency"] button').first().click();
		cy.get('[data-cy="bank-reconciliation-import-currency-options"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="bank-reconciliation-import-currency"] input').type("EUR");
		cy.get('[data-cy="bank-reconciliation-import-currency-options"] button').first().click();

		// The column mapping — picked from the file's own headers, never typed freehand.
		cy.get('[data-cy="bank-reconciliation-import-mapping-date"]').click();
		cy.wait(200);
		cy.get('[role="option"]').contains("Date").click();

		cy.get('[data-cy="bank-reconciliation-import-mapping-amount"]').click();
		cy.wait(200);
		cy.get('[role="option"]').contains("Montant").click();

		cy.get('[data-cy="bank-reconciliation-import-mapping-label"]').click();
		cy.wait(200);
		cy.get('[role="option"]').contains("Libelle").click();

		// dateFormat (DD/MM/YYYY) and decimalSeparator (,) are already the dialog's own defaults,
		// which happen to match this fixture — left untouched on purpose.

		cy.get('[data-cy="bank-reconciliation-import-submit"]').click();
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");
		cy.get('[data-cy="bank-reconciliation-import-dialog"]').should("not.exist");

		// The freshly imported statement is auto-selected — its one line is already visible.
		cy.get('[data-cy="bank-reconciliation-lines-table"]', { timeout: 10000 }).should("exist");

		// The suggestion names the invoice's own displayNumber — the "reference" signal, never a
		// bare amount coincidence (see matching.ts's own header: amount alone is never enough).
		cy.get('[data-cy^="bank-reconciliation-line-suggestion-"]', { timeout: 10000 })
			.should("contain.text", displayNumber)
			.click();

		cy.get('[data-cy="bank-reconciliation-line-status-reconciled"]', { timeout: 10000 })
			.should("exist")
			.and("contain.text", displayNumber);

		// ASSERTION VIA THE API — never the screen: the reconciled line produced a REAL payment
		// through the exact same "record-payment" action a hand-entered one uses (the invoice is now
		// fully settled, and the settlement figures are EXACTLY the gross total, not merely truthy).
		cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
			.its("body")
			.then((body) => {
				expect(body.totals.grossMinor, "gross: 1000 € + 20% VAT").to.eq(GROSS_MINOR);
				expect(body.settlement).to.deep.equal({
					totalGrossMinor: GROSS_MINOR,
					paidMinor: GROSS_MINOR,
					creditedMinor: 0,
					outstandingMinor: 0,
					excessMinor: 0,
					settled: true,
				});
			});

		// THE DOUBLE-RECONCILIATION ATTEMPT — replayed directly against the API (the screen itself no
		// longer offers a control for an already-reconciled line, which is the screen's OWN half of
		// this guarantee; this is the backend's, authoritative half).
		cy.request({ url: `${api}/api/bank-reconciliation/statements` })
			.its("body")
			.then((statements: { id: string }[]) => {
				expect(statements, "the imported statement is listed").to.have.length.greaterThan(0);
				const statementId = statements[0].id;

				cy.request({ url: `${api}/api/bank-reconciliation/statements/${statementId}/lines` })
					.its("body")
					.then((view: { lines: { line: { id: string; status: string } }[] }) => {
						const reconciledLine = view.lines.find((entry) => entry.line.status === "RECONCILED");
						expect(reconciledLine, "the reconciled line is findable via the API").to.exist;

						cy.request({
							method: "POST",
							url: `${api}/api/bank-reconciliation/lines/${reconciledLine!.line.id}/reconcile`,
							body: { documentId: invoiceId },
							failOnStatusCode: false,
						}).then((res) => {
							expect(res.status, "a line already reconciled refuses a second reconciliation").to.eq(
								409,
							);
						});

						// The balance did NOT move a second time — a refused replay must have zero effect.
						cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
							.its("body.settlement.paidMinor")
							.should("eq", GROSS_MINOR);
					});
			});
	});
});
