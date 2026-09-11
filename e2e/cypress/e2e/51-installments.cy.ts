/**
 * Facturation échelonnée multi-jalons (TODO_FEATURES.md rang 12) — depuis un devis ENVOYÉ, l'action
 * `request-installments` génère N factures draft (une par échéance, à sa propre date), dont la SOMME
 * des totaux TTC égale EXACTEMENT le TTC du devis. Le découpage (somme nets + somme bruts exacte, le
 * dernier jalon absorbe l'arrondi ; refus multi-taux de TVA) est couvert/mordu en jest
 * (`actions/request-installments.spec.ts`) ; ici on prouve le parcours réel par l'API : 3 jalons
 * 30/40/30 → 3 factures, somme des bruts == TTC du devis, chacune à sa date.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
// Devis : 1000 net @ 20 % → brut 120000 minor. 30/40/30 → bruts 36000/48000/36000 = 120000.
const QUOTE_GROSS_MINOR = 120000;
const D1 = "2026-10-15";
const D2 = "2026-11-15";
const D3 = "2026-12-15";

describe("Facturation échelonnée — N factures dont la somme = TTC du devis", () => {
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

	it("un devis à 3 échéances 30/40/30 génère 3 factures draft, somme des bruts = TTC du devis", () => {
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
				// Devis → brouillon → envoi (l'action d'échéancier exige 'sent').
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

					// L'échéancier : 30/40/30, trois dates.
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

					// Les 3 factures issues de CE devis (via data.origin.id).
					cy.request({ url: `${api}/api/documents?typeId=invoice` })
						.its("body")
						.then((body) => {
							const invoices = (Array.isArray(body) ? body : (body.documents ?? [])) as {
								id: string;
								data: { origin?: { id?: string }; dueDate?: string };
							}[];
							const mine = invoices.filter((d) => d.data?.origin?.id === quoteId);
							expect(mine, "3 factures d'échéance créées").to.have.length(3);

							// Les dates d'échéance attendues sont bien portées.
							const dues = mine.map((d) => d.data?.dueDate).sort();
							expect(dues).to.deep.eq([D1, D2, D3]);

							// Somme des bruts == TTC du devis, à la cent près.
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
