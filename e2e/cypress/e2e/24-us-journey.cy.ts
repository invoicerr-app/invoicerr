/**
 * Le même parcours, aux États-Unis — le corps du test ne change pas d'une ligne.
 *
 * La spec 19 joue la correction en France. Celle-ci rejoue LE MÊME `issuedSentInvoice()`, avec pour
 * seule différence un objet de données : un nom de pays, des identifiants, un taux. Si le parcours
 * avait dû être réécrit ici, c'est que quelque chose, quelque part, nommerait un pays.
 *
 * Puis vient la vraie divergence, et elle est sourcée : il n'existe pas de facture fédérale
 * américaine. 26 U.S.C. § 6001 impose des REGISTRES, pas un DOCUMENT — rien n'y rend une facture
 * émise immuable, et le profil le dit en une donnée (`immutableAfter: 'NEVER'`). Un utilisateur
 * américain peut donc corriger sa facture OU la modifier ; un utilisateur français ne peut que la
 * corriger. Les deux réponses sortent du même code.
 */

import {
	draftCorrectionOf,
	eventually,
	getInvoice,
	issuedSentInvoice,
	onRow,
} from "../support/journey";
import { api } from "../support/showcase";

/** Les deux pays, en données. Aucun test ci-dessous ne les nomme dans sa logique. */
const US = {
	label: "Journey US",
	name: "United States",
	iso: "US",
	identifiers: [] as { scheme: string; value: string }[],
	clientSlug: "us-client",
	// Pas de TVA fédérale : le champ du formulaire reste à zéro. C'est une donnée du jeu d'essai,
	// pas une affirmation sur la fiscalité américaine — la taxe de vente est locale.
	vatRate: 0,
};

const FR = {
	label: "Journey FR",
	name: "France",
	iso: "FR",
	identifiers: [
		{ scheme: "LEGAL_ID", value: "73282932000074" },
		{ scheme: "VAT", value: "FR44732829320" },
	],
	clientSlug: "fr-client",
	vatRate: 20,
};

describe("Le parcours rejoué aux États-Unis", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("01 créer, émettre, envoyer — les mêmes gestes mènent au même état", () => {
		// `issuedSentInvoice` est exactement la fonction que la spec 19 utilise pour la France.
		// Qu'elle aboutisse ici sans une ligne de code spécifique EST l'assertion.
		issuedSentInvoice(US).then((id) => {
			getInvoice(id as unknown as string).then((inv) => {
				expect(inv.status, "émise par son propre bouton").to.eq("ISSUED");
				expect(
					inv.number,
					"et numérotée à l'émission, pas à la création",
				).to.not.eq(null);
			});
		});
	});

	it("02 la correction y naît brouillon, s'émet, et solde — comme en France", () => {
		issuedSentInvoice(US).then((originalId) => {
			cy.request({ url: `${api}/api/invoices/${originalId}/settlement` })
				.its("body")
				.then((before: { outstandingMinor: number }) => {
					cy.visit("/invoices");
					onRow(originalId as unknown as string, "invoice-correct-button");
					cy.get('[role="dialog"]', { timeout: 20000 }).should("be.visible");

					draftCorrectionOf(originalId as unknown as string).then((draft) => {
						expect(draft.status, "née brouillon").to.eq("DRAFT");
						expect(draft.number, "aucun compteur brûlé avant l'émission").to.eq(
							null,
						);

						cy.visit("/invoices");
						onRow(draft.id, "invoice-issue-button");
						eventually(
							draft.id,
							(r) => r.status === "ISSUED",
							"l'avoir a atteint ISSUED",
						);

						cy.request({ url: `${api}/api/invoices/${originalId}/settlement` })
							.its("body")
							.then((after: { creditedMinor: number; paidMinor: number }) => {
								expect(after.creditedMinor, "l'avoir émis compte").to.eq(
									before.outstandingMinor,
								);
								// Séparément des paiements, délibérément : un avoir n'est pas de l'argent reçu.
								expect(
									after.paidMinor,
									"et n'est pas classé en paiement",
								).to.eq(0);
							});
					});
				});
		});
	});

	it("03 aux États-Unis, la facture DÉLIVRÉE se modifie encore — et l'enregistrement change", () => {
		// `immutableAfter: 'NEVER'` dans le profil américain. Ce test ne se contente pas de voir le
		// bouton : il modifie et relit. Un contrôle affiché qui ne fait rien est précisément le
		// défaut que ce dépôt a déjà livré une fois.
		issuedSentInvoice(US).then((id) => {
			getInvoice(id as unknown as string).then((before) => {
				const lines = before.items.length;
				expect(lines, "il y a quelque chose à retirer").to.be.greaterThan(0);

				cy.visit("/invoices");
				onRow(id as unknown as string, "invoice-edit-button");
				cy.get('[data-cy="invoice-dialog"]', { timeout: 15000 }).should(
					"be.visible",
				);
				cy.get('[data-cy="remove-item-0"]').click();
				cy.get('[data-cy="invoice-submit"]').click();
				cy.get('[data-cy="invoice-dialog"]', { timeout: 15000 }).should(
					"not.exist",
				);

				eventually(
					id as unknown as string,
					(r) => r.items.length === lines - 1,
					"la modification a atteint l'enregistrement",
				);
			});
		});
	});

	it("04 en France, la même facture délivrée ne se modifie pas — et l'API le refuse aussi", () => {
		// Le contraste, et il vaut mieux que l'absence d'un bouton : un client scripté qui tenterait
		// la modification doit être refusé lui aussi, sinon la règle n'est qu'un affichage.
		issuedSentInvoice(FR).then((id) => {
			cy.visit("/invoices");
			cy.get(`[data-cy="invoice-row"][data-invoice-id="${id}"]`, {
				timeout: 20000,
			})
				.find('[data-cy="invoice-edit-button"]')
				.should("not.exist");

			getInvoice(id as unknown as string).then((inv) => {
				// Un payload VALIDE — seulement une note ajoutée. Ma première version envoyait
				// `clientId: null, items: []` et récoltait un 500 : le refus aurait alors pu venir de
				// la requête bancale, pas de la règle. Ici, seule l'immuabilité peut refuser.
				cy.request({
					method: "PATCH",
					url: `${api}/api/invoices/${id}`,
					body: { id, notes: "modification tentée par un client scripté" },
					failOnStatusCode: false,
				}).then((res) => {
					expect(
						res.status,
						`l'API refuse aussi — elle a répondu ${JSON.stringify(res.body).slice(0, 200)}`,
					).to.be.within(400, 499);
				});

				// Et rien n'a bougé : un refus qui aurait quand même écrit serait le pire des deux mondes.
				eventually(
					id as unknown as string,
					(r) => r.items.length === inv.items.length,
					"la facture française est intacte après le refus",
				);
			});
		});
	});
});
