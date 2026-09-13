export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The `DOCUMENT_SENT` webhook (generic `DOCUMENT_*` vocabulary) fires when the transmission
 * SUCCEEDS, never before, never on a failure.
 * Idempotence across a BullMQ retry and behavior on failure/enqueue are already proven by
 * jest, against a REAL local HTTP server (`async-send.spec.ts`, `async-send-webhook.spec.ts`,
 * `documents.service.invoice.spec.ts`) — this file proves the ONE thing jest cannot: that
 * the configuration screen (`Settings > Webhooks`, until now with no e2e spec nor a single
 * `data-cy`) genuinely leads, end to end, to a real emission — a real click configures the
 * webhook, a real invoice is sent via a real "Send" click (email transport, resolved from the
 * client's own `contactEmail` — `invoice-actions.ts` — never a typed field), through a real
 * BullMQ/Redis queue (the "pipe" 28-document-async-send.cy.ts has already established), and the
 * assertion that matters reads a REAL HTTP receiver (`cypress.config.ts`'s `startWebhookReceiver`,
 * `node:http`, never a `cy.intercept` — that would only see a call made by the BROWSER, whereas
 * this POST comes from the BACKEND, server to server). The screen offers `DOCUMENT_SENT` (no
 * longer `INVOICE_SENT`, purged from the enum by the purge migration) because
 * `GET /api/webhooks/options` reflects `Object.values(WebhookEvent)` directly — no screen change
 * was needed for that, only this spec.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("The DOCUMENT_SENT webhook fires when an invoice is genuinely sent", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('a webhook configured THROUGH THE SCREEN receives "DOCUMENT_SENT" exactly once, once the invoice is genuinely "Sent"', () => {
		cy.task("clearWebhookRequests");

		cy.task("startWebhookReceiver").then((rawUrl) => {
			const webhookUrl = rawUrl as string;

			// 1) The webhook's configuration — THROUGH THE SCREEN, never via the API: this is the
			// part this file exists to test, and until now no spec covered it.
			cy.visit("/settings/webhooks");
			cy.get('[data-cy="webhook-url-input"]', { timeout: 10000 }).should("be.visible").clear().type(webhookUrl);

			cy.get('[data-cy="webhook-events-select"]').click();
			cy.get('[data-slot="command-input"]').type("DOCUMENT_SENT");
			cy.get('[role="option"]').contains("DOCUMENT_SENT").click();
			// Closes the popover (non-modal — it doesn't block the click on "Create", but closing it
			// first is what a real user would do before submitting).
			cy.get("body").type("{esc}");

			cy.get('[data-cy="webhook-create-submit"]').click();

			// The proof that the CREATION succeeded — not just that the form emptied out.
			cy.get('[data-cy^="webhook-row-"]', { timeout: 10000 }).should("have.length", 1);

			// 2) What's needed for an invoice to actually be sent by email — set up via the
			// API, the same way 23/28 already do for this same transport: this isn't the part under
			// test.
			cy.request({
				method: "POST",
				url: `${api}/api/company/info`,
				body: { invoiceTransportId: "email" },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "transport email configuré").to.be.oneOf([200, 201]);
			});

			cy.request({
				method: "POST",
				url: `${api}/api/clients`,
				body: {
					name: "Webhook Test Co",
					contactEmail: "webhook-test-client@example.com",
					currency: "EUR",
					country: "France",
					countryCode: "FR",
					address: "1 Webhook Street",
					city: "Paris",
					postalCode: "75003",
					isActive: true,
					type: "COMPANY",
				},
				failOnStatusCode: false,
			}).then((created) => {
				expect(created.status, "client (avec email) créé").to.eq(201);
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
								{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

					// 3) The real trigger: a real click on "Send" — never a direct call to
					// the action, which would bypass the screen (the same discipline as 21/22/23/28).
					cy.visit("/documents/invoice");
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

					// The displayed status reaches "Sent" — the transmission genuinely SUCCEEDED, through
					// the same BullMQ/Redis queue that 28-document-async-send.cy.ts already goes through.
					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// 4) THE proof: the REAL receiver received EXACTLY one webhook, carrying the
					// DOCUMENT_SENT event (generic — `typeId` as filtering data,
					// never a key computed per type) and the invoice that was actually sent — never
					// zero (nothing went out), never two (a double emission), never a generic event
					// that would say nothing about what just happened.
					cy.task("getWebhookRequests").then((requests) => {
						const list = requests as Array<Record<string, unknown>>;
						expect(list, "exactement un webhook reçu par le récepteur réel").to.have.length(1);
						expect(list[0].event, "l'événement est bien DOCUMENT_SENT").to.eq("DOCUMENT_SENT");
						expect(list[0].typeId, "typeId porte le type du document envoyé").to.eq("invoice");
						const documentPayload = list[0].document as { id?: string } | undefined;
						expect(
							documentPayload?.id,
							"le payload porte, sous la clé FIXE 'document', la facture réellement envoyée",
						).to.eq(invoiceId);
					});
				});
			});
		});
	});

	// DOCUMENT_SETTLED fires when the SETTLEMENT crosses the
	// "settled" threshold, at the moment the payment that crosses that threshold is PERSISTED —
	// never on a read-time recomputation. "record-payment" is SYNCHRONOUS (no BullMQ queue, unlike
	// "send"): the webhook has already been dispatched before the browser even receives the
	// mutation's response, so no additional wait is needed beyond the action dialog closing.
	it('a webhook configured THROUGH THE SCREEN receives "DOCUMENT_SETTLED" exactly once — on the SECOND of two payments (partial then final), never on the first', () => {
		cy.task("clearWebhookRequests");

		cy.task("startWebhookReceiver").then((rawUrl) => {
			const webhookUrl = rawUrl as string;

			cy.visit("/settings/webhooks");
			cy.get('[data-cy="webhook-url-input"]', { timeout: 10000 }).should("be.visible").clear().type(webhookUrl);

			cy.get('[data-cy="webhook-events-select"]').click();
			cy.get('[data-slot="command-input"]').type("DOCUMENT_SETTLED");
			cy.get('[role="option"]').contains("DOCUMENT_SETTLED").click();
			cy.get("body").type("{esc}");

			cy.get('[data-cy="webhook-create-submit"]').click();
			cy.get('[data-cy^="webhook-row-"]', { timeout: 10000 }).should("have.length.at.least", 1);

			// The invoice itself (draft + send) — already proven by 21/24, the API is enough here;
			// what's UNDER TEST is the payment, via a real click, further down.
			cy.request({ url: `${api}/api/documents/references/client/search` })
				.its("body")
				.then((clients: { id: string }[]) => {
					expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/save-draft`,
						body: {
							data: {
								client: clients[0].id,
								issueDate: "2026-08-31",
								dueDate: "2026-09-30",
								currency: "EUR",
								lines: [
									{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" },
								],
							},
						},
						failOnStatusCode: false,
					}).then((saved) => {
						expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
						const invoiceId = saved.body?.document?.id as string;
						expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/send`,
							body: { documentId: invoiceId, data: saved.body.document.data },
							failOnStatusCode: false,
						}).then((sent) => {
							expect(sent.status, "facture envoyée").to.be.oneOf([200, 201]);

							cy.visit("/documents/invoice");
							cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
							cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

							// PARTIAL payment: €60.00 of the €120.00 due (€100 net + 20% VAT).
							cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
							cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should(
								"be.visible",
							);
							cy.get('[data-cy="document-action-params-dialog"]')
								.find('[data-cy="document-field-amount-input"]')
								.clear({ force: true })
								.type("60", { force: true });
							cy.get('[data-cy="document-action-params-confirm"]').click();
							cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");
							cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should(
								"contain.text",
								"Partially paid",
							);

							cy.task("getWebhookRequests").then((requests) => {
								const list = requests as Array<Record<string, unknown>>;
								expect(
									list.filter((r) => r.event === "DOCUMENT_SETTLED"),
									"zéro DOCUMENT_SETTLED après un paiement qui laisse un reste",
								).to.have.length(0);
							});

							// FINAL payment: the remaining €60.00 — the invoice crosses the "settled" threshold.
							cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
							cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should(
								"be.visible",
							);
							cy.get('[data-cy="document-action-params-dialog"]')
								.find('[data-cy="document-field-amount-input"]')
								.clear({ force: true })
								.type("60", { force: true });
							cy.get('[data-cy="document-action-params-confirm"]').click();
							cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");
							cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should(
								"contain.text",
								"Settled",
							);

							cy.task("getWebhookRequests").then((requests) => {
								const list = requests as Array<Record<string, unknown>>;
								const settled = list.filter((r) => r.event === "DOCUMENT_SETTLED");
								expect(
									settled,
									"exactement UN DOCUMENT_SETTLED reçu par le récepteur réel, au second paiement",
								).to.have.length(1);
								expect(settled[0].typeId).to.eq("invoice");
								const documentPayload = settled[0].document as { id?: string } | undefined;
								expect(documentPayload?.id, "porte la facture réellement soldée").to.eq(invoiceId);
								const settlement = settled[0].settlement as
									| { settled?: boolean; outstandingMinor?: number }
									| undefined;
								expect(settlement?.settled, "le fait porté par le webhook : soldée").to.eq(true);
								expect(settlement?.outstandingMinor).to.eq(0);
							});
						});
					});
				});
		});
	});
});
