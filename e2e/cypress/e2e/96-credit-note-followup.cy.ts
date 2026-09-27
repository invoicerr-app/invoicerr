export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * PR #473 follow-up (review points 2 and 3 - point 1 is proven at the backend, no e2e journey is
 * reachable for it since the atomic write it fixes has no user-visible failure mode to drive).
 *
 * Point 2 - owner decision: a Polish seller issues NO credit note at all, linked or free. The
 * faktura korygujaca (already implemented as a KOR invoice, `country-fields`/`correction-routes`) is
 * the only corrective instrument for Poland. `country-policy/data/pl.json`'s own `documentTypes` list
 * no longer names "credit-note" (hides the sidebar entry, the exact mechanism the sidebar itself
 * already reads - `resolveAvailableDocumentTypes`), and `credit-note.save-draft`/`send` are now
 * `allowed: false` there too, enforced a second time in code
 * (`credit-note-actions.ts#assertCreditNoteAllowedForCountry`, both shapes).
 *
 * Point 3 - the PDF and the screen used to disagree on an unnumbered document
 * (`numbering/display-state.ts`'s own header has the full "why"). A document stuck in "sending"
 * with no number (the exact race review point 1 closes, simulated here since the atomic write makes
 * it unreachable through the app any more - `cy.task("makeDocumentStuckSendingUnnumbered", ...)`,
 * the same "migration scenario, direct DB write" reasoning `91-credit-note-numbering.cy.ts`'s own
 * `makeCreditNoteLegacyUnnumbered` already rests on) must show the SAME "Issued without a number"
 * text on the detail page AND in the rendered PDF.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const appOrigin = "http://localhost:6284";

function switchCompanyToPoland() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { name: "Acme Corp", country: "Poland", countryCode: "PL" },
		})
		.then((res) => {
			expect(res.status, "seller country switched to Poland").to.be.oneOf([200, 201]);
		});
}

describe("PR #473 review point 2 - a Polish seller has no credit note instrument at all", () => {
	before(() => {
		cy.resetAndSeed();
		switchCompanyToPoland();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 720);
	});

	it("the credit-note sidebar/menu entry is hidden for a Polish seller", () => {
		cy.visit(`${appOrigin}/dashboard`);
		// The Documents group is open by default (sidebar.tsx) - every OTHER type still shows, only
		// "credit-note" is missing, proving this is the country's own `documentTypes` list at work,
		// never an accidental blanket hide.
		cy.get('[data-cy="sidebar-document-type-link-invoice"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="sidebar-document-type-link-quote"]').should("be.visible");
		cy.get('[data-cy="sidebar-document-type-link-credit-note"]').should("not.exist");
		cy.get('[data-sidebar="content"]').first().screenshot("473-after-pl-hidden-action");
	});

	it('save-draft (free shape) is refused at the API, naming Poland and the faktura korygujaca, never the country generically', () => {
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: {
				data: {
					issueDate: "2026-09-20",
					currency: "EUR",
					reason: "Geste commercial.",
					lines: [{ description: "Remboursement", quantity: 1, unitPrice: 42, vatRate: "0" }],
				},
			},
			failOnStatusCode: false,
		}).then((res) => {
			// 403, not 400 - `documents.service.ts#runAction`'s own `evaluateCountryPolicy` gate
			// (country-policy/data/pl.json's own `allowed: false` rule) refuses this BEFORE the
			// handler (and its own in-code `assertCreditNoteAllowedForCountry` guard, which now only
			// fires for a caller that somehow bypassed this gate) ever runs.
			expect(res.status, `refused - ${JSON.stringify(res.body).slice(0, 200)}`).to.eq(403);
			expect(String(res.body?.message)).to.match(/forbidden for "PL"/);
			expect(String(res.body?.message)).to.match(/korygując/i);
			// The pointer to what to do instead - documents.service.ts's own
			// `appendCorrectiveInvoiceGuidance`, orchestrator follow-up.
			expect(String(res.body?.message)).to.match(/corrective invoice/i);
			expect(String(res.body?.message)).to.match(/Corrects invoice/);
			expect(String(res.body?.message)).to.match(/KOR/);
		});
	});

	it("save-draft (LINKED shape, referencing a real invoice) is ALSO refused - not only the free one", () => {
		const invoiceData = (clientId: string) => ({
			client: clientId,
			issueDate: "2026-09-01",
			dueDate: "2026-10-01",
			currency: "EUR",
			lines: [{ description: "Uslugi doradcze", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "23" }],
		});

		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Klient PR473",
				contactEmail: "klient.pr473@example.com",
				address: "ul. Testowa 1",
				postalCode: "00-001",
				city: "Warszawa",
				country: "Poland",
				countryCode: "PL",
				currency: "EUR",
				isActive: true,
			},
		}).then((clientRes) => {
			const clientId = clientRes.body?.id as string;
			expect(clientId, "Polish client created").to.be.a("string");

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: invoiceData(clientId) },
			}).then((savedInvoice) => {
				const invoiceId = savedInvoice.body?.document?.id as string;
				expect(invoiceId, "Polish invoice draft created").to.be.a("string");
				const lines = savedInvoice.body?.document?.data?.lines as { $rowId?: string }[];

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/credit-note/actions/save-draft`,
					body: {
						data: {
							invoice: invoiceId,
							issueDate: "2026-09-20",
							currency: "EUR",
							correctedLines: lines?.[0]?.$rowId ? [lines[0].$rowId] : [],
						},
					},
					failOnStatusCode: false,
				}).then((res) => {
					// Same 403, same country-policy gate - proving the fix reaches the LINKED shape
					// too, not only the free one (the exact gap review point 2 named).
					expect(res.status, `refused - ${JSON.stringify(res.body).slice(0, 200)}`).to.eq(403);
					expect(String(res.body?.message)).to.match(/forbidden for "PL"/);
					expect(String(res.body?.message)).to.match(/korygując/i);
					expect(String(res.body?.message)).to.match(/corrective invoice/i);
				});
			});
		});
	});

	// The create form itself is still reachable by URL (only the sidebar entry is hidden): its last
	// step offers no runnable action, so nothing can reach the API from it, and the reason the type
	// reports for each blocked action points to the corrective invoice.
	it("creating a credit note by URL ends on a disabled button, and every blocked action's reason points to the corrective invoice", () => {
		cy.visit(`${appOrigin}/documents/credit-note`);
		cy.get('[data-cy="document-create-button"]').click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 10000 }).should("be.visible");

		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.continueDocumentWizard(); // Details -> Lines

		cy.get('[data-cy="document-field-currency-input"] button').should("not.be.disabled").click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('input[name="lines.0.description"]').type("Geste commercial", { force: true });
		cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("1", { force: true });
		cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("42", { force: true });
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy$="-input"] button').last().click({ force: true });
		cy.get('[data-cy$="-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy*="-option-"]').first().click();
		cy.continueDocumentWizard(); // Lines -> Options

		cy.get('[data-cy="document-field-reason-input"]').type("Test.", { force: true });
		cy.continueDocumentWizard(); // Options -> Recap

		// No RUNNABLE action at all (every action credit-note declares is blocked by the country
		// policy): the last step's button is disabled. A disabled button receives no pointer event, so
		// its tooltip cannot be opened from a test; the reason it would show is the type's own
		// `policyBlockedReason`, read here from the same describe endpoint the dialog uses.
		cy.get('[data-cy="document-create-dialog-submit"]', { timeout: 10000 }).should("be.disabled");
		cy.get('[data-cy="document-action-save-draft"]').should("be.disabled");
		cy.request(`${api}/api/documents/types/credit-note`).then((res) => {
			const reasons = (res.body?.actions ?? [])
				.map((a: { id: string; policyBlockedReason?: string }) => `${a.id}: ${a.policyBlockedReason ?? ""}`)
				.join("\n");
			expect(reasons).to.match(/save-draft: .*forbidden for "PL".*corrective invoice/);
			expect(reasons).to.match(/send: .*forbidden for "PL".*corrective invoice/);
		});
		cy.wait(500);
		cy.screenshot("473-after-pl-refusal", { capture: "viewport" });
	});
});

describe("PR #473 review point 3 - the PDF and the screen agree on an unnumbered document", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 720);
	});

	it('an invoice stuck "sending" with no number shows "Issued without a number" on BOTH the detail page and the PDF', () => {
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Client PR473 Stuck",
				contactEmail: "stuck.pr473@example.com",
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Rue du Numero",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		}).then((clientRes) => {
			const clientId = clientRes.body?.id as string;
			expect(clientId, "client created").to.be.a("string");

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: {
					data: {
						client: clientId,
						// BEFORE the FR channel mandate's own effective date (2026-09-01,
						// invoice-channel-mandate.spec.ts) - the same "2026-08-30" date
						// 90-save-draft-lock.cy.ts already uses for the identical reason: this
						// journey has nothing to do with channel mandates and must not be blocked by
						// one requiring a "pdp" transport nobody configured here.
						issueDate: "2026-08-30",
						dueDate: "2026-09-30",
						currency: "EUR",
						lines: [{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
					},
				},
			}).then((saved) => {
				const invoiceId = saved.body?.document?.id as string;
				expect(invoiceId, "invoice draft created").to.be.a("string");
				// Simulates the exact race PR #473 review point 1 closes: "sending", no number, stuck
				// there forever (unreachable through the app any more since the atomic fix).
				cy.task("makeDocumentStuckSendingUnnumbered", { documentId: invoiceId, typeId: "invoice" });

				cy.visit(`${appOrigin}/documents/invoice/${invoiceId}`);
				cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should("contain.text", "Sending");
				cy.get('[data-cy="document-form-number"]', { timeout: 10000 })
					.should("be.visible")
					.and("contain.text", "Issued without a number");
				cy.wait(500);
				cy.screenshot("473-after-unnumbered-screen", { capture: "viewport" });

				cy.request({
					url: `${api}/api/documents/${invoiceId}/pdf?typeId=invoice`,
					encoding: "binary",
				}).then((res) => {
					expect(res.status).to.eq(200);
					cy.writeFile("cypress/downloads/473-after-unnumbered.pdf", res.body, "binary");

					const base64 = Cypress.Buffer.from(res.body as string, "binary").toString("base64");
					cy.task("extractPdfText", base64).then((rawText) => {
						const text = String(rawText).replace(/\s+/g, " ");
						// THE PROOF: the PDF says the SAME thing the screen just did, never "Draft, no
						// number yet" for a record that is genuinely stuck past "draft".
						expect(text).to.match(/Issued without a number/);
						expect(text).to.not.match(/Draft.*no number yet/);
					});
				});
			});
		});
	});
});
