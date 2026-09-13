/**
 * Client account statement (TODO_FEATURES.md rank 6, ⚡) — an aggregated view per client: open
 * invoices, balance, and aged balance (current / 0-30 / 31-60 / 60+). The aggregation (buckets,
 * company isolation) is covered in jest (`settlement/client-statement.spec.ts`); here the real
 * journey is proven: two "sent" invoices with different due dates → the endpoint sorts them into
 * the right buckets, and the statement opens and displays them on screen. Dates are computed
 * relative to now so the aged classification stays stable whatever the day of execution.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const CLIENT_EMAIL = "statement-client@example.com";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const DUE_31_60 = daysAgo(40); // 40 days overdue → bucket 31-60
const DUE_60_PLUS = daysAgo(72); // 72 days overdue → bucket 60+

function createClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Statement Client SARL",
				contactEmail: CLIENT_EMAIL,
				currency: "EUR",
				country: "FR",
				address: "1 Rue du Relevé",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		})
		.its("body.id");
}

function createSentInvoice(clientId: string, dueDate: string, unitPrice: number) {
	const data = {
		client: clientId,
		issueDate: daysAgo(90),
		dueDate,
		currency: "EUR",
		lines: [{ description: "Consulting", quantity: 1, unit: "day", unitPrice, vatRate: "0" }],
	};
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: { data },
		})
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			expect(id, "brouillon de facture créé").to.be.a("string");
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/send`,
				body: { documentId: id, data },
			}).then((sent) => {
				expect(sent.status, "envoi accepté").to.be.oneOf([200, 201]);
			});
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
			return cy.wrap(id);
		});
}

describe("Client account statement — aged balance, on screen", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
		}).then((res) => expect(res.status, "transport email configuré").to.be.oneOf([200, 201]));
	});

	beforeEach(() => {
		cy.login();
	});

	it("sorts two overdue invoices into the right aged buckets and displays them in the statement", () => {
		createClient().then((clientId: string) => {
			createSentInvoice(clientId, DUE_31_60, 1000).then((invA) => {
				createSentInvoice(clientId, DUE_60_PLUS, 500).then((invB) => {
					// 1) The endpoint: the aged buckets reflect each invoice's own due date.
					cy.request({ url: `${api}/api/clients/${clientId}/statement` })
						.its("body")
						.then((st) => {
							expect(st.totals, "un jeu de totaux par devise").to.have.length(1);
							const eur = st.totals[0];
							expect(eur.currency).to.eq("EUR");
							const rowA = st.documents.find((d: { id: string }) => d.id === invA);
							const rowB = st.documents.find((d: { id: string }) => d.id === invB);
							expect(rowA, "la facture A est dans le relevé").to.exist;
							expect(rowB, "la facture B est dans le relevé").to.exist;
							expect(eur.days31to60Minor, "A (40 j) → 31-60").to.eq(rowA.outstandingMinor);
							expect(eur.days60PlusMinor, "B (72 j) → 60+").to.eq(rowB.outstandingMinor);
							expect(eur.days0to30Minor, "rien en 0-30").to.eq(0);
							expect(eur.currentMinor, "rien en 'current'").to.eq(0);
							expect(eur.totalOutstandingMinor, "total = A + B").to.eq(
								rowA.outstandingMinor + rowB.outstandingMinor,
							);
						});

					// 2) On screen: the statement opens from the client record and displays total + buckets + lines.
					cy.visit("/clients");
					cy.get(`[data-cy="statement-client-button-${CLIENT_EMAIL}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="client-statement"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="client-statement-total"]').should("be.visible");
					cy.get('[data-cy="client-statement-aged-31-60"]').should("exist");
					cy.get('[data-cy="client-statement-aged-60-plus"]').should("exist");
					cy.get(`[data-cy="client-statement-row-${invA}"]`).should("exist");
					cy.get(`[data-cy="client-statement-row-${invB}"]`).should("exist");
				});
			});
		});
	});
});
