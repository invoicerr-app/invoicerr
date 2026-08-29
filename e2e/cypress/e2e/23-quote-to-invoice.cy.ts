/**
 * Devis → facture, par l'écran — la première jambe du parcours, et la seule qu'aucun test ne
 * couvrait.
 *
 * `scenarios/full-lifecycle.cy.ts` fait ce trajet entièrement en `cy.request` : il prouve que le
 * backend sait convertir un devis, et rien de ce qu'un utilisateur peut faire. Or c'est exactement
 * ici que le produit a le plus de boutons — envoyer à la signature, signer avec un code reçu par
 * mail, choisir ce qu'on facture — et le moindre d'entre eux peut être mort sans que rien ne tombe.
 *
 * Le seul détour hors interface est la BOÎTE MAIL du client : lire son courrier n'est pas un
 * raccourci, c'est ce que fait la personne à l'autre bout.
 */

import {
	expectQuoteSigned,
	invoiceFromQuote,
	signThroughTheScreen,
} from "../support/journey";
import { api, setupCountry } from "../support/showcase";

const FR = [
	{ scheme: "LEGAL_ID", value: "73282932000074" },
	{ scheme: "VAT", value: "FR44732829320" },
];

type Quote = { id: string; items: { id: string }[]; status: string };

/** Un devis en attente de signature. Fixture : c'est la situation, pas le comportement testé. */
const aQuote = () =>
	setupCountry("Devis FR", "France", "FR", FR).then((ids) =>
		cy
			.request<Quote>({
				method: "POST",
				url: `${api}/api/quotes`,
				body: {
					clientId: ids.clientId,
					title: "Prestation de conseil",
					currency: "EUR",
					notes: "",
					discountRate: 0,
					items: [
						{
							name: "Conseil",
							description: "",
							quantity: 2,
							unitPrice: 500,
							vatRate: 20,
							type: "SERVICE",
							order: 0,
						},
					],
				},
			})
			.then((res) => {
				expect(res.status, "devis créé").to.be.oneOf([200, 201]);
				return cy.wrap(res.body);
			}),
	);

/** Le code à huit chiffres, tel qu'il arrive dans le courrier. */
describe("Du devis à la facture, sans quitter l'écran", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("01 un devis non signé n'offre PAS de le facturer", () => {
		// La règle produit, vérifiée par l'absence. Sans ce test, le suivant pourrait passer sur un
		// bouton toujours présent et on croirait avoir prouvé la signature.
		aQuote().then((quote) => {
			cy.visit("/quotes");
			cy.get('[data-cy^="send-signature-"]', { timeout: 20000 }).should(
				"exist",
			);
			cy.get(`[data-cy="create-invoice-${quote.id}"]`).should("not.exist");
		});
	});

	it("02 il part à la signature, se signe avec le code reçu, et devient SIGNED", () => {
		aQuote().then((quote) => {
			signThroughTheScreen(quote.id).then(() => {
				// Le fait enregistré, pas la phrase affichée : un écran de confirmation s'affiche
				// aussi quand le code a été refusé.
				expectQuoteSigned(quote.id);
			});
		});
	});

	it("03 une fois signé, il se facture depuis la liste et la facture porte le devis", () => {
		aQuote().then((quote) => {
			signThroughTheScreen(quote.id).then(() => {
				expectQuoteSigned(quote.id);

				cy.visit("/quotes");
				cy.get(`[data-cy="create-invoice-${quote.id}"]`, {
					timeout: 20000,
				}).click();
				// Le dialogue est celui de la facturation PARTIELLE : rien n'est présélectionné et le
				// bouton reste désactivé tant qu'aucune quantité n'est choisie. On facture les deux
				// journées du devis, comme quelqu'un qui facture tout.
				cy.get(`[data-cy="quote-invoice-quantity-${quote.items[0].id}"]`, {
					timeout: 15000,
				})
					.clear()
					.type("2");
				cy.get('[data-cy="quote-invoice-create-submit"]')
					.should("be.enabled")
					.click();

				invoiceFromQuote(quote.id).then((born) => {
					expect(born, `une facture issue du devis ${quote.id}`).to.not.eq(
						undefined,
					);
					// Brouillon, comme toute facture naissante : la conversion ne doit pas brûler un
					// numéro avant que l'utilisateur ait relu.
					expect(born?.status, "elle naît brouillon").to.eq("DRAFT");
				});
			});
		});
	});
});
