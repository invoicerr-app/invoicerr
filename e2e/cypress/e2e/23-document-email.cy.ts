/**
 * L'envoi emporte le PDF (TODO racine, item 4) — prouvé par l'écran, pas seulement en mémoire, même
 * discipline que 17/21/22 : l'ACTION passe par un vrai clic sur "Send", les ASSERTIONS relisent
 * l'enregistrement via l'API (jamais l'écran comme preuve de ce qui est en base) ET le message réel
 * dans Mailpit (le vrai SMTP de la pile e2e — pas de gate nécessaire ici, contrairement au jest
 * send-quote.live.spec.ts, puisque l'e2e utilise déjà un vrai serveur SMTP pour ses autres flux, par
 * ex. le code de vérification par email).
 *
 * Mailpit est vidé au début de chaque test (`cy.clearEmails()`) pour que "le dernier message" soit
 * sans ambiguïté celui que CE test a produit.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("L'envoi d'un document emporte son PDF en pièce jointe", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('un vrai clic sur "Send" joint le PDF (nommé d\'après le displayNumber) et interpole le sujet', () => {
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
					// Un vrai clic, exactement le motif de 21/22 — jamais un appel direct à l'action qui
					// contournerait l'écran.
					cy.get(`[data-cy="document-row-action-send-${quoteId}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="document-field-recipient-input"]')
						.clear()
						.type("email-test-client@example.com");
					cy.get('[data-cy="document-action-params-confirm"]').click();

					// La liste confirme l'envoi à l'écran...
					cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// ...puis on relit ce qui est réellement enregistré — le displayNumber vient du SERVEUR,
					// jamais reconstruit ici (même discipline que 22-document-numbering.cy.ts).
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
