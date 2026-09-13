/**
 * The country-mandated channel — France now mandates
 * PDP for invoices whose ISSUE date (issueDate) is 2026-09-01 or later
 * (`backend/.../transports/channel-policy/data/fr.json`, source carried over from the git
 * landmark `avant-refonte-documents`, see that file). This spec proves, via the screen, the three
 * effects of the mechanism described in the TODO:
 *
 *  1. the Channels screen shows a "mandated" badge distinct from the "suggested" badge, with its source;
 *  2. sending an invoice ISSUED at/after the mandate via ANOTHER transport (here: email, the
 *     product default) is refused at PREFLIGHT — never persisted beyond "draft" — with a message
 *     that names the mandated channel and its source;
 *  3. connecting the mandated channel (via the screen, as in 31) then choosing it as the transport
 *     SATISFIES the mandate: the send is no longer refused for that reason — it then fails, as in
 *     31, at the real deposit against a fake server (fake baseUrl), never at the mandate.
 *
 * The regression this file explicitly guards against: an invoice ISSUED BEFORE the mandate goes out
 * freely via any transport — the mandate never bites on the server's current date, it
 * bites on the document's ISSUE date (see `channel-policy/mandate.ts`'s own header). This is also
 * what the 14 tests in 31-national-channels.cy.ts already prove implicitly (their invoices are all
 * issued on 2026-08-31, before the mandate) — this file makes it explicit.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

/** Same fake credentials as 31 — see that file's own header for why (port 1, never
 *  open on a normal machine: immediate ECONNREFUSED, no real platform behind it). */
const FAKE_PDP = {
	baseUrl: "http://127.0.0.1:1",
	clientId: "e2e-fake-client-id",
	clientSecret: "e2e-fake-client-secret",
};

function setInvoiceTransport(transportId: string | null) {
	return cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: { invoiceTransportId: transportId },
		failOnStatusCode: false,
	});
}

function createInvoiceDraft(issueDate: string) {
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
							issueDate,
							dueDate: "2026-12-31",
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
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");
					return invoiceId;
				});
		});
}

describe("Country-mandated channel — France mandates PDP for invoices issued since 2026-09-01", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('the Channels screen shows the "mandated" badge for PDP, distinct from the "suggested" badge, with its source visible', () => {
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-pdp"]', { timeout: 15000 }).should("exist");
		// The "suggested" badge stays true even once the channel is mandated — a mandate reinforces
		// a suggestion, it does not contradict it (see channels.settings.tsx's own comment).
		cy.get('[data-cy="channel-pdp-suggested"]').should("exist");
		cy.get('[data-cy="channel-pdp-mandated"]', { timeout: 10000 })
			.should("exist")
			.and("contain.text", "2026-09-01");
		// The source (the citation carried over from the landmark) is visible in the card's description.
		cy.get('[data-cy="channel-pdp"]').should("contain.text", "plateforme agréée");
	});

	it("an invoice ISSUED BEFORE the mandate (2026-08-31) goes out freely via email — the mandate never bites on today's date", () => {
		setInvoiceTransport("email");
		createInvoiceDraft("2026-08-31").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");
		});
	});

	it('an invoice ISSUED on the mandate\'s day (2026-09-01), transport still "email" → refused at PREFLIGHT, never persisted beyond "draft", message naming PDP and its source', () => {
		// The transport stays "email" (previous test) — this is exactly the case the mandate must
		// now refuse: the company's free choice is no longer enough once the mandate is active.
		createInvoiceDraft("2026-09-01").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			// The preflight blocks SYNCHRONOUSLY, before any pass through the queue — a visible toast
			// says so right away, the same discipline as the "disconnects the channel" test in 31.
			cy.get('[data-sonner-toast]', { timeout: 10000 })
				.should("contain.text", "pdp")
				.and("contain.text", "2026-09-01");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, 'jamais persisté au-delà de "draft" — bloqué avant toute écriture').to.eq(
						"draft",
					);
				});
		});
	});

	it("chosen transport = pdp (the mandated channel) but NOT CONNECTED → the same named refusal, never persisted", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', { timeout: 15000 }).click();
		cy.get('[data-cy="company-invoice-transport-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-pdp"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);

		createInvoiceDraft("2026-09-02").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			cy.get('[data-sonner-toast]', { timeout: 10000 })
				.should("contain.text", "PDP")
				.and("contain.text", "not connected");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, 'jamais persisté au-delà de "draft"').to.eq("draft");
				});
		});
	});

	it("connects PDP via the screen → the mandate no longer blocks: the queue really goes out and then fails at the fake deposit, never at the mandate (as in 31)", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-pdp-baseurl-input"]', { timeout: 15000 }).clear().type(FAKE_PDP.baseUrl);
		cy.get('[data-cy="channel-pdp-clientid-input"]').clear().type(FAKE_PDP.clientId);
		cy.get('[data-cy="channel-pdp-clientsecret-input"]').clear().type(FAKE_PDP.clientSecret);
		cy.get('[data-cy="channel-pdp-connect-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel connected");
		cy.get('[data-cy="channel-pdp-status"]', { timeout: 10000 }).should("contain.text", "Connected");

		createInvoiceDraft("2026-09-03").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			// Same documented budget as 31: ATTEMPTS=3 by default, exponential backoff base 2000ms.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
				.find('[data-cy="document-status-badge"]', { timeout: 40000 })
				.should("contain.text", "Send failed");

			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`)
				.should("contain.text", "PDP")
				// The cause of "Send failed" is indeed the fake server (the real deposit failed), never
				// the mandate — the mandate is SATISFIED (the right channel is chosen and connected).
				.and("not.contain.text", "requires invoices");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, 'la facture est réellement "send_failed" en base').to.eq("send_failed");
					expect(doc.transportRef, "aucune référence de dépôt sans dépôt réel").to.not.be.a("string");
				});
		});
	});
});
