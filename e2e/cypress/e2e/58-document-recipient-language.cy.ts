export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * A document's language follows its recipient ("langue du document par destinataire") — proves the
 * two-language outcome
 * end to end: the ACTION (creating each client, then clicking "Send" on its quote) goes through a real
 * screen, exactly like 05-clients.cy.ts and 23-document-email.cy.ts already do; the ASSERTION reads the
 * real message Mailpit received — the e2e stack's own SMTP server, no gate needed (same discipline
 * 23-document-email.cy.ts already holds).
 *
 * Both clients are given the SAME country (France) on purpose: the whole point of an explicit
 * `Client.language` field (over deriving from `country`) is that language and country are independent
 * facts — a French seller can have an Italian-speaking client without that client living in Italy. If
 * this test instead varied the country too, a bug that silently derived the language FROM the country
 * could still make it pass by coincidence.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClientWithLanguage(name: string, contactEmail: string, languageOptionDataCy: string) {
	cy.visit("/clients");
	cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
	cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

	cy.get('[name="name"]').clear().type(name);
	cy.continueSteppedDialog("client-dialog");

	cy.selectCountry("client-country-select", "France");
	cy.get('[name="address"]').clear().type("1 Rue de Test");
	cy.get('[name="postalCode"]').clear().type("75001");
	cy.get('[name="city"]').clear().type("Paris");
	cy.continueSteppedDialog("client-dialog");

	cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("123456789");
	cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
	cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
	cy.get('[data-cy="client-currency-select"] input').type("Euro");
	cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
	cy.continueSteppedDialog("client-dialog");

	cy.get('[name="contacts.0.email"]').clear().type(contactEmail);
	// The field under test: an explicit document language, independent of the country picked earlier.
	cy.get('[data-cy="client-language-select"]').scrollIntoView().click();
	cy.get(`[data-cy="${languageOptionDataCy}"]`).click();
	cy.continueSteppedDialog("client-dialog");

	cy.get('[data-cy="client-submit"]').click();
	cy.get('[data-cy="client-dialog"]').should("not.exist");
	cy.contains(name, { timeout: 10000 });
}

function findClientIdByEmail(contactEmail: string) {
	// The reference search (`/api/documents/references/client/search`) returns a display label, not the
	// raw contactEmail — the plain clients list carries it instead.
	return cy.request({ url: `${api}/api/clients` }).then((res) => {
		const body = res.body;
		const list: { id: string; contactEmail?: string }[] = Array.isArray(body) ? body : (body?.clients ?? []);
		const match = list.find((c) => c.contactEmail === contactEmail);
		expect(match, `a client with contactEmail ${contactEmail} exists`).to.exist;
		return (match as { id: string }).id;
	});
}

function sendQuoteAndReadEmail(clientId: string) {
	cy.clearEmails();

	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/quote/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate: "2026-09-14",
					currency: "EUR",
					lines: [{ description: "Consulting", quantity: 1, unitPrice: 500 }],
				},
			},
			failOnStatusCode: false,
		})
		.then((saved) => {
			expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
			const quoteId = saved.body?.document?.id as string;
			expect(quoteId, "le brouillon a un identifiant").to.be.a("string");

			cy.visit("/documents/quote");
			// A real click on "Send" — never a direct call to the action, same discipline
			// 23-document-email.cy.ts already holds.
			cy.runDocumentRowAction(quoteId, "send");
			cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
			cy.get('[data-cy="document-field-recipient-input"]').clear().type("recipient@example.com");
			cy.get('[data-cy="document-action-params-confirm"]').click();

			cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");

			return cy.getLastEmail();
		});
}

describe("A document's language follows its recipient", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("a client with an explicit FRENCH document language receives the quote in French", () => {
		createClientWithLanguage("Client Langue FR", "client-fr@example.com", "client-language-select-fr");

		findClientIdByEmail("client-fr@example.com").then((clientId) => {
			sendQuoteAndReadEmail(clientId).then((message) => {
				expect(message.Subject, "le sujet est en français (« de », pas « from »)").to.include(
					"de Acme Corp",
				);
				expect(message.Subject, "jamais le gabarit italien").to.not.include("da Acme Corp");
				const body = message.Text || message.HTML || "";
				expect(body, "le corps du message est en français").to.include("Veuillez trouver ci-joint");
				expect(body, "jamais l'anglais par défaut").to.not.include("Please find attached");
				expect(body, "jamais l'italien").to.not.include("In allegato");
			});
		});
	});

	it("a SECOND client — SAME country, EXPLICIT Italian document language — receives the SAME kind of document in Italian", () => {
		createClientWithLanguage("Client Lingua IT", "client-it@example.com", "client-language-select-it");

		findClientIdByEmail("client-it@example.com").then((clientId) => {
			sendQuoteAndReadEmail(clientId).then((message) => {
				expect(message.Subject, "il soggetto è in italiano (« da », non « from » né « de »)").to.include(
					"da Acme Corp",
				);
				expect(message.Subject, "mai il modello francese").to.not.include("de Acme Corp");
				const body = message.Text || message.HTML || "";
				expect(body, "il corpo del messaggio è in italiano").to.include("In allegato");
				expect(body, "mai l'inglese di default").to.not.include("Please find attached");
				expect(body, "mai il francese").to.not.include("Veuillez trouver ci-joint");
			});
		});
	});
});
