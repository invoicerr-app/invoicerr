export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #417 - the dashboard's "Collections" tile: cash ACTUALLY received, by PAYMENT date, distinct
 * from the existing "Invoiced ..." tiles (issue #418's own family), which count by ISSUE date.
 *
 * Every invoice in this file is CROSS-BORDER (a French seller, per `resetAndSeed`'s own baseline
 * company, invoicing a German or a US client) - deliberately, so the FR "pdp" channel mandate (active
 * for domestic FR->FR invoices from 2026-09-01) never enters into it: `channel-policy/mandate.ts`'s
 * own `scope: { parties: 'domestic' }` never binds a cross-border sale, so "email" stays a valid
 * transport for every `issueDate` this file uses, whatever today's real date is (see
 * `35-cross-border-tax.cy.ts`'s own header for the identical reasoning).
 *
 * Every payment's own `paidAt` is AFTER its invoice's `issueDate` - a payment can never precede the
 * invoice it settles, so this fixture never types in impossible data. Let M be the current UTC
 * calendar month (never hardcoded, so this spec keeps meaning the same thing whenever it runs):
 *
 *  - `invoiceOld` (EUR, German client): issued M-3, paid TODAY (M), in full (600). Proves "counts by
 *    payment date, not issue date": an invoice issued months ago still counts in "Collected this
 *    month" because the MONEY arrived this month.
 *  - `invoiceUnpaid` (EUR, German client): issued TODAY (M), never paid. Proves the other half of the
 *    same rule: being issued this month is what "Invoiced this month (EUR)" counts (500, this
 *    invoice's own net total) - it is NOT what "Collected this month (EUR)" counts, which stays 600
 *    (`invoiceOld`'s own payment only), never 1100.
 *  - `invoiceUsd` (USD, a US client): issued and paid today. Proves the tile never mixes currencies:
 *    its own "Collected this month (USD)" tile, never added into the EUR one.
 *  - `invoiceA` (EUR, German client): issued M-3, paid in M-2 (350). Used by the CUSTOM RANGE test
 *    below: issued before the period, paid inside it - counts toward "Collected in period", not
 *    toward "Invoiced in period".
 *  - `invoiceB` (EUR, German client): issued M-2, paid in M-1 (420, net total 500). Used by the same
 *    test: issued INSIDE the period, paid AFTER it closed - counts toward "Invoiced in period", not
 *    toward "Collected in period". Its own M-1 payment also proves the no-period test's default
 *    window is exactly "this month" and not a wider one: M-1 is inside the [last month, this month]
 *    SQL window `invoice:collected-this-month` reads from, but this payment is bucketed as
 *    PREVIOUS month there (`previousValue`, never asserted on), not folded into "this month"'s own
 *    600 total.
 *
 * The CUSTOM RANGE test (issue #418, `dashboard-period-option-custom`, never the "this-month" preset
 * - a preset can only ever select the CURRENT month, and this scenario needs M-2, a fixed month
 * chosen deliberately far from "today" so it never depends on which day of the month the suite
 * happens to run on) selects exactly month M-2. `invoiceA` was issued OUTSIDE that period but paid
 * INSIDE it (counts toward "Collected in period", 350); `invoiceB` was issued INSIDE that period but
 * paid AFTER it (counts toward "Invoiced in period", 500, but not toward "Collected in period") -
 * the exact "collections differs from invoiced, in both directions" case the issue asks screenshots
 * to show.
 *
 * No `[data-cy="widget-invoice:collected-this-month:EUR-link"]` (or `-in-period:EUR-link`) ever
 * exists: issue #419 links a tile only when a real filtered list exists behind it, and there is no
 * PAYMENTS list anywhere in this app (checked: `frontend/src/pages/(app)/settings/_components/
 * payments.settings.tsx` is payment METHODS/billing settings, not a list of recorded payments) - so
 * this tile is, and must stay, static.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function setInvoiceTransport(transportId: string) {
	return cy
		.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: transportId } })
		.then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});
}

function createClient(name: string, country: string, countryCode: string, currency: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				contactEmail: "billing@example.com",
				address: "1 Example Street",
				postalCode: "00000",
				city: "Example City",
				country,
				countryCode,
				currency,
				isActive: true,
			},
		})
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "the created client has an id").to.be.a("string");
			return id;
		});
}

function invoiceData(clientId: string, issueDate: string, currency: string, unitPrice: number) {
	return {
		client: clientId,
		issueDate,
		dueDate: issueDate,
		currency,
		lines: [{ description: "Conseil", quantity: 1, unit: "day", unitPrice, vatRate: "20" }],
	};
}

function saveDraft(data: Record<string, unknown>) {
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((saved) => {
			expect(saved.status, "invoice draft created").to.be.oneOf([200, 201]);
			const id = saved.body?.document?.id as string;
			expect(id, "the draft has an id").to.be.a("string");
			return id;
		});
}

function sendInvoice(invoiceId: string, data: Record<string, unknown>) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/send`,
			body: { documentId: invoiceId, data },
		})
		.then((res) => {
			expect(res.status, "send, synchronous phase").to.be.oneOf([200, 201]);
		})
		.then(() => cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]));
}

function recordPayment(
	invoiceId: string,
	data: Record<string, unknown>,
	amount: number,
	currency: string,
	paidAt: string,
) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/record-payment`,
			body: { documentId: invoiceId, data, params: { amount, currency, paidAt, method: "bank_transfer" } },
		})
		.then((res) => {
			expect(res.status, "payment recorded").to.be.oneOf([200, 201]);
		});
}

/** `"YYYY-MM-DD"` for the given `day` of the UTC calendar month `monthsOffset` months from `now` -
 *  the exact bucketing convention `invoice-contributions.ts#monthKey`/`monthRange` use server-side,
 *  so a date built here always lands in the month this spec expects it to. `day` stays at 1, 10 or
 *  15 everywhere this file uses it - every calendar month has at least that many days, so this never
 *  needs to clamp against a short month (e.g. February). */
function utcDate(now: Date, monthsOffset: number, day: number): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsOffset, day));
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** UTC calendar-month bounds, `monthsOffset` months from "now" - the exact bucketing convention
 *  `invoice-contributions.ts#monthKey`/`monthRange` use server-side. */
function utcMonthBounds(now: Date, monthsOffset: number): { dateFrom: string; dateTo: string } {
	const pad = (n: number) => String(n).padStart(2, "0");
	const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsOffset, 1));
	const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
	const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	return { dateFrom: iso(first), dateTo: iso(last) };
}

/** Picks an exact calendar day in a `DatePicker`: month and year through the calendar's own
 *  `<select>`s, then the day cell by its `data-day` (yyyy-MM-dd) - same technique as
 *  `86-dashboard-period.cy.ts`'s own `pickExactDay` (a plain `cy.pickDate` by day-number text would
 *  hit the wrong month's "outside day" cell on some grids). */
function pickExactDay(triggerSelector: string, iso: string) {
	const [year, month] = iso.split("-").map(Number);
	cy.openDatePicker(triggerSelector);
	cy.get('select[aria-label="Choose the Year"]').select(String(year), { force: true });
	cy.get('select[aria-label="Choose the Month"]').select(String(month - 1), { force: true });
	cy.get(`[data-day="${iso}"] button`).click();
	cy.get('[data-cy="date-picker-today"]').should("not.exist");
	cy.focused({ timeout: 10000 }).should("match", triggerSelector);
}

describe("Dashboard Collections tile (#417) - cash actually received, by payment date", () => {
	const now = new Date();
	const todayExact = now.toISOString().slice(0, 10);
	const monthM3 = utcDate(now, -3, 1); // M-3, day 1
	const monthM2Bounds = utcMonthBounds(now, -2); // the CUSTOM RANGE this file tests against
	const monthM2First = monthM2Bounds.dateFrom; // M-2, day 1
	const monthM2Mid = utcDate(now, -2, 15); // M-2, day 15 - invoiceA's own payment date
	const monthM1Mid = utcDate(now, -1, 10); // M-1, day 10 - invoiceB's own payment date

	before(() => {
		cy.resetAndSeed();
		setInvoiceTransport("email");

		createClient("Deutsche Handel GmbH", "Germany", "DE", "EUR").then((clientId) => {
			// invoiceOld: issued M-3, PAID TODAY - counts in "Collected this month", not in
			// "Invoiced this month" (issued too long ago).
			const oldData = invoiceData(clientId, monthM3, "EUR", 500);
			saveDraft(oldData).then((id) =>
				sendInvoice(id, oldData).then(() => recordPayment(id, oldData, 600, "EUR", todayExact)),
			);

			// invoiceUnpaid: issued TODAY, never paid - counts in "Invoiced this month" (500), never
			// in "Collected this month" (no payment exists to count).
			const unpaidData = invoiceData(clientId, todayExact, "EUR", 500);
			saveDraft(unpaidData).then((id) => sendInvoice(id, unpaidData));

			// invoiceA: issued M-3, paid in M-2 - the CUSTOM RANGE test's own "issued before the
			// period, paid inside it" case.
			const dataA = invoiceData(clientId, monthM3, "EUR", 500);
			saveDraft(dataA).then((id) =>
				sendInvoice(id, dataA).then(() => recordPayment(id, dataA, 350, "EUR", monthM2Mid)),
			);

			// invoiceB: issued M-2, paid in M-1 - the CUSTOM RANGE test's own "issued inside the
			// period, paid after it closed" case. Net total 500, matching "Invoiced in period (EUR)".
			const dataB = invoiceData(clientId, monthM2First, "EUR", 500);
			saveDraft(dataB).then((id) =>
				sendInvoice(id, dataB).then(() => recordPayment(id, dataB, 420, "EUR", monthM1Mid)),
			);
		});

		createClient("Acme US Inc", "United States", "US", "USD").then((clientId) => {
			const usdData = invoiceData(clientId, todayExact, "USD", 100);
			saveDraft(usdData).then((id) =>
				sendInvoice(id, usdData).then(() => recordPayment(id, usdData, 100, "USD", todayExact)),
			);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it("with no period, sums payments by PAYMENT date, per currency, never mixed, with no link", () => {
		cy.intercept({ method: "GET", pathname: "/api/documents/dashboard" }).as("dashboard");
		cy.visit("/dashboard");
		// The widgets are read with `cy.request`, never from the intercepted body: the browser may
		// revalidate a dashboard it already holds and get a 304 Not Modified, whose body is empty
		// (Express's weak ETag plus the browser's conditional GET, the same trap 18-onboarding-wizard,
		// 65-company-mail-settings and 70-three-way-match already document). Seen in CI and reproduced
		// locally in Firefox whenever 05-clients.cy.ts runs before this file in the same shard.
		cy.wait("@dashboard", { timeout: 20000 });
		cy.request<Array<{ id: string; link?: unknown }>>(`${api}/api/documents/dashboard`).then(({ body: widgets }) => {
			const collectedEur = widgets.find((w) => w.id === "invoice:collected-this-month:EUR");
			expect(collectedEur, "a collected-this-month:EUR widget is contributed").to.exist;
			expect(collectedEur?.link, "the collections tile carries no link (#419)").to.be.undefined;
		});

		// invoiceOld's own 600 EUR payment (issued M-3, paid TODAY) counts. invoiceB's own M-1
		// payment (420) is inside the fetch window but buckets as PREVIOUS month, never this one.
		// invoiceA's own M-2 payment is outside the window entirely. Total stays 600, never more.
		cy.get('[data-cy="widget-invoice:collected-this-month:EUR"]', { timeout: 20000 }).should(
			"contain.text",
			"600",
		);
		// "Invoiced this month (EUR)" is invoiceUnpaid's own net total (500) - issued this month,
		// never paid, so it contributes here and NOWHERE in the collected figure above. The two
		// tiles disagree on purpose: they count different things.
		cy.get('[data-cy="widget-invoice:issued-this-month:EUR"]', { timeout: 20000 }).should(
			"contain.text",
			"500",
		);

		// The USD payment, its own separate tile - never folded into the EUR figure above.
		cy.get('[data-cy="widget-invoice:collected-this-month:USD"]', { timeout: 20000 }).should(
			"contain.text",
			"100",
		);

		// #419: a metric with no matching list stays a plain, non-clickable card.
		cy.get('[data-cy="widget-invoice:collected-this-month:EUR-link"]').should("not.exist");
		cy.get('[data-cy="widget-invoice:collected-this-month:USD-link"]').should("not.exist");
	});

	it("a custom range (month M-2): invoiced and collected disagree in BOTH directions", () => {
		cy.visit("/dashboard");
		cy.get('[data-cy="dashboard-period-select"]').should("be.visible");
		cy.openSelect(
			'[data-cy="dashboard-period-select"]',
			'[data-cy="dashboard-period-option-custom"]',
		);

		cy.intercept({ method: "GET", pathname: "/api/documents/dashboard" }).as("dashboardCustom");
		pickExactDay('[data-cy="dashboard-period-custom-from"]', monthM2Bounds.dateFrom);
		pickExactDay('[data-cy="dashboard-period-custom-to"]', monthM2Bounds.dateTo);
		cy.wait("@dashboardCustom", { timeout: 20000 }).then((interception) => {
			const url = new URL(interception.request.url);
			expect(url.searchParams.get("dateFrom")).to.eq(monthM2Bounds.dateFrom);
			expect(url.searchParams.get("dateTo")).to.eq(monthM2Bounds.dateTo);

		});
		// Same 304 trap as the first test above: the body comes from `cy.request`, same query.
		cy.request<Array<{ id: string }>>({
			url: `${api}/api/documents/dashboard`,
			qs: { dateFrom: monthM2Bounds.dateFrom, dateTo: monthM2Bounds.dateTo },
		}).then(({ body: widgets }) => {
			expect(widgets.some((w) => w.id.startsWith("invoice:collected-in-period"))).to.eq(true);
			expect(widgets.some((w) => w.id.startsWith("invoice:collected-this-month"))).to.eq(false);
		});

		// "Invoiced in period" only ever sees invoiceB (issued INSIDE M-2): 500. invoiceA was
		// issued M-3, outside this period, so it never enters this ISSUE-date figure at all.
		cy.get('[data-cy="widget-invoice:issued-in-period:EUR"]', { timeout: 20000 }).should(
			"contain.text",
			"500",
		);
		// "Collected in period" only ever sees invoiceA's own payment (PAID inside M-2): 350.
		// invoiceB's own payment landed in M-1, after the period closed, so it never enters this
		// PAYMENT-date figure - the exact reverse of the tile just above.
		cy.get('[data-cy="widget-invoice:collected-in-period:EUR"]', { timeout: 20000 }).should(
			"contain.text",
			"350",
		);

		cy.get('[data-cy="widget-invoice:collected-in-period:EUR-link"]').should("not.exist");
	});
});
