export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Basic stock management (TODO_FEATURES.md rank 18) — invoicing N units of a stock-tracked article
 * DECREMENTS its balance at ISSUANCE, and an alert becomes visible below the threshold. Discipline: the
 * action (creation + send) goes through the real server chain (the decrement happens at issuance, in
 * `documents.service.ts#runAction`, never client-side), the assertions read the stock back via the API
 * THEN the badge on screen. The pure logic (sum per article, never a clamp) + the idempotence of the
 * issuance gate are covered in jest; here we prove the end-to-end wiring.
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

describe("Stock management — decrement at issuance + threshold alert", () => {
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

	it("invoicing 8 units of an article with 10 in stock brings it down to 2 (< threshold 3) and shows the alert", () => {
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

					// Before issuance, the stock hasn't moved — the decrement happens at ISSUANCE.
					cy.request({ url: `${api}/api/articles/${articleId}` })
						.its("body.quantity")
						.should("eq", 10);

					// Issuance (the real pipeline) → the decrement triggers on entering "sending".
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: invoiceId, data },
					}).then((sent) => expect(sent.status).to.be.oneOf([200, 201]));
					cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

					// API: 10 - 8 = 2, and 2 <= 3 → below the threshold.
					cy.request({ url: `${api}/api/articles/${articleId}` })
						.its("body")
						.then((article) => {
							expect(article.quantity, "stock décrémenté").to.eq(2);
							expect(article.isLowStock, "sous le seuil").to.eq(true);
						});

					// The alert endpoint does list the article.
					cy.request({ url: `${api}/api/articles/low-stock` })
						.its("body")
						.then((lowStock) => {
							expect(lowStock.count, "au moins un article en alerte").to.be.greaterThan(0);
							const ids = (lowStock.articles as { id: string }[]).map((a) => a.id);
							expect(ids, "notre article est en alerte").to.include(articleId);
						});

					// On screen: the "low stock" badge appears on the article's card.
					cy.visit("/articles");
					cy.get(`[data-cy="article-low-stock-${articleId}"]`, { timeout: 15000 }).should("be.visible");
				});
			});
		});
	});
});
