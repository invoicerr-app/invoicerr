/**
 * Émise, gelée, et pas encore envoyée : l'écran doit DIRE quoi faire.
 *
 * Signalé par l'utilisateur, dans ses mots : « une fois que la facture est issued je peux plus la
 * modifier... mais je peux pas non plus créer d'avoir ». Les deux moitiés sont exactes et voulues —
 * la France gèle à l'émission, et une correction référence un document que l'autre partie DÉTIENT,
 * donc elle s'ouvre après l'envoi. Ce qui n'était pas voulu, c'est le panneau MUET : deux boutons
 * absents et aucune explication. Un cul-de-sac apparent est un cul-de-sac.
 */
import { issuedInvoiceOnly, onRow } from "../support/journey";

const FR = {
	label: "Impasse FR",
	name: "France",
	iso: "FR",
	identifiers: [
		{ scheme: "LEGAL_ID", value: "73282932000074" },
		{ scheme: "VAT", value: "FR44732829320" },
	],
	clientSlug: "fr-client",
	vatRate: 20,
};

describe("Une facture émise et non envoyée ne laisse pas l'utilisateur sans issue", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("ni modification ni correction — mais l'écran explique pourquoi et quoi faire", () => {
		issuedInvoiceOnly(FR).then((id) => {
			cy.visit("/invoices");
			onRow(id as unknown as string, "invoice-name");
			cy.get('[data-cy="available-actions"]', { timeout: 20000 }).should(
				"exist",
			);

			// Les deux absences que l'utilisateur a constatées, confirmées comme voulues.
			cy.get('[data-cy="action-edit"]').should("not.exist");
			cy.get('[data-cy="action-correct"]').should("not.exist");

			// Et l'explication, qui manquait.
			cy.get('[data-cy="correction-unavailable-hint"]', {
				timeout: 10000,
			}).should("be.visible");

			// La sortie existe et elle est offerte : envoyer.
			cy.get('[data-cy="action-send"]').should("exist");
		});
	});
});
