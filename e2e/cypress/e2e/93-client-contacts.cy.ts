export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #415 - "Support multiple contacts per client".
 *
 * Proves, through the real screen: a COMPANY client can carry several named contacts, exactly one
 * flagged primary; the client view lists all of them with the primary marked; the quote "send"
 * action's own recipient default (`generic-actions.ts#registerEmailRecipientDefaultFromClient`)
 * resolves to the PRIMARY contact's email, never a secondary one, and follows the primary when it
 * changes; and the CSV import's OLD template columns (unchanged by #415 - they still mean "the
 * primary contact") still import into one primary `ClientContact` cleanly.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function countClients() {
	return cy.request({ method: "GET", url: `${api}/api/clients?page=1` }).then((res) => res.body.clients.length);
}

describe("Client contacts (#415)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1440, 900);
	});

	it("creates a COMPANY client with three contacts, marks the second as primary, and the view lists all three", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Contacts Demo SARL");
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "France");
		cy.get('[name="address"]').clear().type("1 Rue des Contacts");
		cy.get('[name="postalCode"]').clear().type("75000");
		cy.get('[name="city"]').clear().type("Paris");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("552100554");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
		cy.continueSteppedDialog("client-dialog");

		// The Contact step already carries ONE blank contact row (client-upsert.tsx's own
		// `blankPrimaryContact` default) - filled in as contact #1, then two more added.
		cy.get('[name="contacts.0.firstName"]').clear().type("Alice");
		cy.get('[name="contacts.0.lastName"]').clear().type("Martin");
		cy.get('[name="contacts.0.email"]').clear().type("alice@contacts-demo.example");
		cy.get('[name="contacts.0.phone"]').clear().type("+33100000001");

		cy.get('[data-cy="client-contact-add"]').click();
		cy.get('[name="contacts.1.firstName"]').clear().type("Bob");
		cy.get('[name="contacts.1.lastName"]').clear().type("Bernard");
		cy.get('[name="contacts.1.email"]').clear().type("bob@contacts-demo.example");
		cy.get('[name="contacts.1.phone"]').clear().type("+33100000002");

		cy.get('[data-cy="client-contact-add"]').click();
		cy.get('[name="contacts.2.firstName"]').clear().type("Chloé");
		cy.get('[name="contacts.2.lastName"]').clear().type("Petit");
		cy.get('[name="contacts.2.email"]').clear().type("chloe@contacts-demo.example");
		cy.get('[name="contacts.2.phone"]').clear().type("+33100000003");

		// Mark the SECOND contact (Bob) as primary.
		cy.get('[data-cy="client-contact-primary-radio-1"]').click();
		cy.get('[data-cy="client-contact-row-1"]').should("contain.text", "Primary");

		cy.screenshot("415-after-form-contacts", { capture: "viewport" });

		cy.continueSteppedDialog("client-dialog");
		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");

		cy.visit("/clients");
		cy.wait(1000);
		cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type(
			"Contacts Demo",
		);
		cy.wait(500);
		cy.contains("Contacts Demo SARL").click();

		cy.get('[data-cy="client-view-contacts"]', { timeout: 10000 }).should("be.visible");
		// The API (and this view) orders contacts PRIMARY FIRST, then by position (`primary-contact.ts`'s
		// own `CONTACTS_INCLUDE` ordering) - Bob (flagged primary) is index 0 here, not the form's own
		// entry order (Alice, Bob, Chloé).
		cy.get('[data-cy="client-view-contact-0"]').should("contain.text", "Bob Bernard");
		cy.get('[data-cy="client-view-contact-0"]').should("contain.text", "Primary");
		cy.get('[data-cy="client-view-contact-1"]').should("contain.text", "Alice Martin");
		cy.get('[data-cy="client-view-contact-2"]').should("contain.text", "Chloé Petit");
		// Only ONE contact carries the primary badge.
		cy.get('[data-cy="client-view-contact-primary-badge-0"]').should("exist");
		cy.get('[data-cy="client-view-contact-primary-badge-1"]').should("not.exist");
		cy.get('[data-cy="client-view-contact-primary-badge-2"]').should("not.exist");

		cy.screenshot("415-after-client-view", { capture: "viewport" });
	});

	// Orchestrator review (#415): ContactsSection used to key each row by its ARRAY INDEX, which lets
	// React reuse a SURVIVING row's own DOM/input state for a DIFFERENT row after a middle removal
	// shifts everyone above it down by one - `useFieldArray`'s own `field.id` fixes that. This proves
	// it through the real form: three contacts, remove the MIDDLE one, and the row that is now at
	// index 1 must show contact #3's OWN values, never a leftover of what used to be contact #2's.
	it("removing the MIDDLE contact leaves the other two with their own values, never a leftover from the removed row", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Middle Removal SARL");
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "France");
		cy.get('[name="address"]').clear().type("1 Rue du Milieu");
		cy.get('[name="postalCode"]').clear().type("75000");
		cy.get('[name="city"]').clear().type("Paris");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("552100554");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
		cy.continueSteppedDialog("client-dialog");

		cy.get('[name="contacts.0.firstName"]').clear().type("First");
		cy.get('[name="contacts.0.lastName"]').clear().type("Contact");
		cy.get('[name="contacts.0.email"]').clear().type("first@middle-removal.example");
		cy.get('[name="contacts.0.phone"]').clear().type("+33200000001");

		cy.get('[data-cy="client-contact-add"]').click();
		cy.get('[name="contacts.1.firstName"]').clear().type("Second");
		cy.get('[name="contacts.1.lastName"]').clear().type("Contact");
		cy.get('[name="contacts.1.email"]').clear().type("second@middle-removal.example");
		cy.get('[name="contacts.1.phone"]').clear().type("+33200000002");

		cy.get('[data-cy="client-contact-add"]').click();
		cy.get('[name="contacts.2.firstName"]').clear().type("Third");
		cy.get('[name="contacts.2.lastName"]').clear().type("Contact");
		cy.get('[name="contacts.2.email"]').clear().type("third@middle-removal.example");
		cy.get('[name="contacts.2.phone"]').clear().type("+33200000003");

		// Remove the MIDDLE one ("Second Contact", currently row index 1).
		cy.get('[data-cy="client-contact-remove-1"]').click();

		// Exactly two rows remain, and the survivor that shifted up into index 1 must show the
		// THIRD contact's own values - never "Second Contact" surviving under a reused index-1 key.
		cy.get('[data-cy="client-contact-row-0"]').should("exist");
		cy.get('[data-cy="client-contact-row-1"]').should("exist");
		cy.get('[data-cy="client-contact-row-2"]').should("not.exist");
		cy.get('[name="contacts.0.email"]').should("have.value", "first@middle-removal.example");
		cy.get('[name="contacts.0.firstName"]').should("have.value", "First");
		cy.get('[name="contacts.1.email"]').should("have.value", "third@middle-removal.example");
		cy.get('[name="contacts.1.firstName"]').should("have.value", "Third");
		cy.get('[data-cy="client-contact-row-1"]').should("not.contain.text", "Second Contact");

		cy.continueSteppedDialog("client-dialog");
		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");

		cy.request({ url: `${api}/api/clients?page=1` })
			.its("body.clients")
			.then((clients: { id: string; name: string }[]) => {
				const created = clients.find((c) => c.name === "Middle Removal SARL");
				expect(created, "the client was created").to.exist;
				cy.request({ url: `${api}/api/clients/${(created as { id: string }).id}` })
					.its("body")
					.then((full: { contacts: { firstName: string; email: string; isPrimary: boolean }[] }) => {
						expect(
							full.contacts,
							"exactly the two surviving contacts, never the removed one",
						).to.have.length(2);
						const emails = full.contacts.map((c) => c.email).sort();
						expect(emails).to.deep.equal([
							"first@middle-removal.example",
							"third@middle-removal.example",
						]);
						// The removed contact was never primary (the FIRST one was, and stays flagged) -
						// this client's own invariant (exactly one primary once it has >= 1 contact) holds.
						const primaries = full.contacts.filter((c) => c.isPrimary);
						expect(primaries, "exactly one primary survives").to.have.length(1);
						expect(primaries[0].firstName).to.eq("First");
					});
			});
	});

	it("a quote's default recipient resolves to the PRIMARY contact, and follows the primary when it changes", () => {
		cy.request({ url: `${api}/api/clients?page=1` })
			.its("body.clients")
			.then((clients: { id: string; name: string }[]) => {
				const client = clients.find((c) => c.name === "Contacts Demo SARL");
				expect(client, "the three-contact client from the previous test exists").to.exist;
				const clientId = (client as { id: string }).id;

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clientId,
							issueDate: "2026-08-30",
							currency: "EUR",
							lines: [{ description: "Consulting", quantity: 1, unitPrice: 500 }],
						},
					},
				}).then((saved) => {
					const quoteId = saved.body?.document?.id as string;
					expect(quoteId, "quote draft created").to.be.a("string");

					cy.clearEmails();
					cy.visit("/documents/quote");
					cy.runDocumentRowAction(quoteId, "send");
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
					// NEVER typed by hand - the default the params-defaults resolver pre-fills is what
					// this assertion is actually about: Bob's address (the CURRENT primary), never
					// Alice's or Chloé's.
					cy.get('[data-cy="document-field-recipient-input"]').should(
						"have.value",
						"bob@contacts-demo.example",
					);
					cy.get('[data-cy="document-action-params-confirm"]').click();

					cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					cy.getLastEmail().then((message: { To?: { Address?: string }[] }) => {
						expect(
							message.To?.[0]?.Address,
							"the quote was mailed to the PRIMARY contact, not a secondary one",
						).to.eq("bob@contacts-demo.example");
					});
				});

				// Change the primary to Chloé through the edit dialog, through the screen.
				cy.visit("/clients");
				cy.wait(1000);
				cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', {
					timeout: 10000,
				}).type("Contacts Demo");
				cy.wait(500);
				// The row's own key is the client's PRIMARY contact email (`index.tsx`'s own `rowKey`) -
				// Bob's, since the previous test made him primary.
				cy.get('[data-cy="edit-client-button-bob@contacts-demo.example"]').click();
				cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");
				cy.continueSteppedDialog("client-dialog");
				cy.continueSteppedDialog("client-dialog");
				cy.continueSteppedDialog("client-dialog");
				cy.get('[data-cy="client-contact-primary-radio-2"]', { timeout: 10000 }).click();
				cy.get('[data-cy="client-contact-row-2"]').should("contain.text", "Primary");
				cy.continueSteppedDialog("client-dialog");
				cy.get('[data-cy="client-submit"]').click();
				cy.get('[data-cy="client-dialog"]').should("not.exist");

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clientId,
							issueDate: "2026-08-31",
							currency: "EUR",
							lines: [{ description: "Consulting round 2", quantity: 1, unitPrice: 500 }],
						},
					},
				}).then((saved2) => {
					const quoteId2 = saved2.body?.document?.id as string;
					cy.clearEmails();
					cy.visit("/documents/quote");
					cy.runDocumentRowAction(quoteId2, "send");
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="document-field-recipient-input"]').should(
						"have.value",
						"chloe@contacts-demo.example",
					);
					cy.get('[data-cy="document-action-params-confirm"]').click();
					cy.get(`[data-cy="document-list-row-${quoteId2}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					cy.getLastEmail().then((message: { To?: { Address?: string }[] }) => {
						expect(
							message.To?.[0]?.Address,
							"the NEW primary (Chloé) now receives it",
						).to.eq("chloe@contacts-demo.example");
					});
				});
			});
	});

	it("imports an OLD-template CSV (unchanged columns) into a client with one primary contact", () => {
		cy.visit("/clients");
		countClients().then((before) => {
			cy.get('[data-cy="clients-import-button"]').click();
			cy.get('[data-cy="clients-import-dialog"]', { timeout: 10000 }).should("be.visible");
			cy.get('[data-cy="clients-import-file-input"]').selectFile(
				"cypress/fixtures/clients-import/old-template.csv",
				{ force: true },
			);
			cy.get('[data-cy="clients-import-preview"]', { timeout: 15000 }).should("be.visible");
			cy.get('[data-cy="clients-import-summary-valid"]').should("contain.text", "1");
			cy.get('[data-cy="clients-import-row-2"]').should("contain.text", "Will be created");

			cy.screenshot("415-after-import-preview", { capture: "viewport" });

			cy.get('[data-cy="clients-import-confirm-button"]').click();
			cy.get('[data-cy="clients-import-result"]', { timeout: 15000 }).should("be.visible");

			countClients().then((after) => {
				expect(after, "exactly one new client was created").to.eq(before + 1);
			});

			cy.request({ url: `${api}/api/clients?page=1` })
				.its("body.clients")
				.then((clients: { name: string; id: string }[]) => {
					const created = clients.find((c) => c.name === "Old Template SARL");
					expect(created, "the OLD-template row's client exists").to.exist;
					cy.request({ url: `${api}/api/clients/${(created as { id: string }).id}` })
						.its("body")
						.then((full) => {
							expect(full.contacts, "one contact, from the four legacy columns").to.have.length(1);
							expect(full.contacts[0]).to.deep.include({
								email: "old-template@example.com",
								phone: "+33 1 98 76 54 32",
								isPrimary: true,
							});
							expect(full.contactEmail, "the derived flat field still reads back too").to.eq(
								"old-template@example.com",
							);
						});
				});
		});
	});
});
