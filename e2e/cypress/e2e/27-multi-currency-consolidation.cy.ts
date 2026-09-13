export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Multi-currency (root TODO, item 9) — proven through the screen, not only in memory.
 *
 * The rule that comes first, written for this file as much as for the code it tests: a conversion
 * is a piece of information, never a replacement. Every assertion that matters here reads either
 * the RATE displayed as-is on screen (never a converted amount without it), or the ABSENCE of the
 * consolidated figure when an encountered currency has no rate — a partial consolidation that
 * looks total would be worse than no consolidation at all (see currency-consolidation.ts, backend).
 *
 * Sequence, in order — each `it` builds on the state left by the previous one, the same discipline
 * as 24-document-payments.cy.ts:
 *  1. reference currency + a manual rate typed through REAL fields in the company settings;
 *  2. an expense created in ANOTHER currency (USD) → the dashboard shows an additional consolidated
 *     metric, with the conversion mention AND the exact rate used, as displayed text;
 *  3. a second expense in a currency WITHOUT a configured rate (JPY) → the consolidated figure
 *     disappears entirely, and a warning naming the missing currency appears on screen.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Multi-currency — reference currency, manual rates, and honest consolidation", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("types in the reference currency and a manual USD→EUR rate through real fields", () => {
		cy.visit("/settings/company");
		cy.wait(3000);
		cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("be.visible");

		// The reference currency — a field on the existing company form, saved by the usual
		// "Save" button. The field is far down the page (the form's last card) — scrollIntoView
		// first, the same discipline as company-legalid-input in 02-company.cy.ts.
		cy.get('[data-cy="company-reference-currency-select"]').scrollIntoView();
		cy.get('[data-cy="company-reference-currency-select"] button').first().click();
		cy.wait(300);
		cy.get('[data-cy="company-reference-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="company-reference-currency-select-option-euro-(€)"]').click();
		cy.get('[data-cy="company-submit-btn"]').scrollIntoView().click();
		cy.wait(3000);

		// Re-visits to prove it's genuinely stored server-side, not only in the form's local
		// state — the same discipline as 02-company.cy.ts.
		cy.visit("/settings/company");
		cy.wait(3000);
		cy.get('[data-cy="company-reference-currency-select"]', { timeout: 15000 }).should(
			"contain.text",
			"Euro",
		);

		// The rate — its OWN card, its own button, never tied to the company form's submit.
		cy.get('[data-cy="currency-rate-from-select"]').scrollIntoView();
		cy.get('[data-cy="currency-rate-from-select"] button').first().click();
		cy.wait(300);
		cy.get('[data-cy="currency-rate-from-select-options"]').should("be.visible");
		cy.get('[data-cy="currency-rate-from-select-option-united-states-dollar-($)"]').click();

		cy.get('[data-cy="currency-rate-to-select"] button').first().click();
		cy.wait(300);
		cy.get('[data-cy="currency-rate-to-select-options"]').should("be.visible");
		cy.get('[data-cy="currency-rate-to-select-option-euro-(€)"]').click();

		cy.get('[data-cy="currency-rate-rate-input"]').clear().type("0.9");
		cy.get('[data-cy="currency-rate-add-btn"]').click();
		cy.wait(1000);

		// The rate appears in the table — the proof it was genuinely saved, read on screen.
		cy.get('[data-cy="currency-rates-table"]', { timeout: 10000 }).should("contain.text", "USD→EUR");
		cy.get('[data-cy="currency-rates-table"]').should("contain.text", "0.9");
	});

	it("an expense in another currency makes a consolidated metric appear, naming the rate used", () => {
		const today = new Date().toISOString().slice(0, 10);

		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/expense/actions/save-draft`,
			body: {
				data: { description: "Fournitures US", amount: 100, currency: "USD", date: today },
			},
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "dépense USD créée").to.be.oneOf([200, 201]);
		});

		cy.visit("/dashboard");

		// The per-currency metric, UNCHANGED — 100 USD stays 100 USD, never replaced.
		cy.get('[data-cy="widget-expense:this-month:USD"]', { timeout: 20000 }).should(
			"contain.text",
			"100",
		);

		// The consolidated figure, IN ADDITION — 100 USD * 0.9 = 90 EUR, with the conversion mention
		// and its approximation (the renderer's own "≈") visible on screen.
		cy.get('[data-cy="widget-expense:this-month:consolidated"]', { timeout: 20000 })
			.should("contain.text", "≈")
			.and("contain.text", "90")
			.and("contain.text", "EUR (converted)");

		// The exact rate displayed, as visible text — never a converted value without its own proof.
		cy.get('[data-cy="widget-expense:this-month:consolidated-warnings"]').should(
			"contain.text",
			`USD→EUR @ 0.9 (manual, ${today})`,
		);
	});

	it("a currency with no configured rate makes the consolidated figure disappear and names itself in a warning", () => {
		const today = new Date().toISOString().slice(0, 10);

		// No JPY→EUR rate has ever been entered.
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/expense/actions/save-draft`,
			body: {
				data: { description: "Fournitures JP", amount: 500, currency: "JPY", date: today },
			},
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "dépense JPY créée").to.be.oneOf([200, 201]);
		});

		cy.visit("/dashboard");
		cy.get('[data-cy="widget-expense:this-month:JPY"]', { timeout: 20000 }).should(
			"contain.text",
			"500",
		);

		// No consolidated metric at all any more — a partial consolidation would be worse than none.
		cy.get('[data-cy="widget-expense:this-month:consolidated"]').should("not.exist");

		// The warning names the missing currency, visible on the ordinary metrics already
		// displayed (never hidden: there's no consolidated widget left to carry it).
		cy.get('[data-cy="widget-expense:this-month:JPY-warnings"]').should(
			"contain.text",
			"No JPY→EUR rate is set",
		);
		cy.get('[data-cy="widget-expense:this-month:USD-warnings"]').should(
			"contain.text",
			"No JPY→EUR rate is set",
		);
	});
});
