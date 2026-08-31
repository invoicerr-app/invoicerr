/**
 * LE LETTRAGE (item 8 du TODO racine) — un avoir "sent" réduit ce que doit une facture, un avoir
 * "draft" ne solde rien. Même discipline que 17/21/24 : les ACTIONS qui comptent passent par
 * l'interface (un VRAI clic sur "send" pour l'avoir), les ASSERTIONS qui comptent lisent
 * l'enregistrement via l'API, jamais une relecture du DOM comme preuve de ce qui est en base.
 *
 * La fixture (facture + avoir en brouillon référençant sa ligne) est créée via l'API — le formulaire
 * de l'avoir n'offre rien d'utile de plus à prouver par un clic pour la CRÉATION elle-même (un champ
 * référence, une sélection de ligne à cocher) ; c'est le passage draft -> sent qui est le cœur de la
 * tâche, et LUI passe par un vrai clic.
 *
 * Une facture à DEUX lignes, 120,00 € TTC au total (12000 unités mineures) :
 *  - ligne A : 60 € net + 20 % de TVA = 72 € TTC (7200 unités mineures) — celle que l'avoir corrige ;
 *  - ligne B : 40 € net + 20 % de TVA = 48 € TTC (4800 unités mineures) — payée cash.
 * Dans l'ordre :
 *  1. facture envoyée (API — son propre "send" est déjà couvert par 21/24), un paiement de 48,00 €
 *     enregistré par un VRAI clic (dialogue d'action) ;
 *  2. un avoir en BROUILLON, créé par l'API, référençant la ligne A — le solde ne bouge PAS
 *     (assertion API) : paidMinor reste à 4800, creditedMinor reste à 0 ;
 *  3. l'avoir envoyé par un VRAI clic depuis la liste des avoirs → le solde de la FACTURE baisse
 *     (4800 payé + 7200 crédité = 12000, outstandingMinor: 0, settled: true), paidMinor reste
 *     EXACTEMENT à ce qui a été payé (4800) — jamais gonflé par l'avoir ;
 *  4. à l'écran (dialogue de la facture) : les TROIS blocs (paiements, avoirs, solde) s'affichent,
 *     jamais mélangés, et le badge devient "Settled".
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const INVOICE_GROSS_MINOR = 12000; // 60+40 € net, 20 % de TVA sur chaque ligne.
const LINE_A_GROSS_MINOR = 7200; // ce que l'avoir corrige.
const PAYMENT_MINOR = 4800; // ce qui est réellement payé, sur la ligne B.

describe("Le lettrage — un avoir SENT réduit ce que doit une facture, un avoir DRAFT ne solde rien", () => {
	before(() => {
		cy.resetAndSeed();

		// "send" sur une facture a besoin d'un transport configuré (voir invoice-actions.ts) — même
		// mise en place que 21/24 pour leurs propres suites.
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

	let invoiceId: string;
	let lineARowId: string;
	let creditNoteId: string;

	it('une facture à deux lignes est envoyée, et un paiement PARTIEL (la ligne B) est enregistré par un vrai clic', () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{ description: "Ligne A", quantity: 1, unit: "unit", unitPrice: 60, vatRate: "20" },
								{ description: "Ligne B", quantity: 1, unit: "unit", unitPrice: 40, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					invoiceId = saved.body?.document?.id;
					expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: invoiceId, data: saved.body.document.data },
						failOnStatusCode: false,
					}).then((sent) => {
						expect(sent.status, "facture envoyée").to.be.oneOf([200, 201]);

						// La ligne A a reçu un $rowId stable au moment de cet enregistrement
						// (row-selection.ts's stampRowIds) — relu ici pour construire l'avoir plus bas,
						// jamais deviné.
						const lines = sent.body.document.data.lines as { $rowId: string; description: string }[];
						const lineA = lines.find((line) => line.description === "Ligne A");
						expect(lineA, "la ligne A existe et porte un $rowId").to.not.be.undefined;
						lineARowId = lineA?.$rowId as string;

						cy.visit("/documents/invoice");
						cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
						cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

						cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
						cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
						const dialog = () => cy.get('[data-cy="document-action-params-dialog"]');
						dialog()
							.find('[data-cy="document-field-amount-input"]')
							.clear({ force: true })
							.type("48", { force: true });
						cy.get('[data-cy="document-action-params-confirm"]').click();
						cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");

						cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should(
							"contain.text",
							"Partially paid",
						);

						cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
							.its("body")
							.then((body) => {
								expect(body.totals.grossMinor, "brut : 100 € net + 20 % de TVA").to.eq(
									INVOICE_GROSS_MINOR,
								);
								expect(body.settlement.paidMinor).to.eq(PAYMENT_MINOR);
								expect(body.settlement.outstandingMinor).to.eq(
									INVOICE_GROSS_MINOR - PAYMENT_MINOR,
								);
							});
					});
				});
			});
	});

	it("un avoir en BROUILLON, créé par l'API et référençant la ligne A, ne change RIEN au solde (assertion API)", () => {
		expect(invoiceId, "la facture du test précédent existe toujours").to.be.a("string");
		expect(lineARowId, "le $rowId de la ligne A a été relevé").to.be.a("string");

		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: {
				data: {
					invoice: invoiceId,
					issueDate: "2026-09-01",
					currency: "EUR",
					correctedLines: [lineARowId],
				},
			},
			failOnStatusCode: false,
		}).then((saved) => {
			expect(saved.status, "brouillon d'avoir créé").to.be.oneOf([200, 201]);
			creditNoteId = saved.body?.document?.id;
			expect(creditNoteId, "le brouillon d'avoir a un identifiant").to.be.a("string");
			expect(saved.body.document.status, "l'avoir est bien un brouillon").to.eq("draft");

			// Le solde de la FACTURE ne bouge pas tant que l'avoir reste un brouillon — c'est le
			// commentaire exact de l'ancien code (settlement.ts, avant-refonte-documents) : un
			// document que l'utilisateur n'a pas fini ne solde rien.
			cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
				.its("body")
				.then((body) => {
					expect(body.settlement.paidMinor).to.eq(PAYMENT_MINOR);
					expect(body.settlement.creditedMinor, "un avoir en brouillon ne crédite rien").to.eq(0);
					expect(body.settlement.outstandingMinor).to.eq(INVOICE_GROSS_MINOR - PAYMENT_MINOR);
					expect(body.settlement.settled).to.eq(false);
					expect(body.credits, "aucun avoir compté tant qu'il est en brouillon").to.have.length(0);
				});
		});
	});

	it('un VRAI clic sur "Send" pour l\'avoir fait baisser le solde de la facture — paidMinor JAMAIS gonflé par l\'avoir', () => {
		expect(creditNoteId, "l'avoir du test précédent existe toujours").to.be.a("string");

		cy.visit("/documents/credit-note");
		cy.get(`[data-cy="document-row-action-send-${creditNoteId}"]`, { timeout: 15000 }).click();

		// Attend que l'écran reflète la mutation (le clic ne fait que déclencher la requête —
		// `cy.request` ci-dessous est un appel Node direct, capable de dépasser en course le fetch
		// du navigateur si on ne l'attend pas d'abord) avant de relire l'API, même motif que 21's
		// propre "le statut affiché change...".
		cy.get(`[data-cy="document-list-row-${creditNoteId}"]`, { timeout: 15000 })
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Sent");

		cy.request({ url: `${api}/api/documents/${creditNoteId}?typeId=credit-note` })
			.its("body.status")
			.should("eq", "sent");

		cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
			.its("body")
			.then((body) => {
				// Les deux lignes restent SÉPARÉES — jamais fusionnées — et leur SOMME solde la facture.
				expect(body.settlement.paidMinor, "paidMinor n'a pas bougé — l'avoir n'est pas un paiement").to.eq(
					PAYMENT_MINOR,
				);
				expect(body.settlement.creditedMinor).to.eq(LINE_A_GROSS_MINOR);
				expect(body.settlement.paidMinor + body.settlement.creditedMinor).to.eq(INVOICE_GROSS_MINOR);
				expect(body.settlement.outstandingMinor).to.eq(0);
				expect(body.settlement.excessMinor, "réglée exactement, aucun excédent").to.eq(0);
				expect(body.settlement.settled).to.eq(true);

				expect(body.credits).to.have.length(1);
				expect(body.credits[0]).to.include({ id: creditNoteId, amountMinor: LINE_A_GROSS_MINOR });
				expect(body.payments).to.have.length(1);
				expect(body.payments[0]).to.include({ amountMinor: PAYMENT_MINOR });
			});
	});

	it('à l\'écran : les TROIS blocs (paiements, avoirs, solde) s\'affichent séparément, et le badge devient "Settled"', () => {
		expect(invoiceId, "la facture des tests précédents existe toujours").to.be.a("string");

		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-settlement-section"]', { timeout: 15000 })
			.scrollIntoView()
			.should("be.visible");

		// Le badge dit "Settled" dès que outstanding=0 — jamais "Paid" (rien n'a été intégralement
		// payé : une partie vient d'un avoir) — voir document-settlement.tsx.
		cy.get('[data-cy="document-settlement-badge"]').should("contain.text", "Settled");
		cy.get('[data-cy="document-settlement-outstanding"]').should("contain.text", "0.00 EUR");

		// Bloc 1 : le paiement — un seul, celui de 48,00 €.
		cy.get('[data-cy="document-settlement-payments-list"]').within(() => {
			cy.get('[data-cy^="document-settlement-payment-"]').should("have.length", 1);
		});
		cy.get('[data-cy="document-settlement-payments-list"]').should("contain.text", "48.00 EUR");

		// Bloc 2 : l'avoir — SÉPARÉ de la liste des paiements ci-dessus, jamais mélangé, avec son
		// propre identifiant (le "lien visuel" vers l'avoir) et son propre montant.
		cy.get('[data-cy="document-settlement-credits-list"]').within(() => {
			cy.get('[data-cy^="document-settlement-credit-"]').should("have.length", 1);
		});
		cy.get(`[data-cy="document-settlement-credit-${creditNoteId}"]`).should("contain.text", "72.00 EUR");
		cy.get(`[data-cy="document-settlement-credit-${creditNoteId}"]`).should("contain.text", creditNoteId);

		// Bloc 3 : le solde lui-même — paid et credited restent deux lignes distinctes.
		cy.get('[data-cy="document-settlement-paid"]').should("contain.text", "48.00 EUR");
		cy.get('[data-cy="document-settlement-credited"]').should("contain.text", "72.00 EUR");
	});
});
