export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #494: the PDF a send delivers must not print the transient status "sending".
 *
 * That PDF is rendered inside the send's delivery step, while the record is still "sending", and it
 * used to print "Status: sending". It is the copy the client keeps, the DELIVERY archive an
 * e-signature is bound to (#477) and what the download serves once the document is issued (#490).
 * The rule (`backend/src/modules/documents/rendering/status-line-policy.ts`): a delivered PDF prints
 * no status line at all, and neither does an on-demand render of an issued document; a working copy
 * (a draft) still prints "Status: draft".
 *
 * Every assertion reads real bytes, never the template: the PDF attached to the email the client
 * received (the test Mailpit), the PDF the download endpoint serves afterwards (for a sent document,
 * the DELIVERY archive: byte-identical to the attachment), and the Factur-X built for the invoice.
 * The text is read with `pdf-parse` in the Node process (`extractPdfText`).
 *
 * Mail is looked up by this run's own recipient addresses, never through `cy.getLastEmail`/
 * `cy.clearEmails`, so another spec's or another stack's mail can neither satisfy nor be deleted by
 * this one. `mailpitUrl` defaults to the e2e stack's usual `localhost:8025`.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const mailpit = Cypress.env("mailpitUrl") || "http://localhost:8025";
const RUN = Date.now();

const recipient = (kind: string) => `delivered-pdf-494-${kind}-${RUN}@example.com`;

/** The raw status id the delivery render used to print; never a translated label. No trailing word
 *  boundary: `pdf-parse` glues the next header cell on ("Status: sendingDate: ..."). */
const TRANSIENT = /sending/i;
/** The status line's own label, as the English chrome prints it (`pdf-chrome-strings.ts`). */
const STATUS_LINE = /Status:/;

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
				address: "1 Rue de la Livraison",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			const id = res.body?.id as string;
			expect(id, "client created").to.be.a("string");
			return id;
		});
}

function saveDraft(typeId: string, data: Record<string, unknown>): Cypress.Chainable<string> {
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/${typeId}/actions/save-draft`, body: { data } })
		.then((res) => {
			const id = res.body?.document?.id as string;
			expect(id, `${typeId} draft created`).to.be.a("string");
			return id;
		});
}

function send(typeId: string, id: string, data: Record<string, unknown>, params?: Record<string, unknown>) {
	cy.request({
		method: "POST",
		url: `${api}/api/documents/types/${typeId}/actions/send`,
		body: { documentId: id, data, ...(params ? { params } : {}) },
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
	cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=${typeId}`, ["sent"]);
}

/** The bytes the download endpoint serves, as base64. */
function downloadPdf(typeId: string, id: string): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/${id}/pdf?typeId=${typeId}`, encoding: "binary" })
		.then((res) => {
			expect(res.status, "PDF downloaded").to.eq(200);
			expect(res.headers["content-type"]).to.include("application/pdf");
			return toBase64(res.body);
		});
}

/** The PDF attached to the one email sent to `to`, as base64. Polls until it has arrived. */
function deliveredAttachment(to: string, attemptsLeft = 40): Cypress.Chainable<string> {
	return cy
		.request({ url: `${mailpit}/api/v1/search`, qs: { query: `to:"${to}"` }, failOnStatusCode: false })
		.then((res) => {
			const messages: { ID: string }[] = res.body?.messages ?? [];
			if (messages.length === 0) {
				expect(attemptsLeft, `an email to ${to}`).to.be.greaterThan(0);
				cy.wait(500);
				return deliveredAttachment(to, attemptsLeft - 1);
			}
			expect(messages, `exactly one email to ${to}`).to.have.length(1);
			return cy.request(`${mailpit}/api/v1/message/${messages[0].ID}`).then((message) => {
				const attachments: { PartID: string; ContentType: string }[] = message.body?.Attachments ?? [];
				expect(attachments, "the delivered PDF is attached").to.have.length(1);
				expect(attachments[0].ContentType).to.eq("application/pdf");
				return cy
					.request({
						url: `${mailpit}/api/v1/message/${messages[0].ID}/part/${attachments[0].PartID}`,
						encoding: "binary",
					})
					.then((part) => toBase64(part.body));
			});
		});
}

function expectNoStatusLine(text: string, what: string) {
	expect(text, `${what} carries the document`).to.match(/\S/);
	expect(text, `${what} prints no transient "sending"`).not.to.match(TRANSIENT);
	expect(text, `${what} prints no status line at all`).not.to.match(STATUS_LINE);
}

/**
 * The delivered attachment, then the download of the now-sent document: the same bytes (the DELIVERY
 * archive, #490), and no status line in them.
 */
function expectDeliveredCopyWithoutStatus(typeId: string, id: string, to: string, number: string) {
	deliveredAttachment(to).then((delivered) => {
		pdfText(delivered).then((text) => {
			expect(text, "the delivered PDF is this document").to.contain(number);
			expectNoStatusLine(text, `the ${typeId} PDF the client received`);
		});
		downloadPdf(typeId, id).then((downloaded) => {
			expect(downloaded, "the download serves the archived delivered bytes, byte for byte").to.eq(delivered);
		});
	});
	cy.request({ url: `${api}/api/documents/${id}/archives?typeId=${typeId}` })
		.its("body")
		.should("have.length", 1);
}

function displayNumberOf(typeId: string, id: string): Cypress.Chainable<string> {
	return cy.request({ url: `${api}/api/documents/${id}?typeId=${typeId}` }).then((res) => {
		const number = res.body?.displayNumber as string;
		expect(number, `the sent ${typeId} is numbered`).to.be.a("string").and.not.be.empty;
		return number;
	});
}

describe("A delivered PDF prints no transient status (issue #494)", () => {
	before(() => {
		cy.resetAndSeed();
		// The invoice is delivered by email, the simplest transport to make succeed (see 34).
		cy.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: "email" } })
			.its("status")
			.should("be.oneOf", [200, 201]);
	});

	beforeEach(() => {
		cy.login();
	});

	it("a sent invoice: the emailed PDF, its archive and its Factur-X print no status", () => {
		const to = recipient("invoice");
		createClient("Delivered PDF Invoice Client", to).then((clientId) => {
			const data = {
				client: clientId,
				// Before 2026-09-01: the French e-invoicing mandate refuses "email" for a domestic
				// invoice issued on or after it (32-channel-mandate.cy.ts), and this test needs email.
				issueDate: "2026-08-31",
				dueDate: "2026-09-30",
				currency: "EUR",
				lines: [{ description: "Delivered invoice line 494", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" }],
			};
			saveDraft("invoice", data).then((id) => {
				send("invoice", id, data);
				displayNumberOf("invoice", id).then((number) => {
					expectDeliveredCopyWithoutStatus("invoice", id, to, number);

					// The Factur-X is the invoice's legal e-invoice form, the PDF an e-invoicing transport
					// delivers; built here through the format export, from the same provider.
					cy.request({
						url: `${api}/api/documents/${id}/formats/facturx?typeId=invoice`,
						encoding: "binary",
						timeout: 60000,
					}).then((res) => {
						expect(res.status, "Factur-X built").to.eq(200);
						pdfText(toBase64(res.body)).then((text) => {
							expect(text, "the Factur-X is this invoice").to.contain(number);
							expectNoStatusLine(text, "the invoice's Factur-X");
						});
					});
				});
			});
		});
	});

	it("a sent quote: the emailed PDF and its archive print no status", () => {
		const to = recipient("quote");
		createClient("Delivered PDF Quote Client", to).then((clientId) => {
			const data = {
				client: clientId,
				issueDate: new Date().toISOString().slice(0, 10),
				currency: "EUR",
				lines: [{ description: "Delivered quote line 494", quantity: 1, unitPrice: 100, vatRate: "20" }],
			};
			saveDraft("quote", data).then((id) => {
				send("quote", id, data, { recipient: to });
				displayNumberOf("quote", id).then((number) => expectDeliveredCopyWithoutStatus("quote", id, to, number));
			});
		});
	});

	it("a sent purchase order: the emailed PDF and its archive print no status", () => {
		const to = recipient("purchase-order");
		createClient("Delivered PDF Supplier", to).then((supplierId) => {
			const data = {
				supplier: supplierId,
				issueDate: new Date().toISOString().slice(0, 10),
				currency: "EUR",
				lines: [{ description: "Delivered order line 494", quantity: 2, unitPrice: 50, vatRate: "20" }],
			};
			saveDraft("purchase-order", data).then((id) => {
				send("purchase-order", id, data, { recipient: to });
				displayNumberOf("purchase-order", id).then((number) =>
					expectDeliveredCopyWithoutStatus("purchase-order", id, to, number),
				);
			});
		});
	});

	it("an issued credit note (its send delivers nothing): the PDF downloaded for the client prints no status", () => {
		const data = {
			issueDate: "2026-09-20",
			currency: "EUR",
			reason: "Refund of an overpayment, issue 494.",
			lines: [{ description: "Refund 494", quantity: 1, unitPrice: 42, vatRate: "0" }],
		};
		saveDraft("credit-note", data).then((id) => {
			send("credit-note", id, data);
			displayNumberOf("credit-note", id).then((number) => {
				downloadPdf("credit-note", id).then((pdf) =>
					pdfText(pdf).then((text) => {
						expect(text, "the credit note PDF is this credit note").to.contain(number);
						expectNoStatusLine(text, "the issued credit note's PDF");
					}),
				);
			});
		});
	});

	it("a credit note correcting a sent invoice: its Factur-X embeds the credit note's own page, with no status", () => {
		createClient("Credit Note Factur-X Client", recipient("credit-note-facturx")).then((clientId) => {
			const invoiceData = {
				client: clientId,
				issueDate: "2026-08-31",
				dueDate: "2026-09-30",
				currency: "EUR",
				lines: [{ description: "Corrected line 494", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" }],
			};
			saveDraft("invoice", invoiceData).then((invoiceId) => {
				send("invoice", invoiceId, invoiceData);
				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` }).then((invoice) => {
					const rowId = invoice.body.data.lines[0].$rowId as string;
					expect(rowId, "the invoice line carries a stable row id").to.be.a("string");
					const creditNoteData = {
						invoice: invoiceId,
						correctedLines: [rowId],
						issueDate: "2026-09-20",
						currency: "EUR",
						reason: "Corrected line 494 refunded.",
					};
					// Issue #472: the credit note's Factur-X embeds the credit note's OWN human page, rendered
					// by `facturx-provider.ts` with the credit note's descriptor, as the delivered legal copy.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/credit-note/actions/save-draft`,
						body: { data: creditNoteData },
					}).then((saved) => {
						const id = saved.body?.document?.id as string;
						expect(id, "credit note draft created").to.be.a("string");
						send("credit-note", id, saved.body?.document?.data);
						displayNumberOf("credit-note", id).then((number) => {
							cy.request({
								url: `${api}/api/documents/${id}/formats/facturx?typeId=credit-note`,
								encoding: "binary",
								timeout: 60000,
							}).then((res) => {
								expect(res.status, "credit note Factur-X built").to.eq(200);
								pdfText(toBase64(res.body)).then((text) => {
									expect(text, "the embedded page is the credit note's own").to.contain(number);
									expectNoStatusLine(text, "the credit note's Factur-X");
								});
							});
						});
					});
				});
			});
		});
	});

	it('a draft still prints "Status: draft": the working copy keeps its warning', () => {
		createClient("Working Copy Client", recipient("draft")).then((clientId) => {
			saveDraft("quote", {
				client: clientId,
				issueDate: new Date().toISOString().slice(0, 10),
				currency: "EUR",
				lines: [{ description: "Draft line 494", quantity: 1, unitPrice: 10, vatRate: "20" }],
			}).then((id) => {
				downloadPdf("quote", id).then((pdf) =>
					pdfText(pdf).then((text) => {
						expect(text, "the draft's PDF").to.contain("Draft line 494");
						expect(text, "the working copy says it is a draft").to.match(/Status:\s*draft/);
					}),
				);
			});
		});
	});
});
