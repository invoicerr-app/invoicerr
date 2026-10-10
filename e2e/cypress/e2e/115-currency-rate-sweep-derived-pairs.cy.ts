export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #574 - the daily currency-rate sweep refreshes a pair a company actually USES, even when
 * nobody ever typed a manual rate for it. Before this issue, the sweep only ever refreshed pairs
 * already present among a company's own `CurrencyRate` rows (currency-rate-sweep-runner.ts's own
 * header) - a company that had never entered one by hand got NOTHING, which is the exact gap this
 * spec proves is closed: a USD invoice, a EUR reference currency, no manual rate anywhere, and the
 * Exchange rates card still ends up showing a USD->EUR rate, tagged with an AUTOMATIC source.
 *
 * Triggered ON DEMAND through `cy.task("triggerCurrencyRateSweep")` (cypress.config.ts) rather than
 * waiting on `CURRENCY_RATE_SWEEP_INTERVAL_MS` (default 24h in every environment, production included
 * - this spec never lowers it): that task enqueues ONE real job on the SAME BullMQ queue the
 * repeatable uses, and the backend under test's own, already-running worker picks it up and runs the
 * REAL `CurrencyRateSweepRunner.runSweep()` within moments - the same "fresh one-off job, not a
 * shortened interval" discipline `triggerPdpReceptionSweep` (cypress.config.ts) already holds for its
 * own sweep, and for an EXTRA reason here: this sweep scans EVERY company's data at once, so a short
 * interval applied to the whole numbered suite (the way `DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS` is)
 * would risk mutating some OTHER spec's own company mid-run.
 *
 * The real ECB/open.er-api.com calls are swapped for a deterministic, network-free fake
 * (`CURRENCY_RATE_FAKE=1`, fake-rate-clients.ts) - set in the TRACKED `backend/.env.test`, the same
 * unconditional-flag shape `VAT_VALIDATION_FAKE`/`GITHUB_RELEASES_FAKE`/`VAT_CURRENCY_RATE_FAKE`
 * already hold there: a CI job must never depend on the real ECB feed being up, and this flag is
 * dormant everywhere the sweep is never triggered, which is everywhere except this one spec.
 */
const api = Cypress.env("apiUrl");

interface CurrencyRateRow {
	id: string;
	from: string;
	to: string;
	source: string;
}

/**
 * Polls `GET /api/company/currency-rates` until a row matching `from`/`to` with a NON-manual source
 * appears, or a few seconds (bounded) elapse - the sweep itself ran as a real, already-triggered
 * BullMQ job by the time this is called, so this only ever covers the brief gap between enqueuing it
 * and the worker finishing, the same "an async worker will eventually do X" bounded-polling shape
 * `waitForDuplicate` (29-document-recurrence.cy.ts) already holds for its own sweep.
 */
function waitForAutomaticRate(
	from: string,
	to: string,
	attemptsLeft = 20,
): Cypress.Chainable<CurrencyRateRow[]> {
	return cy
		.request({ url: `${api}/api/company/currency-rates` })
		.its("body")
		.then((rates: CurrencyRateRow[]) => {
			const match = rates.find((r) => r.from === from && r.to === to && r.source !== "manual");
			if (match || attemptsLeft <= 0) return cy.wrap(rates);
			cy.wait(200);
			return waitForAutomaticRate(from, to, attemptsLeft - 1);
		});
}

describe("The currency-rate sweep derives the pairs a company actually uses (#574)", () => {
	before(() => {
		cy.resetAndSeed();

		// The reference currency - needed for the "used currency vs reference currency" half of
		// scope (b) (currency-rate-sweep.ts#deriveNeededCurrencyPairs). Set through the API, like
		// 24/29's own `invoiceTransportId` setup - this spec's own interest is the sweep, not the
		// settings form, which 27-multi-currency-consolidation.cy.ts already exercises through real
		// fields.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { referenceCurrency: "EUR" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "reference currency configured").to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it("a USD invoice, with no manual rate ever entered, still shows a USD->EUR rate once the sweep has run", () => {
		// Before any usage exists: the card has nothing to show, and certainly no USD row - the
		// honest "before" state this test's own `it` name promises ("no manual rate ever entered").
		cy.visit("/settings/company");
		cy.get('[data-cy="currency-rates-card"]', { timeout: 15000 }).scrollIntoView().should("be.visible");
		cy.get('[data-cy="currency-rates-card"]').should("not.contain.text", "USD");

		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "the seed data contains a client").to.have.length.greaterThan(0);

				return cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "USD",
							lines: [
								{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "0" },
							],
						},
					},
					failOnStatusCode: false,
				});
			})
			.then((res) => {
				expect(res.status, "USD invoice draft created").to.be.oneOf([200, 201]);
			});

		// Never typed by hand - the whole point of this spec. A real, on-demand sweep pass (see this
		// file's own header) is what has to derive and insert this pair on its own.
		cy.task("triggerCurrencyRateSweep");

		waitForAutomaticRate("USD", "EUR").then((rates) => {
			const usdRow = rates.find((r) => r.from === "USD" && r.to === "EUR");
			expect(usdRow, "an automatic USD->EUR row exists").to.exist;
			expect(usdRow?.source, "never 'manual' - this row was never typed by hand").to.not.eq("manual");
		});

		// The same fact, on the actual screen a self-hoster reads - not only the API. One row only
		// (a fresh company, straight off `resetAndSeed`), so asserting on the whole table's text is
		// enough to tie the pair to its source without guessing at the row's generated id.
		cy.visit("/settings/company");
		cy.get('[data-cy="currency-rates-table"]', { timeout: 20000 }).should("contain.text", "USD→EUR");
		cy.get('[data-cy="currency-rates-table"]').should("contain.text", "ecb");
	});
});
