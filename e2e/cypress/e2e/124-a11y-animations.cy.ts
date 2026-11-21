export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * `cy.assertAccessible` measures the page at rest: a menu still fading in or out is at partial
 * opacity, which axe reads as low text contrast. The menu's enter and exit animations are replaced
 * here by two-second ones held at 10% opacity, so a check that does not wait always lands mid-animation.
 */
const api = Cypress.env("apiUrl");

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
							issueDate: "2026-08-15",
							dueDate: "2026-09-15",
							currency: "EUR",
							lines: [{ description: "Animated menu", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" }],
						},
					},
				})
				.then((saved) => saved.body.document.id as string),
		);
}

function slowMenuAnimations() {
	cy.document().then((doc) => {
		const style = doc.createElement("style");
		style.textContent = `
			@keyframes held-in { from, to { opacity: 0.1; } }
			@keyframes held-out { from, to { opacity: 0.1; } }
			[data-slot="dropdown-menu-content"][data-state="open"] { animation: held-in 2s linear !important; }
			[data-slot="dropdown-menu-content"][data-state="closed"] { animation: held-out 2s linear !important; }
		`;
		doc.head.appendChild(style);
	});
}

describe("Accessibility check and animations", () => {
	beforeEach(() => {
		cy.login();
	});

	it("waits for a menu to finish fading in", () => {
		createDraftInvoice().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 }).should("exist");
			slowMenuAnimations();
			cy.openDocumentRowMenu(invoiceId);
			cy.assertAccessible({ context: '[data-slot="dropdown-menu-content"]' });
		});
	});

	// Issue #715: Radix's modal menu marked the page behind it (sidebar included) aria-hidden while
	// its buttons stayed focusable. The whole page is measured on purpose: the regression is on a
	// sibling of the menu, not inside it.
	it("passes a whole-page axe check while a row menu is open", () => {
		createDraftInvoice().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 }).should("exist");
			cy.get('[data-cy="sidebar-user-menu-trigger"]', { timeout: 15000 }).should("be.visible");

			cy.openDocumentRowMenu(invoiceId);
			cy.get(`[data-cy="document-row-menu-content-${invoiceId}"]`).should("be.visible");

			cy.assertAccessible();
		});
	});

	it("waits for a menu to finish fading out", () => {
		createDraftInvoice().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 }).should("exist");
			slowMenuAnimations();
			cy.openDocumentRowMenu(invoiceId);
			cy.get(`[data-cy="document-row-action-delete-${invoiceId}"]`).click();
			cy.get(`[data-cy="document-row-delete-confirm-${invoiceId}"]`).should("be.visible");
			cy.assertAccessible();
		});
	});
});
