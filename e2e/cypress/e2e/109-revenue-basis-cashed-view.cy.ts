export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #516 - dated dashboard consolidation, the per-company revenue-basis setting, and the
 * cashed-revenue view per period.
 *
 * Three things proven through the screen, not only in memory:
 *
 *  1. THE FIX: a CLOSED period's consolidated total (`invoice:collected:consolidated`) does not move
 *     when a brand-new currency rate dated TODAY is entered - the exact regression
 *     `currency-consolidation.ts#resolveConsolidationInstant` (backend) exists to guard against. A
 *     USD payment recorded in a month already behind us (August, against a "today" of late
 *     September) is consolidated into EUR once with the rate that existed while August was still
 *     open, then a wildly different rate dated today is entered, and the SAME closed period is
 *     re-read: the figure must be byte-identical both times.
 *  2. The revenue-basis setting (Company tab): visible, shows the computed per-country default with
 *     its own sourced reason (the seeded company is French, so the default is "cashed" - URSSAF),
 *     and is genuinely editable - changed, saved, and read back after a reload.
 *  3. The cashed-revenue view (its own settings tab): the SAME August payment appears in its Q3 2026
 *     bucket once "quarterly" is selected, consolidated at ITS OWN payment-dated rate, and the
 *     screen's own disclaimer names this an aid, never the official declaration. The CSV export is a
 *     real download, verified by its own response headers/body, not merely a click that fires.
 */

const api = Cypress.env("apiUrl");

function createUsdClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Client US Devise 516",
				contactEmail: "billing-516@example.com",
				address: "1 Rue Quelconque",
				postalCode: "75002",
				city: "Paris",
				country: "France",
				currency: "USD",
				isActive: true,
			},
		})
		.then((res) => {
			expect(res.status, "USD client created").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

function setInvoiceTransport(transportId: string) {
	return cy
		.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: transportId } })
		.then((res) => expect(res.status, "transport configured").to.be.oneOf([200, 201]));
}

function usdInvoiceData(clientId: string) {
	return {
		client: clientId,
		issueDate: "2026-08-05",
		dueDate: "2026-08-20",
		currency: "USD",
		lines: [{ description: "Conseil (issue 516)", quantity: 1, unit: "day", unitPrice: 500, vatRate: "0" }],
	};
}

function saveDraft(data: Record<string, unknown>) {
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((res) => {
			expect(res.status, "invoice draft created").to.be.oneOf([200, 201]);
			return res.body.document.id as string;
		});
}

function sendInvoice(invoiceId: string, data: Record<string, unknown>) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/send`,
			body: { documentId: invoiceId, data },
		})
		.then((res) => expect(res.status, "send, synchronous phase").to.be.oneOf([200, 201]))
		.then(() => cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]));
}

function recordUsdPayment(invoiceId: string, data: Record<string, unknown>) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/record-payment`,
			body: {
				documentId: invoiceId,
				data,
				// $500, in August - well inside the CLOSED month/quarter both later `it`s read.
				params: { amount: 500, currency: "USD", paidAt: "2026-08-15", method: "bank_transfer" },
			},
		})
		.then((res) => expect(res.status, "USD payment recorded").to.be.oneOf([200, 201]));
}

function addUsdToEurRate(rate: number, asOf: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/currency-rates`,
			body: { from: "USD", to: "EUR", rate, asOf },
		})
		.then((res) => expect(res.status, `USD->EUR rate ${rate} @ ${asOf} added`).to.be.oneOf([200, 201]));
}

function setDarkTheme() {
	cy.window().then((win) => win.localStorage.setItem("vite-ui-theme", "dark"));
}

function setLightTheme() {
	cy.window().then((win) => win.localStorage.setItem("vite-ui-theme", "light"));
}

function selectCustomAugust() {
	cy.get('[data-cy="dashboard-period-select"]').should("be.visible");
	cy.openSelect('[data-cy="dashboard-period-select"]', '[data-cy="dashboard-period-option-custom"]');
	cy.openDatePicker('[data-cy="dashboard-period-custom-from"]');
	cy.get('select[aria-label="Choose the Year"]').select("2026", { force: true });
	cy.get('select[aria-label="Choose the Month"]').select("7", { force: true }); // August, 0-indexed
	cy.get('[data-day="2026-08-01"] button').click();
	cy.get('[data-cy="date-picker-today"]').should("not.exist");
	cy.openDatePicker('[data-cy="dashboard-period-custom-to"]');
	cy.get('select[aria-label="Choose the Year"]').select("2026", { force: true });
	cy.get('select[aria-label="Choose the Month"]').select("7", { force: true });
	cy.get('[data-day="2026-08-31"] button').click();
	cy.get('[data-cy="date-picker-today"]').should("not.exist");
}

describe("Issue #516 - dated consolidation, revenue basis, cashed-revenue view", () => {
	let invoiceId: string;

	before(() => {
		cy.resetAndSeed();
		cy.login();
		setInvoiceTransport("email");

		// Reference currency EUR, and the ONLY rate that existed while August was still open.
		cy.request({ method: "POST", url: `${api}/api/company/info`, body: { referenceCurrency: "EUR" } }).then(
			(res) => expect(res.status).to.be.oneOf([200, 201]),
		);
		addUsdToEurRate(0.9, "2026-08-01");

		createUsdClient().then((clientId) => {
			const data = usdInvoiceData(clientId);
			saveDraft(data).then((id) => {
				invoiceId = id;
				sendInvoice(id, data).then(() => recordUsdPayment(id, data));
			});
		});
	});

	beforeEach(() => cy.login());

	it("a CLOSED period's consolidated total never moves when a rate dated TODAY is added", () => {
		setLightTheme();
		cy.intercept({ method: "GET", pathname: "/api/documents/dashboard" }).as("dashboard");
		cy.visit("/dashboard");
		cy.wait("@dashboard", { timeout: 20000 });
		selectCustomAugust();

		// 500.00 USD * 0.90 (the August-dated rate) = 450.00 EUR.
		cy.get('[data-cy="widget-invoice:collected:consolidated"]', { timeout: 20000 })
			.should("contain.text", "≈")
			.and("contain.text", "450")
			.and("contain.text", "EUR (converted)");
		cy.get('[data-cy="widget-invoice:collected:consolidated-warnings"]').should(
			"contain.text",
			"USD→EUR @ 0.9 (manual, 2026-08-01)",
		);
		cy.screenshot("516-dashboard-closed-period-before");

		// A brand-new rate, dated TODAY, wildly different (5.0 instead of 0.9) so any leak into the
		// closed period would be impossible to miss.
		const today = new Date().toISOString().slice(0, 10);
		addUsdToEurRate(5, today);

		// Re-read the SAME closed period, fresh.
		cy.intercept({ method: "GET", pathname: "/api/documents/dashboard" }).as("dashboardAfter");
		cy.visit("/dashboard");
		cy.wait("@dashboardAfter", { timeout: 20000 });
		selectCustomAugust();

		// UNCHANGED - still the August-dated rate, never today's.
		cy.get('[data-cy="widget-invoice:collected:consolidated"]', { timeout: 20000 })
			.should("contain.text", "≈")
			.and("contain.text", "450")
			.and("contain.text", "EUR (converted)");
		cy.get('[data-cy="widget-invoice:collected:consolidated-warnings"]').should(
			"contain.text",
			"USD→EUR @ 0.9 (manual, 2026-08-01)",
		);
		cy.screenshot("516-dashboard-closed-period-after");
	});

	it("the revenue-basis setting shows the FR default (cashed, URSSAF) and is genuinely editable", () => {
		setLightTheme();
		cy.visit("/settings/company");
		cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="company-revenue-basis-select"]').scrollIntoView();
		cy.get('[data-cy="company-revenue-basis-select"]').should("contain.text", "Use the default");
		cy.get('[data-cy="company-revenue-basis-reason"]', { timeout: 10000 }).should("contain.text", "urssaf");
		cy.screenshot("516-revenue-basis-default-light");

		// Genuinely editable: switch to "invoiced" / "quarterly", save, and read it back after a
		// hard reload - never merely the form's own local state. Stays in light theme so this
		// "before -> after" pair (default-light above, edited-light below) is directly comparable.
		cy.openSelect(
			'[data-cy="company-revenue-basis-select"]',
			'[data-cy="company-revenue-basis-option-invoiced"]',
		);
		cy.openSelect(
			'[data-cy="company-revenue-period-select"]',
			'[data-cy="company-revenue-period-option-quarterly"]',
		);
		cy.intercept("POST", "**/api/company/info").as("saveCompany");
		cy.get('[data-cy="company-submit-btn"]').scrollIntoView().click();
		cy.wait("@saveCompany").its("response.statusCode").should("be.oneOf", [200, 201]);
		cy.get('[data-cy="company-revenue-basis-select"]').scrollIntoView();
		cy.get('[data-cy="company-revenue-basis-select"]').should("contain.text", "Invoiced");
		cy.screenshot("516-revenue-basis-edited-light");

		// Persisted server-side, not only in the form's local state.
		cy.visit("/settings/company");
		cy.get('[data-cy="company-revenue-basis-select"]', { timeout: 15000 }).scrollIntoView();
		cy.get('[data-cy="company-revenue-basis-select"]').should("contain.text", "Invoiced");
		cy.get('[data-cy="company-revenue-period-select"]').should("contain.text", "Quarterly");

		// Dark theme, same (now edited) screen - a real reload so the theme provider actually
		// re-reads localStorage; flipping the storage key alone does not re-render a mounted page.
		setDarkTheme();
		cy.reload();
		cy.get('[data-cy="company-revenue-basis-select"]', { timeout: 15000 }).scrollIntoView();
		cy.get('[data-cy="company-revenue-basis-select"]').should("contain.text", "Invoiced");
		cy.screenshot("516-revenue-basis-edited-dark");
	});

	it("the cashed-revenue view buckets the August payment into Q3 2026, converted, labelled as an aid", () => {
		setLightTheme();
		cy.visit("/settings/cashedRevenue");
		cy.get('[data-cy="cashed-revenue-disclaimer"]', { timeout: 15000 }).should(
			"contain.text",
			"not the official declaration",
		);

		cy.openSelect(
			'[data-cy="cashed-revenue-granularity-select"]',
			'[data-cy="cashed-revenue-granularity-option-quarterly"]',
		);
		// The popover unmounts its content once closed (Radix `Select`) - waited for explicitly so a
		// screenshot taken right after never catches it mid-close, the same retry-until-true
		// discipline every other assertion in this suite already leans on rather than a fixed sleep.
		cy.get('[data-cy="cashed-revenue-granularity-option-quarterly"]', { timeout: 10000 }).should("not.exist");

		cy.get('[data-cy="cashed-revenue-period-2026-Q3-amount-USD"]', { timeout: 15000 }).should(
			"contain.text",
			"500",
		);
		// Consolidated at the AUGUST-dated rate (0.9), never the later one dated today (5.0):
		// 500.00 USD * 0.90 = 450.00 EUR.
		cy.get('[data-cy="cashed-revenue-period-2026-Q3-consolidated"]', { timeout: 15000 }).should(
			"contain.text",
			"450",
		);
		cy.screenshot("516-cashed-revenue-quarter-light");

		setDarkTheme();
		cy.reload();
		cy.get('[data-cy="cashed-revenue-period-2026-Q3-consolidated"]', { timeout: 15000 }).should(
			"contain.text",
			"450",
		);
		cy.screenshot("516-cashed-revenue-quarter-dark");

		// Back to light for the CSV export interaction below - irrelevant to its correctness, but
		// keeps the suite's own state tidy for anyone re-running this spec's video/screenshots.
		setLightTheme();
		cy.reload();
		cy.openSelect(
			'[data-cy="cashed-revenue-granularity-select"]',
			'[data-cy="cashed-revenue-granularity-option-quarterly"]',
		);

		// The CSV export is a real download, verified by its own response.
		cy.intercept("GET", "**/api/revenue/cashed/export*").as("exportCsv");
		cy.get('[data-cy="cashed-revenue-export-btn"]').click();
		cy.wait("@exportCsv").then((interception) => {
			expect(interception.response?.statusCode).to.eq(200);
			expect(interception.response?.headers["content-type"]).to.include("text/csv");
			const body = interception.response?.body as string;
			expect(body).to.include("period,dateFrom,dateTo,currency,amount,consolidated,warnings");
			expect(body).to.include("not the official declaration");
			expect(body).to.include("USD");
		});
	});
});
