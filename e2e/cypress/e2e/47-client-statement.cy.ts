/**
 * Relevé de compte client (TODO_FEATURES.md rang 6, ⚡) — vue agrégée par client : factures ouvertes,
 * solde, et balance âgée (current / 0-30 / 31-60 / 60+). L'agrégation (buckets, isolation société)
 * est couverte en jest (`settlement/client-statement.spec.ts`) ; ici on prouve le parcours réel :
 * deux factures « sent » d'échéances différentes → l'endpoint les range dans les bons buckets, et
 * le relevé s'ouvre et les affiche à l'écran. Dates calculées relativement à maintenant pour que le
 * classement âgé soit stable quel que soit le jour d'exécution.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const CLIENT_EMAIL = "statement-client@example.com";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const DUE_31_60 = daysAgo(40); // 40 j de retard → bucket 31-60
const DUE_60_PLUS = daysAgo(72); // 72 j de retard → bucket 60+

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

describe("Relevé de compte client — balance âgée, à l'écran", () => {
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

	it("range deux factures échues dans les bons buckets âgés et les affiche dans le relevé", () => {
		createClient().then((clientId: string) => {
			createSentInvoice(clientId, DUE_31_60, 1000).then((invA) => {
				createSentInvoice(clientId, DUE_60_PLUS, 500).then((invB) => {
					// 1) L'endpoint : les buckets âgés reflètent l'échéance de chaque facture.
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

					// 2) À l'écran : le relevé s'ouvre depuis la fiche client et affiche total + buckets + lignes.
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
