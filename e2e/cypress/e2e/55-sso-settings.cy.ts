export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Per-company SSO (`Settings > SSO`, `/settings/sso` tab) — a customer registers THEIR OWN
 * OIDC provider, without touching the instance's environment. Until now with NO e2e coverage
 * at all even though the server logic (sso.service.spec.ts, sso-policy.spec.ts,
 * sso-domain-verification.spec.ts) has been green for a long time — this file proves that the
 * SCREEN really leads to these same guarantees, end to end, through a real DNS callback.
 *
 * Five properties that matter, none provable by reading back the DOM we just filled in:
 *  1. Registering a provider (PUT /api/company/sso) NEVER returns the client secret — neither
 *     in the mutation's own response, nor on a later GET. `SsoProviderStatus` structurally has
 *     nowhere to hold a secret (see that type's own comment in
 *     sso.service.ts); this test would fail loudly the day this DTO was widened by mistake.
 *  2. Claiming a domain shows the NAME (`_invoicerr-sso.<domain>`) and the VALUE
 *     (`invoicerr-sso-verification=<token>`) of the DNS TXT record to publish, identical to
 *     what the API reports.
 *  3. Clicking "Verify" against a domain that never published the record fails
 *     HONESTLY — a 400 naming the exact record, never a 500, never a false success.
 *     `.example` (reserved by RFC 2606 precisely for this) guarantees a real DNS request that can
 *     never resolve a matching TXT record.
 *  4. The anonymous route /api/sso/lookup stays inert for a domain that is claimed but NOT
 *     verified — the whole security property behind letting a company type in any
 *     domain: without DNS proof, claiming "gmail.com" must never route a stranger's login
 *     to its own IdP.
 *  5. The direct sign-in link (/auth/sign-in?sso=c_<companyId>) is shown and carries the id of the
 *     ACTIVE company — checked against the id the better-auth session itself reports, never
 *     only against the providerId the same screen shows next to it.
 *
 * Deliberately out of scope: `OIDC_ONLY` is an instance-wide flag fixed at startup (not
 * hot-testable), and no real OIDC round trip (authorization redirect + callback) is
 * possible without a real identity provider.
 *
 * Usual discipline: ACTIONS go through the screen (typing, clicking), the ASSERTIONS that
 * matter read the API back — never the DOM we just filled in as proof of what is
 * actually stored.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// Reserved by RFC 2606 for exactly this use: a domain guaranteed to NEVER resolve a
// TXT record, so the verification failure tested here is a real DNS failure, not a test coincidence.
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

/** The ACTIVE company's id, read from the better-auth session itself — never from the
 *  providerId that the screen under test displays, so that property 5's assertion does not just
 *  compare the screen to itself. */
function activeCompanyId() {
	return cy
		.request({ url: `${api}/api/auth/get-session` })
		.its("body")
		.then((session: { activeCompanyId?: string }) => {
			expect(session.activeCompanyId, "l'utilisateur de test a une société active").to.be.a("string");
			return session.activeCompanyId as string;
		});
}

describe("Per-company SSO — configuration screen", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("nothing configured at the start — status \"Not configured\", the connection form is already open", () => {
		cy.visit("/settings/sso");
		cy.get('[data-cy="sso-section"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="sso-status"]').should("contain.text", "Not configured");

		// No provider yet: the domains card and the direct link are both
		// conditioned on a non-null `provider`, so neither one can be displayed.
		cy.get('[data-cy="sso-domains-card"]').should("not.exist");
		cy.get('[data-cy="sso-direct-link"]').should("not.exist");

		// The redirect URI is shown BEFORE any configuration — it is what the customer
		// needs to create the application at their IdP in the first place.
		cy.get('[data-cy="sso-redirect-uri"]').should(($input) => {
			expect(($input.val() as string) || "").to.match(/\/api\/auth\/callback\/c_/);
		});

		// `showForm` equals `editing || !isConfigured`, which is unconditionally true as long as
		// nothing is configured — the "Connect an identity provider" form is therefore indeed what
		// a brand-new company actually sees, never a separate empty state. The component long
		// also rendered a dedicated empty-state card (Fingerprint icon, "No identity
		// provider connected yet") under the condition `!isConfigured && !showForm` — unreachable,
		// since `showForm` is already `true` every time `!isConfigured` is, so the two could
		// never be true at the same time. This dead card has been removed; this test
		// checks the actual behavior (the form) rather than a branch that never
		// executed.
		cy.get('[data-cy="sso-form-card"]').should("exist");
	});

	it("registers a provider via the screen — neither the mutation's response nor a later GET carries the secret (property 1)", () => {
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

		// The screen itself switches from the form to the status card — the proof that
		// the SAVE actually succeeded, not just that the form emptied itself.
		cy.get('[data-cy="sso-status"]', { timeout: 10000 }).should("contain.text", "Active");

		// The assertion that matters: call THE SAME route the screen just used, directly,
		// and prove that its own response CANNOT carry the secret — written to fail
		// loudly the day someone widens the response's mirror DTO.
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

	it("the direct sign-in link is shown and carries the id of the REALLY active company (property 5)", () => {
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

	it("claiming a domain shows the DNS TXT record to publish, identical to the API's own (property 2)", () => {
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

	it("verifying a domain that never published its record fails honestly, and the lookup stays inert throughout (properties 3 & 4)", () => {
		// Property 4, BEFORE any verification attempt: a domain that is claimed but not
		// verified must never route a stranger's login anywhere.
		cy.request({ url: `${api}/api/sso/lookup?email=someone@${UNVERIFIABLE_DOMAIN}` }).then((res) => {
			expect(res.status, "aucun fournisseur pour un domaine non vérifié, jamais").to.eq(204);
			expect(res.body, "aucun corps à côté du 204").to.be.empty;
		});

		cy.visit("/settings/sso");
		cy.contains('[data-cy="sso-domain-row"]', UNVERIFIABLE_DOMAIN, { timeout: 15000 })
			.find('[data-cy="sso-domain-verify-button"]')
			.click();

		// The real DNS TXT request goes out here (`.example` never resolves anything) — an
		// actionable failure naming the exact record, never a 500, never a silent "Verified".
		cy.get('[data-sonner-toast]', { timeout: 15000 }).should(
			"contain.text",
			`_invoicerr-sso.${UNVERIFIABLE_DOMAIN}`,
		);

		getSsoStatus().then((status) => {
			const claim = status.provider!.domains.find((d) => d.domain === UNVERIFIABLE_DOMAIN);
			expect(claim, "toujours dans la liste").to.exist;
			expect(claim!.verified, "l'échec ne doit jamais avoir fait passer verified à true").to.eq(false);
		});

		// Property 4 again, AFTER the failed attempt: still inert.
		cy.request({ url: `${api}/api/sso/lookup?email=someone@${UNVERIFIABLE_DOMAIN}` }).then((res) => {
			expect(
				res.status,
				"une vérification échouée ne doit jamais accorder ce qu'une réussie accorderait",
			).to.eq(204);
		});
	});

	it("removes the domain claim via the screen", () => {
		cy.visit("/settings/sso");
		cy.contains('[data-cy="sso-domain-row"]', UNVERIFIABLE_DOMAIN, { timeout: 15000 })
			.find('[data-cy="sso-domain-remove-button"]')
			.click();

		cy.contains('[data-cy="sso-domain-row"]', UNVERIFIABLE_DOMAIN).should("not.exist");

		getSsoStatus().then((status) => {
			expect(status.provider!.domains.map((d) => d.domain)).to.not.include(UNVERIFIABLE_DOMAIN);
		});
	});

	it("removes the provider via the screen — back to the unconfigured state", () => {
		cy.visit("/settings/sso");
		cy.get('[data-cy="sso-remove-button"]', { timeout: 15000 }).click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "SSO configuration removed");
		cy.get('[data-cy="sso-status"]').should("contain.text", "Not configured");

		getSsoStatus().then((status) => {
			expect(status.provider, "DELETE /api/company/sso a réellement supprimé la ligne").to.eq(null);
		});
	});
});
