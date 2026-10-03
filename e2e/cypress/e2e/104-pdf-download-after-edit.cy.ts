export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #490: the PDF download of a quote edited back to "draft" must show the edited content, not
 * the PDF of its last send.
 *
 * A sent quote keeps the DELIVERY archive of that send. Before this fix `renderInstancePdf` served
 * that archive whenever one existed, so after an edit (which moves a sent quote back to "draft") the
 * download, the ZIP export and every other consumer still handed out the previous version.
 *
 * Driven through the real stack: the quote is sent through the real asynchronous send (email to the
 * test Mailpit, PDF archived at send time), edited through the same "save-draft" action the document
 * form's own Save button calls, and downloaded from the same endpoint the screen's "Download PDF"
 * entry fetches (`frontend/src/components/documents/document-downloads.ts`). The PDF text is read
 * with `pdfjs-dist` in the Node process (`extractPdfText`), never by counting bytes.
 */
const api = Cypress.env("apiUrl");

const CLIENT_EMAIL = "pdf-after-edit@example.com";
const ORIGINAL = "Original scope 490";
const EDITED = "Edited scope 490";

function quoteData(clientId: string, description: string, unitPrice: number) {
	return {
		client: clientId,
		issueDate: new Date().toISOString().slice(0, 10),
		currency: "EUR",
		lines: [{ description, quantity: 1, unitPrice, vatRate: "20" }],
	};
}

function waitForStatus(quoteId: string, status: string, attempts = 40) {
	cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` }).then((res) => {
		if (res.body.status === status) return;
		if (attempts <= 0) throw new Error(`quote never reached "${status}" (last: ${res.body.status})`);
		cy.wait(500);
		waitForStatus(quoteId, status, attempts - 1);
	});
}

/** The downloaded PDF's text, as `pdfjs-dist` reads it. */
function downloadPdfText(quoteId: string): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/${quoteId}/pdf?typeId=quote`, encoding: "binary" })
		.then((res) => {
			expect(res.status, "PDF downloaded").to.eq(200);
			expect(res.headers["content-type"]).to.include("application/pdf");
			const base64 = Cypress.Buffer.from(res.body as string, "binary").toString("base64");
			return cy.task("extractPdfText", base64) as Cypress.Chainable<string>;
		});
}

describe("The PDF download of a quote edited back to draft shows the edited content (issue #490)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("send, edit back to draft, download: the edited content, then the new send's PDF once sent again", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "PDF After Edit Client",
				contactEmail: CLIENT_EMAIL,
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Rue du Brouillon",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		}).then((created) => {
			const clientId = created.body?.id as string;
			expect(clientId, "client created").to.be.a("string");
			const v1 = quoteData(clientId, ORIGINAL, 100);
			const v2 = quoteData(clientId, EDITED, 900);

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/save-draft`,
				body: { data: v1 },
			}).then((draft) => {
				const quoteId = draft.body?.document?.id as string;
				expect(quoteId, "quote draft created").to.be.a("string");

				// 1. Send it: delivered by email, its PDF archived.
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/send`,
					body: { documentId: quoteId, data: v1, params: { recipient: CLIENT_EMAIL } },
				})
					.its("status")
					.should("be.oneOf", [200, 201]);
				waitForStatus(quoteId, "sent");
				downloadPdfText(quoteId).then((text) => {
					expect(text, "the sent quote's PDF").to.contain(ORIGINAL);
				});

				// 2. Edit it: back to "draft", through the form's own Save action.
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: { documentId: quoteId, data: v2 },
				})
					.its("status")
					.should("be.oneOf", [200, 201]);
				cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
					.its("body.status")
					.should("eq", "draft");

				// 3. Download: the edited content, not the PDF of the last send. The screen the user
				// is looking at says "Edited scope"; the PDF must say the same.
				downloadPdfText(quoteId).then((text) => {
					expect(text, "the draft's PDF shows the edit").to.contain(EDITED);
					expect(text, "and no longer the version sent before the edit").not.to.contain(ORIGINAL);
				});

				// 4. Sent again: the new send's archive is what the download serves, and it holds the edit.
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/send`,
					body: { documentId: quoteId, data: v2, params: { recipient: CLIENT_EMAIL } },
				})
					.its("status")
					.should("be.oneOf", [200, 201]);
				waitForStatus(quoteId, "sent");
				downloadPdfText(quoteId).then((text) => {
					expect(text, "the re-sent quote's PDF").to.contain(EDITED);
					expect(text).not.to.contain(ORIGINAL);
				});
			});
		});
	});
});
