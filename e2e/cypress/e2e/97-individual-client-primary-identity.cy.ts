export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * PR #474 follow-up review, round 2, point 1 - #415's own "several contacts per client".
 *
 * DECISION: for an INDIVIDUAL client, the primary contact is ALWAYS the person on the identity step
 * (`contactFirstname`/`contactLastname`) - no other `contacts` row can become primary. Before this
 * fix, flagging a secondary row primary (Marie) silently sent her row to the API as "Jean Dupont"
 * (the identity step's own names overwrote it), losing her real name with no message anywhere, and
 * the Summary step showed the row's own name rather than what would actually be saved.
 *
 * This spec edits an INDIVIDUAL "Jean Dupont" who has two contacts (Jean, primary; Marie, not) and
 * proves: Marie's row's "set primary" control is disabled; the Summary step shows exactly what will
 * be saved (Jean still primary, Marie's own name); and saving leaves Marie's name intact, read back
 * through the API.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("INDIVIDUAL client primary contact is the identity person (#474 follow-up review, round 2, point 1)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1440, 900);
	});

	it("disables another row's primary control, the summary matches what saves, and saving keeps Marie's name", () => {
		// Seeded through the API - a COUNTRY with no identifiers catalog (United States, like
		// 05-clients.cy.ts's own INDIVIDUAL coverage) so the Tax & identifiers step has nothing this
		// test needs to fill in, keeping it focused on the Contact step and the Summary.
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				type: "INDIVIDUAL",
				contactFirstname: "Jean",
				contactLastname: "Dupont",
				address: "1 Rue de la Paix",
				postalCode: "90001",
				city: "Los Angeles",
				country: "United States",
				countryCode: "US",
				currency: "USD",
				isActive: true,
				contacts: [
					{ firstName: "Jean", lastName: "Dupont", email: "jean.dupont@example.com", isPrimary: true },
					{ firstName: "Marie", lastName: "Curie", email: "marie.curie@example.com" },
				],
			},
		})
			.its("body.id")
			.then((clientId: string) => {
				cy.visit("/clients");
				cy.wait(1000);
				// The client's own `name` column is blank for an INDIVIDUAL client (the identity lives on
				// its primary contact instead) - the search box's own `contacts.lastName` match needs the
				// LAST name alone, not the full "Jean Dupont" (no single contact field contains that).
				cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type(
					"Dupont",
				);
				cy.wait(500);
				cy.get('[data-cy="edit-client-button-jean.dupont@example.com"]').click();
				cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

				// Editing opens every step clickable from the start - jump straight to Contact.
				cy.get('[data-cy="client-dialog-step-contact"]').click();
				cy.get('[data-cy="client-form-contact"]', { timeout: 10000 }).should("be.visible");

				// Row 0 is Jean (primary, the identity) - its own name inputs are read-only, showing the
				// identity step's names, never editable here.
				cy.get('[data-cy="client-contact-row-0"]').should("contain.text", "Primary");
				cy.get('[name="contacts.0.firstName"]').should("be.disabled").and("have.value", "Jean");
				cy.get('[name="contacts.0.lastName"]').should("be.disabled").and("have.value", "Dupont");
				cy.get('[data-cy="client-contact-row-0"]').should(
					"contain.text",
					"Comes from the identity step",
				);
				// Element screenshot of the WHOLE row card - shows the "Primary" badge, the read-only
				// firstName/lastName inputs (Jean/Dupont) and the "Comes from the identity step" helper
				// together, so the locked state is legible from the image alone, not just the assertions
				// above.
				cy.get('[data-cy="client-contact-row-0"]').scrollIntoView().screenshot(
					"474r2-after-primary-row-locked",
				);

				// Row 1 is Marie - her OWN "set primary" control is disabled: no other row can ever
				// become primary for an INDIVIDUAL client.
				cy.get('[data-cy="client-contact-primary-radio-1"]').should("be.disabled");
				cy.get('[data-cy="client-contact-primary-locked-1"]').should("be.visible").and("contain.text", "Only the person on the identity step");
				// Hover the label so the native tooltip (`title`, the disabled-reason text) has a chance
				// to render into the screenshot alongside the row - a disabled radio's own visual state
				// (opacity/cursor) can be too subtle to read from a static image on its own.
				cy.get('[data-cy="client-contact-primary-radio-1"]')
					.parent()
					.scrollIntoView()
					.trigger("mouseover");
				cy.get('[data-cy="client-contact-row-1"]').screenshot(
					"474r2-after-marie-row-cannot-be-primary",
				);

				// Her own name fields stay fully editable (only the PRIMARY row's names are locked).
				cy.get('[name="contacts.1.firstName"]').should("not.be.disabled").and("have.value", "Marie");
				cy.get('[name="contacts.1.lastName"]').should("not.be.disabled").and("have.value", "Curie");

				cy.continueSteppedDialog("client-dialog");
				cy.get('[data-cy="client-dialog-step-body-recap"]').should("be.visible");

				// The summary shows exactly what will be saved: Jean Dupont as the client's own name
				// (the recap's "Name" row), and the contacts list with Jean primary and Marie's OWN
				// name intact - never overwritten by the identity's.
				cy.get('[data-cy="client-upsert-recap-name"]').should("have.text", "Jean Dupont");
				cy.get('[data-cy="client-upsert-recap-contacts"]')
					.should("contain.text", "Jean Dupont")
					.and("contain.text", "Marie Curie");
				cy.get('[data-cy="client-upsert-recap-contact-0"]').should("contain.text", "Primary");
				cy.get('[data-cy="client-upsert-recap-contact-1"]').should("not.contain.text", "Primary");
				cy.viewport(1280, 720);
				cy.screenshot("474r2-after-summary-jean-marie", { capture: "viewport" });
				cy.viewport(1440, 900);

				cy.get('[data-cy="client-submit"]').click();
				cy.get('[data-cy="client-dialog"]').should("not.exist");

				// Saving closes the dialog but does not itself open the client view (same as
				// 93-client-contacts.cy.ts's own save-then-view flow) - re-open it explicitly.
				cy.visit("/clients");
				cy.wait(1000);
				cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type(
					"Dupont",
				);
				cy.wait(500);
				cy.contains("Jean Dupont").click();

				// The client view after save - Marie's own name, never a second "Jean Dupont" row.
				cy.get('[data-cy="client-view-contacts"]', { timeout: 10000 }).should("be.visible");
				cy.get('[data-cy="client-view-contact-0"]').should("contain.text", "Jean Dupont");
				cy.get('[data-cy="client-view-contact-1"]').should("contain.text", "Marie Curie");
				cy.viewport(1280, 720);
				cy.screenshot("474r2-after-view-marie-intact", { capture: "viewport" });
				cy.viewport(1440, 900);

				// Read back through the API — the source of truth, not just what the DOM shows.
				cy.request({ url: `${api}/api/clients/${clientId}` })
					.its("body.contacts")
					.then((contacts: { firstName: string; lastName: string; isPrimary: boolean }[]) => {
						const jean = contacts.find((c) => c.isPrimary);
						const marie = contacts.find((c) => !c.isPrimary);
						expect(jean).to.include({ firstName: "Jean", lastName: "Dupont" });
						expect(marie).to.include({ firstName: "Marie", lastName: "Curie" });
					});
			});
	});

	it("rejects, at the API, a payload flagging a non-identity contact primary for an INDIVIDUAL client - Marie's name is never rewritten", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				type: "INDIVIDUAL",
				contactFirstname: "Ada",
				contactLastname: "Lovelace",
				address: "1 Analytical Engine Way",
				postalCode: "90001",
				city: "Los Angeles",
				country: "United States",
				countryCode: "US",
				currency: "USD",
				isActive: true,
				contacts: [
					{ firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", isPrimary: true },
					{ firstName: "Marie", lastName: "Curie", email: "marie2@example.com" },
				],
			},
		})
			.its("body.id")
			.then((clientId: string) => {
				cy.request({
					method: "PATCH",
					url: `${api}/api/clients/${clientId}`,
					failOnStatusCode: false,
					body: {
						type: "INDIVIDUAL",
						contactFirstname: "Ada",
						contactLastname: "Lovelace",
						address: "1 Analytical Engine Way",
						postalCode: "90001",
						city: "Los Angeles",
						country: "United States",
						countryCode: "US",
						currency: "USD",
						isActive: true,
						contacts: [
							{ firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", isPrimary: false },
							{
								firstName: "Marie",
								lastName: "Curie",
								email: "marie2@example.com",
								isPrimary: true,
							},
						],
					},
				}).then((res) => {
					expect(res.status).to.eq(400);
					expect(res.body.message).to.match(/primary contact of an individual client/i);
				});

				cy.request({ url: `${api}/api/clients/${clientId}` })
					.its("body.contacts")
					.then((contacts: { firstName: string; lastName: string; isPrimary: boolean }[]) => {
						const marie = contacts.find((c) => c.firstName === "Marie");
						expect(marie).to.include({ firstName: "Marie", lastName: "Curie", isPrimary: false });
					});
			});
	});
});
