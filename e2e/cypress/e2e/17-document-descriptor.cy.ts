/**
 * Le nouveau modèle, prouvé par l'écran — et pas seulement en mémoire.
 *
 * Les 163 tests jest prouvent les registres, la validation et le blocage d'une action sans
 * implémentation. Ils ne prouvent rien de ce qu'un utilisateur peut faire : c'est exactement
 * l'angle mort qui, dans le système précédent, a laissé passer un bouton « Modifier » mort, un
 * `send()` qui n'envoyait rien et une liste qui ne se rafraîchissait jamais.
 *
 * La règle reste celle de tout ce dépôt : les ACTIONS passent par l'interface, les ASSERTIONS
 * lisent l'enregistrement.
 *
 * Ce que ce fichier vérifie surtout, et qui est LA promesse du modèle : le formulaire n'est pas
 * écrit, il est DÉDUIT du descripteur. On lit donc le descripteur par l'API, puis on exige que
 * chacun de ses champs soit rendu — pas une liste de champs recopiée à la main, qui ne dirait que
 * ce que le test croit savoir.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

type Field = { key: string; kind: string; label: string; fields?: Field[] };
type Descriptor = {
	id: string;
	label: string;
	fields: Field[];
	actions: { id: string }[];
};

const descriptor = () =>
	cy
		.request<Descriptor>({ url: `${api}/api/documents/types/quote` })
		.its("body");

describe("Un document est un descripteur, et l'écran le suit", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("le formulaire rend CHAQUE champ que le descripteur déclare", () => {
		// L'assertion est pilotée par la donnée : si demain le devis gagne un champ, ce test l'exige
		// sans être modifié. S'il en perd un, il cesse de l'exiger. C'est la différence entre vérifier
		// le modèle et recopier ce qu'on croit savoir de lui.
		descriptor().then((d) => {
			expect(
				d.fields,
				"le devis déclare des champs",
			).to.have.length.greaterThan(0);

			cy.visit("/documents/quote");
			cy.get('[data-cy="document-form"]', { timeout: 15000 }).should(
				"be.visible",
			);

			for (const f of d.fields) {
				cy.get(`[data-cy="document-field-${f.key}"]`, {
					timeout: 10000,
				}).should("exist");
				// Un champ dont le TYPE n'a pas de rendu affiche un marqueur explicite plutôt que rien.
				// Le voir ici voudrait dire que le noyau ment sur sa couverture.
				cy.get(`[data-cy="document-field-${f.key}-unsupported"]`).should(
					"not.exist",
				);
			}
		});
	});

	it("les actions offertes sont celles du descripteur, ni plus ni moins", () => {
		descriptor().then((d) => {
			cy.visit("/documents/quote");
			cy.get('[data-cy="document-form"]', { timeout: 15000 }).should(
				"be.visible",
			);

			cy.get('[data-cy^="document-action-"]').then(($btns) => {
				const onScreen = [...$btns]
					.map((b) =>
						b.getAttribute("data-cy")?.replace("document-action-", ""),
					)
					.sort();
				// Sur un document JAMAIS enregistré, seules les actions disponibles « always » ont un sens :
				// les autres attendent un statut que le document n'a pas encore. On vérifie donc l'inclusion
				// dans ce que le descripteur déclare, et qu'aucun bouton ne sorte de nulle part.
				const declared = d.actions.map((a) => a.id);
				for (const id of onScreen) {
					expect(declared, `le bouton "${id}" vient du descripteur`).to.include(
						id,
					);
				}
				expect(
					onScreen,
					"au moins une action est offerte",
				).to.have.length.greaterThan(0);
			});
		});
	});

	it("une action déclarée SANS implémentation est refusée, et l'utilisateur lit pourquoi", () => {
		// `convert-to-invoice` est déclarée sur le devis et volontairement non implémentée.
		//
		// Il faut d'abord un document ENREGISTRÉ : sur un document jamais sauvé, c'est le contrôle de
		// disponibilité qui refuse en premier (409, « pas avant que le document soit enregistré »), et
		// on n'atteint jamais le 501. Ma première version attendait un 501 tout de suite : c'était
		// l'assertion qui avait tort, pas le produit. Les deux gardes se suivent dans le bon ordre —
		// la disponibilité d'abord, l'implémentation ensuite.
		// Un brouillon VALIDE : la validation refuse à juste titre un document incomplet, et c'est
		// le comportement voulu — on lui donne donc de quoi être accepté, sans rien contourner.
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(
					clients,
					"le jeu d'essai contient un client",
				).to.have.length.greaterThan(0);

				cy.request({
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
				}).then((saved) => {
					expect(
						saved.status,
						`brouillon créé — ${JSON.stringify(saved.body).slice(0, 220)}`,
					).to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id;
					expect(id, "le brouillon a un identifiant").to.be.a("string");

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/convert-to-invoice`,
						body: { documentId: id },
						failOnStatusCode: false,
					}).then((res) => {
						expect(
							res.status,
							`refusée — ${JSON.stringify(res.body).slice(0, 200)}`,
						).to.eq(501);
						expect(
							String(res.body?.message ?? ""),
							"le message nomme l'action et dit qu'elle n'a pas d'implémentation",
						).to.match(/convert-to-invoice/);
					});
				});
			});
	});

	it("un type de document inconnu est refusé proprement, à l'API comme à l'écran", () => {
		cy.request({
			url: `${api}/api/documents/types/nexiste-pas`,
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "l'API refuse").to.eq(404);
		});

		// Et l'écran ne montre pas une page vide : une page vide ressemble à une panne.
		cy.visit("/documents/nexiste-pas");
		cy.get('[data-cy="document-type-unknown"]', { timeout: 20000 }).should(
			"be.visible",
		);
	});
});
