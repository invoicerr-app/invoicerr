export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #499: an issued credit note is archived at issuance and delivered to the client.
 *
 * A credit note is an invoice in law (CGI art. 289, I, 5): it has to reach the client and be kept
 * unaltered. Its "send" used to do neither (`credit-note-actions.ts`, `deliver: async () => ({ message:
 * undefined })`): nothing was archived, so every download re-rendered it with whatever branding and
 * template the company had that day, and nobody received it.
 *
 * Every assertion reads real bytes: the PDF attached to the email the client's mailbox received (the
 * test Mailpit, looked up by this run's own recipient address, never through `cy.clearEmails`, so
 * another spec's or another stack's mail can neither satisfy nor be deleted by this one), and the PDF
 * the download endpoint serves before and after the company's branding changes.
 *
 * Dates: the company delivers invoices by email, and France's e-invoicing mandate refuses email for a
 * domestic invoice issued on or after 2026-09-01 (32-channel-mandate.cy.ts). A credit note is issued
 * under the same rule, evaluated against its OWN issue date, which the last test below pins.
 */
// Both from `cypress.config.ts` (VITE_BACKEND_URL, MAILPIT_URL): never a literal port (issue #502).
const api = Cypress.env("apiUrl");
const mailpit = Cypress.env("mailpitUrl");
const RUN = Date.now();

const PRE_MANDATE = "2026-08-31";

/**
 * The credited amount, priced from the corrected invoice's row (issue #507, PR #508): the invoice has
 * two lines, the credit note corrects only the first, 1 x 120.00 at 20% VAT = 144.00 gross. The
 * invoice's own gross (240.00) and the pre-#507 "0.00" are both wrong answers.
 */
const CREDITED_GROSS = "144.00 EUR";
const INVOICE_GROSS = "240.00 EUR";

/** France's fixed credit-note format (issue #496, `countries/data/fr.json (section "policy")`): "CN-{year}-{number:4}",
 *  its own series, counted from 1 after `resetAndSeed`. The linked note is issued first, the free one
 *  second; the refused one consumes no number. */
const FIRST_CREDIT_NOTE = "CN-2026-0001";
const SECOND_CREDIT_NOTE = "CN-2026-0002";

function toBase64(body: unknown): string {
	return Cypress.Buffer.from(body as string, "binary").toString("base64");
}

function pdfText(base64: string): Cypress.Chainable<string> {
	return cy.task("extractPdfText", base64) as Cypress.Chainable<string>;
}

function createClient(name: string, contactEmail: string): Cypress.Chainable<string> {
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
				address: "1 Rue de l'Avoir",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "732829320" }],
			},
		})
		.then((res) => {
			const id = res.body?.id as string;
			expect(id, "client created").to.be.a("string");
			return id;
		});
}

function saveDraft(typeId: string, data: Record<string, unknown>): Cypress.Chainable<{ id: string; data: Record<string, unknown> }> {
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/${typeId}/actions/save-draft`, body: { data } })
		.then((res) => {
			const id = res.body?.document?.id as string;
			expect(id, `${typeId} draft created`).to.be.a("string");
			return { id, data: res.body.document.data as Record<string, unknown> };
		});
}

function sendAndWait(typeId: string, id: string, data: Record<string, unknown>) {
	cy.request({
		method: "POST",
		url: `${api}/api/documents/types/${typeId}/actions/send`,
		body: { documentId: id, data },
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
	cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=${typeId}`, ["sent"]);
}

function displayNumberOf(typeId: string, id: string): Cypress.Chainable<string> {
	return cy.request({ url: `${api}/api/documents/${id}?typeId=${typeId}` }).then((res) => {
		const number = res.body?.displayNumber as string;
		expect(number, `the sent ${typeId} is numbered`).to.be.a("string").and.not.be.empty;
		return number;
	});
}

function downloadPdf(id: string): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/${id}/pdf?typeId=credit-note`, encoding: "binary" })
		.then((res) => {
			expect(res.status, "PDF downloaded").to.eq(200);
			expect(res.headers["content-type"]).to.include("application/pdf");
			return toBase64(res.body);
		});
}

/** The PDF attached to the one email sent to `to` whose subject names `number`, as base64. Polls. */
function deliveredAttachment(to: string, number: string, attemptsLeft = 40): Cypress.Chainable<string> {
	return cy
		.request({
			url: `${mailpit}/api/v1/search`,
			qs: { query: `to:"${to}" subject:"${number}"` },
			failOnStatusCode: false,
		})
		.then((res) => {
			const messages: { ID: string }[] = res.body?.messages ?? [];
			if (messages.length === 0) {
				expect(attemptsLeft, `an email to ${to} carrying ${number}`).to.be.greaterThan(0);
				cy.wait(500);
				return deliveredAttachment(to, number, attemptsLeft - 1);
			}
			expect(messages, `exactly one email to ${to} carrying ${number}`).to.have.length(1);
			return cy.request(`${mailpit}/api/v1/message/${messages[0].ID}`).then((message) => {
				const body = String(message.body?.Text ?? "");
				expect(body, "the email states the credited amount").to.contain(`for a total of ${CREDITED_GROSS}`);
				const attachments: { PartID: string; ContentType: string; FileName: string }[] =
					message.body?.Attachments ?? [];
				expect(attachments, "the credit note PDF is attached").to.have.length(1);
				expect(attachments[0].ContentType).to.eq("application/pdf");
				expect(attachments[0].FileName).to.eq(`${number}.pdf`);
				return cy
					.request({
						url: `${mailpit}/api/v1/message/${messages[0].ID}/part/${attachments[0].PartID}`,
						encoding: "binary",
					})
					.then((part) => toBase64(part.body));
			});
		});
}

/**
 * Byte-for-byte equality of two base64 PDFs, asserted as a boolean: a failing `to.eq` on two
 * multi-kilobyte strings makes Firefox's diff overflow its stack ("too much recursion") instead of
 * reporting the mismatch.
 */
function expectSameBytes(actual: string, expected: string, what: string) {
	expect(actual === expected, `${what} (${actual.length} vs ${expected.length} base64 chars)`).to.eq(true);
}

/** A branding change a fresh render would print: another accent color and font. */
function changeBranding(preset: string) {
	cy.request({ method: "PUT", url: `${api}/api/company/branding`, body: { preset } })
		.its("status")
		.should("eq", 200);
}

function archiveCount(id: string): Cypress.Chainable<number> {
	return cy
		.request({ url: `${api}/api/documents/${id}/archives?typeId=credit-note` })
		.then((res) => (res.body as unknown[]).length);
}

/** An invoice to `to`, sent by email before the mandate date, and the row id of its only line. */
function sentInvoice(to: string, label: string): Cypress.Chainable<{ invoiceId: string; rowId: string }> {
	return createClient(`Credit Note Client ${label}`, to).then((clientId) => {
		const data = {
			client: clientId,
			issueDate: PRE_MANDATE,
			dueDate: "2026-09-30",
			currency: "EUR",
			lines: [
				{ description: `Line corrected ${label}`, quantity: 1, unit: "hour", unitPrice: 120, vatRate: "20" },
				{ description: `Line kept ${label}`, quantity: 1, unit: "hour", unitPrice: 80, vatRate: "20" },
			],
		};
		return saveDraft("invoice", data).then(({ id: invoiceId, data: saved }) => {
			sendAndWait("invoice", invoiceId, saved);
			return cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` }).then((invoice) => {
				const rowId = invoice.body.data.lines[0].$rowId as string;
				expect(rowId, "the invoice line carries a stable row id").to.be.a("string");
				return { invoiceId, rowId };
			});
		});
	});
}

describe("An issued credit note is archived and delivered (issue #499)", () => {
	before(() => {
		cy.resetAndSeed();
		cy.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: "email" } })
			.its("status")
			.should("be.oneOf", [200, 201]);
		changeBranding("classic");
	});

	beforeEach(() => {
		cy.login();
	});

	it("a credit note correcting an invoice reaches the client's mailbox, and the download serves those bytes even after a branding change", () => {
		const to = `credit-note-499-linked-${RUN}@example.com`;
		sentInvoice(to, "499-linked").then(({ invoiceId, rowId }) => {
			saveDraft("credit-note", {
				invoice: invoiceId,
				correctedLines: [rowId],
				issueDate: PRE_MANDATE,
				currency: "EUR",
				reason: "Line refunded, issue 499.",
			}).then(({ id, data }) => {
				sendAndWait("credit-note", id, data);
				displayNumberOf("credit-note", id).then((number) => {
					expect(number, "France's fixed credit-note format").to.eq(FIRST_CREDIT_NOTE);
					deliveredAttachment(to, number).then((delivered) => {
						pdfText(delivered).then((text) => {
							expect(text, "the attachment is this credit note").to.contain(number);
							expect(text, "the attached PDF prints the credited total").to.match(new RegExp(`Total\\s*${CREDITED_GROSS.replace(".", "\\.")}`));
							expect(text, "not the invoice's own total").not.to.contain(INVOICE_GROSS);
						});

						downloadPdf(id).then((downloaded) => {
							expectSameBytes(downloaded, delivered, "the download serves the delivered bytes, byte for byte");
						});
						archiveCount(id).should("eq", 1);

						changeBranding("modern");
						downloadPdf(id).then((downloaded) => {
							expectSameBytes(downloaded, delivered, "a branding change after issuance leaves the issued copy untouched");
						});
					});
				});
			});
		});
	});

	it("a free credit note (no invoice, so no client) is archived at issuance and served unchanged after a branding change", () => {
		changeBranding("classic");
		saveDraft("credit-note", {
			issueDate: PRE_MANDATE,
			currency: "EUR",
			reason: "Goodwill gesture, issue 499.",
			lines: [{ description: "Goodwill 499", quantity: 1, unitPrice: 30, vatRate: "0" }],
		}).then(({ id, data }) => {
			sendAndWait("credit-note", id, data);
			displayNumberOf("credit-note", id).then((number) => {
				expect(number, "the next number of the same series").to.eq(SECOND_CREDIT_NOTE);
				downloadPdf(id).then((issued) => {
					pdfText(issued).then((text) => expect(text, "the issued PDF is this credit note").to.contain(number));
					changeBranding("modern");
					downloadPdf(id).then((later) => {
						expectSameBytes(later, issued, "the issued copy, not a re-render with the new branding");
					});
				});
				archiveCount(id).should("eq", 1);
			});
		});
	});

	it("a credit note is issued on its own date's channel: after the French mandate, email is refused before numbering", () => {
		const to = `credit-note-499-mandate-${RUN}@example.com`;
		sentInvoice(to, "499-mandate").then(({ invoiceId, rowId }) => {
			saveDraft("credit-note", {
				invoice: invoiceId,
				correctedLines: [rowId],
				// After 2026-09-01: CGI art. 289 bis binds a domestic credit note to an accredited
				// platform exactly as it binds an invoice, and this company only has "email".
				issueDate: "2026-09-20",
				currency: "EUR",
				reason: "Issued after the mandate, issue 499.",
			}).then(({ id, data }) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/credit-note/actions/send`,
					body: { documentId: id, data },
					failOnStatusCode: false,
				}).then((res) => {
					expect(res.status, "refused, not issued undelivered").to.eq(501);
					expect(String(res.body?.message)).to.match(/"pdp" channel/);
				});
				cy.request({ url: `${api}/api/documents/${id}?typeId=credit-note` }).then((res) => {
					expect(res.body.status, "still a draft").to.eq("draft");
					expect(res.body.displayNumber ?? null, "no number consumed").to.eq(null);
				});
			});
		});
	});
});
