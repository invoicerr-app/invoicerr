export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The invoice line's `unit` is a free-text input that suggests common units: a known label is stored
 * as its UN/ECE Rec20 code and shown back as the label, any other text is kept as typed. Also guards
 * the closed VAT rate field against clipping its long labels out of its cell.
 */
const api = Cypress.env("apiUrl");
const row = (index: number) => `[data-cy="document-field-lines-row-${index}"]`;

function startInvoiceAtLines() {
	cy.visit("/documents/invoice", { timeout: 20000 });
	cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
	cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");
	cy.pickDocumentClient();
	cy.pickToday('[data-cy="document-field-issueDate-input"]');
	cy.pickDate('[data-cy="document-field-dueDate-input"]', "2030-06-15");
	cy.pickDocumentFieldOption("currency", "eur");
	cy.continueDocumentWizard();
}

function addLine(index: number, unit: string) {
	cy.get('[data-cy="document-field-lines-add-row"]').click();
	cy.get(row(index)).should("exist");
	cy.get(`input[name="lines.${index}.description"]`).type(`Line ${index}`, { force: true });
	cy.get(`input[name="lines.${index}.quantity"]`).clear({ force: true }).type("2", { force: true });
	cy.get(`input[name="lines.${index}.unit"]`).type(unit, { force: true });
	cy.get(`input[name="lines.${index}.unitPrice"]`).clear({ force: true }).type("50", { force: true });
	cy.get(`${row(index)} [data-cy="document-field-vatRate-input"] button`).first().click({ force: true });
	cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should("be.visible");
	cy.contains('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]', /20\s?%/)
		.first()
		.click();
}

describe("Invoice line `unit` picklist and VAT rate label", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("stores a picked unit as its code and shows its label again, keeps a free value as typed", () => {
		startInvoiceAtLines();
		addLine(0, "Day");
		addLine(1, "sprint");

		cy.get('input[name="lines.0.unit"]')
			.invoke("attr", "list")
			.then((listId) => {
				cy.get(`datalist#${listId} option[value="Day"]`).should("exist");
				cy.get(`datalist#${listId} option[value="Hour"]`).should("exist");
			});

		cy.continueDocumentWizard();
		cy.continueDocumentWizard();

		cy.intercept("POST", `${api}/api/documents/types/invoice/actions/save-draft`).as("saveDraft");
		cy.get('[data-cy="document-action-save-draft"]').click();
		cy.wait("@saveDraft").then(({ response }) => {
			const id = response?.body?.document?.id as string;
			expect(id, "the invoice was created").to.be.a("string");

			cy.request({ url: `${api}/api/documents/${id}?typeId=invoice` })
				.its("body.data.lines")
				.then((lines: Record<string, unknown>[]) => {
					expect(lines[0], "a picked unit is stored as its code").to.have.property("unit", "DAY");
					expect(lines[1], "a free unit is stored as typed").to.have.property("unit", "sprint");
				});

			cy.visit("/documents/invoice");
			cy.openDocument(id);
			cy.get(`${row(0)} input[name="lines.0.unit"]`, { timeout: 10000 }).should("have.value", "Day");
			cy.get(`${row(1)} input[name="lines.1.unit"]`).should("have.value", "sprint");
		});
	});

	it("never clips the closed VAT rate label out of its cell and exposes the full text", () => {
		startInvoiceAtLines();
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		const trigger = `${row(0)} [data-cy="document-field-vatRate-input"] button`;
		cy.get(trigger).first().click({ force: true });

		cy.get('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]').then(($options) => {
			const longest = [...$options].reduce((a, b) => (b.textContent!.length > a.textContent!.length ? b : a));
			const label = longest.textContent!.trim();
			cy.wrap(longest).click();
			cy.get(trigger)
				.first()
				.should(($button) => {
					expect($button[0].scrollWidth, "the label stays inside the trigger").to.be.at.most(
						$button[0].clientWidth,
					);
				})
				.find("span[title]")
				.should("have.attr", "title", label);
		});
	});
});
