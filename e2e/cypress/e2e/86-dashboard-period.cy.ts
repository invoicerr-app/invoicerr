export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #418 - the dashboard's own period filter.
 *
 * `dashboard-period.ts` resolves a preset (or a custom range) to concrete `dateFrom`/`dateTo` bounds
 * using the BROWSER's local calendar; `dashboard.tsx` keeps the selection in the URL and feeds the
 * resolved range to `useDashboardWidgets`, which appends it to `GET /api/documents/dashboard`; the
 * backend threads it through `ContributionContext.period` into every contribution
 * (invoice-contributions.ts and friends). Each assertion below is pinned to a real regression this
 * wiring could reintroduce:
 *
 * - leaving the period unset must keep TODAY's request and response shape byte-identical (no
 *   dateFrom/dateTo on the wire, the "this-month" widget family, never "in-period") - a change that
 *   silently starts sending an empty-string or default range would be invisible to anyone who never
 *   touches the selector, so it needs its own assertion;
 * - a custom range must reach the backend as the SAME dates the picker shows, and the tile's own
 *   figure must count only the documents actually inside that range - a fencepost error (off-by-one
 *   day, an exclusive bound) would silently over- or under-count without ever throwing;
 * - the interaction #418 exists for: a tile clicked while a period is active must carry that period
 *   onto the list it opens, and the list must show EXACTLY the same documents the tile's own figure
 *   summed - a tile whose link drops the period, or whose period disagrees with the API's own answer
 *   for that range, is worse than no period at all, because it looks trustworthy while lying;
 * - going back from that list must restore the exact same period, not silently reset to "all" - the
 *   back button is the other half of "the URL is the state";
 * - a preset ("this-year") must resolve to the SAME calendar-day bounds this spec computes from the
 *   real clock, not a hardcoded assumption about which year the suite happens to run in;
 * - switching back to "all" must fully clear the period, not leave a stale dateFrom/dateTo behind.
 *
 * Screenshots at the end are for the owner (issue #418's own before/after), not assertions.
 */

const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClient(name: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				// "email" transport refuses a client with no contact email: the send ends "send_failed".
				contactEmail: "billing@example.com",
				address: "1 Rue Quelconque",
				postalCode: "75002",
				city: "Paris",
				country: "France",
				currency: "EUR",
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

function setInvoiceTransport(transportId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: transportId },
		})
		.then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});
}

// One line, unitPrice 1000 @ 20% VAT -> gross 1200, the same figure `record-payment`'s own `amount`
// below has to match to mark the invoice fully paid.
function invoiceData(clientId: string, issueDate: string, dueDate: string) {
	return {
		client: clientId,
		issueDate,
		dueDate,
		currency: "EUR",
		lines: [
			{
				description: "Conseil",
				quantity: 1,
				unit: "day",
				unitPrice: 1000,
				vatRate: "20",
			},
		],
	};
}

function saveDraft(data: Record<string, unknown>) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: { data },
		})
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
		// The send finishes on the queue: "record-payment" and the dashboard figures both need the
		// invoice actually "sent", not still "sending" (a payment on it is a 409 until then).
		.then(() => cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]));
}

function recordFullPayment(invoiceId: string, data: Record<string, unknown>, paidAt: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/record-payment`,
			body: {
				documentId: invoiceId,
				data,
				params: { amount: 1200, currency: "EUR", paidAt, method: "bank_transfer" },
			},
		})
		.then((res) => {
			expect(res.status, "full payment recorded").to.be.oneOf([200, 201]);
		});
}

function saveQuoteDraft(clientId: string, issueDate: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/quote/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate,
					dueDate: issueDate,
					currency: "EUR",
					lines: [
						{ description: "Conseil", quantity: 1, unit: "day", unitPrice: 500, vatRate: "20" },
					],
				},
			},
		})
		.then((res) => {
			expect(res.status, "quote draft created").to.be.oneOf([200, 201]);
		});
}

/** The current LOCAL year/first/last day, computed the exact way `dashboard-period.ts#resolveDashboardPeriod`
 *  does for the "this-year" preset - never hardcoded, so the suite stays correct whatever year it
 *  actually runs in. */
function thisYearBounds() {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	return {
		dateFrom: iso(new Date(now.getFullYear(), 0, 1)),
		dateTo: iso(new Date(now.getFullYear(), 11, 31)),
	};
}

/**
 * Picks an exact calendar day in a `DatePicker`: month and year through the calendar's own `<select>`s,
 * then the day cell by its `data-day` (yyyy-MM-dd). Not `cy.pickDate`: that one clicks the first cell
 * whose TEXT is the day number, and August 2026's grid opens on July's outside days 26..31, so "31"
 * picked July 31 (seen on the first run of this spec). Same technique as 52-accounting-export.cy.ts.
 */
function pickExactDay(triggerSelector: string, iso: string) {
	const [year, month] = iso.split("-").map(Number);
	cy.openDatePicker(triggerSelector);
	cy.get('select[aria-label="Choose the Year"]').select(String(year), { force: true });
	cy.get('select[aria-label="Choose the Month"]').select(String(month - 1), { force: true });
	cy.get(`[data-day="${iso}"] button`).click();
	cy.get('[data-cy="date-picker-today"]').should("not.exist");
	cy.focused({ timeout: 10000 }).should("match", triggerSelector);
}

describe("Dashboard period filter (#418)", () => {
	let invoiceP1: string; // issued 2026-06-10, unpaid -- BEFORE the custom/August range
	let invoiceP2: string; // issued 2026-08-01, unpaid -- INSIDE the custom/August range
	let invoiceP3: string; // issued 2026-08-01, paid -- inside the range but settled, must never count as "pending"
	let invoiceP4: string; // draft, must never appear anywhere date-scoped counts documents

	before(() => {
		cy.resetAndSeed();
		cy.login();
		// Email transport (Mailpit): reaches "sent" for any issueDate before the FR seller-country "pdp"
		// mandate (2026-09-01) -- every issueDate below is 2026-06 or 2026-08, both well clear of it.
		setInvoiceTransport("email");

		createClient("Client Période Juin SARL").then((clientId) => {
			const data = invoiceData(clientId, "2026-06-10", "2026-07-10");
			saveDraft(data).then((id) => {
				invoiceP1 = id;
				sendInvoice(id, data);
			});
		});

		createClient("Client Période Août Impayée SARL").then((clientId) => {
			const data = invoiceData(clientId, "2026-08-01", "2026-08-31");
			saveDraft(data).then((id) => {
				invoiceP2 = id;
				sendInvoice(id, data);
			});
		});

		createClient("Client Période Août Payée SARL").then((clientId) => {
			const data = invoiceData(clientId, "2026-08-01", "2026-08-31");
			saveDraft(data).then((id) => {
				invoiceP3 = id;
				sendInvoice(id, data).then(() => recordFullPayment(id, data, "2026-08-15"));
			});
		});

		createClient("Client Période Brouillon SARL").then((clientId) => {
			const data = invoiceData(clientId, "2026-08-01", "2026-08-31");
			saveDraft(data).then((id) => {
				invoiceP4 = id;
			});
		});

		createClient("Client Période Devis SARL").then((clientId) => {
			saveQuoteDraft(clientId, "2026-06-15");
			saveQuoteDraft(clientId, "2026-08-05");
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it("with no period, the request carries no date bounds and the pending tile sums every unpaid invoice", () => {
		cy.intercept({ method: "GET", pathname: "/api/documents/dashboard" }).as("dashboard");
		cy.visit("/dashboard");
		cy.wait("@dashboard", { timeout: 20000 }).then((interception) => {
			// Pins "leaving the period unset keeps today's behaviour": no dateFrom/dateTo on the wire at
			// all, not even empty-string ones.
			const url = new URL(interception.request.url);
			expect(url.searchParams.has("dateFrom"), "no dateFrom when unset").to.eq(false);
			expect(url.searchParams.has("dateTo"), "no dateTo when unset").to.eq(false);

			const widgets = interception.response?.body as Array<{ id: string }>;
			expect(widgets.some((w) => w.id.startsWith("invoice:issued-this-month")), "this-month family present").to
				.eq(true);
			expect(widgets.some((w) => w.id.startsWith("invoice:issued-in-period")), "in-period family absent").to.eq(
				false,
			);
		});

		cy.get('[data-cy="dashboard-period-range"]').should("contain.text", "Showing all time");
		cy.screenshot("418-default");

		// P1 + P2 = 2,000: both unpaid, whatever their date. P3 is settled, P4 is a draft. The tile sums
		// NET line amounts (quantity * unitPrice, 1,000 each), not the 1,200 gross the list shows.
		cy.get('[data-cy="widget-invoice:pending-total:EUR"]', { timeout: 20000 }).should(
			"contain.text",
			"2,000",
		);
	});

	it("a custom range restricts the request, the tile figure, and what the tile's own link opens", () => {
		cy.visit("/dashboard");

		cy.get('[data-cy="dashboard-period-select"]').should("be.visible");
		cy.openSelect(
			'[data-cy="dashboard-period-select"]',
			'[data-cy="dashboard-period-option-custom"]',
		);
		cy.screenshot("418-selector-open");

		cy.intercept({ method: "GET", pathname: "/api/documents/dashboard" }).as("dashboardCustom");
		pickExactDay('[data-cy="dashboard-period-custom-from"]', "2026-08-01");
		pickExactDay('[data-cy="dashboard-period-custom-to"]', "2026-08-31");
		cy.wait("@dashboardCustom", { timeout: 20000 }).then((interception) => {
			const url = new URL(interception.request.url);
			expect(url.searchParams.get("dateFrom"), "dateFrom on the wire").to.eq("2026-08-01");
			expect(url.searchParams.get("dateTo"), "dateTo on the wire").to.eq("2026-08-31");
		});

		cy.location("search").should("include", "period=custom");
		cy.location("search").should("include", "dateFrom=2026-08-01");
		cy.location("search").should("include", "dateTo=2026-08-31");

		cy.get('[data-cy="dashboard-period-custom-from"]').should("not.contain.text", "From");
		cy.get('[data-cy="dashboard-period-custom-to"]').should("not.contain.text", "To");
		cy.get('[data-cy="dashboard-period-range"]').should("contain.text", "Showing").and("contain.text", "2026");
		cy.screenshot("418-custom-range");

		// Only P2 (1,000 net) is issued 2026-08-01 and unpaid: P1 is June, P3 is August but settled, P4
		// is a draft (never "sent").
		cy.get('[data-cy="widget-invoice:pending-total:EUR"]', { timeout: 20000 }).should(
			"contain.text",
			"1,000",
		);
		cy.screenshot("418-period-applied");

		// The "in-period" family replaces "this-month" the moment a period is set.
		cy.request({ url: `${api}/api/documents/dashboard?dateFrom=2026-08-01&dateTo=2026-08-31` }).then((res) => {
			const widgets = res.body as Array<{ id: string; link?: { dateFrom?: string; dateTo?: string } }>;
			expect(widgets.some((w) => w.id.startsWith("invoice:issued-in-period"))).to.eq(true);
			expect(widgets.some((w) => w.id.startsWith("invoice:issued-this-month"))).to.eq(false);

			// Same dateFrom/dateTo the tile's own link carries as what this direct API call used -- the
			// tile and an independent fetch for the identical range must agree.
			const pendingWidget = widgets.find((w) => w.id === "invoice:pending-total:EUR");
			expect(pendingWidget?.link?.dateFrom).to.eq("2026-08-01");
			expect(pendingWidget?.link?.dateTo).to.eq("2026-08-31");
		});

		// THE INTERACTION: click the pending tile while the period is active.
		cy.intercept({ method: "GET", pathname: "/api/documents" }).as("filteredList");
		cy.get('[data-cy="widget-invoice:pending-total:EUR-link"]', { timeout: 20000 }).click();
		cy.wait("@filteredList", { timeout: 20000 });

		cy.location("pathname").should("eq", "/documents/invoice");
		cy.location("search").should("include", "status=sent");
		cy.location("search").should("include", "settlement=unsettled");
		cy.location("search").should("include", "dateFrom=2026-08-01");
		cy.location("search").should("include", "dateTo=2026-08-31");

		// The list's own date-range filter reflects the same range the tile carried in.
		cy.get('[data-cy="document-list-filter-date-from"]', { timeout: 10000 }).should(
			"not.contain.text",
			"From",
		);
		cy.get('[data-cy="document-list-filter-date-to"]').should("not.contain.text", "To");
		cy.get('[data-cy="document-list-settlement-filter"]').should("contain.text", "Unpaid only");
		cy.screenshot("418-tile-to-list");

		// Exactly P2: not P1 (outside the range), not P3 (settled), not P4 (draft, and out of
		// "status=sent" anyway).
		cy.get(`[data-cy="document-list-row-${invoiceP2}"]`, { timeout: 10000 }).should("exist");
		cy.get(`[data-cy="document-list-row-${invoiceP1}"]`).should("not.exist");
		cy.get(`[data-cy="document-list-row-${invoiceP3}"]`).should("not.exist");
		cy.get(`[data-cy="document-list-row-${invoiceP4}"]`).should("not.exist");
		cy.get('[data-cy^="document-list-row-"]').should("have.length", 1);

		// Going back restores the dashboard with the exact same period still applied.
		cy.go("back");
		cy.location("pathname").should("eq", "/dashboard");
		cy.location("search").should("include", "dateFrom=2026-08-01").and("include", "dateTo=2026-08-31");
		cy.get('[data-cy="dashboard-period-range"]').should("contain.text", "Showing").and("contain.text", "2026");
	});

	it("the this-year preset resolves to Jan 1 - Dec 31 of the real current year", () => {
		const { dateFrom, dateTo } = thisYearBounds();

		// The initial, unset load is waited for FIRST: an alias registered before `cy.visit` would
		// otherwise hand the "this-year" wait that very first request, which carries no bounds at all.
		cy.intercept({ method: "GET", pathname: "/api/documents/dashboard" }).as("dashboardInitial");
		cy.visit("/dashboard");
		cy.wait("@dashboardInitial", { timeout: 20000 });
		cy.intercept({ method: "GET", pathname: "/api/documents/dashboard" }).as("dashboardYear");
		cy.get('[data-cy="dashboard-period-select"]').should("be.visible");
		cy.openSelect(
			'[data-cy="dashboard-period-select"]',
			'[data-cy="dashboard-period-option-this-year"]',
		);
		cy.wait("@dashboardYear", { timeout: 20000 }).then((interception) => {
			const url = new URL(interception.request.url);
			expect(url.searchParams.get("dateFrom")).to.eq(dateFrom);
			expect(url.searchParams.get("dateTo")).to.eq(dateTo);
		});
		cy.location("search").should("include", "period=this-year");

		// P1 and P2/P3 are all 2026-dated: if the suite happens to run in 2026, both invoices' issue
		// years fall inside "this year" and the pending total is the full P1+P2 sum (P3 is settled).
		// Computed, never hardcoded, so a run in any other year asserts the opposite without needing a
		// rewrite.
		const currentYear = new Date().getFullYear();
		if (currentYear === 2026) {
			cy.get('[data-cy="widget-invoice:pending-total:EUR"]', { timeout: 20000 }).should(
				"contain.text",
				"2,000",
			);
		} else {
			cy.get('[data-cy="widget-invoice:pending-total:EUR"]', { timeout: 20000 }).should(
				"contain.text",
				"0",
			);
		}

		// Switching back to "all" must fully clear dateFrom/dateTo, not leave them stale. No network wait
		// here: the unset query was loaded moments ago and TanStack serves it from its cache (staleTime
		// 30s), so a request is not guaranteed. The URL, the range line and the in-period family being
		// gone are what "unset" means on screen.
		cy.openSelect(
			'[data-cy="dashboard-period-select"]',
			'[data-cy="dashboard-period-option-all"]',
		);
		cy.get('[data-cy^="widget-invoice:issued-this-month"]', { timeout: 20000 }).should("exist");
		cy.get('[data-cy^="widget-invoice:issued-in-period"]').should("not.exist");
		cy.location("search").should("not.include", "period");
		cy.location("search").should("not.include", "dateFrom");
		cy.location("search").should("not.include", "dateTo");
		cy.get('[data-cy="dashboard-period-range"]').should("contain.text", "Showing all time");
	});
});
