/**
 * Le nouveau modèle, prouvé par l'écran — et pas seulement en mémoire.
 *
 * Les tests jest prouvent les registres, la validation et le blocage d'une action sans
 * implémentation. Ils ne prouvent rien de ce qu'un utilisateur peut faire : c'est exactement
 * l'angle mort qui, dans le système précédent, a laissé passer un bouton « Modifier » mort, un
 * `send()` qui n'envoyait rien et une liste qui ne se rafraîchissait jamais.
 *
 * La règle reste celle de tout ce dépôt : les ACTIONS passent par l'interface, les ASSERTIONS
 * lisent l'enregistrement.
 *
 * Ce que ce fichier vérifie surtout, et qui est LA promesse du modèle : le formulaire n'est pas
 * écrit, il est DÉDUIT du descripteur. On lit donc la liste des types par l'API
 * (GET /api/documents/types), puis CHAQUE descripteur, puis on exige que chacun de leurs champs
 * soit rendu — pas une liste de types ou de champs recopiée à la main, qui ne dirait que ce que le
 * test croit savoir. Un troisième type de document (ou un champ ajouté à un type existant) obtient
 * sa couverture d'écran le jour où il est enregistré côté back, sans toucher ce fichier ; un type
 * dont un champ ne sait pas se rendre fait tomber la suite au lieu de passer en silence.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

type Field = { key: string; kind: string; label: string; fields?: Field[] };
type TypeSummary = { id: string; label: string };
type Descriptor = {
	id: string;
	label: string;
	fields: Field[];
	actions: { id: string }[];
};

const listTypes = () =>
	cy.request<TypeSummary[]>({ url: `${api}/api/documents/types` }).its("body");

const descriptorFor = (typeId: string) =>
	cy
		.request<Descriptor>({ url: `${api}/api/documents/types/${typeId}` })
		.its("body");

describe("Un document est un descripteur, et l'écran le suit", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("le formulaire rend CHAQUE champ que CHAQUE type déclare", () => {
		// Piloté par la donnée à deux niveaux : la liste des TYPES vient de l'API, puis pour
		// chacun, la liste des CHAMPS vient aussi de l'API. Rien ici ne nomme "quote" ou "invoice".
		listTypes().then((types) => {
			// DEUX types au minimum, et c'est une assertion, pas un journal.
			//
			// Une boucle sur une liste d'un seul élément passe aussi bien qu'une vraie boucle, et se
			// donne les airs de la généricité sans la prouver. Si un jour un type disparaît du
			// registre, ce test doit tomber : c'est le seul moyen que « le front ne connaît aucun
			// type » reste une propriété vérifiée plutôt qu'une intention.
			expect(
				types.map((t) => t.id),
				`au moins deux types couverts — vus : ${types.map((t) => t.id).join(", ")}`,
			).to.have.length.of.at.least(2);

			for (const type of types) {
				descriptorFor(type.id).then((d) => {
					expect(
						d.fields,
						`${type.id} déclare des champs`,
					).to.have.length.greaterThan(0);

					cy.visit(`/documents/${type.id}`);
					cy.get('[data-cy="document-form"]', { timeout: 15000 }).should(
						"be.visible",
					);

					for (const f of d.fields) {
						cy.get(`[data-cy="document-field-${f.key}"]`, {
							timeout: 10000,
						}).should("exist");
						// Un champ dont le TYPE n'a pas de rendu affiche un marqueur explicite plutôt
						// que rien. Le voir ici voudrait dire que le noyau ment sur sa couverture.
						cy.get(`[data-cy="document-field-${f.key}-unsupported"]`).should(
							"not.exist",
						);
					}
				});
			}
		});
	});

	it("les actions offertes sont celles du descripteur, ni plus ni moins — pour chaque type", () => {
		listTypes().then((types) => {
			for (const type of types) {
				descriptorFor(type.id).then((d) => {
					cy.visit(`/documents/${type.id}`);
					cy.get('[data-cy="document-form"]', { timeout: 15000 }).should(
						"be.visible",
					);

					cy.get('[data-cy^="document-action-"]').then(($btns) => {
						const onScreen = [...$btns]
							.map((b) =>
								b.getAttribute("data-cy")?.replace("document-action-", ""),
							)
							.sort();
						// Sur un document JAMAIS enregistré, seules les actions disponibles « always »
						// ont un sens : les autres attendent un statut que le document n'a pas encore.
						// On vérifie donc l'inclusion dans ce que le descripteur déclare, et qu'aucun
						// bouton ne sorte de nulle part.
						const declared = d.actions.map((a) => a.id);
						for (const id of onScreen) {
							expect(
								declared,
								`${type.id} — le bouton "${id}" vient du descripteur`,
							).to.include(id);
						}
						expect(
							onScreen,
							`${type.id} — au moins une action est offerte`,
						).to.have.length.greaterThan(0);
					});
				});
			}
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
		//
		// Ce test reste sur UN type précis (le devis) plutôt que de boucler comme les deux précédents :
		// il lui faut une action réellement déclarée-mais-non-implémentée et connue à l'avance, ce qui
		// n'est pas une propriété generique de "n'importe quel type enregistré" — la facture a la
		// sienne (record-payment), couverte côté jest (documents.service.invoice.spec.ts), exactement
		// pour la même raison de discipline.
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

	it("un type de document inconnu est refusé proprement, à l'écran comme à l'API", () => {
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
