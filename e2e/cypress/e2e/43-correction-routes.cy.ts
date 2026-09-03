/**
 * TODO_CORRECTION.md C1 — `GET /api/documents/:id/correction-routes?typeId=invoice`
 * (`backend/src/modules/documents/correction-routes/`). NIVEAU API d'abord, comme le reste de la
 * discipline « assertions par l'API » du dépôt (cy.request pour l'action ET pour la vérification) —
 * l'écran (le bouton « Corriger », le dialogue des voies) arrive en C2, PAS ici.
 *
 * Le mandant par défaut (`cy.resetAndSeed()`) est déjà une société FRANÇAISE (SIRET/VAT sur le
 * dossier) — exactement le pays canonique dont l'avoir interne est `required` dans
 * `docs/compliance/CORRECTION-ROUTES.yaml`. Ce fichier ne bascule donc JAMAIS le pays de la société :
 * le contenu épinglé pays par pays (l'inversion FR/PL, l'échantillon par pays) est déjà prouvé en
 * jest (`correction-routes/data/all.spec.ts`) contre le VRAI fichier — pas la peine de le refaire ici
 * au prix d'un aller-retour navigateur par pays. Cette spec prouve le CÂBLAGE bout en bout : les
 * quatre gates composés par `documents.service.ts#getCorrectionRoutes`, contre le vrai serveur.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClient(name: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				address: "1 Rue Quelconque",
				postalCode: "75002",
				city: "Paris",
				country: "France",
				currency: "EUR",
				isActive: true,
			},
		})
		.then((res) => {
			expect(res.status, "client créé par API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "le client créé a un identifiant").to.be.a("string");
			return id;
		});
}

/** `issueDate`/`dueDate` are overridable — the "émise" test below needs a date BEFORE 2026-09-01
 *  (root TODO item 11's own FR seller-country PDP mandate, sourced 2026-08-27: "FR requires
 *  invoices issued on or after 2026-09-01 to go through the \"pdp\" channel") so a plain "email"
 *  transport (Mailpit, no PDP credentials configured anywhere in this suite) can actually reach
 *  the SYNCHRONOUS "sending" phase this spec needs — see `sendInvoice`'s own header. This mandate
 *  is UNRELATED to correction routes themselves; only old enough to predate it. */
function invoiceData(
	clientId: string,
	dates: { issueDate: string; dueDate: string } = {
		issueDate: "2026-09-15",
		dueDate: "2026-10-15",
	},
) {
	return {
		client: clientId,
		issueDate: dates.issueDate,
		dueDate: dates.dueDate,
		currency: "EUR",
		lines: [
			{
				description: "Conseil",
				quantity: 1,
				unit: "day",
				unitPrice: 1000,
				vatRate: "20",
			},
		],
	};
}

/** Same convention as `40-b2g-routing.cy.ts`'s own `setInvoiceTransport` — "email" (Mailpit) is
 *  enough to reach `sending`: this spec only needs the document NUMBERED and past "draft", never a
 *  genuinely delivered invoice (that proof belongs to 28-document-async-send.cy.ts). */
function setInvoiceTransport(transportId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: transportId },
		})
		.then((res) => {
			expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
		});
}

function createInvoiceDraft(
	clientId: string,
	dates?: { issueDate: string; dueDate: string },
) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: { data: invoiceData(clientId, dates) },
			failOnStatusCode: false,
		})
		.then((saved) => {
			expect(saved.status, "brouillon de facture créé").to.be.oneOf([
				200, 201,
			]);
			const invoiceId = saved.body?.document?.id as string;
			expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");
			return invoiceId;
		});
}

/** Fait passer une facture DRAFT à `sending` (numérotée) — la première phase de "send" est
 *  SYNCHRONE (voir `actions/async-send.ts`'s own header : "persists 'sending' ... before ...
 *  returns") : le statut n'est déjà plus "draft" au retour de CET appel, quel que soit le sort de
 *  la livraison elle-même ensuite (hors du périmètre de cette spec — voir 28's own suite pour ça).
 *  `data` doit être renvoyé avec `documentId` — même convention que 21's own "send" (`runAction`
 *  revalide toujours `data` contre le descripteur, jamais un re-lu implicite depuis la base).
 */
function sendInvoice(
	invoiceId: string,
	clientId: string,
	dates?: { issueDate: string; dueDate: string },
) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/send`,
			body: { documentId: invoiceId, data: invoiceData(clientId, dates) },
			failOnStatusCode: false,
		})
		.then((res) => {
			expect(
				res.status,
				`phase 1 de l'envoi (synchrone) : ${JSON.stringify(res.body)}`,
			).to.be.oneOf([200, 201]);
			expect(
				res.body?.document?.status,
				'la facture est partie ("sending")',
			).to.eq("sending");
		});
}

describe("Correction routes (TODO_CORRECTION.md C1) — GET /api/documents/:id/correction-routes", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('société FR (le mandant par défaut) sur une facture DRAFT — 409, "a correction corrects an ISSUED document"', () => {
		createClient("Client Draft SARL").then((clientId) => {
			createInvoiceDraft(clientId).then((invoiceId) => {
				cy.request({
					url: `${api}/api/documents/${invoiceId}/correction-routes?typeId=invoice`,
					failOnStatusCode: false,
				}).then((res) => {
					expect(res.status, "409 sur un brouillon — rien n'est émis").to.eq(
						409,
					);
					expect(JSON.stringify(res.body)).to.match(/draft/);
				});
			});
		});
	});

	it("société FR (le mandant par défaut) sur une facture ÉMISE — l'avoir interne (INTERNAL_CREDIT_NOTE) est `required` ET `implemented: true` ; toute autre voie reste honnêtement non implémentée ; la limitation vendeur×acheteur est toujours présente", () => {
		// "email" (Mailpit) suffit à atteindre "sending" — voir `invoiceData`'s own header sur la
		// date choisie (avant le mandat PDP français du 2026-09-01, sans quoi le préflight bloque
		// AVANT même de tenter un envoi, quel que soit le transport choisi ici).
		setInvoiceTransport("email");
		const preMandateDates = { issueDate: "2026-08-15", dueDate: "2026-09-15" };

		createClient("Client Émis SARL").then((clientId) => {
			createInvoiceDraft(clientId, preMandateDates).then((invoiceId) => {
				sendInvoice(invoiceId, clientId, preMandateDates).then(() => {
					cy.request({
						url: `${api}/api/documents/${invoiceId}/correction-routes?typeId=invoice`,
					}).then((res) => {
						expect(res.status).to.eq(200);
						expect(res.body.countryCode).to.eq("FR");

						const routes = res.body.routes as Array<{
							routeId: string;
							status: string;
							label: string;
							implemented: boolean;
						}>;
						expect(
							routes.length,
							"les onze voies canoniques sont rendues",
						).to.eq(11);

						const internalCreditNote = routes.find(
							(r) => r.routeId === "INTERNAL_CREDIT_NOTE",
						);
						expect(
							internalCreditNote,
							"INTERNAL_CREDIT_NOTE est présente",
						).to.exist;
						expect(
							internalCreditNote!.status,
							"l'avoir interne français est IMPOSÉ",
						).to.eq("required");
						expect(
							internalCreditNote!.implemented,
							"c'est la SEULE voie réellement branchée aujourd'hui",
						).to.eq(true);
						expect(internalCreditNote!.label).to.contain(
							"annulation comptable",
						);

						// Chaque AUTRE voie reste honnêtement non implémentée, quel que soit son statut
						// (required/allowed/forbidden/unverified) — le mapping "implemented" ne suit
						// JAMAIS le statut légal.
						for (const route of routes) {
							if (route.routeId !== "INTERNAL_CREDIT_NOTE") {
								expect(
									route.implemented,
									`${route.routeId} n'est pas branché`,
								).to.eq(false);
							}
						}

						// La limite P3-U02 (composition vendeur×acheteur non écrite) est toujours
						// consignée, jamais tue.
						expect(res.body.limitation).to.match(/seller/i);
						expect(res.body.limitation).to.match(/buyer/i);
					});
				});
			});
		});
	});

	it("un typeId autre que « invoice » — 501 nommé, jamais un défaut silencieux", () => {
		createClient("Client Devis SARL").then((clientId) => {
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/save-draft`,
				body: {
					data: {
						client: clientId,
						issueDate: "2026-09-15",
						currency: "EUR",
						lines: [
							{ description: "Conseil", quantity: 1, unitPrice: 1000 },
						],
					},
				},
				failOnStatusCode: false,
			}).then((saved) => {
				expect(saved.status).to.be.oneOf([200, 201]);
				const quoteId = saved.body?.document?.id as string;
				cy.request({
					url: `${api}/api/documents/${quoteId}/correction-routes?typeId=quote`,
					failOnStatusCode: false,
				}).then((res) => {
					expect(
						res.status,
						'501 — seul typeId="invoice" est couvert par ce mécanisme aujourd\'hui',
					).to.eq(501);
					expect(JSON.stringify(res.body)).to.match(/invoice/);
				});
			});
		});
	});
});

/**
 * TODO_CORRECTION.md C2 — l'ÉCRAN : le bouton « Corriger » (document-list.tsx's own per-row custom
 * slot, custom/invoice-correction-routes-button.tsx), le dialogue des voies, et le mécanisme RÉEL
 * pour la seule voie branchée (INTERNAL_CREDIT_NOTE) — la création d'avoir PRÉ-LIÉE. Même discipline
 * que 25-document-settlement.cy.ts's own T4-d test : la fixture (client, facture émise) est préparée
 * par API — rien de nouveau à prouver par un clic pour ÇA — mais tout ce que cette tâche ajoute
 * (ouvrir le dialogue, lire la voie imposée, cliquer, atterrir sur l'écran d'avoir déjà pré-rempli,
 * sauvegarder) passe par un VRAI clic, et la preuve qui compte est relue par l'API.
 */
describe("Corriger (TODO_CORRECTION.md C2) — l'écran, niveau navigateur", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("société FR sur une facture ÉMISE : la voie imposée (avoir interne) porte sa base légale et mène, au clic, à l'écran d'avoir RÉEL PRÉ-LIÉ (référence remplie, devise verrouillée) — sauvegarder crée l'avoir lié à la facture", () => {
		setInvoiceTransport("email");
		const preMandateDates = { issueDate: "2026-08-10", dueDate: "2026-09-10" };
		const clientName = "Client Corriger SARL";

		createClient(clientName).then((clientId) => {
			createInvoiceDraft(clientId, preMandateDates).then((invoiceId) => {
				sendInvoice(invoiceId, clientId, preMandateDates).then(() => {
					cy.visit("/documents/invoice");

					cy.get(`[data-cy="document-correction-button-${invoiceId}"]`, {
						timeout: 15000,
					}).click({ force: true });
					cy.get('[data-cy="document-correction-dialog"]', {
						timeout: 5000,
					}).should("be.visible");

					// La voie imposée : statut ET base légale — les MOTS de l'API (l'extrait du
					// dossier de spécifications DGFiP/AIFE), jamais un résumé réécrit côté front.
					cy.get(
						'[data-cy="document-correction-route-INTERNAL_CREDIT_NOTE-status"]',
					).should("contain.text", "Required by law");
					cy.get(
						'[data-cy="document-correction-route-INTERNAL_CREDIT_NOTE-label"]',
					).should("contain.text", "annulation comptable");

					cy.get(
						'[data-cy="document-correction-route-INTERNAL_CREDIT_NOTE-button"]',
					)
						.should("not.be.disabled")
						.click();

					// LE VRAI mécanisme, PRÉ-LIÉ — jamais un stub : navigation vers l'écran d'avoir,
					// le dialogue de création s'ouvre déjà, la référence facture est déjà résolue
					// (le label backend combine client + date d'émission — jamais un champ vide) et
					// T4-d verrouille déjà la devise, sans aucune recherche manuelle.
					cy.location("pathname", { timeout: 10000 }).should(
						"eq",
						"/documents/credit-note",
					);
					cy.get('[data-cy="document-create-dialog"]', { timeout: 10000 }).should(
						"be.visible",
					);
					cy.get('[data-cy="document-field-invoice-input"] button', {
						timeout: 10000,
					}).should("contain.text", clientName);
					cy.get('[data-cy="document-field-currency-input"] button', {
						timeout: 10000,
					})
						.should("be.disabled")
						.and("contain.text", "EUR");

					// Ce que le descripteur exige encore : la date d'émission de l'avoir et la ligne
					// corrigée (issue de la facture liée — même patron que 25's own T4-d test).
					cy.get('[data-cy="document-field-issueDate-input"]').click();
					const today = new Date().toLocaleDateString();
					cy.get(`[data-day="${today}"]`).click();

					cy.get(
						'[data-cy^="document-field-correctedLines-row-"][data-cy$="-checkbox"]',
						{ timeout: 10000 },
					)
						.first()
						.check({ force: true });

					cy.intercept(
						"POST",
						`${api}/api/documents/types/credit-note/actions/save-draft`,
					).as("saveCreditNoteDraft");
					cy.get('[data-cy="document-action-save-draft"]')
						.scrollIntoView()
						.click();
					cy.wait("@saveCreditNoteDraft").then((interception) => {
						expect(
							interception.response?.statusCode,
							"l'avoir se crée sans le blocage T4-d",
						).to.be.oneOf([200, 201]);
						const creditNoteId = interception.response?.body?.document
							?.id as string;
						expect(creditNoteId, "l'avoir créé a un identifiant").to.be.a(
							"string",
						);

						// La preuve qui compte, relue par l'API : l'avoir existe et est LIÉ à la
						// facture corrigée — jamais seulement l'écran comme preuve.
						cy.request({
							url: `${api}/api/documents/${creditNoteId}?typeId=credit-note`,
						})
							.its("body")
							.then((doc) => {
								expect(
									doc.data?.invoice,
									"l'avoir est pré-lié à LA bonne facture",
								).to.eq(invoiceId);
								expect(
									doc.data?.currency,
									"la devise verrouillée (T4-d) est bien celle de la facture",
								).to.eq("EUR");
							});
					});
				});
			});
		});
	});

	it("une voie déclarée par la loi française mais non implémentée ici (CREDIT_NOTE) : l'état honnête à l'écran, jamais un stub qui fait semblant", () => {
		setInvoiceTransport("email");
		const preMandateDates = { issueDate: "2026-08-11", dueDate: "2026-09-11" };

		createClient("Client Non Implémenté SARL").then((clientId) => {
			createInvoiceDraft(clientId, preMandateDates).then((invoiceId) => {
				sendInvoice(invoiceId, clientId, preMandateDates).then(() => {
					cy.visit("/documents/invoice");

					cy.get(`[data-cy="document-correction-button-${invoiceId}"]`, {
						timeout: 15000,
					}).click({ force: true });
					cy.get('[data-cy="document-correction-dialog"]', {
						timeout: 5000,
					}).should("be.visible");

					// CREDIT_NOTE est "allowed" en France (le YAML) mais n'est PAS l'une des voies
					// branchées (seule INTERNAL_CREDIT_NOTE l'est) — le bouton reste cliquable (la
					// loi le permet), mais le clic ne doit jamais atteindre un écran d'avoir.
					cy.get('[data-cy="document-correction-route-CREDIT_NOTE-button"]', {
						timeout: 5000,
					})
						.should("not.be.disabled")
						.click();

					cy.get('[data-cy="document-correction-not-implemented"]', {
						timeout: 5000,
					})
						.should("be.visible")
						.and("contain.text", "Credit note")
						.and("contain.text", "FR");

					cy.get('[data-cy="document-create-dialog"]').should("not.exist");
				});
			});
		});
	});
});
