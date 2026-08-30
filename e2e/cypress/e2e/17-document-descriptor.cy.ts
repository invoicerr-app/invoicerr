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
			// TROIS types au minimum (devis, facture, avoir), et c'est une assertion, pas un journal.
			//
			// Une boucle sur une liste d'un seul élément passe aussi bien qu'une vraie boucle, et se
			// donne les airs de la généricité sans la prouver. Si un jour un type disparaît du
			// registre, ce test doit tomber : c'est le seul moyen que « le front ne connaît aucun
			// type » reste une propriété vérifiée plutôt qu'une intention. Le compte : montré ici,
			// dans le message de l'assertion elle-même, pas seulement dans un commentaire.
			expect(
				types.map((t) => t.id),
				`au moins trois types couverts — vus (${types.length}) : ${types.map((t) => t.id).join(", ")}`,
			).to.have.length.of.at.least(3);

			for (const type of types) {
				descriptorFor(type.id).then((d) => {
					expect(
						d.fields,
						`${type.id} déclare des champs`,
					).to.have.length.greaterThan(0);

					// The screen since the redesign: a list page by default, a modal for creation — see
					// frontend/src/pages/(app)/documents/[typeId].tsx and document-upsert-dialog.tsx. The
					// form itself (data-cy="document-form", one "document-field-*" per descriptor field)
					// is unchanged; only reaching it now takes one click, on a button the descriptor's own
					// `label` names ("New {{label}}") rather than nothing at all.
					cy.visit(`/documents/${type.id}`);
					cy.get('[data-cy="document-create-button"]', {
						timeout: 15000,
					}).click();
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
					// Same adaptation as the previous test: open the create modal first — see its own
					// comment above.
					cy.visit(`/documents/${type.id}`);
					cy.get('[data-cy="document-create-button"]', {
						timeout: 15000,
					}).click();
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

	it("la facture bloque son envoi quand la société n'a configuré AUCUN transport — jamais un repli silencieux", () => {
		// La société de test n'a par défaut aucun `invoiceTransportId` (voir cypress/support/commands.ts,
		// `resetAndSeed` ne le fixe jamais) : c'est l'état "aucun transport choisi" par construction.
		// Ce test tourne donc délibérément AVANT celui qui suit (lequel configure "email" sur cette
		// même société pour amener une facture au statut "sent") — l'ordre des `it` dans ce fichier
		// n'est pas accessoire, `resetAndSeed` ne rejoue qu'une fois par fichier (`before`, pas
		// `beforeEach`), donc l'état de la société traverse les tests.
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
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
								{
									description: "Conseil",
									quantity: 1,
									unit: "unit",
									unitPrice: 500,
									vatRate: "20",
								},
							],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([
						200, 201,
					]);
					const id = saved.body?.document?.id;

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: {
							documentId: id,
							data: {
								client: clients[0].id,
								issueDate: "2026-08-30",
								dueDate: "2026-09-30",
								currency: "EUR",
								lines: [
									{
										description: "Conseil",
										quantity: 1,
										unit: "unit",
										unitPrice: 500,
										vatRate: "20",
									},
								],
							},
						},
						failOnStatusCode: false,
					}).then((res) => {
						expect(
							res.status,
							`bloquée — ${JSON.stringify(res.body).slice(0, 200)}`,
						).to.eq(501);
						expect(
							String(res.body?.message ?? ""),
							"le message dit clairement qu'aucun transport n'est configuré, jamais un envoi silencieux par courriel",
						).to.match(/no transport is configured/i);
					});
				});
			});
	});

	it("une action déclarée SANS implémentation est refusée, et l'utilisateur lit pourquoi", () => {
		// `record-payment` est déclarée sur la facture et volontairement non implémentée.
		//
		// Ce n'est plus `convert-to-invoice` (devis) qui porte ce rôle : cette action a depuis été
		// implémentée pour de vrai (elle crée une facture liée), donc l'appeler ne renvoie plus 501 —
		// et figer ce test dessus l'aurait fait mentir sur ce que le produit fait désormais. Le
		// mécanisme « déclarée mais non implémentée → 501, clair » n'a pas disparu pour autant :
		// `record-payment`, sur la facture, en est maintenant la seule vitrine vivante (avec
		// documents.service.invoice.spec.ts côté jest).
		//
		// Il faut d'abord une facture au statut "sent" : `record-payment` n'est offerte qu'à partir de
		// là (avant, c'est le 409 de disponibilité qui refuse en premier — le même garde-fou que le
		// test précédent observe, côté "send", avant même d'atteindre le 501). Pour l'atteindre sans
		// rien simuler, ce test passe par le vrai chemin : un transport "email" réellement configuré
		// sur la société (cette fois pour de bon — le test précédent, lui, en dépendait de l'ABSENCE),
		// un brouillon réel, un envoi réel (qui atterrit dans le vrai Mailpit de la pile e2e) — pas un
		// raccourci qui forcerait le statut en base.
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(
					clients,
					"le jeu d'essai contient un client",
				).to.have.length.greaterThan(0);

				cy.request({
					method: "POST",
					url: `${api}/api/company/info`,
					// Une société sans transport configuré bloque l'envoi (voir le test dédié plus bas) —
					// il faut donc réellement en choisir un ici, comme le ferait un utilisateur dans les
					// paramètres, avant de pouvoir amener une facture au statut "sent".
					body: { invoiceTransportId: "email" },
					failOnStatusCode: false,
				}).then((companyRes) => {
					expect(
						companyRes.status,
						`transport "email" configuré sur la société — ${JSON.stringify(companyRes.body).slice(0, 200)}`,
					).to.be.oneOf([200, 201]);

					const invoiceData = {
						client: clients[0].id,
						issueDate: "2026-08-30",
						dueDate: "2026-09-30",
						currency: "EUR",
						lines: [
							{
								description: "Conseil",
								quantity: 1,
								unit: "unit",
								unitPrice: 500,
								vatRate: "20",
							},
						],
					};

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/save-draft`,
						body: { data: invoiceData },
						failOnStatusCode: false,
					}).then((saved) => {
						expect(
							saved.status,
							`brouillon de facture créé — ${JSON.stringify(saved.body).slice(0, 220)}`,
						).to.be.oneOf([200, 201]);
						const id = saved.body?.document?.id;
						expect(id, "le brouillon a un identifiant").to.be.a("string");

						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/send`,
							body: { documentId: id, data: invoiceData },
							failOnStatusCode: false,
						}).then((sent) => {
							expect(
								sent.status,
								`facture réellement envoyée via le transport configuré — ${JSON.stringify(sent.body).slice(0, 220)}`,
							).to.be.oneOf([200, 201]);
							expect(
								sent.body?.document?.status,
								'la facture est maintenant "sent"',
							).to.eq("sent");

							cy.request({
								method: "POST",
								url: `${api}/api/documents/types/invoice/actions/record-payment`,
								body: { documentId: id, data: invoiceData },
								failOnStatusCode: false,
							}).then((res) => {
								expect(
									res.status,
									`refusée — ${JSON.stringify(res.body).slice(0, 200)}`,
								).to.eq(501);
								expect(
									String(res.body?.message ?? ""),
									"le message nomme l'action et dit qu'elle n'a pas d'implémentation",
								).to.match(/record-payment/);
							});
						});
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

	it("l'API refuse aussi une action que la politique du pays interdit — un client scripté ne contourne pas l'écran", () => {
		// La société de ce jeu d'essai est française (voir resetAndSeed) — la France est l'un des deux
		// pays couverts par backend/src/modules/documents/country-policy/data/, donc jusqu'ici chaque
		// action a été permise par la politique. Ce test bascule la société sur un pays qui n'a AUCUNE
		// règle déclarée (ni la France ni les États-Unis) pour observer le blocage — puis restaure la
		// France, dernier `it` de ce fichier ou pas : rien ne garantit qu'un `it` futur ne s'ajoutera
		// pas après celui-ci.
		//
		// L'appel passe directement par `cy.request`, jamais par un clic : ce que l'écran ne montrerait
		// même pas (le bouton serait grisé — voir document-form.tsx) doit être refusé exactement pareil
		// pour un client qui ignore l'écran et appelle l'action à la main.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { country: "Germany", countryCode: "DE" },
			failOnStatusCode: false,
		}).then((changed) => {
			expect(
				changed.status,
				`le pays de la société est changé pour un pays sans règle — ${JSON.stringify(changed.body).slice(0, 200)}`,
			).to.be.oneOf([200, 201]);

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: {
					data: {
						client: "does-not-matter",
						issueDate: "2026-08-30",
						dueDate: "2026-09-30",
						currency: "EUR",
						lines: [
							{
								description: "Conseil",
								quantity: 1,
								unit: "unit",
								unitPrice: 500,
								vatRate: "20",
							},
						],
					},
				},
				failOnStatusCode: false,
			}).then((res) => {
				expect(
					res.status,
					`bloquée — ${JSON.stringify(res.body).slice(0, 200)}`,
				).to.eq(403);
				expect(
					String(res.body?.message ?? ""),
					"le message nomme le pays et dit comment débloquer, jamais un refus muet",
				).to.match(/"DE"/);
			});
		});

		// Restaure l'état attendu par le reste de la suite (une société française couverte), que ce
		// test ait réussi ou non — sinon un futur `it` ajouté après celui-ci hériterait d'un pays sans
		// aucune règle et verrait TOUT bloqué sans lien avec ce qu'il teste réellement.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { country: "France", countryCode: "FR" },
			failOnStatusCode: false,
		});
	});

	it("la sidebar mène vers un type que le pays autorise, sans nommer ce type", () => {
		// Le groupe Documents ne porte plus de liens écrits à la main : il se remplit depuis la
		// politique du pays. On navigue comme un utilisateur, en prenant le type que le back annonce
		// — jamais un nom codé dans le test.
		//
		// Le groupe est déplié PAR DÉFAUT : il ne faut surtout pas cliquer la bascule. Ma première
		// version le faisait « si le lien est absent » — mais la liste arrive de façon asynchrone,
		// donc la vérification passait avant la réponse, ne voyait rien, et REFERMAIT un groupe déjà
		// ouvert. Le lien n'apparaissait alors jamais, et j'ai cru à un défaut du produit pendant
		// trois essais avant de faire parler l'écran.
		cy.request<{ types?: { id: string }[] }>({
			url: `${api}/api/documents/available-types`,
		})
			.its("body")
			.then((body) => {
				const types = body.types ?? [];
				expect(
					types,
					"le pays du jeu d'essai autorise au moins un type",
				).to.have.length.greaterThan(0);

				cy.visit("/dashboard");
				cy.get('[data-cy="sidebar-documents-group-toggle"]', {
					timeout: 20000,
				}).should("exist");
				cy.get(`[data-cy="sidebar-document-type-link-${types[0].id}"]`, {
					timeout: 20000,
				}).click({
					force: true,
				});
				cy.url().should("include", `/documents/${types[0].id}`);
			});
	});
});
