/**
 * Export comptable générique CSV (TODO_FEATURES.md rang 4) — un export sur une période produit un CSV
 * dont chaque ligne est une facture / un avoir / un paiement réel, montants cohérents avec le pipeline
 * settlement. L'échappement RFC-4180 et la cohérence des montants sont couverts/mordus en jest
 * (`accounting-export/*.spec.ts`, dont les lignes d'avoir) ; ici on prouve le vrai endpoint
 * bout-en-bout : une facture envoyée + un paiement, dans la période → deux lignes au bon montant.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Export comptable CSV — facture + paiement sur une période", () => {
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

	it("une facture envoyée + un paiement dans la période apparaissent comme deux lignes du CSV", () => {
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

					// Un paiement complet (1200,00 €) daté dans la période.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/record-payment`,
						body: {
							documentId: invoiceId,
							data,
							params: { amount: 1200, currency: "EUR", paidAt: "2026-08-20", method: "bank_transfer" },
						},
					}).then((pay) => expect(pay.status, "paiement enregistré").to.be.oneOf([200, 201]));

					// L'export sur août 2026.
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
						// Facture : brut 1200,00 ; paiement : 1200,00 encaissé.
						expect(invoiceRows[0], "brut de la facture").to.include("1200.00");
						expect(paymentRows[0], "montant encaissé").to.include("1200.00");
					});

					// Hors période : aucune facture/paiement d'août ne doit apparaître.
					cy.request({ url: `${api}/api/accounting-export?from=2026-01-01&to=2026-01-31` }).then((res) => {
						const lines = (res.body as string).split("\n").filter((l) => l.length > 0);
						expect(lines.filter((l) => l.startsWith("invoice,")), "rien en janvier").to.have.length(0);
						expect(lines.filter((l) => l.startsWith("payment,")), "rien en janvier").to.have.length(0);
					});

					// Bornes manquantes → 400.
					cy.request({ url: `${api}/api/accounting-export`, failOnStatusCode: false }).then((res) => {
						expect(res.status, "bornes obligatoires").to.eq(400);
					});
				});
			});
	});
});
