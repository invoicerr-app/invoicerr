export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #507 - "Linked credit note renders a 0.00 total and raw row ids (PDF and email)".
 *
 * A credit note linked to an invoice owns no amounts: it points at rows of the invoice it corrects.
 * Its PDF used to print "Total 0.00 EUR" with the corrected lines as raw row ids, and the screen's
 * list row, header amount and totals card said 0.00 too. Settlement and the XML export already priced
 * it from the corrected invoice's rows (`totals/linked-credit-note.ts` now holds that one rule for
 * all of them).
 *
 * The invoice's corrected line carries a 10% discount on purpose: only the INVOICE's own descriptor
 * applies it, so a total computed any other way lands on 720.00 instead of 648.00.
 *
 * Driven through the real stack: the invoice and the credit note are issued through the same
 * "save-draft"/"send" actions the screen calls, the PDF is downloaded from the endpoint the screen's
 * "Download PDF" entry fetches and read with `pdfjs-dist` (`extractPdfText`), and the figures on screen
 * are read off the rendered list and detail page.
 *
 * The covering EMAIL is asserted by `106-credit-note-archive-delivery.cy.ts` (issue #499, which added
 * the delivery), and against the real render pipeline in
 * `backend/src/modules/documents/totals/linked-credit-note.spec.ts`.
 */
import { FRENCH_BUYER_IDENTIFIERS } from "../fixtures/identifiers";

const api = Cypress.env("apiUrl");

/** 2 x 300.00 at 10% off, 20% VAT: net 540.00, VAT 108.00, gross 648.00. */
const CREDITED_GROSS_MINOR = 64800;
const CREDITED_GROSS = "648.00 EUR";

function createClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Avoir Rendu SARL",
				contactEmail: "avoir-rendu@example.com",
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "7 Rue du Rendu",
				city: "Lyon",
				postalCode: "69002",
				isActive: true,
				type: "COMPANY",
				identifiers: FRENCH_BUYER_IDENTIFIERS,
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
		// over email 501s - the same date 104-credit-note-einvoicing.cy.ts picks for the same reason.
		issueDate: "2026-08-30",
		dueDate: "2026-09-30",
		currency: "EUR",
		lines: [
			{ description: "Conseil strategique", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" },
			{
				description: "Formation annulee",
				quantity: 2,
				unit: "day",
				unitPrice: 300,
				vatRate: "20",
				discountPercent: 10,
			},
		],
	};
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/send`,
				body: { documentId: id, data: saved.body?.document?.data },
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
			return cy.wrap(id);
		});
}

/** The downloaded PDF's text, as `pdfjs-dist` reads it; the bytes are also kept under
 *  `cypress/downloads/` so the PR's screenshots can show the real first page. */
function downloadPdfText(id: string, fileName: string): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/${id}/pdf?typeId=credit-note`, encoding: "binary" })
		.then((res) => {
			expect(res.status, "PDF downloaded").to.eq(200);
			expect(res.headers["content-type"]).to.include("application/pdf");
			cy.writeFile(`cypress/downloads/${fileName}`, res.body as string, "binary");
			const base64 = Cypress.Buffer.from(res.body as string, "binary").toString("base64");
			return cy.task("extractPdfText", base64) as Cypress.Chainable<string>;
		});
}

describe("Issue #507 - a linked credit note is worth the invoice lines it corrects, everywhere", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		cy.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: "email" } })
			.its("status")
			.should("be.oneOf", [200, 201]);
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 900);
	});

	it("the PDF lists the corrected line and names the invoice, and every total equals what settlement takes off the invoice", () => {
		createClient().then((clientId) => {
			issueInvoice(clientId).then((invoice) => {
				issueCreditNote({
					invoice: invoice.id,
					correctedLines: [invoice.rowId],
					// Issue #499: a linked credit note is delivered on its invoice's channel ("email" here),
					// which the French mandate refuses for a domestic document issued on or after 2026-09-01.
					issueDate: "2026-08-31",
					currency: "EUR",
					reason: "Session cancelled by the client",
				}).then((noteId) => {
					// The reference figure: what settlement actually subtracts from the invoice.
					cy.request({ url: `${api}/api/documents/${invoice.id}/settlement?typeId=invoice` })
						.its("body")
						.then((settlement) => {
							expect(settlement.credits, "the sent credit note counts against the invoice").to.have.length(1);
							expect(settlement.credits[0].id).to.eq(noteId);
							expect(settlement.credits[0].amountMinor, "settlement credits the discounted line").to.eq(
								CREDITED_GROSS_MINOR,
							);
						});

					downloadPdfText(noteId, "507-linked-credit-note.pdf").then((text) => {
						expect(text, "the corrected line's own description").to.contain("Formation annulee");
						expect(text, "the line the note does not correct is not listed").not.to.contain("Conseil strategique");
						expect(text, "never the raw row id").not.to.contain(invoice.rowId);
						expect(text, "the unit price of the corrected line").to.contain("300.00");
						expect(text, "the corrected invoice, by number and date").to.contain(
							`Corrects invoice ${invoice.displayNumber} of 2026-08-30`,
						);
						expect(text, "the total is what settlement takes off the invoice").to.match(
							new RegExp(`Total\\s*${CREDITED_GROSS.replace(".", "\\.")}`),
						);
						expect(text, "no 0.00 total").not.to.match(/Total\s*0\.00/);
					});

					// The same figure through the totals endpoint the MCP tool and API clients read.
					cy.request({ url: `${api}/api/documents/${noteId}/totals?typeId=credit-note` })
						.its("body.grossMinor")
						.should("eq", CREDITED_GROSS_MINOR);

					// The list row.
					cy.visit("/documents/credit-note");
					cy.get(`[data-cy="document-row-amount-${noteId}"]`, { timeout: 15000 })
						.should("be.visible")
						.and("contain.text", CREDITED_GROSS);
					cy.get(`[data-cy="document-list-row-${noteId}"]`).screenshot("507-list-row");

					// The detail page: header amount and totals card.
					cy.visit(`/documents/credit-note/${noteId}`);
					cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should("contain.text", "Sent");
					cy.get('[data-cy="document-detail-amount"]').should("contain.text", CREDITED_GROSS);
					cy.get('[data-cy="document-totals-card"] [data-cy="document-totals-gross"]').should(
						"contain.text",
						CREDITED_GROSS,
					);
					cy.get('[data-cy="document-totals-net"]').should("contain.text", "540.00 EUR");
					cy.screenshot("507-detail", { capture: "viewport" });
				});
			});
		});
	});

	it("a FREE credit note keeps pricing its own lines", () => {
		issueCreditNote({
			issueDate: "2026-09-21",
			currency: "EUR",
			reason: "Geste commercial",
			lines: [{ description: "Remise fidelite", quantity: 1, unitPrice: 50, vatRate: "20" }],
		}).then((noteId) => {
			downloadPdfText(noteId, "507-free-credit-note.pdf").then((text) => {
				expect(text, "the free note's own line").to.contain("Remise fidelite");
				expect(text).to.match(/Total\s*60\.00 EUR/);
				expect(text, "a free credit note corrects no invoice").not.to.contain("Corrects invoice");
			});
			cy.request({ url: `${api}/api/documents/${noteId}/totals?typeId=credit-note` })
				.its("body.grossMinor")
				.should("eq", 6000);
			cy.visit("/documents/credit-note");
			cy.get(`[data-cy="document-row-amount-${noteId}"]`, { timeout: 15000 }).should("contain.text", "60.00 EUR");
		});
	});
});
