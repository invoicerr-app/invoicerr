export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * "Automatic reminders" toggle in Settings (rank 2, continued) — exposes the
 * `Company.remindersEnabled` flag (which gates the reminder sweep) in the UI. The sweep's own LOGIC
 * is already covered elsewhere; here it is just proven that the flag round-trips through the API and
 * that the on-screen toggle reflects its state. Discipline: action/reread via the API, reflection
 * verified on screen.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function setReminders(enabled: boolean) {
	return cy
		.request({ method: "POST", url: `${api}/api/company/info`, body: { remindersEnabled: enabled } })
		.then((res) => expect(res.status, "company info enregistré").to.be.oneOf([200, 201]));
}

describe("Settings — automatic reminders toggle", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	it("remindersEnabled round-trips via the API (true then false)", () => {
		setReminders(true);
		cy.request({ url: `${api}/api/company/info` }).its("body.remindersEnabled").should("eq", true);
		setReminders(false);
		cy.request({ url: `${api}/api/company/info` }).its("body.remindersEnabled").should("eq", false);
	});

	it("the on-screen toggle reflects the enabled state", () => {
		setReminders(true);
		cy.visit("/settings/company");
		// shadcn/Radix Switch renders a <button data-state="checked|unchecked"> — assert the state it
		// reflects (not `be.visible`, which flakes on the switch's tiny transformed hit-area).
		cy.get('[data-cy="company-reminders-enabled"]', { timeout: 15000 }).should(
			"have.attr",
			"data-state",
			"checked",
		);
	});
});
