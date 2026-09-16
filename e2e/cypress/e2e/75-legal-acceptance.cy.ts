export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The five legal documents (`documentation/docs/legal/*.md`) and the SaaS-mode acceptance flow they
 * back (product decision 2026-09-16): the sign-up checkbox, the `LEGAL_ACCEPTANCE_REQUIRED` refusal,
 * and the sign-in re-acceptance interstitial (`pages/legal/accept.tsx`).
 *
 * This e2e stack, like every other spec here, runs with NO
 * `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` set — the same self-hosted-shaped environment
 * `72-billing-hidden.cy.ts`'s own header describes, and for the same reason: CI never turns hosted
 * billing (or, by the same flag, legal acceptance) on for the ordinary stack. Rather than skip the
 * three acceptance scenarios outright, this spec detects the instance's own `saasMode`
 * (`GET /api/legal/documents`, public) and adapts: the public-document and self-hosted assertions
 * always run; the three SaaS-mode scenarios run only when `saasMode` is actually true — proven, on
 * 2026-09-16, against a throwaway backend/frontend pair started for exactly this spec with the flag
 * set (see this feature's own final report for the exact commands). Turning a dedicated SaaS-mode leg
 * on for the standard CI stack (the way `scenarios.yml` runs its own matrix) is a coordinator decision,
 * not one this spec makes for itself.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const PASSWORD = "Super_Secret_Password123!";

const REQUIRED_SLUGS = ["terms-of-service", "privacy-policy"];
const ALL_SLUGS = [...REQUIRED_SLUGS, "data-processing-agreement", "legal-notice", "cookies-and-acceptable-use"];

function fillSignupForm({ firstname, lastname, email }: { firstname: string; lastname: string; email: string }) {
	cy.get('[data-cy="auth-firstname-input"]', { timeout: 10000 }).should("be.visible").type(firstname);
	cy.get('[data-cy="auth-lastname-input"]').type(lastname);
	cy.get('[data-cy="auth-email-input"]').type(email);
	cy.get('[data-cy="auth-password-input"]').type(PASSWORD);
}

/** Whether an account for `email` can actually sign in — the API-level proof that a UI sign-up did
 *  (or, for the refused case, did NOT) create a real account, per this repo's own "actions par
 *  l'écran, assertions par l'API" convention. */
function canSignIn(email: string) {
	return cy
		.request({ method: "POST", url: `${api}/api/auth/sign-in/email`, body: { email, password: PASSWORD }, failOnStatusCode: false })
		.then((response) => [200, 201].includes(response.status));
}

describe("Legal acceptance", () => {
	let saasMode = false;

	before(() => {
		cy.resetAndSeed();
		cy.request(`${api}/api/legal/documents`).then((response) => {
			saasMode = !!response.body.saasMode;
			cy.log(`this instance's saasMode: ${saasMode}`);
		});
	});

	it("GET /api/legal/documents serves all five documents, publicly, with no session", () => {
		cy.request({ url: `${api}/api/legal/documents`, failOnStatusCode: false }).then((response) => {
			expect(response.status, "public route, reachable with no cookie at all").to.eq(200);
			expect(response.body.saasMode).to.be.a("boolean");
			const slugs = response.body.documents.map((d: { slug: string }) => d.slug);
			expect(slugs).to.include.members(ALL_SLUGS);
			for (const doc of response.body.documents) {
				expect(doc.version, `${doc.slug} has a version`).to.be.a("string").and.not.be.empty;
				expect(doc.content, `${doc.slug} has content`).to.be.a("string").and.not.be.empty;
			}
		});
	});

	it("renders the public legal document pages", () => {
		cy.visit("/legal/terms-of-service");
		cy.get('[data-cy="legal-document-content"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="legal-document-content"] h1').should("contain.text", "Terms of Service");

		cy.visit("/legal/privacy-policy");
		cy.get('[data-cy="legal-document-content"] h1', { timeout: 15000 }).should("contain.text", "Privacy Policy");

		cy.visit("/legal/does-not-exist");
		cy.get('[data-cy="legal-document-not-found"]', { timeout: 15000 }).should("exist");
	});

	it("shows the legal links on both the sign-in and sign-up screens", () => {
		cy.visit("/auth/sign-in");
		cy.get('[data-cy="legal-links"]').should("exist");
		cy.get('[data-cy="legal-link-privacy-policy"]').should("have.attr", "href", "/legal/privacy-policy");

		cy.visit("/auth/sign-up");
		cy.get('[data-cy="legal-links"]').should("exist");
		cy.get('[data-cy="legal-link-terms-of-service"]').should("have.attr", "href", "/legal/terms-of-service");
	});

	describe("self-hosted mode (this e2e stack's own default)", () => {
		it("sign-up shows no acceptance checkbox, and succeeds without one", function () {
			if (saasMode) this.skip();

			const email = `legal-selfhosted-${Date.now()}@example.com`;
			cy.visit("/auth/sign-up");
			cy.get('[data-cy="auth-accept-legal-checkbox"]').should("not.exist");
			fillSignupForm({ firstname: "Sam", lastname: "Selfhosted", email });
			cy.get('[data-cy="auth-submit-btn"]').click();
			cy.get('[data-sonner-toast]', { timeout: 15000 }).should("contain.text", "created");

			canSignIn(email).should("eq", true);
		});

		it("GET /api/legal/status is always the empty shape for an authenticated user", function () {
			if (saasMode) this.skip();
			cy.login();
			cy.request(`${api}/api/legal/status`).then((response) => {
				expect(response.body).to.deep.equal({ requiresAcceptance: false, pending: [] });
			});
		});
	});

	describe("SaaS mode", () => {
		it("POST /api/auth/sign-up/email without acceptLegal answers 400 LEGAL_ACCEPTANCE_REQUIRED", function () {
			if (!saasMode) this.skip();

			const email = `legal-saas-api-refused-${Date.now()}@example.com`;
			cy.request({
				method: "POST",
				url: `${api}/api/auth/sign-up/email`,
				failOnStatusCode: false,
				body: { name: "No Consent", firstname: "No", lastname: "Consent", email, password: PASSWORD },
			}).then((response) => {
				expect(response.status, "no acceptLegal at all — refused the same as acceptLegal:false").to.eq(400);
				expect(response.body.code).to.eq("LEGAL_ACCEPTANCE_REQUIRED");
			});

			canSignIn(email).should("eq", false);
		});

		it("sign-up UI refuses submission when the checkbox is left unchecked", function () {
			if (!saasMode) this.skip();

			const email = `legal-saas-ui-refused-${Date.now()}@example.com`;
			cy.visit("/auth/sign-up");
			cy.get('[data-cy="auth-accept-legal-checkbox"]').should("exist").and("not.be.checked");
			fillSignupForm({ firstname: "Nina", lastname: "NoBox", email });
			cy.get('[data-cy="auth-submit-btn"]').click();
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "accept");

			canSignIn(email).should("eq", false);
		});

		it("sign-up with the checkbox checked creates the account and stores both acceptances", function () {
			if (!saasMode) this.skip();

			const email = `legal-saas-accepted-${Date.now()}@example.com`;
			cy.visit("/auth/sign-up");
			fillSignupForm({ firstname: "Priya", lastname: "Consented", email });
			cy.get('[data-cy="auth-accept-legal-checkbox"]').click();
			cy.get('[data-cy="auth-submit-btn"]').click();
			cy.get('[data-sonner-toast]', { timeout: 15000 }).should("contain.text", "created");

			canSignIn(email).should("eq", true);
			cy.request(`${api}/api/legal/status`).then((response) => {
				expect(response.body).to.deep.equal({ requiresAcceptance: false, pending: [] });
			});
		});

		it("a stale acceptance sends the next sign-in through the re-acceptance interstitial", function () {
			if (!saasMode) this.skip();

			const email = `legal-saas-stale-${Date.now()}@example.com`;
			cy.visit("/auth/sign-up");
			fillSignupForm({ firstname: "Omar", lastname: "Stale", email });
			cy.get('[data-cy="auth-accept-legal-checkbox"]').click();
			cy.get('[data-cy="auth-submit-btn"]').click();
			cy.get('[data-sonner-toast]', { timeout: 15000 }).should("contain.text", "created");

			// Backdate this user's Terms of Service acceptance to a version older than whatever ships
			// today — see cypress.config.ts's own header on this task for why a real DB write, not a
			// fixture, is what proves the interstitial without waiting for an actual document change.
			cy.task("setStaleLegalAcceptance", { email, slug: "terms-of-service", version: "2000-01-01" });

			cy.visit("/auth/sign-in");
			cy.get('[data-cy="auth-email-input"]').type(email);
			cy.get('[data-cy="auth-password-input"]').type(PASSWORD);
			cy.get('[data-cy="auth-submit-btn"]').click();

			cy.url({ timeout: 20000 }).should("include", "/legal/accept");
			cy.get('[data-cy="legal-accept-document-terms-of-service"]', { timeout: 15000 }).should("exist");
			// Privacy Policy was never backdated — only the one document actually stale is shown.
			cy.get('[data-cy="legal-accept-document-privacy-policy"]').should("not.exist");

			cy.get('[data-cy="legal-accept-btn"]').click();
			cy.url({ timeout: 20000 }).should("include", "/dashboard");

			cy.request(`${api}/api/legal/status`).then((response) => {
				expect(response.body).to.deep.equal({ requiresAcceptance: false, pending: [] });
			});
		});
	});
});
