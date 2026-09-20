export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The six legal documents (`backend/src/legal/data/*.md`) and the SaaS-mode acceptance flow they back
 * (product decision 2026-09-16): the sign-up checkbox, the `LEGAL_ACCEPTANCE_REQUIRED` refusal, and
 * the sign-in re-acceptance interstitial (`pages/legal/accept.tsx`).
 *
 * This e2e stack, like every other spec here, runs with NO
 * `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` set — the same self-hosted-shaped environment
 * `72-billing-hidden.cy.ts`'s own header describes, and for the same reason: CI never turns hosted
 * billing (or, by the same flag, legal acceptance) on for the ordinary stack. Rather than skip the
 * three acceptance scenarios outright, this spec detects the instance's own `saasMode`
 * (`GET /api/legal/documents`, public) and adapts: every assertion below runs unconditionally, but
 * three of them assert an OUTCOME that itself depends on `saasMode`, and the three SaaS-only sign-up
 * scenarios run only when `saasMode` is actually true — proven, on 2026-09-16, against a throwaway
 * backend/frontend pair started for exactly this spec with the flag set (see this feature's own final
 * report for the exact commands). Turning a dedicated SaaS-mode leg on for the standard CI stack (the
 * way `scenarios.yml` runs its own matrix) is a coordinator decision, not one this spec makes for
 * itself.
 *
 * REVERSED 2026-09-20: this spec used to assert that `GET /api/legal/documents`, the public document
 * page, and the sign-in/sign-up footer all served the six documents REGARDLESS of `saasMode` — i.e. it
 * proved a self-hosted instance published the hosted service's own legal notice, terms, DPA and
 * sub-processor list under someone else's name. That was the defect, not a feature to keep green: the
 * owner's decision is that self-hosted instances serve NONE of these six documents (only the licence
 * already in the repository governs that install). The three assertions below now branch on
 * `saasMode` instead of ignoring it, and this stack (self-hosted, `saasMode:false`) exercises the
 * EMPTY-catalogue side of all three every run — the previously-untested "does this actually hide
 * everything" side, not just "does hosted mode still work" (still covered by the dedicated
 * `expectSaas` lane described above).
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
			// Same guard `76-seats.cy.ts`'s own `before()` holds, for the identical reason: a dedicated
			// SaaS CI lane sets `CYPRESS_expectSaas` to assert billing is ACTUALLY on, rather than let the
			// four SaaS-only tests below silently report "pending" inside a job that then reports green
			// regardless of whether they ever ran.
			if (Cypress.env('expectSaas') && !saasMode) {
				throw new Error(
					'CYPRESS_expectSaas is set but GET /api/legal/documents reported saasMode:false — ' +
						'billing/legal-acceptance is not actually enabled on this stack ' +
						'(WARNING__ENABLE_BILLING_FOR_USERS__WARNING unset or misconfigured?). Refusing to ' +
						'silently skip every SaaS-only test below.',
				);
			}
		});
	});

	it("GET /api/legal/documents serves all six documents in SaaS mode, and NONE on a self-hosted instance", () => {
		cy.request({ url: `${api}/api/legal/documents`, failOnStatusCode: false }).then((response) => {
			expect(response.status, "public route, reachable with no cookie at all").to.eq(200);
			expect(response.body.saasMode).to.be.a("boolean");

			if (saasMode) {
				const slugs = response.body.documents.map((d: { slug: string }) => d.slug);
				expect(slugs).to.include.members(ALL_SLUGS);
				for (const doc of response.body.documents) {
					expect(doc.version, `${doc.slug} has a version`).to.be.a("string").and.not.be.empty;
					expect(doc.content, `${doc.slug} has content`).to.be.a("string").and.not.be.empty;
				}
			} else {
				// The whole point of the fix: a self-hosted instance has no legal documents of its own
				// to publish — the author's identity, a subscription this instance doesn't sell, a
				// processor relationship where nothing is processed for it. Only the licence already in
				// the repository governs a self-hosted install, and this endpoint has never served it.
				expect(response.body.documents, "self-hosted instances publish none of the six documents").to.deep.equal([]);
			}
		});
	});

	it("renders the public legal document pages in SaaS mode, or a clear not-published notice on a self-hosted instance", () => {
		cy.visit("/legal/terms-of-service");

		if (saasMode) {
			cy.get('[data-cy="legal-document-content"]', { timeout: 15000 }).should("exist");
			cy.get('[data-cy="legal-document-content"] h1').should("contain.text", "Terms of Service");

			cy.visit("/legal/privacy-policy");
			cy.get('[data-cy="legal-document-content"] h1', { timeout: 15000 }).should("contain.text", "Privacy Policy");

			cy.visit("/legal/does-not-exist");
			cy.get('[data-cy="legal-document-not-found"]', { timeout: 15000 }).should("exist");
		} else {
			// A real slug (terms-of-service) and a bogus one land on the exact same notice — proof this
			// is a deliberate "this instance doesn't publish this" message, not an ordinary slug-not-found
			// that would only make sense on an instance that publishes SOME documents. A bookmark or a
			// link from the operator's own site must not look like a broken page.
			cy.get('[data-cy="legal-document-not-found"]', { timeout: 15000 })
				.should("exist")
				.and("contain.text", "doesn't publish this document");

			cy.visit("/legal/does-not-exist");
			cy.get('[data-cy="legal-document-not-found"]', { timeout: 15000 })
				.should("exist")
				.and("contain.text", "doesn't publish this document");
		}
	});

	it("shows the legal links on the sign-in/sign-up screens in SaaS mode, and no footer at all on a self-hosted instance", () => {
		cy.visit("/auth/sign-in");
		if (saasMode) {
			cy.get('[data-cy="legal-links"]').should("exist");
			cy.get('[data-cy="legal-link-privacy-policy"]').should("have.attr", "href", "/legal/privacy-policy");
		} else {
			cy.get('[data-cy="legal-links"]').should("not.exist");
		}

		cy.visit("/auth/sign-up");
		if (saasMode) {
			cy.get('[data-cy="legal-links"]').should("exist");
			cy.get('[data-cy="legal-link-terms-of-service"]').should("have.attr", "href", "/legal/terms-of-service");
		} else {
			cy.get('[data-cy="legal-links"]').should("not.exist");
		}
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

			// Backdate this user's Terms of Service acceptance to a content hash that can never match
			// whatever ships today (decision 2026-09-17: the interstitial compares hashes, not version
			// strings) — see cypress.config.ts's own header on this task for why a real DB write, not a
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
