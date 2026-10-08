export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Keyboard navigation in the shared dropdown: type a filter, ArrowDown, Enter picks the highlighted
 * option, checked on a quote's currency and on a line's VAT rate through what the API stored.
 */
const api = Cypress.env("apiUrl");

const saveButton = '[data-cy="document-unsaved-save"]';

type SelectOption = { value: string };

function createDraftQuote(vatRate: string) {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) =>
			cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: new Date().toISOString().slice(0, 10),
							currency: "USD",
							lines: [{ description: "Consulting", quantity: 1, unitPrice: 100, vatRate }],
						},
					},
				})
				.its("body.document.id"),
		);
}

function vatRateOptions() {
	return cy.request(`${api}/api/documents/types/quote`).then((res) => {
		const lines = res.body.fields.find((f: { key: string }) => f.key === "lines");
		const vatRate = lines.fields.find((f: { key: string }) => f.key === "vatRate");
		return vatRate.options as SelectOption[];
	});
}

function openQuote(id: string) {
	cy.visit(`/documents/quote/${id}`);
	cy.get('[data-cy="document-detail-page"]', { timeout: 20000 }).should("exist");
}

function pickWithKeyboard(dataCy: string, filter: string, scope = "") {
	const wrapper = `${scope} [data-cy="${dataCy}"]`.trim();
	const options = `[data-cy="${dataCy}-options"]`;
	cy.get(`${wrapper} button`).first().scrollIntoView();
	cy.get(`${wrapper} button`).first().click();
	cy.get(options).should("be.visible");
	cy.get(`[data-cy="${dataCy}"] input`).type(`${filter}{downArrow}{enter}`);
	cy.get(options).should("not.exist");
}

function saveAndRead(id: string) {
	cy.get(saveButton).click();
	cy.get(saveButton).should("not.exist");
	return cy.request(`${api}/api/documents/${id}?typeId=quote`).its("body.data");
}

describe("Dropdown keyboard navigation", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.viewport(1280, 720);
		cy.login();
	});

	it("currency: type a filter, ArrowDown, Enter stores the highlighted option", () => {
		vatRateOptions().then((options) => {
			createDraftQuote(options[0].value).then((id: string) => {
				openQuote(id);
				pickWithKeyboard("document-field-currency-input", "eur");
				saveAndRead(id).its("currency").should("eq", "EUR");
			});
		});
	});

	it("line VAT rate: type a filter, ArrowDown, Enter stores the second matching option", () => {
		vatRateOptions().then((options) => {
			createDraftQuote(options[0].value).then((id: string) => {
				openQuote(id);
				pickWithKeyboard(
					"document-field-vatRate-input",
					"%",
					'[data-cy="document-field-lines-row-0"]',
				);
				saveAndRead(id).its("lines.0.vatRate").should("eq", options[1].value);
			});
		});
	});
});
