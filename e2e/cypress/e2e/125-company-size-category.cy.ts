export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * A French company declares its size category in the company settings, and an SME or a
 * micro-enterprise without an accredited platform can then validate an invoice to a French business
 * client before 2027-09-01. `cy.resetAndSeed()` gives a French company with no transport and a French
 * business client.
 */
const api = Cypress.env("apiUrl");

function createDraftInvoice(issueDate: string): Cypress.Chainable<string> {
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
							issueDate,
							dueDate: "2026-11-24",
							currency: "EUR",
							lines: [{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
						},
					},
				})
				.then((saved) => saved.body.document.id as string),
		);
}

describe("Company size category and the French PDP calendar", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("saves the company settings while the size category is not declared", () => {
		cy.intercept("POST", "**/api/company/info").as("saveCompany");
		cy.visit("/settings/company");
		cy.get('[data-cy="company-profile-sizeCategory-select"]', { timeout: 20000 })
			.scrollIntoView()
			.should("contain.text", "Not declared");
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait("@saveCompany").its("response.statusCode").should("be.oneOf", [200, 201]);
	});

	it("declares the size category in the company settings, and shows it again after a reload", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-profile-sizeCategory-select"]', { timeout: 20000 }).scrollIntoView();

		cy.get('[data-cy="company-profile-sizeCategory-select"]').click();
		cy.get('[data-cy="company-profile-sizeCategory-option-SME"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.get("[data-sonner-toast]", { timeout: 15000 }).should("exist");

		cy.request({ url: `${api}/api/company/info` })
			.its("body.reportingProfile")
			.should("deep.equal", { sizeCategory: "SME" });

		cy.reload();
		cy.get('[data-cy="company-profile-sizeCategory-select"]', { timeout: 20000 })
			.scrollIntoView()
			.should("contain.text", "Small or medium-sized enterprise (PME)");
	});

	it("drops the option for VAT on debits when the exemption switch turns on, and saves without a 400", () => {
		cy.intercept("POST", "**/api/company/info").as("saveCompany");
		cy.visit("/settings/company");
		cy.get('[data-cy="company-profile-vatDebitsOption-select"]', { timeout: 20000 })
			.scrollIntoView()
			.click();
		cy.get('[data-cy="company-profile-vatDebitsOption-option-EXERCISED"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait("@saveCompany").its("response.statusCode").should("be.oneOf", [200, 201]);
		cy.request({ url: `${api}/api/company/info` })
			.its("body.reportingProfile")
			.should("deep.include", { vatDebitsOption: "EXERCISED" });

		cy.get('[data-cy="company-exemptvat-switch"]', { timeout: 20000 }).scrollIntoView().click();
		cy.get('[data-cy="company-profile-vatRegime-derived"]').should(
			"contain.text",
			"Franchise in base",
		);
		cy.get('[data-cy="company-profile-vatDebitsOption-select"]').should("not.exist");
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait("@saveCompany").its("response.statusCode").should("be.oneOf", [200, 201]);
		cy.request({ url: `${api}/api/company/info` })
			.its("body.reportingProfile")
			.should("not.have.property", "vatDebitsOption");

		// Turning the exemption off brings the question back; it must be empty, since the answer the
		// first save dropped was never kept in the form. Turning it on again must not send it back.
		cy.get('[data-cy="company-exemptvat-switch"]').scrollIntoView().click();
		cy.get('[data-cy="company-profile-vatDebitsOption-select"]', { timeout: 10000 })
			.scrollIntoView()
			.should("contain.text", "Not declared");
		cy.get('[data-cy="company-exemptvat-switch"]').scrollIntoView().click();
		cy.get('[data-cy="company-profile-vatDebitsOption-select"]').should("not.exist");
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait("@saveCompany").its("response.statusCode").should("be.oneOf", [200, 201]);
		cy.request({ url: `${api}/api/company/info` })
			.its("body.reportingProfile")
			.should("not.have.property", "vatDebitsOption");
	});

	it("an SME validates a domestic business invoice dated before 2027-09-01 without a PDP, and the dialog announces no transmission", () => {
		createDraftInvoice("2026-10-25").then((invoiceId) => {
			cy.intercept("GET", "**/actions/validate/transmission-preview*").as("preview");
			cy.visit("/documents/invoice");
			cy.openDocument(invoiceId);
			cy.openDocumentActionsMenu();
			cy.get('[data-cy="document-action-validate"]', { timeout: 15000 }).click();

			cy.get('[data-cy="document-detail-lock-confirm"]', { timeout: 10000 }).should("be.visible");
			cy.wait("@preview").its("response.body").should("deep.equal", { transmits: false });
			cy.get('[data-cy="document-action-transmission-alert"]').should("not.exist");
			cy.get('[data-cy="document-detail-lock-confirm-confirm"]').click();

			cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["validated"]);
		});
	});
});
