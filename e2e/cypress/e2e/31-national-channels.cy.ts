/**
 * Les transports NATIONAUX (root TODO item 10) — vague 1 : le socle credentials + le canal PDP,
 * prouvé par l'écran : on connecte le canal PDP avec des identifiants FICTIFS pointant un serveur
 * qui n'existe pas (port fermé en local), on choisit `pdp` comme transport de facturation, et on
 * observe l'échec réel de la file (BullMQ retry puis "send_failed", l'erreur nommant le canal). Le
 * VRAI dépôt PDP (superpdp sandbox) est prouvé ailleurs, en réel, par
 * `backend/src/modules/documents/transports/pdp/pdp-live.spec.ts` (jest, `PDP_LIVE=1`) — jamais par
 * cette spec, qui ne parle à aucun serveur réel POUR PDP.
 *
 * Vague 2 (KSeF/PL, SdI/IT) étend ce fichier avec le MÊME motif — suggestion pays → connecter par
 * l'écran → choisir le transport → envoyer → "send_failed" nommant le canal — avec DEUX différences
 * assumées, documentées ici plutôt que devinées en silence :
 *
 *  1. AUCUN fichier `country-policy/data/{pl,it}.json` n'existe (item 11, pas item 10 — voir ce
 *     module's own header : "aucune règle fiscale/juridique inventée"). Une société dont le pays EST
 *     la Pologne/l'Italie a donc TOUTE action document bloquée (403, `country-policy.ts`'s propre
 *     décision 1) — y compris `save-draft`. Les tests ci-dessous basculent donc le pays de la société
 *     seedée vers la Pologne/l'Italie UNIQUEMENT pour vérifier la suggestion de canal (qui ne dépend
 *     QUE du pays, jamais de `country-policy`), puis le remettent en France avant de créer/envoyer un
 *     brouillon — la société qui envoie reste française, seul son TRANSPORT change vers `ksef`/`sdi`,
 *     exactement comme le registre le permet déjà ("rien n'impose qu'un pays choisisse SON canal
 *     suggéré" — voir `transport-registry.ts`'s own header).
 *  2. Contrairement à PDP (dont l'URL est un champ saisi par l'utilisateur, donc falsifiable vers un
 *     port fermé), l'URL de KSeF est FIXE par environnement (`ksef-client.ts`'s own `BASE_URLS`) —
 *     aucun champ de configuration ne la remplace. Le test KSeF envoie donc un jeton FICTIF au VRAI
 *     bac à sable public `ksef-test.mf.gov.pl`, qui le rejette réellement (code 450, "jeton
 *     invalide") — vérifié à la main avant d'écrire ce test (probe direct : réponse en moins de
 *     300ms, jamais un blocage réseau). SdI, lui, n'a besoin d'AUCUN réseau réel : la seule
 *     implémentation existante (`UNACCREDITED_SDI_HTTP_PORT`) échoue localement et immédiatement,
 *     accréditation AdE non obtenue — voir `sdi-transport.ts`'s own header.
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

/** NIP structurellement valide (le NIP de test bien connu du ministère des Finances polonais — voir
 *  `fa3-provider.spec.ts`'s own fixture) mais un TOKEN fictif : le vrai bac à sable
 *  ksef-test.mf.gov.pl le rejette réellement (code 450) — voir ce fichier's own header, point 2. */
const FAKE_KSEF = {
	nip: "5260001246",
	ksefToken: "e2e-fake-ksef-token",
};

/** Jamais atteint par un vrai appel réseau — `UNACCREDITED_SDI_HTTP_PORT` échoue avant toute tentative
 *  de connexion (accréditation AdE non obtenue, voir `sdi-transport.ts`'s own header) ; le contenu de
 *  ces valeurs n'a donc aucune importance, seule leur PRÉSENCE compte (le formulaire les exige). */
const FAKE_SDI = {
	idTrasmittente: "IT01234567890",
	certificate: "ZTJlLWZha2UtcGZ4LWNvbnRlbnRz",
	certificatePassword: "e2e-fake-cert-password",
};

/** Bascule le pays de la société seedée — voir ce fichier's own header, point 1, pour pourquoi ce
 *  n'est utilisé QUE pour vérifier la suggestion de canal, jamais pour créer/envoyer un document. */
function setCompanyCountry(country: string, countryCode: string) {
	return cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: { name: "Acme Corp", country, countryCode },
	});
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

	// ── Vague 2 : KSeF (Pologne) — voir ce fichier's own header pour les deux différences assumées ──

	it("une société POLONAISE voit la suggestion KSeF sur l'écran des canaux — la donnée vient de data/pl.json, jamais d'un `if`", () => {
		setCompanyCountry("Poland", "PL");
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-ksef"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-ksef-suggested"]').should("exist");
		// PDP n'est plus suggéré à une société polonaise — la suggestion suit le pays, jamais un
		// canal par défaut figé.
		cy.get('[data-cy="channel-pdp-suggested"]').should("not.exist");

		// Remise en France pour la suite de cette spec — voir ce fichier's own header, point 1.
		setCompanyCountry("France", "FR");
	});

	it("connecte le canal KSeF par l'écran avec des identifiants fictifs — statut \"Connected\"", () => {
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-ksef"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-ksef-status"]').should("contain.text", "Not connected");

		cy.get('[data-cy="channel-ksef-nip-input"]').clear().type(FAKE_KSEF.nip);
		cy.get('[data-cy="channel-ksef-kseftoken-input"]').clear().type(FAKE_KSEF.ksefToken);
		// Environnement laissé sur "Test (sandbox)" — c'est justement ce qui pointe vers le VRAI
		// ksef-test.mf.gov.pl (voir ce fichier's own header, point 2).
		cy.get('[data-cy="channel-ksef-connect-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel connected");
		cy.get('[data-cy="channel-ksef-status"]', { timeout: 10000 }).should("contain.text", "Connected");

		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then((body: { configured: { providerId: string; isActive: boolean; environment: string }[] }) => {
				const ksef = body.configured.find((c) => c.providerId === "ksef");
				expect(ksef, "le canal ksef est bien en base, actif").to.include({
					isActive: true,
					environment: "TEST",
				});
			});
	});

	it("choisit ksef comme transport de facturation, sur l'écran des réglages société", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', { timeout: 15000 }).click();
		cy.get('[data-cy="company-invoice-transport-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-ksef"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);

		cy.request({ url: `${api}/api/company/info` })
			.its("body")
			.then((company: { invoiceTransportId: string }) => {
				expect(company.invoiceTransportId, "le transport choisi est bien enregistré").to.eq("ksef");
			});
	});

	it('envoie une facture via KSeF → la file échoue réellement (jeton fictif rejeté par le vrai ksef-test.mf.gov.pl) et "send_failed" nomme le canal', () => {
		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			// Même budget que le test PDP ci-dessus — voir son commentaire. Le rejet KSeF réel est en
			// pratique quasi immédiat (probé à la main : < 300ms), donc ce budget est large, pas juste
			// suffisant.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
				.find('[data-cy="document-status-badge"]', { timeout: 40000 })
				.should("contain.text", "Send failed");

			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should("contain.text", "KSeF");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, 'la facture est réellement "send_failed" en base').to.eq("send_failed");
					expect(doc.lastActionError, "l'erreur enregistrée nomme le canal KSeF").to.match(/KSeF/);
					expect(doc.transportRef, "aucune référence de session/facture sans soumission acceptée").to.not.be.a(
						"string",
					);
				});
		});
	});

	it("déconnecte le canal KSeF par l'écran", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-ksef-status"]', { timeout: 15000 }).should("contain.text", "Connected");
		cy.get('[data-cy="channel-ksef-disconnect-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel disconnected");
		cy.get('[data-cy="channel-ksef-status"]', { timeout: 10000 }).should("contain.text", "Not connected");
	});

	// ── Vague 2 : SdI (Italie) — même motif, aucun réseau réel (accréditation AdE non obtenue) ──

	it("une société ITALIENNE voit la suggestion SdI sur l'écran des canaux — la donnée vient de data/it.json, jamais d'un `if`", () => {
		setCompanyCountry("Italy", "IT");
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-sdi"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-sdi-suggested"]').should("exist");
		cy.get('[data-cy="channel-pdp-suggested"]').should("not.exist");

		setCompanyCountry("France", "FR");
	});

	it("connecte le canal SdI par l'écran avec des identifiants fictifs — statut \"Connected\"", () => {
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-sdi"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-sdi-status"]').should("contain.text", "Not connected");

		cy.get('[data-cy="channel-sdi-idtrasmittente-input"]').clear().type(FAKE_SDI.idTrasmittente);
		cy.get('[data-cy="channel-sdi-certificate-input"]').clear().type(FAKE_SDI.certificate);
		cy.get('[data-cy="channel-sdi-certificatepassword-input"]').clear().type(FAKE_SDI.certificatePassword);
		cy.get('[data-cy="channel-sdi-connect-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel connected");
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 10000 }).should("contain.text", "Connected");

		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then((body: { configured: { providerId: string; isActive: boolean; environment: string }[] }) => {
				const sdi = body.configured.find((c) => c.providerId === "sdi");
				expect(sdi, "le canal sdi est bien en base, actif").to.include({
					isActive: true,
					environment: "TEST",
				});
			});
	});

	it("choisit sdi comme transport de facturation, sur l'écran des réglages société", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', { timeout: 15000 }).click();
		cy.get('[data-cy="company-invoice-transport-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-sdi"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);

		cy.request({ url: `${api}/api/company/info` })
			.its("body")
			.then((company: { invoiceTransportId: string }) => {
				expect(company.invoiceTransportId, "le transport choisi est bien enregistré").to.eq("sdi");
			});
	});

	it('envoie une facture via SdI → la file échoue réellement (accréditation AdE non obtenue, aucun réseau) et "send_failed" nomme le canal', () => {
		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
				.find('[data-cy="document-status-badge"]', { timeout: 40000 })
				.should("contain.text", "Send failed");

			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should("contain.text", "SdI");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, 'la facture est réellement "send_failed" en base').to.eq("send_failed");
					expect(doc.lastActionError, "l'erreur enregistrée nomme le canal SdI").to.match(/SdI/);
					expect(doc.transportRef, "aucune référence idSdI sans soumission acceptée").to.not.be.a("string");
				});
		});
	});

	it("déconnecte le canal SdI par l'écran", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 15000 }).should("contain.text", "Connected");
		cy.get('[data-cy="channel-sdi-disconnect-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel disconnected");
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 10000 }).should("contain.text", "Not connected");
	});
});
