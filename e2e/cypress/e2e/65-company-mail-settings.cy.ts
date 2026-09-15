export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Per-company mail server (`Settings > Mail`, `/settings/mail` tab) — TODO_FEATURES.md entry G. The
 * backend's société → instance → refus-nommé cascade (`MailService#sendForCompany`, commits
 * f1ed72e4/63b42ef9) already governs every send in this repo; before this screen existed, a company
 * had no way to ever reach the "société" branch of it.
 *
 * Four properties that matter, none provable by reading back the DOM we just filled in:
 *  1. Connecting a company SMTP server (`PUT /api/company/mail-settings`) never returns the password —
 *     `CompanyMailSettingsStatus` structurally has nowhere to hold one (see that type's own comment
 *     in `company-mail-settings.types.ts`); this test would fail loudly the day that DTO grows a
 *     secret field by mistake.
 *  2. "Test send" exercises the REAL cascade end to end: this test points the company's own SMTP at
 *     the e2e stack's real Mailpit (`localhost:1025`, already the INSTANCE's own SMTP target per
 *     `backend/.env.test`) and checks the message actually lands in Mailpit
 *     (`localhost:8025`), the same real-SMTP discipline `23-document-email.cy.ts` already uses for
 *     document sends.
 *  3. The test email goes to the CALLER's own address (`john.doe@acme.org`, the user `cy.login()`
 *     signs in as — see `commands.ts#resetAndSeed`), never an address this screen could be tricked
 *     into supplying.
 *  4. Clearing the company's own server (`DELETE`) really reverts the status to "using the instance's
 *     mail server" — read back from the API, never only from the screen's own toast.
 *
 * Usual discipline: ACTIONS go through the screen (typing, clicking), the ASSERTIONS that matter read
 * the API (and Mailpit) back — never the DOM we just filled in as proof of what is actually stored.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface CompanyMailSettingsStatus {
	configured: boolean;
	kind?: "smtp" | "resend";
	fromAddress?: string;
}

function getMailSettingsStatus() {
	return cy
		.request({ url: `${api}/api/company/mail-settings` })
		.its("body") as unknown as Cypress.Chainable<CompanyMailSettingsStatus>;
}

const COMPANY_SMTP_FROM_ADDRESS = "company-e2e@local.dev";

describe("Company mail settings — configuration screen", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("nothing configured at the start — status names the instance fallback, the connect form is already open", () => {
		cy.visit("/settings/mail");
		cy.get('[data-cy="mail-settings-section"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="mail-settings-status-badge"]').should(
			"contain.text",
			"Using the instance's mail server",
		);

		// `showForm` equals `editing || !isConfigured` — unconditionally true while nothing is
		// configured, so the connect form is what a brand-new company actually sees.
		cy.get('[data-cy="mail-settings-form-card"]').should("exist");

		// Neither action makes sense with nothing of the company's own to edit or revert.
		cy.get('[data-cy="mail-settings-edit-button"]').should("not.exist");
		cy.get('[data-cy="mail-settings-revert-button"]').should("not.exist");

		getMailSettingsStatus().then((status) => {
			expect(status.configured, "rien n'est configuré au départ").to.eq(false);
		});
	});

	it("connects a company SMTP server via the screen — the password is never echoed back (property 1)", () => {
		cy.visit("/settings/mail");
		cy.get('[data-cy="mail-settings-provider-select"]', { timeout: 15000 }).should(
			"contain.text",
			"SMTP",
		);

		// The e2e stack's real Mailpit — already what the INSTANCE-level SMTP config in
		// backend/.env.test points at (SMTP_HOST=localhost, SMTP_PORT=1025, SMTP_SECURE=false),
		// so a company-level override here exercises the SAME real server, just through the
		// "société" branch of the cascade instead of the instance one.
		cy.get('[data-cy="mail-settings-host-input"]').clear().type("localhost");
		cy.get('[data-cy="mail-settings-port-input"]').clear().type("1025");
		cy.get('[data-cy="mail-settings-username-input"]').clear().type("company-e2e");
		cy.get('[data-cy="mail-settings-password-input"]').clear().type("does-not-matter-for-mailpit");
		cy.get('[data-cy="mail-settings-fromaddress-input"]').clear().type(COMPANY_SMTP_FROM_ADDRESS);
		cy.get('[data-cy="mail-settings-save-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Mail server saved");

		// The screen itself switches from the form to the status card — the proof that the SAVE
		// actually succeeded, not just that the form emptied itself.
		cy.get('[data-cy="mail-settings-status-badge"]', { timeout: 10000 }).should(
			"contain.text",
			"Company server (SMTP)",
		);
		cy.get('[data-cy="mail-settings-from-address"]').should("contain.text", COMPANY_SMTP_FROM_ADDRESS);

		// The assertion that matters: read the SAME route the screen just used, directly, and prove
		// its response CANNOT carry the secret — written to fail loudly the day someone widens the
		// response's mirror DTO.
		getMailSettingsStatus().then((status) => {
			expect(status.configured, "la config société est bien stockée").to.eq(true);
			expect(status.kind).to.eq("smtp");
			expect(status.fromAddress).to.eq(COMPANY_SMTP_FROM_ADDRESS);
			expect(
				Object.keys(status).sort(),
				"GET /api/company/mail-settings ne renvoie QUE configured/kind/fromAddress — jamais host/port/username/password",
			).to.deep.equal(["configured", "fromAddress", "kind"]);
			expect(
				JSON.stringify(status),
				"le mot de passe SMTP ne doit jamais apparaître dans la réponse",
			).to.not.include("does-not-matter-for-mailpit");
		});
	});

	it('a real click on "Test send" goes through this company\'s own server and lands in Mailpit (properties 2 & 3)', () => {
		cy.clearEmails();

		cy.visit("/settings/mail");
		cy.get('[data-cy="mail-settings-test-button"]', { timeout: 15000 }).click();

		cy.get('[data-sonner-toast]', { timeout: 15000 }).should("contain.text", "Test email sent");

		cy.getLastEmail().then((message: any) => {
			expect(
				message.To?.[0]?.Address,
				"le mail de test va à l'adresse du DEMANDEUR, jamais une adresse fournie ailleurs",
			).to.eq("john.doe@acme.org");
			expect(message.From?.Address, "envoyé depuis l'adresse configurée par la société").to.eq(
				COMPANY_SMTP_FROM_ADDRESS,
			);
		});
	});

	it("reverts to the instance server via the screen, with confirmation (property 4)", () => {
		cy.visit("/settings/mail");
		cy.get('[data-cy="mail-settings-revert-button"]', { timeout: 15000 }).click();

		cy.get('[data-cy="mail-settings-revert-confirm-dialog"]').should("be.visible");
		cy.get('[data-cy="mail-settings-revert-confirm-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should(
			"contain.text",
			"Reverted to the instance mail server",
		);
		cy.get('[data-cy="mail-settings-status-badge"]', { timeout: 10000 }).should(
			"contain.text",
			"Using the instance's mail server",
		);
		cy.get('[data-cy="mail-settings-revert-button"]').should("not.exist");

		getMailSettingsStatus().then((status) => {
			expect(status.configured, "DELETE a réellement effacé la config société").to.eq(false);
			expect(status.kind, "plus de kind une fois revenu à l'instance").to.be.undefined;
			expect(status.fromAddress, "plus de fromAddress une fois revenu à l'instance").to.be.undefined;
		});
	});
});
