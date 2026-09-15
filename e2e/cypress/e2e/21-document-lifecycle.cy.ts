export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The declared lifecycle (statuses + transitions, backend/src/modules/documents/descriptors/
 * lifecycle.ts) proven through the screen, not only in memory — same discipline as
 * 17-document-descriptor.cy.ts: the ACTIONS go through the interface, the ASSERTIONS read
 * the record (the API, never a screen re-read as proof of what's in the database).
 *
 * Three things, in order (state carries across the `it`s in this file — `resetAndSeed` replays
 * only once, in `before`, exactly as 17 does):
 *  1. the transition hint ("Draft → Sending" — item 22 made "send" asynchronous: the
 *     FIRST declared transition leads to "sending", not directly to "sent", see
 *     quote.descriptor.ts's own SEND_TRANSITIONS) appears on an action that declares one, and
 *     NOT on an action that declares none (even though the latter is still offered);
 *  2. running "send" via a real click moves the displayed AND recorded status to "sent",
 *     the screen showing it through ITS OWN polling (useDocumentInstances) once the worker has run —
 *     see 28-document-async-send.cy.ts for the dedicated proof of this queue traversal;
 *  3. the country-policy status restriction (fr.json: invoice.save-draft -> ["draft"])
 *     removes the button from the screen once the invoice has gone out ("sending" is already
 *     enough, "draft" being the only allowed status), and the API refuses it too (409) for a
 *     scripted client that would ignore the screen.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("A document's lifecycle — declared statuses and transitions", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	let quoteId: string;

	it("the transition label appears on an action that declares one, not on an action that declares none", () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							currency: "EUR",
							lines: [{ description: "Conseil", quantity: 1, unitPrice: 500 }],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
					quoteId = saved.body?.document?.id;
					expect(quoteId, "le brouillon a un identifiant").to.be.a("string");

					cy.visit("/documents/quote");
					cy.openDocument(quoteId);

					// "send" declares (item 22, the asynchronous send) a FIRST transition draft ->
					// sending (quote.descriptor.ts): the quote is currently "draft", so the expected
					// label is "Draft → Sending" — deduced from the descriptor received by the screen, never
					// hard-coded in this test. It is no longer "Sent": that would be the label of the
					// SECOND transition (sending -> sent | send_failed), which only applies once
					// the quote is already "sending" — out of scope for this click.
					cy.get('[data-cy="document-transition-hint-send"]', { timeout: 10000 })
						.scrollIntoView()
						.invoke("text")
						.should("match", /Draft/i)
						.and("match", /Sending/i);

					// "convert-to-invoice" is offered (both draft AND sent qualify) but declares
					// NO transition at all (it never changes the QUOTE's own status — see
					// convert-to-invoice.ts): no label at all, even though the entry itself is there.
					// It sits in the page's "Actions" menu, next to "save-draft" — only "send" is the
					// header's own primary button for an unedited draft (action-presentation.ts).
					cy.openDocumentActionsMenu();
					cy.get('[data-cy="document-action-convert-to-invoice"]').should("exist");
					cy.get('[data-cy="document-transition-hint-convert-to-invoice"]').should("not.exist");

					// "save-draft" declares a transition from ANY status to "draft"
					// (registerSaveDraftAction always writes "draft") — here the quote is already "draft",
					// so the label is "Draft → Draft": a declared transition that changes nothing,
					// exactly the case the task asks to cover.
					cy.get('[data-cy="document-transition-hint-save-draft"]', { timeout: 10000 })
						.invoke("text")
						.should("match", /Draft.*Draft/i);
				});
			});
	});

	it('running "send" via a real click moves the displayed AND recorded status to "sent"', () => {
		expect(quoteId, "le devis du test précédent existe toujours").to.be.a("string");

		cy.visit("/documents/quote");
		cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Draft");

		// Directly from the list row (document-list.tsx exposes the same actions as the
		// form, without opening the modal) — a real click, not a direct request: it's the screen
		// that acts here, the API only serves to READ BACK afterwards what was recorded.
		cy.get(`[data-cy="document-row-action-send-${quoteId}"]`).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-recipient-input"]').clear().type("client@example.com");
		cy.get('[data-cy="document-action-params-confirm"]').click();

		// The displayed status changes...
		cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Sent");

		// ...and that is indeed what got recorded, not just what the screen claims: the assertion
		// that matters reads the API, never a DOM re-read as proof of the database.
		cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
			.its("body.status")
			.should("eq", "sent");
	});

	describe("country policy by status (fr.json: invoice.save-draft restricted to \"draft\")", () => {
		let invoiceId: string;

		it('a "sent" invoice no longer shows "Save draft" on screen, and the API refuses it too (409)', () => {
			cy.request({
				method: "POST",
				url: `${api}/api/company/info`,
				// "send" on an invoice needs a configured transport (see invoice-actions.ts) —
				// same setup as 17-document-descriptor.cy.ts to bring an invoice to "sent".
				body: { invoiceTransportId: "email" },
				failOnStatusCode: false,
			}).then((companyRes) => {
				expect(companyRes.status, "transport configuré").to.be.oneOf([200, 201]);

				cy.request({ url: `${api}/api/documents/references/client/search` })
					.its("body")
					.then((clients: { id: string }[]) => {
						const invoiceData = {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
						};

						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/save-draft`,
							body: { data: invoiceData },
							failOnStatusCode: false,
						}).then((saved) => {
							expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
							invoiceId = saved.body?.document?.id;

							cy.visit("/documents/invoice");
							// BEFORE sending: the invoice is "draft", the action must be offered — the proof
							// that its disappearance further down really comes from the status change, not
							// from a button that never existed.
							cy.get(`[data-cy="document-row-action-save-draft-${invoiceId}"]`, {
								timeout: 15000,
							}).should("exist");

							cy.request({
								method: "POST",
								url: `${api}/api/documents/types/invoice/actions/send`,
								body: { documentId: invoiceId, data: invoiceData },
								failOnStatusCode: false,
							}).then((sent) => {
								expect(sent.status, "facture envoyée").to.be.oneOf([200, 201]);
								// "send" is asynchronous (item 22): this direct call now only does the
								// FIRST half — draft -> sending — and returns immediately; the actual
								// delivery is the worker's job (28-document-async-send.cy.ts gives the
								// dedicated proof of that). The status restriction tested here ("draft"
								// only) already excludes both "sending" and "sent" — so it already holds,
								// without waiting for the worker to finish.
								expect(sent.body?.document?.status, 'la facture est partie ("sending")').to.eq(
									"sending",
								);

								cy.visit("/documents/invoice");
								// ON SCREEN: the "Save draft" button is no longer offered on this row — the
								// per-company view (describeTypeForCompany) restricted availableWhen to
								// ["draft"] for France, and this invoice is no longer in it.
								cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 }).should(
									"exist",
								);
								cy.get(`[data-cy="document-row-action-save-draft-${invoiceId}"]`).should(
									"not.exist",
								);

								// AT THE API: a scripted client that ignored the screen and called the action
								// by hand gets refused exactly the same way — 409, never a bypass.
								cy.request({
									method: "POST",
									url: `${api}/api/documents/types/invoice/actions/save-draft`,
									body: { documentId: invoiceId, data: invoiceData },
									failOnStatusCode: false,
								}).then((res) => {
									expect(res.status, `refusée — ${JSON.stringify(res.body).slice(0, 200)}`).to.eq(
										409,
									);
									expect(
										String(res.body?.message ?? ""),
										"le message nomme la restriction par statut, jamais un refus muet",
									).to.match(/restricted by this company's country policy to status\(es\) draft/i);
								});
							});
						});
					});
			});
		});
	});
});
