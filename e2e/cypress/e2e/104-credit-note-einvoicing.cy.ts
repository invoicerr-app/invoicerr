export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #472 - "Credit notes cannot be produced in any e-invoicing format".
 *
 * A credit note is an invoice in law (CGI art. 289, I, 5), so it has to be producible in the same
 * structured formats. The seeded company is French. Three journeys, against the real API and screen:
 *  a) an invoice (two lines) is issued, then a credit note correcting ONE of its lines. The credit
 *     note's own actions menu now offers the XML download; choosing UBL serves a genuine UBL
 *     <CreditNote> with type code 381, the credit note's own number, the corrected invoice's number
 *     in BG-3 (BillingReference), and the amount of the corrected line only. CII carries 381 too.
 *  b) a LEGACY credit note (issued before #471, so "sent" with no number) gets NO file: 409.
 *  c) a FREE credit note (no invoice, so no buyer) gets no file either: 400, saying why.
 */
const api = Cypress.env("apiUrl");

function createClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Avoir Client SARL",
				contactEmail: "avoir@example.com",
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "3 Rue de l'Avoir",
				city: "Lyon",
				postalCode: "69001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			expect(res.status, "client created").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

/** Issues an invoice of two lines and returns its id, number and the row id of its SECOND line. */
function issueInvoice(clientId: string) {
	const data = {
		client: clientId,
		// Before 2026-09-01: from that date France's PDP mandate binds a domestic invoice and "send"
		// over email 501s - the same date 91-credit-note-numbering.cy.ts picks for the same reason.
		issueDate: "2026-08-30",
		dueDate: "2026-09-30",
		currency: "EUR",
		lines: [
			{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" },
			{ description: "Formation annulee", quantity: 2, unit: "day", unitPrice: 300, vatRate: "20" },
		],
	};
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			const savedData = saved.body?.document?.data;
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/send`,
				body: { documentId: id, data: savedData },
			})
				.its("status")
				.should("be.oneOf", [200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
			return cy
				.request({ url: `${api}/api/documents/${id}?typeId=invoice` })
				.its("body")
				.then((invoice) => {
					const rowId = invoice.data.lines[1].$rowId as string;
					expect(rowId, "the invoice line carries a stable row id").to.be.a("string");
					return { id, displayNumber: invoice.displayNumber as string, rowId };
				});
		});
}

function issueCreditNote(data: Record<string, unknown>) {
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/credit-note/actions/save-draft`, body: { data } })
		.then((saved) => {
			expect(saved.status, "credit note draft saved").to.be.oneOf([200, 201]);
			const id = saved.body?.document?.id as string;
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/credit-note/actions/send`,
				body: { documentId: id, data: saved.body?.document?.data },
			})
				.its("status")
				.should("be.oneOf", [200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=credit-note`, ["sent"]);
			return cy
				.request({ url: `${api}/api/documents/${id}?typeId=credit-note` })
				.its("body")
				.then((note) => ({ id, displayNumber: note.displayNumber as string | null }));
		});
}

describe("Issue #472 - a credit note in the electronic invoice formats", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		cy.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: "email" } })
			.its("status")
			.should("be.oneOf", [200, 201]);
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 720);
	});

	it("the credit note's own menu downloads a UBL <CreditNote> (381) naming the corrected invoice, for the corrected line only; CII carries 381 too", () => {
		createClient().then((clientId) => {
			issueInvoice(clientId).then((invoice) => {
				issueCreditNote({
					invoice: invoice.id,
					correctedLines: [invoice.rowId],
					// Issue #499: a linked credit note is delivered on its invoice's channel ("email" here),
					// which the French mandate refuses for a domestic document issued on or after 2026-09-01.
					issueDate: "2026-08-31",
					currency: "EUR",
					reason: "Formation annulee",
				}).then((note) => {
					expect(note.displayNumber, "the credit note is numbered").to.eq("CN-2026-0001");

					cy.visit(`/documents/credit-note/${note.id}`);
					cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should("contain.text", "Sent");
					cy.window().then((win) => {
						cy.stub(win, "open").as("windowOpen");
					});
					cy.intercept({ method: "GET", pathname: `/api/documents/${note.id}/formats/ubl` }).as("ubl");

					cy.openDocumentActionsMenu();
					cy.get('[data-cy="document-xml-button"]').should("be.visible").click();
					cy.get('[data-cy="document-xml-ubl"]', { timeout: 10000 }).should("be.visible");
					cy.screenshot("472-after-credit-note-xml-menu", { capture: "viewport" });
					cy.get('[data-cy="document-xml-ubl"]').click();

					cy.wait("@ubl", { timeout: 20000 }).then((x) => {
						expect(x.response?.statusCode, "the click produced a UBL export").to.eq(200);
						const xml = String(x.response?.body);
						expect(xml, "a UBL credit note, not an invoice").to.match(/<CreditNote[ >]/);
						expect(xml).to.contain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
						expect(xml).to.contain(`<cbc:ID>${note.displayNumber}</cbc:ID>`);
						expect(xml, "BG-3 names the corrected invoice").to.match(
							new RegExp(
								`<cac:BillingReference>\\s*<cac:InvoiceDocumentReference>\\s*<cbc:ID>${invoice.displayNumber}</cbc:ID>\\s*<cbc:IssueDate>2026-08-30</cbc:IssueDate>`,
							),
						);
						// 2 x 300.00 at 20%: net 600.00, gross 720.00 - the corrected line, not the invoice's 1320.00.
						expect(xml).to.contain('<cbc:PayableAmount currencyID="EUR">720.00</cbc:PayableAmount>');
						expect(xml).not.to.contain("Conseil");
					});
					cy.get("@windowOpen").should("have.been.called");

					// The list row offers it too.
					cy.visit("/documents/credit-note");
					cy.openDocumentRowMenu(note.id);
					cy.get(`[data-cy="document-xml-button-${note.id}"]`, { timeout: 10000 }).should("exist");
					cy.screenshot("472-after-credit-note-list-menu", { capture: "viewport" });

					cy.request({ url: `${api}/api/documents/${note.id}/formats/cii?typeId=credit-note` }).then((res) => {
						expect(res.status).to.eq(200);
						expect(String(res.body)).to.contain("<ram:TypeCode>381</ram:TypeCode>");
						expect(String(res.body)).to.contain(`<ram:IssuerAssignedID>${invoice.displayNumber}</ram:IssuerAssignedID>`);
					});
				});
			});
		});
	});

	it("a LEGACY credit note, sent without a number, gets no file at all (409) - never a placeholder number", () => {
		createClient().then((clientId) => {
			issueInvoice(clientId).then((invoice) => {
				issueCreditNote({
					invoice: invoice.id,
					correctedLines: [invoice.rowId],
					// Before the French mandate, see the first test (issue #499).
					issueDate: "2026-08-31",
					currency: "EUR",
				}).then((note) => {
					cy.task("makeCreditNoteLegacyUnnumbered", { documentId: note.id });
					cy.request({
						url: `${api}/api/documents/${note.id}/formats/ubl?typeId=credit-note`,
						failOnStatusCode: false,
					}).then((res) => {
						expect(res.status, "refused").to.eq(409);
						expect(JSON.stringify(res.body)).to.contain("issued without a number");
						expect(JSON.stringify(res.body)).not.to.contain("DRAFT");
					});
				});
			});
		});
	});

	it("a FREE credit note (no invoice, hence no buyer) gets no file, and the refusal says why (400)", () => {
		issueCreditNote({
			issueDate: "2026-09-22",
			currency: "EUR",
			reason: "Geste commercial",
			lines: [{ description: "Remboursement", quantity: 1, unitPrice: 42, vatRate: "20" }],
		}).then((note) => {
			cy.request({
				url: `${api}/api/documents/${note.id}/formats/ubl?typeId=credit-note`,
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status).to.eq(400);
				expect(JSON.stringify(res.body)).to.contain("FREE credit note");
			});
		});
	});
});
