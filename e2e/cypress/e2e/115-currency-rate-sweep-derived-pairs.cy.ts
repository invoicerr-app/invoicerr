export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #574 - the daily currency-rate sweep refreshes a pair a company actually USES, even when
 * nobody ever typed a manual rate for it. Before this issue, the sweep only ever refreshed pairs
 * already present among a company's own `CurrencyRate` rows (currency-rate-sweep-runner.ts's own
 * header) - a company that had never entered one by hand got NOTHING, which is the exact gap this
 * spec proves is closed: a USD invoice, a EUR reference currency, no manual rate anywhere, and the
 * Exchange rates card still ends up showing a USD->EUR rate, tagged with an AUTOMATIC source.
 *
 * The sweep interval is driven by `CURRENCY_RATE_SWEEP_INTERVAL_MS` (default 24h, far too slow for a
 * test) and the real ECB/open.er-api.com calls are swapped for a deterministic, network-free fake
 * (`CURRENCY_RATE_FAKE=1`, fake-rate-clients.ts) - both set ONLY in this worktree's own env file
 * (never `backend/.env.test`, the shared tracked one), the same "lower the interval, never touch the
 * assertion" discipline 29-document-recurrence.cy.ts already holds for its own sweep.
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
 * appears, or ~20s (bounded) elapse - the same "an async worker will eventually do X" bounded-polling
 * shape `waitForDuplicate` (29-document-recurrence.cy.ts) already holds for its own sweep, rather than
 * a fixed `cy.wait` that either wastes time or, under CI contention, is not long enough.
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
			cy.wait(1000);
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
			expect(res.status, "devise de référence configurée").to.be.oneOf([200, 201]);
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
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

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
				expect(res.status, "brouillon de facture USD créé").to.be.oneOf([200, 201]);
			});

		// Never typed by hand - the whole point of this spec. The sweep (every 5s on this stack,
		// CURRENCY_RATE_SWEEP_INTERVAL_MS) is what has to derive and insert this pair on its own.
		waitForAutomaticRate("USD", "EUR").then((rates) => {
			const usdRow = rates.find((r) => r.from === "USD" && r.to === "EUR");
			expect(usdRow, "une ligne USD->EUR automatique existe").to.exist;
			expect(usdRow?.source, "jamais 'manual' - cette ligne n'a jamais été saisie à la main").to.not.eq(
				"manual",
			);
		});

		// The same fact, on the actual screen a self-hoster reads - not only the API. One row only
		// (a fresh company, straight off `resetAndSeed`), so asserting on the whole table's text is
		// enough to tie the pair to its source without guessing at the row's generated id.
		cy.visit("/settings/company");
		cy.get('[data-cy="currency-rates-table"]', { timeout: 20000 }).should("contain.text", "USD→EUR");
		cy.get('[data-cy="currency-rates-table"]').should("contain.text", "ecb");
	});
});
