/**
 * L'archivage légal (root TODO item 14, "⚖ — rétention par pays, intégrité") — prouvé PAR L'ÉCRAN,
 * même discipline que 28/33 : l'envoi passe par un vrai clic sur "Send", les ASSERTIONS qui comptent
 * relisent l'API (jamais l'écran comme preuve de ce qui est en base), et le verify RE-HACHE réellement
 * les octets stockés côté serveur — jamais un verdict mis en cache côté client.
 *
 * La société de seed (cy.resetAndSeed()) est française (Acme Corp, countryCode FR) — exactement le
 * cas où la rétention légale a une donnée sourcée : max(fiscale 6 ans LPF L102 B, commerciale 10 ans
 * C. com. L123-22) = 10 ans, voir backend/src/modules/documents/archive/retention/data/fr.json. On
 * envoie une facture par e-mail (le transport le plus simple à faire réussir en CI, "email suffit"
 * selon la tâche) : le seul artefact réellement livré est le PDF signé s'il l'était, jamais un format
 * structuré inventé pour un transport qui n'en produit pas.
 *
 * Régression couverte par la même passe : 28 (l'envoi asynchrone continue de fonctionner une fois
 * l'archivage câblé après le "sent" — jamais un envoi cassé par cet ajout).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface DocumentArchive {
	id: string;
	contentHash: string;
	archivedAt: string;
	retentionUntil: string | null;
	retentionBasis: string | null;
}

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

describe('L\'archivage légal ⚖ — hash, date, vérification et rétention FR, prouvés par l\'écran', () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('une facture envoyée par e-mail montre son archive à l\'écran (hash, date), et "verify" répond intact', () => {
		cy.clearEmails();

		// Le transport le plus simple à faire réussir en CI — voir l'en-tête de ce fichier.
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

			// Un vrai clic — jamais un appel direct à l'action, qui contournerait l'écran.
			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			// Le statut affiché atteint "Sent" par le polling du front (même mécanisme que 28) — la
			// facture n'a aucun param "send" (le transport lit le client, pas un champ tapé), donc pas
			// de dialogue de paramètres à traverser ici.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");

			// L'assertion qui compte lit l'API, jamais l'écran comme preuve de ce qui est en base —
			// même discipline que 28.
			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, "la facture est réellement \"sent\" en base").to.eq("sent");
				});

			cy.getLastEmail().then((message: any) => {
				expect(message.To?.[0]?.Address, "le message va au client du seed").to.eq(
					"test.client@example.com",
				);
				expect(message.Attachments, "le PDF réellement envoyé — l'artefact archivé").to.have.length(1);
			});

			// L'écran document montre l'archive : ouverture du dialogue d'édition sur la facture
			// désormais "sent".
			cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

			// Le dialogue défile (overflow-y-auto, [typeId].tsx) — la section archive est plus bas que
			// les champs du formulaire, il faut donc y défiler avant toute assertion de visibilité.
			cy.get('[data-cy="document-archive-section"]', { timeout: 15000 })
				.scrollIntoView()
				.should("be.visible");
			cy.get('[data-cy="document-archive-hash"]').should("be.visible").invoke("text").then((text) => {
				expect(text.trim().length, "un hash abrégé, non vide").to.be.greaterThan(0);
			});
			cy.get('[data-cy="document-archive-date"]').should("be.visible");
			// Rétention FR (⚖) montrée à l'écran, jamais une durée inventée — voir data/fr.json : la
			// règle retenue (commerciale, 10 ans) est CITÉE, pas juste un nombre.
			cy.get('[data-cy="document-archive-retention"]').should("contain.text", "C. com. art. L123-22");

			// La vérification RE-HACHE réellement les octets côté serveur (persistence.ts#verifyDocumentArchive)
			// — jamais un verdict statique côté client.
			cy.get('[data-cy^="document-archive-verify-"]').first().click();
			cy.get('[data-cy^="document-archive-verify-result-"]', { timeout: 15000 }).should(
				"contain.text",
				"Intact",
			);

			// L'API liste l'archive avec retentionUntil et basis pour la société FR — la preuve qui
			// compte, indépendante de tout rendu.
			cy.request({ url: `${api}/api/documents/${invoiceId}/archives?typeId=invoice` })
				.its("body")
				.then((archives: DocumentArchive[]) => {
					expect(archives, "au moins une archive pour cette facture envoyée").to.have.length.greaterThan(
						0,
					);
					const archive = archives[0];
					expect(archive.contentHash, "un hash SHA-256 réel").to.match(/^[0-9a-f]{64}$/);
					expect(archive.retentionUntil, "FR : une échéance de rétention, jamais nulle").to.be.a(
						"string",
					);
					expect(archive.retentionBasis, "la règle retenue est citée").to.match(
						/C\. com\. art\. L123-22/,
					);
					expect(archive.retentionBasis, "la seconde obligation simultanée est nommée aussi").to.match(
						/LPF art\. L102 B/,
					);

					// La vérification côté API aussi : intact.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/${invoiceId}/archives/${archive.id}/verify?typeId=invoice`,
					})
						.its("body")
						.then((result) => {
							expect(result.status, "intact via l'API aussi").to.eq("intact");
						});
				});
		});
	});
});
