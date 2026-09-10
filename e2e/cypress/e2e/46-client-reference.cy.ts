/**
 * Champ « référence client / n° de commande » (TODO_FEATURES.md rang 7, ⚡) — un champ de premier
 * ordre `clientReference` sur devis/factures, saisi à l'écran, persisté, rendu sur le PDF et la
 * liste QUAND il est renseigné, ABSENT sinon (`hideWhenEmpty`). Discipline : action par l'écran,
 * assertions relues via l'API + l'écran. Le rendu PDF exact est couvert en jest
 * (`rendering/render-html.spec.ts`, bloc hideWhenEmpty) ; ici on prouve le parcours UI + la liste.
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

describe("Référence client / n° de commande — à l'écran", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	it("une facture avec une référence client la persiste, la montre sur la liste, et la ré-affiche dans le formulaire", () => {
		const ref = "PO-2026-4242";
		createClient().then((clientId: string) => {
			createInvoice(clientId, ref).then((invoiceId) => {
				// Persisté en base, relu via l'API — jamais l'écran comme preuve de ce qui est stocké.
				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(
							doc.data.clientReference,
							"la référence est stockée dans data",
						).to.eq(ref);
					});

				// Visible sur la carte de la liste.
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, {
					timeout: 15000,
				}).should("contain.text", ref);

				// Ré-affichée dans le formulaire d'édition (le champ de premier ordre round-trip).
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

	it("une facture SANS référence n'affiche aucun libellé de référence sur sa carte (hideWhenEmpty)", () => {
		createClient().then((clientId: string) => {
			createInvoice(clientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.should("be.visible")
					.within(() => {
						// Le champ est hideWhenEmpty : ni la valeur ni le libellé "reference" n'apparaissent.
						cy.contains(/reference/i).should("not.exist");
					});
				// Le champ existe quand même dans le formulaire (toujours éditable), simplement vide.
				cy.get(`[data-cy="document-edit-button-${invoiceId}"]`).click();
				cy.get('[data-cy="document-field-clientReference-input"]', {
					timeout: 5000,
				}).should("have.value", "");
			});
		});
	});
});
