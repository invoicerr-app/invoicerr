export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #322: warn the user, BEFORE the click that actually sends it, that an invoice is about to be
 * LOCKED — the backend already refuses a re-edit after "send" (country-policy/data/{de,fr,it,pl,pt}
 * .json restrict "invoice.save-draft" to the "draft" status; documents.service.ts#runAction answers
 * 409 on a re-edit, proven by 21-document-lifecycle.cy.ts and 44-country-policy.cy.ts), but nothing
 * said so BEFORE the click. This spec proves the confirmation dialog that closes that gap
 * (frontend/src/components/documents/document-form.tsx's DocumentActionLockConfirmHost, gated by
 * `actionLocksDocument` in action-presentation.ts) actually appears before the real POST fires, and
 * that it stays silent where nothing is about to lock.
 *
 * Two angles, one spec:
 *  1. On the seeded FR company (resetAndSeed's own default — FR restricts "invoice.save-draft" to
 *     "draft", the real, sourced shape every one of the five supported countries carries today):
 *     clicking "Send" on a draft invoice opens the dialog FIRST, names the lock in plain words,
 *     Cancel leaves the invoice exactly as it was (no request ever sent, still "draft" at the API),
 *     and Confirm is what actually fires the POST and moves the record on.
 *  2. On a QUOTE — same "send" action id, but no country file restricts re-editing a sent quote (see
 *     country-policy/data/*.json: quote.save-draft carries no `statuses` narrowing at all) — the
 *     dialog never mounts: the click goes straight to "send"'s OWN params dialog (the recipient
 *     field), proving the gate is genuinely conditioned on the backend's own policy data, not a
 *     blanket "always confirm 'send'" rule.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function invoiceData(clientId: string) {
	return {
		client: clientId,
		// Before FR's own "pdp" channel mandate threshold (2026-09-01, channel-policy/mandate.ts) —
		// same date convention as 21-document-lifecycle.cy.ts's own invoice, so this stays about the
		// LOCK confirmation, never a second, unrelated France-specific 501 about the wrong channel.
		issueDate: "2026-08-30",
		dueDate: "2026-10-03",
		currency: "EUR",
		lines: [{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
	};
}

describe("Invoice send opens a lock-confirmation dialog first — and only where the country policy actually locks it", () => {
	before(() => {
		cy.resetAndSeed();

		// "send" on an invoice needs a configured transport (invoice-actions.ts) — same setup as
		// 17-document-descriptor.cy.ts / 21-document-lifecycle.cy.ts to reach a real "sent".
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

	let invoiceId: string;

	it('cancelling the lock-confirmation sends NOTHING; confirming it is what actually sends the invoice', () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data: invoiceData(clients[0].id) },
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					invoiceId = saved.body?.document?.id as string;
					expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

					cy.intercept("POST", `${api}/api/documents/types/invoice/actions/send`).as("sendInvoice");

					cy.visit("/documents/invoice");
					cy.openDocument(invoiceId);

					// The invoice has NO "send" param (the transport reads the client, not a typed
					// field — invoice-actions.ts), unlike the quote's own "send" further down: a plain
					// click is enough to reach the lock check, no params dialog in the way.
					cy.get('[data-cy="document-action-send"]', { timeout: 15000 })
						.should("exist")
						.and("not.be.disabled")
						.click();

					// The dialog appears BEFORE anything is sent — the real POST has not fired yet.
					cy.get('[data-cy="document-detail-lock-confirm"]', { timeout: 10000 })
						.should("be.visible")
						// It names the lock in plain words — the exact fact this issue asks for, read off
						// the screen rather than assumed from the click alone.
						.and("contain.text", "lock this document");
					cy.get("@sendInvoice.all").should("have.length", 0);

					// Cancel: the dialog closes, no request was ever made, and the invoice is still
					// exactly what it was — the negative proof, read from the API, never the screen.
					cy.get('[data-cy="document-detail-lock-confirm-cancel"]').click();
					cy.get('[data-cy="document-detail-lock-confirm"]').should("not.exist");
					cy.get("@sendInvoice.all").should("have.length", 0);
					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body.status")
						.should("eq", "draft");

					// Same click again, this time Confirm — THIS is what actually fires the POST.
					cy.get('[data-cy="document-action-send"]').click();
					cy.get('[data-cy="document-detail-lock-confirm"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="document-detail-lock-confirm-confirm"]').click();

					// A Nest action route answers 200 or 201 depending on its own @HttpCode — asserting
					// the real response code here, never a toast alone (spec-cypress-ecrit-sans-execution's
					// own pitfall #6/#3): the request is what moved the record, not a sentence on screen.
					cy.wait("@sendInvoice").its("response.statusCode").should("be.oneOf", [200, 201]);

					// The proof that sending genuinely went through: "record-payment" is only offered on
					// a "sent" invoice (same pattern as 24-document-payments.cy.ts / 44-country-policy.cy.ts).
					cy.get('[data-cy="document-action-record-payment"]', { timeout: 20000 }).should("exist");

					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body")
						.then((doc) => {
							expect(doc.status, "la facture est réellement \"sent\" en base").to.eq("sent");
							expect(doc.displayNumber, "une facture émise porte un numéro").to.be.a("string");
						});
				});
			});
	});

	it("does not appear for a quote's own send — no country file restricts re-editing a sent quote", () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							currency: "EUR",
							lines: [{ description: "Conseil", quantity: 1, unitPrice: 300 }],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
					const quoteId = saved.body?.document?.id as string;

					cy.visit("/documents/quote");
					cy.openDocument(quoteId);

					cy.get('[data-cy="document-action-send"]', { timeout: 15000 })
						.should("exist")
						.and("not.be.disabled")
						.click();

					// The lock-confirmation dialog never mounts for a quote...
					cy.get('[data-cy="document-detail-lock-confirm"]').should("not.exist");
					// ...instead "send"'s OWN params dialog opens directly (the recipient field) — the
					// click went straight through, never silently swallowed by a lock check that has
					// nothing to say here.
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="document-field-recipient-input"]').clear().type("client@example.com");
					cy.get('[data-cy="document-action-params-confirm"]').click();

					// "send" is asynchronous (item 22, queues): draft -> sending returns immediately, the
					// worker moves it on to "sent" — wait for the screen's OWN poll/SSE to catch up
					// (same pattern as 28-document-async-send.cy.ts) before reading the API, rather than
					// racing a single one-shot request against the worker.
					cy.get('[data-cy="document-status-badge"]', { timeout: 20000 }).should("contain.text", "Sent");

					cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
						.its("body.status")
						.should("eq", "sent");
				});
			});
	});
});
