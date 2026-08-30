/**
 * Tests for the PDF rendering engine. Verifies that:
 * 1. The endpoint generates valid PDFs
 * 2. The PDF button works on the list screen
 * 3. Authentication is properly enforced
 * 4. Error cases are handled
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Document PDF rendering", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("generates a valid PDF via the API", () => {
		// Create a quote to have something to render
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{
									description: "Consulting",
									quantity: 1,
									unit: "unit",
									unitPrice: 500,
									vatRate: "20",
								},
							],
						},
					},
				}).then((saved) => {
					expect(saved.status).to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id;
					expect(id).to.be.a("string");

					// Request the PDF
					cy.request({
						url: `${api}/api/documents/${id}/pdf?typeId=quote`,
						encoding: "binary",
					}).then((res) => {
						// Response should be 200 OK
						expect(res.status).to.eq(200);

						// Content-Type header should indicate PDF
						expect(res.headers["content-type"]).to.include("application/pdf");

						// PDF magic bytes: %PDF at the start
						const pdfStart = String.fromCharCode(
							res.body.charCodeAt(0),
							res.body.charCodeAt(1),
							res.body.charCodeAt(2),
							res.body.charCodeAt(3),
						);
						expect(pdfStart).to.eq("%PDF");

						// PDF should be reasonably sized (at least 1000 bytes)
						expect(res.body.length).to.be.greaterThan(1000);
					});
				});
			});
	});

	it("requires authentication to download a PDF", () => {
		// Create a quote
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{
									description: "Consulting",
									quantity: 1,
									unit: "unit",
									unitPrice: 500,
									vatRate: "20",
								},
							],
						},
					},
				}).then((saved) => {
					const id = saved.body?.document?.id;

					// Clear cookies to remove auth
					cy.clearCookies();

					// Request should fail with 401
					cy.request({
						url: `${api}/api/documents/${id}/pdf?typeId=quote`,
						failOnStatusCode: false,
					}).then((res) => {
						expect(res.status).to.eq(401);
					});
				});
			});
	});

	it("returns 404 for a non-existent document", () => {
		cy.request({
			url: `${api}/api/documents/does-not-exist/pdf?typeId=quote`,
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status).to.eq(404);
		});
	});

	it("shows a PDF download button on the list screen", () => {
		// Create a quote
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{
									description: "Consulting",
									quantity: 1,
									unit: "unit",
									unitPrice: 500,
									vatRate: "20",
								},
							],
						},
					},
				}).then((saved) => {
					const id = saved.body?.document?.id;

					// Navigate to the quote list
					cy.visit("/documents/quote", { timeout: 20000 });

					// The PDF button should be present with the correct data-cy attribute
					cy.get(`[data-cy="document-pdf-button-${id}"]`, {
						timeout: 10000,
					}).should("exist");

					// Le bouton doit être CLIQUÉ, pas seulement vu. La première version ne vérifiait que
					// son existence — et il était MORT : un `fetch` relatif partait vers le serveur Vite,
					// sans cookie, et personne ne le voyait. Troisième bouton mort de cette famille ici.
					// On intercepte la vraie requête que le clic déclenche et on exige un PDF en retour.
					cy.intercept({
						method: "GET",
						pathname: `/api/documents/${id}/pdf`,
					}).as("pdf");
					cy.window().then((win) => {
						// window.open ouvrirait un onglet que Cypress ne contrôle pas — on le neutralise,
						// l'assertion porte sur la requête réseau réelle, pas sur l'onglet.
						cy.stub(win, "open").as("windowOpen");
					});
					cy.get(`[data-cy="document-pdf-button-${id}"]`).click();
					cy.wait("@pdf", { timeout: 20000 }).then((x) => {
						expect(
							x.response?.statusCode,
							"le clic a réellement produit un PDF",
						).to.eq(200);
						expect(
							String(x.response?.headers["content-type"]),
							"et il est servi comme tel",
						).to.contain("application/pdf");
					});
					cy.get("@windowOpen").should("have.been.called");
				});
			});
	});
});
