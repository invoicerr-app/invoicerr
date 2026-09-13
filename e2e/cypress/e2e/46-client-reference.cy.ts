export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * "Client reference / PO number" field (TODO_FEATURES.md rank 7, ⚡) — a first-class
 * `clientReference` field on quotes/invoices, entered on the screen, persisted, rendered on the PDF
 * and the list WHEN filled in, ABSENT otherwise (`hideWhenEmpty`). Discipline: action via the
 * screen, assertions read back via the API + the screen. The exact PDF rendering is covered in jest
 * (`rendering/render-html.spec.ts`, hideWhenEmpty block); here we prove the UI journey + the list.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Ref Client SARL",
				contactEmail: "ref-client@example.com",
				currency: "EUR",
				country: "FR",
				address: "1 Rue de la Référence",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		})
		.its("body.id");
}

function createInvoice(clientId: string, clientReference?: string) {
	const data: Record<string, unknown> = {
		client: clientId,
		issueDate: "2026-08-30",
		dueDate: "2026-09-30",
		currency: "EUR",
		lines: [
			{
				description: "Consulting",
				quantity: 1,
				unit: "day",
				unitPrice: 1000,
				vatRate: "20",
			},
		],
	};
	if (clientReference !== undefined) data.clientReference = clientReference;
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: { data },
		})
		.then((res) => {
			expect(res.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
			return res.body?.document?.id as string;
		});
}

describe("Client reference / PO number — on the screen", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	it("an invoice with a client reference persists it, shows it on the list, and redisplays it in the form", () => {
		const ref = "PO-2026-4242";
		createClient().then((clientId: string) => {
			createInvoice(clientId, ref).then((invoiceId) => {
				// Persisted in the database, read back via the API — never the screen as proof of what is stored.
				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(
							doc.data.clientReference,
							"la référence est stockée dans data",
						).to.eq(ref);
					});

				// Visible on the list card.
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, {
					timeout: 15000,
				}).should("contain.text", ref);

				// Redisplayed in the edit form (the first-class field round-trips).
				cy.get(`[data-cy="document-edit-button-${invoiceId}"]`).click();
				cy.get('[data-cy="document-edit-dialog"]', { timeout: 5000 }).should(
					"be.visible",
				);
				cy.get('[data-cy="document-field-clientReference-input"]').should(
					"have.value",
					ref,
				);
			});
		});
	});

	it("an invoice WITHOUT a reference shows no reference label on its card (hideWhenEmpty)", () => {
		createClient().then((clientId: string) => {
			createInvoice(clientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.should("be.visible")
					.within(() => {
						// The field is hideWhenEmpty: neither the value nor the "reference" label appears.
						cy.contains(/reference/i).should("not.exist");
					});
				// The field still exists in the form (always editable), simply empty.
				cy.get(`[data-cy="document-edit-button-${invoiceId}"]`).click();
				cy.get('[data-cy="document-field-clientReference-input"]', {
					timeout: 5000,
				}).should("have.value", "");
			});
		});
	});
});
