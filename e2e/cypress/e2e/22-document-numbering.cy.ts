/**
 * La numérotation — prouvée par l'écran, pas seulement en mémoire. Même discipline que 17/21 : les
 * ACTIONS passent par l'interface (un vrai clic sur "Send"), les ASSERTIONS qui comptent lisent
 * l'enregistrement via l'API, jamais une relecture du DOM comme preuve de ce qui est en base.
 *
 * Trois faits, dans l'ordre (l'état traverse les `it` de ce fichier — `resetAndSeed` ne rejoue
 * qu'une fois, dans `before`, exactement comme 17/21 le font) :
 *  1. un devis fraîchement créé n'a AUCUN numéro — ni côté API (`number: null`), ni fabriqué à
 *     l'écran (le libellé traduit "pas encore de numéro" à la place) ;
 *  2. un vrai clic sur "Send" fait apparaître `number: 1` et un `displayNumber` conforme au format
 *     par défaut (`QUOTE-{year}-{number:4}`), et la liste l'affiche ; un second devis envoyé prend
 *     `2`, jamais `1` à nouveau ;
 *  3. re-sauvegarder le premier devis (son "save-draft" reste offert même une fois "sent" — voir
 *     quote.descriptor.ts) puis le reconsulter ne change ni son numéro ni son affichage.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// QUOTE-2026-0001 — l'année n'est jamais figée en dur ici : elle vient de la même horloge que le
// backend qui a pris le numéro, pas d'une date choisie pour le test.
const DEFAULT_QUOTE_DISPLAY_NUMBER = (n: number) =>
	new RegExp(`^QUOTE-\\d{4}-${String(n).padStart(4, "0")}$`);

describe("La numérotation des documents — jamais avant la sortie du brouillon, jamais deux fois", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	let firstQuoteId: string;
	let secondQuoteId: string;

	function createDraftQuote(): Cypress.Chainable<string> {
		return cy
			.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

				return cy
					.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/save-draft`,
						body: {
							data: {
								client: clients[0].id,
								issueDate: "2026-08-30",
								currency: "EUR",
								lines: [{ description: "Conseil", quantity: 1, unitPrice: 500 }],
							},
						},
						failOnStatusCode: false,
					})
					.then((saved) => {
						expect(saved.status, "brouillon de devis créé").to.be.oneOf([200, 201]);
						const id = saved.body?.document?.id;
						expect(id, "le brouillon a un identifiant").to.be.a("string");
						// Le brouillon n'a AUCUN numéro — jamais 0, jamais une valeur fabriquée.
						expect(saved.body?.document?.number, "un brouillon n'a pas de numéro").to.be.null;
						expect(
							saved.body?.document?.displayNumber,
							"un brouillon n'a pas de displayNumber",
						).to.be.null;
						return id as string;
					});
			});
	}

	it("un devis créé n'a PAS de numéro — ni côté API, ni fabriqué à l'écran", () => {
		createDraftQuote().then((id) => {
			firstQuoteId = id;

			cy.visit("/documents/quote");
			cy.get(`[data-cy="document-list-row-${firstQuoteId}"]`, { timeout: 15000 }).should("exist");

			// À l'écran : le libellé traduit, jamais un numéro plausible mais faux.
			cy.get(`[data-cy="document-number-${firstQuoteId}"]`).should("have.text", "Draft — no number yet");

			// À l'API, relu à nouveau (pas seulement au moment de la création) : toujours null.
			cy.request({ url: `${api}/api/documents/${firstQuoteId}?typeId=quote` })
				.its("body")
				.then((doc) => {
					expect(doc.number, "toujours pas de numéro après relecture").to.be.null;
					expect(doc.displayNumber).to.be.null;
				});
		});
	});

	it('un VRAI clic sur "Send" fait apparaître number: 1 et un displayNumber conforme au format par défaut', () => {
		expect(firstQuoteId, "le devis du test précédent existe toujours").to.be.a("string");

		cy.visit("/documents/quote");
		cy.get(`[data-cy="document-row-action-send-${firstQuoteId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-recipient-input"]').clear().type("client@example.com");
		cy.get('[data-cy="document-action-params-confirm"]').click();

		// La liste l'affiche, une fois la requête retombée...
		cy.get(`[data-cy="document-number-${firstQuoteId}"]`, { timeout: 15000 })
			.invoke("text")
			.should("match", DEFAULT_QUOTE_DISPLAY_NUMBER(1));

		// ...et c'est bien ce qui est enregistré, pas seulement ce que l'écran prétend.
		cy.request({ url: `${api}/api/documents/${firstQuoteId}?typeId=quote` })
			.its("body")
			.then((doc) => {
				expect(doc.number, "le premier devis envoyé prend le numéro 1").to.eq(1);
				expect(doc.displayNumber).to.match(DEFAULT_QUOTE_DISPLAY_NUMBER(1));
			});
	});

	it('un second devis envoyé prend le numéro 2 — jamais 1 à nouveau', () => {
		createDraftQuote().then((id) => {
			secondQuoteId = id;

			cy.visit("/documents/quote");
			cy.get(`[data-cy="document-row-action-send-${secondQuoteId}"]`, { timeout: 15000 }).click();
			cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
			cy.get('[data-cy="document-field-recipient-input"]').clear().type("second-client@example.com");
			cy.get('[data-cy="document-action-params-confirm"]').click();

			cy.get(`[data-cy="document-number-${secondQuoteId}"]`, { timeout: 15000 })
				.invoke("text")
				.should("match", DEFAULT_QUOTE_DISPLAY_NUMBER(2));

			cy.request({ url: `${api}/api/documents/${secondQuoteId}?typeId=quote` })
				.its("body")
				.then((doc) => {
					expect(doc.number, "le second devis envoyé prend le numéro 2, jamais 1 à nouveau").to.eq(2);
					expect(doc.displayNumber).to.match(DEFAULT_QUOTE_DISPLAY_NUMBER(2));
				});
		});
	});

	it("re-sauvegarder puis re-consulter le premier devis ne change ni son numéro ni son affichage", () => {
		expect(firstQuoteId, "le premier devis existe toujours").to.be.a("string");

		cy.visit("/documents/quote");
		// "save-draft" reste offert même une fois "sent" (quote.descriptor.ts : la transition part de
		// N'IMPORTE QUEL statut) — cliquer dessus directement depuis la ligne de liste, un vrai clic,
		// exactement comme 21-document-lifecycle.cy.ts le fait pour "send".
		cy.get(`[data-cy="document-row-action-save-draft-${firstQuoteId}"]`, { timeout: 15000 }).click();

		// La liste continue d'afficher le MÊME numéro, jamais un nouveau ni un vide.
		cy.get(`[data-cy="document-number-${firstQuoteId}"]`, { timeout: 15000 })
			.invoke("text")
			.should("match", DEFAULT_QUOTE_DISPLAY_NUMBER(1));

		cy.request({ url: `${api}/api/documents/${firstQuoteId}?typeId=quote` })
			.its("body")
			.then((doc) => {
				expect(doc.number, "le numéro ne change jamais une fois pris").to.eq(1);
				expect(doc.displayNumber).to.match(DEFAULT_QUOTE_DISPLAY_NUMBER(1));
			});

		// Et le second devis, lui, garde son propre numéro — la ré-écriture du premier n'a pas
		// avancé la séquence pour tout le monde.
		cy.request({ url: `${api}/api/documents/${secondQuoteId}?typeId=quote` })
			.its("body.number")
			.should("eq", 2);
	});
});
