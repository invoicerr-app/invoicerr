/**
 * Gestion de stock basique (TODO_FEATURES.md rang 18) — facturer N unités d'un article suivi en stock
 * DÉCRÉMENTE son solde à l'ÉMISSION, et sous le seuil une alerte devient visible. Discipline : l'action
 * (création + envoi) passe par la vraie chaîne serveur (le décrément se fait à l'émission, dans
 * `documents.service.ts#runAction`, jamais côté client), les assertions relisent le stock via l'API
 * PUIS le badge à l'écran. La logique pure (somme par article, jamais de clamp) + l'idempotence du gate
 * d'émission sont couvertes en jest ; ici on prouve le câblage bout-en-bout.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createTrackedArticle() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/articles`,
			body: { name: "Widget en stock", unitPrice: 100, vatRate: 20, quantity: 10, lowStockThreshold: 3 },
		})
		.then((res) => {
			expect(res.status, "article créé").to.be.oneOf([200, 201]);
			expect(res.body.quantity, "stock initial").to.eq(10);
			expect(res.body.isLowStock, "pas encore sous le seuil").to.eq(false);
			return res.body.id as string;
		});
}

function createClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Stock Client SARL",
				contactEmail: "stock-client@example.com",
				currency: "EUR",
				country: "FR",
				address: "1 Rue du Stock",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		})
		.its("body.id");
}

describe("Gestion de stock — décrément à l'émission + alerte seuil", () => {
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

	it("facturer 8 unités d'un article à 10 en stock le descend à 2 (< seuil 3) et montre l'alerte", () => {
		createTrackedArticle().then((articleId: string) => {
			createClient().then((clientId: string) => {
				const data = {
					client: clientId,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [
						{
							articleId,
							description: "Widget en stock",
							quantity: 8,
							unit: "unit",
							unitPrice: 100,
							vatRate: "20",
						},
					],
				};
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId, "brouillon créé").to.be.a("string");

					// Avant l'émission, le stock n'a pas bougé — le décrément se fait à l'ÉMISSION.
					cy.request({ url: `${api}/api/articles/${articleId}` })
						.its("body.quantity")
						.should("eq", 10);

					// Émission (le vrai pipeline) → le décrément se déclenche en entrant dans "sending".
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: invoiceId, data },
					}).then((sent) => expect(sent.status).to.be.oneOf([200, 201]));
					cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

					// API : 10 - 8 = 2, et 2 <= 3 → sous le seuil.
					cy.request({ url: `${api}/api/articles/${articleId}` })
						.its("body")
						.then((article) => {
							expect(article.quantity, "stock décrémenté").to.eq(2);
							expect(article.isLowStock, "sous le seuil").to.eq(true);
						});

					// L'endpoint d'alerte liste bien l'article.
					cy.request({ url: `${api}/api/articles/low-stock` })
						.its("body")
						.then((lowStock) => {
							expect(lowStock.count, "au moins un article en alerte").to.be.greaterThan(0);
							const ids = (lowStock.articles as { id: string }[]).map((a) => a.id);
							expect(ids, "notre article est en alerte").to.include(articleId);
						});

					// À l'écran : le badge "stock bas" apparaît sur la carte de l'article.
					cy.visit("/articles");
					cy.get(`[data-cy="article-low-stock-${articleId}"]`, { timeout: 15000 }).should("be.visible");
				});
			});
		});
	});
});
