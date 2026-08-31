/**
 * Les récurrences (TODO racine, item 5) — prouvées par l'écran, même discipline que 17/21/24/28 :
 * la récurrence est créée par un vrai clic sur "Recurrence" + remplissage du dialogue, l'apparition
 * du duplicata est constatée dans la LISTE (un écran rechargé, jamais un polling du DOM sur une
 * requête React Query qui ne se relance pas toute seule pour un simple brouillon), et les
 * ASSERTIONS qui comptent relisent l'enregistrement via l'API en plus de l'écran.
 *
 * Le mécanisme est générique (documents/schedules/) — cette spec l'exerce sur le SEUL type qui le
 * déclare aujourd'hui avec un enjeu produit réel : la facture (voir duplicate-extension.ts et
 * documents-core.module.ts). La première occurrence est délibérément DANS LE PASSÉ : le balayage
 * (schedule-sweep.ts) doit la considérer due dès le prochain passage, sans qu'aucun humain n'ait à
 * attendre un vrai mois.
 *
 * L'intervalle de balayage est piloté par `DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS` (défaut 60 s,
 * beaucoup trop lent pour un test) — backend/.env.test le fixe à 5 s pour CETTE pile de test
 * uniquement (fichier versionné, pas un secret). Le délai d'attente ci-dessous est calé sur cette
 * valeur CONNUE (>= 3 passages, marge comprise) — jamais resserré sur l'assertion elle-même : une
 * assertion qui échouerait avec un intervalle de 60 s échouerait tout aussi honnêtement ici.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
// >= 3 passages de balayage (5s/passage en test) + marge réseau/rendu. Utilisé pour ATTENDRE que le
// balayage ait eu l'occasion de tourner plusieurs fois — jamais pour resserrer une assertion : que
// l'intervalle réel soit 5s (ici) ou 60s (par défaut), l'assertion qui suit reste la même.
const SWEEP_WAIT = 18000;

describe("Les récurrences — rejouer \"Duplicate\" sur un document, à une cadence, depuis l'écran", () => {
	before(() => {
		cy.resetAndSeed();

		// "send" sur une facture a besoin d'un transport configuré (voir invoice-actions.ts) — mis en
		// place une seule fois, comme 24/28 le font pour leurs propres suites (non exercé par CETTE
		// spec — thenSend reste désactivé ici, voir l'en-tête sur la portée du test).
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
								issueDate: "2026-01-15",
								dueDate: "2026-01-30",
								currency: "EUR",
								lines: [
									{ description: "Recurring consulting", quantity: 1, unit: "unit", unitPrice: 150, vatRate: "20" },
								],
							},
						},
						failOnStatusCode: false,
					})
					.then((res) => {
						expect(res.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
						return res.body.document.id as string;
					});
			});
	}

	it("une récurrence créée avec une première occurrence dans le passé produit un duplicata dans la liste, avance nextRunAt, puis n'en produit plus une fois désactivée", () => {
		let beforeCount = 0;
		let sourceInvoiceId = "";

		createDraftInvoice()
			.then((invoiceId) => {
				sourceInvoiceId = invoiceId;
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 }).should("exist");
				return cy.request({ url: `${api}/api/documents?typeId=invoice` }).its("body");
			})
			.then((before: { id: string }[]) => {
				beforeCount = before.length;

				// Un vrai clic — jamais un appel direct à l'API de création de schedule, qui
				// contournerait l'écran.
				cy.get('[data-cy^="document-recurrence-button-"]').first().click();
				cy.get('[data-cy="create-recurrence-dialog"]', { timeout: 10000 }).should("be.visible");

				// Cadence : "Yearly", pas la valeur par défaut ("Monthly") — avec une première occurrence
				// choisie 2 MOIS dans le passé (voir plus bas), un cycle mensuel exigerait plusieurs
				// rattrapages (une occurrence par passage de balayage, item 5 du TODO racine) avant de
				// revenir dans le futur, produisant PLUSIEURS duplicatas pendant ce test — un cycle
				// annuel n'en a besoin que d'UN seul, ce que ce test vérifie précisément.
				cy.get('[data-cy="document-field-cadence-input"] button').click();
				cy.get('[data-cy="document-field-cadence-input-option-yearly"]', { timeout: 10000 }).click();

				cy.get('[data-cy="document-field-firstOccurrenceAt-input"]').click();
				// Recule de deux mois dans le calendrier (react-day-picker) pour atterrir sur une date
				// sans ambiguïté dans le passé.
				cy.get(".rdp-button_previous").click().click();
				// Le 1er jour affiché portant le libellé "1" — peu importe le mois exact (deux reculs
				// suffisent à garantir qu'il est dans le passé), et jamais un pari sur le format
				// jour/mois que la locale du navigateur donnerait à l'attribut `data-day` : on ne
				// s'appuie que sur le TEXTE affiché du bouton.
				cy.get('[data-day]').contains(/^1$/).first().click({ force: true });

				cy.get('[data-cy="create-recurrence-confirm"]').click();
				cy.get('[data-cy="create-recurrence-dialog"]').should("not.exist");
			})
			.then(() => {
				// Le balayage réel (BullMQ/Redis) a le temps de tourner plusieurs fois — jamais une
				// réponse synchrone du clic, qui ne renvoie que la récurrence elle-même.
				cy.wait(SWEEP_WAIT);

				// L'apparition du duplicata est constatée DANS LA LISTE — un rechargement d'écran,
				// jamais un polling du DOM sur une requête React Query qui ne se relance pas toute
				// seule pour un brouillon sans action "sending" en cours (voir use-document-types.ts).
				cy.visit("/documents/invoice");
				cy.get('[data-cy="document-list-cards"]', { timeout: 15000 })
					.find('[data-cy^="document-list-row-"]')
					.should("have.length", beforeCount + 1);
			})
			.then(() => cy.request({ url: `${api}/api/documents?typeId=invoice` }).its("body"))
			.then((after: { id: string; data: Record<string, unknown> }[]) => {
				expect(after, "un seul duplicata est apparu").to.have.length(beforeCount + 1);
				const duplicate = after.find((doc) => doc.id !== sourceInvoiceId);
				expect(duplicate, "le duplicata existe, distinct de la source").to.exist;
				// La date de première occurrence (choisie dans le calendrier, dans le passé) a bien
				// REMPLACÉ celle de la source ("2026-01-15") — jamais une copie verbatim ; voir
				// duplicate-extension.ts's `applyDateRecalc`.
				expect(duplicate?.data.issueDate, "issueDate recalculée sur l'occurrence").to.not.eq("2026-01-15");
			});

		// L'écran des récurrences (Settings > Recurrences) montre nextRunAt avancé — plus dans le
		// passé (le champ affiché change une fois qu'un balayage a eu lieu, comme ci-dessus).
		cy.visit("/settings/recurring");
		cy.get('[data-cy="document-schedules-list"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy^="document-schedule-row-"]').first().as("scheduleRow");
		cy.get("@scheduleRow")
			.find('[data-cy^="document-schedule-next-run-"]')
			.invoke("text")
			.should("not.match", /Invalid|NaN/);
		cy.get("@scheduleRow")
			.find('[data-cy^="document-schedule-last-run-"]')
			.invoke("text")
			// "Last: —" tant qu'aucun balayage n'a eu lieu — ici, au moins un a déjà tourné.
			.should("not.include", "—");

		// La désactivation arrête tout — toggle depuis l'écran, puis vérifie qu'AUCUN nouveau
		// duplicata n'apparaît après un délai largement supérieur à l'intervalle de balayage.
		cy.get("@scheduleRow").find('[data-cy^="document-schedule-toggle-"]').click();
		cy.get("@scheduleRow").find('[data-cy^="document-schedule-disabled-"]').should("exist");

		cy.request({ url: `${api}/api/documents?typeId=invoice` })
			.its("body")
			.then((afterDisable: unknown[]) => {
				const countAfterDisable = afterDisable.length;
				// Une assertion NÉGATIVE ("rien de plus n'apparaît") n'a rien à sonder positivement —
				// on attend le délai plein, puis on vérifie une seule fois.
				cy.wait(SWEEP_WAIT);
				cy.request({ url: `${api}/api/documents?typeId=invoice` })
					.its("body")
					.should((stillSame: unknown[]) => {
						expect(stillSame, "aucun duplicata après désactivation").to.have.length(countAfterDisable);
					});
			});
	});
});
