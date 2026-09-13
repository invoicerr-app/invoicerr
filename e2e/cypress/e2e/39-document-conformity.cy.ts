export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Post-deposit conformity tracking — proven THROUGH THE SCREEN, the same
 * discipline as 28/31/34: the send goes through a real click on "Send", the ASSERTIONS that matter
 * read back the API, never the screen as proof of what's in the database.
 *
 * This spec covers ONLY the negative case reachable in e2e: a document sent by EMAIL
 * (no platform, hence no poller) shows NOTHING — no falsely empty section, no indicator on the
 * list. Spec 31's own fake PDP channel only ever produces a `send_failed` (the
 * port is closed — see that spec's own header): there is therefore NO e2e-reachable way to
 * make a real conformity event land on this suite. The timeline with real events
 * (fr:200→202 accepted, fr:213 rejected with a reason) is proven:
 *  - LIVE, with the REAL production poller, by
 *    `backend/src/modules/documents/transports/pdp/pdp-conformity.live.spec.ts` (jest, `PDP_LIVE=1`);
 *  - at the RENDERING level, by a vitest component test with HARDCODED events
 *    (`frontend/src/components/documents/document-conformity-section.spec.tsx`, the same pattern as
 *    `descriptor-i18n.spec.ts`) — never reachable here, in this Cypress suite, honestly.
 *
 * Regressions covered: 28 (the asynchronous send keeps working) and 31 (the
 * fake PDP channel keeps failing into "send_failed", never "sent" — so the conformity sweep never
 * has anything to find for this document either).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createInvoiceDraft() {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-31",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{ description: "Conseil", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				})
				.then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id as string;
					expect(id, "le brouillon a un identifiant").to.be.a("string");
					return id;
				});
		});
}

describe("Post-deposit conformity tracking — a send by email shows nothing", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("an invoice sent by email shows no conformity section nor badge at all", () => {
		cy.clearEmails();

		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
		});

		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			// A real click — never a direct call to the action.
			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");

			// The assertion that matters reads back the API — the same discipline as 28/34.
			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, "la facture est réellement \"sent\" en base").to.eq("sent");
				});

			cy.getLastEmail().then((message: any) => {
				expect(message.To?.[0]?.Address, "le message va au client du seed").to.eq(
					"test.client@example.com",
				);
			});

			// PROOF 1 — the API itself: no conformity event at all for a send by email
			// (no poller is wired for "email" — see authority-status-poller.ts's own header).
			cy.request({ url: `${api}/api/documents/${invoiceId}/authority-events?typeId=invoice` })
				.its("body")
				.should("deep.equal", []);

			// PROOF 2 — on the LIST, no conformity indicator at all (never an invented rejection).
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`)
				.find(`[data-cy="document-conformity-badge-${invoiceId}"]`)
				.should("not.exist");

			// PROOF 3 — in the edit dialog, NO conformity section at all — never a falsely
			// empty block (the same choice as document-archive-section.tsx for a document with no archive).
			cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");
			// The archive, on the other hand, IS shown (regression 34) — the proof the dialog has
			// genuinely finished loading, before asserting the ABSENCE of the conformity section right below.
			cy.get('[data-cy="document-archive-section"]', { timeout: 15000 })
				.scrollIntoView()
				.should("be.visible");
			cy.get('[data-cy="document-conformity-section"]').should("not.exist");
		});
	});
});
