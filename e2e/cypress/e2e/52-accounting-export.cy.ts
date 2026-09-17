export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Generic CSV accounting export — an export over a period produces a CSV
 * where each row is a real invoice / credit note / payment, amounts consistent with the settlement
 * pipeline. RFC-4180 escaping and amount consistency are covered/bitten in jest
 * (`accounting-export/*.spec.ts`, including credit-note rows); here we prove the real endpoint
 * end-to-end: a sent invoice + a payment, within the period → two rows at the right amount.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("CSV accounting export — invoice + payment within a period", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
		}).then((res) => expect(res.status).to.be.oneOf([200, 201]));
	});
	beforeEach(() => {
		cy.login();
	});

	it("a sent invoice + a payment within the period appear as two rows of the CSV", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Export Client SARL",
				contactEmail: "export-client@example.com",
				currency: "EUR",
				country: "FR",
				address: "1 Rue de l'Export",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		})
			.its("body.id")
			.then((clientId: string) => {
				const data = {
					client: clientId,
					issueDate: "2026-08-15",
					dueDate: "2026-09-15",
					currency: "EUR",
					lines: [{ description: "Prestation", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
				};
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					const invoiceId = saved.body?.document?.id as string;
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: invoiceId, data },
					}).then((sent) => expect(sent.status).to.be.oneOf([200, 201]));
					cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

					// A payment in full (1200.00 €) dated within the period.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/record-payment`,
						body: {
							documentId: invoiceId,
							data,
							params: { amount: 1200, currency: "EUR", paidAt: "2026-08-20", method: "bank_transfer" },
						},
					}).then((pay) => expect(pay.status, "paiement enregistré").to.be.oneOf([200, 201]));

					// The export for August 2026.
					cy.request({ url: `${api}/api/accounting-export?from=2026-08-01&to=2026-08-31` }).then((res) => {
						expect(res.status).to.eq(200);
						expect(res.headers["content-type"]).to.include("text/csv");
						const lines = (res.body as string).split("\n").filter((l) => l.length > 0);
						const header = lines[0];
						expect(header, "en-tête").to.include("type").and.to.include("gross").and.to.include("paid");

						const invoiceRows = lines.filter((l) => l.startsWith("invoice,"));
						const paymentRows = lines.filter((l) => l.startsWith("payment,"));
						expect(invoiceRows, "une ligne facture").to.have.length(1);
						expect(paymentRows, "une ligne paiement").to.have.length(1);
						// Invoice: gross 1200.00; payment: 1200.00 collected.
						expect(invoiceRows[0], "brut de la facture").to.include("1200.00");
						expect(paymentRows[0], "montant encaissé").to.include("1200.00");
					});

					// Outside the period: no August invoice/payment should appear.
					cy.request({ url: `${api}/api/accounting-export?from=2026-01-01&to=2026-01-31` }).then((res) => {
						const lines = (res.body as string).split("\n").filter((l) => l.length > 0);
						expect(lines.filter((l) => l.startsWith("invoice,")), "rien en janvier").to.have.length(0);
						expect(lines.filter((l) => l.startsWith("payment,")), "rien en janvier").to.have.length(0);
					});

					// Missing bounds → 400.
					cy.request({ url: `${api}/api/accounting-export`, failOnStatusCode: false }).then((res) => {
						expect(res.status, "bornes obligatoires").to.eq(400);
					});
				});
			});
	});

	/**
	 * The screen itself, driven end-to-end: both dates are picked through the real `DatePicker` —
	 * navigating its own month/year DROPDOWNS then clicking a day cell, the same control surface
	 * `cy.openDatePicker`/`cy.pickToday` drive, just landing on a specific day instead of "today" — and
	 * "Download" is a real click whose assertions read the ACTUAL network response it produced: the
	 * only way to catch a wrong query-param name, an inverted `from > to` guard, or a blob read/revoked
	 * in the wrong order, none of which the `cy.request`-only test above would ever notice, since the
	 * endpoint itself keeps answering 200 regardless.
	 *
	 * Reuses the invoice + payment that test already created and proved via the API (August 2026,
	 * gross/paid 1200.00) rather than minting a second one dated "today": a FRESH invoice issued today
	 * would need the "pdp" channel here — France requires it for anything issued from 2026-09-01 on
	 * (`transports/channel-policy`'s own mandate, evaluated on the invoice's OWN `issueDate`, orthogonal
	 * to what this test is proving) — and a second period would only re-prove what the test above
	 * already covers, not add any assurance the screen itself was missing.
	 */
	it("downloads a real CSV for the period picked on screen, matching the invoice + payment proven above", () => {
		cy.visit("/settings/accountingExport");
		cy.get('[data-cy="accounting-export-section"]', { timeout: 10000 }).should("be.visible");

		// Picks an EXACT calendar day through the popover's own month/year `<select>`s
		// (`captionLayout="dropdown"`, date-picker.tsx) then a day cell, rather than clicking
		// ".rdp-button_previous" a computed number of times (29-document-recurrence.cy.ts's own
		// technique, fine there since it only needs SOME past date): this suite's "today" is a real,
		// ever-advancing wall clock, so a step count towards a FIXED month would eventually go stale.
		// The dropdown's year range always reaches 100 years back from "today" (react-day-picker's own
		// default once a year dropdown is present), so 2026 stays reachable however far this spec's
		// own future runs drift.
		const pickDate = (triggerSelector: string, isoDay: string) => {
			cy.openDatePicker(triggerSelector);
			cy.get('select[aria-label="Choose the Month"]').select("Aug");
			cy.get('select[aria-label="Choose the Year"]').select("2026");
			// The exact ISO day (react-day-picker's own `data-day` on the day CELL, "yyyy-MM-dd"),
			// never the button's visible "1"/"31" text: August 2026 opens on a Saturday, so its grid's
			// own leading OUTSIDE days reach back into July — which also ends on a 31st, so the
			// visible text "31" appears twice in the same grid. The cell's `data-day` names the exact
			// day unambiguously regardless of which month's grid happens to display it.
			cy.get(`[data-day="${isoDay}"] button`).click();
			// Same closing-side race `cy.pickToday` documents and guards against, right above: a stale
			// `DismissableLayer` listener from THIS popover can still swallow the very next trigger's
			// click for a brief window after `setOpen(false)` fires.
			cy.get('[data-cy="date-picker-today"]').should("not.exist");
			cy.wait(50);
		};

		pickDate('[data-cy="accounting-export-from"]', "2026-08-01");
		pickDate('[data-cy="accounting-export-to"]', "2026-08-31");

		cy.intercept("GET", `${api}/api/accounting-export*`).as("exportCsv");
		cy.get('[data-cy="accounting-export-download"]').click();

		cy.wait("@exportCsv", { timeout: 10000 }).then((interception) => {
			// The exact regression a mocked/unit-only proof can't see: the screen must send the param
			// NAMES the backend actually reads.
			expect(interception.request.url, "bornes envoyées par l'écran")
				.to.include("from=2026-08-01")
				.and.to.include("to=2026-08-31");
			expect(interception.response?.statusCode, "le clic a réellement produit un export").to.eq(200);
			expect(String(interception.response?.headers["content-type"]), "servi comme CSV").to.include("csv");

			const lines = String(interception.response?.body)
				.split("\n")
				.filter((l) => l.length > 0);
			const invoiceRows = lines.filter((l) => l.startsWith("invoice,"));
			const paymentRows = lines.filter((l) => l.startsWith("payment,"));
			expect(invoiceRows, "la facture prouvée par l'API ci-dessus apparaît").to.have.length(1);
			expect(paymentRows, "le paiement prouvé par l'API ci-dessus apparaît").to.have.length(1);
			expect(invoiceRows[0], "même brut que l'API — 1200.00").to.include("1200.00");
			expect(paymentRows[0], "même montant encaissé que l'API — 1200.00").to.include("1200.00");
		});
	});
});
