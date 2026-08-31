/**
 * Les PAIEMENTS — prouvés par l'écran, pas seulement en mémoire. Même discipline que 17/21/22 : les
 * ACTIONS passent par l'interface (un vrai clic sur "Send", un vrai remplissage du dialogue d'action
 * "record-payment"), les ASSERTIONS qui comptent lisent l'enregistrement via l'API, jamais une
 * relecture du DOM comme preuve de ce qui est en base.
 *
 * Un paiement n'est PAS un type de document (pas de cycle de vie, pas de brouillon) — c'est un
 * enregistrement rattaché à une facture. Le SOLDE qui en résulte est une PROJECTION affichée à
 * l'écran (badge dérivé), jamais un statut du document : la facture reste "sent" du premier au
 * dernier euro payé — voir backend/.../descriptors/invoice.descriptor.ts.
 *
 * Une facture à 120,00 € TTC (100 € net + 20 % de TVA = 20 €, soit 12000 unités mineures), dans
 * l'ordre :
 *  1. brouillon créé par l'API, envoyée par un VRAI clic (transport "email" configuré au préalable) ;
 *  2. un paiement PARTIEL de 60 € via le dialogue d'action (vrais champs) → badge "Partially paid",
 *     solde exact vérifié par l'API (calcul en dur ici, pas recopié du code) ;
 *  3. le paiement complété (60 € de plus) → badge "Settled" (renommé depuis "Paid" — item 8 du TODO
 *     racine, "le lettrage" : voir 25-document-settlement.cy.ts), `outstandingMinor: 0` ;
 *  4. un paiement dans une autre devise (USD) est refusé — visible à l'écran (message d'erreur), et
 *     sans aucun effet sur le solde déjà enregistré ;
 *  5. sur un brouillon, l'action n'est pas offerte à l'écran, et l'API la refuse aussi (409).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// 100 € net, TVA 20 % -> net 10000, TVA 2000, brut 12000 (unités mineures).
const GROSS_MINOR = 12000;

describe("Les paiements d'une facture — un enregistrement, pas un type de document", () => {
	before(() => {
		cy.resetAndSeed();

		// "send" sur une facture a besoin d'un transport configuré (voir invoice-actions.ts) — mis en
		// place une seule fois ici, comme 17/21 le font pour leurs propres suites.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	function createDraftInvoice(): Cypress.Chainable<string> {
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
								issueDate: "2026-08-30",
								dueDate: "2026-09-30",
								currency: "EUR",
								lines: [
									{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" },
								],
							},
						},
						failOnStatusCode: false,
					})
					.then((saved) => {
						expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
						const id = saved.body?.document?.id;
						expect(id, "le brouillon a un identifiant").to.be.a("string");
						return id as string;
					});
			});
	}

	let invoiceId: string;

	it('un VRAI clic sur "Send" fait passer la facture à "sent", et le solde initial est intégralement dû', () => {
		createDraftInvoice().then((id) => {
			invoiceId = id;

			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

			cy.get('[data-cy="document-action-send"]', { timeout: 15000 }).click();
			// La preuve que l'envoi a réellement abouti : "record-payment" n'est offerte que sur une
			// facture "sent" (availableWhen: ['sent']) — sa seule apparition suffit.
			cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).should("exist");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body.status")
				.should("eq", "sent");

			// Le solde, à l'écran : rien payé, jamais réglée. `scrollIntoView()` : la section vit dans le
			// dialogue scrollable (document-upsert-dialog.tsx, `overflow-y-auto`), sous la ligne de
			// flottaison tant que le dialogue n'a pas défilé — même motif que 21's transition-hint.
			cy.get('[data-cy="document-settlement-section"]', { timeout: 15000 })
				.scrollIntoView()
				.should("be.visible");
			cy.get('[data-cy="document-settlement-badge"]').should("contain.text", "Unpaid");
			cy.get('[data-cy="document-settlement-empty"]').should("exist");

			cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
				.its("body")
				.then((body) => {
					expect(body.totals.grossMinor, "brut : 100 € + 20 % de TVA").to.eq(GROSS_MINOR);
					expect(body.settlement).to.deep.equal({
						totalGrossMinor: GROSS_MINOR,
						paidMinor: 0,
						creditedMinor: 0,
						outstandingMinor: GROSS_MINOR,
						excessMinor: 0,
						settled: false,
					});
					expect(body.payments).to.have.length(0);
				});
		});
	});

	it("un paiement PARTIEL, via le dialogue d'action (vrais champs), fait apparaître le badge \"Partially paid\"", () => {
		expect(invoiceId, "la facture du test précédent existe toujours").to.be.a("string");

		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");

		// Champs SCOPÉS au dialogue d'action : la facture elle-même a AUSSI un champ "currency" (son
		// propre champ document) — `document-field-currency-input` existe donc deux fois dans le DOM en
		// même temps (le formulaire d'arrière-plan ET les params de l'action). Sans ce scope, un
		// `cy.get` global attrape le PREMIER des deux, celui du document, pas celui de l'action.
		const dialog = () => cy.get('[data-cy="document-action-params-dialog"]');

		// `currency` est pré-rempli avec celle de la facture (EUR) par le résolveur de defaults — on ne
		// le touche pas ici, exactement le comportement attendu pour un paiement ordinaire.
		dialog().find('[data-cy="document-field-amount-input"]').clear({ force: true }).type("60", { force: true });

		// `method` : un vrai SearchSelect, un vrai clic sur une vraie option.
		dialog().find('[data-cy="document-field-method-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-method-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-method-input-option-bank-transfer"]').click();

		cy.get('[data-cy="document-action-params-confirm"]').click();
		cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");

		cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should(
			"contain.text",
			"Partially paid",
		);
		cy.get('[data-cy="document-settlement-paid"]').should("contain.text", "60.00 EUR");
		cy.get('[data-cy="document-settlement-outstanding"]').should("contain.text", "60.00 EUR");

		// Le solde exact, calculé en dur ici (60 € payés sur 120 € dus), pas recopié du code back.
		cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
			.its("body")
			.then((body) => {
				expect(body.settlement).to.deep.equal({
					totalGrossMinor: GROSS_MINOR,
					paidMinor: 6000,
					creditedMinor: 0,
					outstandingMinor: 6000,
					excessMinor: 0,
					settled: false,
				});
				expect(body.payments).to.have.length(1);
				expect(body.payments[0]).to.include({ amountMinor: 6000, currency: "EUR", method: "bank_transfer" });
			});
	});

	it('compléter le paiement fait apparaître le badge "Settled" et outstandingMinor: 0', () => {
		expect(invoiceId, "la facture des tests précédents existe toujours").to.be.a("string");

		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
		// Le reliquat exact — pas un centime de plus, pour prouver un règlement EXACT, pas un
		// surpaiement (couvert séparément par les tests jest de computeSettlement).
		cy.get('[data-cy="document-action-params-dialog"]')
			.find('[data-cy="document-field-amount-input"]')
			.clear({ force: true })
			.type("60", { force: true });
		cy.get('[data-cy="document-action-params-confirm"]').click();
		cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");

		// Renamed from "Paid" — see document-settlement.tsx's own header: nothing "Paid" would be true
		// of a document settled by CREDIT instead, so the terminal badge state is named "Settled" now,
		// regardless of how the balance actually got to zero.
		cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should("contain.text", "Settled");
		cy.get('[data-cy="document-settlement-outstanding"]').should("contain.text", "0.00 EUR");

		cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
			.its("body.settlement")
			.then((settlement) => {
				expect(settlement.paidMinor).to.eq(GROSS_MINOR);
				expect(settlement.outstandingMinor).to.eq(0);
				expect(settlement.settled).to.eq(true);
			});

		// La facture reste "sent" — le solde est une PROJECTION, jamais un statut (voir invoice.descriptor.ts).
		cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
			.its("body.status")
			.should("eq", "sent");
	});

	it("un paiement dans une autre devise que celle de la facture est refusé, et l'erreur est VISIBLE à l'écran", () => {
		expect(invoiceId, "la facture des tests précédents existe toujours").to.be.a("string");

		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");

		// Scopé au dialogue — voir le commentaire du test précédent : la facture a AUSSI un champ
		// "currency" à elle, qui coexiste dans le DOM avec celui de l'action pendant que le dialogue
		// est ouvert.
		const dialog = () => cy.get('[data-cy="document-action-params-dialog"]');

		dialog().find('[data-cy="document-field-amount-input"]').clear({ force: true }).type("10", { force: true });

		// On choisit une devise DIFFÉRENTE de celle de la facture (EUR) — un vrai clic sur une vraie
		// option, exactement ce qu'un utilisateur pourrait faire par erreur.
		dialog().find('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-usd"]').first().click();

		cy.get('[data-cy="document-action-params-confirm"]').click();

		// Visible à l'écran : le message d'erreur du backend, tel quel (toast, sonner). `contain.text`
		// plutôt que `cy.contains(selector, regex)` — ce dernier échoue ici sans raison apparente (le
		// texte est pourtant bien là, confirmé par capture d'écran manuelle) ; `get` + `contain.text`
		// est le motif éprouvé ailleurs dans cette suite pour un texte dans un conteneur donné.
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should(
			"contain.text",
			"does not match this invoice's own currency",
		);

		// Refusé avant d'écrire quoi que ce soit : le solde n'a pas bougé — toujours réglée à 120 €,
		// jamais un paiement fantôme en USD.
		cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
			.its("body")
			.then((body) => {
				expect(body.settlement.paidMinor, "aucun effet du paiement refusé").to.eq(GROSS_MINOR);
				expect(body.payments, "toujours exactement les deux paiements EUR d'avant").to.have.length(2);
			});
	});

	it("l'action \"record-payment\" n'est pas offerte sur un brouillon, et l'API la refuse aussi (409)", () => {
		createDraftInvoice().then((id) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-edit-button-${id}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

			// À L'ÉCRAN : pas de bouton du tout pour une facture "draft".
			cy.get('[data-cy="document-action-record-payment"]').should("not.exist");
			cy.get('[data-cy="document-settlement-section"]').should("not.exist");

			// À L'API : un client scripté qui ignorerait l'écran se voit refusé pareil — 409.
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/record-payment`,
				body: {
					documentId: id,
					data: {},
					params: { amount: 10, currency: "EUR", paidAt: "2026-08-30" },
				},
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, `refusée — ${JSON.stringify(res.body).slice(0, 200)}`).to.eq(409);
			});
		});
	});
});
