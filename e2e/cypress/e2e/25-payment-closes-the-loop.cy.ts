/**
 * Le paiement — la dernière jambe du parcours, et la seule que rien ne prouvait.
 *
 * `08-payments.cy.ts` crée bien un paiement par l'écran, puis vérifie… que la boîte de dialogue
 * s'est fermée. Un dialogue se ferme aussi quand la requête a été refusée. Rien n'assertait que le
 * paiement avait soldé quoi que ce soit, ni que la facture avait changé d'état.
 *
 * Le second test est celui qui compte vraiment : un avoir n'est PAS un paiement. Ils soldent le
 * même montant dû et répondent à deux questions différentes — un produit qui classe un avoir en
 * paiement déclarera un jour un chiffre d'affaires qu'il n'a jamais encaissé. `settlement.ts` a été
 * écrit pour tenir cette distinction ; ici on la vérifie de bout en bout.
 */

import {
	draftCorrectionOf,
	eventually,
	getInvoice,
	issuedSentInvoice,
	onRow,
	payThroughTheScreen,
} from "../support/journey";
import { api } from "../support/showcase";

const FR = {
	label: "Paiement FR",
	name: "France",
	iso: "FR",
	identifiers: [
		{ scheme: "LEGAL_ID", value: "73282932000074" },
		{ scheme: "VAT", value: "FR44732829320" },
	],
	clientSlug: "fr-client",
	vatRate: 20,
};

type Settlement = {
	totalMinor: number;
	paidMinor: number;
	creditedMinor: number;
	outstandingMinor: number;
	settled: boolean;
};

const settlementOf = (id: string) =>
	cy
		.request<Settlement>({ url: `${api}/api/invoices/${id}/settlement` })
		.its("body");

describe("Le paiement referme la boucle", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("01 un paiement intégral solde la facture, et l'enregistrement le dit", () => {
		issuedSentInvoice(FR).then((id) => {
			getInvoice(id as unknown as string).then((inv) => {
				settlementOf(id as unknown as string).then((before) => {
					expect(before.paidMinor, "rien de payé au départ").to.eq(0);
					expect(before.outstandingMinor, "et tout est dû").to.eq(
						before.totalMinor,
					);

					payThroughTheScreen(inv.rawNumber as string, inv.totalTTC);

					// Le fait enregistré, pas la fermeture d'un dialogue.
					eventually(
						id as unknown as string,
						(r) => r.status === "PAID",
						"la facture est passée à PAID",
					);
					settlementOf(id as unknown as string).then((after) => {
						expect(after.paidMinor, "le montant encaissé").to.eq(
							before.totalMinor,
						);
						expect(after.outstandingMinor, "plus rien de dû").to.eq(0);
						expect(after.settled).to.eq(true);
					});
				});
			});
		});
	});

	it("02 un avoir n'est PAS un paiement — les deux soldent, et restent comptés séparément", () => {
		issuedSentInvoice(FR).then((id) => {
			getInvoice(id as unknown as string).then((inv) => {
				const half = Math.round(inv.totalTTC / 2);

				payThroughTheScreen(inv.rawNumber as string, half);

				settlementOf(id as unknown as string).then((afterPayment) => {
					expect(afterPayment.paidMinor, "la moitié encaissée").to.eq(
						half * 100,
					);
					expect(
						afterPayment.creditedMinor,
						"et rien d'avoir pour l'instant",
					).to.eq(0);

					// Puis l'avoir, par l'écran, sur le reste.
					cy.visit("/invoices");
					onRow(id as unknown as string, "invoice-correct-button");
					cy.get('[role="dialog"]', { timeout: 20000 }).should("be.visible");

					draftCorrectionOf(id as unknown as string).then((draft) => {
						cy.visit("/invoices");
						onRow(draft.id, "invoice-issue-button");
						eventually(
							draft.id,
							(r) => r.status === "ISSUED",
							"l'avoir est émis",
						);

						settlementOf(id as unknown as string).then((end) => {
							expect(end.creditedMinor, "l'avoir compte").to.be.greaterThan(0);
							// LE point du test : l'encaissement n'a pas bougé d'un centime.
							expect(
								end.paidMinor,
								"et l'avoir n'a PAS été classé en paiement",
							).to.eq(half * 100);
							expect(end.outstandingMinor, "plus rien de dû").to.eq(0);
							expect(end.settled).to.eq(true);
						});
					});
				});
			});
		});
	});
});
