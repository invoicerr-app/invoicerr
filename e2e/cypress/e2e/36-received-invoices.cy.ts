/**
 * Root TODO item 18 ("réception de factures") — prouvé PAR L'ÉCRAN, comme 17-document-descriptor.cy.ts
 * et le reste de cette suite : les ACTIONS passent par l'interface, les ASSERTIONS de contenu (le
 * fichier téléchargé est-il exactement celui uploadé ?) passent par l'API — mêmes conventions que
 * 33-signing-certificates.cy.ts (upload d'un fichier de FIXTURE réel, jamais une donnée inventée).
 *
 * Fixtures (`cypress/fixtures/received-invoices/`) — toutes générées par NOS PROPRES providers
 * (`cii-provider.ts`/`facturx-provider.ts`), jamais du XML écrit à la main :
 *  - `supplier-invoice-cii.xml` : CII EN 16931 réel et valide. Fournisseur "Fixture Fournisseur
 *    SARL", n° FIXTURE-INV-0001, date 2026-08-20, EUR, net 750.00 / TVA 150.00 / TTC 900.00.
 *  - `supplier-invoice-facturx.pdf` : Factur-X réel (le même CII, embarqué dans un vrai PDF/A-3 via
 *    `@e-invoice-eu/core`) — le calque humain du PDF est une page blanche de substitution (le rendu
 *    Puppeteer réel n'a pas sa place dans un générateur de fixture), mais le XML embarqué, lui, est
 *    100% réel et a été vérifié offline (extraction.spec.ts) avant d'être committé ici.
 *  - `supplier-invoice-plain.pdf` : un PDF réel sans aucun XML embarqué — le cas de l'artisan qui
 *    scanne une facture papier.
 *
 * Les tests s'enchaînent dans CET ORDRE, sur un seul `resetAndSeed()` (pas un par test — même
 * convention que 17/33) : chaque fixture n'est donc uploadée pour de bon qu'UNE SEULE fois avant le
 * test dédié au doublon, qui la ré-uploade délibérément en dernier.
 *
 * Régression couverte par la même passe : 11 (la sidebar/dashboard ne casse pas avec un 5e type) et
 * 17 (le descripteur "received-invoice" rend ses champs et ses actions comme n'importe quel autre —
 * ce fichier n'a besoin d'AUCUNE modification pour ça, il boucle sur `GET /api/documents/types`).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const CII_FIXTURE = "cypress/fixtures/received-invoices/supplier-invoice-cii.xml";
const FACTURX_FIXTURE = "cypress/fixtures/received-invoices/supplier-invoice-facturx.pdf";
const PLAIN_PDF_FIXTURE = "cypress/fixtures/received-invoices/supplier-invoice-plain.pdf";

interface ReceivedInvoiceInstance {
	id: string;
	status: string;
	data: Record<string, unknown>;
}

function listReceivedInvoices() {
	return cy
		.request<ReceivedInvoiceInstance[]>({ url: `${api}/api/documents?typeId=received-invoice` })
		.its("body");
}

function uploadAndOpenForm(fixturePath: string) {
	cy.get('[data-cy="received-invoice-upload-button"]').click();
	cy.get('[data-cy="received-invoice-upload-dialog"]', { timeout: 10000 }).should("be.visible");
	cy.get('[data-cy="received-invoice-upload-file-input"]').selectFile(fixturePath, { force: true });
	cy.get('[data-cy="received-invoice-upload-dialog"]').should("not.exist");
	cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("be.visible");
}

function confirmReceive() {
	cy.get('[data-cy="document-action-receive"]').click();
	cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");
	cy.get('[data-cy="document-form"]').should("not.exist");
}

describe("Réception de factures — root TODO item 18", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.visit("/documents/received-invoice");
	});

	it("upload d'un Factur-X : les champs extraits pré-remplissent le formulaire, confirmer crée un document 'received', et l'original se télécharge à l'identique", () => {
		uploadAndOpenForm(FACTURX_FIXTURE);

		cy.get('[data-cy="document-field-supplier-input"]').should(
			"have.value",
			"Fixture Fournisseur SARL",
		);
		cy.get('[data-cy="document-field-supplierNumber-input"]').should("have.value", "FIXTURE-INV-0001");
		cy.get('[data-cy="document-field-netAmount-input"]').should("have.value", "750");
		cy.get('[data-cy="document-field-vatAmount-input"]').should("have.value", "150");
		cy.get('[data-cy="document-field-grossAmount-input"]').should("have.value", "900");
		// Le sélecteur de devise affiche EUR, et le sélecteur de date n'est plus sur son placeholder —
		// tous deux prouvent le pré-remplissage sans dépendre du format exact de leur rendu interne.
		cy.get('[data-cy="document-field-currency-input"]').should("contain.text", "EUR");
		cy.get('[data-cy="document-field-issueDate-input"]').should("not.contain.text", "Pick a date");

		confirmReceive();

		// Retour à la liste, badge visible.
		cy.get('[data-cy="document-list-cards"]', { timeout: 10000 })
			.contains("Fixture Fournisseur SARL")
			.closest('[data-cy^="document-list-row-"]')
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Received");

		listReceivedInvoices().then((instances) => {
			const created = instances.find((i) => i.data.supplier === "Fixture Fournisseur SARL");
			expect(created, "le document créé est bien retrouvé par l'API").to.exist;
			expect(created?.status).to.eq("received");
			expect(created?.data.fileRef, "un fileRef a été attaché").to.be.a("string");

			// Le bouton de téléchargement existe à l'écran…
			cy.get(`[data-cy="document-custom-received-invoice-download-button-${created!.id}"]`, {
				timeout: 10000,
			}).should("be.visible");

			// … et l'API sert exactement les octets uploadés (assertion de contenu, jamais l'écran —
			// window.open() ouvre un onglet que Cypress n'observe pas).
			cy.readFile(FACTURX_FIXTURE, "binary").then((original) => {
				cy.request({
					url: `${api}/api/documents/received-invoices/${created!.id}/file`,
					encoding: "binary",
				}).then((res) => {
					expect(res.status).to.eq(200);
					expect(res.body).to.eq(original);
				});
			});
		});
	});

	it("upload d'un CII XML puis approbation par l'écran fait passer le document à 'approved'", () => {
		uploadAndOpenForm(CII_FIXTURE);
		confirmReceive();

		listReceivedInvoices().then((instances) => {
			// Le plus récent (tri par updatedAt desc — persistence.ts) est celui qu'on vient de créer.
			const created = instances[0];
			expect(created.data.supplier).to.eq("Fixture Fournisseur SARL");
			const id = created.id;

			cy.get(`[data-cy="document-row-action-approve-${id}"]`, { timeout: 10000 }).click();
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");

			cy.get(`[data-cy="document-list-row-${id}"]`)
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Approved");

			cy.request<ReceivedInvoiceInstance>({ url: `${api}/api/documents/${id}?typeId=received-invoice` })
				.its("body")
				.its("status")
				.should("eq", "approved");
		});
	});

	it("un PDF pur (sans XML embarqué) : formulaire vide mais le fichier est quand même attaché, jamais un refus", () => {
		uploadAndOpenForm(PLAIN_PDF_FIXTURE);

		cy.get('[data-cy="document-field-supplier-input"]').should("have.value", "");
		cy.get('[data-cy="document-field-supplierNumber-input"]').should("have.value", "");
		cy.get('[data-cy="document-field-netAmount-input"]').should("have.value", "");

		confirmReceive();

		listReceivedInvoices().then((instances) => {
			const created = instances[0]; // le plus récent
			expect(created.data.supplier, "aucun fournisseur extrait de ce PDF pur").to.be.oneOf([
				undefined,
				"",
			]);
			expect(created.status).to.eq("received");
			expect(created.data.fileRef, "le fichier est attaché malgré l'absence d'extraction").to.be.a(
				"string",
			);

			cy.readFile(PLAIN_PDF_FIXTURE, "binary").then((original) => {
				cy.request({
					url: `${api}/api/documents/received-invoices/${created.id}/file`,
					encoding: "binary",
				}).then((res) => {
					expect(res.status).to.eq(200);
					expect(res.body).to.eq(original);
				});
			});
		});
	});

	it("un même fichier re-uploadé (même hash — le CII XML déjà reçu ci-dessus) est refusé, nommé, comme doublon", () => {
		cy.get('[data-cy="received-invoice-upload-button"]').click();
		cy.get('[data-cy="received-invoice-upload-file-input"]').selectFile(CII_FIXTURE, { force: true });
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "duplicate");
		// Refusé au stade de l'upload : aucun formulaire de création n'apparaît.
		cy.get('[data-cy="document-form"]').should("not.exist");
	});

	it("régression 17 : 'received-invoice' apparaît dans la liste des types enregistrés", () => {
		cy.request<{ id: string; label: string }[]>({ url: `${api}/api/documents/types` })
			.its("body")
			.then((types) => {
				expect(types.map((t) => t.id)).to.include("received-invoice");
			});
	});

	it("régression 11 : le tableau de bord affiche toujours au moins une contribution, aucune non rendue", () => {
		cy.visit("/dashboard");
		cy.get('[data-cy^="widget-"]', { timeout: 20000 }).should("exist");
		cy.get('[data-cy="widget-unsupported"]').should("not.exist");
	});
});
