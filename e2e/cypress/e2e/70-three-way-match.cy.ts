export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Three-way match ("rapprochement à 3 voies") — the full chain: a purchase
 * order (BC) is sent, a PARTIAL goods receipt is recorded against it (6 of the 10 ordered), a
 * received invoice is entered LINKED to the same BC but billing for the full 10 — an honest
 * over-billing relative to what was actually received (see `reconciliation/three-way-match.ts`'s own
 * header, "the goods receipt is the quantity truth") — and the "Reconciliation" panel on that invoice
 * shows the variance. An OWNER (john.doe@acme.org, seeded by `cy.resetAndSeed()`) then accepts it.
 *
 * Same discipline as 66-purchase-orders.cy.ts (its own direct sibling — read that file first): every
 * state-changing ACTION goes through a real click on the screen; every `cy.intercept`+`cy.wait` is
 * followed by an HTTP status assertion BEFORE anything else (no toast is ever asserted here at all);
 * the FACTS that matter (verdict, acceptance trace) are re-read via `cy.request`, never trusted from
 * the screen alone. The document dialog is never asserted closed anywhere in this file — it stays
 * open by design (document-upsert-dialog.tsx) and no step here needs it shut.
 *
 * DATES: `[data-cy="document-field-*Date-input"]` is a calendar POPOVER with no typable text input at
 * all (frontend/src/components/date-picker.tsx — a button that opens a `<Calendar>`, nothing else) —
 * there is no way to "type" a date into this screen. "Today" is picked via `cy.pickToday()`
 * (support/commands.ts), which clicks the DatePicker's own "Today" footer button instead of computing
 * a `[data-day="M/D/YYYY"]` guess — the source of the CI races (runs 34954776077, 34930840117,
 * 34951814251) that a merely-deferred-computation version of this helper was still exposed to.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Three-way match — purchase order × goods receipt × received invoice", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	let purchaseOrderId: string;
	let goodsReceiptId: string;
	let receivedInvoiceId: string;

	it("creates and sends a purchase order for 10 Widgets @ 25 EUR", () => {
		cy.visit("/documents/purchase-order");
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[data-cy="document-field-supplier-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-supplier-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-supplier-input-options"] button').first().click();

		cy.pickToday('[data-cy="document-field-issueDate-input"]');

		cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("Widgets", { force: true });
		cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("10", { force: true });
		cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("25", { force: true });

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

			// See 66-purchase-orders.cy.ts's own comment for why this stays nested here: a value this
			// `.then()` just produced is used only inside it, never captured for a sibling command.
			// The first save landed on the new record's own page (document-create-dialog.tsx); the
			// "send" below is the LIST row's, so go back to the list first.
			cy.visit("/documents/purchase-order");

			cy.get('[data-cy="document-row-action-send-' + purchaseOrderId + '"]', { timeout: 15000 }).click();
			cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
			cy.get('[data-cy="document-field-recipient-input"]').clear().type(`three-way-match-${Date.now()}@example.com`);

			cy.intercept("POST", `${api}/api/documents/types/purchase-order/actions/send`).as("sendPurchaseOrder");
			cy.get('[data-cy="document-action-params-confirm"]').click();
			cy.wait("@sendPurchaseOrder").then((sendInterception) => {
				// Async "send": the synchronous response only ever carries "sending" — see
				// 28-document-async-send.cy.ts's own header. The status CODE is what this step proves.
				expect(sendInterception.response?.statusCode, "envoi du bon de commande accepté").to.be.oneOf([
					200, 201,
				]);
			});

			cy.get(`[data-cy="document-list-row-${purchaseOrderId}"]`, { timeout: 20000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");
		});
	});

	it("records a PARTIAL goods receipt against the purchase order — 6 of the 10 ordered", () => {
		expect(purchaseOrderId, "le bon de commande du test précédent existe toujours").to.be.a("string");

		cy.visit("/documents/goods-receipt");
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 5000 }).should("be.visible");

		// The prefill (below) fires off the SAME "purchaseOrder resolved" watch that also drives this
		// picker's own label — waiting on the raw fields GET, not just the picker closing, is what
		// makes this robust against the prefill's own network round-trip rather than racing it blind.
		cy.intercept("GET", `${api}/api/documents/references/purchase-order/*/fields`).as(
			"getPurchaseOrderFields",
		);
		cy.get('[data-cy="document-field-purchaseOrder-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-purchaseOrder-input-options"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="document-field-purchaseOrder-input-options"] button').first().click();
		cy.wait("@getPurchaseOrderFields").then((interception) => {
			expect(interception.response?.statusCode, "les champs du BC pour le pré-remplissage").to.eq(
				200,
			);
		});

		cy.pickToday('[data-cy="document-field-receiptDate-input"]');

		// The line is PRE-FILLED from the purchase order's own lines the moment "purchaseOrder"
		// resolves (document-form.tsx's own narrow, named exception — see goods-receipt.descriptor.ts's
		// header): never "add row" here, which would stack a SECOND, blank row on top of this one.
		cy.get('[data-cy="document-field-lines-row-0"]', { timeout: 10000 }).should("exist");
		cy.get('input[name="lines.0.description"]', { timeout: 10000 }).should("have.value", "Widgets");
		// `quantityReceived` arrives PRE-FILLED with the PO's own ordered quantity ("10") — the SAME
		// `form.setValue("lines", ...)` call that also fills `description` above (document-form.tsx's
		// "isGoodsReceipt" effect). Assert that value landed on THIS field before touching it (mirrors
		// the `description` check above), then replace it atomically with `{selectall}` inside one
		// `.type()` rather than a separate `.clear()` command followed by `.type()`: split across two
		// commands there was a window where the field still read "10" between them, so "6" landed next
		// to it instead of in place of it — recorded as "610", not "6" (runs 34973167392, 34974390827).
		cy.get('input[name="lines.0.quantityReceived"]', { timeout: 10000 })
			.should("have.value", "10")
			.type("{selectall}6", { force: true });

		cy.intercept("POST", `${api}/api/documents/types/goods-receipt/actions/save-draft`).as(
			"saveGoodsReceiptDraft",
		);
		cy.get('[data-cy="document-action-save-draft"]').scrollIntoView().click();
		cy.wait("@saveGoodsReceiptDraft").then((interception) => {
			expect(interception.response?.statusCode, "brouillon de réception créé").to.be.oneOf([200, 201]);
			goodsReceiptId = interception.response?.body?.document?.id as string;
			expect(goodsReceiptId, "le brouillon de réception a un identifiant").to.be.a("string");
			expect(
				interception.response?.body?.document?.data?.lines?.[0]?.quantityReceived,
				"6 unités reçues, telles que saisies à l'écran",
			).to.eq(6);

			cy.get("body").type("{esc}");
		});
	});

	it('records the goods receipt ("draft" -> "recorded")', () => {
		expect(goodsReceiptId, "le brouillon de réception du test précédent existe toujours").to.be.a(
			"string",
		);

		cy.visit("/documents/goods-receipt");
		cy.get(`[data-cy="document-list-row-${goodsReceiptId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Draft");

		cy.intercept("POST", `${api}/api/documents/types/goods-receipt/actions/record`).as("recordGoodsReceipt");
		cy.get(`[data-cy="document-row-action-record-${goodsReceiptId}"]`, { timeout: 15000 }).click();
		cy.wait("@recordGoodsReceipt").then((interception) => {
			expect(interception.response?.statusCode, "réception enregistrée").to.be.oneOf([200, 201]);
			expect(interception.response?.body?.document?.status).to.eq("recorded");
		});

		cy.get(`[data-cy="document-list-row-${goodsReceiptId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Recorded");
	});

	it("records a received invoice for the full 10 Widgets, linked to the same purchase order", () => {
		expect(purchaseOrderId, "le bon de commande existe toujours").to.be.a("string");

		cy.visit("/documents/received-invoice");
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[data-cy="document-field-purchaseOrder-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-purchaseOrder-input-options"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="document-field-purchaseOrder-input-options"] button').first().click();

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("Widgets", { force: true });
		cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("10", { force: true });
		cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("25", { force: true });

		cy.intercept("POST", `${api}/api/documents/types/received-invoice/actions/receive`).as(
			"receiveInvoice",
		);
		cy.get('[data-cy="document-action-receive"]').scrollIntoView().click();
		cy.wait("@receiveInvoice").then((interception) => {
			expect(interception.response?.statusCode, "facture reçue enregistrée").to.be.oneOf([200, 201]);
			receivedInvoiceId = interception.response?.body?.document?.id as string;
			expect(receivedInvoiceId, "la facture reçue a un identifiant").to.be.a("string");
			expect(interception.response?.body?.document?.data?.purchaseOrder, "le BC est bien lié").to.eq(
				purchaseOrderId,
			);

			cy.get("body").type("{esc}");
		});
	});

	it('shows the reconciliation panel with a "to review" variance (10 invoiced vs. 6 received)', () => {
		expect(receivedInvoiceId, "la facture reçue du test précédent existe toujours").to.be.a("string");

		cy.intercept(
			"GET",
			`${api}/api/documents/received-invoices/${receivedInvoiceId}/reconciliation`,
		).as("getReconciliation");

		cy.visit("/documents/received-invoice");
		cy.openDocument(receivedInvoiceId);

		// The intercept only proves the page asked for the reconciliation. Its BODY is never asserted:
		// a second identical GET in the same run comes back a genuine HTTP 304 Not Modified (Express's
		// weak ETag + the browser's conditional GET), and a 304 has no body per HTTP spec — the screen
		// still renders from the browser's own cache, but the raw intercepted response is empty, and
		// `statusCode … to.eq(200)` was red in CI for exactly that reason. The facts are read back
		// through `cy.request` (Cypress's own Node-side client, never subject to the browser cache) —
		// the same fix 65-mail-cascade.cy.ts documents for its own page-load GET.
		cy.wait("@getReconciliation");
		cy.request({
			url: `${api}/api/documents/received-invoices/${receivedInvoiceId}/reconciliation`,
		})
			.its("body")
			.then((body) => {
				expect(body.hasPurchaseOrder, "un BC est bien lié").to.eq(true);
				expect(body.overallVerdict, "10 facturés contre 6 reçus doit être signalé").to.eq("to-review");
			});

		// scrollIntoView(): on the CI viewport (1000×660, under the page's `lg` breakpoint) the record
		// page stacks its side sections UNDER the form (document-detail.tsx), so the panel sits past
		// one screenful rather than absent. Same pattern as 17-document-descriptor.cy.ts's own
		// per-field scrollIntoView().
		cy.get('[data-cy="document-reconciliation-section"]', { timeout: 10000 })
			.scrollIntoView()
			.should("be.visible");
		cy.get('[data-cy="document-reconciliation-overall-badge"]').should("contain.text", "To review");
		cy.get('[data-cy="document-reconciliation-line-0-badge"]').should("contain.text", "To review");
		cy.get('[data-cy="document-reconciliation-line-0"]').should("contain.text", "Widgets");

		// Never accepted yet — no trace to show.
		cy.get('[data-cy="document-reconciliation-acceptance"]').should("not.exist");
	});

	it('accepts the variance — "Accept the variance" (john.doe@acme.org is this company\'s OWNER), trace recorded', () => {
		expect(receivedInvoiceId, "la facture reçue existe toujours").to.be.a("string");

		cy.visit("/documents/received-invoice");
		cy.openDocument(receivedInvoiceId);
		// scrollIntoView() — same "page taller than the CI viewport" reasoning as the previous test's
		// own comment on `document-reconciliation-section`.
		cy.get('[data-cy="document-reconciliation-accept-button"]', { timeout: 10000 })
			.scrollIntoView()
			.should("be.visible");

		cy.get('[data-cy="document-reconciliation-accept-reason"]').type("Supplier confirmed by phone.");

		cy.intercept(
			"POST",
			`${api}/api/documents/received-invoices/${receivedInvoiceId}/accept-variance`,
		).as("acceptVariance");
		cy.get('[data-cy="document-reconciliation-accept-button"]').click();
		cy.wait("@acceptVariance").then((interception) => {
			expect(interception.response?.statusCode, "écart accepté").to.eq(200);
			expect(interception.response?.body?.overallVerdict).to.eq("accepted");
			expect(
				interception.response?.body?.acceptance?.acceptedByLabel,
				"l'utilisateur connecté (john.doe) est tracé",
			).to.eq("John Doe");
		});

		// The panel re-renders straight from the mutation's own response — see
		// document-reconciliation-section.tsx's own header.
		cy.get('[data-cy="document-reconciliation-overall-badge"]').should("contain.text", "Accepted");
		cy.get('[data-cy="document-reconciliation-acceptance"]').should("contain.text", "John Doe");

		cy.request({
			url: `${api}/api/documents/received-invoices/${receivedInvoiceId}/reconciliation`,
		})
			.its("body")
			.then((body) => {
				expect(body.overallVerdict, "confirmé en base, pas seulement à l'écran").to.eq("accepted");
				expect(body.acceptance.acceptedByLabel).to.eq("John Doe");
				expect(body.acceptance.reason).to.eq("Supplier confirmed by phone.");
			});
	});
});
