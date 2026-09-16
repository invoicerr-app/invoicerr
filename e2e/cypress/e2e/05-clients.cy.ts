export {}; // makes this spec a module, not a global script -- see tsconfig.json

beforeEach(() => {
	cy.login();
});

/**
 * The client dialog (client-upsert.tsx) is a components/ui/stepped-dialog.tsx wizard: Identity
 * (type, name/first+last name, description, founded date, supplier) -> Address (country, street,
 * postal/city/state) -> Tax & identifiers (kind, currency, country-specific identifiers, Peppol) ->
 * Contact & portal (email, phone, language) -> Summary. Every "fills the whole form then submits" test
 * below walks that same order, `cy.continueSteppedDialog('client-dialog')` between steps (the command
 * awaits `handleContinue`'s own async `form.trigger(...)` rather than racing a bare click) — and a
 * validation test now only fills UP TO the step that owns the field under test, since an earlier
 * step's own "Continue" already blocks before a later step ever mounts.
 */
describe("Clients E2E", () => {
	describe("Create Clients", () => {
		it("creates a company client", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("ACME Corporation");
			cy.get('[name="description"]')
				.clear()
				.type("A leading technology company");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("123 Tech Boulevard");
			cy.get('[name="postalCode"]').clear().type("12345");
			cy.get('[name="city"]').clear().type("San Francisco");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("123456789");
			// The country-specific identifiers section (EIN, above) pushes this
			// select further down the scrollable dialog — scroll it into view first
			// or the opened options panel renders clipped by the dialog's overflow.
			cy.get('[data-cy="client-currency-select"] button')
				.scrollIntoView()
				.click();
			cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
			cy.get('[data-cy="client-currency-select"] input').type("Euro");
			cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("contact@acme.org");
			cy.get('[name="contactPhone"]').clear().type("+1 23 456 7890");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("ACME Corporation", { timeout: 10000 });
		});

		it("creates an individual client", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[data-cy="client-type-select"]').click();
			cy.get('[data-cy="client-type-individual"]').click();
			cy.get('[name="contactFirstname"]').clear().type("Jane");
			cy.get('[name="contactLastname"]').clear().type("Doe");
			cy.get('[name="description"]').clear().type("Freelance developer");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "United States");
			cy.get('[name="address"]').clear().type("456 Developer Lane");
			cy.get('[name="postalCode"]').clear().type("67890");
			cy.get('[name="city"]').clear().type("Los Angeles");
			cy.continueSteppedDialog("client-dialog");

			// The "Supplier" switch and currency select share the Identity/Tax steps with everything
			// else now — no more scrolling past unrelated fields to reach the currency select.
			cy.get('[data-cy="client-currency-select"] button')
				.scrollIntoView()
				.click();
			cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
			cy.get('[data-cy="client-currency-select"] input').type("Dollar");
			cy.get(
				'[data-cy="client-currency-select-option-united-states-dollar-($)"]',
			).click();
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("jane.doe@freelance.org");
			cy.get('[name="contactPhone"]').clear().type("+1 98 765 4321");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("Jane", { timeout: 10000 });
			cy.contains("Doe");
		});
	});

	describe("Validation Errors - Company", () => {
		it("shows error for empty company name", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			// "name" is validated on the Identity step's own "Continue" — no need to reach any later
			// step at all.
			cy.get('[name="name"]').clear();
			cy.get('[data-cy="client-dialog-continue"]').click();
			cy.get('[data-cy="client-dialog"]').should("be.visible");
			cy.contains(/required|requis|nom/i);
		});

		it("shows error for empty legalId (company)", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Test Company");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("123 Test St");
			cy.get('[name="postalCode"]').clear().type("12345");
			cy.get('[name="city"]').clear().type("Test City");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear();
			cy.get('[data-cy="client-dialog-continue"]').click();
			cy.get('[data-cy="client-dialog"]').should("be.visible");
			cy.contains(/required|requis|siret|legal/i);
		});
	});

	describe("Validation Errors - Individual", () => {
		it("shows error for empty firstname (individual)", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[data-cy="client-type-select"]').click();
			cy.get('[data-cy="client-type-individual"]').click();
			cy.get('[name="contactFirstname"]').clear();
			cy.get('[name="contactLastname"]').clear().type("Smith");

			cy.get('[data-cy="client-dialog-continue"]').click();
			cy.get('[data-cy="client-dialog"]').should("be.visible");
			cy.contains(/required|requis|firstname|prénom/i);
		});

		it("shows error for empty lastname (individual)", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[data-cy="client-type-select"]').click();
			cy.get('[data-cy="client-type-individual"]').click();
			cy.get('[name="contactFirstname"]').clear().type("John");
			cy.get('[name="contactLastname"]').clear();

			cy.get('[data-cy="client-dialog-continue"]').click();
			cy.get('[data-cy="client-dialog"]').should("be.visible");
			cy.contains(/required|requis|lastname|nom/i);
		});
	});

	describe("Common Validation Errors", () => {
		it("shows error for empty email", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Test Company");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("123 Test St");
			cy.get('[name="postalCode"]').clear().type("12345");
			cy.get('[name="city"]').clear().type("Test City");
			cy.continueSteppedDialog("client-dialog");

			// A VALID SIREN — this test is about the email field; the Fiscal step's own "Continue" (its
			// `fields` list includes "identifiers") would otherwise block HERE on the identifier's
			// pattern, never reaching Contact at all.
			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("123456789");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear();
			cy.get('[data-cy="client-dialog-continue"]').click();
			cy.get('[data-cy="client-dialog"]').should("be.visible");
			cy.contains(/required|requis|email/i);
		});

		it("shows error for invalid email format", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Test Company");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("123 Test St");
			cy.get('[name="postalCode"]').clear().type("12345");
			cy.get('[name="city"]').clear().type("Test City");
			cy.continueSteppedDialog("client-dialog");

			// A VALID SIREN — see the previous test's identical comment.
			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("123456789");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("not-an-email");
			cy.get('[data-cy="client-dialog-continue"]').click();
			cy.get('[data-cy="client-dialog"]').should("be.visible");
			cy.contains(/format|invalid|invalide|email/i);
		});

		it("shows error for invalid postal code format", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Test Company");
			cy.continueSteppedDialog("client-dialog");

			// "postalCode" is validated on the Address step's own "Continue" — no need to reach Tax &
			// identifiers or Contact at all.
			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("123 Test St");
			cy.get('[name="postalCode"]').clear().type("AB");
			cy.get('[name="city"]').clear().type("Test City");
			cy.get('[data-cy="client-dialog-continue"]').click();
			cy.get('[data-cy="client-dialog"]').should("be.visible");
			cy.contains(/format|invalid|invalide|postal|code/i);
		});

		// Re-scoped by the wizard split: VAT is deliberately EXEMPT from this screen's own pattern gate
		// (client-upsert.tsx's own schema comment — `tax/vat-syntax.ts` owns VAT syntax exclusively),
		// unlike LEGAL_ID just above. The single-page form's OLD version of this test asserted the
		// SAME `/format|invalid|invalide|vat|tva/i` regex right after clicking "save" while still on
		// one page carrying the static "VAT Number" field label — a label match, not a real check: the
		// backend's own `clients.service.ts#syncPartyIdentifiers` ACCEPTS a syntactically bad VAT (201,
		// `clients.vat-validation.spec.ts`'s own "never even asked of VIES" case) and persists it with
		// `validationStatus: 'INVALID'` rather than rejecting the request — there is no user-facing
		// error to find on ANY step. This asserts the real, documented behavior instead: the client
		// saves through the screen, and the persisted verdict is read back via the API.
		it("accepts an invalid VAT format at save time, but persists it as an unverified/invalid syntax verdict", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Bad VAT Syntax SARL");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("123 Test St");
			cy.get('[name="postalCode"]').clear().type("12345");
			cy.get('[name="city"]').clear().type("Test City");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("123456789");
			cy.get('[data-cy="client-identifier-VAT"]').clear().type("123456");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("bad-vat-syntax@example.com");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();
			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("Bad VAT Syntax SARL", { timeout: 10000 });

			cy.request<{ partyIdentifiers: { scheme: string; validationStatus: string | null }[] }[]>({
				url: `${Cypress.env("apiUrl") || "http://localhost:4000"}/api/clients/search?query=${encodeURIComponent("Bad VAT Syntax SARL")}`,
			})
				.its("body")
				.then((clients) => {
					const vat = clients[0].partyIdentifiers.find((i) => i.scheme === "VAT");
					expect(vat, "the VAT identifier was saved").to.exist;
					expect(
						vat?.validationStatus,
						"a syntactically-bad VAT is persisted INVALID, never silently accepted as valid",
					).to.eq("INVALID");
				});
		});
	});

	describe("Extended Address Fields", () => {
		it("creates a client with addressLine2 and state (US address)", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Tech Innovations LLC");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("456 Innovation Drive");
			cy.get('[name="addressLine2"]').clear().type("Suite 200");
			cy.get('[name="postalCode"]').clear().type("94105");
			cy.get('[name="city"]').clear().type("San Francisco");
			cy.get('[name="state"]').clear().type("CA");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("112233445");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("info@techinnovations.com");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("Tech Innovations", { timeout: 10000 });
		});

		it("verifies addressLine2 and state are displayed in client view", () => {
			cy.visit("/clients");
			cy.wait(2000);
			cy.get('[data-cy="view-client-button-info@techinnovations.com"]').click();
			cy.contains("456 Innovation Drive");
			cy.contains("Suite 200");
			cy.contains("CA");
		});

		it("creates a client with addressLine2 only (European address)", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("European Solutions GmbH");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "Germany");
			cy.get('[name="address"]').clear().type("Hauptstrasse 42");
			cy.get('[name="addressLine2"]').clear().type("3. Etage");
			cy.get('[name="postalCode"]').clear().type("10115");
			cy.get('[name="city"]').clear().type("Berlin");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("DE987654321");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("contact@eusolutions.de");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("European Solutions", { timeout: 10000 });
		});

		it("creates a client without addressLine2 and state (backward compatibility)", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Simple Company Ltd");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("10 Downing Street");
			cy.get('[name="postalCode"]').clear().type("SW1A 2AA");
			cy.get('[name="city"]').clear().type("London");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("123456789");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("info@simple.co.uk");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("Simple Company", { timeout: 10000 });
		});

		it("edits a client and adds addressLine2 and state", () => {
			cy.visit("/clients");
			cy.wait(2000);

			cy.get('[data-cy="edit-client-button-info@simple.co.uk"]').click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);
			// Editing opens every step chip already "done" (SteppedDialog's own `initialMaxReached`) —
			// jump straight to Address rather than walking Identity -> Address first.
			cy.get('[data-cy="client-dialog-step-address"]').click();
			cy.get('[name="addressLine2"]').clear().type("Building B");
			cy.get('[data-cy="client-dialog-step-recap"]').click();
			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.wait(2000);

			cy.get('[data-cy="view-client-button-info@simple.co.uk"]').click();
			cy.contains("Building B");
		});
	});

	describe("Edge Cases", () => {
		it("handles special characters in name", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("O'Reilly & Associates, Inc.");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("789 Publishing Way");
			cy.get('[name="postalCode"]').clear().type("11111");
			cy.get('[name="city"]').clear().type("New York");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("987654321");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("info@oreilly.com");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("O'Reilly", { timeout: 10000 });
		});

		it("handles unicode characters", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Société Française SAS");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("1 Rue de la Paix");
			cy.get('[name="postalCode"]').clear().type("75001");
			cy.get('[name="city"]').clear().type("Paris");
			cy.continueSteppedDialog("client-dialog");

			// SIREN is nine digits and nothing else (country-identifiers/data/fr.json, sourced to INSEE),
			// and that shape is now enforced on save. The VAT field keeps its FR-prefixed value: VAT is
			// deliberately exempt from the generic pattern check and validated by tax/vat-syntax.ts.
			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("123456789");
			cy.get('[data-cy="client-identifier-VAT"]').clear().type("FR12345678901");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("contact@societe.fr");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("Société Française", { timeout: 10000 });
		});

		// USER DECISION (2026-09-01, "SIRET vs SIREN sur la facture", now RESOLVED) —
		// `country-identifiers/data/fr.json`'s LEGAL_ID field accepts EITHER a 9-digit SIREN or a
		// 14-digit SIRET (see that file's own `notes`). Every OTHER FR fixture in this spec types a
		// 14-digit-shaped value (unaffected by the decision — both lengths pass); this is the one
		// that proves the 9-digit SIREN saves too, at the screen.
		it("accepts a bare 9-digit SIREN for a French company client (SIREN or SIRET, decision 2026-09-01)", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("SIREN Seul SARL");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("2 Rue de la Paix");
			cy.get('[name="postalCode"]').clear().type("75001");
			cy.get('[name="city"]').clear().type("Paris");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("123456789");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("contact@siren-seul.fr");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("SIREN Seul", { timeout: 10000 });
		});

		it("accepts valid EU VAT format", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("German Company GmbH");
			cy.continueSteppedDialog("client-dialog");

			cy.selectCountry("client-country-select", "Germany");
			cy.get('[name="address"]').clear().type("Hauptstrasse 1");
			cy.get('[name="postalCode"]').clear().type("10115");
			cy.get('[name="city"]').clear().type("Berlin");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
				.clear()
				.type("DE123456789");
			cy.get('[data-cy="client-identifier-VAT"]').clear().type("DE123456789");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[name="contactEmail"]').clear().type("contact@german.de");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.contains("German Company", { timeout: 10000 });
		});
	});

	// The Peppol scheme selector (`peppolSchemeId`, client-upsert.tsx, now on the Tax & identifiers
	// step). Every label asserted below is quoted VERBATIM from the Peppol v9.7 Participant Identifier
	// Schemes codelist (docs.peppol.eu/edelivery/codelists/) — see that component's own inline comments
	// for the exact source citation on each entry.
	describe("Peppol scheme selector", () => {
		it("offers the 7 EAS the 2026-09-02 B2G audit added routing rules for, but this selector never offered", () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();
			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Peppol Scheme Test SARL");
			cy.continueSteppedDialog("client-dialog");
			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("1 Rue Test");
			cy.get('[name="postalCode"]').clear().type("75001");
			cy.get('[name="city"]').clear().type("Paris");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-peppol-scheme-select"]')
				.scrollIntoView()
				.click();

			// b2g-routing/data/{ee,lt,lv,lu,cy,gr,mt}.json each cite the exact same string.
			cy.get('[data-cy="client-peppol-scheme-option-0191"]').should(
				"contain.text",
				"0191 — EE Company code",
			);
			cy.get('[data-cy="client-peppol-scheme-option-0200"]').should(
				"contain.text",
				"0200 — LT Legal entity code",
			);
			cy.get('[data-cy="client-peppol-scheme-option-0218"]').should(
				"contain.text",
				"0218 — LV Unified registration number",
			);
			cy.get('[data-cy="client-peppol-scheme-option-0240"]').should(
				"contain.text",
				"0240 — LU Register of legal persons",
			);
			// Cyprus/Greece/Malta have no dedicated business-register scheme in the codelist — only
			// their VAT scheme exists (each file's own notes).
			cy.get('[data-cy="client-peppol-scheme-option-9928"]').should(
				"contain.text",
				"9928 — CY VAT number",
			);
			cy.get('[data-cy="client-peppol-scheme-option-9933"]').should(
				"contain.text",
				"9933 — GR VAT number",
			);
			cy.get('[data-cy="client-peppol-scheme-option-9943"]').should(
				"contain.text",
				"9943 — MT VAT number",
			);
		});

		it('0106 is labelled NL KVK (was wrongly "DK CVR"), and the real Danish CVR, 0184, is now offered', () => {
			cy.visit("/clients");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 10000,
			}).click();
			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);

			cy.get('[name="name"]').clear().type("Peppol Scheme Test 2 SARL");
			cy.continueSteppedDialog("client-dialog");
			cy.selectCountry("client-country-select", "France");
			cy.get('[name="address"]').clear().type("1 Rue Test");
			cy.get('[name="postalCode"]').clear().type("75001");
			cy.get('[name="city"]').clear().type("Paris");
			cy.continueSteppedDialog("client-dialog");

			cy.get('[data-cy="client-peppol-scheme-select"]')
				.scrollIntoView()
				.click();

			// 0106 = "Vereniging van Kamers van Koophandel en Fabrieken in Nederland" (NL, the KVK)
			// in the codelist — never Danish. Re-verified live against the v9.7 codelist on
			// 2026-09-03 (see client-upsert.tsx's own comment for the full citation).
			cy.get('[data-cy="client-peppol-scheme-option-0106"]')
				.should("contain.text", "0106 — NL KVK")
				.and("not.contain.text", "DK");
			// 0184 = "The Danish Business Authority - CVR-number (DK:CVR)" — the REAL Danish CVR.
			cy.get('[data-cy="client-peppol-scheme-option-0184"]').should(
				"contain.text",
				"0184 — DK CVR",
			);
		});
	});

	describe("Search Clients", () => {
		it("searches for a client by name", () => {
			cy.visit("/clients");
			cy.wait(2000);
			cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', {
				timeout: 10000,
			}).type("ACME");
			cy.wait(500);
			cy.contains("ACME Corporation");
		});

		it("searches for a client by email", () => {
			cy.visit("/clients");
			cy.wait(2000);
			cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', {
				timeout: 10000,
			}).type("jane.doe");
			cy.wait(500);
			cy.contains("Jane");
		});
	});

	describe("View Client Details", () => {
		it("views a client details", () => {
			cy.visit("/clients");
			cy.wait(2000);
			cy.get('[data-cy="view-client-button-jane.doe@freelance.org"]').click();
			cy.contains("Jane Doe");
			cy.contains("jane.doe@freelance.org");
		});
	});

	describe("Edit Clients", () => {
		it("edits an existing client", () => {
			cy.visit("/clients");
			cy.wait(2000);

			cy.get('[data-cy="edit-client-button-jane.doe@freelance.org"]').click();

			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);
			// "description" lives on the Identity step, the wizard's own default landing step — no
			// navigation needed to reach it, even in edit mode.
			cy.get('[name="description"]').clear().type("A global technology leader");
			// Every step is already "done" in edit mode — jump straight to Summary to save.
			cy.get('[data-cy="client-dialog-step-recap"]').click();
			cy.get('[data-cy="client-submit"]').click();

			cy.get('[data-cy="client-dialog"]').should("not.exist");
			cy.wait(2000);

			cy.get('[data-cy="edit-client-button-jane.doe@freelance.org"]').click();
			cy.wait(2000);
			cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should(
				"be.visible",
			);
			cy.get('[name="description"]').should(
				"have.value",
				"A global technology leader",
			);

			// No dedicated "Cancel" button any more (SteppedDialog's own fixed footer is Back/Continue
			// only) — closing goes through the dialog's own header close button, same as every other
			// stepped-dialog.tsx wizard.
			cy.get('[data-cy="client-dialog"] [data-slot="dialog-close"]').click();
		});
	});

	describe("Delete Clients", () => {
		it("deletes a client", () => {
			cy.visit("/clients");
			cy.wait(2000);

			cy.get('[data-cy="client-row-menu-contact@german.de"]').click();
			cy.get('[data-cy="delete-client-button-contact@german.de"]').click();

			cy.get('[data-cy="confirm-delete-client-button"]', {
				timeout: 5000,
			}).should("be.visible");
			cy.get('[data-cy="confirm-delete-client-button"]').click();

			cy.wait(2000);
			cy.get('[data-cy="client-status-inactive-contact@german.de"]').should(
				"exist",
			);
		});
	});

});

/**
 * The "Supplier" role, manual toggle on THIS screen (auto-set-at-link is
 * covered end-to-end, by the screen, in 36-received-invoices.cy.ts). A SEPARATE top-level `describe`,
 * deliberately placed LAST in this file and starting with its own `cy.resetAndSeed()`: the client
 * list/filter (`clients/index.tsx`) is PAGE-SCOPED client-side filtering (10 clients
 * per page, filtered from whatever page is currently loaded — a pre-existing product limit, out of
 * scope here to fix) — every OTHER describe above this one has, between them, created
 * enough clients that which page holds any one of them is not something this spec should have to
 * predict. Resetting first (safe here ONLY because nothing else in this file runs afterwards) makes
 * "at most two clients exist, both on page 1" simply true instead of assumed.
 */
describe("Supplier role", () => {
	const api = Cypress.env("apiUrl") || "http://localhost:4000";

	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('toggling "Supplier" on at creation persists the role — visible on the list row without opening it', () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Fournisseur T5b SARL");
		cy.get('[data-cy="client-is-supplier-switch"]').scrollIntoView().click();
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "France");
		cy.get('[name="address"]').clear().type("1 Rue Fournisseur");
		cy.get('[name="postalCode"]').clear().type("75000");
		cy.get('[name="city"]').clear().type("Paris");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
			.clear()
			.type("555666777");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[name="contactEmail"]').clear().type("fournisseur-t5b@example.com");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");

		cy.get('[data-cy="client-role-supplier-fournisseur-t5b@example.com"]', {
			timeout: 10000,
		}).should("contain.text", "Supplier");

		cy.request<{ isSupplier?: boolean }[]>({
			url: `${api}/api/clients/search?query=${encodeURIComponent("Fournisseur T5b SARL")}`,
		})
			.its("body")
			.then((clients) => {
				expect(
					clients[0].isSupplier,
					"the role is really persisted, not just rendered",
				).to.eq(true);
			});
	});

	it("unchecked by default: a client created without touching the switch is NOT a supplier", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Client Ordinaire T5b SARL");
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "France");
		cy.get('[name="address"]').clear().type("2 Rue Ordinaire");
		cy.get('[name="postalCode"]').clear().type("75000");
		cy.get('[name="city"]').clear().type("Paris");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
			.clear()
			.type("112233446");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[name="contactEmail"]')
			.clear()
			.type("client-ordinaire-t5b@example.com");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");

		cy.get(
			'[data-cy="client-role-supplier-client-ordinaire-t5b@example.com"]',
		).should("not.exist");

		cy.request<{ isSupplier?: boolean }[]>({
			url: `${api}/api/clients/search?query=${encodeURIComponent("Client Ordinaire T5b SARL")}`,
		})
			.its("body")
			.then((clients) => {
				expect(
					clients[0].isSupplier,
					"the backfill decision: never a supplier unless set",
				).to.be.oneOf([false, undefined]);
			});
	});

	it('the "Suppliers" filter on the list shows only clients flagged as suppliers', () => {
		cy.visit("/clients");
		cy.get('[data-cy="clients-filter-supplier"]').click();

		cy.contains("Fournisseur T5b SARL", { timeout: 10000 });
		cy.contains("Client Ordinaire T5b SARL").should("not.exist");
	});

	// `SteppedDialog` hands its last step's "Continue" click `form.getValues()` directly, never through
	// `form.handleSubmit` (which normally runs the zodResolver and hands back SCHEMA-COERCED values) —
	// a real defect found on a SIBLING screen built the same way (numbers reached the API as strings).
	// This form has no coercing field (no `z.coerce`, no numeric input), so client-upsert.tsx's own
	// `clientSchema.safeParse(values)` at the submit boundary is a no-op here in practice — this test
	// is the regression guard for that: every genuinely TYPED field (a country string, the GOVERNMENT
	// enum, a real boolean switch) must reach the API as its own type, through BOTH create and an edit
	// round-trip, not just render correctly on screen. Placed LAST in this describe (reusing its own
	// `resetAndSeed()`, never a fresh one of its own) so the list stays at 3 clients total — the same
	// page-scoped-list reasoning this describe's own header already gives for why it resets at all.
	it("country, GOVERNMENT kind and the isSupplier boolean survive create AND an edit round-trip with their real types", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Typed Fields Co");
		cy.get('[data-cy="client-is-supplier-switch"]').click();
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "Germany");
		cy.get('[name="address"]').clear().type("Hauptstrasse 9");
		cy.get('[name="postalCode"]').clear().type("10115");
		cy.get('[name="city"]').clear().type("Berlin");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-kind-select"]').click();
		cy.get('[data-cy="client-kind-government"]').click();
		cy.continueSteppedDialog("client-dialog");

		cy.get('[name="contactEmail"]').clear().type("typed-fields@example.com");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Typed Fields Co", { timeout: 10000 });

		cy.request<{ country: string; kind: string; isSupplier: boolean }[]>({
			url: `${api}/api/clients/search?query=${encodeURIComponent("Typed Fields Co")}`,
		})
			.its("body")
			.then((clients) => {
				const c = clients[0];
				expect(c.country, "country persisted as the real string").to.eq("Germany");
				expect(c.kind, "GOVERNMENT persisted as its own enum string").to.eq("GOVERNMENT");
				expect(c.isSupplier, "isSupplier is a real boolean, never the STRING \"true\"").to.eq(true);
				expect(typeof c.isSupplier).to.eq("boolean");
			});

		// Edit round-trip: flip the switch back off — every step is already "done" in edit mode
		// (`initialMaxReached`), so jump straight to Summary instead of walking every step again.
		cy.visit("/clients");
		cy.get('[data-cy="edit-client-button-typed-fields@example.com"]', { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");
		cy.get('[data-cy="client-is-supplier-switch"]').click();
		cy.get('[data-cy="client-dialog-step-recap"]').click();
		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");

		cy.request<{ isSupplier: boolean; kind: string }[]>({
			url: `${api}/api/clients/search?query=${encodeURIComponent("Typed Fields Co")}`,
		})
			.its("body")
			.then((clients) => {
				expect(
					clients[0].isSupplier,
					"the edit round-trip keeps isSupplier a real boolean, now false",
				).to.eq(false);
				expect(clients[0].kind, "kind untouched by the edit still reads GOVERNMENT").to.eq(
					"GOVERNMENT",
				);
			});
	});
});

/**
 * Italian recipient identifiers (IT_SDI / PEC) — country-identifiers/data/it.json declared only
 * VAT/LEGAL_ID until 2026-09-13 (afc986f9): `fatturapa-provider.ts` already read `IT_SDI`/`PEC` off
 * the client to route CodiceDestinatario/FormatoTrasmissione, but this data-driven form (one
 * `<Input>` per catalog scheme, `client-identifier-${req.scheme}`) had no scheme to render, so a
 * genuinely domestic Italian B2B invoice fell through every branch to `XXXXXXX` — the placeholder
 * this same specification reserves for a recipient not resident/established/identified in Italy.
 * Proven here through the SCREEN for the collection half (the Cypress spec `fatturapa-provider.spec.ts`
 * itself cannot reach) and through a real downloaded artifact for the routing half — never the screen
 * alone as proof of what was actually served, same discipline as 30-document-xml-format.cy.ts.
 */
describe("Italian recipient identifiers (IT_SDI) — FatturaPA routing", () => {
	const api = Cypress.env("apiUrl") || "http://localhost:4000";

	before(() => {
		cy.resetAndSeed();
		cy.login();
		// resetAndSeed's baseline company sets no transport — "send" refuses at its own preflight
		// otherwise (invoice-actions.ts's `resolveInvoiceTransport`), and the invoice would never get
		// its number (BT-1) at all. Same setup as 30-document-xml-format.cy.ts's own `before()`.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
		}).then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it("entering a Codice Destinatario on an Italian B2B client's screen persists it and routes a real domestic invoice's downloaded FatturaPA XML off it — never the foreign-recipient XXXXXXX placeholder", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Ditta Italiana SdI Srl");
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "Italy");
		cy.get('[name="address"]').clear().type("Via Roma 10");
		cy.get('[name="postalCode"]').clear().type("00100");
		cy.get('[name="city"]').clear().type("Roma");
		cy.continueSteppedDialog("client-dialog");

		// The field only exists on screen because country-identifiers/data/it.json declares IT_SDI —
		// this is the exact screen that catalog change unlocks (see it.json's own top-level notes).
		// PEC (the other fallback the same specification allows) is asserted present too, for free,
		// off the same generic mechanism — no extra field-specific code anywhere in client-upsert.tsx.
		cy.get('[data-cy="client-identifier-IT_SDI"]', { timeout: 10000 })
			.should("exist")
			.clear()
			.type("ABC123X");
		cy.get('[data-cy="client-identifier-PEC"]', { timeout: 10000 }).should("exist");
		cy.openSearchSelect("client-currency-select");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
		cy.continueSteppedDialog("client-dialog");

		cy.get('[name="contactEmail"]').clear().type("fatturazione@ditta-sdi.example");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Ditta Italiana SdI Srl", { timeout: 10000 });

		cy.request<{ id: string; partyIdentifiers: { scheme: string; value: string }[] }[]>({
			url: `${api}/api/clients/search?query=${encodeURIComponent("Ditta Italiana SdI Srl")}`,
		})
			.its("body")
			.then((clients) => {
				const client = clients[0];
				const sdi = client.partyIdentifiers.find((pi) => pi.scheme === "IT_SDI");
				expect(sdi, "IT_SDI really persisted, not just rendered").to.exist;
				expect(sdi!.value).to.eq("ABC123X");

				const invoiceData = {
					client: client.id,
					// BEFORE the FR PDP channel-mandate date (2026-09-01, transports/channel-policy) —
					// same fixture date as 30-document-xml-format.cy.ts's own `createAndSendInvoice` —
					// or "send" 501s on the seller's own French seat (the seeded baseline company),
					// which has nothing to do with the ITALIAN recipient this test actually exercises.
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [
						{
							description: "Consulenza",
							quantity: 1,
							unit: "day",
							unitPrice: 500,
							// A valid vatRate CHOICE is resolved from the SELLER's own vat-rates catalog
							// (resetAndSeed's baseline company is French) — never the client's country, and
							// never a free-form value (invoice.descriptor.ts's own header). "20" is the same
							// FR rate every other spec in this suite already uses.
							vatRate: "20",
						},
					],
				};
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data: invoiceData },
				}).then((saved) => {
					expect(saved.status).to.be.oneOf([200, 201]);
					const invoiceId = saved.body?.document?.id as string;
					// "send" — the number (BT-1) only needs to be ASSIGNED, never the async email worker
					// to finish — the download-xml action never waits on it (same reasoning
					// 30-document-xml-format.cy.ts's own `createAndSendInvoice` documents). The action
					// re-validates the FULL document data, same shape as save-draft — never just `{client}`.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: invoiceId, data: invoiceData },
					}).then((sent) => {
						expect(sent.status).to.be.oneOf([200, 201]);

						cy.request({
							url: `${api}/api/documents/${invoiceId}/formats/fatturapa?typeId=invoice`,
							encoding: "binary",
						}).then((res) => {
							expect(res.status, "a real, validated FatturaPA export").to.eq(200);
							expect(res.body).to.contain(
								"<FormatoTrasmissione>FPR12</FormatoTrasmissione>",
							);
							expect(res.body).to.contain("<CodiceDestinatario>ABC123X</CodiceDestinatario>");
							expect(
								res.body,
								"a domestic recipient must never be announced to SdI as a foreign one",
							).to.not.contain("XXXXXXX");
						});
					});
				});
			});
	});
});
