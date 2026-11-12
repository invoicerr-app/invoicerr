export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * A document page's action row (custom buttons, the "Actions" menu, the primary button) keeps every
 * button on the same vertical centre, whether or not the primary button carries a transition
 * caption below it.
 */
const api = Cypress.env("apiUrl");

function expectActionRowAligned(): void {
	cy.get('[data-cy="document-actions-menu"]', { timeout: 15000 }).should("be.visible");
	cy.get('[data-cy="document-detail-actions"]').then(($row) => {
		const menu = $row.find('[data-cy="document-actions-menu"]')[0].getBoundingClientRect();
		const menuCentre = menu.top + menu.height / 2;
		const buttons = $row.find("button:visible").toArray();
		expect(buttons.length, "the row holds the menu and at least one other button").to.be.greaterThan(1);
		for (const button of buttons) {
			const rect = button.getBoundingClientRect();
			expect(
				Math.abs(rect.top + rect.height / 2 - menuCentre),
				`${button.textContent?.trim()} centred with the Actions menu`,
			).to.be.lessThan(3);
		}
	});
}

function saveDraft(typeId: string, data: Record<string, unknown>): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) =>
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/${typeId}/actions/save-draft`,
				body: { data: { client: clients[0].id, ...data } },
			}),
		)
		.then((saved) => {
			expect(saved.status, `${typeId} draft saved`).to.be.oneOf([200, 201]);
			return saved.body.document.id as string;
		});
}

describe("Document page action row alignment", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 800);
	});

	it("a draft quote's captioned primary button lines up with the Actions menu", () => {
		saveDraft("quote", {
			issueDate: "2026-08-30",
			currency: "EUR",
			lines: [{ description: "Conseil", quantity: 1, unitPrice: 500 }],
		}).then((quoteId) => {
			cy.visit("/documents/quote");
			cy.openDocument(quoteId);
			cy.get('[data-cy="document-transition-hint-send"]', { timeout: 10000 }).should("be.visible");
			expectActionRowAligned();
		});
	});

	it("a draft invoice's action row lines up the same way", () => {
		saveDraft("invoice", {
			issueDate: "2026-09-15",
			dueDate: "2026-10-15",
			currency: "EUR",
			lines: [{ description: "Conseil", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
		}).then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.openDocument(invoiceId);
			expectActionRowAligned();
		});
	});
});
