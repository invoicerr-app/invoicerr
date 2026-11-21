export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Tests for the PDF rendering engine. Verifies that:
 * 1. The endpoint generates valid PDFs
 * 2. Preview opens the PDF in a new tab and Download saves it, on the list and the detail page
 * 3. Authentication is properly enforced
 * 4. Error cases are handled
 */
const api = Cypress.env("apiUrl");

const QUOTE_LINES = [{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }];

function firstClientId(): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => clients[0].id);
}

function createDraftQuote(): Cypress.Chainable<string> {
	return firstClientId().then((client) =>
		cy
			.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/save-draft`,
				body: {
					data: { client, issueDate: "2026-08-30", dueDate: "2026-09-30", currency: "EUR", lines: QUOTE_LINES },
				},
			})
			.its("body.document.id"),
	);
}

function createValidatedInvoice(): Cypress.Chainable<{ id: string; displayNumber: string }> {
	return firstClientId().then((client) => {
		// Issued before the e-invoicing mandate applies, so "validate" numbers it without any transmission.
		const data = { client, issueDate: "2026-08-28", dueDate: "2026-09-30", currency: "EUR", lines: QUOTE_LINES };
		return cy
			.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
			.its("body.document.id")
			.then((id: string) =>
				cy
					.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/validate`,
						body: { documentId: id, data },
					})
					.then(() => cy.request({ url: `${api}/api/documents/${id}?typeId=invoice` }))
					.its("body.displayNumber")
					.then((displayNumber: string) => {
						expect(displayNumber, "the validated invoice has a number").to.be.a("string").and.not.be.empty;
						return { id, displayNumber };
					}),
			);
	});
}

function expectPdfServed() {
	cy.wait("@pdf", { timeout: 20000 }).then((x) => {
		// 304 when an issued document's PDF is fetched twice: the browser revalidates its cached copy.
		expect(x.response?.statusCode, "the click produced a PDF").to.be.oneOf([200, 304]);
		if (x.response?.statusCode === 200) {
			expect(String(x.response?.headers["content-type"])).to.contain("application/pdf");
		}
	});
}

/** A real save lands in Cypress's downloads folder; a new tab never does. */
function expectSavedPdf(fileName: string) {
	cy.readFile(`${Cypress.config("downloadsFolder")}/${fileName}`, "binary", { timeout: 20000 }).should((bytes) => {
		expect(bytes.slice(0, 4), "the saved file is a PDF").to.eq("%PDF");
	});
}

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

	it("list row: Preview opens the PDF in a new tab, Download saves it under the draft's own name", () => {
		createDraftQuote().then((id) => {
			cy.visit("/documents/quote", { timeout: 20000 });

			// Clicked, not just seen: a relative `fetch` once went to the Vite server with no cookie,
			// and an existence-only check let that dead button through.
			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/pdf` }).as("pdf");
			cy.window().then((win) => {
				// window.open would open a tab Cypress doesn't control; the assertion targets the
				// real network request and the call itself, not the tab.
				cy.stub(win, "open").as("windowOpen");
			});
			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-pdf-download-button-${id}"]`).should("be.visible");
			cy.get(`[data-cy="document-pdf-button-${id}"]`).click();
			expectPdfServed();
			cy.get("@windowOpen").should("have.been.calledOnce");

			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-pdf-download-button-${id}"]`).click();
			expectPdfServed();
			expectSavedPdf(`Quote Draft ${id.slice(0, 8)}.pdf`);
			cy.get("@windowOpen").should("have.been.calledOnce");
		});
	});

	it("detail page: Preview opens the PDF in a new tab, Download saves it under the invoice's number", () => {
		createValidatedInvoice().then(({ id, displayNumber }) => {
			cy.visit("/documents/invoice", { timeout: 20000 });
			cy.openDocument(id);

			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/pdf` }).as("pdf");
			cy.window().then((win) => {
				cy.stub(win, "open").as("windowOpen");
			});
			cy.openDocumentActionsMenu();
			cy.get('[data-cy="document-pdf-download-button"]').should("be.visible");
			cy.get('[data-cy="document-pdf-button"]').click();
			expectPdfServed();
			cy.get("@windowOpen").should("have.been.calledOnce");

			cy.openDocumentActionsMenu();
			cy.get('[data-cy="document-pdf-download-button"]').click();
			expectPdfServed();
			expectSavedPdf(`${displayNumber}.pdf`);
			cy.get("@windowOpen").should("have.been.calledOnce");
		});
	});
});
