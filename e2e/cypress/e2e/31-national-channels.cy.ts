/**
 * Les transports NATIONAUX (root TODO item 10, vague 1) — le socle credentials + le canal PDP, prouvé
 * par l'écran : on connecte le canal PDP avec des identifiants FICTIFS pointant un serveur qui
 * n'existe pas (port fermé en local), on choisit `pdp` comme transport de facturation, et on observe
 * l'échec réel de la file (BullMQ retry puis "send_failed", l'erreur nommant le canal). Le VRAI
 * dépôt PDP (superpdp sandbox) est prouvé ailleurs, en réel, par
 * `backend/src/modules/documents/transports/pdp/pdp-live.spec.ts` (jest, `PDP_LIVE=1`) — jamais par
 * cette spec, qui ne parle à aucun serveur réel.
 *
 * L'ACTION passe par un vrai clic sur l'écran (connecter, choisir le transport, envoyer,
 * déconnecter) ; les ASSERTIONS qui comptent relisent l'enregistrement via l'API — même discipline
 * que 28 (l'envoi asynchrone) et le reste de cette suite.
 *
 * `cy.resetAndSeed()` seed déjà une société FRANÇAISE (SIRET/VAT sur `Acme Corp`, voir
 * support/commands.ts) — exactement ce dont le pont Factur-X (facturx-provider.ts, gate Schematron
 * EN 16931) a besoin pour construire un artefact VALIDE ; le dépôt échoue donc ici uniquement à
 * cause du port fermé, jamais d'une facture invalide qui masquerait la vraie cause testée.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

/** Port 1 (tcpmux) : jamais ouvert sur une machine de dev/CI normale — ECONNREFUSED immédiat, sans
 *  attendre un timeout réseau. Aucune vraie plateforme n'écoute derrière ces identifiants. */
const FAKE_PDP = {
	baseUrl: "http://127.0.0.1:1",
	clientId: "e2e-fake-client-id",
	clientSecret: "e2e-fake-client-secret",
};

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
								{ description: "Conseil", quantity: 2, unit: "hour", unitPrice: 150, vatRate: "20" },
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

describe("Transports nationaux — le canal PDP, connecté/déconnecté par l'écran", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("connecte le canal PDP par l'écran avec des identifiants fictifs — statut \"Connected\"", () => {
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-pdp"]', { timeout: 15000 }).should("exist");
		// La France (société seedée) suggère PDP — la donnée vient du fichier pays
		// (transports/channel-suggestion/data/fr.json), jamais d'un `if` sur le pays ici.
		cy.get('[data-cy="channel-pdp-suggested"]').should("exist");
		cy.get('[data-cy="channel-pdp-status"]').should("contain.text", "Not connected");

		cy.get('[data-cy="channel-pdp-baseurl-input"]').clear().type(FAKE_PDP.baseUrl);
		cy.get('[data-cy="channel-pdp-clientid-input"]').clear().type(FAKE_PDP.clientId);
		cy.get('[data-cy="channel-pdp-clientsecret-input"]').clear().type(FAKE_PDP.clientSecret);
		// Environnement laissé sur "Test (sandbox)", la valeur par défaut du formulaire.
		cy.get('[data-cy="channel-pdp-connect-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel connected");
		cy.get('[data-cy="channel-pdp-status"]', { timeout: 10000 }).should("contain.text", "Connected");

		// Et c'est bien ce qui est enregistré — jamais un secret en clair dans la réponse : le GET ne
		// renvoie que le statut (channels.service.ts's own ChannelConfigStatus).
		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then((body: { configured: { providerId: string; isActive: boolean; environment: string }[] }) => {
				const pdp = body.configured.find((c) => c.providerId === "pdp");
				expect(pdp, "le canal pdp est bien en base, actif").to.include({
					isActive: true,
					environment: "TEST",
				});
			});
	});

	it("choisit pdp comme transport de facturation, sur l'écran des réglages société", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', { timeout: 15000 }).click();
		cy.get('[data-cy="company-invoice-transport-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-pdp"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);

		cy.request({ url: `${api}/api/company/info` })
			.its("body")
			.then((company: { invoiceTransportId: string }) => {
				expect(company.invoiceTransportId, "le transport choisi est bien enregistré").to.eq("pdp");
			});
	});

	it('envoie une facture via PDP → la file échoue réellement (serveur fictif) et "send_failed" nomme le canal', () => {
		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			// Un vrai clic — la facture n'a aucun param "send" (le transport lit le client, pas un
			// champ tapé — voir invoice-actions.ts), donc pas de dialogue de paramètres à traverser.
			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			// Budget large et documenté, même raisonnement que 28-document-async-send.cy.ts :
			// DOCUMENT_ACTION_QUEUE_ATTEMPTS=3 par défaut, backoff exponentiel base 2000ms — jusqu'à
			// ~6s de file avant l'échec définitif, plus la marge d'une CI chargée. `timeout` sur le
			// `.find()` lui-même, pas seulement le `cy.get()` qui précède (piège Cypress documenté
			// dans ce même fichier 28).
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
				.find('[data-cy="document-status-badge"]', { timeout: 40000 })
				.should("contain.text", "Send failed");

			// L'erreur VISIBLE nomme le canal — jamais un message générique.
			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should("contain.text", "PDP");

			// L'assertion qui compte lit l'API, jamais l'écran comme preuve de ce qui est en base.
			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, 'la facture est réellement "send_failed" en base').to.eq("send_failed");
					expect(doc.lastActionError, "l'erreur enregistrée nomme le canal PDP").to.match(/PDP/);
					// Jamais un succès à référence vide : puisque le serveur fictif n'a jamais répondu,
					// aucun identifiant de dépôt n'a pu être enregistré — voir la mutation #1 du sujet.
					expect(doc.transportRef, "aucune référence de dépôt sans dépôt réel").to.not.be.a("string");
				});
		});
	});

	it("déconnecte le canal par l'écran → un nouvel envoi bloque au PREFLIGHT, en le disant", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-pdp-status"]', { timeout: 15000 }).should("contain.text", "Connected");
		cy.get('[data-cy="channel-pdp-disconnect-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel disconnected");
		cy.get('[data-cy="channel-pdp-status"]', { timeout: 10000 }).should("contain.text", "Not connected");

		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then((body: { configured: { providerId: string }[] }) => {
				expect(
					body.configured.find((c) => c.providerId === "pdp"),
					"plus aucune ligne pdp en base — un disconnect complet, pas juste isActive:false",
				).to.be.undefined;
			});

		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			// Le PREFLIGHT bloque AVANT toute persistance — même le passage à "sending" n'a jamais
			// lieu (voir async-send.ts / pdp-transport.ts's own header) : un toast visible le dit tout
			// de suite, pas d'attente de file.
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should(
				"contain.text",
				"PDP channel is not connected",
			);

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, "jamais persisté au-delà de \"draft\" — bloqué avant toute écriture").to.eq(
						"draft",
					);
				});
		});
	});
});
