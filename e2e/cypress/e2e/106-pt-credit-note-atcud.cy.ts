export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #497 - a Portuguese credit note carries its own ATCUD.
 *
 * Portaria n.º 195/2020, art. 4.º n.º 1 puts the ATCUD on « todas as faturas e outros documentos
 * fiscalmente relevantes », and Decreto-Lei n.º 28/2019, art. 2.º c) ii) counts a document correcting
 * an invoice as a « fatura ». Its series is registered with the AT under the SAF-T document type of a
 * credit note, NC (Portaria n.º 195/2020, art. 2.º b); Portaria n.º 302/2016, field 4.1.4.8), never
 * under the invoice's FT series. Sources and their reading dates: `country-policy/data/pt.json`, the
 * `atcud-required` numbering facts.
 *
 * Two journeys, on a Portuguese seller:
 *  a) configured through the ATCUD settings screen (credit-note number format, then an NC series
 *     picked in the new "Document type" select), a credit note sent through a real click is numbered
 *     in its own series and carries `ATCUD:<NC code>-<sequential>`, in the API and on its PDF;
 *  b) with only the invoice's FT series registered, sending the credit note is refused (400) BEFORE
 *     any number is spent, and the refusal names the missing NC series.
 */
const api = Cypress.env("apiUrl");
const YEAR = new Date().getFullYear();
const FT_SERIES = `FT ${YEAR}`;
const NC_SERIES = `NC ${YEAR}`;
const FT_CODE = "E2EFTCODE1";
const NC_CODE = "E2ENCCODE1";

function switchSellerToPortugal() {
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
	// The invoice's own ATCUD set-up (already covered by 64-declarations and the pt-de scenario):
	// through the API here, since this spec is about the credit note.
	cy.request({
		method: "PUT",
		url: `${api}/api/company/number-format`,
		body: { typeId: "invoice", pattern: "FT {year}/{number:4}" },
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
	cy.request({
		method: "PUT",
		url: `${api}/api/company/atcud-series`,
		body: { typeId: "invoice", seriesId: FT_SERIES, validationCode: FT_CODE },
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
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

/** Issues a domestic PT invoice (two lines, 23 %) and returns its id and the row id of its second line. */
function issueInvoice(clientId: string) {
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
					expect(invoice.atcud, "the invoice carries its own FT ATCUD").to.match(
						new RegExp(`^ATCUD:${FT_CODE}-\\d+$`),
					);
					return { id, rowId: invoice.data.lines[1].$rowId as string };
				});
		});
}

function saveCreditNoteDraft(invoiceId: string, rowId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: {
				data: {
					invoice: invoiceId,
					correctedLines: [rowId],
					issueDate: `${YEAR}-09-20`,
					currency: "EUR",
					reason: "Formacao cancelada",
				},
			},
		})
		.then((saved) => {
			expect(saved.status, "credit note draft saved").to.be.oneOf([200, 201]);
			return { id: saved.body.document.id as string, data: saved.body.document.data };
		});
}

function creditNotePdfText(id: string): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/${id}/pdf?typeId=credit-note`, encoding: "binary" })
		.then((res) => {
			expect(res.status, "credit note PDF rendered").to.eq(200);
			const base64 = Cypress.Buffer.from(res.body, "binary").toString("base64");
			return cy.task("extractPdfText", base64).then((raw) => String(raw).replace(/\s+/g, " "));
		});
}

describe("Issue #497 - a Portuguese credit note carries its own ATCUD, from its own NC series", () => {
	beforeEach(() => {
		cy.resetAndSeed();
		cy.login();
		// Cypress's default viewport (1000x660): below `lg` the settings nav is a picker, not the
		// `sticky` tile grid, which at 1280x720 covers every control this long page scrolls under it.
		// The screenshots below switch to 1280x720 on purpose, once the interactions are done.
		switchSellerToPortugal();
	});

	it("configured on the ATCUD screen, a credit note sent by a real click gets NC numbering and ATCUD:<NC code>-<sequential>, in the API and on its PDF", () => {
		cy.visit("/settings/atcud");

		// The credit note's own number format, on its own card (the invoice card is untouched).
		cy.get('[data-cy="atcud-credit-note-number-format-input"]', { timeout: 15000 })
			.clear()
			.type("NC {year}/{number:4}", { parseSpecialCharSequences: false });
		cy.get('[data-cy="atcud-credit-note-number-format-status"]').should(
			"contain.text",
			"Compatible with the ATCUD sequential-number rule",
		);
		cy.get('[data-cy="atcud-credit-note-number-format-save-button"]').click();
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Credit note number format saved");
		cy.request({ url: `${api}/api/company/info` })
			.its("body.numberFormats")
			.should("deep.include", { invoice: "FT {year}/{number:4}", "credit-note": "NC {year}/{number:4}" });

		// The NC series, registered as a CREDIT NOTE series through the new "Document type" select.
		cy.openSelect('[data-cy="atcud-series-type-select"]', '[data-cy="atcud-series-type-option-credit-note"]');
		cy.get('[data-cy="atcud-series-type-select"]').should("contain.text", "Credit note (NC)");
		cy.get('[data-cy="atcud-series-id-input"]').should("have.attr", "placeholder", NC_SERIES).type(NC_SERIES);
		cy.get('[data-cy="atcud-validation-code-input"]').type(NC_CODE);
		cy.get('[data-cy="atcud-series-save-button"]').click();
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Series saved");
		cy.request({ url: `${api}/api/company/atcud-series` })
			.its("body")
			.then((rows: { id: string; typeId: string; seriesId: string; validationCode: string }[]) => {
				const nc = rows.find((r) => r.seriesId === NC_SERIES);
				expect(nc, "the NC series is registered as a credit-note series").to.include({
					typeId: "credit-note",
					validationCode: NC_CODE,
				});
				cy.get(`[data-cy="atcud-series-row-${nc!.id}-type"]`).should("have.text", "Credit note (NC)");
			});

		// Screenshots for the PR (issue #497): the settings screen after, at desktop width, with the sticky
		// tile grid hidden so it does not cover the section. Taken after every interaction above.
		cy.viewport(1280, 720);
		cy.get('[data-cy="settings-nav"]').invoke("attr", "style", "display:none");
		cy.get("[data-sonner-toast]", { timeout: 15000 }).should("not.exist");
		cy.get('[data-cy="atcud-section"]').scrollIntoView();
		cy.wait(300);
		cy.screenshot("497-after-atcud-top", { capture: "viewport" });
		cy.get('[data-cy="atcud-series-list"]').scrollIntoView({ offset: { top: -380, left: 0 } });
		cy.wait(300);
		cy.screenshot("497-after-atcud-series", { capture: "viewport" });

		createPortugueseClient().then((clientId) => {
			issueInvoice(clientId).then((invoice) => {
				saveCreditNoteDraft(invoice.id, invoice.rowId).then((note) => {
					cy.visit("/documents/credit-note");
					cy.get(`[data-cy="document-list-row-${note.id}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Draft");

					// A real click on "Send".
					cy.runDocumentRowAction(note.id, "send");
					cy.get(`[data-cy="document-list-row-${note.id}"]`, { timeout: 20000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					cy.request({ url: `${api}/api/documents/${note.id}?typeId=credit-note` })
						.its("body")
						.then((doc) => {
							expect(doc.status).to.eq("sent");
							expect(doc.displayNumber, "numbered in its own NC series").to.eq(`${NC_SERIES}/0001`);
							expect(doc.atcud, "ATCUD from the NC series' own code and the NC sequential number").to.eq(
								`ATCUD:${NC_CODE}-0001`,
							);
						});

					creditNotePdfText(note.id).then((text) => {
						expect(text, "the ATCUD is printed on the credit note").to.contain(`ATCUD:${NC_CODE}-0001`);
					});
				});
			});
		});
	});

	it("with only the invoice's FT series registered, sending the credit note is refused (400) before any number is spent, naming the NC series", () => {
		cy.request({
			method: "PUT",
			url: `${api}/api/company/number-format`,
			body: { typeId: "credit-note", pattern: "NC {year}/{number:4}" },
		})
			.its("status")
			.should("be.oneOf", [200, 201]);

		createPortugueseClient().then((clientId) => {
			issueInvoice(clientId).then((invoice) => {
				saveCreditNoteDraft(invoice.id, invoice.rowId).then((note) => {
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/credit-note/actions/send`,
						body: { documentId: note.id, data: note.data },
						failOnStatusCode: false,
					}).then((res) => {
						expect(res.status, "refused").to.eq(400);
						expect(String(res.body?.message)).to.contain(
							`No AT validation code is registered for the credit note series "${NC_SERIES}" (SAF-T document type NC)`,
						);
					});

					cy.request({ url: `${api}/api/documents/${note.id}?typeId=credit-note` })
						.its("body")
						.then((doc) => {
							expect(doc.status, "still a draft").to.eq("draft");
							expect(doc.displayNumber ?? null, "no number spent").to.eq(null);
							expect(doc.atcud ?? null).to.eq(null);
						});
				});
			});
		});
	});
});
