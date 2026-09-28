export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * #478, point 1 - the legacy four-field API shape (`contactFirstname`, `contactLastname`,
 * `contactEmail`, `contactPhone`) used to clear a client's contact.
 *
 * An old-shape caller (API key, MCP tool, an integration that never adopted `contacts`) clears "the"
 * contact by sending all four fields as "". Before #478 the server merged those blanks into the
 * primary contact row and KEPT the row, every column null, so the client page showed a " - " contact
 * flagged Primary. #474's rule is that an empty contact is never stored, whatever the caller:
 * the row is now removed, and a client whose only contact that was ends up with no contact at all.
 *
 * The concurrent-save half of #478 is proven in the backend suite
 * (`clients.contacts.concurrency.spec.ts`), where two real transactions are made to overlap on
 * purpose; two `cy.request`s cannot be made to overlap deterministically from here.
 */
const api = Cypress.env("apiUrl");

describe("Legacy four-field call clearing a client's contact (#478)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1280, 720);
	});

	it("removes the primary contact instead of leaving an empty one, and the client page shows no contact", () => {
		const client = {
			type: "COMPANY",
			name: "Legacy Clear 478 SARL",
			address: "4 Rue du Contact",
			postalCode: "75004",
			city: "Paris",
			country: "France",
			countryCode: "FR",
			currency: "EUR",
			isActive: true,
		};

		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				...client,
				contacts: [{ firstName: "Lea", lastName: "Legacy", email: "lea-478@example.com", isPrimary: true }],
			},
		})
			.its("body.id")
			.then((clientId: string) => {
				// The legacy shape: no `contacts` key at all, every one of the four flat fields "".
				cy.request({
					method: "PATCH",
					url: `${api}/api/clients/${clientId}`,
					body: {
						...client,
						contactFirstname: "",
						contactLastname: "",
						contactEmail: "",
						contactPhone: "",
					},
				})
					.its("status")
					.should("eq", 200);

				// The API is the source of truth: no contact row left, and the derived flat fields
				// every legacy reader uses are null, not a primary with nothing in it.
				cy.request({ url: `${api}/api/clients/${clientId}` })
					.its("body")
					.then((body: { contacts: unknown[]; contactFirstname: string | null; contactEmail: string | null }) => {
						expect(body.contacts).to.have.length(0);
						expect(body.contactFirstname).to.equal(null);
						expect(body.contactEmail).to.equal(null);
					});
			});

		cy.visit("/clients");
		cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type(
			"Legacy Clear 478",
		);
		cy.contains("Legacy Clear 478 SARL", { timeout: 10000 }).click();

		cy.get('[data-cy="client-view-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="client-view-name"]').should("contain.text", "Legacy Clear 478 SARL");
		// The regression this guards: an empty primary row rendered as " - " with a Primary badge.
		cy.get('[data-cy="client-view-contacts"]').should("not.exist");
		cy.get('[data-cy="client-view-contact-0"]').should("not.exist");
		cy.get('[data-cy="client-view-dialog"]').should("contain.text", "No contacts");
		cy.screenshot("478-client-view-after-legacy-clear", { capture: "viewport" });
	});
});
