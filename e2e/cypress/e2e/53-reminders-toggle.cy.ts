/**
 * Interrupteur « relances automatiques » dans Settings (rang 2, suite) — expose le flag
 * `Company.remindersEnabled` (qui gate le sweep de relances) dans l'UI. La LOGIQUE du sweep est
 * déjà couverte ailleurs ; ici on prouve juste que le flag round-trip par l'API et que
 * l'interrupteur à l'écran reflète son état. Discipline : action/relecture par l'API, reflet vérifié
 * à l'écran.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function setReminders(enabled: boolean) {
	return cy
		.request({ method: "POST", url: `${api}/api/company/info`, body: { remindersEnabled: enabled } })
		.then((res) => expect(res.status, "company info enregistré").to.be.oneOf([200, 201]));
}

describe("Settings — interrupteur des relances automatiques", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	it("remindersEnabled round-trip via l'API (true puis false)", () => {
		setReminders(true);
		cy.request({ url: `${api}/api/company/info` }).its("body.remindersEnabled").should("eq", true);
		setReminders(false);
		cy.request({ url: `${api}/api/company/info` }).its("body.remindersEnabled").should("eq", false);
	});

	it("l'interrupteur à l'écran reflète l'état activé", () => {
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
