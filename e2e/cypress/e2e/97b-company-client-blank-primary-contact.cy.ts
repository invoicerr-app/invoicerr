export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * PR #474 follow-up review, round 3, point 3 - #415's own "several contacts per client".
 *
 * The summary and the duplicate check used to look at a DIFFERENT primary contact than the one the
 * server actually saved: `client-upsert.tsx#buildClientPayload` picked the primary contact BEFORE
 * dropping empty rows, while the server's own `normalizeClientContacts` drops empty rows FIRST. For a
 * COMPANY client whose default (still blank) contact row is left untouched, that meant the summary
 * showed the blank row as "Primary" and the duplicate check matched on ITS (empty) email, never on a
 * real contact typed further down - so a genuine email collision on a second contact went completely
 * unwarned, and after save the server silently dropped the blank row and made that second contact
 * primary instead, with no indication anywhere in the wizard that this was about to happen.
 *
 * This spec creates a COMPANY client, leaves the default contact row empty, and adds Bob with an
 * email that already belongs to another client's primary contact. It proves: the duplicate warning
 * fires for Bob's email; the summary shows Bob as "Primary" with no blank row; and saving leaves Bob
 * primary, read back through the API.
 */
const api = Cypress.env("apiUrl");

describe("COMPANY client's blank default contact row never hides the real primary (#474 follow-up review, round 3, point 3)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 720);
	});

	it("warns on Bob's email (not the blank row's), the summary shows Bob as Primary with no blank row, and saving makes Bob primary", () => {
		const dupEmail = "dup-check-474r3@example.com";

		// The client Bob's email will collide with - a company whose OWN primary contact already
		// carries this address.
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				type: "COMPANY",
				name: "Existing Dupe 474r3 SARL",
				address: "1 Rue Existante",
				postalCode: "75000",
				city: "Paris",
				country: "France",
				countryCode: "FR",
				currency: "EUR",
				isActive: true,
				contacts: [{ firstName: "Existing", lastName: "Contact", email: dupEmail, isPrimary: true }],
			},
		});

		cy.intercept("POST", `${api}/api/clients`).as("createClient");
		cy.intercept("GET", `${api}/api/clients/duplicates*`).as("checkDuplicates");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Blank Primary 474r3 SARL");
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "France");
		cy.get('[name="address"]').clear().type("2 Rue du Test");
		cy.get('[name="postalCode"]').clear().type("75001");
		cy.get('[name="city"]').clear().type("Paris");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("552100554");
		cy.continueSteppedDialog("client-dialog");

		// Row 0 (the wizard's own default primary row) is left COMPLETELY untouched - the exact
		// scenario this fix is about. Bob is a SECOND row, added and filled with the colliding email.
		cy.get('[data-cy="client-form-contact"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="client-contact-add"]').click();
		cy.get('[name="contacts.1.firstName"]').clear().type("Bob");
		cy.get('[name="contacts.1.lastName"]').clear().type("Someone");
		cy.get('[name="contacts.1.email"]').clear().type(dupEmail);
		cy.wait("@checkDuplicates", { timeout: 10000 });

		// The warning fires for BOB's email - never the blank row's (which the old code looked at
		// instead, and which never matches anything).
		cy.get('[data-cy="client-duplicate-warning"]', { timeout: 10000 })
			.should("be.visible")
			.and("contain.text", "Existing Dupe 474r3 SARL");
		cy.get('[data-cy="client-duplicate-warning"]').screenshot("474r3-after-duplicate-warning-bob");

		cy.continueSteppedDialog("client-dialog");
		cy.get('[data-cy="client-dialog-step-body-recap"]').should("be.visible");

		// The summary shows exactly what will be saved: Bob primary, and no row at all for the blank
		// default contact - it never survives normalization, so it never gets a slot in the recap.
		cy.get('[data-cy="client-upsert-recap-contacts"]').should("contain.text", "Bob Someone");
		cy.get('[data-cy="client-upsert-recap-contact-0"]').should("contain.text", "Bob Someone").and(
			"contain.text",
			"Primary",
		);
		cy.get('[data-cy="client-upsert-recap-contact-1"]').should("not.exist");
		cy.screenshot("474r3-after-summary-bob-primary", { capture: "viewport" });

		cy.get('[data-cy="client-submit"]').click();
		cy.wait("@createClient")
			.its("response.body.id")
			.then((clientId: string) => {
				cy.get('[data-cy="client-dialog"]').should("not.exist");

				// Read back through the API - the source of truth, not just what the DOM shows: the
				// server agrees with the summary, exactly one contact, Bob, primary.
				cy.request({ url: `${api}/api/clients/${clientId}` })
					.its("body.contacts")
					.then((contacts: { firstName: string; lastName: string; isPrimary: boolean }[]) => {
						expect(contacts).to.have.length(1);
						expect(contacts[0]).to.include({ firstName: "Bob", lastName: "Someone", isPrimary: true });
					});
			});
	});
});
