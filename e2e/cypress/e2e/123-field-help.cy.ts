export {}; // makes this spec a module, not a global script -- see tsconfig.json

const row = '[data-cy="document-field-lines-row-0"]';
const vatRateHelp = `${row} [data-cy="document-field-vatRate-help"]`;
const vatRateTrigger = `${row} [data-cy="document-field-vatRate-help-trigger"]`;
const vatRateContent = '[data-cy="document-field-vatRate-help-content"]';

function startInvoiceAtLines() {
	cy.visit("/documents/invoice", { timeout: 20000 });
	cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
	cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");
	cy.pickDocumentClient();
	cy.pickToday('[data-cy="document-field-issueDate-input"]');
	cy.pickDate('[data-cy="document-field-dueDate-input"]', "2030-06-15");
	cy.pickDocumentFieldOption("currency", "eur");
	cy.get('[data-cy="document-field-lines-add-row"]').click();
	cy.get(row).should("exist");
}

describe("Field help popover", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("shows an invoice line field's description on hover and on tap, never under the field", () => {
		startInvoiceAtLines();

		cy.get(`${row} [data-cy="document-field-vatRate"] p.text-muted-foreground`).should("not.exist");
		cy.get(vatRateContent).should("not.exist");

		cy.get(vatRateHelp)
			.invoke("text")
			.then((description) => {
				expect(description.trim(), "the VAT rate field has a description").not.to.equal("");

				cy.get(vatRateTrigger).trigger("pointerover", { eventConstructor: "PointerEvent", pointerType: "mouse" });
				cy.get(vatRateContent).should("be.visible").and("contain.text", description.trim());
				cy.get(vatRateTrigger).trigger("pointerout", { eventConstructor: "PointerEvent", pointerType: "mouse" });
				cy.get(vatRateContent).trigger("pointerover", { eventConstructor: "PointerEvent", pointerType: "mouse" });
				cy.wait(300);
				cy.get(vatRateContent).should("be.visible");
				cy.get(vatRateContent).trigger("pointerout", { eventConstructor: "PointerEvent", pointerType: "mouse" });
				cy.get(vatRateContent).should("not.exist");

				cy.get(vatRateTrigger).click();
				cy.get(vatRateContent).should("be.visible").and("contain.text", description.trim());
				cy.get("body").type("{esc}");
				cy.get(vatRateContent).should("not.exist");
			});

		cy.get(vatRateHelp)
			.invoke("attr", "id")
			.then((id) => {
				cy.get(`${row} [aria-describedby~="${id}"]`).should("exist");
			});
	});
});
