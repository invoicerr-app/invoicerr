/**
 * TODO_SUITE.md P1 — les 5 fichiers country-policy sourcés (DE, IT, PL, ES, MX,
 * `backend/src/modules/documents/country-policy/data/`). Avant ce fichier, une société dont le pays
 * n'avait pas de fichier country-policy/ voyait TOUTE action document refusée (403, "no document
 * action policy is declared for..." — country-policy.ts's own DECISION 1) : la Pologne, un marché
 * primaire de ce produit, ne pouvait même pas ÉMETTRE une facture. Ce fichier prouve LE DÉBLOCAGE
 * lui-même, par l'écran, pour la Pologne (`data/pl.json`) — jamais par un simple test jest de plus, qui
 * ne peut pas prouver que le VRAI bouton "Send" marche derrière un VRAI clic contre le VRAI serveur.
 *
 * Deux angles, un seul describe :
 *  1. Le déblocage : une société polonaise, DEPUIS SA CRÉATION (jamais une bascule après coup — à la
 *     différence de `43-correction-routes.cy.ts`'s own PL cancel test, qui devait émettre sous FR
 *     PUIS basculer, faute de fichier PL à l'époque — cette contrainte n'existe plus), émet une VRAIE
 *     facture par un VRAI clic sur "Send".
 *  2. La restriction lue : `pl.json`'s own `invoice.save-draft` cite le Podręcznik KSeF verbatim
 *     ("nie jest możliwe jej edytowanie" — non éditable une fois transmise) et la porte comme
 *     `statuses: ["draft"]`. Composée par `country-policy.ts`/`documents.service.ts` avec le statut
 *     du document, cette restriction produit un 409 (jamais un 403 — voir `country-policy.ts`'s own
 *     header : l'action EST permise par ce pays en principe, seulement pas depuis ce statut, exactement
 *     ce qu'un 409 signifie déjà pour `availableWhen`), et fait disparaître le bouton "Save draft" de
 *     l'écran d'édition d'une facture déjà émise — jamais un bouton visible qui échouerait en silence.
 *     Aucune des cinq nouvelles règles de ce root TODO n'est `allowed: false` (la recherche n'a trouvé
 *     aucune interdiction nette pour les paires (type, action) couvertes — un `allowed: false` inventé
 *     serait exactement la règle fiscale inventée que ce dépôt interdit) : ce test prouve donc la
 *     restriction RÉELLEMENT sourcée (le statut), pas un `policyBlockedReason` qui n'a pas lieu d'être
 *     ici faute d'interdiction à sourcer.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClient(name: string, country: string, countryCode: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				// Une adresse simple et valide — jamais dérivée du nom (qui porte des points/espaces
				// polonais), ce qui a fait échouer une première version de ce test en délivrance réelle
				// ("send_failed", un aléa SMTP sans rapport avec ce que ce fichier country-policy/ gate).
				contactEmail: "klient.testowy@example.com",
				address: "ul. Przykładowa 1",
				postalCode: "00-001",
				city: "Warszawa",
				country,
				countryCode,
				currency: "EUR",
				isActive: true,
			},
		})
		.then((res) => {
			expect(res.status, "client polonais créé par API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "le client créé a un identifiant").to.be.a("string");
			return id;
		});
}

function invoiceData(clientId: string) {
	return {
		client: clientId,
		issueDate: "2026-09-03",
		dueDate: "2026-10-03",
		currency: "EUR",
		lines: [
			{
				description: "Usługi doradcze",
				quantity: 1,
				unit: "day",
				unitPrice: 1000,
				// Le taux normal polonais (23 %) — un choix de contenu, sans rapport avec ce que ce
				// fichier country-policy/ gate (l'ACTION, pas le taux) ; aucun catalogue vat-rates/
				// dédié à la Pologne n'existe à ce jour (seul fr.json y figure), donc ce taux n'est
				// validé contre aucune liste — un simple nombre porté par la ligne.
				vatRate: "23",
			},
		],
	};
}

function createInvoiceDraft(clientId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: { data: invoiceData(clientId) },
			failOnStatusCode: false,
		})
		.then((saved) => {
			expect(saved.status, "brouillon de facture polonaise créé par API (déjà un premier déblocage : ce POST était un 403 nommé avant ce fichier)").to.be.oneOf([200, 201]);
			const invoiceId = saved.body?.document?.id as string;
			expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");
			return invoiceId as string;
		});
}

describe("Country policy — la Pologne (root TODO P1) peut désormais émettre, et sa propre restriction sourcée bloque là où KSeF le dit", () => {
	let invoiceId: string;

	before(() => {
		cy.resetAndSeed();

		// Bascule le pays vendeur EN AMONT de toute création de document — contrairement à
		// `43-correction-routes.cy.ts`'s own PL test, qui devait émettre sous FR d'abord faute de
		// fichier country-policy/ pour la Pologne. Ce fichier PROUVE que cette contrainte a disparu.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { name: "Acme Corp", country: "Poland", countryCode: "PL", invoiceTransportId: "email" },
		}).then((res) => {
			expect(res.status, "pays vendeur réglé sur la Pologne dès la création").to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it('LE DÉBLOCAGE : une société polonaise émet une VRAIE facture par un VRAI clic sur "Send" — impossible avant ce fichier (403 sur TOUTE action)', () => {
		createClient("Klient Testowy Sp. z o.o.", "Poland", "PL").then((clientId) => {
			createInvoiceDraft(clientId).then((id) => {
				invoiceId = id;

				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
				cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

				// Le bouton "Send" est bien OFFERT à l'écran pour cette société polonaise (aucun
				// `policyBlockedReason` dessus) — la preuve la plus directe que `invoice.send` est
				// `allowed: true` dans `pl.json`, sourcé sur l'art. 106m/106na de l'ustawa o VAT.
				cy.get('[data-cy="document-action-send"]', { timeout: 15000 })
					.should("exist")
					.and("not.be.disabled")
					.click();

				// La preuve que l'envoi a réellement abouti : "record-payment" n'est offerte que sur
				// une facture "sent" (même patron que 24-document-payments.cy.ts).
				cy.get('[data-cy="document-action-record-payment"]', { timeout: 20000 }).should("exist");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, "la facture polonaise est réellement \"sent\" en base").to.eq(
							"sent",
						);
						expect(
							doc.displayNumber,
							"une facture polonaise émise porte un numéro, comme n'importe quel autre pays fondé",
						).to.be.a("string");
					});
			});
		});
	});

	it('LA RESTRICTION LUE : "invoice.save-draft" (Podręcznik KSeF, "nie jest możliwe jej edytowanie") bloque le RE-enregistrement en brouillon d\'une facture polonaise déjà émise — 409 nommé, jamais un silence, et le bouton disparaît de l\'écran', () => {
		expect(invoiceId, "la facture polonaise émise par le test précédent existe toujours").to.be.a(
			"string",
		);

		// Côté API d'abord — la preuve qui compte : un POST direct sur "save-draft" avec ce
		// `documentId` (un scripteur qui contournerait l'écran) est refusé par un 409 NOMMÉ, jamais un
		// silence ni un succès qui réécrirait discrètement une facture déjà transmise.
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				documentId: invoiceId,
				data: invoiceData("00000000-0000-0000-0000-000000000000"),
			},
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "409 — la facture émise n'est plus éditable, jamais un 200 silencieux").to.eq(
				409,
			);
			expect(
				JSON.stringify(res.body),
				"le message nomme la restriction de statut composée par country-policy (pl.json's own `statuses: [\"draft\"]`)",
			).to.match(/restricted by this company's country policy to status\(es\) draft/);
		});

		// Côté écran ensuite — la même restriction, composée dans `isActionAvailable` (types.ts), fait
		// disparaître le bouton "Save draft" plutôt que de le laisser cliquable pour échouer en
		// silence (même discipline que `policyBlockedReason` : une règle visible, jamais un piège).
		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="document-action-save-draft"]').should("not.exist");

		// Et la facture reste bien "sent", jamais rétrogradée — la preuve négative qui ferme la boucle.
		cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
			.its("body.status")
			.should("eq", "sent");
	});
});
