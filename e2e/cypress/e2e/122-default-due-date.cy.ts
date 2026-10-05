export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The company's default due date for new quotes and invoices: filled from the issue date, kept when
 * the user edits it by hand, blank when no default is configured. Documents are created through the
 * create wizard; what was PERSISTED is read back through the API.
 */
const api = Cypress.env("apiUrl");

type TermsBody = {
	quoteDueDays: number | null;
	quoteDueMode: string | null;
	invoiceDueDays: number | null;
	invoiceDueMode: string | null;
};

const NO_TERMS: TermsBody = { quoteDueDays: null, quoteDueMode: null, invoiceDueDays: null, invoiceDueMode: null };

function configureTerms(terms: Partial<TermsBody>) {
	cy.request("POST", `${api}/api/company/info`, { ...NO_TERMS, ...terms })
		.its("status")
		.should("be.oneOf", [200, 201]);
}

function openCreateWizard(typeId: "quote" | "invoice") {
	cy.visit(`/documents/${typeId}`, { timeout: 20000 });
	cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
	cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");
	cy.pickDocumentClient();
}

function pickCurrencyAndContinue() {
	cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
	cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
	cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();
	cy.continueDocumentWizard();
}

function fillOneLineAndReachRecap(typeId: "quote" | "invoice") {
	cy.get('[data-cy="document-field-lines-add-row"]').click();
	cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
	cy.get('input[name="lines.0.description"]').type("Consulting", { force: true });
	cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("1", { force: true });
	cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("100", { force: true });
	if (typeId === "invoice") {
		// Only the invoice requires a unit and a VAT rate on its lines.
		cy.get('input[name="lines.0.unit"]').type("unit", { force: true });
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.contains('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]', /20\s?%/)
			.first()
			.click();
	}
	cy.continueDocumentWizard(); // Lines -> Options
	cy.continueDocumentWizard(); // Options -> Recap
}

function saveAndReadBack(typeId: "quote" | "invoice") {
	cy.intercept("POST", `${api}/api/documents/types/${typeId}/actions/save-draft`).as("saveDraft");
	cy.get('[data-cy="document-action-save-draft"]').click();
	return cy.wait("@saveDraft").then(({ response }) => {
		expect(response?.statusCode, "save-draft succeeded").to.be.oneOf([200, 201]);
		const id = response?.body?.document?.id as string;
		return cy
			.request(`${api}/api/documents?typeId=${typeId}`)
			.its("body.items")
			.then((docs: { id: string; data: { issueDate: string; dueDate?: string } }[]) => {
				const created = docs.find((doc) => doc.id === id);
				expect(created, "the saved document is in the list").to.exist;
				return created?.data as { issueDate: string; dueDate?: string };
			});
	});
}

describe("Default due date", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("fills an invoice due date from a 30 day net term with no manual action", () => {
		configureTerms({ invoiceDueDays: 30, invoiceDueMode: "net" });
		openCreateWizard("invoice");
		cy.pickDate('[data-cy="document-field-issueDate-input"]', "2026-10-01");
		pickCurrencyAndContinue();
		fillOneLineAndReachRecap("invoice");
		saveAndReadBack("invoice").then((data) => {
			expect(data.issueDate).to.eq("2026-10-01");
			expect(data.dueDate).to.eq("2026-10-31");
		});
	});

	it("counts to the end of the month for an end of month term", () => {
		configureTerms({ invoiceDueDays: 30, invoiceDueMode: "endOfMonth" });
		openCreateWizard("invoice");
		cy.pickDate('[data-cy="document-field-issueDate-input"]', "2026-10-15");
		pickCurrencyAndContinue();
		fillOneLineAndReachRecap("invoice");
		saveAndReadBack("invoice").then((data) => {
			expect(data.dueDate).to.eq("2026-11-30");
		});
	});

	it("keeps a due date edited by hand when the issue date changes afterwards", () => {
		configureTerms({ invoiceDueDays: 30, invoiceDueMode: "net" });
		openCreateWizard("invoice");
		cy.pickDate('[data-cy="document-field-issueDate-input"]', "2026-10-01");
		cy.pickDate('[data-cy="document-field-dueDate-input"]', "2026-11-15");
		cy.pickDate('[data-cy="document-field-issueDate-input"]', "2026-12-10");
		pickCurrencyAndContinue();
		fillOneLineAndReachRecap("invoice");
		saveAndReadBack("invoice").then((data) => {
			expect(data.issueDate).to.eq("2026-12-10");
			expect(data.dueDate).to.eq("2026-11-15");
		});
	});

	it("re-computes the due date when the issue date changes and it was never edited", () => {
		configureTerms({ invoiceDueDays: 30, invoiceDueMode: "net" });
		openCreateWizard("invoice");
		cy.pickDate('[data-cy="document-field-issueDate-input"]', "2026-10-01");
		cy.pickDate('[data-cy="document-field-issueDate-input"]', "2026-12-10");
		pickCurrencyAndContinue();
		fillOneLineAndReachRecap("invoice");
		saveAndReadBack("invoice").then((data) => {
			expect(data.dueDate).to.eq("2027-01-09");
		});
	});

	it("fills a quote due date from the quote term", () => {
		configureTerms({ quoteDueDays: 15, quoteDueMode: "net" });
		openCreateWizard("quote");
		cy.pickDate('[data-cy="document-field-issueDate-input"]', "2026-10-01");
		pickCurrencyAndContinue();
		fillOneLineAndReachRecap("quote");
		saveAndReadBack("quote").then((data) => {
			expect(data.dueDate).to.eq("2026-10-16");
		});
	});

	it("leaves the due date blank when no default is configured", () => {
		configureTerms({});
		openCreateWizard("invoice");
		cy.pickDate('[data-cy="document-field-issueDate-input"]', "2026-10-01");
		cy.get('[data-cy="document-field-dueDate-input"]').invoke("text").should("not.match", /\d/);
	});

	it("saves the terms from Settings and warns, without blocking, above the legal cap", () => {
		configureTerms({});
		cy.visit("/settings/paymentTerms", { timeout: 20000 });
		cy.get('[data-cy="payment-terms-invoice-days-input"]', { timeout: 15000 }).type("90");
		cy.get('[data-cy="payment-terms-invoice-cap-warning"]').should("be.visible");
		cy.get('[data-cy="payment-terms-quote-cap-warning"]').should("not.exist");

		cy.get('[data-cy="payment-terms-invoice-days-input"]').clear();
		cy.get('[data-cy="payment-terms-invoice-days-input"]').type("45");
		cy.get('[data-cy="payment-terms-invoice-cap-warning"]').should("not.exist");
		cy.openSelect(
			'[data-cy="payment-terms-invoice-mode-select"]',
			'[data-cy="payment-terms-invoice-mode-option-endOfMonth"]',
		);
		cy.get('[data-cy="payment-terms-invoice-cap-warning"]').should("not.exist");

		cy.get('[data-cy="payment-terms-invoice-days-input"]').clear();
		cy.get('[data-cy="payment-terms-invoice-days-input"]').type("90");
		cy.get('[data-cy="payment-terms-save-button"]').click();
		cy.request(`${api}/api/company/payment-terms`)
			.its("body")
			.should((terms) => {
				expect(terms.invoice).to.deep.eq({ days: 90, mode: "endOfMonth" });
				expect(terms.quote).to.eq(null);
				expect(terms.exceedsCap.invoice).to.eq(true);
			});
	});
});
