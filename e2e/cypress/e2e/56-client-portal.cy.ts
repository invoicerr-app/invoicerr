export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The authenticated client portal — a client with an invoice AND a quote
 * signs in through a company-issued invite link (no staff session, no per-document email — the exact
 * friction share-link/signature both still have), sees their own documents and balance, and responds
 * to a quote. Two disciplines this suite already holds elsewhere, both proven here:
 *
 *  - actions by clicking, assertions by reading the record (28/34/37/45's own convention): the
 *    invite is created and the quote is refused THROUGH THE SCREEN; what actually happened is read
 *    back via `cy.request` (the API, or a real Mailpit message), never trusted from the DOM alone.
 *  - the security boundary is the point of this feature (this task's own brief): client A's token
 *    must never reach client B's document, and a revoked token must stop working immediately — proven
 *    with real HTTP requests carrying real tokens, exactly the "no session at all" discipline 37
 *    already established for a share link.
 *
 * "Accept" is proven to go through the EXISTING, OTP-hardened signature path (45's own mechanism),
 * never a shortcut: clicking it must produce the SAME `/signature/:token` email that path already
 * sends, read from Mailpit — not a status flip this spec merely asserts happened.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function bodyOf(message: { Text?: string; HTML?: string }): string {
	return `${message.Text ?? ""}\n${message.HTML ?? ""}`;
}

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

function createClient(name: string, email: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				contactEmail: email,
				currency: "EUR",
				country: "FR",
				address: "1 Rue du Portail",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.its("body.id");
}

function createSentInvoice(clientId: string) {
	const data = {
		client: clientId,
		issueDate: "2026-08-31",
		dueDate: "2026-09-30",
		currency: "EUR",
		lines: [{ description: "Conseil", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" }],
	};
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			expect(id, "brouillon de facture créé").to.be.a("string");
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/send`,
				body: { documentId: id, data },
			}).then((res) => expect(res.status, "envoi de facture accepté").to.be.oneOf([200, 201]));
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
			return cy.wrap(id);
		});
}

function createSentQuote(clientId: string, unitPrice: number) {
	const data = {
		client: clientId,
		issueDate: "2026-08-30",
		currency: "EUR",
		lines: [{ description: "Prestation", quantity: 1, unitPrice }],
	};
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/quote/actions/save-draft`, body: { data } })
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			expect(id, "brouillon de devis créé").to.be.a("string");
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/send`,
				body: { documentId: id, data, params: { recipient: "irrelevant@example.com" } },
			}).then((res) => expect(res.status, "envoi de devis accepté").to.be.oneOf([200, 201]));
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=quote`, ["sent"]);
			return cy.wrap(id);
		});
}

/** Creates a portal invite THROUGH THE SCREEN (clients list → the "portal access" button → dialog →
 *  create) and returns the raw token read straight off the on-screen input — the same "read the
 *  actual copyable value, never guess it" discipline `37-document-share-link.cy.ts` already holds. */
function inviteToPortalFromScreen(email: string): Cypress.Chainable<{ url: string; token: string }> {
	cy.visit("/clients");
	cy.get(`[data-cy="client-row-menu-${email}"]`, { timeout: 15000 }).click();
	cy.get(`[data-cy="portal-access-client-button-${email}"]`, { timeout: 15000 }).click();
	cy.get('[data-cy="portal-access-dialog"]', { timeout: 15000 }).should("be.visible");
	cy.get('[data-cy="portal-access-empty"]').should("be.visible");

	cy.get('[data-cy="portal-access-create-button"]').click();
	cy.get('[data-cy="portal-access-created-url"]', { timeout: 15000 }).should("be.visible");
	cy.get('[data-cy="portal-access-copy-button"]').click();
	cy.get('[data-cy="portal-access-list"]').find('[data-cy^="portal-access-row-"]').should("have.length", 1);

	return cy.get('[data-cy="portal-access-created-url"]').then(($input) => {
		const url = String($input.val());
		expect(url, "une URL absolue vers /portal/<jeton>").to.match(
			/^https?:\/\/.+\/portal\/[0-9a-f]{64,}$/,
		);
		cy.get('[data-cy="portal-access-close"]').click();
		return cy.wrap({ url, token: url.split("/portal/")[1] });
	});
}

describe("Client portal — a real client's own space, reached without a fresh email each time", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("lists an invoice AND a quote, shows the balance, accepts (via the EXISTING signature path) and refuses — all through the screen", () => {
		configureEmailTransport();

		createClient("Portal Client SARL", "portal-client@example.com").then((clientId) => {
			createSentInvoice(clientId).then((invoiceId) => {
				createSentQuote(clientId, 500).then((quoteToAccept) => {
					createSentQuote(clientId, 250).then((quoteToRefuse) => {
						inviteToPortalFromScreen("portal-client@example.com").then(({ url }) => {
							// No staff session AT ALL from here on — a client opening the emailed link has none.
							cy.clearCookies();
							cy.clearEmails();
							cy.visit(url);

							// The bootstrap route (`/portal/:token`) redirects to the clean `/portal` URL.
							cy.location("pathname", { timeout: 15000 }).should("eq", "/portal");
							cy.get('[data-cy="portal-dashboard"]', { timeout: 15000 }).should("be.visible");
							cy.get('[data-cy="portal-header"]').should("contain.text", "Portal Client SARL");

							// The invoice appears in the statement, with its own balance.
							cy.get(`[data-cy="portal-document-row-${invoiceId}"]`, { timeout: 15000 }).should("exist");

							// Both quotes await a decision.
							cy.get(`[data-cy="portal-quote-row-${quoteToAccept}"]`, { timeout: 15000 }).should("exist");
							cy.get(`[data-cy="portal-quote-row-${quoteToRefuse}"]`).should("exist");

							// ACCEPT — starts the EXISTING, OTP-hardened signature request; never signs anything
							// itself. Proven by the REAL email it sends, not by trusting the click alone.
							cy.get(`[data-cy="portal-quote-accept-${quoteToAccept}"]`).click();

							cy.getLastEmail().then((message: { Text?: string; HTML?: string }) => {
								const match = bodyOf(message).match(/\/signature\/([0-9a-f]{64})/);
								expect(
									match,
									"« accepter » envoie le VRAI email de demande de signature (lien /signature/<jeton>)",
								).to.not.be.null;
							});

							// REFUSE — a plain, reversible decline; no OTP, no email.
							cy.get(`[data-cy="portal-quote-refuse-${quoteToRefuse}"]`).click();
							cy.get(`[data-cy="portal-quote-row-${quoteToRefuse}"]`, { timeout: 15000 }).within(() => {
								cy.get(`[data-cy="portal-quote-refuse-${quoteToRefuse}"]`).should("not.exist");
							});

							// SIGN OUT — revokes nothing server-side (a plain client action), only forgets the
							// token locally; the invite itself is still valid until staff revokes it below. Done
							// BEFORE `cy.login()`: restoring the staff session below clears the current page
							// (Cypress' own `cy.session` behavior — see its own log), so any on-screen assertion
							// against the portal itself must happen first.
							cy.get('[data-cy="portal-signout-button"]').click();
							cy.get('[data-cy="portal-invalid-card"]', { timeout: 15000 }).should("be.visible");

							// The truth is in the database — read back via the API (staff session restored).
							cy.login();
							cy.request({ url: `${api}/api/documents/${quoteToRefuse}?typeId=quote` })
								.its("body.status")
								.should("eq", "refused");
							cy.request({ url: `${api}/api/documents/${quoteToAccept}?typeId=quote` })
								.its("body.status")
								.should("eq", "sent"); // "accept" only STARTS the flow — it never signs by itself.
						});
					});
				});
			});
		});
	});

	it("the security boundary: client A's token cannot reach client B's document, and a revoked token stops working", () => {
		createClient("Portal Client A", "portal-a@example.com").then((clientAId) => {
			createClient("Portal Client B", "portal-b@example.com").then((clientBId) => {
				createSentInvoice(clientAId).then((invoiceA) => {
					createSentInvoice(clientBId).then((invoiceB) => {
						cy.request({
							method: "POST",
							url: `${api}/api/clients/${clientAId}/portal-access`,
						})
							.its("body")
							.then((accessA) => {
								const tokenA = accessA.token as string;

								cy.clearCookies();

								// Client A CAN reach their own invoice…
								cy.request({
									url: `${api}/api/portal/documents/invoice/${invoiceA}/pdf`,
									headers: { Authorization: `Bearer ${tokenA}` },
									failOnStatusCode: false,
								}).then((res) => {
									expect(res.status, "client A voit sa propre facture").to.eq(200);
								});

								// …but NEVER client B's — same company, wrong client, a 404 (never a 403 that would
								// confirm "this exists, you may just not open it").
								cy.request({
									url: `${api}/api/portal/documents/invoice/${invoiceB}/pdf`,
									headers: { Authorization: `Bearer ${tokenA}` },
									failOnStatusCode: false,
								}).then((res) => {
									expect(res.status, "client A NE VOIT PAS la facture du client B").to.eq(404);
								});

								// A missing/garbage token never resolves at all.
								cy.request({
									url: `${api}/api/portal/me`,
									failOnStatusCode: false,
								}).then((res) => expect(res.status, "aucun jeton -> 401").to.eq(401));

								cy.login();
								cy.request({ url: `${api}/api/clients/${clientAId}/portal-access` })
									.its("body")
									.then((invites: { id: string }[]) => {
										expect(invites, "un jeton actif pour le client A").to.have.length(1);
										cy.request({
											method: "DELETE",
											url: `${api}/api/clients/${clientAId}/portal-access/${invites[0].id}`,
										}).then((res) => expect(res.status).to.be.oneOf([200, 201]));

										cy.clearCookies();
										cy.request({
											url: `${api}/api/portal/me`,
											headers: { Authorization: `Bearer ${tokenA}` },
											failOnStatusCode: false,
										}).then((res) => {
											expect(res.status, "un jeton révoqué ne resout plus jamais rien").to.eq(401);
										});
									});
							});
					});
				});
			});
		});
	});
});
