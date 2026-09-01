/**
 * Root TODO item 25's own reliquat : « l'i18n des libellés de descripteurs (données brutes
 * aujourd'hui) ». Le mécanisme (frontend/src/lib/descriptor-i18n.ts, branché dans
 * hooks/queries/use-document-types.ts et use-widgets.ts) fait tenter au front une clé DÉRIVÉE
 * (`documents.descriptors.<typeId>...`) avec REPLI sur le libellé brut du descripteur quand elle
 * n'existe pas — jamais l'inverse. locales/en/translation.json ne porte les clés que pour les CINQ
 * types NATIFS, et leurs valeurs EN sont le texte ACTUEL des descripteurs, mot pour mot : ce fichier
 * ne prouve donc PAS que l'écran change (il ne doit pas), mais que le mécanisme est bien celui-là,
 * pas un hasard heureux :
 *
 *  1. le type, ses champs (y compris un champ imbriqué dans un tableau 'array'), ses actions et le
 *     statut d'un brouillon s'affichent identiques à avant — la clé existe, sa valeur EN = le
 *     libellé brut ;
 *  2. le REPLI se voit pour de vrai sur un cas concret que cette app expose déjà en production : le
 *     catalogue de taux de TVA (vat-rates/, backend/src/modules/documents/company-view.ts) remplit
 *     les OPTIONS du select `vatRate` PAR COMPAGNIE, À L'EXÉCUTION, dans la langue où le catalogue du
 *     pays est écrit (le français pour FR — voir vat-rates/data/fr.json) ; aucune clé
 *     `documents.descriptors.invoice.fields.lines.fields.vatRate.options.<taux>` n'existe (et ne
 *     PEUT pas exister, le contenu dépend de la société active) — la valeur reste donc le libellé
 *     BRUT du backend, tel quel, en français, sur un écran dont la langue active est l'anglais.
 *     C'est la preuve la plus directe et la plus « vraie » de l'échappatoire "un plugin non traduit
 *     reste affiché tel quel" que cette app puisse offrir aujourd'hui : elle n'a encore aucun type de
 *     document tiers réellement enregistré pour le démontrer autrement.
 *
 * La VRAIE preuve de non-régression est la batterie complète (hors de ce fichier) : les specs
 * existantes assertent en masse sur le texte anglais actuel des descripteurs (17, 20, 21, 24, 26,
 * 28, 34, 37…) — elles doivent passer TELLES QUELLES, sans une seule assertion affaiblie, puisque les
 * valeurs EN ajoutées ici sont, mot pour mot, les libellés qu'elles attendaient déjà.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createInvoiceDraft() {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-31",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{ description: "Conseil", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				})
				.then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id as string;
					expect(id, "le brouillon a un identifiant").to.be.a("string");
					return id;
				});
		});
}

describe("Descripteurs i18n (item 25) — clé dérivée en EN, repli sur le libellé brut sinon", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("le type, ses champs (y compris imbriqués), ses actions s'affichent identiques à avant", () => {
		cy.visit("/documents/invoice");

		// La sidebar nomme le type — documents.descriptors.invoice.label existe désormais côté EN,
		// avec exactement la même valeur que le libellé brut du descripteur.
		cy.get('[data-cy="sidebar-document-type-link-invoice"]').should("contain.text", "Invoice");

		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("be.visible");

		// Le titre du dialogue interpole le label du type traduit (documents.form.newTitle, déjà
		// existant — {{label}} devient maintenant le résultat de la dérivation, pas le brut direct).
		cy.get('[data-cy="document-create-dialog"]').should("contain.text", "New: Invoice");

		// Des champs À DEUX PROFONDEURS : top-level (documents.descriptors.invoice.fields.<key>.label)
		// et une ligne du tableau "lines" (…fields.lines.fields.<key>.label) — la même dérivation
		// couvre les deux, une seule fois câblée côté hooks/queries/use-document-types.ts.
		cy.get('[data-cy="document-field-client"]').should("contain.text", "Client");
		cy.get('[data-cy="document-field-issueDate"]').should("contain.text", "Date");
		cy.get('[data-cy="document-field-dueDate"]').should("contain.text", "Due date");
		cy.get('[data-cy="document-field-currency"]').should("contain.text", "Currency");
		cy.get('[data-cy="document-field-notes"]').should("contain.text", "Notes");
		cy.get('[data-cy="document-field-lines"]').should("contain.text", "Lines");

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]')
			.should("contain.text", "Designation")
			.and("contain.text", "Quantity")
			.and("contain.text", "Unit")
			.and("contain.text", "Unit price")
			.and("contain.text", "VAT rate")
			.and("contain.text", "Discount %");

		// Les actions — documents.descriptors.invoice.actions.<id>.label, même valeur EN qu'avant.
		// "send" n'apparaît qu'une fois le document sauvegardé une première fois (son `availableWhen`
		// dérivé n'inclut jamais un enregistrement sans statut, contrairement à "save-draft", déclaré
		// `from: 'always'`) : "save-draft" seul suffit ici à prouver la dérivation sur une action.
		cy.get('[data-cy="document-action-save-draft"]').should("contain.text", "Save draft");
	});

	it("le badge de statut d'un brouillon lit le label DÉCLARÉ du descripteur, pas seulement l'id capitalisé", () => {
		// document-status-badge.tsx reçoit maintenant `label` (le statut TRADUIT que
		// useDocumentType() a déjà résolu) et ne retombe sur `capitalize(status)` que si ce statut
		// n'est pas déclaré du tout — ici "draft" EST déclaré, donc c'est bien
		// documents.descriptors.invoice.statuses.draft (= "Draft" en EN) qui s'affiche.
		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");
		});
	});

	it("REPLI : les options du taux de TVA (catalogue par société, jamais traduit ici) restent le libellé BRUT du backend — en français, sur un écran anglais", () => {
		cy.visit("/documents/invoice");
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]')
			.find('[data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });

		// Portalé hors de la ligne (Radix Popover) — interrogé directement, même technique que
		// 14-articles.cy.ts pour le picker "from catalog".
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 })
			.should("be.visible")
			// vat-rates/registry.ts compose ce libellé ({{rate}}% — {{label}}) à partir de
			// vat-rates/data/fr.json ("Taux normal") — jamais depuis ce fichier de traductions, et
			// aucune clé "…fields.vatRate.options.20" n'a été ajoutée (le contenu dépend de la
			// société active, pas d'un catalogue statique de langue). Le mécanisme tente quand même
			// la clé dérivée, ne la trouve pas, et rend ce texte tel quel.
			.should("contain.text", "20% — Taux normal");
	});
});
