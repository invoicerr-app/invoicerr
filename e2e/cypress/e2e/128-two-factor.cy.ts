export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Two-factor authentication with an authenticator app (#947), end to end against the real
 * better-auth two-factor plugin: turn it on from `/account/security` (QR code, secret, first code),
 * read the backup codes, sign in again with a code, then turn it off.
 *
 * Each step also leaves a viewport screenshot under `pr-screens/1046-*`, which `cypress.yml` uploads
 * as the `pr-screenshots-shard-*` artifact so the pull request can show the real screens.
 *
 * The codes come from the Node-side `totpCode` task (cypress.config.ts), fed with the secret the
 * screen itself displays, so the test types exactly what an authenticator app would show.
 */
const api = Cypress.env("apiUrl");

const OWNER_EMAIL = "john.doe@acme.org";
const OWNER_PASSWORD = "Super_Secret_Password123!";

interface SessionBody {
	user?: { email?: string; twoFactorEnabled?: boolean | null };
}

function getSession() {
	return cy.request({ url: `${api}/api/auth/get-session` }).its("body") as unknown as Cypress.Chainable<SessionBody>;
}

function screen(name: string) {
	cy.screenshot(`pr-screens/1046-${name}`, { capture: "viewport" });
}

describe("Two-factor authentication (authenticator app)", () => {
	let secret = "";

	before(() => {
		cy.resetAndSeed();
	});

	// The owner leaves this spec with two-factor on if any step fails, and every later spec signs in
	// as that owner without a code: rebuild the baseline world whatever happened here.
	after(() => {
		cy.resetAndSeed();
	});

	it("(1) turns two-factor on from the security page: QR code, secret, then a first code", () => {
		cy.login();
		cy.visit("/account/security");

		cy.get('[data-cy="two-factor-card"]', { timeout: 15000 }).scrollIntoView().should("be.visible");
		cy.get('[data-cy="two-factor-status"]').should("contain.text", "Off");
		screen("01-security-off");

		cy.intercept("POST", `${api}/api/auth/two-factor/enable`).as("enable");
		cy.get('[data-cy="two-factor-password-input"]').type(OWNER_PASSWORD);
		cy.get('[data-cy="two-factor-enable"]').click();
		cy.wait("@enable", { timeout: 10000 }).its("response.statusCode").should("eq", 200);

		cy.get('[data-cy="two-factor-secret"]', { timeout: 10000 })
			.invoke("text")
			.then((text) => {
				secret = text.trim();
				expect(secret, "the screen shows the base32 secret next to the QR code").to.match(/^[A-Z2-7]+=*$/);
			});
		cy.get('[data-cy="two-factor-card"] svg').should("be.visible");
		cy.get('[data-cy="two-factor-card"]').scrollIntoView();
		screen("02-setup-qr-code");

		cy.then(() => cy.task<string>("totpCode", { secret })).then((code) => {
			cy.get('[data-cy="two-factor-setup-code-input"]').type(code);
		});
		screen("03-setup-code-typed");

		cy.intercept("POST", `${api}/api/auth/two-factor/verify-totp`).as("verify");
		cy.get('[data-cy="two-factor-confirm"]').click();
		cy.wait("@verify", { timeout: 10000 }).its("response.statusCode").should("eq", 200);

		cy.get('[data-cy="two-factor-backup-code"]', { timeout: 10000 }).should("have.length.greaterThan", 0);
		cy.get('[data-cy="two-factor-backup-codes"]').scrollIntoView();
		screen("04-backup-codes");

		cy.get('[data-cy="two-factor-done"]').click();
		cy.get('[data-cy="two-factor-status"]').should("contain.text", "On");
		getSession().its("user.twoFactorEnabled").should("eq", true);
		cy.get('[data-cy="two-factor-card"]').scrollIntoView();
		screen("05-security-on");
	});

	it("(2) signing in again asks for the code, the code opens the app, and the password turns it off", () => {
		expect(secret, "test (1) captured the secret").to.not.eq("");
		cy.clearAllCookies();
		cy.then(() => Cypress.session.clearAllSavedSessions());

		cy.visit("/auth/sign-in");
		cy.get('[data-cy="auth-email-input"]', { timeout: 15000 }).type(OWNER_EMAIL);
		cy.get('[data-cy="auth-password-input"]').type(OWNER_PASSWORD);
		cy.get('[data-cy="auth-submit-btn"]').click();

		// The password alone does not open a session: the second-factor form replaces the sign-in form.
		cy.get('[data-cy="auth-two-factor-form"]', { timeout: 15000 }).should("be.visible");
		cy.url().should("include", "/auth/sign-in");
		screen("06-sign-in-asks-code");

		cy.task<string>("totpCode", { secret }).then((code) => {
			cy.get('[data-cy="auth-two-factor-code-input"]').type(code);
		});
		screen("07-sign-in-code-typed");
		cy.get('[data-cy="auth-two-factor-submit"]').click();

		cy.url({ timeout: 20000 }).should("include", "/dashboard");
		getSession().its("user.email").should("eq", OWNER_EMAIL);

		// Turning it off happens in this same test: Cypress clears cookies between tests, and a fresh
		// `cy.login()` would now stop at the code form.
		cy.visit("/account/security");
		cy.get('[data-cy="two-factor-status"]', { timeout: 15000 }).should("contain.text", "On");
		cy.get('[data-cy="two-factor-password-input"]').type(OWNER_PASSWORD);
		cy.get('[data-cy="two-factor-card"]').scrollIntoView();
		screen("08-disable-ready");

		cy.intercept("POST", `${api}/api/auth/two-factor/disable`).as("disable");
		cy.get('[data-cy="two-factor-disable"]').click();
		cy.wait("@disable", { timeout: 10000 }).its("response.statusCode").should("eq", 200);

		cy.get('[data-cy="two-factor-status"]').should("contain.text", "Off");
		getSession().its("user.twoFactorEnabled").should("eq", false);
		cy.get('[data-cy="two-factor-card"]').scrollIntoView();
		screen("09-security-off-again");
	});
});
