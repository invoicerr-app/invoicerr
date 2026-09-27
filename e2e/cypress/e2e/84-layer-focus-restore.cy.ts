/**
 * Issue #451 / PR #456 — the ONLY e2e guard for `frontend/src/lib/close-auto-focus-guard.ts`.
 *
 * Why this spec exists: every other spec that crosses a Radix layer teardown (29, 43, 02, anything
 * using `waitForLayerTeardown` / `pickDocumentFieldOption`) waits for the closed layer's deferred
 * focus restore to have run BEFORE opening the next layer. Those waits (#450, #455) are deliberate
 * and must stay — without them the suites flake — but they cover exactly the window in which the
 * #451 race happens, so those specs stay green with the guard deleted. Measured on 2026-09-24,
 * Chromium 141: guard disabled, 29/43/02 all green. They do NOT protect this behaviour; this file
 * does.
 *
 * The race is made observable by construction, never by speed. A test that simply "clicks fast"
 * (no teardown wait) caught the regression 2 runs out of 5 — a die, not a guard. Two deterministic
 * handles instead:
 *
 *  A. Observe the event, not its consequence. Radix's `FocusScope` restores focus from a
 *     `setTimeout(..., 0)` scheduled at unmount, after dispatching `focusScope.autoFocusOnUnmount`
 *     on the (detached) content node, then — unless prevented — `focus(previouslyFocusedElement)`
 *     in the same callback. A listener on that content node tells us the restore HAS run; a
 *     capture-phase `focusin` recorder tells us whether it moved focus to the row menu's trigger
 *     while the dialog it opened was up. The dialog mounts synchronously in the menu entry's own
 *     handler, so it is up before the deferred restore every single time: no timing involved.
 *
 *  B. Hold the restore with a fake clock. `cy.clock` over `setTimeout` alone (never `Date`) keeps
 *     the deferred restore pending for as long as the test wants, i.e. the window is made infinite
 *     rather than widened. The cadence picker is opened INSIDE it, then `cy.tick` releases the
 *     restore, and the picker must still be there — the user-visible symptom #451 reported. The
 *     exit animation still runs on real time (CSS, not a timer), which is why the content's
 *     removal is waited on before the picker is opened.
 *
 * Measured on 2026-09-24, Chromium 141, isolated stack: guard in place 10/10 green (both tests);
 * guard disabled (`guardCloseAutoFocus` returning before its check) 5/5 red on BOTH — A with a
 * non-empty `stolen` list, B with "cadence options still mounted: expected null to exist".
 * CI runs this under Firefox; the mechanism is Radix's own JS, not browser-specific, but Firefox
 * was not available where this was measured.
 *
 * Out of scope here: a regression the OTHER way (the guard suppressing the restore outright,
 * stranding keyboard users on <body>) — `waitForLayerTeardown`'s focus assertion already fails on
 * that, see its header in support/commands.ts.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// `@radix-ui/react-focus-scope`'s own AUTOFOCUS_ON_UNMOUNT constant.
const RESTORE_EVENT = "focusScope.autoFocusOnUnmount";

describe("Layer focus restore — never steals focus from a layer the user already opened (issue #451)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	function createDraftInvoice(): Cypress.Chainable<string> {
		return cy
			.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);
				return cy
					.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/save-draft`,
						body: {
							data: {
								client: clients[0].id,
								issueDate: "2026-01-15",
								dueDate: "2026-01-30",
								currency: "EUR",
								lines: [{ description: "Focus probe", quantity: 1, unit: "unit", unitPrice: 10, vatRate: "20" }],
							},
						},
					})
					.then((res) => res.body.document.id as string);
			});
	}

	it("A: the row menu's deferred restore never focuses its trigger once the dialog it opened is up", () => {
		createDraftInvoice().then((id) => {
			const trigger = `[data-cy="document-row-menu-${id}"]`;
			const content = `[data-cy="document-row-menu-content-${id}"]`;
			cy.visit("/documents/invoice");
			cy.openDocumentRowMenu(id);

			const log = { restoreRan: false, stolen: [] as string[] };
			// On the content node itself: the restore event is dispatched on it AFTER it left the
			// DOM, so it never bubbles to `document`. Registered before Radix's own listener (added
			// inside the timer), so it runs before the focus move — which then happens synchronously
			// in the same callback, long before Cypress's next retry reads the flag.
			cy.get(content).then(($content) => {
				$content[0].addEventListener(RESTORE_EVENT, () => {
					log.restoreRan = true;
				});
			});
			cy.document().then((doc) => {
				doc.addEventListener(
					"focusin",
					(event) => {
						const dialogOpen = doc.querySelector('[data-cy="create-recurrence-dialog"]') !== null;
						if (dialogOpen && (event.target as Element).matches(trigger)) {
							log.stolen.push("row menu trigger focused while the recurrence dialog was open");
						}
					},
					true,
				);
			});

			cy.get(`[data-cy="document-recurrence-button-${id}"]`).click();
			cy.get('[data-cy="create-recurrence-dialog"]').should("be.visible");
			cy.wrap(log, { timeout: 10000 }).its("restoreRan").should("eq", true);
			cy.wrap(log).its("stolen").should("deep.equal", []);
		});
	});

	it("B: a picker opened while the menu's restore is still pending stays open once it runs", () => {
		createDraftInvoice().then((id) => {
			const content = `[data-cy="document-row-menu-content-${id}"]`;
			const options = '[data-cy="document-field-cadence-input-options"]';
			cy.visit("/documents/invoice");
			cy.openDocumentRowMenu(id);

			// Only now: the page and its queries are loaded (react-query schedules its own notifies
			// on setTimeout, which a clock installed at visit time would freeze too).
			cy.clock(Date.now(), ["setTimeout", "clearTimeout"]);
			cy.get(`[data-cy="document-recurrence-button-${id}"]`).click();
			cy.get('[data-cy="create-recurrence-dialog"]').should("be.visible");
			cy.get(content).should("not.exist");
			cy.get('[data-cy="document-field-cadence-input"] button').click();
			cy.get(options).should("be.visible");

			cy.tick(1);
			// Two frames for React to commit whatever the released restore set in motion, then a
			// NON-retrying read: a retrying `should` could pass on its first attempt before the
			// dismissal lands.
			cy.window().then(
				(win) => new Cypress.Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))),
			);
			cy.document().then((doc) => {
				expect(doc.querySelector(options), "cadence options still mounted").to.exist;
				expect(doc.activeElement?.matches(`[data-cy="document-row-menu-${id}"]`), "row trigger focused").to.eq(false);
			});
		});
	});
});
