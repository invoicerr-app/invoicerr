/**
 * Generic CSV accounting export (TODO_FEATURES.md rank 4) — an export over a period produces a CSV
 * where each row is a real invoice / credit note / payment, amounts consistent with the settlement
 * pipeline. RFC-4180 escaping and amount consistency are covered/bitten in jest
 * (`accounting-export/*.spec.ts`, including credit-note rows); here we prove the real endpoint
 * end-to-end: a sent invoice + a payment, within the period → two rows at the right amount.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("CSV accounting export — invoice + payment within a period", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
		}).then((res) => expect(res.status).to.be.oneOf([200, 201]));
	});
	beforeEach(() => {
		cy.login();
	});

	it("a sent invoice + a payment within the period appear as two rows of the CSV", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Export Client SARL",
				contactEmail: "export-client@example.com",
				currency: "EUR",
				country: "FR",
				address: "1 Rue de l'Export",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		})
			.its("body.id")
			.then((clientId: string) => {
				const data = {
					client: clientId,
					issueDate: "2026-08-15",
					dueDate: "2026-09-15",
					currency: "EUR",
					lines: [{ description: "Prestation", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
				};
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					const invoiceId = saved.body?.document?.id as string;
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: invoiceId, data },
					}).then((sent) => expect(sent.status).to.be.oneOf([200, 201]));
					cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

					// A payment in full (1200.00 €) dated within the period.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/record-payment`,
						body: {
							documentId: invoiceId,
							data,
							params: { amount: 1200, currency: "EUR", paidAt: "2026-08-20", method: "bank_transfer" },
						},
					}).then((pay) => expect(pay.status, "paiement enregistré").to.be.oneOf([200, 201]));

					// The export for August 2026.
					cy.request({ url: `${api}/api/accounting-export?from=2026-08-01&to=2026-08-31` }).then((res) => {
						expect(res.status).to.eq(200);
						expect(res.headers["content-type"]).to.include("text/csv");
						const lines = (res.body as string).split("\n").filter((l) => l.length > 0);
						const header = lines[0];
						expect(header, "en-tête").to.include("type").and.to.include("gross").and.to.include("paid");

						const invoiceRows = lines.filter((l) => l.startsWith("invoice,"));
						const paymentRows = lines.filter((l) => l.startsWith("payment,"));
						expect(invoiceRows, "une ligne facture").to.have.length(1);
						expect(paymentRows, "une ligne paiement").to.have.length(1);
						// Invoice: gross 1200.00; payment: 1200.00 collected.
						expect(invoiceRows[0], "brut de la facture").to.include("1200.00");
						expect(paymentRows[0], "montant encaissé").to.include("1200.00");
					});

					// Outside the period: no August invoice/payment should appear.
					cy.request({ url: `${api}/api/accounting-export?from=2026-01-01&to=2026-01-31` }).then((res) => {
						const lines = (res.body as string).split("\n").filter((l) => l.length > 0);
						expect(lines.filter((l) => l.startsWith("invoice,")), "rien en janvier").to.have.length(0);
						expect(lines.filter((l) => l.startsWith("payment,")), "rien en janvier").to.have.length(0);
					});

					// Missing bounds → 400.
					cy.request({ url: `${api}/api/accounting-export`, failOnStatusCode: false }).then((res) => {
						expect(res.status, "bornes obligatoires").to.eq(400);
					});
				});
			});
	});
});
