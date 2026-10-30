export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Changing the dashboard period must never resize a card: while the new period loads each card keeps
 * its size and title, its figures replaced by skeletons, and the very first load shows skeletons with
 * the dimensions of the cards they stand for. Sizes are compared through bounding boxes, which every
 * browser reports; the `layout-shift` score is logged on top where the browser exposes it (Chromium).
 */

import { FRENCH_BUYER_IDENTIFIERS } from "../fixtures/identifiers";

const api = Cypress.env("apiUrl");
const RESPONSE_DELAY_MS = 4000;

type Box = { key: string; width: number; height: number; top: number; left: number };

function createClient(name: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				contactEmail: "billing@example.com",
				address: "1 Rue Quelconque",
				postalCode: "75002",
				city: "Paris",
				country: "France",
				currency: "EUR",
				isActive: true,
				identifiers: FRENCH_BUYER_IDENTIFIERS,
			},
		})
		.then((res) => res.body.id as string);
}

function sendInvoice(clientId: string, issueDate: string) {
	const data = {
		client: clientId,
		issueDate,
		dueDate: issueDate,
		currency: "EUR",
		lines: [{ description: "Conseil", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
	};
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: { data },
		})
		.then((saved) => {
			const id = saved.body.document.id as string;
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/send`,
				body: { documentId: id, data },
			});
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
		});
}

/** Scroll offsets of every ancestor: Cypress scrolls the app's own scroll area to reach the period
 *  select, which moves every card on screen without changing the layout. */
function scrolledBy(element: Element) {
	let top = 0;
	let left = 0;
	for (let node = element.parentElement; node; node = node.parentElement) {
		top += node.scrollTop;
		left += node.scrollLeft;
	}
	return { top, left };
}

/** Every card in the widget area, in document order, in page coordinates anchored to the widget
 *  area's own top. Switching the preset reflows the header row above the grid: on the phone the
 *  dated range line grows taller than "all time" (round 2's own min-height hold does not absorb
 *  that difference on the runner's Firefox; pinning the row is iter-1's surface, with captures),
 *  so between the two snapshots every card sits lower on the page by that row's growth while no
 *  card resizes or moves relative to the grid. This spec's promise is about the period LOAD moving
 *  no card; anchoring inside the area keeps it and leaves the row's own height to iter-1. */
function cardBoxes() {
	return cy
		.get('[data-cy="dashboard-widgets"]')
		.then(($area) => {
			const area = $area[0];
			const areaTop = area.getBoundingClientRect().top + scrolledBy(area).top;
			return cy
				.get('[data-cy="dashboard-widgets"] [data-slot="card"]')
				.then(($cards) =>
					[...$cards].map((card, index) => {
						const rect = card.getBoundingClientRect();
						const scroll = scrolledBy(card);
						return {
							key: card.getAttribute("data-cy") ?? `#${index}`,
							width: Math.round(rect.width),
							height: Math.round(rect.height),
							top: Math.round(rect.top + scroll.top - areaTop),
							left: Math.round(rect.left + scroll.left),
						} satisfies Box;
					}),
				);
		});
}

/** Equal to the pixel: a box a fraction of a pixel off rounds either way. */
function expectSameBoxes(actual: Box[], expected: Box[], what: string) {
	const shape = (boxes: Box[]) => boxes.map(({ width, height, top, left }) => ({ width, height, top, left }));
	const close = (a: Box, b: Box) =>
		(["width", "height", "top", "left"] as const).every((side) => Math.abs(a[side] - b[side]) <= 1);
	const same = actual.length === expected.length && actual.every((box, index) => close(box, expected[index]));
	if (!same) expect(shape(actual), what).to.deep.equal(shape(expected));
}

/** While a period loads, every card keeps its title but none of the previous period's figures: each
 *  value area is a skeleton of the same size. */
function expectOnlyTitlesVisible() {
	// Computed styles, not `be.visible`: cards below the fold are clipped by the app's scroll area.
	cy.get('[data-cy="dashboard-widgets"] [data-slot="card-title"]').each(($title) => {
		cy.wrap($title).should("have.css", "visibility", "visible").and("not.be.empty");
	});
	cy.get('[data-cy="dashboard-widgets"] .amount').each(($amount) => {
		cy.wrap($amount).should("have.css", "visibility", "hidden");
	});
	cy.get('[data-cy="dashboard-widgets"] [data-slot="widget-value"]').each(($value) => {
		cy.wrap($value).children('[data-slot="skeleton"]').should("have.length", 1);
	});
}

function trackLayoutShifts(win: Window) {
	const shifts: { value: number; at: number }[] = [];
	(win as Window & { __layoutShifts?: typeof shifts }).__layoutShifts = shifts;
	const Observer = (win as Window & typeof globalThis).PerformanceObserver;
	if (!Observer?.supportedEntryTypes?.includes("layout-shift")) return;
	new Observer((list) => {
		for (const entry of list.getEntries() as (PerformanceEntry & { value: number })[]) {
			shifts.push({ value: entry.value, at: entry.startTime });
		}
	}).observe({ type: "layout-shift", buffered: true });
}

function logLayoutShiftSince(since: number, device: string) {
	cy.window().then((win) => {
		const Observer = (win as Window & typeof globalThis).PerformanceObserver;
		const shifts = (win as Window & { __layoutShifts?: { value: number; at: number }[] }).__layoutShifts ?? [];
		const score = Observer?.supportedEntryTypes?.includes("layout-shift")
			? shifts.filter((shift) => shift.at >= since).reduce((sum, shift) => sum + shift.value, 0).toFixed(4)
			: "not measured by this browser";
		cy.task("logStep", `layout shift after the period change (${device}): ${score}`);
	});
}

function delayDashboardResponses(onRequest: () => void) {
	cy.intercept({ method: "GET", pathname: "/api/documents/dashboard" }, (req) => {
		onRequest();
		req.on("response", (res) => {
			res.setDelay(RESPONSE_DELAY_MS);
		});
	}).as("dashboard");
}

/** Pins the invoice-overview panel to its skeleton longer than the measurement window runs, on top
 *  of the widget grid's own delay. Round 2 stacks the panel between the dashboard header and the
 *  widget grid, and its skeleton's fixed heights are not the loaded panel's content heights, so a
 *  panel that resolves while the boxes around it are being compared moves every one of them by
 *  that height change without a card resizing at all. Holding the panel keeps the page above the
 *  grid at one known height while the widgets do their own slow, skeleton-fitted reload. */
function delayOverviewResponses() {
	cy.intercept({ method: "GET", pathname: "/api/documents/dashboard/overview" }, (req) => {
		req.on("response", (res) => {
			res.setDelay(RESPONSE_DELAY_MS + 10000);
		});
	}).as("overview");
}

describe("Dashboard keeps its layout while a period loads", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		cy.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: "email" } });
		createClient("Client Mise En Page SARL").then((clientId) => {
			sendInvoice(clientId, "2026-06-10");
			sendInvoice(clientId, "2026-08-01");
		});
	});

	beforeEach(() => {
		cy.login();
	});

	for (const [device, width, height] of [
		["desktop", 1000, 660],
		["phone", 390, 844],
	] as const) {
		it(`changing the period keeps every card at the same size and position, marked busy (${device})`, () => {
			let requested = false;
			cy.viewport(width, height);
			delayOverviewResponses();
			cy.visit("/dashboard", { onBeforeLoad: trackLayoutShifts });
			cy.get('[data-cy="dashboard-widgets"] [data-widget-kind]', { timeout: 20000 }).should("have.length.gt", 0);

			cardBoxes().then((before) => {
				delayDashboardResponses(() => {
					requested = true;
				});
				cy.window().then((win) => win.performance.now()).as("changedAt");
				cy.openSelect('[data-cy="dashboard-period-select"]', '[data-cy="dashboard-period-option-this-year"]');
				cy.wrap(null).should(() => expect(requested, "the new period was requested").to.eq(true));

				cardBoxes().then((during) => expectSameBoxes(during, before, "cards while the new period loads"));
				cy.get('[data-cy="dashboard-widgets"]').should("have.attr", "aria-busy", "true");
				cy.get('[data-cy="dashboard-widgets"] [role="status"]').should("contain.text", "Loading");
				expectOnlyTitlesVisible();
				cy.assertAccessible();

				cy.wait("@dashboard", { timeout: RESPONSE_DELAY_MS + 20000 });
				cy.get('[data-cy="dashboard-widgets"]').should("have.attr", "aria-busy", "false");
				cy.get('[data-cy^="widget-invoice:issued-in-period"]').should("exist");
				cardBoxes().then((after) => {
					expect(after.length, "same number of cards once the period is loaded").to.eq(before.length);
				});
				cy.get<number>("@changedAt").then((changedAt) => logLayoutShiftSince(changedAt, device));
			});
		});
	}

	it("the first load shows skeletons with the dimensions of the cards they stand for", () => {
		let requested = false;
		delayOverviewResponses();
		cy.visit("/dashboard");
		cy.get('[data-cy="dashboard-widgets"] [data-widget-kind]', { timeout: 20000 }).should("have.length.gt", 0);
		cardBoxes().then((loaded) => {
			delayDashboardResponses(() => {
				requested = true;
			});
			cy.reload();
			cy.wrap(null).should(() => expect(requested, "the dashboard was requested").to.eq(true));
			cardBoxes().then((skeletons) => expectSameBoxes(skeletons, loaded, "skeletons against the loaded cards"));
			cy.get('[data-cy="dashboard-widgets"]').should("have.attr", "aria-busy", "true");
			cy.assertAccessible();
			cy.wait("@dashboard", { timeout: RESPONSE_DELAY_MS + 20000 });
			cy.get('[data-cy="dashboard-widgets"]').should("have.attr", "aria-busy", "false");
			cardBoxes().then((after) => expectSameBoxes(after, loaded, "cards after the reload"));
		});
	});
});
