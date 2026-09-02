/**
 * TODO_PRODUIT.md T2 / PLAN-V2 R9, mis à jour par T2bis pour le vocabulaire générique `DOCUMENT_*` —
 * le webhook `DOCUMENT_SENT` part quand la transmission ABOUTIT, jamais avant, jamais sur un échec.
 * L'idempotence à travers un retry BullMQ et le comportement sur échec/enqueue sont déjà prouvés par
 * jest, contre un VRAI serveur HTTP local (`async-send.spec.ts`, `async-send-webhook.spec.ts`,
 * `documents.service.invoice.spec.ts`) — ce fichier prouve la SEULE chose que jest ne peut pas : que
 * l'écran de configuration (`Settings > Webhooks`, jusqu'ici sans aucune spec e2e ni le moindre
 * `data-cy`) mène réellement, de bout en bout, à une émission — un vrai clic configure le webhook,
 * une vraie facture part par un vrai clic "Send" (transport email, résolu depuis le `contactEmail` du
 * client — `invoice-actions.ts` — jamais un champ tapé), à travers une vraie file BullMQ/Redis (le
 * "pipe" que 28-document-async-send.cy.ts a déjà établi), et l'assertion qui compte lit un récepteur
 * HTTP RÉEL (`cypress.config.ts`'s `startWebhookReceiver`, `node:http`, jamais un `cy.intercept` —
 * celui-ci ne verrait qu'un appel fait par le NAVIGATEUR, alors que ce POST part du BACKEND, serveur à
 * serveur). L'écran offre `DOCUMENT_SENT` (et non plus `INVOICE_SENT`, purgé de l'enum par la
 * migration T2bis) parce que `GET /api/webhooks/options` reflète `Object.values(WebhookEvent)`
 * directement — aucun changement d'écran n'était nécessaire pour ça, seulement de cette spec.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Le webhook DOCUMENT_SENT part quand une facture est réellement envoyée", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('un webhook configuré PAR L\'ÉCRAN reçoit "DOCUMENT_SENT" exactement une fois, une fois la facture réellement "Sent"', () => {
		cy.task("clearWebhookRequests");

		cy.task("startWebhookReceiver").then((rawUrl) => {
			const webhookUrl = rawUrl as string;

			// 1) La configuration du webhook — PAR L'ÉCRAN, jamais par l'API : c'est la partie que ce
			// fichier existe pour tester, et jusqu'ici aucune spec ne la couvrait.
			cy.visit("/settings/webhooks");
			cy.get('[data-cy="webhook-url-input"]', { timeout: 10000 }).should("be.visible").clear().type(webhookUrl);

			cy.get('[data-cy="webhook-events-select"]').click();
			cy.get('[data-slot="command-input"]').type("DOCUMENT_SENT");
			cy.get('[role="option"]').contains("DOCUMENT_SENT").click();
			// Ferme le popover (non modal — il ne bloque pas le clic sur "Créer", mais fermer d'abord
			// est ce qu'un vrai utilisateur ferait avant de soumettre).
			cy.get("body").type("{esc}");

			cy.get('[data-cy="webhook-create-submit"]').click();

			// La preuve que la CRÉATION a abouti — pas seulement que le formulaire s'est vidé.
			cy.get('[data-cy^="webhook-row-"]', { timeout: 10000 }).should("have.length", 1);

			// 2) Le nécessaire pour qu'une facture puisse réellement partir par courriel — établi par
			// API, comme 23/28 le font déjà pour ce même transport : ce n'est pas la partie sous test.
			cy.request({
				method: "POST",
				url: `${api}/api/company/info`,
				body: { invoiceTransportId: "email" },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "transport email configuré").to.be.oneOf([200, 201]);
			});

			cy.request({
				method: "POST",
				url: `${api}/api/clients`,
				body: {
					name: "Webhook Test Co",
					contactEmail: "webhook-test-client@example.com",
					currency: "EUR",
					country: "France",
					countryCode: "FR",
					address: "1 Webhook Street",
					city: "Paris",
					postalCode: "75003",
					isActive: true,
					type: "COMPANY",
				},
				failOnStatusCode: false,
			}).then((created) => {
				expect(created.status, "client (avec email) créé").to.eq(201);
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
								{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

					// 3) Le vrai déclencheur : un clic réel sur "Send" — jamais un appel direct à
					// l'action, qui contournerait l'écran (même discipline que 21/22/23/28).
					cy.visit("/documents/invoice");
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

					// Le statut affiché atteint "Sent" — la transmission a réellement ABOUTI, à travers
					// la même file BullMQ/Redis que 28-document-async-send.cy.ts traverse déjà.
					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// 4) LA preuve : le récepteur RÉEL a reçu EXACTEMENT un webhook, portant l'événement
					// DOCUMENT_SENT (générique — TODO_PRODUIT.md T2bis, `typeId` en donnée de filtrage,
					// jamais une clé calculée par type) et la facture réellement envoyée — jamais zéro
					// (rien n'est parti), jamais deux (une double émission), jamais un événement
					// générique qui ne dirait rien de ce qui vient de se passer.
					cy.task("getWebhookRequests").then((requests) => {
						const list = requests as Array<Record<string, unknown>>;
						expect(list, "exactement un webhook reçu par le récepteur réel").to.have.length(1);
						expect(list[0].event, "l'événement est bien DOCUMENT_SENT").to.eq("DOCUMENT_SENT");
						expect(list[0].typeId, "typeId porte le type du document envoyé").to.eq("invoice");
						const documentPayload = list[0].document as { id?: string } | undefined;
						expect(
							documentPayload?.id,
							"le payload porte, sous la clé FIXE 'document', la facture réellement envoyée",
						).to.eq(invoiceId);
					});
				});
			});
		});
	});
});
