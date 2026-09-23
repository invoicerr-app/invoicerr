export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #365, "empty line items should not survive a save" (frontend: use-document-form.ts's
 * `pruneEmptyLines`/empty-rows.ts; backend: descriptors/validate.ts's `dropEmptyRows`).
 *
 * Follows `feedback-e2e-ui-driven`: every line is typed through the create wizard's own screen, the
 * only thing read back through the API is what actually got PERSISTED — proving the drop happened,
 * not merely that a row stopped rendering.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Empty line items are dropped on save, a half-filled one is not", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("drops a fully empty line silently, but keeps a half-filled one until it is actually completed", () => {
		cy.visit("/documents/invoice", { timeout: 20000 });
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");

		// ---- Details step: client / issueDate / dueDate / currency (all `required`) ----
		cy.get('[data-cy="document-field-client-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-client-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-client-input-options"] button').first().click();
		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		// A fixed, far-future, mid-month day — never "today" no matter when this runs, and never
		// ambiguous with an outside-month leading/trailing grid cell (see `pickDate`'s own header).
		cy.pickDate('[data-cy="document-field-dueDate-input"]', "2030-06-15");
		cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();

		cy.continueDocumentWizard(); // Details -> Lines

		// ---- Lines step: one REAL line, one left FULLY empty, one HALF-FILLED (price only) ----
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("Full line", { force: true });
		cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("2", { force: true });
		cy.get('input[name="lines.0.unit"]').type("unit", { force: true });
		cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("100", { force: true });
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.contains('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]', /20\s?%/)
			.first()
			.click();

		// Row 1: added via "+ Add line", never touched at all — the exact shape array-field.tsx's own
		// `emptyRow` produces.
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-1"]').should("exist");

		// Row 2: HALF-filled on purpose — only a price typed in, description/quantity/unit/vatRate
		// left blank. This must NOT be silently dropped: it is missing required fields, not empty.
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-2"]').should("exist");
		cy.get('input[name="lines.2.unitPrice"]').clear({ force: true }).type("55", { force: true });

		// ---- First "Continue": the empty row (1) disappears BEFORE validation ever runs; the
		// half-filled row (originally 2, now reindexed to 1) survives but is still missing required
		// fields, so the wizard refuses to advance past "Lines" — proving both halves of the fix at
		// once, on screen, before anything is saved. ----
		cy.get('[data-cy="document-create-dialog-continue"]').click();

		// Still on the Lines step: the per-step gate refused to advance.
		cy.get('[data-cy="document-create-dialog-step-body-lines"]', { timeout: 10000 }).should("exist");
		cy.get('[data-cy="document-create-dialog-step-body-options"]').should("not.exist");

		// Only TWO rows remain — the fully-empty one is gone, not merely invisible-but-still-counted.
		cy.get('[data-cy="document-field-lines-row-2"]').should("not.exist");
		cy.get('[data-cy="document-field-lines-row-1"]').should("exist");
		// The survivor is the SAME half-filled row (its price is still there), not a fresh blank one
		// that happens to occupy the same index.
		cy.get('input[name="lines.1.unitPrice"]').should("have.value", "55");
		// And its still-missing description is what the per-step gate is actually blocking on.
		cy.get('input[name="lines.1.description"]').should("have.value", "");

		// ---- Complete the half-filled row — it was kept precisely so the user still has to finish
		// it, never silently thrown away. ----
		cy.get('input[name="lines.1.description"]').type("Half then completed", { force: true });
		cy.get('input[name="lines.1.quantity"]').clear({ force: true }).type("1", { force: true });
		cy.get('input[name="lines.1.unit"]').type("unit", { force: true });
		cy.get('[data-cy="document-field-lines-row-1"] [data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.contains('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]', /20\s?%/)
			.first()
			.click();

		cy.get('[data-cy="document-create-dialog-continue"]').click();
		cy.get('[data-cy="document-create-dialog-step-body-options"]', { timeout: 10000 }).should("exist");

		cy.continueDocumentWizard(); // Options -> Recap

		// The recap's own line count already reflects exactly two lines, never three — the
		// screen's own account of what is about to be saved.
		cy.get('[data-cy="document-create-recap-line-count"]', { timeout: 10000 })
			.invoke("text")
			.should("match", /^2 lines?$/);

		// ---- Save, then prove what was PERSISTED, independently of what the form showed ----
		cy.intercept("POST", `${api}/api/documents/types/invoice/actions/save-draft`).as("saveDraft");
		cy.get('[data-cy="document-action-save-draft"]').click();
		cy.wait("@saveDraft").then(({ response }) => {
			expect(response?.statusCode, "save-draft succeeded").to.be.oneOf([200, 201]);
			const id = response?.body?.document?.id;
			expect(id, "the invoice was created").to.be.a("string");

			cy.request({ url: `${api}/api/documents?typeId=invoice` })
				.its("body.items")
				.then((docs: { id: string; data: { lines: Record<string, unknown>[] } }[]) => {
					const created = docs.find((doc) => doc.id === id);
					expect(created, "the saved invoice is in the list").to.exist;

					const lines = created?.data.lines ?? [];
					expect(lines, "exactly the two real lines survived — the empty one never persisted").to
						.have.length(2);

					expect(lines[0]).to.deep.include({
						description: "Full line",
						quantity: 2,
						unit: "unit",
						unitPrice: 100,
					});
					expect(lines[1]).to.deep.include({
						description: "Half then completed",
						quantity: 1,
						unit: "unit",
						unitPrice: 55,
					});
				});
		});
	});
});
