export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #471 - "Credit notes are issued without a legal number".
 *
 * CGI art. 289, I, 5 assimilates any document modifying an initial invoice to an invoice itself,
 * which must carry every mandatory particular of CGI ann. II art. 242 nonies A, I, 7° - including a
 * unique number from a continuous chronological sequence, by series distinct from the invoice's own
 * when the activity justifies it (see `backend/src/modules/documents/country-policy/data/fr.json`'s
 * own `numbering` fact for the citation, and `credit-note.descriptor.ts`'s own "Numbering" header for
 * the full "why"). The default seeded company (`cy.resetAndSeed()`) is French.
 *
 * Three journeys, all against the real API and the real screen:
 *  a) a DRAFT credit note shows no number; ISSUING it (draft -> sending -> sent) gives it
 *     "CREDIT-NOTE-2026-0001" - on the detail page, the list row, AND the PDF's own rendered text - and
 *     a SECOND issued credit note gets "-0002", in a series entirely independent of the invoice's own
 *     (proven by an invoice issued alongside, still "INVOICE-2026-0001").
 *  b) a LEGACY credit note - simulated with `cy.task("makeCreditNoteLegacyUnnumbered", ...)`, since no
 *     route through this app can produce one any more - shows "Issued without a number", a DISTINCT
 *     label from a draft's "no number yet", on both the detail page and the list row.
 *  c) retrying "send" on that same legacy record (from "send_failed", the one real, reachable RETRY
 *     starting point) does NOT number it retroactively - `numbering.onlyFrom: ['draft']`'s own
 *     guarantee (descriptors/types.ts) - it stays "Issued without a number" even once "sent" again.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const appOrigin = "http://localhost:6284";

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
				address: "1 Rue du Numéro",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "the created client has an id").to.be.a("string");
			return id;
		});
}

function freeCreditNoteData(overrides: Record<string, unknown> = {}) {
	return {
		issueDate: "2026-09-20",
		currency: "EUR",
		reason: "Geste commercial - remboursement d'un trop-perçu non rattaché à une facture.",
		lines: [{ description: "Remboursement", quantity: 1, unitPrice: 42, vatRate: "0" }],
		...overrides,
	};
}

/** Creates a free credit note draft, then issues it (draft -> sending -> sent) through the real API,
 *  and returns its id - the same two-call save-draft/send shape 90-save-draft-lock.cy.ts already uses. */
function createAndIssueCreditNote(overrides: Record<string, unknown> = {}) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: { data: freeCreditNoteData(overrides) },
		})
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			expect(id, "credit note draft created").to.be.a("string");
			expect(saved.body?.document?.displayNumber, "a draft carries no number").to.be.oneOf([null, undefined]);
			const data = saved.body?.document?.data;

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/credit-note/actions/send`,
				body: { documentId: id, data },
			}).then((sent) => {
				expect(sent.status, "send accepted").to.be.oneOf([200, 201]);
			});
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=credit-note`, ["sent"]);

			return cy.wrap(id);
		});
}

describe("Issue #471 - credit notes get a legal, sequential number of their own", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1440, 900);
	});

	it('a draft has no number; issuing gives "CREDIT-NOTE-2026-0001", shown on the detail page, the list row, and the PDF - in a series independent of the invoice one, which keeps "INVOICE-2026-0001"', () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((companyRes) => {
			expect(companyRes.status, "transport configured").to.be.oneOf([200, 201]);
		});

		createClient("Numbering Co", "numbering@example.com").then((clientId) => {
			// An invoice, issued ALONGSIDE the credit notes below - proves the two series never share a
			// counter (a bug that would otherwise silently skip or duplicate a credit-note number every
			// time an invoice is also issued for this company).
			const invoiceData = {
				client: clientId,
				// Before 2026-09-01 on purpose: from that date France's PDP mandate binds a domestic
				// invoice and "send" over email 501s (transports/channel-policy/mandate.ts) - the same
				// date 90-save-draft-lock.cy.ts's own invoice fixture already picks for the same reason.
				// The credit note's own "send" carries no such channel-mandate preflight (see
				// credit-note-actions.ts), so its own issueDate below is unaffected.
				issueDate: "2026-08-30",
				dueDate: "2026-09-30",
				currency: "EUR",
				lines: [{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
			};
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: invoiceData },
			}).then((savedInvoice) => {
				const invoiceId = savedInvoice.body?.document?.id as string;
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: invoiceId, data: invoiceData },
				}).then((sent) => {
					expect(sent.status, "invoice send accepted").to.be.oneOf([200, 201]);
				});
				cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

				createAndIssueCreditNote().then((creditNoteId) => {
					cy.request({ url: `${api}/api/documents/${creditNoteId}?typeId=credit-note` })
						.its("body")
						.then((doc) => {
							expect(doc.status, "issued").to.eq("sent");
							expect(doc.displayNumber, "the credit note's own first number").to.eq(
								"CREDIT-NOTE-2026-0001",
							);
						});

					// Detail page.
					cy.visit(`${appOrigin}/documents/credit-note/${creditNoteId}`);
					cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should(
						"contain.text",
						"Sent",
					);
					cy.get('[data-cy="document-form-number"]').should(
						"contain.text",
						"CREDIT-NOTE-2026-0001",
					);
					cy.screenshot("471-after-detail", { capture: "viewport" });

					// List row.
					cy.visit(`${appOrigin}/documents/credit-note`);
					cy.get(`[data-cy="document-number-${creditNoteId}"]`, { timeout: 15000 }).should(
						"contain.text",
						"CREDIT-NOTE-2026-0001",
					);
					cy.screenshot("471-after-list", { capture: "viewport" });

					// The PDF's own rendered text (Chromium's own PDF writer compresses the content stream,
					// so the number never appears verbatim in the raw bytes without decoding it first - the
					// same technique 20-document-totals.cy.ts's own PDF-content proof already uses).
					cy.request({
						url: `${api}/api/documents/${creditNoteId}/pdf?typeId=credit-note`,
						encoding: "binary",
					}).then((res) => {
						expect(res.status).to.eq(200);
						const binary = res.body as string;
						cy.writeFile("cypress/downloads/471-after-credit-note.pdf", binary, "binary");
						const base64 = Cypress.Buffer.from(binary, "binary").toString("base64");
						cy.task("extractPdfText", base64).then((rawText) => {
							const text = String(rawText).replace(/\s+/g, " ");
							expect(text, "the PDF's own rendered text carries the number").to.contain(
								"CREDIT-NOTE-2026-0001",
							);
						});
					});

					// A second credit note gets the NEXT number of its own series.
					createAndIssueCreditNote({ issueDate: "2026-09-21" }).then((secondId) => {
						cy.request({ url: `${api}/api/documents/${secondId}?typeId=credit-note` })
							.its("body.displayNumber")
							.should("eq", "CREDIT-NOTE-2026-0002");

						// The invoice series is UNAFFECTED - still its own first number.
						cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
							.its("body.displayNumber")
							.should("eq", "INVOICE-2026-0001");
					});
				});
			});
		});
	});

	it('a LEGACY credit note (issued before this feature existed) shows "Issued without a number" - distinct from a draft\'s "no number yet" - on both the detail page and the list row', () => {
		createAndIssueCreditNote({ issueDate: "2026-09-22" }).then((creditNoteId) => {
			// No route through this app can produce this state any more - see the task's own header
			// (cypress.config.ts) for why a direct DB write is the only way to set one up.
			cy.task("makeCreditNoteLegacyUnnumbered", { documentId: creditNoteId }).then(() => {
				cy.request({ url: `${api}/api/documents/${creditNoteId}?typeId=credit-note` })
					.its("body")
					.then((doc) => {
						expect(doc.status, "still sent - only the number was stripped").to.eq("sent");
						expect(doc.displayNumber, "no number any more").to.be.oneOf([null, undefined]);
					});

				cy.visit(`${appOrigin}/documents/credit-note/${creditNoteId}`);
				cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should(
					"contain.text",
					"Sent",
				);
				cy.get('[data-cy="document-form-number"]').should(
					"contain.text",
					"Issued without a number",
				);
				cy.screenshot("471-after-legacy-detail", { capture: "viewport" });

				cy.visit(`${appOrigin}/documents/credit-note`);
				cy.get(`[data-cy="document-number-${creditNoteId}"]`, { timeout: 15000 }).should(
					"contain.text",
					"Issued without a number",
				);
			});
		});
	});

	it('retrying "send" on a legacy, unnumbered credit note (from "send_failed", a real reachable retry) does NOT number it retroactively', () => {
		createAndIssueCreditNote({ issueDate: "2026-09-23" }).then((creditNoteId) => {
			// Simulates: this record was issued before `numbering` existed (no number), and its status
			// happens to be "send_failed" today (a real, reachable status - see
			// credit-note.descriptor.ts's own "Numbering" header on why `onlyFrom: ['draft']` is exactly
			// what refuses to number it even though "send" is available again from here).
			cy.task("makeCreditNoteLegacyUnnumbered", { documentId: creditNoteId, status: "send_failed" });

			cy.request({ url: `${api}/api/documents/${creditNoteId}?typeId=credit-note` })
				.its("body")
				.then((data) => {
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/credit-note/actions/send`,
						body: { documentId: creditNoteId, data: data.data },
					}).then((retry) => {
						expect(retry.status, "the retry is accepted").to.be.oneOf([200, 201]);
					});
				});
			cy.waitForDocumentStatus(`${api}/api/documents/${creditNoteId}?typeId=credit-note`, ["sent"]);

			cy.request({ url: `${api}/api/documents/${creditNoteId}?typeId=credit-note` })
				.its("body")
				.then((after) => {
					expect(after.status, "sent again").to.eq("sent");
					expect(
						after.displayNumber,
						'never numbered after the fact - a number assigned now would not be the one this document was "issued" with',
					).to.be.oneOf([null, undefined]);
				});

			cy.visit(`${appOrigin}/documents/credit-note/${creditNoteId}`);
			cy.get('[data-cy="document-form-number"]').should("contain.text", "Issued without a number");
		});
	});
});
