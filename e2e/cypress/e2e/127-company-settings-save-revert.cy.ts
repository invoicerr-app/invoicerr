export {};

const api = Cypress.env("apiUrl");
const nameInput = '[data-cy="company-name-input"]';
const saveButton = '[data-cy="company-submit-btn"]';
const originalName = "Company before edit";
const savedName = "Company after edit";
let pendingResponses: (() => void)[] = [];

/** Hold the real server response so typing, rather than a timing guess, controls the race. */
function holdNextCompanyResponse(method: "GET" | "POST", alias: string) {
	let received = false;
	let release = () => {};
	const gate = new Cypress.Promise<void>((resolve) => {
		release = resolve;
	});
	pendingResponses.push(release);
	cy.intercept({ method, url: "**/api/company/info", times: 1 }, (request) => {
		request.continue((response) => {
			expect(response.statusCode, `${alias} succeeded on the server`).to.be.oneOf([200, 201]);
			received = true;
			return gate;
		});
	}).as(alias);
	return {
		wait: () => cy.wrap(null).should(() => expect(received, `${alias} response is held`).to.equal(true)),
		release: () => cy.then(() => release()),
	};
}

describe("Company settings keep edits made during a save", () => {
	beforeEach(() => {
		pendingResponses = [];
		cy.login();
		cy.request("POST", `${api}/api/company/info`, { name: originalName });
		cy.visit("/settings/company");
		cy.get(nameInput, { timeout: 20000 }).should("have.value", originalName);
	});

	afterEach(() => {
		// A failed assertion must not leave an intercepted request pending in the next test.
		for (const release of pendingResponses) release();
	});

	for (const editDuring of ["save response", "company reload"] as const) {
		it(`persists a revert made while the ${editDuring} is pending`, () => {
			const save = holdNextCompanyResponse("POST", "firstSave");
			const reload = holdNextCompanyResponse("GET", "companyReload");
			let disabledDuringReload = false;

			cy.get(nameInput).clear().type(savedName);
			cy.get(saveButton).scrollIntoView().click();
			save.wait();
			if (editDuring === "save response") {
				cy.get(nameInput).scrollIntoView().clear().type(originalName);
			}
			save.release();
			cy.wait("@firstSave").its("request.body.name").should("equal", savedName);
			reload.wait();
			if (editDuring === "company reload") {
				cy.get(nameInput).scrollIntoView().clear().type(originalName);
			}
			cy.get(saveButton).then(($button) => {
				disabledDuringReload = $button.is(":disabled");
			});
			reload.release();
			cy.wait("@companyReload").its("response.body.name").should("equal", savedName);

			// The first save really persisted B. After its reload, the live form must still show A.
			cy.request(`${api}/api/company/info`).its("body.name").should("equal", savedName);
			cy.get(nameInput).should("have.value", originalName);
			cy.then(() => expect(disabledDuringReload, "save stays disabled during reload").to.equal(true));

			cy.intercept("POST", "**/api/company/info").as("secondSave");
			cy.get(saveButton).scrollIntoView().should("not.be.disabled").click();
			cy.wait("@secondSave").then(({ request, response }) => {
				expect(request.body.name, "the second save sends the revert").to.equal(originalName);
				expect(response?.statusCode).to.be.oneOf([200, 201]);
			});
			cy.request(`${api}/api/company/info`).its("body.name").should("equal", originalName);
			cy.reload();
			cy.get(nameInput, { timeout: 20000 }).should("have.value", originalName);
		});
	}

	it("keeps save disabled until the company reload finishes", () => {
		const reload = holdNextCompanyResponse("GET", "companyReload");
		cy.get(nameInput).clear().type(savedName);
		cy.get(saveButton).scrollIntoView().click();
		reload.wait();
		cy.get(saveButton).should("be.disabled");
		reload.release();
		cy.wait("@companyReload");
		cy.get(saveButton).should("not.be.disabled");
	});
});
