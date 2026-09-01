/**
 * Le suivi de conformité post-dépôt (root TODO item 10, reliquat) — prouvé PAR L'ÉCRAN, même
 * discipline que 28/31/34 : l'envoi passe par un vrai clic sur "Send", les ASSERTIONS qui comptent
 * relisent l'API, jamais l'écran comme preuve de ce qui est en base.
 *
 * Cette spec couvre UNIQUEMENT le cas négatif atteignable en e2e : un document envoyé par EMAIL
 * (aucune plateforme, donc aucun poller) n'affiche RIEN — pas de section vide mensongère, pas
 * d'indicateur sur la liste. Le canal PDP fictif de la spec 31 ne produit qu'un `send_failed` (le
 * port est fermé — voir cette spec's own header) : il n'existe donc AUCUN moyen e2e-atteignable de
 * faire arriver un événement de conformité réel sur cette suite. La timeline avec des événements
 * réels (fr:200→202 acceptée, fr:213 rejetée avec motif) est prouvée :
 *  - LIVE, avec le VRAI poller de production, par
 *    `backend/src/modules/documents/transports/pdp/pdp-conformity.live.spec.ts` (jest, `PDP_LIVE=1`) ;
 *  - au niveau du RENDU, par un test de composant vitest avec des événements EN DUR
 *    (`frontend/src/components/documents/document-conformity-section.spec.tsx`, le même motif que
 *    `descriptor-i18n.spec.ts`) — jamais atteignable ici, dans cette suite Cypress, honnêtement.
 *
 * Régression couverte par la même passe : 28 (l'envoi asynchrone continue de fonctionner) et 31 (le
 * canal PDP fictif continue d'échouer en "send_failed", jamais en "sent" — le sweep de conformité
 * n'a donc jamais rien à trouver pour ce document non plus).
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

describe("Le suivi de conformité post-dépôt — un envoi par e-mail n'affiche rien", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("une facture envoyée par e-mail ne montre aucune section ni badge de conformité", () => {
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

			// Un vrai clic — jamais un appel direct à l'action.
			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");

			// L'assertion qui compte relit l'API — même discipline que 28/34.
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

			// PREUVE 1 — l'API elle-même : aucun événement de conformité pour un envoi par e-mail
			// (aucun poller n'est câblé pour "email" — voir authority-status-poller.ts's own header).
			cy.request({ url: `${api}/api/documents/${invoiceId}/authority-events?typeId=invoice` })
				.its("body")
				.should("deep.equal", []);

			// PREUVE 2 — sur la LISTE, aucun indicateur de conformité (jamais un rejet inventé).
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`)
				.find(`[data-cy="document-conformity-badge-${invoiceId}"]`)
				.should("not.exist");

			// PREUVE 3 — dans le dialogue d'édition, AUCUNE section conformité — jamais un bloc vide
			// mensonger (même choix que document-archive-section.tsx pour un document sans archive).
			cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");
			// L'archive, elle, EST montrée (régression 34) — la preuve que le dialogue a bien fini de
			// charger, avant d'affirmer l'ABSENCE de la section conformité juste en dessous.
			cy.get('[data-cy="document-archive-section"]', { timeout: 15000 })
				.scrollIntoView()
				.should("be.visible");
			cy.get('[data-cy="document-conformity-section"]').should("not.exist");
		});
	});
});
