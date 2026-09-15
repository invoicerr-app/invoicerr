export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The personal `/account` area (option B from the product decision: a screen OUTSIDE the company
 * `Settings`, reached from the avatar menu, with its own `Profile` / `Security` / `Preferences` /
 * `Danger zone` sub-nav — see `frontend/src/pages/(app)/account/_layout.tsx`'s own header). Before
 * this existed the profile form lived as the 8th tab of `Settings` and silently failed to save (it
 * sent `email` alongside `firstname`/`lastname`, which better-auth's own `update-user` rejects
 * outright the moment it carries one) — this spec proves the replacement actually persists, against
 * the REAL better-auth routes (`/api/auth/update-user`, `change-email`, `change-password`,
 * `delete-user`), never only the screen's own toast.
 *
 * Usual discipline (see 65-company-mail-settings.cy.ts and 50-approval.cy.ts): ACTIONS go through
 * the screen, the ASSERTIONS that matter read the API (and Mailpit) back — a status code is checked
 * on the intercepted request BEFORE any toast is asserted, and no test relies on a computed date or
 * on a document dialog's open/closed state (this spec never opens one).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const OWNER_EMAIL = "john.doe@acme.org";
const OWNER_PASSWORD = "Super_Secret_Password123!";

interface SessionBody {
	user?: { email?: string; firstname?: string; lastname?: string };
}

function getSession() {
	return cy.request({ url: `${api}/api/auth/get-session` }).its("body") as unknown as Cypress.Chainable<SessionBody>;
}

describe("Personal account page (/account)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login(); // OWNER (john.doe@acme.org) — see commands.ts#resetAndSeed
	});

	it('(1) the avatar menu\'s "My account" item opens /account', () => {
		cy.visit("/dashboard");
		cy.get('[data-cy="sidebar-user-menu-trigger"]', { timeout: 15000 }).click();
		cy.get('[data-cy="sidebar-account-menu-item"]').should("be.visible").click();
		cy.url({ timeout: 10000 }).should("include", "/account");
		cy.get('[data-cy="account-profile-card"]').should("be.visible");
	});

	it("(2) the profile and email fields are pre-filled from the session", () => {
		cy.visit("/account");
		cy.get('[data-cy="account-profile-firstname-input"]', { timeout: 15000 }).should("have.value", "John");
		cy.get('[data-cy="account-profile-lastname-input"]').should("have.value", "Doe");
		cy.get('[data-cy="account-email-current"]').should("contain.text", OWNER_EMAIL);
	});

	it("(3) editing firstname/lastname persists, updates the sidebar without a reload, and the session confirms it", () => {
		cy.visit("/account");

		cy.intercept("POST", `${api}/api/auth/update-user`).as("updateUser");
		cy.get('[data-cy="account-profile-firstname-input"]').clear().type("Jonathan");
		cy.get('[data-cy="account-profile-lastname-input"]').clear().type("Doerson");
		cy.get('[data-cy="account-profile-save-button"]').click();

		cy.wait("@updateUser", { timeout: 10000 }).then((interception) => {
			expect(interception.response?.statusCode, "POST /api/auth/update-user must succeed").to.eq(200);
		});
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Profile updated");

		// The sidebar reads the SAME shared `authClient.useSession()` store `refetch()` just refreshed —
		// no `cy.reload()` anywhere in this test.
		cy.get('[data-cy="sidebar-user-menu-trigger"]', { timeout: 10000 })
			.should("contain.text", "Jonathan")
			.and("contain.text", "Doerson");

		getSession().then((session) => {
			expect(session.user?.firstname, "le prénom est bien persisté côté serveur").to.eq("Jonathan");
			expect(session.user?.lastname, "le nom est bien persisté côté serveur").to.eq("Doerson");
		});

		// Back to the seeded baseline — every other test/spec in this run assumes "John Doe".
		cy.request({
			method: "POST",
			url: `${api}/api/auth/update-user`,
			body: { firstname: "John", lastname: "Doe" },
		}).its("status").should("eq", 200);
		getSession().then((session) => {
			expect(session.user?.firstname).to.eq("John");
			expect(session.user?.lastname).to.eq("Doe");
		});
	});

	it("(4) requesting an email change sends a Mailpit confirmation but never changes the session's email", () => {
		const newEmail = "john.doe.new@acme.org";
		cy.clearEmails();
		cy.visit("/account");

		cy.intercept("POST", `${api}/api/auth/change-email`).as("changeEmail");
		cy.get('[data-cy="account-email-new-input"]').type(newEmail);
		cy.get('[data-cy="account-email-send-button"]').click();

		cy.wait("@changeEmail", { timeout: 10000 }).then((interception) => {
			expect(interception.response?.statusCode, "POST /api/auth/change-email must succeed").to.eq(200);
		});
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", newEmail);

		cy.getLastEmail().then((message: { Subject?: string }) => {
			expect(message.Subject, "le sujet du mail de confirmation nomme la nouvelle adresse").to.include(
				newEmail,
			);
		});

		// The address only changes once the link in that email is actually clicked — this test never
		// clicks it, so the session must still carry the ORIGINAL address.
		getSession().then((session) => {
			expect(session.user?.email, "l'adresse ne change pas tant que le lien n'est pas cliqué").to.eq(
				OWNER_EMAIL,
			);
		});
	});

	it("(5) a wrong current password is refused, and the session stays valid", () => {
		cy.visit("/account/security");

		cy.intercept("POST", `${api}/api/auth/change-password`).as("changePassword");
		cy.get('[data-cy="account-security-current-password-input"]', { timeout: 15000 }).type(
			"definitely-the-wrong-password",
		);
		cy.get('[data-cy="account-security-password-input"]').type("Another_Valid123!");
		cy.get('[data-cy="account-security-confirm-password-input"]').type("Another_Valid123!");
		cy.get('[data-cy="account-security-submit-button"]').click();

		cy.wait("@changePassword", { timeout: 10000 }).then((interception) => {
			expect(interception.response?.statusCode, "a wrong current password must be refused").to.not.eq(
				200,
			);
		});
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("be.visible");

		// The failed attempt did not sign the user out or otherwise touch their session.
		getSession().then((session) => {
			expect(session.user?.email, "la session reste valide après un mot de passe refusé").to.eq(
				OWNER_EMAIL,
			);
		});
	});

	it('(6) deleting john\'s account is refused — he is the sole OWNER of Acme Corp ("ACCOUNT_IS_SOLE_OWNER")', () => {
		cy.visit("/account/danger");

		cy.get('[data-cy="account-danger-delete-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="account-danger-dialog"]').should("be.visible");

		cy.intercept("POST", `${api}/api/auth/delete-user`).as("deleteUser");
		cy.get('[data-cy="account-danger-password-input"]').type(OWNER_PASSWORD);
		cy.get('[data-cy="account-danger-confirm-button"]').click();

		cy.wait("@deleteUser", { timeout: 10000 }).then((interception) => {
			expect(
				interception.response?.statusCode,
				"the sole owner of a company cannot delete their own account",
			).to.not.eq(200);
		});
		cy.get('[data-cy="account-danger-sole-owner-notice"]', { timeout: 10000 }).should("be.visible");

		// The account genuinely still exists — read back from the API, never only from the dialog's own
		// text.
		getSession().then((session) => {
			expect(session.user?.email, "le compte existe toujours après le refus").to.eq(OWNER_EMAIL);
		});
	});

	it("(7) /settings/account no longer exists — falls back to the company tab", () => {
		cy.visit("/settings/account");
		cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("be.visible");
	});
});
