/**
 * L'envoi asynchrone d'un document (TODO racine, item 22 — mode worker & files d'attente) — prouvé
 * par l'écran, même discipline que 17/21/22/23 : l'ACTION passe par un vrai clic sur "Send", les
 * ASSERTIONS qui comptent relisent l'enregistrement via l'API (jamais l'écran comme preuve de ce qui
 * est en base) et le message réel dans Mailpit.
 *
 * Ce que CE fichier prouve, que 21/22/23 ne prouvaient pas encore : le statut affiché à l'écran
 * atteint "Sent" par le POLLING du front (hooks/queries/use-document-types.ts's `useDocumentInstances`,
 * `refetchInterval` tant qu'un document reste "sending") — jamais par la réponse synchrone du clic
 * lui-même, qui ne renvoie plus que "sending". La pile e2e tourne réellement le worker inline
 * (WORKER_INLINE par défaut — voir app.module.ts) : ce test traverse donc une vraie file BullMQ/Redis,
 * pas un mock. 21 (cycle de vie), 22 (numérotation) et 23 (email) continuent de passer avec le
 * libellé de statut intermédiaire "Sending" qu'elles ne connaissaient pas encore.
 *
 * Le second test couvre un angle que le premier ne touche pas : le dialogue d'édition
 * ([typeId].tsx's `dialogInstance`) doit suivre le LIVE `lastActionError`, jamais rester figé sur
 * l'instantané pris à l'ouverture. Un document "send_failed" réel (facture dont le client n'a pas
 * d'email — transports/email-transport.ts) est ouvert dans le dialogue APRÈS coup, une fois l'erreur
 * déjà en base ; la cause est corrigée puis "Send" est recliqué DANS ce même dialogue, et l'erreur
 * doit disparaître de l'écran pendant qu'il reste ouvert, pas seulement après une fermeture/réouverture.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("L'envoi asynchrone d'un document traverse la file — jusqu'à \"Sent\", avec le PDF dans Mailpit", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('un vrai clic sur "Send" fait passer un devis par sending -> sent (poll UI), avec un courriel réel et son PDF dans Mailpit', () => {
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
							issueDate: "2026-08-31",
							currency: "EUR",
							lines: [{ description: "Consulting", quantity: 3, unitPrice: 200 }],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
					const quoteId = saved.body?.document?.id;
					expect(quoteId, "le brouillon a un identifiant").to.be.a("string");

					const recipient = `async-send-${Date.now()}@example.com`;

					cy.visit("/documents/quote");
					cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Draft");

					// Un vrai clic — jamais un appel direct à l'action, qui contournerait l'écran.
					cy.get(`[data-cy="document-row-action-send-${quoteId}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="document-field-recipient-input"]').clear().type(recipient);
					cy.get('[data-cy="document-action-params-confirm"]').click();

					// Le statut affiché atteint "Sent" — par le POLLING du front (voir l'en-tête de ce
					// fichier), pas par la réponse synchrone du clic. Délai généreux : ce test attend
					// réellement un aller-retour de file (BullMQ/Redis), pas une réponse HTTP directe.
					cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 20000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// ...et c'est bien ce qui est enregistré — l'assertion qui compte lit l'API, jamais
					// une relecture du DOM comme preuve de la base.
					cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
						.its("body")
						.then((doc) => {
							expect(doc.status, "le devis est réellement \"sent\" en base").to.eq("sent");
							expect(
								doc.displayNumber,
								"un devis envoyé par la file porte un numéro, comme avant elle",
							).to.be.a("string");

							cy.getLastEmail().then((message: any) => {
								expect(
									message.To?.[0]?.Address,
									"le message va au destinataire tapé dans le formulaire",
								).to.eq(recipient);

								expect(
									message.Attachments,
									"exactement une pièce jointe — le PDF, jamais zéro ni un doublon",
								).to.have.length(1);

								const attachment = message.Attachments[0];
								expect(
									attachment.FileName,
									"la pièce jointe est nommée d'après le displayNumber du devis",
								).to.eq(`${doc.displayNumber}.pdf`);
								expect(attachment.ContentType, "et c'est bien un PDF").to.eq(
									"application/pdf",
								);
							});
						});
				});
			});
	});

	it(
		'un document "send_failed" garde son erreur figée à l\'écran une fois le dialogue OUVERT sur lui ' +
			'— un re-clic sur "Send" DANS ce dialogue qui aboutit doit la faire DISPARAÎTRE pendant qu\'il ' +
			"reste ouvert, jamais la garder sur l'instantané pris à l'ouverture",
		() => {
			// La FACTURE, pas le devis : son transport "email" (invoice-actions.ts) résout l'adresse
			// depuis le contactEmail du CLIENT lui-même (transports/email-transport.ts) — jamais un
			// champ tapé par l'utilisateur, contrairement au devis. Un client SANS email fait donc
			// échouer la livraison de façon DÉTERMINISTE, à chaque tentative, jusqu'à épuisement des
			// retries — exactement le chemin que
			// backend/.../queue/__tests__/document-action-queue.redis.spec.ts prouve déjà côté back
			// (son "no contact email on file").
			cy.request({
				method: "POST",
				url: `${api}/api/company/info`,
				body: { invoiceTransportId: "email" },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
			});

			cy.request({
				method: "POST",
				url: `${api}/api/clients`,
				body: {
					name: "No Email Co",
					// Pas de contactEmail — la cause qu'on force ici, puis qu'on corrige plus bas.
					currency: "EUR",
					country: "France",
					countryCode: "FR",
					address: "1 Silent Street",
					city: "Paris",
					postalCode: "75002",
					isActive: true,
					type: "COMPANY",
				},
				failOnStatusCode: false,
			}).then((created) => {
				expect(created.status, "client sans email créé").to.eq(201);
				const clientId = created.body.id as string;

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clientId,
							issueDate: "2026-08-31",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 80, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

					cy.visit("/documents/invoice");

					// Le PREMIER "send" est déclenché depuis la LIGNE de la liste, dialogue FERMÉ — la
					// raison même du test : `dialogTarget` (voir [typeId].tsx) doit être capturé APRÈS
					// coup, une fois le document déjà "send_failed", pour que son propre instantané porte
					// réellement l'erreur figée que le correctif doit savoir effacer. Un vrai clic — jamais
					// un appel direct à l'action, qui contournerait l'écran.
					//
					// TODO_PRODUIT.md T1 / PLAN-V2 R8 — l'horodatage capturé ici sert la preuve SSE plus
					// bas : AUCUN cy.reload() n'apparaît nulle part dans ce fichier (grep-le), et le
					// repli de polling de la liste vient d'être ralenti à 60 s
					// (frontend/src/hooks/queries/use-document-types.ts's own SENDING_POLL_INTERVAL_MS) —
					// délibérément, pour qu'une mise à jour visible bien avant cette fenêtre ne puisse
					// s'expliquer QUE par le flux SSE (documents.controller.ts's `events` route), jamais
					// par le prochain tick de polling qui, lui, ne peut pas arriver avant ~60 s après ce
					// clic (le `refetchInterval` est ré-évalué — et sa fenêtre de 60 s relancée — juste
					// après le clic, via l'invalidation que `useRunDocumentAction` déclenche déjà).
					let sendClickedAt = 0;
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 })
						.click()
						.then(() => {
							sendClickedAt = Date.now();
						});

					// Budget large, volontairement documenté : DOCUMENT_ACTION_QUEUE_ATTEMPTS=3 par
					// défaut (document-queue.dispatcher.ts) avec un backoff exponentiel de base 2000 ms
					// -> tentative 2 après ~2 s, tentative 3 (terminale) ~4 s plus tard, soit ~6 s de
					// file avant l'échec définitif, plus la marge d'une CI chargée. On ne peut pas
					// réduire ATTEMPTS ici : c'est une variable d'env du serveur déjà démarré, figée à
					// son propre boot — ce test absorbe le budget plutôt que de risquer un flake. Lu à
					// l'écran (le SSE primaire, le polling en repli lent — voir le commentaire ci-dessus),
					// pas via l'API : on veut que la CACHE de requête que le dialogue suivra plus bas soit
					// déjà à jour.
					// `timeout` sur le `.find()`, pas seulement sur le `cy.get()` qui le précède : une
					// assertion chaînée après un `.find()` retente selon le timeout de LA DERNIÈRE
					// commande de requête avant elle, pas celui du tout premier `cy.get()` de la chaîne
					// (piège connu de Cypress) — sans ça, ce `.should()` retombe sur les 4000 ms par
					// défaut, bien trop court pour un échec réel après 3 tentatives. Ce timeout Cypress
					// (40 s) reste le filet de sécurité contre une CI lente ; la preuve de VITESSE — que
					// c'est bien le SSE, jamais le repli à 60 s, qui a fait bouger le badge — est
					// l'assertion sur l'écart mesuré juste après, avec son propre budget bien plus serré.
					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
						.find('[data-cy="document-status-badge"]', { timeout: 40000 })
						.should("contain.text", "Send failed")
						.then(() => {
							const elapsedMs = Date.now() - sendClickedAt;
							// ~6-8 s sont déjà consommés par les tentatives BullMQ elles-mêmes (voir le
							// commentaire ci-dessus) — 10 s laisse une marge additionnelle pour le
							// publish Redis -> EventSource -> invalidation -> refetch -> rendu, tout en
							// restant à un ordre de grandeur SANS COMMUNE MESURE avec les 60 s qu'exigerait
							// le repli de polling seul : à cette vitesse, ce ne peut être que le SSE.
							expect(
								elapsedMs,
								"le badge \"Send failed\" est apparu par le SSE, pas par le repli de polling à 60 s",
							).to.be.lessThan(10000);
						});
					cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should(
						"contain.text",
						"no contact email on file",
					);

					// PLAN-V2 R8 (verbatim) : "le bouton Retry apparaît de lui-même". Ce dépôt n'a pas de
					// bouton étiqueté "Retry" à part — c'est la MÊME action "send" qui redevient
					// disponible depuis "send_failed" (invoice.descriptor.ts's SEND_TRANSITIONS), cachée
					// pendant "sending" (document-list.tsx's own isProcessing check) puis réaffichée SANS
					// rechargement dès que le statut live redevient "send_failed" — exactement le
					// mécanisme "Retry" que ce critère décrit. Preuve directe sur la LIGNE de la liste,
					// pas seulement dans le dialogue (que le reste de ce test ouvre après coup).
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`).should("be.visible");

					// L'assertion qui compte lit l'API, jamais l'écran comme preuve de ce qui est en
					// base — même discipline que le reste de ce fichier et de 24.
					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body")
						.then((doc) => {
							expect(doc.status, 'la facture est réellement "send_failed" en base').to.eq(
								"send_failed",
							);
							expect(doc.lastActionError, "l'erreur enregistrée nomme la cause réelle").to.match(
								/no contact email on file/i,
							);
						});

					// MAINTENANT on ouvre le dialogue d'édition — `dialogTarget` (voir [typeId].tsx) prend
					// SON instantané ICI, document déjà "send_failed" : c'est CE `lastActionError`-là (non
					// nul) que le correctif doit savoir abandonner une fois le live redevenu `null`, pas un
					// `null` capturé plus tôt qui ne prouverait rien.
					cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");
					cy.get('[data-cy="document-form-last-error"]').should(
						"contain.text",
						"no contact email on file",
					);

					// On corrige la CAUSE réelle, jamais l'écran ni un contournement de la file : le
					// client reçoit l'email qui lui manquait. `name` doit être renvoyé avec —
					// editClientsInfo (clients.service.ts) exige un nom non vide sur CHAQUE écriture,
					// même partielle.
					cy.request({
						method: "PATCH",
						url: `${api}/api/clients/${clientId}`,
						body: { name: "No Email Co", contactEmail: `fixed-${Date.now()}@example.com` },
						failOnStatusCode: false,
					}).then((patched) => {
						expect(patched.status, "email ajouté au client").to.eq(200);
					});

					// Re-clic sur "Send" DANS LE DIALOGUE OUVERT SUR UN "send_failed" — le scénario exact du
					// bug : le dialogue reste ce même dialogue du début à la fin, jamais fermé ni rouvert.
					// "send" reste disponible depuis "send_failed" (invoice.descriptor.ts's
					// SEND_TRANSITIONS), et cette facture n'a AUCUN param "send" (le transport lit le
					// client, pas un champ tapé — voir invoice-actions.ts) : pas de dialogue de paramètres
					// à traverser ici.
					cy.get('[data-cy="document-action-send"]', { timeout: 15000 }).click();

					// La preuve que la livraison a RÉELLEMENT abouti cette fois, comme dans
					// 24-document-payments.cy.ts : "record-payment" n'est offerte que sur une facture
					// "sent" (availableWhen: ['sent']) — sa seule apparition suffit, sans dépendre d'un
					// texte de statut affiché nulle part dans CE dialogue.
					cy.get('[data-cy="document-action-record-payment"]', { timeout: 30000 }).should("exist");

					// Le cœur du bug corrigé : l'erreur périmée ne doit PLUS être là, alors que le
					// dialogue est toujours le MÊME, jamais fermé entre-temps. Avant le correctif,
					// `liveDialogTarget?.lastActionError ?? dialogTarget.lastActionError` retombait sur
					// l'instantané figé (l'erreur bien réelle capturée à l'ouverture, ci-dessus) dès que le
					// live valait `null` (l'écriture de "sending" au re-clic l'efface déjà, voir
					// persistence.ts), laissant ce message affiché indéfiniment à côté d'un document
					// réellement "sent".
					cy.get('[data-cy="document-edit-dialog"]').should("be.visible");
					cy.get('[data-cy="document-form-last-error"]').should("not.exist");

					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body")
						.then((doc) => {
							expect(doc.status, 'la facture est réellement "sent" en base').to.eq("sent");
							expect(doc.lastActionError, "l'erreur a bien été effacée en base aussi").to.be.null;
						});
				});
			});
		},
	);
});
