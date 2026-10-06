export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * A persistent "+ Create new client" option in the document wizard's own client picker
 * (field-renderers/reference-field.tsx + reference-create-registry.ts +
 * custom/client-quick-create.tsx), opening the real client wizard (client-upsert.tsx) ON TOP of the
 * document wizard rather than replacing it — the two other reference fields this suite already
 * exercises the same generic mechanism through never offer this button (`46-client-reference.cy.ts`
 * asserts `clientReference`, a DIFFERENT field; the credit note's `invoice` reference and an
 * invoice's `origin` have no quick-create registered for their entity at all, by design — see
 * reference-create-registry.ts's own header).
 *
 * Discipline: every action through the screen, assertions read back via the API.
 */
const api = Cypress.env("apiUrl");

describe("Create client from the document wizard's own client picker", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
		cy.viewport(1440, 900);
	});

	it("creates a client from the invoice wizard's client dropdown without losing already-entered data, and selects the new client", () => {
		const clientName = "Créé Depuis Le Devis SARL";
		const clientEmail = "cree-depuis-facture@example.com";
		const notes = "Note déjà saisie avant la création du client";

		cy.intercept("POST", `${api}/api/clients`).as("createClient");
		// The client created below is also SELECTED when the nested dialog closes, and selecting one
		// makes the screen re-fetch its own descriptor with that client (`use-document-form.ts` —
		// the per-country field overlays depend on the buyer). That response rebuilds every rendered
		// field node, so it is waited on before the wizard moves to its next step rather than left to
		// land in the middle of one. Registered here, before anything can cause it.
		cy.intercept({
			method: "GET",
			url: `${api}/api/documents/types/invoice?clientId=*`,
		}).as("clientAwareDescriptor");

		cy.visit("/documents/invoice");
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("exist");

		// Data already on screen BEFORE the client is ever touched — the "Details" step's own OTHER
		// required fields, exactly what a create-a-client-mid-form detour must never lose.
		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.pickToday('[data-cy="document-field-dueDate-input"]');
		cy.openSearchSelect("document-field-currency-input");
		cy.get('[data-cy="document-field-currency-input-option-eur"]').click();

		cy.get('[data-cy="document-field-issueDate-input"]').invoke("text").as("issueDateBefore");
		cy.get('[data-cy="document-field-dueDate-input"]').invoke("text").as("dueDateBefore");

		// The dropdown itself — the footer option is visible even though the seeded baseline
		// company already has ONE client ("Test Client"), i.e. this is never a "no results" fallback.
		cy.openSearchSelect("document-field-client-input");
		cy.get('[data-cy="document-field-client-input-option-test-client"]', { timeout: 10000 }).should(
			"exist",
		);
		cy.get('[data-cy="document-field-client-input-create-new"]')
			.should("be.visible")
			.and("contain.text", "Create new Client");

		cy.screenshot("create-client/dropdown-desktop");

		cy.get('[data-cy="document-field-client-input-create-new"]').click();

		// The picker's own popover closed…
		cy.get('[data-cy="document-field-client-input-options"]').should("not.exist");
		// …the quick client form opened ON TOP of it…
		cy.get('[data-cy="client-quick-dialog"]', { timeout: 5000 }).should("be.visible");
		// …and the document wizard underneath is still there, untouched, never closed or reset.
		cy.get('[data-cy="document-create-dialog"]').should("exist");

		cy.screenshot("create-client/quick-dialog-desktop");

		// The quick form hands over to the full wizard on request.
		cy.get('[data-cy="client-quick-open-full"]').click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");
		cy.get('[data-cy="client-quick-dialog"]').should("not.exist");

		cy.screenshot("create-client/nested-dialog-desktop");

		cy.get('[name="name"]').clear().type(clientName);
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "France");
		cy.get('[name="address"]').clear().type("1 Rue Créée Depuis Le Devis");
		cy.get('[name="postalCode"]').clear().type("75001");
		cy.get('[name="city"]').clear().type("Paris");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("123456789");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[name="contacts.0.email"]').clear().type(clientEmail);
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-submit"]').click();
		cy.wait("@createClient").then((interception) => {
			expect(interception.response?.statusCode, "the client is really created").to.be.oneOf([
				200, 201,
			]);
			const createdClientId = interception.response?.body?.id as string;
			expect(createdClientId, "a client id comes back").to.be.a("string");
			cy.wrap(createdClientId).as("createdClientId");
		});

		// The nested dialog closes…
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		// …the document wizard is still open, still on the SAME "Details" step (never reset to step
		// 1, never closed)…
		cy.get('[data-cy="document-create-dialog"]').should("be.visible");
		cy.get('[data-cy="document-create-dialog-step-body-details"]').should("exist");
		// …focus lands back on the client picker's own trigger — not lost between the two stacked
		// Radix dialogs (reference-field.tsx's own `onOpenChange` handler).
		cy.get('[data-cy="document-field-client-input"] button').should("be.focused");

		// …and the OTHER fields already filled before the client was ever touched are untouched.
		cy.get("@issueDateBefore").then((before) => {
			cy.get('[data-cy="document-field-issueDate-input"]').should("have.text", before);
		});
		cy.get("@dueDateBefore").then((before) => {
			cy.get('[data-cy="document-field-dueDate-input"]').should("have.text", before);
		});
		cy.get('[data-cy="document-field-currency-input"]').should("contain.text", "EUR");

		// The newly created client is the one now SELECTED — not merely created and left unpicked.
		cy.get('[data-cy="document-field-client-input"] button', { timeout: 10000 }).should(
			"contain.text",
			clientName,
		);
		// The trigger carrying the name proves the FORM took the value; it says nothing about the
		// descriptor refetch that value set off (see this test's own intercept above). Waited on here
		// so the field rebuild it causes lands now, and not under the "Lines" step below.
		cy.wait("@clientAwareDescriptor", { timeout: 20000 });

		cy.continueDocumentWizard(); // Details -> Lines
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('[name="lines.0.description"]').clear().type("Prestation de conseil");
		cy.get('[name="lines.0.unit"]').clear().type("day");
		cy.get('[name="lines.0.quantity"]').clear().type("1");
		cy.get('[name="lines.0.unitPrice"]').clear().type("500");
		cy.openSearchSelect("document-field-vatRate-input");
		cy.get('[data-cy="document-field-vatRate-input-options"] button').first().click();

		cy.continueDocumentWizard(); // Lines -> Options
		cy.get('[data-cy="document-field-notes-input"]').clear().type(notes);

		cy.continueDocumentWizard(); // Options -> Summary
		cy.get('[data-cy="document-create-recap-client"]').should("contain.text", clientName);

		cy.get('[data-cy="document-action-save-draft"]').should("be.visible").click();
		cy.get('[data-cy="document-detail-page"]', { timeout: 15000 }).should("be.visible");

		// The screen proved the journey; the API proves what was actually PERSISTED — never the
		// screen alone (this file's own header discipline).
		cy.url().then((url) => {
			const invoiceId = url.split("/").pop() as string;
			cy.get("@createdClientId").then((createdClientId) => {
				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.data.client, "the invoice's own client is the one created from the dropdown").to.eq(
							createdClientId,
						);
						expect(doc.data.notes, "the note typed before the client existed was never lost").to.eq(
							notes,
						);
					});
			});
		});
	});
});

const QUICK_CLIENT_NAME = "Name Only SARL";

/** Shared by the two tests below: the second one completes the client the first one created. */
let quickClientId = "";

/** Opens the "Create new client" quick form from a fresh document wizard of `typeId`. */
function openQuickClientForm(typeId: "quote" | "invoice") {
	cy.visit(`/documents/${typeId}`);
	cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
	cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("exist");
	cy.openSearchSelect("document-field-client-input");
	cy.get('[data-cy="document-field-client-input-create-new"]').click();
	cy.get('[data-cy="client-quick-dialog"]', { timeout: 5000 }).should("be.visible");
}

function clientById(id: string) {
	return cy.request({ url: `${api}/api/clients/${id}` }).its("body");
}

describe("Quick client creation from a quote, completion required before an invoice is validated", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
		cy.viewport(1440, 900);
	});

	it("creates a client from a name alone on a quote: the company country is prefilled, the client is selected at once and the quote saves", () => {
		cy.intercept("POST", `${api}/api/clients`).as("createClient");
		cy.intercept({ method: "GET", url: `${api}/api/documents/types/quote?clientId=*` }).as(
			"clientAwareDescriptor",
		);

		openQuickClientForm("quote");
		cy.get('[data-cy="client-country-select"]').should("contain.text", "France");
		cy.screenshot("create-client/quick-form-desktop");

		cy.get('[name="name"]').type(QUICK_CLIENT_NAME);
		cy.get('[data-cy="client-quick-submit"]').click();
		cy.wait("@createClient").then((interception) => {
			expect(interception.response?.statusCode).to.be.oneOf([200, 201]);
			quickClientId = interception.response?.body?.id as string;
		});

		cy.get('[data-cy="client-quick-dialog"]').should("not.exist");
		cy.get('[data-cy="document-field-client-input"] button', { timeout: 10000 }).should(
			"contain.text",
			QUICK_CLIENT_NAME,
		);
		cy.wait("@clientAwareDescriptor", { timeout: 20000 });

		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.openSearchSelect("document-field-currency-input");
		cy.get('[data-cy="document-field-currency-input-option-eur"]').click();
		cy.continueDocumentWizard();
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[name="lines.0.description"]').type("Prestation de conseil");
		cy.get('[name="lines.0.quantity"]').clear().type("1");
		cy.get('[name="lines.0.unitPrice"]').clear().type("500");
		cy.openSearchSelect("document-field-vatRate-input");
		cy.get('[data-cy="document-field-vatRate-input-options"] button').first().click();
		cy.continueDocumentWizard();
		cy.continueDocumentWizard();
		cy.get('[data-cy="document-action-save-draft"]').should("be.visible").click();
		cy.get('[data-cy="document-detail-page"]', { timeout: 15000 }).should("be.visible");

		cy.url().then((url) => {
			const quoteId = url.split("/").pop() as string;
			cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
				.its("body.data.client")
				.should("eq", quickClientId);
			clientById(quickClientId).then((client) => {
				expect(client.name).to.eq(QUICK_CLIENT_NAME);
				expect(client.address, "no address was asked for").to.be.null;
				expect(client.city).to.be.null;
			});
		});
	});

	it("refuses to Validate an invoice for that client, naming what is missing, then validates once the client is completed", () => {
		cy.intercept("PATCH", `${api}/api/clients/*`).as("updateClient");
		cy.intercept("POST", `${api}/api/documents/types/invoice/actions/validate`).as("validateInvoice");

		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				data: {
					client: quickClientId,
					issueDate: "2026-08-30",
					dueDate: "2026-10-31",
					currency: "EUR",
					lines: [{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
				},
			},
		}).then((saved) => {
			const invoiceId = saved.body.document.id as string;
			cy.visit("/documents/invoice");
			cy.openDocument(invoiceId);

			cy.runDocumentAction("validate");
			cy.wait("@validateInvoice").its("response.statusCode").should("eq", 400);
			cy.get("[data-sonner-toast]", { timeout: 15000 })
				.should("contain.text", QUICK_CLIENT_NAME)
				.and("contain.text", "SIREN / SIRET")
				.and("contain.text", "the address");
			cy.screenshot("create-client/validate-refused-desktop");
			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body.status")
				.should("eq", "draft");

			cy.get("[data-sonner-toast]").contains("button", "Edit client").click();
			cy.get('[data-cy="client-dialog"]', { timeout: 15000 }).should("be.visible");
			cy.get('[data-cy="client-dialog-step-address"]').click();
			cy.get('[name="address"]').type("2 Rue Complète");
			cy.get('[name="postalCode"]').type("75002");
			cy.get('[name="city"]').type("Paris");
			cy.get('[data-cy="client-dialog-step-fiscal"]').click();
			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).type("732829320");
			cy.get('[data-cy="client-dialog-step-recap"]').click();
			cy.get('[data-cy="client-submit"]').click();
			cy.wait("@updateClient").its("response.statusCode").should("be.oneOf", [200, 201]);
			clientById(quickClientId).then((client) => {
				expect(client.name, "completing never loses what was already there").to.eq(QUICK_CLIENT_NAME);
				expect(client.address).to.eq("2 Rue Complète");
			});

			cy.visit("/documents/invoice");
			cy.openDocument(invoiceId);
			cy.runDocumentAction("validate");
			cy.wait("@validateInvoice").its("response.statusCode").should("be.oneOf", [200, 201]);
			cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should("contain.text", "Validated");
		});
	});
});
