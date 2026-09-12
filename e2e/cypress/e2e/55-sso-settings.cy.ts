/**
 * SSO par société (`Settings > SSO`, onglet `/settings/sso`) — un client enregistre SON PROPRE
 * fournisseur OIDC, sans toucher à l'environnement de l'instance. Jusqu'ici sans AUCUNE couverture
 * e2e alors que la logique serveur (sso.service.spec.ts, sso-policy.spec.ts,
 * sso-domain-verification.spec.ts) est verte depuis longtemps — ce fichier prouve que l'ÉCRAN mène
 * réellement à ces mêmes garanties, bout en bout, à travers un vrai callback DNS.
 *
 * Cinq propriétés qui comptent, aucune prouvable en relisant le DOM qu'on vient de remplir :
 *  1. Enregistrer un fournisseur (PUT /api/company/sso) ne renvoie JAMAIS le client secret — ni
 *     dans la réponse de la mutation elle-même, ni sur un GET plus tard. `SsoProviderStatus` n'a
 *     structurellement nulle part où loger un secret (voir le commentaire de ce type dans
 *     sso.service.ts) ; ce test échouerait bruyamment le jour où ce DTO serait élargi par erreur.
 *  2. Revendiquer un domaine affiche le NOM (`_invoicerr-sso.<domaine>`) et la VALEUR
 *     (`invoicerr-sso-verification=<jeton>`) de l'enregistrement DNS TXT à publier, identiques à
 *     ce que rapporte l'API.
 *  3. Cliquer "Verify" contre un domaine qui n'a jamais publié l'enregistrement échoue
 *     HONNÊTEMENT — un 400 nommant l'enregistrement exact, jamais un 500, jamais un faux succès.
 *     `.example` (réservé par la RFC 2606 précisément pour ça) garantit une vraie requête DNS sans
 *     jamais pouvoir résoudre un TXT correspondant.
 *  4. La route anonyme /api/sso/lookup reste inerte pour un domaine revendiqué mais NON vérifié —
 *     toute la propriété de sécurité derrière le fait de laisser une société taper n'importe quel
 *     domaine : sans preuve DNS, revendiquer "gmail.com" ne doit jamais router la connexion d'un
 *     inconnu vers son propre IdP.
 *  5. Le lien de connexion direct (/auth/sign-in?sso=c_<companyId>) est affiché et porte l'id de la
 *     société ACTIVE — vérifié contre l'id que la session better-auth elle-même rapporte, jamais
 *     seulement contre le providerId que le même écran affiche à côté.
 *
 * Hors périmètre, volontairement : `OIDC_ONLY` est un flag d'instance figé au démarrage (non
 * testable à chaud), et aucun aller-retour OIDC réel (redirection d'autorisation + callback) n'est
 * possible sans un vrai fournisseur d'identité.
 *
 * Discipline habituelle : les ACTIONS passent par l'écran (taper, cliquer), les ASSERTIONS qui
 * comptent relisent l'API — jamais le DOM qu'on vient de remplir comme preuve de ce qui est
 * réellement stocké.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// Réservé par la RFC 2606 pour exactement cet usage : un domaine garanti de ne JAMAIS résoudre de
// TXT, donc l'échec de vérification testé ici est un vrai échec DNS, pas une coïncidence de test.
const UNVERIFIABLE_DOMAIN = "invoicerr-e2e-does-not-exist.example";

interface SsoDomainStatus {
	id: string;
	domain: string;
	verified: boolean;
	recordName: string;
	recordValue: string;
}

interface SsoProviderStatus {
	providerId: string;
	label: string;
	issuerHost: string | null;
	isActive: boolean;
	redirectUri: string;
	domains: SsoDomainStatus[];
}

interface SsoResponse {
	provider: SsoProviderStatus | null;
	redirectUri: string;
}

function getSsoStatus() {
	return cy.request({ url: `${api}/api/company/sso` }).its("body") as unknown as Cypress.Chainable<SsoResponse>;
}

/** L'id de la société ACTIVE, lu depuis la session better-auth elle-même — jamais depuis le
 *  providerId que l'écran sous test affiche, pour que l'assertion de la propriété 5 ne se contente
 *  pas de comparer l'écran à lui-même. */
function activeCompanyId() {
	return cy
		.request({ url: `${api}/api/auth/get-session` })
		.its("body")
		.then((session: { activeCompanyId?: string }) => {
			expect(session.activeCompanyId, "l'utilisateur de test a une société active").to.be.a("string");
			return session.activeCompanyId as string;
		});
}

describe("SSO par société — écran de configuration", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("rien de configuré au départ — statut \"Not configured\", le formulaire de connexion est déjà ouvert", () => {
		cy.visit("/settings/sso");
		cy.get('[data-cy="sso-section"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="sso-status"]').should("contain.text", "Not configured");

		// Aucun fournisseur encore : la carte des domaines et le lien direct sont tous deux
		// conditionnés à un `provider` non nul, donc ni l'un ni l'autre ne peut être affiché.
		cy.get('[data-cy="sso-domains-card"]').should("not.exist");
		cy.get('[data-cy="sso-direct-link"]').should("not.exist");

		// L'URI de redirection est montrée AVANT toute configuration — c'est ce dont le client a
		// besoin pour créer l'application chez son IdP en premier lieu.
		cy.get('[data-cy="sso-redirect-uri"]').should(($input) => {
			expect(($input.val() as string) || "").to.match(/\/api\/auth\/callback\/c_/);
		});

		// `showForm` vaut `editing || !isConfigured`, ce qui est inconditionnellement vrai tant que
		// rien n'est configuré — le formulaire "Connect an identity provider" est donc bien ce
		// qu'une société toute neuve voit réellement, jamais un état vide séparé. La carte dédiée à
		// l'état vide (icône Fingerprint, "No identity provider connected yet") que le composant
		// rend aussi n'est en réalité JAMAIS atteignable : sa condition est
		// `!isConfigured && !showForm`, et `showForm` vaut déjà `true` chaque fois que
		// `!isConfigured` l'est — donc les deux ne peuvent jamais être vrais en même temps. Ce test
		// vérifie le comportement réel plutôt qu'une branche morte.
		cy.get('[data-cy="sso-form-card"]').should("exist");
	});

	it("enregistre un fournisseur par l'écran — ni la réponse de la mutation ni un GET plus tard ne portent le secret (propriété 1)", () => {
		const secret = "e2e-sso-CLIENT-SECRET-should-never-round-trip";

		cy.visit("/settings/sso");
		cy.get('[data-cy="sso-label-input"]', { timeout: 15000 }).type("Acme SSO");
		cy.get('[data-cy="sso-discoveryurl-input"]').type(
			"https://idp.e2e-fixture.example/.well-known/openid-configuration",
		);
		cy.get('[data-cy="sso-clientid-input"]').type("e2e-fixture-client-id");
		cy.get('[data-cy="sso-clientsecret-input"]').type(secret);
		cy.get('[data-cy="sso-save-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "SSO configuration saved");

		// L'écran lui-même bascule du formulaire vers la carte de statut — la preuve que
		// l'ENREGISTREMENT a bien abouti, pas seulement que le formulaire s'est vidé.
		cy.get('[data-cy="sso-status"]', { timeout: 10000 }).should("contain.text", "Active");

		// L'assertion qui compte : rappeler LA MÊME route que l'écran vient d'utiliser, directement,
		// et prouver que sa propre réponse ne peut PAS porter le secret — écrit pour échouer
		// bruyamment le jour où quelqu'un élargirait le DTO miroir de la réponse.
		cy.request({
			method: "PUT",
			url: `${api}/api/company/sso`,
			body: {
				label: "Acme SSO",
				discoveryUrl: "https://idp.e2e-fixture.example/.well-known/openid-configuration",
				clientId: "e2e-fixture-client-id",
				clientSecret: secret,
				isActive: true,
			},
		}).then((res) => {
			expect(res.status).to.eq(200);
			expect(JSON.stringify(res.body), "la réponse du PUT ne contient jamais le secret").to.not.include(
				secret,
			);
			expect(Object.keys(res.body), "aucun champ nommé pour un identifiant de connexion").to.not.include
				.members(["clientSecret", "credentials"]);
		});

		getSsoStatus().then((status) => {
			expect(status.provider, "le fournisseur est bien stocké").to.exist;
			expect(status.provider!.label).to.eq("Acme SSO");
			expect(status.provider!.isActive).to.eq(true);
			expect(
				JSON.stringify(status),
				"GET /api/company/sso ne renvoie pas non plus le secret",
			).to.not.include(secret);
		});
	});

	it("le lien de connexion direct est affiché et porte l'id de la société RÉELLEMENT active (propriété 5)", () => {
		activeCompanyId().then((companyId) => {
			cy.visit("/settings/sso");
			cy.get('[data-cy="sso-direct-link"]', { timeout: 15000 }).should(($input) => {
				expect($input.val()).to.eq(`/auth/sign-in?sso=c_${companyId}`);
			});

			getSsoStatus().then((status) => {
				expect(
					status.provider!.providerId,
					"le providerId que l'API résout pour cette société correspond",
				).to.eq(`c_${companyId}`);
			});
		});
	});

	it("revendiquer un domaine affiche l'enregistrement DNS TXT à publier, identique à celui de l'API (propriété 2)", () => {
		cy.visit("/settings/sso");
		cy.get('[data-cy="sso-domain-add-input"]', { timeout: 15000 }).type(UNVERIFIABLE_DOMAIN);
		cy.get('[data-cy="sso-domain-add-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Domain claimed");
		cy.contains('[data-cy="sso-domain-row"]', UNVERIFIABLE_DOMAIN, { timeout: 10000 }).should("exist");

		getSsoStatus().then((status) => {
			const claim = status.provider!.domains.find((d) => d.domain === UNVERIFIABLE_DOMAIN);
			expect(claim, "le domaine est bien stocké, non vérifié").to.exist;
			expect(claim!.verified).to.eq(false);

			cy.get('[data-cy="sso-domain-record-name"]').should(($input) => {
				expect($input.val()).to.eq(claim!.recordName);
			});
			cy.get('[data-cy="sso-domain-record-value"]').should(($input) => {
				expect($input.val()).to.eq(claim!.recordValue);
			});
		});
	});

	it("vérifier un domaine qui n'a jamais publié son enregistrement échoue honnêtement, et le lookup reste inerte tout du long (propriétés 3 & 4)", () => {
		// Propriété 4, AVANT toute tentative de vérification : un domaine revendiqué mais non
		// vérifié ne doit jamais router la connexion d'un inconnu où que ce soit.
		cy.request({ url: `${api}/api/sso/lookup?email=someone@${UNVERIFIABLE_DOMAIN}` }).then((res) => {
			expect(res.status, "aucun fournisseur pour un domaine non vérifié, jamais").to.eq(204);
			expect(res.body, "aucun corps à côté du 204").to.be.empty;
		});

		cy.visit("/settings/sso");
		cy.contains('[data-cy="sso-domain-row"]', UNVERIFIABLE_DOMAIN, { timeout: 15000 })
			.find('[data-cy="sso-domain-verify-button"]')
			.click();

		// La vraie requête DNS TXT part ici (`.example` ne résout jamais rien) — un échec
		// actionnable nommant l'enregistrement exact, jamais un 500, jamais un "Verified" silencieux.
		cy.get('[data-sonner-toast]', { timeout: 15000 }).should(
			"contain.text",
			`_invoicerr-sso.${UNVERIFIABLE_DOMAIN}`,
		);

		getSsoStatus().then((status) => {
			const claim = status.provider!.domains.find((d) => d.domain === UNVERIFIABLE_DOMAIN);
			expect(claim, "toujours dans la liste").to.exist;
			expect(claim!.verified, "l'échec ne doit jamais avoir fait passer verified à true").to.eq(false);
		});

		// Propriété 4 à nouveau, APRÈS la tentative échouée : toujours inerte.
		cy.request({ url: `${api}/api/sso/lookup?email=someone@${UNVERIFIABLE_DOMAIN}` }).then((res) => {
			expect(
				res.status,
				"une vérification échouée ne doit jamais accorder ce qu'une réussie accorderait",
			).to.eq(204);
		});
	});

	it("retire la revendication de domaine par l'écran", () => {
		cy.visit("/settings/sso");
		cy.contains('[data-cy="sso-domain-row"]', UNVERIFIABLE_DOMAIN, { timeout: 15000 })
			.find('[data-cy="sso-domain-remove-button"]')
			.click();

		cy.contains('[data-cy="sso-domain-row"]', UNVERIFIABLE_DOMAIN).should("not.exist");

		getSsoStatus().then((status) => {
			expect(status.provider!.domains.map((d) => d.domain)).to.not.include(UNVERIFIABLE_DOMAIN);
		});
	});

	it("retire le fournisseur par l'écran — retour à l'état non configuré", () => {
		cy.visit("/settings/sso");
		cy.get('[data-cy="sso-remove-button"]', { timeout: 15000 }).click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "SSO configuration removed");
		cy.get('[data-cy="sso-status"]').should("contain.text", "Not configured");

		getSsoStatus().then((status) => {
			expect(status.provider, "DELETE /api/company/sso a réellement supprimé la ligne").to.eq(null);
		});
	});
});
