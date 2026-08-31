/**
 * Le cycle de vie déclaré (statuts + transitions, backend/src/modules/documents/descriptors/
 * lifecycle.ts) prouvé par l'écran, pas seulement en mémoire — même discipline que
 * 17-document-descriptor.cy.ts : les ACTIONS passent par l'interface, les ASSERTIONS lisent
 * l'enregistrement (l'API, jamais une relecture de l'écran comme preuve de ce qui est en base).
 *
 * Trois choses, dans l'ordre (l'état traverse les `it` de ce fichier — `resetAndSeed` ne rejoue
 * qu'une fois, dans `before`, exactement comme 17 le fait) :
 *  1. l'indication de transition ("Draft → Sending" — item 22 a rendu "send" asynchrone : la
 *     PREMIÈRE transition déclarée mène à "sending", pas directement à "sent", voir
 *     quote.descriptor.ts's own SEND_TRANSITIONS) apparaît sur une action qui en déclare une, et
 *     PAS sur une action qui n'en déclare aucune (même si cette dernière reste offerte) ;
 *  2. exécuter "send" par un vrai clic fait passer le statut affiché ET enregistré à "sent",
 *     l'écran l'affichant par SON PROPRE polling (useDocumentInstances) une fois le worker passé —
 *     voir 28-document-async-send.cy.ts pour la preuve dédiée de cette traversée de file ;
 *  3. la restriction par statut de la politique pays (fr.json : invoice.save-draft -> ["draft"])
 *     retire le bouton à l'écran une fois la facture partie ("sending" suffit déjà, "draft" étant le
 *     seul statut autorisé), et l'API refuse aussi (409) pour un client scripté qui ignorerait
 *     l'écran.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Le cycle de vie d'un document — statuts et transitions déclarés", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	let quoteId: string;

	it("le libellé de transition apparaît sur une action qui en déclare une, pas sur une action qui n'en déclare aucune", () => {
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
							lines: [{ description: "Conseil", quantity: 1, unitPrice: 500 }],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
					quoteId = saved.body?.document?.id;
					expect(quoteId, "le brouillon a un identifiant").to.be.a("string");

					cy.visit("/documents/quote");
					cy.get(`[data-cy="document-edit-button-${quoteId}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

					// "send" déclare (item 22, l'envoi asynchrone) une PREMIÈRE transition draft ->
					// sending (quote.descriptor.ts) : le devis est actuellement "draft", donc le libellé
					// attendu est "Draft → Sending" — déduit du descripteur reçu par l'écran, jamais
					// écrit en dur dans ce test. Ce n'est plus "Sent" : ce serait le libellé de la
					// SECONDE transition (sending -> sent | send_failed), qui ne s'applique qu'une fois
					// le devis déjà "sending" — hors de portée de ce clic-ci.
					cy.get('[data-cy="document-transition-hint-send"]', { timeout: 10000 })
						.scrollIntoView()
						.invoke("text")
						.should("match", /Draft/i)
						.and("match", /Sending/i);

					// "convert-to-invoice" est offerte (draft ET sent y donnent droit) mais ne déclare
					// AUCUNE transition (elle ne change jamais le statut du DEVIS lui-même — voir
					// convert-to-invoice.ts) : pas de libellé du tout, même si le bouton, lui, est là.
					cy.get('[data-cy="document-action-convert-to-invoice"]').should("exist");
					cy.get('[data-cy="document-transition-hint-convert-to-invoice"]').should("not.exist");

					// "save-draft" déclare une transition depuis N'IMPORTE QUEL statut vers "draft"
					// (registerSaveDraftAction écrit toujours "draft") — ici le devis est déjà "draft",
					// donc le libellé est "Draft → Draft" : une transition déclarée qui ne change rien,
					// exactement le cas que la tâche demande de couvrir.
					cy.get('[data-cy="document-transition-hint-save-draft"]', { timeout: 10000 })
						.invoke("text")
						.should("match", /Draft.*Draft/i);
				});
			});
	});

	it('exécuter "send" par un vrai clic fait passer le statut affiché ET enregistré à "sent"', () => {
		expect(quoteId, "le devis du test précédent existe toujours").to.be.a("string");

		cy.visit("/documents/quote");
		cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Draft");

		// Directement depuis la ligne de la liste (document-list.tsx expose les mêmes actions que le
		// formulaire, sans ouvrir la modale) — un vrai clic, pas une requête directe : c'est l'écran
		// qui agit ici, l'API ne sert qu'à RELIRE ensuite ce qui a été enregistré.
		cy.get(`[data-cy="document-row-action-send-${quoteId}"]`).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-recipient-input"]').clear().type("client@example.com");
		cy.get('[data-cy="document-action-params-confirm"]').click();

		// Le statut affiché change...
		cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Sent");

		// ...et c'est bien ce qui est enregistré, pas seulement ce que l'écran prétend : l'assertion
		// qui compte lit l'API, jamais une relecture du DOM comme preuve de la base.
		cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
			.its("body.status")
			.should("eq", "sent");
	});

	describe("la politique pays par statut (fr.json : invoice.save-draft restreint à \"draft\")", () => {
		let invoiceId: string;

		it('une facture "sent" ne montre plus "Save draft" à l\'écran, et l\'API le refuse aussi (409)', () => {
			cy.request({
				method: "POST",
				url: `${api}/api/company/info`,
				// "send" sur une facture a besoin d'un transport configuré (voir invoice-actions.ts) —
				// même mise en place que 17-document-descriptor.cy.ts pour amener une facture à "sent".
				body: { invoiceTransportId: "email" },
				failOnStatusCode: false,
			}).then((companyRes) => {
				expect(companyRes.status, "transport configuré").to.be.oneOf([200, 201]);

				cy.request({ url: `${api}/api/documents/references/client/search` })
					.its("body")
					.then((clients: { id: string }[]) => {
						const invoiceData = {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
						};

						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/save-draft`,
							body: { data: invoiceData },
							failOnStatusCode: false,
						}).then((saved) => {
							expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
							invoiceId = saved.body?.document?.id;

							cy.visit("/documents/invoice");
							// AVANT l'envoi : la facture est "draft", l'action doit être offerte — la preuve
							// que sa disparition plus bas vient bien du changement de statut, pas d'un bouton
							// qui n'a jamais existé.
							cy.get(`[data-cy="document-row-action-save-draft-${invoiceId}"]`, {
								timeout: 15000,
							}).should("exist");

							cy.request({
								method: "POST",
								url: `${api}/api/documents/types/invoice/actions/send`,
								body: { documentId: invoiceId, data: invoiceData },
								failOnStatusCode: false,
							}).then((sent) => {
								expect(sent.status, "facture envoyée").to.be.oneOf([200, 201]);
								// "send" est asynchrone (item 22) : cet appel direct ne fait plus que la
								// PREMIÈRE moitié — draft -> sending — et rend la main aussitôt ; la
								// livraison réelle est l'affaire du worker (28-document-async-send.cy.ts en
								// fait la preuve dédiée). La restriction par statut testée ici ("draft"
								// uniquement) exclut aussi bien "sending" que "sent" — elle tient donc déjà,
								// sans attendre que le worker ait fini.
								expect(sent.body?.document?.status, 'la facture est partie ("sending")').to.eq(
									"sending",
								);

								cy.visit("/documents/invoice");
								// À L'ÉCRAN : le bouton "Save draft" n'est plus offert sur cette ligne — la vue
								// par compagnie (describeTypeForCompany) a restreint availableWhen à ["draft"]
								// pour la France, et cette facture n'y est plus.
								cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 }).should(
									"exist",
								);
								cy.get(`[data-cy="document-row-action-save-draft-${invoiceId}"]`).should(
									"not.exist",
								);

								// À L'API : un client scripté qui ignorerait l'écran et appellerait l'action à
								// la main se voit refusé exactement pareil — 409, jamais un contournement.
								cy.request({
									method: "POST",
									url: `${api}/api/documents/types/invoice/actions/save-draft`,
									body: { documentId: invoiceId, data: invoiceData },
									failOnStatusCode: false,
								}).then((res) => {
									expect(res.status, `refusée — ${JSON.stringify(res.body).slice(0, 200)}`).to.eq(
										409,
									);
									expect(
										String(res.body?.message ?? ""),
										"le message nomme la restriction par statut, jamais un refus muet",
									).to.match(/restricted by this company's country policy to status\(es\) draft/i);
								});
							});
						});
					});
			});
		});
	});
});
