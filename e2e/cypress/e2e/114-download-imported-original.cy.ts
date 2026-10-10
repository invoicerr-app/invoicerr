export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #549 - "Download the original of an imported document".
 *
 * Follow-up of #340 (PR #547): the PDF endpoint refuses (409) an imported document whose archived
 * original is not itself a PDF (a structured XML a previous tool produced), by design
 * (documents.service.ts#renderInstancePdf). Until this issue nothing else let the user retrieve
 * that original at all.
 *
 * Covers:
 *  a) "Download original" downloads the archived original byte for byte, with its own content type
 *     (application/xml here) and a file name built from the document's own display number - proven
 *     by intercepting the real network request the click triggers, never the screen alone;
 *  b) "Download PDF" still refuses (409) for the same document, and the toast shown on screen is the
 *     translated pointer message ("... Use \"Download original\" ..."), not a generic HTTP error.
 *
 * Same discipline as 30-document-xml-format.cy.ts: data creation goes through the real API
 * (`cy.request`, and a real browser `fetch` for the multipart upload - see `uploadOriginal` below,
 * copied from 112-import-historical-documents.cy.ts's own identical helper), the UI is driven only
 * for the actions and assertions this issue is actually about.
 */
const api = Cypress.env("apiUrl");
const appOrigin = Cypress.config("baseUrl");

const ORIGINAL_XML_SELECT_PATH = "cypress/fixtures/import-historical/original-invoice.xml";
const ORIGINAL_XML_FIXTURE = "import-historical/original-invoice.xml";

function createClient(name: string, contactEmail: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				contactEmail,
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Rue de l'Original",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

// Same reason 112-import-historical-documents.cy.ts's own `uploadOriginal` uses a real browser
// `fetch` rather than `cy.request()`: a `FormData` body sent through `cy.request()` is serialized
// like a plain object, never as real `multipart/form-data`, so the backend's `FileInterceptor`
// would never see a file at all.
function uploadOriginal() {
	return cy.fixture(ORIGINAL_XML_FIXTURE).then((xmlText) =>
		cy.window().then((win) => {
			const blob = new win.Blob([xmlText as string], { type: "application/xml" });
			const formData = new win.FormData();
			formData.append("file", blob, "historical-invoice.xml");
			return cy
				.wrap(
					win
						.fetch(`${api}/api/documents/attachments/upload`, {
							method: "POST",
							credentials: "include",
							body: formData,
						})
						.then(async (res) => {
							expect(res.ok, "original XML file uploaded").to.eq(true);
							return res.json();
						}),
					{ timeout: 15000 },
				)
				.then((body) => body as { fileRef: string; fileName: string; mime: string });
		}),
	);
}

function importXmlInvoice(clientId: string) {
	return uploadOriginal().then((originalFile) =>
		cy
			.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/import`,
				body: {
					data: {
						client: clientId,
						issueDate: "2024-04-10",
						dueDate: "2024-05-10",
						currency: "EUR",
						lines: [
							{ description: "Historical consulting", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" },
						],
					},
					originalNumber: "OLD-XML-0001",
					transmissionEvidence: {},
					originalFile,
				},
			})
			.then((res) => {
				expect(res.status, "invoice imported").to.be.oneOf([200, 201]);
				expect(res.body.status, "imported status").to.eq("imported");
				return res.body.id as string;
			}),
	);
}

describe("Issue #549 - download the original of an imported document", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 720);
	});

	it("downloads the archived XML original byte for byte, with its own content type and file name, and Download PDF points at it instead of refusing blindly", () => {
		createClient("XML Original Co", "xml-original@example.com").then((clientId) => {
			importXmlInvoice(clientId).then((invoiceId) => {
				cy.visit(`${appOrigin}/documents/invoice/${invoiceId}`);
				cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should("contain.text", "Imported");

				cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));

				// (a) The actions menu offers "Download original" on this imported document.
				cy.get('[data-cy="document-actions-menu"]').click();
				cy.get('[data-cy="document-original-button"]', { timeout: 10000 }).should("be.visible");
				cy.screenshot("549-actions-menu-download-original", { capture: "viewport" });

				cy.intercept({
					method: "GET",
					pathname: `/api/documents/${invoiceId}/original`,
				}).as("downloadOriginal");
				cy.get('[data-cy="document-original-button"]').click();
				cy.wait("@downloadOriginal", { timeout: 20000 }).then((x) => {
					expect(x.response?.statusCode, "the original is actually served").to.eq(200);
					expect(String(x.response?.headers["content-type"]), "its own content type").to.include(
						"application/xml",
					);
					expect(
						String(x.response?.headers["content-disposition"]),
						"a file name built from the display number",
					).to.include("OLD-XML-0001-original.xml");
					expect(String(x.response?.body), "the archived bytes, verbatim").to.include(
						"e2e-549-xml-original-marker",
					);
				});
				cy.get("@windowOpen").its("callCount").should("eq", 1);
				// Close the menu before reopening it - Escape, never a raw click at a fixed coordinate,
				// which can land on the dropdown's own dismissable overlay and time out (same fix
				// 89-quote-manual-acceptance.cy.ts already uses for the identical menu).
				cy.get("body").type("{esc}");

				// (b) "Download PDF" still refuses (409) on this same document, and the toast shown on
				// screen is the translated pointer message, not a generic HTTP error.
				cy.intercept({
					method: "GET",
					pathname: `/api/documents/${invoiceId}/pdf`,
				}).as("downloadPdfRefused");
				cy.get('[data-cy="document-actions-menu"]').click();
				cy.get('[data-cy="document-pdf-button"]', { timeout: 10000 }).should("be.visible").click();
				cy.wait("@downloadPdfRefused", { timeout: 20000 }).then((x) => {
					expect(x.response?.statusCode, "still refused, never relabeled as a PDF").to.eq(409);
				});
				cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
					"contain.text",
					'Use "Download original" to get the file as issued.',
				);
				cy.screenshot("549-download-pdf-pointer-message", { capture: "viewport" });
			});
		});
	});
});
