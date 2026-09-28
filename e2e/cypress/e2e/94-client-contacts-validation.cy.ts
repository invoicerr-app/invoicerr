export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * PR #474 follow-up review (issue #415's own "several contacts per client").
 *
 * `93-client-contacts.cy.ts` proves the happy path (several named contacts, one primary). This
 * spec proves the three defects the owner's review found in that PR, and their fixes:
 *
 *  1. The Contact step used to validate the legacy `contactEmail`/`contactPhone` fields, which have
 *     no visible input any more, instead of the real `contacts` array - an invalid contact email
 *     (`bob@`) passed "Continue" and only failed much later, silently, at the Summary step's own
 *     "Save" click. Now the Contact step itself blocks, with a visible error on the offending row.
 *  2. Editing a client whose STORED phone predates today's stricter validation (e.g. written through
 *     the API, the MCP tool, or the pre-#415 migration) used to load that value into a hidden
 *     legacy field the Contact step still validated - blocking the step on an error nobody could see
 *     or fix. Now the error (if any) is attached to the visible contact row, and fixing THAT row
 *     clears it.
 *  3. An empty, never-typed-into contact row used to be created as primary regardless - a client
 *     created without touching the Contact step showed a "- / -" primary contact instead of "No
 *     contacts". The backend now drops an all-blank contact before writing.
 */
const api = Cypress.env("apiUrl");

describe("Client contacts validation (#415 follow-up review)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1440, 900);
	});

	it("point 1: an invalid contact email blocks the Contact step's own Continue, with a visible error", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Invalid Email SARL");
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "France");
		cy.get('[name="address"]').clear().type("1 Rue Invalide");
		cy.get('[name="postalCode"]').clear().type("75000");
		cy.get('[name="city"]').clear().type("Paris");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("552100554");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
		cy.continueSteppedDialog("client-dialog");

		// The Contact step already carries one blank contact row - type an invalid email into it.
		cy.get('[data-cy="client-form-contact"]', { timeout: 10000 }).should("be.visible");
		cy.get('[name="contacts.0.firstName"]').clear().type("Bob");
		cy.get('[name="contacts.0.email"]').clear().type("bob@");

		// Clicking Continue must NOT advance the wizard: the step body stays "contact".
		cy.get('[data-cy="client-dialog-continue"]').click();
		cy.wait(500);
		cy.get('[data-cy="client-dialog-step-body-contact"]').should("be.visible");

		// The error is visible, attached to the offending row.
		cy.get('[data-cy="client-contact-row-0"]')
			.should("contain.text", "Email format is invalid")
			.screenshot("474-after-invalid-email-error");

		// Fixing the email lets the step advance normally.
		cy.get('[name="contacts.0.email"]').clear().type("bob@invalid-email.example");
		cy.continueSteppedDialog("client-dialog");
		cy.get('[data-cy="client-dialog-step-body-recap"]').should("be.visible");
		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
	});

	it("point 2: editing a client with a stored bad phone shows the error on the contact row, and fixing it saves", () => {
		// Stored directly through the API (bypassing the form's own validation entirely, which is
		// exactly how a pre-#415 record, an MCP-created one, or a migrated one could carry a phone
		// that fails today's stricter regex) - `01.02.03.04.05` has dots the regex never allowed.
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Bad Phone SARL",
				type: "COMPANY",
				kind: "BUSINESS",
				address: "1 Rue du Telephone",
				postalCode: "75000",
				city: "Paris",
				country: "France",
				countryCode: "FR",
				currency: "EUR",
				isActive: true,
				// A required identifier (France's LEGAL_ID/SIRET) so the wizard's own whole-form check
				// on save has nothing else to complain about besides the one thing this test is about.
				identifiers: [{ scheme: "LEGAL_ID", value: "552100554" }],
				contacts: [
					{
						firstName: "Bad",
						lastName: "Phone",
						email: "bad-phone@example.com",
						phone: "01.02.03.04.05",
						isPrimary: true,
					},
				],
			},
		})
			.its("body.id")
			.then((clientId: string) => {
				cy.visit("/clients");
				cy.wait(1000);
				cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type(
					"Bad Phone SARL",
				);
				cy.wait(500);
				cy.get(`[data-cy="edit-client-button-bad-phone@example.com"]`).click();
				cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

				// Editing opens every step clickable from the start - jump straight to Contact.
				cy.get('[data-cy="client-dialog-step-contact"]').click();
				cy.get('[data-cy="client-form-contact"]', { timeout: 10000 }).should("be.visible");

				// The stored bad value is right there in the visible row, not hidden anywhere.
				cy.get('[name="contacts.0.phone"]').should("have.value", "01.02.03.04.05");

				// Trying to Continue with the bad value still on the row surfaces the error on THAT row.
				cy.get('[data-cy="client-dialog-continue"]').click();
				cy.wait(500);
				cy.get('[data-cy="client-dialog-step-body-contact"]').should("be.visible");
				cy.get('[data-cy="client-contact-row-0"]')
					.should("contain.text", "Phone number format is invalid")
					.screenshot("474-after-edit-bad-phone-error");

				// Fixing the row's own phone clears the error and lets the step (and the save) proceed.
				cy.get('[name="contacts.0.phone"]').clear().type("+33102030405");
				cy.continueSteppedDialog("client-dialog");
				cy.get('[data-cy="client-dialog-step-body-recap"]').should("be.visible");
				cy.get('[data-cy="client-submit"]').click();
				cy.get('[data-cy="client-dialog"]').should("not.exist");

				cy.request({ url: `${api}/api/clients/${clientId}` })
					.its("body.contacts.0.phone")
					.should("eq", "+33102030405");
			});
	});

	it("point 3: creating a client without touching the Contact step leaves it with no contacts, not an empty primary", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("No Contact SARL");
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "France");
		cy.get('[name="address"]').clear().type("1 Rue Sans Contact");
		cy.get('[name="postalCode"]').clear().type("75000");
		cy.get('[name="city"]').clear().type("Paris");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("552100554");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
		cy.continueSteppedDialog("client-dialog");

		// Nothing typed into the Contact step's own blank row - straight to Continue.
		cy.get('[data-cy="client-form-contact"]', { timeout: 10000 }).should("be.visible");
		cy.continueSteppedDialog("client-dialog");
		cy.get('[data-cy="client-dialog-step-body-recap"]').should("be.visible");
		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");

		cy.visit("/clients");
		cy.wait(1000);
		cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type(
			"No Contact SARL",
		);
		cy.wait(500);
		cy.contains("No Contact SARL").click();

		cy.get('[data-cy="client-view-contacts"]', { timeout: 10000 }).should("not.exist");
		cy.wait(500);
		cy.contains("No contacts").should("be.visible").screenshot("474-after-no-contact-view");

		cy.request({ url: `${api}/api/clients?page=1` })
			.its("body.clients")
			.then((clients: { id: string; name: string }[]) => {
				const created = clients.find((c) => c.name === "No Contact SARL");
				expect(created, "the client was created").to.exist;
				cy.request({ url: `${api}/api/clients/${(created as { id: string }).id}` })
					.its("body.contacts")
					.should("deep.equal", []);
			});
	});
});
