/**
 * Root TODO — "déclaration" : un mécanisme NEUF, jamais un canal de transport déguisé. La Hongrie
 * (NAV Online Számla) et la Grèce (AADE myDATA) n'exigent pas de LIVRER la facture par une
 * plateforme donnée — elles exigent de DÉCLARER les données de la facture à l'autorité fiscale
 * APRÈS émission, quel que soit le canal réellement utilisé pour l'envoyer. Cette spec en fait la
 * preuve VISUELLE, à l'écran : une société hongroise connecte "nav" (déclaratif), envoie une
 * facture par E-MAIL (un canal de LIVRAISON ordinaire, sans rapport), et observe DEUX faits
 * simultanés et indépendants — la facture PART (statut "Sent") ET sa DÉCLARATION à NAV échoue,
 * nommément, dans la timeline de conformité existante — jamais l'un au prix de l'autre.
 *
 * Même discipline que 28/31/39 : l'ACTION passe par un vrai clic à l'écran (pays, connexion du
 * canal, transport, "Send") ; les ASSERTIONS qui comptent relisent l'API, jamais l'écran seul
 * comme preuve de ce qui est en base.
 *
 * `country-policy/data/hu.json` (ajouté par cette même tâche, DÉLIBÉRÉMENT PARTIEL — voir son
 * propre `notes`) est le prérequis qui rend ce scénario même ATTEIGNABLE : sans lui, la DÉCISION 1
 * de `country-policy.ts` bloque TOUTE action document pour une société hongroise (y compris
 * save-draft), avant même d'atteindre le déclencheur de déclaration. Contrairement à 31
 * (PL/IT/BE/RO, qui n'ont pas non plus de fichier et basculent donc le pays UNIQUEMENT pour lire
 * la suggestion de canal, jamais pour émettre), cette spec a besoin que la société reste
 * RÉELLEMENT hongroise au moment de l'envoi — c'est justement le pays du VENDEUR qui déclenche
 * l'obligation déclarative (`reporting/report-on-send.ts`), pas une suggestion de canal.
 *
 * `nav` est connecté avec des identifiants FICTIFS dont le `baseUrl` pointe le port fermé
 * 127.0.0.1:1 (même fixture que `FAKE_PDP` dans 31-national-channels.cy.ts) — un échec réseau
 * immédiat (ECONNREFUSED), jamais un blocage réseau qui ferait traîner le test. Les credentials
 * eux-mêmes sont COMPLETS (aucun champ vide) : `report:blocked` (credentials absents) ne peut donc
 * PAS se produire ici — c'est `report:failed` (après épuisement des tentatives BullMQ) qui est
 * attendu, et c'est ce que cette spec affirme, nommément, jamais un "report:blocked" par erreur.
 *
 * Régression couverte par la même passe : 28 (l'envoi asynchrone continue de fonctionner) et 39 (un
 * envoi par e-mail sans aucune obligation déclarative — société FRANÇAISE — ne montre toujours
 * RIEN, la preuve que le mécanisme ne se déclenche JAMAIS pour un pays sans fichier
 * `reporting/data/*.json`).
 *
 * LIMITE STRUCTURELLE RÉELLE, TROUVÉE EN ÉCRIVANT CETTE SPEC (consignée, jamais contournée en
 * silence — même discipline que 40-b2g-routing.cy.ts's own header) : `useDocumentAuthorityEvents`
 * (frontend/src/hooks/queries/use-document-types.ts) ne re-sonde l'API que si au moins UN
 * événement existe déjà pour ce document — délibéré, pour ne jamais interroger en boucle chaque
 * ligne d'une longue liste de factures envoyées par e-mail (l'immense majorité, zéro événement,
 * pour toujours). Une ligne déjà montée AVANT l'envoi voit donc zéro événement à son tout premier
 * chargement et ne redemande plus jamais tant qu'aucun n'apparaît — la file BullMQ (3 tentatives,
 * ~6-8s de backoff) met plus longtemps que ça à produire le PREMIER événement "nav". Cette spec
 * observe donc la preuve API (PREUVE 2, en direct, sans rechargement) puis recharge l'écran avant
 * d'observer les preuves 3/4 — exactement ce qu'un utilisateur réel referait en rouvrant plus tard
 * une facture déjà envoyée. Un vrai correctif (une invalidation ciblée depuis le déclencheur
 * backend, ou un sondage borné dans le temps côté hook) reste à faire — non traité par cette tâche.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

/** Port 1 (tcpmux) : jamais ouvert sur une machine de dev/CI normale — ECONNREFUSED immédiat, sans
 *  attendre un timeout réseau, même fixture que `FAKE_PDP` dans 31-national-channels.cy.ts. Chaque
 *  champ est rempli (jamais vide) : le déclencheur ne doit JAMAIS confondre "identifiants
 *  incomplets" (report:blocked) avec "l'appel réseau lui-même a échoué" (report:failed) — voir ce
 *  fichier's own header. */
const FAKE_NAV = {
	taxNumber: "12345678",
	login: "e2e-fake-technical-user",
	password: "e2e-fake-password",
	signingKey: "e2e-fake-signing-key",
	exchangeKey: "e2e-fake-exchange-key-16",
	baseUrl: "http://127.0.0.1:1",
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
							issueDate: "2026-09-02",
							dueDate: "2026-10-02",
							currency: "EUR",
							lines: [
								{ description: "Conseil", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "27" },
							],
						},
					},
					failOnStatusCode: false,
				})
				.then((saved) => {
					expect(saved.status, "brouillon de facture créé (société hongroise)").to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id as string;
					expect(id, "le brouillon a un identifiant").to.be.a("string");
					return id;
				});
		});
}

/** Poll l'API des événements de conformité jusqu'à trouver l'événement "report:failed" du
 *  déclencheur déclaratif — même motif récursif que `cy.waitForDocumentStatus` (support/commands.ts) :
 *  un `cy.request().its().should()` ne redéclenche pas la requête à chaque tentative, il faut une
 *  vraie boucle. Budget large (60 * 500ms = 30s) : le job traverse une VRAIE file BullMQ avec un
 *  vrai backoff exponentiel (3 tentatives, ~2s puis ~4s d'attente) avant de journaliser l'échec
 *  terminal — voir `reporting-runner.ts`'s own header. */
function waitForReportEvent(invoiceId: string, attemptsLeft = 60): Cypress.Chainable<any[]> {
	return cy
		.request({ url: `${api}/api/documents/${invoiceId}/authority-events?typeId=invoice` })
		.then((res) => {
			const events = (res.body ?? []) as { providerId: string; statusCode: string }[];
			const navEvent = events.find((e) => e.providerId === "nav");
			if (!navEvent && attemptsLeft > 0) {
				cy.wait(500);
				return waitForReportEvent(invoiceId, attemptsLeft - 1);
			}
			expect(navEvent, "un événement d'autorité 'nav' a fini par être journalisé").to.exist;
			return cy.wrap(events);
		});
}

describe("La déclaration (NAV/HU) — déclarer ≠ livrer, à l'écran", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("société HU + nav connecté (fictif) + envoi par e-mail : la facture PART et sa déclaration ÉCHOUE, nommément", () => {
		// 1) La société bascule vers la Hongrie — À L'ÉCRAN, réglages société. `country-policy/data/hu.json`
		// (ajouté par cette même tâche) est ce qui rend cette société encore capable de save-draft/send
		// une fois hongroise — voir ce fichier's own header.
		cy.visit("/settings/company");
		cy.selectCountry("company-country-input", "Hungary");
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);
		cy.request({ url: `${api}/api/company/info` })
			.its("body")
			.then((company: { countryCode: string }) => {
				expect(company.countryCode, "la société est bien hongroise").to.eq("HU");
			});

		// 2) Connecter "nav" — À L'ÉCRAN, réglages canaux. Le badge "Déclaration" (jamais "connecté à
		// un canal d'envoi") est la distinction visuelle que cette tâche introduit.
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-nav"]', { timeout: 15000 }).should("exist").scrollIntoView();
		cy.get('[data-cy="channel-nav-declarative"]').should(
			"contain.text",
			"Declaration (not a delivery channel)",
		);
		cy.get('[data-cy="channel-nav-taxnumber-input"]').clear().type(FAKE_NAV.taxNumber);
		cy.get('[data-cy="channel-nav-login-input"]').clear().type(FAKE_NAV.login);
		cy.get('[data-cy="channel-nav-password-input"]').clear().type(FAKE_NAV.password);
		cy.get('[data-cy="channel-nav-signingkey-input"]').clear().type(FAKE_NAV.signingKey);
		cy.get('[data-cy="channel-nav-exchangekey-input"]').clear().type(FAKE_NAV.exchangeKey);
		cy.get('[data-cy="channel-nav-baseurl-input"]').clear().type(FAKE_NAV.baseUrl);
		cy.get('[data-cy="channel-nav-connect-button"]').click();
		cy.get('[data-cy="channel-nav-status"]', { timeout: 15000 }).should("contain.text", "Connected");

		// 3) Le transport d'ENVOI reste "email" — un canal de LIVRAISON ordinaire, sans aucun rapport
		// avec la déclaration NAV. C'est le cœur de la démonstration : déclarer et livrer sont deux
		// mécanismes distincts, jamais couplés.
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', { timeout: 15000 }).click();
		cy.get('[data-cy="company-invoice-transport-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-email"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);
		cy.request({ url: `${api}/api/company/info` })
			.its("body")
			.then((company: { invoiceTransportId: string }) => {
				expect(company.invoiceTransportId, "le transport de facturation est email").to.eq("email");
			});

		cy.clearEmails();

		// 4) La facture — brouillon créé par l'API (même discipline que 39), mais L'ENVOI lui-même passe
		// par un vrai clic sur "Send", jamais un appel direct à l'action.
		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			// PREUVE 1 — la facture PART réellement : "Sent" à l'écran, puis relu via l'API.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, "la facture est réellement \"sent\" en base").to.eq("sent");
				});

			cy.getLastEmail().then((message: any) => {
				expect(message.To?.[0]?.Address, "le message part bien par e-mail, au client du seed").to.eq(
					"test.client@example.com",
				);
			});

			// PREUVE 2 — la déclaration à NAV échoue, nommément, SANS jamais avoir touché le statut
			// ci-dessus (déjà vérifié "sent" AVANT cette assertion — l'ordre de ce test EST la preuve
			// que l'échec déclaratif n'a jamais pu rétroactivement changer ce fait).
			waitForReportEvent(invoiceId).then((events) => {
				const navEvent = events.find((e: any) => e.providerId === "nav")!;
				expect(navEvent.statusCode, "le job a épuisé ses tentatives — report:failed, jamais report:blocked (identifiants complets)").to.eq(
					"report:failed",
				);
				expect(navEvent.reason, "la raison de l'échec est journalisée, jamais silencieuse").to.be.a(
					"string",
				).and.not.be.empty;
			});

			// LIMITE STRUCTURELLE RÉELLE, TROUVÉE EN ÉCRIVANT CETTE SPEC (même discipline que
			// 40-b2g-routing.cy.ts's own header — consignée, jamais contournée en silence) :
			// `useDocumentAuthorityEvents` (use-document-types.ts) ne re-sonde l'API QUE si AU MOINS
			// un événement existe déjà — une ligne de liste déjà montée AVANT l'envoi (donc avec zéro
			// événement à son tout premier chargement) ne redemande donc JAMAIS tant qu'aucun
			// événement n'est apparu, et la file BullMQ (3 tentatives, ~6-8s de backoff) met plus de
			// temps que ça à produire le premier. Un utilisateur RÉEL, lui, rouvrirait ou
			// rafraîchirait l'écran plus tard pour consulter une facture déjà envoyée — ce que cette
			// ligne reproduit honnêtement, plutôt que de proclamer un "temps réel" que ce hook
			// n'offre pas encore pour le tout premier événement d'un document. `PREUVE 2` ci-dessus
			// est la preuve API, atteinte SANS ce rechargement.
			cy.reload();
			cy.visit("/documents/invoice");

			// PREUVE 3 — le badge, sur la LISTE, montre l'échec déclaratif (cohérent avec la
			// discipline "jamais silencieux" déjà tenue pour un rejet PDP/KSeF réel).
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find(`[data-cy="document-conformity-badge-${invoiceId}"]`, { timeout: 15000 })
				.should("contain.text", "Declaration issue");

			// PREUVE 4 — dans le dialogue d'édition, la timeline de conformité EXISTANTE montre
			// l'événement "nav" (providerId), jamais un mécanisme parallèle inventé.
			cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");
			cy.get('[data-cy="document-conformity-section"]', { timeout: 15000 })
				.scrollIntoView()
				.should("exist");
			cy.get('[data-cy="document-conformity-timeline"]')
				.find('[data-cy="document-conformity-event-code"]')
				.should("contain.text", "report:failed");
		});
	});
});
