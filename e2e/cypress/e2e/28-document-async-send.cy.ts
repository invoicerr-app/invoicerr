export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * A document's asynchronous send (worker mode & queues) — proven through the
 * screen, the same discipline as 17/21/22/23: the ACTION goes through a real click on "Send", the
 * ASSERTIONS that matter read the record back via the API (never the screen as proof of what's in
 * the database) and the real message in Mailpit.
 *
 * What THIS file proves, that 21/22/23 did not yet prove: the status displayed on screen reaches
 * "Sent" via the frontend's own POLLING (hooks/queries/use-document-types.ts's
 * `useDocumentInstances`, `refetchInterval` as long as a document stays "sending") — never via the
 * click's own synchronous response, which now only ever returns "sending". The e2e stack genuinely
 * runs the worker inline (WORKER_INLINE by default — see app.module.ts): this test therefore goes
 * through a real BullMQ/Redis queue, not a mock. 21 (lifecycle), 22 (numbering) and 23 (email)
 * keep passing with the intermediate "Sending" status label they did not know about yet.
 *
 * The second test covers an angle the first one doesn't touch: the record's own page
 * (document-detail.tsx reads `lastActionError` off the LIVE query, never off the form's snapshot)
 * must follow the LIVE `lastActionError`, never stay frozen on what it showed when opened. A real
 * "send_failed" document (an invoice whose client has no
 * email — transports/email-transport.ts) is opened on its page AFTER the fact, once the error is
 * already in the database; the cause is fixed and then "Send" is clicked again ON that same
 * page, and the error must disappear from the screen while it stays open, not only after a
 * reload.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("A document's asynchronous send goes through the queue — all the way to \"Sent\", with the PDF in Mailpit", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('a real click on "Send" moves a quote through sending -> sent (UI poll), with a real email and its PDF in Mailpit', () => {
		cy.clearEmails();

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
							issueDate: "2026-08-31",
							currency: "EUR",
							lines: [{ description: "Consulting", quantity: 3, unitPrice: 200 }],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
					const quoteId = saved.body?.document?.id;
					expect(quoteId, "le brouillon a un identifiant").to.be.a("string");

					const recipient = `async-send-${Date.now()}@example.com`;

					cy.visit("/documents/quote");
					cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Draft");

					// A real click — never a direct call to the action, which would bypass the screen.
					cy.runDocumentRowAction(quoteId, "send");
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="document-field-recipient-input"]').clear().type(recipient);
					cy.get('[data-cy="document-action-params-confirm"]').click();

					// The displayed status reaches "Sent" — via the frontend's own POLLING (see this
					// file's own header), not via the click's synchronous response. Generous timeout:
					// this test genuinely waits for a queue round trip (BullMQ/Redis), not a direct
					// HTTP response.
					cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 20000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// ...and this is indeed what gets stored — the assertion that matters reads the
					// API, never a DOM re-read as proof of the database.
					cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
						.its("body")
						.then((doc) => {
							expect(doc.status, "le devis est réellement \"sent\" en base").to.eq("sent");
							expect(
								doc.displayNumber,
								"un devis envoyé par la file porte un numéro, comme avant elle",
							).to.be.a("string");

							cy.getLastEmail().then((message: any) => {
								expect(
									message.To?.[0]?.Address,
									"le message va au destinataire tapé dans le formulaire",
								).to.eq(recipient);

								expect(
									message.Attachments,
									"exactement une pièce jointe — le PDF, jamais zéro ni un doublon",
								).to.have.length(1);

								const attachment = message.Attachments[0];
								expect(
									attachment.FileName,
									"la pièce jointe est nommée d'après le displayNumber du devis",
								).to.eq(`${doc.displayNumber}.pdf`);
								expect(attachment.ContentType, "et c'est bien un PDF").to.eq(
									"application/pdf",
								);
							});
						});
				});
			});
	});

	it(
		'a "send_failed" document keeps its error frozen on screen once its page is OPENED ' +
			'— clicking "Send" again ON that page, when it succeeds, must make it DISAPPEAR while it ' +
			"stays open, never keeping it stuck on the snapshot taken at opening",
		() => {
			// The INVOICE, not the quote: its "email" transport (invoice-actions.ts) resolves the
			// address from the CLIENT's own contactEmail (transports/email-transport.ts) — never a
			// field typed by the user, unlike the quote. A client WITHOUT an email therefore makes
			// delivery fail DETERMINISTICALLY, on every attempt, until retries are exhausted —
			// exactly the path that
			// backend/.../queue/__tests__/document-action-queue.redis.spec.ts already proves on the
			// backend side (its own "no contact email on file").
			cy.request({
				method: "POST",
				url: `${api}/api/company/info`,
				body: { invoiceTransportId: "email" },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
			});

			cy.request({
				method: "POST",
				url: `${api}/api/clients`,
				body: {
					name: "No Email Co",
					// No contactEmail — the cause forced here, later fixed further down.
					currency: "EUR",
					country: "France",
					countryCode: "FR",
					address: "1 Silent Street",
					city: "Paris",
					postalCode: "75002",
					isActive: true,
					type: "COMPANY",
				},
				failOnStatusCode: false,
			}).then((created) => {
				expect(created.status, "client sans email créé").to.eq(201);
				const clientId = created.body.id as string;

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clientId,
							issueDate: "2026-08-31",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 80, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

					cy.visit("/documents/invoice");

					// The FIRST "send" is triggered from the list ROW, dialog CLOSED — the very
					// reason for this test: `dialogTarget` (see [typeId]/index.tsx) must be captured AFTER
					// the fact, once the document is already "send_failed", so that its own snapshot
					// genuinely carries the frozen error that the fix must know how to clear. A real
					// click — never a direct call to the action, which would bypass the screen.
					//
					// The timestamp captured here serves the SSE proof further
					// down: NO cy.reload() appears anywhere in this file (grep it), and the list's
					// polling fallback has just been slowed down to 60s
					// (frontend/src/hooks/queries/use-document-types.ts's own SENDING_POLL_INTERVAL_MS) —
					// deliberately, so that a visible update well before that window can ONLY be
					// explained by the SSE stream (documents.controller.ts's `events` route), never
					// by the next polling tick, which cannot arrive before ~60s after this click (the
					// `refetchInterval` is re-evaluated — and its 60s window restarted — right after
					// the click, via the invalidation `useRunDocumentAction` already triggers).
					// This company is FR (resetAndSeed's own default, never overridden above), and FR
					// restricts "invoice.save-draft" to the "draft" status (country-policy/data/fr.json)
					// — so this very first send opens the row's own lock-confirmation dialog first
					// (document-list.tsx's DocumentRowActions, `actionLocksDocument` in
					// action-presentation.ts). `sendClickedAt` is captured on the CONFIRM click, not the
					// one that only opens the dialog: that confirm is the real moment the POST fires,
					// which is what the SSE timing budget below actually measures from.
					let sendClickedAt = 0;
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();
					cy.get(`[data-cy="document-row-lock-confirm-${invoiceId}-confirm"]`, { timeout: 5000 })
						.should("be.visible")
						.click()
						.then(() => {
							sendClickedAt = Date.now();
						});

					// A generous budget, deliberately documented: DOCUMENT_ACTION_QUEUE_ATTEMPTS=3 by
					// default (document-queue.dispatcher.ts) with an exponential backoff of base
					// 2000ms -> attempt 2 after ~2s, attempt 3 (terminal) ~4s later, i.e. ~6s of
					// queuing before the final failure, plus margin for a loaded CI. ATTEMPTS can't
					// be reduced here: it's an env var of the server that's already started, fixed at
					// its own boot — this test absorbs the budget rather than risk a flake. Read on
					// screen (the primary SSE, the slow polling fallback — see the comment above),
					// not via the API: we want the query CACHE that the dialog will follow further
					// down to already be up to date.
					// `timeout` on the `.find()`, not only on the `cy.get()` that precedes it: an
					// assertion chained after a `.find()` retries according to the timeout of THE
					// LAST query command before it, not the very first `cy.get()` in the chain
					// (a known Cypress pitfall) — without this, this `.should()` falls back to the
					// default 4000ms, far too short for a real failure after 3 attempts. This Cypress
					// timeout (40s) stays the safety net against a slow CI; the proof of SPEED — that
					// it really is the SSE, never the 60s fallback, that moved the badge — is the
					// assertion on the elapsed time measured right after, with its own much tighter
					// budget.
					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
						.find('[data-cy="document-status-badge"]', { timeout: 40000 })
						.should("contain.text", "Send failed")
						.then(() => {
							const elapsedMs = Date.now() - sendClickedAt;
							// ~6-8s are already consumed by the BullMQ attempts themselves (see the
							// comment above) — 10s leaves additional margin for the Redis publish ->
							// EventSource -> invalidation -> refetch -> render chain, while staying an
							// order of magnitude BELOW what the polling fallback alone would require
							// (60s): at this speed, it can only be the SSE.
							expect(
								elapsedMs,
								"le badge \"Send failed\" est apparu par le SSE, pas par le repli de polling à 60 s",
							).to.be.lessThan(10000);
						});
					cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should(
						"contain.text",
						"no contact email on file",
					);

					// The requirement: "the Retry button appears on its own". This repo has no
					// separate button labeled "Retry" — it's the SAME "send" action that becomes
					// available again from "send_failed" (invoice.descriptor.ts's SEND_TRANSITIONS),
					// hidden during "sending" (document-list.tsx's own isProcessing check) then shown
					// again WITHOUT a reload as soon as the live status returns to "send_failed" —
					// exactly the "Retry" mechanism this criterion describes. Direct proof on the list
					// ROW, not only in the dialog (which the rest of this test opens afterwards).
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`).should("be.visible");

					// The assertion that matters reads the API, never the screen as proof of what's in
					// the database — the same discipline as the rest of this file and of 24.
					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body")
						.then((doc) => {
							expect(doc.status, 'la facture est réellement "send_failed" en base').to.eq(
								"send_failed",
							);
							expect(doc.lastActionError, "l'erreur enregistrée nomme la cause réelle").to.match(
								/no contact email on file/i,
							);
						});

					// NOW the record's page is opened — document-detail.tsx takes the form's
					// OWN snapshot HERE, with the document already "send_failed": it's THIS
					// non-null `lastActionError` that the fix must know how to drop once the live
					// value goes back to `null`, not a `null` captured earlier that would prove nothing.
					cy.openDocument(invoiceId);
					cy.get('[data-cy="document-form-last-error"]').should(
						"contain.text",
						"no contact email on file",
					);

					// We fix the real CAUSE, never the screen nor a workaround of the queue: the
					// client receives the email it was missing. `name` must be sent along with it —
					// editClientsInfo (clients.service.ts) requires a non-empty name on EVERY write,
					// even a partial one.
					cy.request({
						method: "PATCH",
						url: `${api}/api/clients/${clientId}`,
						body: { name: "No Email Co", contactEmail: `fixed-${Date.now()}@example.com` },
						failOnStatusCode: false,
					}).then((patched) => {
						expect(patched.status, "email ajouté au client").to.eq(200);
					});

					// Clicking "Send" again ON THE PAGE OPENED ON A "send_failed" — the exact
					// scenario of the bug: the page stays this very same page from start to end,
					// never left nor reloaded. "send" stays available from "send_failed"
					// (invoice.descriptor.ts's SEND_TRANSITIONS), and this invoice has NO "send" param
					// at all (the transport reads the client, not a typed field — see
					// invoice-actions.ts): no params dialog to go through here.
					cy.runDocumentAction("send");

					// The proof that delivery GENUINELY succeeded this time, as in
					// 24-document-payments.cy.ts: "record-payment" is only offered on a "sent" invoice
					// (availableWhen: ['sent']) — its mere appearance is enough, without depending on
					// a status text displayed anywhere on THIS page.
					cy.get('[data-cy="document-action-record-payment"]', { timeout: 30000 }).should("exist");

					// The heart of the fixed bug: the stale error must NO LONGER be there, even
					// though the page is still the SAME one, never left in the meantime. Before
					// the fix, the old edit dialog's `liveDialogTarget?.lastActionError ??
					// dialogTarget.lastActionError` fell back to the frozen snapshot (the very real
					// error captured at opening, above) as soon as the live value was `null` (the
					// "sending" write on the re-click already clears it, see persistence.ts), leaving
					// this message displayed indefinitely next to a document that was genuinely
					// "sent". The page reads the error off the LIVE query alone (document-detail.tsx).
					cy.get('[data-cy="document-detail-page"]').should("be.visible");
					cy.get('[data-cy="document-form-last-error"]').should("not.exist");

					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body")
						.then((doc) => {
							expect(doc.status, 'la facture est réellement "sent" en base').to.eq("sent");
							expect(doc.lastActionError, "l'erreur a bien été effacée en base aussi").to.be.null;
						});
				});
			});
		},
	);
});
