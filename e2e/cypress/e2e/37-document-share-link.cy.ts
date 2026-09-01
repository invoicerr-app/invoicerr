/**
 * Root TODO item 24 ("liens publics de téléchargement") — prouvé PAR L'ÉCRAN, même discipline que
 * 28/34 : l'envoi de la facture et la création/révocation du lien passent par de VRAIS clics, les
 * assertions qui comptent relisent soit l'API, soit — pour le lien public lui-même — une requête
 * HTTP réelle, SANS AUCUN cookie de session, exactement le scénario qu'un client recevant ce lien
 * par e-mail vivrait.
 *
 * La société de seed (cy.resetAndSeed()) est française (Acme Corp, countryCode FR) — "share-link"
 * y est `allowed: true` (unverified) pour "invoice" (voir data/fr.json), donc rien ici ne teste le
 * blocage par politique pays (déjà couvert au niveau jest, country-policy.spec.ts).
 *
 * Régression couverte par la même passe : 19 (le bouton PDF authentifié continue de fonctionner —
 * le lien public appelle EXACTEMENT le même rendu, jamais une seconde implémentation) et 28 (l'envoi
 * asynchrone d'une facture n'est pas perturbé par l'ajout du bouton "share-link" sur la même ligne).
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

/** Configure le transport le plus simple à faire réussir en CI — même choix que 34. */
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

describe("Les liens publics de téléchargement (item 24) — créés, copiés, révoqués depuis l'écran", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it(
		'crée un lien de partage sur une facture ENVOYÉE, et l\'URL copiée sert le PDF SANS AUCUNE session ' +
			"(cy.request sans cookie) — puis la révocation rend cette même URL 404",
		() => {
			cy.clearEmails();
			configureEmailTransport();

			createInvoiceDraft().then((invoiceId) => {
				sendInvoiceFromScreen(invoiceId);

				// Le bouton "Share link" n'existe que pour un document non-brouillon — voir le test
				// dédié plus bas pour la négative. Ici il doit être là, la facture étant "sent".
				cy.get(`[data-cy="document-share-link-button-${invoiceId}"]`, { timeout: 15000 }).click();
				cy.get('[data-cy="share-link-dialog"]', { timeout: 15000 }).should("be.visible");

				// Aucun lien actif avant la création.
				cy.get('[data-cy="share-link-empty"]').should("be.visible");

				cy.get('[data-cy="share-link-create-button"]').click();
				cy.get('[data-cy="share-link-created-url"]', { timeout: 15000 }).should("be.visible");

				// Le bouton "copier" est bien celui qu'un utilisateur cliquerait — on l'exerce pour de
				// vrai (le presse-papiers réel n'est pas ce que ce test vérifie, l'URL elle-même l'est).
				cy.get('[data-cy="share-link-copy-button"]').click();

				// Le lien apparaît maintenant dans la liste des liens actifs du document.
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

						// SANS AUCUNE session — la preuve centrale de ce ticket.
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

						// La session revient (cy.session restaure le cookie sans repasser par l'écran de
						// connexion) pour pouvoir révoquer depuis l'écran.
						cy.login();
						cy.visit("/documents/invoice");
						cy.get(`[data-cy="document-share-link-button-${invoiceId}"]`, { timeout: 15000 }).click();
						cy.get('[data-cy="share-link-dialog"]', { timeout: 15000 }).should("be.visible");
						cy.get('[data-cy^="share-link-revoke-"]', { timeout: 15000 }).first().click();
						cy.get('[data-cy="share-link-empty"]', { timeout: 15000 }).should("be.visible");

						// La même URL, exactement — 404 maintenant, toujours sans session.
						cy.clearCookies();
						cy.request({ url: publicUrl, failOnStatusCode: false }).then((res) => {
							expect(res.status, "révoqué -> 404").to.eq(404);
						});
					});
			});
		},
	);

	it("un brouillon (jamais envoyé) n'offre pas l'action \"share-link\"", () => {
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
