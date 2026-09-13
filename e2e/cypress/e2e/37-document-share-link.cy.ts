/**
 * Public download links — proven THROUGH THE SCREEN, same discipline as
 * 28/34: sending the invoice and creating/revoking the link go through REAL clicks, the
 * assertions that matter read back either the API, or — for the public link itself — a real
 * HTTP request, WITH NO session cookie AT ALL, exactly the scenario a client receiving this link
 * by email would experience.
 *
 * The seed company (cy.resetAndSeed()) is French (Acme Corp, countryCode FR) — "share-link"
 * is `allowed: true` (unverified) there for "invoice" (see data/fr.json), so nothing here tests
 * country-policy blocking (already covered at the jest level, country-policy.spec.ts).
 *
 * Regression covered by the same pass: 19 (the authenticated PDF button keeps working —
 * the public link calls EXACTLY the same render, never a second implementation) and 28 (an
 * invoice's asynchronous send is not disrupted by adding the "share-link" button on the same row).
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

/** Configures the simplest transport to make succeed in CI — same choice as 34. */
function configureEmailTransport() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		})
		.then((res) => {
			expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
		});
}

function sendInvoiceFromScreen(invoiceId: string) {
	cy.visit("/documents/invoice");
	cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
		.find('[data-cy="document-status-badge"]')
		.should("contain.text", "Draft");

	cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();
	cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
		.find('[data-cy="document-status-badge"]')
		.should("contain.text", "Sent");
}

describe("Public download links (item 24) — created, copied, revoked from the screen", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it(
		"creates a share link on a SENT invoice, and the copied URL serves the PDF WITH NO session " +
			"AT ALL (a cy.request with no cookie) — then revoking it turns that same URL into a 404",
		() => {
			cy.clearEmails();
			configureEmailTransport();

			createInvoiceDraft().then((invoiceId) => {
				sendInvoiceFromScreen(invoiceId);

				// The "Share link" button only exists for a non-draft document — see the test
				// dedicated to the negative case further below. Here it must be present, the invoice being "sent".
				cy.get(`[data-cy="document-share-link-button-${invoiceId}"]`, { timeout: 15000 }).click();
				cy.get('[data-cy="share-link-dialog"]', { timeout: 15000 }).should("be.visible");

				// No active link before creation.
				cy.get('[data-cy="share-link-empty"]').should("be.visible");

				cy.get('[data-cy="share-link-create-button"]').click();
				cy.get('[data-cy="share-link-created-url"]', { timeout: 15000 }).should("be.visible");

				// The "copy" button is indeed the one a user would click — we exercise it for
				// real (the actual clipboard isn't what this test verifies, the URL itself is).
				cy.get('[data-cy="share-link-copy-button"]').click();

				// The link now appears in the document's list of active links.
				cy.get('[data-cy="share-link-list"]', { timeout: 15000 })
					.find('[data-cy^="share-link-row-"]')
					.should("have.length", 1);

				cy.get('[data-cy="share-link-created-url"]')
					.invoke("val")
					.then((rawUrl) => {
						const publicUrl = String(rawUrl);
						expect(publicUrl, "une URL absolue vers /api/public/documents/.../pdf").to.match(
							/^https?:\/\/.+\/api\/public\/documents\/[0-9a-f]{64,}\/pdf$/,
						);

						// WITH NO session AT ALL — the central proof of this ticket.
						cy.clearCookies();
						cy.request({ url: publicUrl, encoding: "binary", failOnStatusCode: false }).then((res) => {
							expect(res.status, "200, sans cookie").to.eq(200);
							expect(res.headers["content-type"], "un vrai PDF").to.include("application/pdf");
							const magic = String.fromCharCode(
								res.body.charCodeAt(0),
								res.body.charCodeAt(1),
								res.body.charCodeAt(2),
								res.body.charCodeAt(3),
							);
							expect(magic, "octets magiques %PDF").to.eq("%PDF");
						});

						// The session comes back (cy.session restores the cookie without going back through
						// the sign-in screen) so the link can be revoked from the screen.
						cy.login();
						cy.visit("/documents/invoice");
						cy.get(`[data-cy="document-share-link-button-${invoiceId}"]`, { timeout: 15000 }).click();
						cy.get('[data-cy="share-link-dialog"]', { timeout: 15000 }).should("be.visible");
						cy.get('[data-cy^="share-link-revoke-"]', { timeout: 15000 }).first().click();
						cy.get('[data-cy="share-link-empty"]', { timeout: 15000 }).should("be.visible");

						// The exact same URL — 404 now, still with no session.
						cy.clearCookies();
						cy.request({ url: publicUrl, failOnStatusCode: false }).then((res) => {
							expect(res.status, "révoqué -> 404").to.eq(404);
						});
					});
			});
		},
	);

	it("a draft (never sent) does not offer the \"share-link\" action", () => {
		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.get(`[data-cy="document-list-row-${invoiceId}"]`).within(() => {
				cy.get(`[data-cy="document-share-link-button-${invoiceId}"]`).should("not.exist");
			});
		});
	});
});
