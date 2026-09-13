export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Multi-milestone installment billing (TODO_FEATURES.md rank 12) — from a SENT quote, the
 * `request-installments` action generates N draft invoices (one per due date, each at its own date),
 * whose gross-total SUM equals EXACTLY the quote's own gross total. The split (exact net-sum +
 * gross-sum, the last milestone absorbs the rounding; refusal on mixed VAT rates) is covered/bitten
 * in jest (`actions/request-installments.spec.ts`); here we prove the real journey through the API:
 * 3 milestones 30/40/30 → 3 invoices, sum of gross totals == the quote's own gross total, each at
 * its own date.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
// Quote: 1000 net @ 20% → gross 120000 minor. 30/40/30 → gross amounts 36000/48000/36000 = 120000.
const QUOTE_GROSS_MINOR = 120000;
const D1 = "2026-10-15";
const D2 = "2026-11-15";
const D3 = "2026-12-15";

describe("Installment billing — N invoices whose sum equals the quote's own gross total", () => {
	let clientEmail: string;

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

	it("a quote with 3 milestones 30/40/30 generates 3 draft invoices, sum of gross totals = the quote's own gross total", () => {
		clientEmail = "installments-client@example.com";
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Installments Client SARL",
				contactEmail: clientEmail,
				currency: "EUR",
				country: "FR",
				address: "1 Rue de l'Échéance",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		})
			.its("body.id")
			.then((clientId: string) => {
				const quoteData = {
					client: clientId,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [{ description: "Prestation", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
				};
				// Quote → draft → send (the installment-schedule action requires 'sent').
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: { data: quoteData },
				}).then((saved) => {
					const quoteId = saved.body?.document?.id as string;
					expect(quoteId, "devis créé").to.be.a("string");

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/send`,
						body: { documentId: quoteId, data: quoteData, params: { recipient: clientEmail } },
					}).then((sent) => expect(sent.status).to.be.oneOf([200, 201]));
					cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"]);

					// The installment schedule: 30/40/30, three dates.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/request-installments`,
						body: {
							documentId: quoteId,
							data: quoteData,
							params: {
								milestones: [
									{ percent: 30, dueDate: D1 },
									{ percent: 40, dueDate: D2 },
									{ percent: 30, dueDate: D3 },
								],
							},
						},
					}).then((res) => expect(res.status, "échéancier généré").to.be.oneOf([200, 201]));

					// The 3 invoices generated from THIS quote (via data.origin.id).
					cy.request({ url: `${api}/api/documents?typeId=invoice` })
						.its("body")
						.then((body) => {
							const invoices = (Array.isArray(body) ? body : (body.documents ?? [])) as {
								id: string;
								data: { origin?: { id?: string }; dueDate?: string };
							}[];
							const mine = invoices.filter((d) => d.data?.origin?.id === quoteId);
							expect(mine, "3 factures d'échéance créées").to.have.length(3);

							// The expected due dates are indeed carried over.
							const dues = mine.map((d) => d.data?.dueDate).sort();
							expect(dues).to.deep.eq([D1, D2, D3]);

							// Sum of gross totals == the quote's own gross total, down to the cent.
							const ids = mine.map((d) => d.id);
							const grosses: number[] = [];
							cy.wrap(ids).each((id) => {
								cy.request({ url: `${api}/api/documents/${id}/totals?typeId=invoice` })
									.its("body.grossMinor")
									.then((g: number) => grosses.push(g));
							});
							cy.then(() => {
								const sum = grosses.reduce((a, b) => a + b, 0);
								expect(sum, "somme des bruts = TTC du devis").to.eq(QUOTE_GROSS_MINOR);
							});
						});
				});
			});
	});
});
