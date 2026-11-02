export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #758 - the import form's pre-fill warnings sit behind a help button.
 *
 * The upload and form dialogs were only ever opened for screenshots by
 * `112-import-historical-documents.cy.ts`; no spec asserted anything accessible about either, so a
 * green suite said nothing about them. This spec opens both for real, checks the dialog semantics
 * and the "?" trigger (focusable, aria-describedby), and runs axe on each open dialog.
 *
 * `factur-x-minimum.pdf` is the pre-fill suite's own MINIMUM sample: it has a header but no lines,
 * so it produces warnings, which is the state this spec needs to measure.
 */
const UPLOAD_DIALOG = '[data-cy="import-document-upload-dialog"]';
const FORM_DIALOG = '[data-cy="import-document-form-dialog"]';
const WARNINGS = '[data-cy="import-document-prefill-warnings"]';
const WARNINGS_HELP = '[data-cy="import-document-prefill-warnings-help"]';
const WARNINGS_TRIGGER = '[data-cy="import-document-prefill-warnings-help-trigger"]';
const WARNINGS_CONTENT = '[data-cy="import-document-prefill-warnings-help-content"]';

describe("Import dialog accessibility", () => {
	beforeEach(() => {
		cy.login();
		cy.viewport(1440, 900);
	});

	it("measures the upload dialog, then the form dialog with its pre-fill warnings", () => {
		cy.visit("/documents/invoice");
		cy.get('[data-cy="import-document-button-invoice"]', { timeout: 30000 }).click();

		cy.get(UPLOAD_DIALOG, { timeout: 10000 }).should("be.visible");
		cy.get(UPLOAD_DIALOG).should("have.attr", "role", "dialog");
		cy.get(UPLOAD_DIALOG).should("have.attr", "aria-labelledby");
		cy.get(UPLOAD_DIALOG).should("have.attr", "aria-describedby");
		cy.assertAccessible({ context: UPLOAD_DIALOG });
		cy.task("logStep", "axe upload dialog: 0 serious/critical violations (cy.assertAccessible passed)");

		cy.get('[data-cy="import-document-file-input"]').selectFile(
			"cypress/fixtures/import-historical/factur-x-minimum.pdf",
			{ force: true },
		);

		cy.get(FORM_DIALOG, { timeout: 30000 }).should("be.visible");
		cy.get(WARNINGS).should("be.visible").and("contain.text", "Check before importing:");
		cy.get(WARNINGS_HELP)
			.should("contain.text", "carries no invoice lines")
			.and("have.attr", "id")
			.then((id) => {
				cy.get(WARNINGS_TRIGGER)
					.should("be.visible")
					.and("have.attr", "aria-describedby", id);
			});

		// The "?" is a real button (focusable) and opens the warnings' text.
		cy.get(WARNINGS_TRIGGER).focus();
		cy.focused().should("have.attr", "data-cy", "import-document-prefill-warnings-help-trigger");
		cy.get(WARNINGS_TRIGGER).click();
		cy.get(WARNINGS_CONTENT)
			.should("be.visible")
			.and("contain.text", "carries no invoice lines");
		cy.assertAccessible({ context: FORM_DIALOG });
		cy.task("logStep", "axe form dialog: 0 serious/critical violations (cy.assertAccessible passed)");

		cy.get(WARNINGS_TRIGGER).click();
		cy.get(WARNINGS_CONTENT).should("not.exist");

		cy.task("logStep", "import dialogs: axe clean, pre-fill warnings described by the help button");
	});
});
