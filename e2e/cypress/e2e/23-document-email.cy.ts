export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Sending carries the PDF along (root TODO, item 4) — proven by the screen, not only in memory, the
 * same discipline as 17/21/22: the ACTION goes through a real click on "Send", the ASSERTIONS read
 * the record back via the API (never the screen as proof of what is in the database) AND the real
 * message in Mailpit (the e2e stack's real SMTP — no gate needed here, unlike the jest
 * send-quote.live.spec.ts, since e2e already uses a real SMTP server for its other flows, e.g.
 * the email verification code).
 *
 * Mailpit is cleared at the start of each test (`cy.clearEmails()`) so that "the last message" is
 * unambiguously the one THIS test produced.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Sending a document carries its PDF as an attachment", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('a real click on "Send" attaches the PDF (named after the displayNumber) and interpolates the subject', () => {
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
							issueDate: "2026-08-30",
							currency: "EUR",
							lines: [{ description: "Consulting", quantity: 1, unitPrice: 500 }],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
					const quoteId = saved.body?.document?.id;
					expect(quoteId, "le brouillon a un identifiant").to.be.a("string");

					cy.visit("/documents/quote");
					// A real click, exactly the pattern from 21/22 — never a direct call to the action that
					// would bypass the screen.
					cy.get(`[data-cy="document-row-action-send-${quoteId}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="document-field-recipient-input"]')
						.clear()
						.type("email-test-client@example.com");
					cy.get('[data-cy="document-action-params-confirm"]').click();

					// The list confirms the send on the screen...
					cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// ...then we read back what is actually stored — the displayNumber comes from the SERVER,
					// never rebuilt here (the same discipline as 22-document-numbering.cy.ts).
					cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
						.its("body")
						.then((doc) => {
							expect(doc.displayNumber, "le devis envoyé porte un numéro").to.be.a("string");

							cy.getLastEmail().then((message: any) => {
								expect(
									message.To?.[0]?.Address,
									"le message va au destinataire tapé dans le formulaire",
								).to.eq("email-test-client@example.com");

								expect(
									message.Attachments,
									"le message a EXACTEMENT une pièce jointe — le PDF, jamais zéro (envoi silencieux) ni un doublon",
								).to.have.length(1);

								const attachment = message.Attachments[0];
								expect(
									attachment.FileName,
									"la pièce jointe est nommée d'après le displayNumber du devis, pas son id interne",
								).to.eq(`${doc.displayNumber}.pdf`);
								expect(
									attachment.ContentType,
									"et c'est bien un PDF",
								).to.eq("application/pdf");

								expect(
									message.Subject,
									"le sujet vient du gabarit du devis, interpolé avec son propre displayNumber",
								).to.include(doc.displayNumber);
							});
						});
				});
			});
	});
});
