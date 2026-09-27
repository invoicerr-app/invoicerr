export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #419 - clickable dashboard metric tiles.
 *
 * `MetricWidget.link` (backend `contributions/widgets.ts`) names a list URL that reproduces exactly
 * the set a metric aggregates over; `metric-widget.tsx` renders it as an `<a data-cy="widget-<id>-link">`
 * wrapping the existing `data-cy="widget-<id>"` card, `metric-link.ts` builds the href, and the list
 * page/`document-list.tsx` read the new `settlement` query param as a removable chip. Each assertion
 * below is pinned to a real regression this wiring could reintroduce:
 *
 * - the href built by the frontend and the query param the backend actually reads must agree on every
 *   key (typeId, status, settlement): a rename on either side, undetected by a jest test that mocks
 *   the other side, would otherwise silently break every tile;
 * - the ROWS the linked list shows must be exactly the documents the tile's own figure summed or
 *   counted: a tile that links to "close enough" (e.g. missing the settlement filter, or filtering by
 *   the wrong status) is worse than no link at all, since it looks trustworthy while lying;
 * - the settlement chip must be clearable and must actually drop the filter, not just visually hide it;
 * - a metric with no exactly-matching list must render with no anchor at all, asserted by pinning the
 *   count of `-link` anchors on screen to the count of metrics the API itself marks `link` on, so an
 *   accidental over-linking (a metric wired to a link that doesn't really match its figure) fails here
 *   even though no single "the wrong tile is a link" assertion would catch it;
 * - the quote tile proves the same mechanism composes a different typeId and a different status set,
 *   not something invoice-contributions.ts hardcoded for its own three tiles alone.
 *
 * Screenshots at the end are for the owner (issue #419's own before/after), not assertions.
 */

const api = Cypress.env("apiUrl") || "http://localhost:4000";

/** ISO `YYYY-MM-DD`, offset from the real clock by `days` (negative = past). Computed at run time,
 *  never hard-coded, so the overdue/not-overdue split stays correct however far in the future this
 *  suite is actually run. */
function isoDateOffset(days: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

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

/** `issueDate` fixed well before the FR seller-country "pdp" mandate (2026-09-01, see
 *  43-correction-routes.cy.ts's own header on the same constraint): a plain "email" transport
 *  (Mailpit) is enough to reach "sent" only for an invoice issued before that date. `dueDate` is the
 *  ONLY thing that decides overdue/not-overdue for this spec's own purpose, and it is computed off
 *  the real clock by the caller, independent of `issueDate`. */
function invoiceData(clientId: string, dueDate: string) {
	return {
		client: clientId,
		issueDate: "2026-08-01",
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

describe("Dashboard tile links (#419)", () => {
	let invoiceAId: string; // sent, unpaid, overdue
	let invoiceBId: string; // sent, unpaid, not overdue
	let invoiceCId: string; // sent, paid in full
	let invoiceDId: string; // draft, must never appear in either linked list

	before(() => {
		cy.resetAndSeed();
		cy.login();
		setInvoiceTransport("email");

		const overdueDue = isoDateOffset(-5);
		const futureDue = isoDateOffset(30);
		const paidDue = isoDateOffset(-3);

		createClient("Client Tuile Overdue SARL").then((clientId) => {
			const data = invoiceData(clientId, overdueDue);
			saveDraft(data).then((id) => {
				invoiceAId = id;
				sendInvoice(id, data);
			});
		});

		createClient("Client Tuile Future SARL").then((clientId) => {
			const data = invoiceData(clientId, futureDue);
			saveDraft(data).then((id) => {
				invoiceBId = id;
				sendInvoice(id, data);
			});
		});

		createClient("Client Tuile Payée SARL").then((clientId) => {
			const data = invoiceData(clientId, paidDue);
			saveDraft(data).then((id) => {
				invoiceCId = id;
				sendInvoice(id, data).then(() => recordFullPayment(id, data, isoDateOffset(-2)));
			});
		});

		createClient("Client Tuile Brouillon SARL").then((clientId) => {
			const data = invoiceData(clientId, futureDue);
			saveDraft(data).then((id) => {
				invoiceDId = id;
			});
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it("the pending tile links to /documents/invoice?status=sent&settlement=unsettled and lists exactly A and B", () => {
		cy.visit("/dashboard");
		cy.screenshot("419-dashboard-rest");

		cy.get('[data-cy="widget-invoice:pending-total:EUR-link"]', { timeout: 20000 }).as("pendingLink");

		// The href itself: the exact contract `metric-link.ts` builds and the page reads back. A rename
		// on either side (a query key, a status value) is exactly what this line would catch.
		cy.get("@pendingLink")
			.should("have.attr", "href")
			.and("match", /^\/documents\/invoice\?/)
			.and("include", "status=sent")
			.and("include", "settlement=unsettled");

		// A visible hover affordance, and a focus-visible ring for keyboard nav, for the owner's own
		// before/after screenshots, not an automated assertion beyond "the element exists".
		cy.get("@pendingLink").trigger("mouseover");
		cy.screenshot("419-tile-hover");
		cy.get("@pendingLink").focus();
		cy.screenshot("419-tile-focus");

		cy.intercept({ method: "GET", pathname: "/api/documents", query: { settlement: "unsettled" } }).as(
			"unsettledList",
		);
		cy.get("@pendingLink").click();
		cy.wait("@unsettledList", { timeout: 20000 });

		cy.location("pathname").should("eq", "/documents/invoice");
		cy.location("search").should("include", "settlement=unsettled").and("include", "status=sent");

		cy.get('[data-cy="document-list-settlement-filter"]', { timeout: 10000 })
			.should("be.visible")
			.and("contain.text", "Unpaid only");

		cy.screenshot("419-list-pending");

		// Exactly A and B: never C (settled) or D (draft, and out of "status=sent" anyway).
		cy.get(`[data-cy="document-list-row-${invoiceAId}"]`).should("exist");
		cy.get(`[data-cy="document-list-row-${invoiceBId}"]`).should("exist");
		cy.get(`[data-cy="document-list-row-${invoiceCId}"]`).should("not.exist");
		cy.get(`[data-cy="document-list-row-${invoiceDId}"]`).should("not.exist");

		// Clearing the chip drops the param and brings the settled invoice C back (it is still "sent").
		cy.intercept({ method: "GET", pathname: "/api/documents", query: { typeId: "invoice" } }).as(
			"unfilteredList",
		);
		cy.get('[data-cy="document-list-settlement-filter-clear"]').click();
		cy.wait("@unfilteredList", { timeout: 20000 });
		cy.location("search").should("not.include", "settlement");
		cy.get('[data-cy="document-list-settlement-filter"]').should("not.exist");
		cy.get(`[data-cy="document-list-row-${invoiceCId}"]`, { timeout: 10000 }).should("exist");
	});

	it("the overdue tile links to settlement=overdue and lists only A", () => {
		cy.visit("/dashboard");
		cy.get('[data-cy="widget-invoice:overdue-total:EUR-link"]', { timeout: 20000 })
			.should("have.attr", "href")
			.and("include", "settlement=overdue")
			.and("include", "status=sent");

		cy.intercept({ method: "GET", pathname: "/api/documents", query: { settlement: "overdue" } }).as(
			"overdueList",
		);
		cy.get('[data-cy="widget-invoice:overdue-total:EUR-link"]').click();
		cy.wait("@overdueList", { timeout: 20000 });

		cy.location("search").should("include", "settlement=overdue");
		cy.get('[data-cy="document-list-settlement-filter"]', { timeout: 10000 }).should(
			"contain.text",
			"Overdue only",
		);
		cy.screenshot("419-list-overdue");

		cy.get(`[data-cy="document-list-row-${invoiceAId}"]`).should("exist");
		cy.get(`[data-cy="document-list-row-${invoiceBId}"]`).should("not.exist");
		cy.get(`[data-cy="document-list-row-${invoiceCId}"]`).should("not.exist");
		cy.get(`[data-cy="document-list-row-${invoiceDId}"]`).should("not.exist");
	});

	it("the quote tile links to status=draft&status=sent: a different typeId, a different status set, same mechanism", () => {
		cy.visit("/dashboard");
		cy.get('[data-cy="widget-quote:open-count-link"]', { timeout: 20000 })
			.should("have.attr", "href")
			.then((href) => {
				expect(href, "typeId").to.match(/^\/documents\/quote\?/);
				const params = new URLSearchParams(String(href).split("?")[1] ?? "");
				expect(params.getAll("status").sort(), "les deux statuts ouverts, rien de plus").to.deep.equal(
					["draft", "sent"].sort(),
				);
				expect(params.has("settlement"), "settlement n'a aucun sens pour un devis").to.eq(false);
			});
	});

	it("a metric tile is a link if and only if the API itself marked it with `link`: no over-linking, no under-linking", () => {
		cy.request({ url: `${api}/api/documents/dashboard` }).then((res) => {
			expect(res.status).to.eq(200);
			const widgets = res.body as Array<{ kind: string; id: string; link?: unknown }>;
			const metricsWithLink = widgets.filter((w) => w.kind === "metric" && !!w.link);
			const metricsWithoutLink = widgets.filter((w) => w.kind === "metric" && !w.link);
			// A shortList/timeSeries widget never carries `link` at all (`MetricWidgetLink` is a field on
			// `MetricWidget` only, widgets.ts), but nothing stops a future renderer from wrapping one in an
			// anchor by mistake, so this is worth pinning explicitly rather than assumed.
			const nonMetricWidgets = widgets.filter((w) => w.kind !== "metric");

			cy.visit("/dashboard");
			cy.get('[data-cy^="widget-"]', { timeout: 20000 }).should("exist");

			// Every metric the API marked `link` on: its anchor exists on screen.
			for (const metric of metricsWithLink) {
				cy.get(`[data-cy="widget-${metric.id}-link"]`, { timeout: 20000 }).should("exist");
			}

			// Every metric the API left linkless (today: none on the dashboard, invoice:count, the one
			// linkless metric this codebase has, only ever contributes to 'statistics', a different
			// location this test does not fetch): no anchor for it, plain card renders instead. Written
			// as a loop rather than assumed away, so the day a linkless dashboard metric is added, this
			// test starts covering it for free instead of needing a rewrite.
			for (const metric of metricsWithoutLink) {
				cy.get(`[data-cy="widget-${metric.id}-link"]`).should("not.exist");
				cy.get(`[data-cy="widget-${metric.id}"]`, { timeout: 20000 }).should("exist");
			}

			// A shortList/timeSeries widget is never itself wrapped in a "-link" anchor: only the metric
			// card inside a metric tile ever is.
			for (const widget of nonMetricWidgets) {
				cy.get(`[data-cy="widget-${widget.id}-link"]`).should("not.exist");
			}

			// The count of widget `-link` anchors on screen equals exactly the count the API sent (scoped to
			// `widget-` ids: the sidebar's own `sidebar-*-link` entries share the suffix). Catches an
			// extra link on some other widget id this test did not enumerate (a stray "-link" suffix
			// reused for something unrelated) that the per-id checks above would silently miss, and,
			// since every dashboard metric happens to carry a link today, is what actually proves "no
			// over-linking" in this test run, not just "every widget I named individually looks right".
			cy.get('[data-cy^="widget-"][data-cy$="-link"]').should("have.length", metricsWithLink.length);
		});
	});
});
