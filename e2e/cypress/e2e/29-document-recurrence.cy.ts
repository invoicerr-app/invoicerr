export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Recurrences — proven through the screen, same discipline as 17/21/24/28:
 * the recurrence is created by a real click on "Recurrence" + filling in the dialog, the appearance
 * of the duplicate is observed in the LIST (a reloaded screen, never a DOM poll on a
 * React Query request that does not restart on its own for a plain draft), and the
 * ASSERTIONS that matter reread the record via the API in addition to the screen.
 *
 * The mechanism is generic (documents/schedules/) — this spec exercises it on the ONE type that
 * declares it today with real product stakes: the invoice (see duplicate-extension.ts and
 * documents-core.module.ts). The first occurrence is deliberately IN THE PAST: the sweep
 * (schedule-sweep.ts) must consider it due on the very next pass, without any human having to
 * wait a real month.
 *
 * The sweep interval is driven by `DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS` (default 60s,
 * far too slow for a test) — backend/.env.test sets it to 5s for THIS test stack
 * only (a versioned file, not a secret). The wait delay below is calibrated on this
 * KNOWN value (>= 3 passes, margin included) — never tightened on the assertion itself: an
 * assertion that would fail with a 60s interval would fail just as honestly here.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
// >= 3 sweep passes (5s/pass in test) + network/render margin. Still used below for the ONE wait
// that has no positive fact to poll for (proving nothing new appears after disabling) — never to
// tighten an assertion: whether the real interval is 5s (here) or 60s (by default), that assertion
// stays the same.
const SWEEP_WAIT = 18000;

/**
 * Polls `GET /api/documents?typeId=invoice` until it carries more than `beforeCount` documents, or
 * ~20s (bounded, matching `SWEEP_WAIT`'s own margin) elapse — replaces a fixed `cy.wait(SWEEP_WAIT)`
 * for the ONE outcome here that IS positively observable (unlike the "nothing more appears after
 * disabling" case further down, which genuinely has nothing to poll for). A fixed sleep either wastes
 * time past a quick sweep pass or, under CI contention, is not long enough — the same "bounded
 * polling loop" shape `waitForDocumentStatus`/`getLastEmail` (support/commands.ts) already hold for
 * the identical "an async worker will eventually do X" problem.
 */
function waitForDuplicate(beforeCount: number, attemptsLeft = 20): Cypress.Chainable<{ id: string }[]> {
	return cy
		.request({ url: `${api}/api/documents?typeId=invoice` })
		.its("body")
		.then((docs: { id: string }[]) => {
			if (docs.length > beforeCount || attemptsLeft <= 0) return cy.wrap(docs);
			cy.wait(1000);
			return waitForDuplicate(beforeCount, attemptsLeft - 1);
		});
}

describe("Recurrences — replaying \"Duplicate\" on a document, on a cadence, from the screen", () => {
	before(() => {
		cy.resetAndSeed();

		// "send" on an invoice needs a transport configured (see invoice-actions.ts) — set up
		// once, as 24/28 do for their own suites (not exercised by THIS spec — thenSend stays
		// disabled here, see the header on this test's own scope).
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
		});
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
								lines: [
									{ description: "Recurring consulting", quantity: 1, unit: "unit", unitPrice: 150, vatRate: "20" },
								],
							},
						},
						failOnStatusCode: false,
					})
					.then((res) => {
						expect(res.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
						return res.body.document.id as string;
					});
			});
	}

	it("a recurrence created with a first occurrence in the past produces a duplicate in the list, advances nextRunAt, then produces no more once disabled", () => {
		let beforeCount = 0;
		let sourceInvoiceId = "";

		createDraftInvoice()
			.then((invoiceId) => {
				sourceInvoiceId = invoiceId;
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 }).should("exist");
				return cy.request({ url: `${api}/api/documents?typeId=invoice` }).its("body");
			})
			.then((before: { id: string }[]) => {
				beforeCount = before.length;

				// A real click — never a direct call to the schedule creation API, which
				// would bypass the screen.
				// The entry lives in the row's "more" menu — open the first row's, then click it.
				cy.get('[data-cy^="document-row-menu-"]').first().scrollIntoView().click();
				cy.get('[data-cy^="document-recurrence-button-"]', { timeout: 10000 }).first().click();
				cy.get('[data-cy="create-recurrence-dialog"]', { timeout: 10000 }).should("be.visible");

				// Cadence: "Yearly", not the default value ("Monthly") — with a first occurrence
				// chosen 2 MONTHS in the past (see below), a monthly cycle would require several
				// catch-ups (one occurrence per sweep pass) before
				// coming back into the future, producing SEVERAL duplicates during this test — a yearly
				// cycle only needs ONE, which is precisely what this test verifies.
				cy.openSelect(
					'[data-cy="document-field-cadence-input"] button',
					'[data-cy="document-field-cadence-input-option-yearly"]',
				);

				// Same open-side race `cy.pickToday` guards against (a still-detaching outside-pointerdown
				// listener from the PREVIOUS Radix layer swallowing this trigger's click) — this dialog
				// never reaches `pickToday` itself (it drives the month-navigation buttons, not "Today"),
				// so it needs the same protection via the extracted helper.
				cy.openDatePicker('[data-cy="document-field-firstOccurrenceAt-input"]');
				// Goes back two months in the calendar (react-day-picker) to land on a date
				// unambiguously in the past.
				cy.get(".rdp-button_previous").click().click();
				// The 1st displayed day carrying the label "1" — the exact month doesn't matter (two
				// steps back are enough to guarantee it's in the past), and never a bet on the
				// day/month format the browser's own locale would give the `data-day` attribute: this
				// relies only on the button's own DISPLAYED TEXT.
				cy.get('[data-day]').contains(/^1$/).first().click({ force: true });

				cy.get('[data-cy="create-recurrence-confirm"]').click();
				cy.get('[data-cy="create-recurrence-dialog"]').should("not.exist");
			})
			.then(() => {
				// The real sweep (BullMQ/Redis) needs time to run several times — polled, never a fixed
				// sleep (see `waitForDuplicate`'s own header above).
				waitForDuplicate(beforeCount);

				// The duplicate's appearance is ALSO observed IN THE LIST — a screen reload,
				// never a DOM poll on a React Query request that does not restart on its
				// own for a draft with no "sending" action in progress (see use-document-types.ts).
				cy.visit("/documents/invoice");
				cy.get('[data-cy="document-list-cards"]', { timeout: 15000 })
					.find('[data-cy^="document-list-row-"]')
					.should("have.length", beforeCount + 1);
			})
			.then(() => cy.request({ url: `${api}/api/documents?typeId=invoice` }).its("body"))
			.then((after: { id: string; data: Record<string, unknown> }[]) => {
				expect(after, "un seul duplicata est apparu").to.have.length(beforeCount + 1);
				const duplicate = after.find((doc) => doc.id !== sourceInvoiceId);
				expect(duplicate, "le duplicata existe, distinct de la source").to.exist;
				// The first-occurrence date (chosen in the calendar, in the past) genuinely
				// REPLACED the source's own ("2026-01-15") — never a verbatim copy; see
				// duplicate-extension.ts's `applyDateRecalc`.
				expect(duplicate?.data.issueDate, "issueDate recalculée sur l'occurrence").to.not.eq("2026-01-15");
			});

		// The recurrences screen (Settings > Recurrences) shows nextRunAt advanced — no longer in the
		// past (the displayed field changes once a sweep has taken place, as above).
		cy.visit("/settings/recurring");
		cy.get('[data-cy="document-schedules-list"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy^="document-schedule-row-"]').first().as("scheduleRow");
		cy.get("@scheduleRow")
			.find('[data-cy^="document-schedule-next-run-"]')
			.invoke("text")
			.should("not.match", /Invalid|NaN/);
		cy.get("@scheduleRow")
			.find('[data-cy^="document-schedule-last-run-"]')
			.invoke("text")
			// "Last: —" as long as no sweep has taken place — here, at least one has already run.
			.should("not.include", "—");

		// Disabling stops everything — toggle from the screen, then verify that NO new
		// duplicate appears after a delay well beyond the sweep interval.
		cy.get("@scheduleRow").find('[data-cy^="document-schedule-toggle-"]').click();
		cy.get("@scheduleRow").find('[data-cy^="document-schedule-disabled-"]').should("exist");

		cy.request({ url: `${api}/api/documents?typeId=invoice` })
			.its("body")
			.then((afterDisable: unknown[]) => {
				const countAfterDisable = afterDisable.length;
				// A NEGATIVE assertion ("nothing more appears") has nothing to positively probe —
				// wait the full delay, then check once.
				cy.wait(SWEEP_WAIT);
				cy.request({ url: `${api}/api/documents?typeId=invoice` })
					.its("body")
					.should((stillSame: unknown[]) => {
						expect(stillSame, "aucun duplicata après désactivation").to.have.length(countAfterDisable);
					});
			});
	});
});
