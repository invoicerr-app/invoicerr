export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * A French company declares its size category in the company settings, and an SME or a
 * micro-enterprise without an accredited platform can then validate an invoice to a French business
 * client before 2027-09-01. `cy.resetAndSeed()` gives a French company with no transport and a French
 * business client.
 */
const api = Cypress.env("apiUrl");

/** Picks a value in a company-profile select and waits for Radix's scroll lock to be released:
 *  the body keeps `pointer-events: none` while the dropdown closes, which makes the next click on
 *  the submit button flaky. */
function selectProfileOption(attribute: string, value: string) {
	cy.get(`[data-cy="company-profile-${attribute}-select"]`, { timeout: 20000 }).scrollIntoView().click();
	cy.get(`[data-cy="company-profile-${attribute}-option-${value}"]`).click();
	cy.get("body").should("not.have.attr", "data-scroll-locked");
}

/** Saves the company settings and waits for the screen to reload what was saved. The form re-reads
 *  `/api/company/info` after every save and keeps only the fields react-hook-form still counts as
 *  dirty; a switch turned back to the value it was loaded with is no longer dirty, so a reload that
 *  lands after the next click puts the previous saved value back and the following save sends it.
 *  Seen in CI: the exemption switch turned off right after a save came back on before the third
 *  save, which kept the VAT regime derived and its question locked for good. Registering the
 *  intercept just before the click keeps the page's own earlier reads out of the wait. */
function saveCompanyAndReload() {
	cy.intercept("GET", "**/api/company/info").as("reloadCompany");
	cy.get('[data-cy="company-submit-btn"]').click();
	cy.wait("@saveCompany").its("response.statusCode").should("be.oneOf", [200, 201]);
	cy.wait("@reloadCompany");
}

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

	it("declares the size category and the VAT group answer in the company settings, and shows them again after a reload", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-profile-sizeCategory-select"]', { timeout: 20000 }).scrollIntoView();

		selectProfileOption("sizeCategory", "SME");
		selectProfileOption("vatGroupMember", "NOT_MEMBER");
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.get("[data-sonner-toast]", { timeout: 15000 }).should("exist");

		cy.request({ url: `${api}/api/company/info` })
			.its("body.reportingProfile")
			.should("deep.equal", { sizeCategory: "SME", vatGroupMember: "NOT_MEMBER" });

		cy.reload();
		// The suite pins the browser to en-US, so the stored values are asserted through the API
		// above; this only checks the controls are still rendered. The French wording has its own
		// case below.
		cy.get('[data-cy="company-profile-sizeCategory-select"]', { timeout: 20000 }).scrollIntoView();
		cy.get('[data-cy="company-profile-vatGroupMember-select"]', { timeout: 20000 }).scrollIntoView();
	});

	it("shows the VAT group question and both options in French when the interface is French", () => {
		cy.visit("/settings/company");
		cy.window().then((win) => win.localStorage.setItem("i18nextLng", "fr"));
		cy.reload();

		cy.contains("label", "Appartenance à un assujetti unique", { timeout: 20000 })
			.scrollIntoView()
			.should("be.visible");
		cy.get('[data-cy="company-profile-vatGroupMember-select"]', { timeout: 20000 })
			.scrollIntoView()
			.click();
		cy.get('[data-cy="company-profile-vatGroupMember-option-MEMBER"]').should(
			"contain.text",
			"Membre d'un assujetti unique",
		);
		cy.get('[data-cy="company-profile-vatGroupMember-option-NOT_MEMBER"]').should(
			"contain.text",
			"N'est pas membre",
		);

		cy.window().then((win) => win.localStorage.removeItem("i18nextLng"));
	});

	it("drops the option for VAT on debits when the exemption switch turns on, and saves without a 400", () => {
		cy.intercept("POST", "**/api/company/info").as("saveCompany");
		cy.visit("/settings/company");

		// The VAT regime is now an explicit question. Its debits option is open while the regime is
		// undeclared, which is how the previous EXERCISED answer is saved before the switch changes.
		cy.get('[data-cy="company-profile-vatRegime-select"]', { timeout: 20000 })
			.scrollIntoView()
			.should("contain.text", "Not declared");
		selectProfileOption("vatDebitsOption", "EXERCISED");
		saveCompanyAndReload();
		cy.request({ url: `${api}/api/company/info` })
			.its("body.reportingProfile")
			.should("deep.include", { vatDebitsOption: "EXERCISED" });

		// Turning the exemption on derives the regime to the franchise and drops the option.
		cy.get('[data-cy="company-exemptvat-switch"]', { timeout: 20000 }).scrollIntoView().click();
		cy.get('[data-cy="company-profile-vatRegime-derived"]').should(
			"contain.text",
			"Franchise in base",
		);
		cy.get('[data-cy="company-profile-vatDebitsOption-select"]').should("not.exist");
		saveCompanyAndReload();
		cy.request({ url: `${api}/api/company/info` })
			.its("body.reportingProfile")
			.should((profile) => {
				expect(profile).to.not.have.property("vatDebitsOption");
				expect(profile).to.not.have.property("vatRegime");
			});

		// Turning the exemption off brings the regime question back. Save once first: the server
		// still carries the derived FRANCHISE until the next write, and reading it as a declared
		// answer would keep the question locked. The debits answer saved above must be gone, so the
		// option is empty when a real regime asks it again.
		cy.get('[data-cy="company-exemptvat-switch"]').scrollIntoView().click();
		saveCompanyAndReload();
		cy.get('[data-cy="company-profile-vatRegime-select"]', { timeout: 20000 })
			.scrollIntoView()
			.should("contain.text", "Not declared");
		// The debits option is open while the regime is undeclared, and a real regime keeps it; the
		// previous EXERCISED answer must not come back.
		selectProfileOption("vatRegime", "REAL_MONTHLY");
		cy.get('[data-cy="company-profile-vatDebitsOption-select"]', { timeout: 10000 })
			.scrollIntoView()
			.should("contain.text", "Not declared");

		// Turning the exemption on again must not send either answer back.
		cy.get('[data-cy="company-exemptvat-switch"]').scrollIntoView().click();
		cy.get('[data-cy="company-profile-vatDebitsOption-select"]').should("not.exist");
		cy.get('[data-cy="company-profile-vatRegime-derived"]').should(
			"contain.text",
			"Franchise in base",
		);
		saveCompanyAndReload();
		cy.request({ url: `${api}/api/company/info` })
			.its("body.reportingProfile")
			.should((profile) => {
				expect(profile).to.not.have.property("vatDebitsOption");
				expect(profile).to.not.have.property("vatRegime");
			});
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
