export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #501 - what a Portuguese seller actually declares to the AT.
 *
 * The backend's `pt-at` provider posts a SOAP `RegisterInvoiceRequest` to the AT webservice after a
 * document is sent. Here that webservice is `cypress.config.ts#startFakeAt`, a local HTTPS server the
 * seller's `pt-at` channel is pointed at, so this spec reads the exact payload the AT would receive:
 *
 *  - an invoice sent by a real click is declared with its OWN ATCUD, `<code>-<sequential>` (Portaria
 *    n.º 195/2020, art. 3.º n.º 2), the same code the invoice carries in the API, never the literal
 *    "0" this provider used to send;
 *  - a credit note correcting it, sent by a real click, is declared too (Decreto-Lei n.º 198/2012,
 *    art. 1.º n.º 2 extends the communication to « documentos retificativos de fatura »): InvoiceType
 *    "NC", its own NC ATCUD, `DebitCreditIndicator` "D" and a `Reference` to the invoice's own number
 *    (e-Fatura webservice manual, fields 1.6.4, 1.6.14.3, 1.6.14.4);
 *  - both declarations are shown, accepted, on the Declarations screen.
 *
 * Sources and reading dates: `backend/src/modules/documents/reporting/data/pt.json`.
 */
const api = Cypress.env("apiUrl");
const YEAR = new Date().getFullYear();
const FT_CODE = "E2EFTCODE1";
const NC_CODE = "E2ENCCODE1";
const INVOICE_NUMBER = `FT ${YEAR}/0001`;
const CREDIT_NOTE_NUMBER = `NC ${YEAR}/0001`;

/** Every `<doc:name>` value in one SOAP body, in document order. */
function fieldValues(body: string, name: string): string[] {
	return Array.from(body.matchAll(new RegExp(`<doc:${name}>([^<]*)</doc:${name}>`, "g")), (m) => m[1]);
}

/** Polls the fake AT until it has received the request declaring `invoiceNo` (the report job runs
 *  asynchronously after "send", `report-job.ts`), then yields that request's body. */
function declaredBodyFor(invoiceNo: string, attemptsLeft = 40): Cypress.Chainable<string> {
	return cy.task<string[]>("getFakeAtRequests").then((bodies) => {
		const body = bodies.find((b) => fieldValues(b, "InvoiceNo").includes(invoiceNo));
		if (!body && attemptsLeft > 0) {
			cy.wait(500);
			return declaredBodyFor(invoiceNo, attemptsLeft - 1);
		}
		expect(body, `the AT received a declaration for ${invoiceNo}`).to.be.a("string");
		return cy.wrap(body as string);
	});
}

/** Polls `GET /documents/declarations` until the declaration of `documentId` is journaled. */
function declarationFor(documentId: string, attemptsLeft = 40): Cypress.Chainable<any> {
	return cy.request({ url: `${api}/api/documents/declarations` }).then((res) => {
		const found = (res.body?.declarations ?? []).find((d: any) => d.documentId === documentId);
		if (!found && attemptsLeft > 0) {
			cy.wait(500);
			return declarationFor(documentId, attemptsLeft - 1);
		}
		expect(found, `a declaration was journaled for ${documentId}`).to.exist;
		return cy.wrap(found);
	});
}

function configurePortugueseSeller() {
	cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: {
			name: "Acme Corp",
			country: "Portugal",
			countryCode: "PT",
			invoiceTransportId: "email",
			identifiers: [
				{ scheme: "LEGAL_ID", value: "509442661" },
				{ scheme: "VAT", value: "PT509442661" },
			],
		},
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
	for (const [typeId, pattern, seriesId, validationCode] of [
		["invoice", "FT {year}/{number:4}", `FT ${YEAR}`, FT_CODE],
		["credit-note", "NC {year}/{number:4}", `NC ${YEAR}`, NC_CODE],
	]) {
		cy.request({ method: "PUT", url: `${api}/api/company/number-format`, body: { typeId, pattern } })
			.its("status")
			.should("be.oneOf", [200, 201]);
		cy.request({
			method: "PUT",
			url: `${api}/api/company/atcud-series`,
			body: { typeId, seriesId, validationCode },
		})
			.its("status")
			.should("be.oneOf", [200, 201]);
	}
	// The pt-at channel, connected to the fake AT (see `startFakeAt`'s own header). `caPem` is the
	// test-only field that lets the backend trust the fake's self-signed certificate.
	cy.task<{ channelConfig: Record<string, string> }>("startFakeAt").then((fake) => {
		cy.request({
			method: "PUT",
			url: `${api}/api/company/channels/pt-at`,
			body: { environment: "TEST", config: fake.channelConfig, isActive: true },
		})
			.its("status")
			.should("be.oneOf", [200, 201]);
	});
	cy.task("resetFakeAtRequests");
}

function createPortugueseClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Lisboa Consultoria Lda",
				contactEmail: "cliente.pt@example.com",
				address: "Avenida da Liberdade 110",
				postalCode: "1250-096",
				city: "Lisboa",
				country: "Portugal",
				countryCode: "PT",
				currency: "EUR",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "501442600" }],
			},
		})
		.then((res) => {
			expect(res.status, "Portuguese client created").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

function saveInvoiceDraft(clientId: string) {
	const data = {
		client: clientId,
		issueDate: `${YEAR}-09-14`,
		dueDate: `${YEAR}-10-14`,
		currency: "EUR",
		lines: [
			{ description: "Consultoria", quantity: 1, unit: "day", unitPrice: 500, vatRate: "23" },
			{ description: "Formacao cancelada", quantity: 2, unit: "day", unitPrice: 300, vatRate: "23" },
		],
	};
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((saved) => {
			expect(saved.status, "invoice draft saved").to.be.oneOf([200, 201]);
			return saved.body.document.id as string;
		});
}

/** Sends `documentId` through a real click on its row's "Send" action and waits for "Sent". */
function sendByClick(typeId: string, documentId: string) {
	cy.visit(`/documents/${typeId}`);
	cy.get(`[data-cy="document-list-row-${documentId}"]`, { timeout: 15000 })
		.find('[data-cy="document-status-badge"]')
		.should("contain.text", "Draft");
	cy.runDocumentRowAction(documentId, "send");
	cy.get(`[data-cy="document-list-row-${documentId}"]`, { timeout: 20000 })
		.find('[data-cy="document-status-badge"]')
		.should("contain.text", "Sent");
}

describe("Issue #501 - a Portuguese invoice is declared with its real ATCUD, and its credit note is declared too", () => {
	beforeEach(() => {
		cy.resetAndSeed();
		cy.login();
		configurePortugueseSeller();
	});

	it("the AT receives the invoice's own ATCUD, then the credit note as NC with D and a Reference to the invoice; both show as accepted", () => {
		createPortugueseClient().then((clientId) => {
			saveInvoiceDraft(clientId).then((invoiceId) => {
				sendByClick("invoice", invoiceId);

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((invoice) => {
						expect(invoice.displayNumber).to.eq(INVOICE_NUMBER);
						expect(invoice.atcud, "the invoice's own ATCUD, as printed").to.eq(`ATCUD:${FT_CODE}-0001`);
						const correctedRowId = invoice.data.lines[1].$rowId as string;

						// PROOF 1: the invoice's declared payload carries that same code, without the printed
						// "ATCUD:" prefix, never "0".
						declaredBodyFor(INVOICE_NUMBER).then((body) => {
							expect(fieldValues(body, "ATCUD"), "declared ATCUD").to.deep.eq([`${FT_CODE}-0001`]);
							expect(fieldValues(body, "InvoiceType")).to.deep.eq(["FT"]);
							expect(fieldValues(body, "DebitCreditIndicator")).to.deep.eq(["C"]);
							expect(fieldValues(body, "Reference"), "an invoice references nothing").to.deep.eq([]);
						});
						declarationFor(invoiceId).its("statusCode").should("eq", "ACCEPTED");

						// The credit note corrects the invoice's second line.
						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/credit-note/actions/save-draft`,
							body: {
								data: {
									invoice: invoiceId,
									correctedLines: [correctedRowId],
									issueDate: `${YEAR}-09-20`,
									currency: "EUR",
									reason: "Formacao cancelada",
								},
							},
						}).then((saved) => {
							expect(saved.status, "credit note draft saved").to.be.oneOf([200, 201]);
							const noteId = saved.body.document.id as string;
							sendByClick("credit-note", noteId);

							cy.request({ url: `${api}/api/documents/${noteId}?typeId=credit-note` })
								.its("body")
								.then((note) => {
									expect(note.displayNumber).to.eq(CREDIT_NOTE_NUMBER);
									expect(note.atcud).to.eq(`ATCUD:${NC_CODE}-0001`);
								});

							// PROOF 2: the credit note is declared, as a credit note correcting that invoice.
							declaredBodyFor(CREDIT_NOTE_NUMBER).then((body) => {
								expect(fieldValues(body, "InvoiceType"), "declared as a credit note").to.deep.eq(["NC"]);
								expect(fieldValues(body, "ATCUD"), "its own NC ATCUD").to.deep.eq([`${NC_CODE}-0001`]);
								expect(fieldValues(body, "DebitCreditIndicator"), "booked to debit").to.deep.eq(["D"]);
								expect(fieldValues(body, "Reference"), "references the corrected invoice").to.deep.eq([
									INVOICE_NUMBER,
								]);
								// Only the corrected line (2 x 300), with the invoice's 23 % VAT.
								expect(fieldValues(body, "Amount")).to.deep.eq(["600.00"]);
								expect(fieldValues(body, "NetTotal")).to.deep.eq(["600.00"]);
								expect(fieldValues(body, "TaxPayable")).to.deep.eq(["138.00"]);
								expect(fieldValues(body, "GrossTotal")).to.deep.eq(["738.00"]);
								expect(fieldValues(body, "CustomerTaxID"), "the invoice's buyer").to.deep.eq(["501442600"]);
							});
							declarationFor(noteId).then((declaration) => {
								expect(declaration.statusCode).to.eq("ACCEPTED");
								expect(declaration.typeId).to.eq("credit-note");
								expect(declaration.displayNumber).to.eq(CREDIT_NOTE_NUMBER);
							});

							// PROOF 3: the screen lists both declarations, accepted.
							cy.visit("/dashboard");
							cy.get('[data-cy="sidebar-declarations-link"]', { timeout: 15000 }).click();
							cy.get('[data-cy="declarations-table"]', { timeout: 20000 }).should("be.visible");
							for (const number of [INVOICE_NUMBER, CREDIT_NOTE_NUMBER]) {
								cy.contains('[data-cy^="declaration-row-"]', number)
									.find('[data-cy="declaration-status-badge"]')
									.should("contain.text", "Accepted");
							}
						});
					});
			});
		});
	});

	// pt-at now carries two facts (invoice, credit note) and the Channels screen shows one row per
	// provider: that row must keep describing the invoice's obligation (DL 198/2012 art. 3.º n.º 1), as
	// before issue #501, rather than whichever fact came last.
	it("the Channels screen still describes pt-at by the invoice's obligation, once", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-pt-at"]', { timeout: 20000 })
			.should("have.length", 1)
			.and("contain.text", 'Artigo 3.º ("Comunicação dos elementos das faturas"), n.º 1')
			.and("not.contain.text", 'Artigo 1.º ("Objeto")');
	});
});
