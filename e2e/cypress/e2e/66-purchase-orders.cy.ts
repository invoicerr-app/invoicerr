export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Purchase orders / supplier billing ("bons de commande / achats fournisseurs") — FIRST PASS: EMITTING a
 * purchase order (create, send, cancel). The 3-way match against a received invoice is a
 * deliberately separate, second pass — see purchase-order.descriptor.ts's own header.
 *
 * Same discipline as 17/21/23/28: the ACTIONS go through a real click on the screen, the ASSERTIONS
 * that matter read the record back via the API (never the screen as proof of what is in the
 * database) and the real message in Mailpit — never the client-generated content as proof of what
 * was actually attached/sent.
 *
 * "create" is proven through the FULL create dialog (a blank "New purchase order", every required
 * field filled by hand) — unlike 21/23/28, which create their setup fixture via a direct API call and
 * only prove the ACTION under test through the screen: this type's own "create" is one of the three
 * actions this spec was asked to prove, so it gets the same screen-driven treatment "send"/"cancel"
 * already have below, rather than being reduced to setup.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Purchase orders — create, send (Mailpit gets the PDF), cancel", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	// `purchaseOrderId`/`displayNumber` are set by "creates a purchase order..." below and read by
	// "sends it..."/"cancels it..." — one sequential narrative sharing a single record, the same house
	// convention `44-country-policy.cy.ts`'s own header documents in full (also used by
	// `scenarios/full-lifecycle.cy.ts` and dozens of other numbered specs): no documented command in
	// this repo ever runs a single `it` out of a spec file, so the ordering this relies on always
	// holds in practice.
	let purchaseOrderId: string;
	let displayNumber: string;
	const recipient = `purchase-order-${Date.now()}@example.com`;

	it('creates a purchase order via the screen — a blank "New purchase order", filled by hand, saved as a draft', () => {
		cy.visit("/documents/purchase-order");
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 5000 }).should("be.visible");

		// "supplier" — a 'reference' field targeting the "supplier" entity (client-reference.provider.ts
		// with NO excludeSuppliers, unlike the invoice's/quote's own "client" picker): whichever client
		// the seed's default search already surfaces is picked, exactly the pattern
		// 25-document-settlement.cy.ts's own "invoice" reference field already uses.
		cy.get('[data-cy="document-field-supplier-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-supplier-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-supplier-input-options"] button').first().click();

		// "issueDate" — a real calendar click, "today", via the DatePicker's own "Today" footer button
		// rather than a computed `[data-day="M/D/YYYY"]` selector: CI run 34930840117
		// (`[data-day="9/15/2026"]` never found) was exactly this — a stale/off-screen calendar cell
		// racing the test's own locale-formatted guess. `cy.pickToday()` (support/commands.ts) removes
		// the race at the source instead of shrinking its window.
		cy.pickToday('[data-cy="document-field-issueDate-input"]');

		// "currency" — a SearchSelect, same pattern as 20-document-totals.cy.ts's own currency fill.
		cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();

		// "supplier"/"issueDate"/"currency" (all `required`) are the wizard's own "Details" step —
		// see document-create-dialog.tsx's `buildFieldGroups`.
		cy.continueDocumentWizard(); // Details -> Lines

		// One line: 10 units at 25 EUR — no article catalog link, no VAT rate (see the descriptor's
		// own header on why "lines" carries neither).
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("Widgets", { force: true });
		cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("10", { force: true });
		cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("25", { force: true });

		// "expectedDeliveryDate"/"reference"/"notes" (all optional) are the "Options" step — nothing
		// to fill to pass through it.
		cy.continueDocumentWizard(); // Lines -> Options
		cy.continueDocumentWizard(); // Options -> Summary

		cy.intercept("POST", `${api}/api/documents/types/purchase-order/actions/save-draft`).as(
			"savePurchaseOrderDraft",
		);
		cy.get('[data-cy="document-action-save-draft"]').scrollIntoView().click();
		cy.wait("@savePurchaseOrderDraft").then((interception) => {
			expect(interception.response?.statusCode, "brouillon de bon de commande créé").to.be.oneOf([
				200, 201,
			]);
			purchaseOrderId = interception.response?.body?.document?.id as string;
			expect(purchaseOrderId, "le brouillon a un identifiant").to.be.a("string");
			expect(interception.response?.body?.document?.status).to.eq("draft");

			// The verification below MUST stay nested in this `.then()`, not chained as a sibling
			// command after it. `purchaseOrderId` is a plain JS variable; a sibling `cy.request(...)`'s
			// URL template is built synchronously while this test's body runs — i.e. before ANY
			// Cypress command in the queue (including this very `cy.wait`) has actually resolved — so
			// it read the still-`undefined` initial value, producing
			// `GET /api/documents/undefined?typeId=purchase-order` (404: CI run 34916829147, commit
			// de30e2a4, first execution of this spec). Same trap as the "today" date computed between
			// two queued Cypress commands fixed on 62-*: read a produced value inside the `.then()` of
			// the command that produced it, never from a variable captured before the chain resolves.
			cy.get("body").type("{esc}"); // close the dialog — Radix's own Escape handling

			cy.request({ url: `${api}/api/documents/${purchaseOrderId}?typeId=purchase-order` })
				.its("body")
				.then((doc) => {
					expect(doc.status, "le bon de commande est bien un brouillon en base").to.eq("draft");
					expect(doc.data.supplier, "un fournisseur est bien lié").to.be.a("string");
					expect(doc.data.currency).to.eq("EUR");
					expect(doc.data.lines, "une ligne, telle que saisie à l'écran").to.have.length(1);
					expect(doc.data.lines[0]).to.include({
						description: "Widgets",
						quantity: 10,
						unitPrice: 25,
					});
				});
		});
	});

	it('sends it via the screen — Mailpit receives the PDF, named after the displayNumber', () => {
		expect(purchaseOrderId, "le bon de commande du test précédent existe toujours").to.be.a("string");
		cy.clearEmails();

		cy.visit("/documents/purchase-order");
		cy.get(`[data-cy="document-list-row-${purchaseOrderId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Draft");

		// A real click, directly from the list row — never a direct call to the action, which would
		// bypass the screen (same pattern as 23-document-email.cy.ts / 28-document-async-send.cy.ts).
		cy.runDocumentRowAction(purchaseOrderId, "send");
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-recipient-input"]').clear().type(recipient);
		cy.get('[data-cy="document-action-params-confirm"]').click();

		// The displayed status reaches "Sent" via the frontend's own POLLING (useDocumentInstances),
		// not via the click's synchronous response (which only ever returns "sending") — same
		// discipline as 28-document-async-send.cy.ts's own header.
		cy.get(`[data-cy="document-list-row-${purchaseOrderId}"]`, { timeout: 20000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Sent");

		cy.request({ url: `${api}/api/documents/${purchaseOrderId}?typeId=purchase-order` })
			.its("body")
			.then((doc) => {
				expect(doc.status, "le bon de commande est réellement \"sent\" en base").to.eq("sent");
				expect(doc.displayNumber, "un bon de commande envoyé porte un numéro").to.be.a("string");
				displayNumber = doc.displayNumber;

				cy.getLastEmail().then((message: any) => {
					expect(
						message.To?.[0]?.Address,
						"le message va au destinataire tapé dans le formulaire",
					).to.eq(recipient);

					expect(
						message.Attachments,
						"le message a EXACTEMENT une pièce jointe — le PDF, jamais zéro ni un doublon",
					).to.have.length(1);

					const attachment = message.Attachments[0];
					expect(
						attachment.FileName,
						"la pièce jointe est nommée d'après le displayNumber, pas l'id interne",
					).to.eq(`${displayNumber}.pdf`);
					expect(attachment.ContentType, "et c'est bien un PDF").to.eq("application/pdf");
				});
			});
	});

	it('cancels it via the screen — "cancel-order", not "cancel" (see the descriptor\'s own header)', () => {
		expect(purchaseOrderId, "le bon de commande envoyé existe toujours").to.be.a("string");

		cy.visit("/documents/purchase-order");
		cy.get(`[data-cy="document-list-row-${purchaseOrderId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Sent");

		// No params dialog for this action (no `params` declared) — a real click runs it immediately,
		// see use-document-action-runner.ts's own `handleAction`.
		cy.runDocumentRowAction(purchaseOrderId, "cancel-order");

		cy.get(`[data-cy="document-list-row-${purchaseOrderId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Cancelled");

		cy.request({ url: `${api}/api/documents/${purchaseOrderId}?typeId=purchase-order` })
			.its("body")
			.then((doc) => {
				expect(doc.status, "le bon de commande est réellement annulé en base").to.eq("cancelled");
				// The number earned at "sending" is NEVER touched by a cancellation — same guarantee
				// invoice-actions.ts's own "cancel" holds.
				expect(doc.displayNumber).to.eq(displayNumber);
			});

		// The generic "cancel" action button never appears for this type — see the descriptor's own
		// header: naming it "cancel" would make it silently unreachable from the screen, so this type
		// never declares one at all.
		cy.get(`[data-cy="document-row-action-cancel-${purchaseOrderId}"]`).should("not.exist");
	});
});
