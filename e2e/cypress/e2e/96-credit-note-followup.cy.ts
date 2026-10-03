export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * PR #473 follow-up (review points 2 and 3 - point 1 is proven at the backend, no e2e journey is
 * reachable for it since the atomic write it fixes has no user-visible failure mode to drive).
 *
 * Point 2 - owner decision: a Polish seller issues NO NEW credit note at all, linked or free. The
 * faktura korygujaca (already implemented as a KOR invoice, `country-fields`/`correction-routes`) is
 * the only corrective instrument for Poland - `credit-note.save-draft`/`send` are `allowed: false`
 * for PL, enforced both by `documents.service.ts#runAction`'s own country-policy gate and a second
 * time in code (`credit-note-actions.ts#assertCreditNoteAllowedForCountry`, both shapes).
 *
 * ROUND 2 CORRECTION (this file's own first version got this wrong): `countries/data/pl.json (section "policy")`'s
 * own `documentTypes` list still names "credit-note" - dropping it entirely, as the round-1 fix did,
 * hid the sidebar entry AND made the whole list unreachable, which took an ALREADY-ISSUED Polish
 * credit note down with it (no way to open it, download its PDF, or read its share link), directly
 * contradicting pl.json's own notes that such a record "must stay readable/shareable - never
 * deleted, never renumbered, only no longer editable or sendable". The tests below now prove the
 * corrected shape: the type stays LISTED (sidebar entry, list page), its "New credit note" button
 * cannot save anything so it is disabled rather than opening a dialog that dead-ends at the last
 * step, and an existing record opens read-only, PDF included.
 *
 * Point 3 - the PDF and the screen used to disagree on an unnumbered document
 * (`numbering/display-state.ts`'s own header has the full "why"). A document stuck in "sending"
 * with no number (the exact race review point 1 closes, simulated here since the atomic write makes
 * it unreachable through the app any more - `cy.task("makeDocumentStuckSendingUnnumbered", ...)`,
 * the same "migration scenario, direct DB write" reasoning `91-credit-note-numbering.cy.ts`'s own
 * `makeCreditNoteLegacyUnnumbered` already rests on) must show the SAME "Issued without a number"
 * text on the detail page AND in the rendered PDF.
 */
const api = Cypress.env("apiUrl");
const appOrigin = Cypress.config("baseUrl");

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

/** Creates a free credit note draft, then issues it (draft -> sending -> sent) through the real API -
 *  the same two-call save-draft/send shape `91-credit-note-numbering.cy.ts`'s own
 *  `createAndIssueCreditNote` already uses. Called BEFORE the company switches to Poland (the default
 *  seeded company is French, and PL refuses this at the API - see the "refused" tests below), so the
 *  resulting record is exactly what the round-2 fix has to keep reachable: a credit note issued while
 *  this company was NOT Polish, read afterward by a company that now is. */
function createAndIssueCreditNoteAsFrenchSeller() {
	const data = {
		issueDate: "2026-09-20",
		currency: "EUR",
		reason: "Geste commercial - remboursement d'un trop-percu non rattache a une facture.",
		lines: [{ description: "Remboursement", quantity: 1, unitPrice: 42, vatRate: "0" }],
	};
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: { data },
		})
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			expect(id, "credit note draft created as a French seller").to.be.a("string");
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/credit-note/actions/send`,
				body: { documentId: id, data: saved.body?.document?.data },
			}).then((sent) => {
				expect(sent.status, "send accepted").to.be.oneOf([200, 201]);
			});
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=credit-note`, ["sent"]);
			return cy.wrap(id);
		});
}

describe("PR #473 review point 2 - a Polish seller has no NEW credit-note instrument, but an existing one stays reachable", () => {
	let existingCreditNoteId: string;

	before(() => {
		cy.resetAndSeed();
		createAndIssueCreditNoteAsFrenchSeller().then((id) => {
			existingCreditNoteId = id as unknown as string;
		});
		switchCompanyToPoland();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 720);
	});

	it("the credit-note sidebar entry and list stay reachable for a Polish seller, with no working create button", () => {
		cy.visit(`${appOrigin}/dashboard`);
		// The Documents group is open by default (sidebar.tsx) - every type, "credit-note" included,
		// shows: `documentTypes` still names it (pl.json), only the two ACTIONS below are refused.
		cy.get('[data-cy="sidebar-document-type-link-invoice"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="sidebar-document-type-link-quote"]').should("be.visible");
		cy.get('[data-cy="sidebar-document-type-link-credit-note"]').should("be.visible");
		cy.get('[data-sidebar="content"]').first().screenshot("473-after-pl-list-sidebar");

		cy.get('[data-cy="sidebar-document-type-link-credit-note"]').click();
		cy.get('[data-cy="document-list-card"]', { timeout: 15000 }).should("be.visible");
		// THE EXISTING RECORD: issued while this company was still French, still listed now that it
		// is Polish - the round-2 proof that the list itself never went unreachable.
		cy.get(`[data-cy="document-list-row-${existingCreditNoteId}"]`, { timeout: 15000 }).should("be.visible");
		// THE CREATE BUTTON: still on screen (never hidden - a vanished button looks like a missing
		// feature), but disabled - `save-draft`/`send` are both policy-blocked for PL, so nothing it
		// could open would ever reach a working "Continue" (see `canCreateDocument`'s own header,
		// action-presentation.ts).
		cy.get('[data-cy="document-create-button"]').should("be.disabled");
		cy.wait(500);
		cy.screenshot("473-after-pl-list", { capture: "viewport" });
	});

	it("opening the existing Polish credit note is read-only: the detail page offers no save/send, and its PDF still downloads", () => {
		cy.visit(`${appOrigin}/documents/credit-note/${existingCreditNoteId}`);
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("be.visible");
		// No editable action left runnable: "save-draft" only re-targets "draft" (this record is
		// "sent"), and "send" is policy-blocked outright for PL - whichever one the page would show as
		// its primary action, it carries no working button.
		cy.get('[data-cy="document-action-save-draft"]').should("not.exist");
		cy.get('[data-cy="document-action-send"]').should("not.exist");
		// The PDF download lives in the record's own "Actions" menu (document-detail.tsx) - opening it
		// proves the entry is still there and enabled, never removed for a read-only record.
		cy.get('[data-cy="document-actions-menu"]').click();
		cy.get('[data-cy="document-pdf-button"]').should("be.visible").and("not.have.attr", "disabled");
		cy.wait(500);
		cy.screenshot("473-after-pl-detail-readonly", { capture: "viewport" });

		cy.request({
			url: `${api}/api/documents/${existingCreditNoteId}/pdf?typeId=credit-note`,
			encoding: "binary",
		}).then((res) => {
			expect(res.status, "the PDF of an existing Polish credit note still renders").to.eq(200);
		});
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
			// (countries/data/pl.json (section "policy")'s own `allowed: false` rule) refuses this BEFORE the
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

	// ROUND 2: the create button itself is disabled at the list level now (`canCreateDocument`,
	// action-presentation.ts) - clicking a disabled button opens no dialog at all, so there is no
	// wizard left to walk through here. What still holds: the type's own describe endpoint reports
	// BOTH actions blocked, each reason naming Poland and pointing at the corrective invoice - the
	// exact text `canCreateDocument`/the button's own tooltip read.
	it("every credit-note action the describe endpoint reports is blocked, naming Poland and the corrective invoice", () => {
		cy.request(`${api}/api/documents/types/credit-note`).then((res) => {
			const reasons = (res.body?.actions ?? [])
				.map((a: { id: string; policyBlockedReason?: string }) => `${a.id}: ${a.policyBlockedReason ?? ""}`)
				.join("\n");
			expect(reasons).to.match(/save-draft: .*forbidden for "PL".*corrective invoice/);
			expect(reasons).to.match(/send: .*forbidden for "PL".*corrective invoice/);
		});

		// Visiting the create form by URL directly (bypassing the list's own button) still lands on a
		// button with nothing runnable behind it - confirms the dialog itself, not only the list's
		// button, agrees there is no working create path for a Polish seller.
		cy.visit(`${appOrigin}/documents/credit-note`);
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).should("be.disabled");
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
