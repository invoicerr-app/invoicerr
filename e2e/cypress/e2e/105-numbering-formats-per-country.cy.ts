export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #496 - document number formats are fixed per country and document type, not user-editable.
 *
 * The seeded company is switched to Italy, where FatturaPA's <Numero> holds at most 20 characters and
 * the old shared credit-note default ("CREDIT-NOTE-2026-0001", 21) made a TD04 impossible with default
 * settings. Three journeys, against the real API and screen:
 *  a) Settings > Company shows the Italian formats READ-ONLY - the pattern, the next number, where it
 *     comes from and the rule that constrains it - and offers no input to change them.
 *  b) the API refuses a change (405, saying why) and nothing changes.
 *  c) with default settings, an Italian credit note is numbered in the Italian format and downloads as
 *     a TD04 FatturaPA file the real XSD gate accepts.
 *  d) a company that started series BEFORE #496 (the state the migration leaves, set up by a DB task
 *     since no API can write it any more): a compliant running series is kept and shown as such; the
 *     old 21-character credit-note series gives way to the Italian format, the screen says why, and
 *     the counter goes on without a gap.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface NumberFormatRow {
	typeId: string;
	pattern: string;
	source: string;
	nextNumber: number;
	nextDisplayNumber: string;
	constraints: { id: string }[];
}

function switchCompanyToItaly() {
	// Same "mutate the seeded company, never create a second one" convention 64-declarations.cy.ts
	// holds for Portugal. VAT + LEGAL_ID: the pair 31-national-channels.cy.ts already uses for an
	// Italian seller, which fatturapa-provider.ts reads off the company.
	cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: {
			name: "Acme Corp",
			country: "Italy",
			countryCode: "IT",
			currency: "EUR",
			invoiceTransportId: "email",
			identifiers: [
				{ scheme: "VAT", value: "IT01234567897" },
				{ scheme: "LEGAL_ID", value: "11223344554" },
			],
		},
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
}

/** A business buyer in France: outside Italy's domestic SdI mandate (`scope.parties: domestic`), so
 *  the invoice can be sent by email, and a real VAT number for the reverse-charge treatment. */
function createFrenchBuyer() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Acheteur Lyon SAS",
				contactEmail: "acheteur@example.com",
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "3 Rue de l'Avoir",
				city: "Lyon",
				postalCode: "69001",
				isActive: true,
				type: "COMPANY",
				identifiers: [
					{ scheme: "LEGAL_ID", value: "73282932000074" },
					{ scheme: "VAT", value: "FR44732829320" },
				],
			},
		})
		.then((res) => {
			expect(res.status, "client created").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

function sendDocument(typeId: string, data: Record<string, unknown>) {
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/${typeId}/actions/save-draft`, body: { data } })
		.then((saved) => {
			expect(saved.status, `${typeId} draft saved`).to.be.oneOf([200, 201]);
			const id = saved.body?.document?.id as string;
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/${typeId}/actions/send`,
				body: { documentId: id, data: saved.body?.document?.data },
			})
				.its("status")
				.should("be.oneOf", [200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=${typeId}`, ["sent"]);
			return cy.request({ url: `${api}/api/documents/${id}?typeId=${typeId}` }).its("body");
		});
}

/** An Italian invoice of two lines to the French buyer, then a credit note correcting its second line. */
function issueItalianInvoiceAndCreditNote(clientId: string) {
	return sendDocument("invoice", {
		client: clientId,
		issueDate: "2026-09-10",
		dueDate: "2026-10-10",
		currency: "EUR",
		lines: [
			{ description: "Consulenza", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "22" },
			{ description: "Formazione annullata", quantity: 2, unit: "day", unitPrice: 300, vatRate: "22" },
		],
	}).then((invoice) => {
		const rowId = invoice.data.lines[1].$rowId as string;
		return sendDocument("credit-note", {
			invoice: invoice.id,
			correctedLines: [rowId],
			issueDate: "2026-09-20",
			currency: "EUR",
			reason: "Formazione annullata",
		}).then((note) => ({ invoice, note }));
	});
}

describe("Issue #496 - number formats are fixed per country and document type", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		switchCompanyToItaly();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 900);
	});

	it("Settings > Company shows the Italian formats read-only, with the next number and the rule behind each", () => {
		// Below Tailwind's lg breakpoint the sticky, translucent settings nav gives way to a select, so
		// it does not sit over the section in the screenshot below.
		cy.viewport(1000, 900);
		cy.intercept("GET", `${api}/api/company/number-formats`).as("numberFormats");
		cy.visit("/settings/company");
		cy.wait("@numberFormats", { timeout: 15000 }).its("response.statusCode").should("eq", 200);

		cy.get('[data-cy="number-formats-section"]', { timeout: 15000 }).scrollIntoView().should("be.visible");
		cy.get('[data-cy="number-format-credit-note"]').within(() => {
			cy.get('[data-cy="number-format-pattern"]').should("have.text", "CN-{year}-{number:4}");
			cy.get('[data-cy="number-format-next"]').should("contain.text", `CN-${new Date().getFullYear()}-0001`);
			cy.get('[data-cy="number-format-source"]').should("contain.text", "Italy");
			cy.get('[data-cy="number-format-constraint-it-fatturapa-numero-string20"]')
				.should("exist")
				.and("contain.text", "20 Basic Latin characters");
		});
		cy.get('[data-cy="number-format-invoice"]')
			.find('[data-cy="number-format-pattern"]')
			.should("have.text", "INVOICE-{year}-{number:4}");

		// Read-only: none of the three inputs the card used to carry, and nothing editable inside it.
		cy.get('[data-cy="company-quote-number-format-input"]').should("not.exist");
		cy.get('[data-cy="company-invoice-number-format-input"]').should("not.exist");
		cy.get('[data-cy="company-credit-note-number-format-input"]').should("not.exist");
		cy.get('[data-cy="number-formats-section"]').find("input, textarea, select").should("not.exist");

		cy.get('[data-cy="number-formats-section"]').scrollIntoView({ offset: { top: -16, left: 0 } });
		cy.screenshot("496-after-number-formats-read-only", { capture: "viewport" });
	});

	it("the API refuses a change of format (405, saying why) and nothing changes", () => {
		cy.request({
			method: "PUT",
			url: `${api}/api/company/number-format`,
			body: { typeId: "credit-note", pattern: "CREDIT-NOTE-{year}-{number:4}" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "refused").to.eq(405);
			expect(JSON.stringify(res.body)).to.contain("can no longer be changed");
		});

		cy.request({ url: `${api}/api/company/number-formats` })
			.its("body.formats")
			.then((formats: NumberFormatRow[]) => {
				const creditNote = formats.find((f) => f.typeId === "credit-note");
				expect(creditNote, "the credit-note format is still Italy's own").to.include({
					pattern: "CN-{year}-{number:4}",
					source: "country-policy",
				});
			});
	});

	it("with default settings, an Italian credit note is numbered in the Italian format and downloads as a valid TD04", () => {
		const year = new Date().getFullYear();
		createFrenchBuyer().then((clientId) => {
			issueItalianInvoiceAndCreditNote(clientId).then(({ invoice, note }) => {
				expect(note.displayNumber, "the Italian credit-note format").to.eq(`CN-${year}-0001`);
				expect((note.displayNumber as string).length, "fits FatturaPA's <Numero>").to.be.at.most(20);

				cy.request({
					url: `${api}/api/documents/${note.id}/formats/fatturapa?typeId=credit-note`,
					failOnStatusCode: false,
				}).then((res) => {
					expect(res.status, "the FatturaPA file is produced (the XSD gate accepted it)").to.eq(200);
					const xml = String(res.body).replace(/>\s+</g, "><");
					expect(xml).to.contain("<TipoDocumento>TD04</TipoDocumento>");
					expect(xml).to.contain(`<Numero>${note.displayNumber}</Numero>`);
					expect(xml).to.contain(`<IdDocumento>${invoice.displayNumber}</IdDocumento>`);
				});

				cy.visit("/documents/credit-note");
				cy.get(`[data-cy="document-list-row-${note.id}"]`, { timeout: 15000 })
					.should("contain.text", `CN-${year}-0001`)
					// The row title (the corrected invoice's buyer) arrives in a second request.
					.and("contain.text", "Acheteur Lyon SAS")
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Sent");
				cy.screenshot("496-after-italian-credit-note-number", { capture: "viewport" });
			});
		});
	});

	it("a series started before #496: a compliant one is kept, the 21-character credit-note one gives way, and numbering goes on without a gap", () => {
		const year = new Date().getFullYear();
		// What the #496 migration freezes for a company that had numbered quotes under a custom format
		// and credit notes under the old shared default before formats became fixed per country.
		cy.task("setCompanyRunningSeries", {
			email: "john.doe@acme.org",
			runningSeries: { quote: "Q-{year}-{number:5}", "credit-note": "CREDIT-NOTE-{year}-{number:4}" },
		});

		cy.request({ url: `${api}/api/company/number-formats` })
			.its("body.formats")
			.then((formats: (NumberFormatRow & { supersededRunningSeries: { pattern: string } | null })[]) => {
				const quote = formats.find((f) => f.typeId === "quote");
				expect(quote, "a compliant running series is kept").to.include({
					pattern: "Q-{year}-{number:5}",
					source: "running-series",
				});
				const creditNote = formats.find((f) => f.typeId === "credit-note");
				expect(creditNote, "the 21-character series gives way to Italy's own format").to.include({
					pattern: "CN-{year}-{number:4}",
					source: "country-policy",
					// The previous test issued CN-<year>-0001: the counter goes on at 2, never back to 1.
					nextNumber: 2,
				});
				expect(creditNote?.supersededRunningSeries?.pattern).to.eq("CREDIT-NOTE-{year}-{number:4}");
			});

		cy.viewport(1000, 900);
		cy.visit("/settings/company");
		cy.get('[data-cy="number-format-quote"]', { timeout: 15000 }).within(() => {
			cy.get('[data-cy="number-format-pattern"]').should("have.text", "Q-{year}-{number:5}");
			cy.get('[data-cy="number-format-source"]').should("contain.text", "running series");
		});
		cy.get('[data-cy="number-format-credit-note"]').within(() => {
			cy.get('[data-cy="number-format-pattern"]').should("have.text", "CN-{year}-{number:4}");
			cy.get('[data-cy="number-format-next"]').should("contain.text", `CN-${year}-0002`);
			cy.get('[data-cy="number-format-superseded"]')
				.should("contain.text", "CREDIT-NOTE-{year}-{number:4}")
				.and("contain.text", "the limit is 20");
		});
		cy.get('[data-cy="number-formats-section"]').scrollIntoView({ offset: { top: -16, left: 0 } });
		cy.screenshot("496-after-number-formats-running-series", { capture: "viewport" });

		// The next credit note: Italy's format, the counter's next value - no gap, no duplicate.
		createFrenchBuyer().then((clientId) => {
			issueItalianInvoiceAndCreditNote(clientId).then(({ note }) => {
				expect(note.displayNumber, "the counter goes on in the Italian format").to.eq(`CN-${year}-0002`);
			});
		});
	});
});
