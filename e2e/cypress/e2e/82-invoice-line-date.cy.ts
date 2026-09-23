export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #145 — an optional `date` per invoice line ("when the work was done"). Fields declared in
 * invoice.descriptor.ts's `lines[]` (kind: 'date', `hideWhenEmpty: true`), rendered through the
 * SAME generic array-field/DatePicker machinery every other line field already uses — no bespoke
 * component. Discipline (`feedback-e2e-ui-driven`): every value is typed through the create wizard's
 * own screen, only what was actually PERSISTED is read back through the API. The PDF's own
 * conditional column rendering is covered in rendering/render-html.spec.ts (jest); the e-invoicing
 * formats' non-leak is covered in formats/shared-build.spec.ts, formats/national/
 * national-lines.spec.ts and formats/providers.spec.ts (jest, against real generated XML) — this
 * spec only proves the screen-to-API round trip.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Invoice line `date` — optional, per-line, on the screen", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("a line with a work date persists and redisplays it; a line with none stays byte-for-byte optional", () => {
		cy.visit("/documents/invoice", { timeout: 20000 });
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");

		// ---- Details step ----
		cy.get('[data-cy="document-field-client-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-client-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-client-input-options"] button').first().click();
		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.pickDate('[data-cy="document-field-dueDate-input"]', "2030-06-15");
		cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();

		cy.continueDocumentWizard(); // Details -> Lines

		// ---- Lines step: row 0 gets a work date, row 1 deliberately does not ----
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("On-site consulting", { force: true });
		cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("3", { force: true });
		cy.get('input[name="lines.0.unit"]').type("day", { force: true });
		cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("800", { force: true });
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.contains('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]', /20\s?%/)
			.first()
			.click();
		// A fixed, unambiguous mid-month day, well before both issueDate (today) and dueDate
		// (2030-06-15 above) — never a "today" coincidence, and never an outside-month grid cell.
		cy.pickDate(
			'[data-cy="document-field-lines-row-0"] [data-cy="document-field-date-input"]',
			"2026-03-10",
		);

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-1"]').should("exist");
		cy.get('input[name="lines.1.description"]').type("Remote support", { force: true });
		cy.get('input[name="lines.1.quantity"]').clear({ force: true }).type("5", { force: true });
		cy.get('input[name="lines.1.unit"]').type("hour", { force: true });
		cy.get('input[name="lines.1.unitPrice"]').clear({ force: true }).type("90", { force: true });
		cy.get('[data-cy="document-field-lines-row-1"] [data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.contains('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]', /20\s?%/)
			.first()
			.click();
		// Row 1's own work date is left untouched on purpose — the field must stay genuinely
		// optional on a PER-LINE basis, not merely "optional on the document as a whole".
		cy.get('[data-cy="document-field-lines-row-1"] [data-cy="document-field-date-input"]').should(
			"contain.text",
			"Pick a date",
		);

		cy.continueDocumentWizard(); // Lines -> Options
		cy.continueDocumentWizard(); // Options -> Summary

		cy.get('[data-cy="document-create-recap-line-count"]', { timeout: 10000 })
			.invoke("text")
			.should("match", /^2 lines?$/);

		// ---- Save, then prove what was PERSISTED — never merely what the form showed ----
		cy.intercept("POST", `${api}/api/documents/types/invoice/actions/save-draft`).as("saveDraft");
		cy.get('[data-cy="document-action-save-draft"]').click();
		cy.wait("@saveDraft").then(({ response }) => {
			expect(response?.statusCode, "save-draft succeeded").to.be.oneOf([200, 201]);
			const id = response?.body?.document?.id as string;
			expect(id, "the invoice was created").to.be.a("string");

			cy.request({ url: `${api}/api/documents/${id}?typeId=invoice` })
				.its("body.data.lines")
				.then((lines: Record<string, unknown>[]) => {
					expect(lines, "both lines survived").to.have.length(2);
					expect(lines[0], "the dated line stored its date verbatim").to.deep.include({
						description: "On-site consulting",
						date: "2026-03-10",
					});
					expect(
						lines[1],
						"the undated line has NO `date` key at all — optional means absent, not an empty string",
					).to.not.have.property("date");
				});

			// ---- Redisplay: reopen the same document and prove BOTH rows still show correctly on
			// screen — the dated row keeps its value, the undated row still reads "Pick a date"
			// rather than inheriting the sibling row's value or crashing on a missing key. ----
			cy.visit("/documents/invoice");
			cy.openDocument(id);
			cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-date-input"]', {
				timeout: 10000,
			}).should("contain.text", "March 10th, 2026");
			cy.get('[data-cy="document-field-lines-row-1"] [data-cy="document-field-date-input"]').should(
				"contain.text",
				"Pick a date",
			);
		});
	});

	it("an invoice with NO line dates at all still saves — the field never became required", () => {
		cy.visit("/documents/invoice", { timeout: 20000 });
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-field-client-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-client-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-client-input-options"] button').first().click();
		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.pickDate('[data-cy="document-field-dueDate-input"]', "2030-06-15");
		cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();

		cy.continueDocumentWizard();

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("Undated line", { force: true });
		cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("1", { force: true });
		cy.get('input[name="lines.0.unit"]').type("unit", { force: true });
		cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("42", { force: true });
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.contains('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]', /20\s?%/)
			.first()
			.click();

		cy.continueDocumentWizard();
		cy.continueDocumentWizard();

		cy.intercept("POST", `${api}/api/documents/types/invoice/actions/save-draft`).as("saveDraft");
		cy.get('[data-cy="document-action-save-draft"]').click();
		cy.wait("@saveDraft").then(({ response }) => {
			expect(response?.statusCode, "a document with no line dates at all still saves").to.be.oneOf([
				200, 201,
			]);
			const id = response?.body?.document?.id as string;

			cy.request({ url: `${api}/api/documents/${id}?typeId=invoice` })
				.its("body.data.lines")
				.then((lines: Record<string, unknown>[]) => {
					expect(lines).to.have.length(1);
					expect(lines[0]).to.not.have.property("date");
				});
		});
	});
});
