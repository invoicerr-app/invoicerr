export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Time tracking & project billing ("suivi du temps & facturation de projets"). Actions run through the
 * screen (create the project, log the two entries, select+generate), assertions read back through
 * the API — the same discipline every other spec in this suite holds. The property this test proves
 * hardest is the one the feature exists to guarantee: an entry, once billed, can never be billed
 * again — see the backend's `TimeEntriesService.billToInvoice` for the atomic guard this exercises.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface ClientRow {
	id: string;
	name: string;
}
interface ProjectRow {
	id: string;
	name: string;
}
interface TimeEntryRow {
	id: string;
	invoiceId: string | null;
	durationMinutes: number;
}
interface InvoiceLine {
	quantity: number;
	unitPrice: number;
	unit: string;
}
interface DocumentRow {
	id: string;
	status: string;
	data: { lines: InvoiceLine[] };
}

/**
 * Replaces a `type="number"` input's value outright. `.clear().type(v)` was observed to leave the
 * field's own stale default digit in place with the new value inserted BEFORE it (typing "2" over an
 * untouched default of 1 produced "21", not "2"), and a plain `.invoke("val", v).trigger("input")`
 * was silently ignored (React re-rendered the field straight back to its old value). Both are the
 * well-known React-controlled-input friction with Cypress: React patches the input's `value` SETTER
 * on the element instance to track "did this change for real"; going through that patched setter
 * (`.val()`, `.clear()`, direct `.value =`) never registers as a change React's own event system
 * reacts to. Writing through the ORIGINAL, unpatched setter on `HTMLInputElement.prototype` — before
 * React installed its own — then dispatching a real `input` event is the standard, reliable fix.
 */
function setNumberInput(selector: string, value: string) {
	cy.get(selector).then(($input) => {
		const input = $input[0] as HTMLInputElement;
		const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
			?.set;
		nativeSetter?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

describe("Time tracking — logging hours, billing them, and the double-billing guard", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	it("logs time through the screen, bills the selected entries into one draft invoice, and refuses to bill them a second time", () => {
		const projectName = `Website redesign ${Date.now()}`;

		cy.visit("/time-tracking");
		cy.get('[data-cy="project-add-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="project-dialog"]').should("be.visible");

		// The seeded "Test Client" (cy.resetAndSeed) — same reused-baseline convention every other
		// spec in this suite already relies on.
		cy.get('[data-cy="project-client-select"] button').first().click({ force: true });
		cy.get('[data-cy="project-client-select-options"]', { timeout: 10000 }).should("be.visible");
		cy.contains('[data-cy="project-client-select-options"] button', "Test Client").click({ force: true });

		cy.get('[data-cy="project-name-input"]').type(projectName);
		setNumberInput('[data-cy="project-hourly-rate-input"]', "100");
		cy.get('[data-cy="project-submit"]').click();
		cy.get('[data-cy="project-dialog"]').should("not.exist");

		// Select the freshly created project.
		cy.contains("button", projectName, { timeout: 10000 }).click();
		cy.get('[data-cy="time-entry-panel"]', { timeout: 10000 }).should("be.visible");

		// Walks the entry wizard's own three steps (time-entry-upsert.tsx, a
		// components/ui/stepped-dialog.tsx wizard: Task -> Duration -> Billing, owner decision
		// 2026-09-16) — description on step 1, hours on step 2, then straight to the last step's
		// own submit (billing is left at its defaults: billable, no rate override).
		const logEntry = (hours: string, description: string) => {
			cy.get('[data-cy="time-entry-add-button"]').click();
			cy.get('[data-cy="time-entry-dialog"]').should("be.visible");
			cy.get('[data-cy="time-entry-description-input"]').type(description);
			cy.continueSteppedDialog("time-entry-dialog"); // task -> duration
			setNumberInput('[data-cy="time-entry-hours-input"]', hours);
			cy.continueSteppedDialog("time-entry-dialog"); // duration -> billing
			cy.get('[data-cy="time-entry-submit"]').click();
			cy.get('[data-cy="time-entry-dialog"]').should("not.exist");
		};
		// 2h + 3h at 100/h → 500 total, split across two lines (never merged into one).
		logEntry("2", "Homepage layout");
		logEntry("3", "API integration");

		cy.contains("Homepage layout", { timeout: 10000 }).should("exist");
		cy.contains("API integration").should("exist");

		// Select both unbilled entries and generate the invoice, through the screen.
		cy.get('[data-cy="time-entry-select-all"]').click();
		cy.get('[data-cy="generate-invoice-button"]').click();
		cy.get('[data-cy="generate-invoice-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="generate-invoice-total"]').should("contain.text", "500");
		cy.get('[data-cy="generate-invoice-confirm"]').click();
		cy.get('[data-cy="generate-invoice-dialog"]').should("not.exist");

		// ASSERT VIA API — the exact shape billed, and the double-billing attempt.
		cy.request(`${api}/api/clients/search?query=`).then((clientsRes) => {
			const client = (clientsRes.body as ClientRow[]).find((c) => c.name === "Test Client");
			expect(client, "seeded client resolves").to.exist;
			const clientId = client!.id;

			cy.request(`${api}/api/projects`).then((projectsRes) => {
				const project = (projectsRes.body as ProjectRow[]).find((p) => p.name === projectName);
				expect(project, "the project created through the screen exists").to.exist;
				const projectId = project!.id;

				cy.request(`${api}/api/time-entries?projectId=${projectId}`).then((entriesRes) => {
					const entries = entriesRes.body as TimeEntryRow[];
					expect(entries, "both entries logged").to.have.length(2);
					for (const entry of entries) {
						expect(entry.invoiceId, `entry ${entry.id} marked billed`).to.be.a("string");
					}
					const invoiceId = entries[0].invoiceId as string;
					expect(entries[1].invoiceId, "both entries billed to the SAME invoice").to.eq(invoiceId);
					const entryIds = entries.map((entry) => entry.id);

					cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`).then((docRes) => {
						expect(docRes.status).to.eq(200);
						const document = docRes.body as DocumentRow;
						expect(document.status, "created as a draft, never auto-sent").to.eq("draft");

						const lines = document.data.lines;
						expect(lines, "one line per entry — never merged").to.have.length(2);
						expect(
							lines.map((line) => line.quantity).sort((a, b) => a - b),
							"quantities are the exact logged hours",
						).to.deep.eq([2, 3]);
						for (const line of lines) {
							expect(line.unit, "same HOUR unit a hand-typed line would use").to.eq("hour");
							expect(line.unitPrice, "the project's own hourly rate").to.eq(100);
						}

						cy.request(`${api}/api/documents?typeId=invoice`).then((beforeRetry) => {
							const invoiceCountBefore = (beforeRetry.body as DocumentRow[]).length;

							// THE DOUBLE-BILLING ATTEMPT — re-submitting the exact same, already-billed
							// entries must be refused outright, never silently re-billed or billed onto a
							// second invoice.
							cy.request({
								method: "POST",
								url: `${api}/api/time-entries/generate-invoice`,
								body: { clientId, entryIds },
								failOnStatusCode: false,
							}).then((retry) => {
								expect(retry.status, "re-billing the same entries is refused").to.eq(409);
							});

							cy.request(`${api}/api/documents?typeId=invoice`).then((afterRetry) => {
								expect(
									(afterRetry.body as DocumentRow[]).length,
									"the refused retry created NO second invoice",
								).to.eq(invoiceCountBefore);
							});

							cy.request(`${api}/api/time-entries?projectId=${projectId}`).then((finalEntries) => {
								for (const entry of finalEntries.body as TimeEntryRow[]) {
									expect(
										entry.invoiceId,
										"still pointing at the SAME invoice — the retry touched nothing",
									).to.eq(invoiceId);
								}
							});
						});
					});
				});
			});
		});
	});
});
