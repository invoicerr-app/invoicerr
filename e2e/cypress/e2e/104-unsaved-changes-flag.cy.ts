export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #488: the detail page's "Unsaved changes" bar is computed from a subscription that only
 * re-renders the page when the answer flips, instead of a whole-form `useWatch` that re-rendered
 * every field on every keystroke. This spec guards the flag itself, through the screen, on each path
 * that can move it:
 *  1. typing in a line makes the bar appear;
 *  2. undoing back to the saved value makes it disappear, with no click at all;
 *  3. "Discard" makes it disappear and puts the saved value back in the input;
 *  4. adding a line makes it appear, removing that line again makes it disappear;
 *  5. "Save" makes it disappear, the saved record carries the edit, and a reload stays clean.
 *
 * The re-render count itself is not asserted here (a Cypress assertion on React commits would need
 * instrumentation in production code): the PR carries that measurement, before and after.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const DESCRIPTION = "Consulting";
const EDIT = " day";

const bar = '[data-cy="document-unsaved-bar"]';
const description = 'input[name="lines.0.description"]';

function createDraftInvoice(): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) =>
			cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: new Date().toISOString().slice(0, 10),
							dueDate: new Date().toISOString().slice(0, 10),
							currency: "EUR",
							lines: [
								{
									description: DESCRIPTION,
									quantity: 1,
									unit: "day",
									unitPrice: 500,
									vatRate: "20",
								},
								{
									description: "Travel",
									quantity: 1,
									unit: "unit",
									unitPrice: 80,
									vatRate: "20",
								},
							],
						},
					},
				})
				.its("body.document.id"),
		);
}

function openDetail(id: string) {
	cy.visit(`/documents/invoice/${id}`);
	cy.get('[data-cy="document-detail-page"]', { timeout: 20000 }).should("exist");
	cy.get(description, { timeout: 20000 }).should("have.value", DESCRIPTION);
}

describe("Document detail: the unsaved-changes flag (issue #488)", () => {
	let invoiceId: string;

	before(() => {
		cy.resetAndSeed();
		cy.login();
		createDraftInvoice().then((id) => {
			invoiceId = id;
		});
	});

	beforeEach(() => {
		cy.viewport(1280, 720);
		cy.login();
	});

	it("follows typing, undoing, discarding, adding and removing a line", () => {
		openDetail(invoiceId);
		cy.get(bar).should("not.exist");

		// 1. Typing flips it on.
		cy.get(description).type(EDIT);
		cy.get(bar).should("be.visible");

		// 2. Undoing back to the saved value flips it off again, without any click.
		cy.get(description).type("{backspace}".repeat(EDIT.length));
		cy.get(description).should("have.value", DESCRIPTION);
		cy.get(bar).should("not.exist");

		// 3. Discard: the bar goes and the input shows the saved value again.
		cy.get(description).type(EDIT);
		cy.get(bar).should("be.visible");
		cy.get('[data-cy="document-unsaved-discard"]').click();
		cy.get(bar).should("not.exist");
		cy.get(description).should("have.value", DESCRIPTION);

		// 4. A structural change counts too: a new row is unsaved, removing it again is not.
		cy.get('[data-cy="document-field-lines-row-2"]').should("not.exist");
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-2"]').should("exist");
		cy.get('input[name="lines.2.description"]').type("Extra", { force: true });
		cy.get(bar).should("be.visible");
		cy.get('[data-cy="document-field-lines-remove-row-2"]').click({ force: true });
		cy.get('[data-cy="document-field-lines-row-2"]').should("not.exist");
		cy.get(bar).should("not.exist");
	});

	it("clears once saved, and the saved record carries the edit", () => {
		openDetail(invoiceId);
		cy.get(bar).should("not.exist");

		cy.get(description).type(EDIT);
		cy.get(bar).should("be.visible");
		cy.get('[data-cy="document-unsaved-save"]').click();
		cy.get(bar).should("not.exist");
		cy.get(description).should("have.value", `${DESCRIPTION}${EDIT}`);

		cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`)
			.its("body.data.lines.0.description")
			.should("eq", `${DESCRIPTION}${EDIT}`);

		// A fresh mount compares against the new saved data: still clean.
		cy.reload();
		cy.get(description, { timeout: 20000 }).should("have.value", `${DESCRIPTION}${EDIT}`);
		cy.get(bar).should("not.exist");

		// And the new baseline is what "unsaved" is measured against from now on.
		cy.get(description).type("{backspace}");
		cy.get(bar).should("be.visible");
		cy.get(description).type("y");
		cy.get(bar).should("not.exist");
	});
});
