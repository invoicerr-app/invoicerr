export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #197 - address autocomplete through a self-chosen Photon server.
 *
 * `ADDRESS_AUTOCOMPLETE_URL` has to be set on the BACKEND before it boots (it is read straight from
 * `process.env`, no DB row) - this repo's shared CI stack (`.github/workflows/cypress.yml`'s
 * `cypress-run` job) sets it to `http://127.0.0.1:19876`, the fixed port the fake Photon server below
 * always binds to (see `cypress.config.ts`'s own header on that fake for why fixed, not ephemeral).
 * Running this spec against a DIFFERENT backend (a plain local `npm run start:test`) needs the same
 * variable exported before that command, or the "happy path" test below times out waiting for a
 * dropdown that a disabled instance will never show - see the second test in this file for exactly
 * that "disabled" case, proven deliberately rather than by omission.
 *
 * The dropdown is real, unstyled `data-cy` markup (`components/address-autocomplete-input.tsx`):
 *   - `<field>-suggestions` - the dropdown container, present only while open
 *   - `<field>-suggestion-<index>` - one candidate, its text the full Photon label
 */

function countryLabel(code: string): string {
	// Same call `CountrySelect` itself renders with (frontend/src/components/country-select.tsx),
	// pinned to "en" like the rest of this app's i18n in Cypress (VITE_E2E_TESTING doesn't change
	// the locale) - this is what proves the suggestion's countrycode "FR" actually reached the
	// CountrySelect field as "France", not merely as a raw code nobody could read.
	return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
}

const FRENCH_ADDRESS_SUGGESTION = {
	properties: {
		housenumber: "12",
		street: "Rue de la Paix",
		postcode: "75002",
		city: "Paris",
		country: "France",
		countrycode: "FR",
	},
};

describe("Address autocomplete (#197)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("suggests an address from the fake Photon server, fills street/postcode/city/country on pick, and the client saves with those values", () => {
		cy.task("resetFakePhotonServer");
		cy.task("startFakePhotonServer");
		cy.task("setFakePhotonSuggestions", [FRENCH_ADDRESS_SUGGESTION]);

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Autocomplete Demo SARL");
		cy.continueSteppedDialog("client-dialog");

		// Country deliberately left UNPICKED here - this is what proves the suggestion itself fills
		// it (see the assertion after the click below), rather than merely leaving an
		// already-correct value untouched.
		cy.get('[name="address"]').clear().type("12 rue de la pa");

		cy.get('[data-cy="client-address-input-suggestions"]', { timeout: 8000 }).should("be.visible");
		cy.get('[data-cy="client-address-input-suggestion-0"]')
			.should("contain.text", "12 Rue de la Paix, 75002 Paris, France")
			.click();

		cy.get('[data-cy="client-address-input-suggestions"]').should("not.exist");
		cy.get('[name="address"]').should("have.value", "12 Rue de la Paix");
		cy.get('[name="postalCode"]').should("have.value", "75002");
		cy.get('[name="city"]').should("have.value", "Paris");
		cy.get('[data-cy="client-country-select"]').should("contain.text", countryLabel("FR"));

		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("552100554");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
		cy.continueSteppedDialog("client-dialog");

		cy.get('[name="contacts.0.email"]').clear().type("contact@autocomplete-demo.example");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Autocomplete Demo SARL", { timeout: 10000 });

		// The saved record, not only the screen - proves the picked suggestion is what actually
		// reached the backend, never merely the form's own in-memory display.
		const api = Cypress.env("apiUrl");
		cy.request(`${api}/api/clients?page=1`).then((res) => {
			const client = (res.body.clients as Array<Record<string, unknown>>).find(
				(c) => c.name === "Autocomplete Demo SARL",
			);
			expect(client, "the client saved with the suggestion's fields").to.include({
				address: "12 Rue de la Paix",
				postalCode: "75002",
				city: "Paris",
				countryCode: "FR",
			});
		});

		// The real HTTP round trip actually happened - the backend's own proxy queried Photon, this
		// was never satisfied from a browser-side cache alone.
		cy.task("getFakePhotonRequests").then((requests) => {
			expect(requests as string[], "the backend proxied at least one query to Photon").to.not.be.empty;
			expect((requests as string[])[0]).to.match(/^\/api\/\?q=/);
		});
	});

	it("with the setting empty (capability disabled), no suggestion request is ever made, and free typing still works", () => {
		// The real backend under THIS spec's own stack has ADDRESS_AUTOCOMPLETE_URL configured (the
		// test above needs it) - this test instead stubs the CAPABILITY response the browser reads,
		// reproducing exactly what a self-hosted instance with the variable left unset (the honest
		// default - backend/.env.example's own header) sends: `{ enabled: false }`. The frontend's
		// own contract is to never fire a search request once that answer is in, which is the one
		// thing this test actually proves - see `use-address-autocomplete.ts`'s own header.
		cy.intercept("GET", "**/api/address-autocomplete/capability", {
			statusCode: 200,
			body: { enabled: false },
		}).as("capability");
		cy.intercept("GET", "**/api/address-autocomplete/search*").as("search");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Plain Typing SARL");
		cy.continueSteppedDialog("client-dialog");

		cy.wait("@capability");
		cy.get('[name="address"]').clear().type("12 rue de la paix, this instance never asks Photon");

		// No sleep-and-hope: this polls for up to 3s (well past the ~300ms debounce) and only passes
		// once the assertion holds for real - the standard Cypress retry-until-timeout behaviour.
		cy.get('[data-cy="client-address-input-suggestions"]', { timeout: 3000 }).should("not.exist");
		cy.get('[name="address"]').should("have.value", "12 rue de la paix, this instance never asks Photon");
		cy.get("@search.all").should("have.length", 0);
	});
});
