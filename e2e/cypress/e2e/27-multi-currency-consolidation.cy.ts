/**
 * Le multi-devises (item 9 du TODO racine) — prouvé par l'écran, pas seulement en mémoire.
 *
 * La règle qui prime, écrite pour ce fichier autant que pour le code qu'il teste : une conversion
 * est une information, jamais un remplacement. Chaque assertion qui compte ici lit soit le TAUX
 * affiché tel quel à l'écran (jamais un montant converti sans lui), soit l'ABSENCE du consolidé
 * quand une devise rencontrée n'a pas de taux — une consolidation partielle qui a l'air totale
 * serait pire que pas de consolidation du tout (voir currency-consolidation.ts, backend).
 *
 * Déroulé, dans l'ordre — chaque `it` construit sur l'état laissé par le précédent, même discipline
 * que 24-document-payments.cy.ts :
 *  1. devise de référence + un taux manuel saisis par de VRAIS champs dans les réglages société ;
 *  2. une dépense créée dans une AUTRE devise (USD) → le dashboard affiche un métrique consolidé
 *     supplémentaire, avec la mention de conversion ET le taux exact utilisé, en texte affiché ;
 *  3. une deuxième dépense dans une devise SANS taux configuré (JPY) → le consolidé disparaît
 *     entièrement, et un avertissement nommant la devise manquante apparaît à l'écran.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Multi-devises — devise de référence, taux manuels, et consolidation honnête", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("saisit la devise de référence et un taux manuel USD→EUR par de vrais champs", () => {
		cy.visit("/settings/company");
		cy.wait(3000);
		cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("be.visible");

		// La devise de référence — un champ du formulaire société existant, sauvegardé par le
		// bouton "Save" habituel. Le champ est loin dans la page (dernière carte du formulaire) —
		// scrollIntoView d'abord, même discipline que company-legalid-input dans 02-company.cy.ts.
		cy.get('[data-cy="company-reference-currency-select"]').scrollIntoView();
		cy.get('[data-cy="company-reference-currency-select"] button').first().click();
		cy.wait(300);
		cy.get('[data-cy="company-reference-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="company-reference-currency-select-option-euro-(€)"]').click();
		cy.get('[data-cy="company-submit-btn"]').scrollIntoView().click();
		cy.wait(3000);

		// Re-visite pour prouver que c'est bien enregistré côté serveur, pas seulement dans l'état
		// local du formulaire — même discipline que 02-company.cy.ts.
		cy.visit("/settings/company");
		cy.wait(3000);
		cy.get('[data-cy="company-reference-currency-select"]', { timeout: 15000 }).should(
			"contain.text",
			"Euro",
		);

		// Le taux — sa PROPRE carte, son propre bouton, jamais lié au submit du formulaire société.
		cy.get('[data-cy="currency-rate-from-select"]').scrollIntoView();
		cy.get('[data-cy="currency-rate-from-select"] button').first().click();
		cy.wait(300);
		cy.get('[data-cy="currency-rate-from-select-options"]').should("be.visible");
		cy.get('[data-cy="currency-rate-from-select-option-united-states-dollar-($)"]').click();

		cy.get('[data-cy="currency-rate-to-select"] button').first().click();
		cy.wait(300);
		cy.get('[data-cy="currency-rate-to-select-options"]').should("be.visible");
		cy.get('[data-cy="currency-rate-to-select-option-euro-(€)"]').click();

		cy.get('[data-cy="currency-rate-rate-input"]').clear().type("0.9");
		cy.get('[data-cy="currency-rate-add-btn"]').click();
		cy.wait(1000);

		// Le taux apparaît dans le tableau — la preuve qu'il a bien été enregistré, lue à l'écran.
		cy.get('[data-cy="currency-rates-table"]', { timeout: 10000 }).should("contain.text", "USD→EUR");
		cy.get('[data-cy="currency-rates-table"]').should("contain.text", "0.9");
	});

	it("une dépense dans une autre devise fait apparaître un métrique consolidé nommant le taux utilisé", () => {
		const today = new Date().toISOString().slice(0, 10);

		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/expense/actions/save-draft`,
			body: {
				data: { description: "Fournitures US", amount: 100, currency: "USD", date: today },
			},
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "dépense USD créée").to.be.oneOf([200, 201]);
		});

		cy.visit("/dashboard");

		// Le métrique par devise, INCHANGÉ — 100 USD reste 100 USD, jamais remplacé.
		cy.get('[data-cy="widget-expense:this-month:USD"]', { timeout: 20000 }).should(
			"contain.text",
			"100",
		);

		// Le consolidé, EN PLUS — 100 USD * 0,9 = 90 EUR, avec la mention de conversion et son
		// approximation (le "≈" du renderer) visibles à l'écran.
		cy.get('[data-cy="widget-expense:this-month:consolidated"]', { timeout: 20000 })
			.should("contain.text", "≈")
			.and("contain.text", "90")
			.and("contain.text", "EUR (converted)");

		// Le taux affiché exactement, texte visible — pas une valeur convertie sans sa preuve.
		cy.get('[data-cy="widget-expense:this-month:consolidated-warnings"]').should(
			"contain.text",
			`USD→EUR @ 0.9 (manual, ${today})`,
		);
	});

	it("une devise sans taux configuré fait disparaître le consolidé et se nomme dans un avertissement", () => {
		const today = new Date().toISOString().slice(0, 10);

		// Aucun taux JPY→EUR n'a jamais été saisi.
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/expense/actions/save-draft`,
			body: {
				data: { description: "Fournitures JP", amount: 500, currency: "JPY", date: today },
			},
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "dépense JPY créée").to.be.oneOf([200, 201]);
		});

		cy.visit("/dashboard");
		cy.get('[data-cy="widget-expense:this-month:JPY"]', { timeout: 20000 }).should(
			"contain.text",
			"500",
		);

		// Plus de métrique consolidé du tout — une consolidation partielle serait pire qu'aucune.
		cy.get('[data-cy="widget-expense:this-month:consolidated"]').should("not.exist");

		// L'avertissement nomme la devise manquante, visible sur les métriques ordinaires déjà
		// affichées (jamais caché : il n'y a plus de widget consolidé pour le porter).
		cy.get('[data-cy="widget-expense:this-month:JPY-warnings"]').should(
			"contain.text",
			"No JPY→EUR rate is set",
		);
		cy.get('[data-cy="widget-expense:this-month:USD-warnings"]').should(
			"contain.text",
			"No JPY→EUR rate is set",
		);
	});
});
