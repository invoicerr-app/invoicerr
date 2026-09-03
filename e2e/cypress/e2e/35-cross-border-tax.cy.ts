/**
 * Root TODO item 16 ("transfrontalier") — la limite la plus profonde, prouvée par l'écran.
 *
 * Même discipline que 30/32 : l'ACTION passe par un vrai clic (créer le client, cliquer "Send",
 * cliquer le bouton de téléchargement XML), les ASSERTIONS qui comptent relisent l'API ou
 * interceptent la vraie requête réseau que le clic déclenche — jamais l'écran seul comme preuve de
 * ce qui a été calculé ou envoyé.
 *
 * `issueDate` fixée AVANT le mandat FR/PDP (2026-09-01) sur les DEUX factures de ce fichier — comme
 * 30/32 — pour que le transport "email" (jamais "pdp") reste le chemin testé ; le mandat lui-même ne
 * s'appliquerait de toute façon pas à une vente FR→DE (l'attachement bilatéral exige les DEUX
 * parties en France — voir `channel-policy/data/fr.json`), mais fixer la date évite tout doute et
 * garde ce fichier lisible sans relire cette règle.
 *
 * VIES : le backend de test tourne avec `VAT_VALIDATION_FAKE=1` (backend/.env.test) — un client
 * FAUX, déterministe, JAMAIS un appel réseau réel, qui répond VALID pour un numéro de TVA
 * syntaxiquement correct (voir `clients.module.ts` et `documents/tax/vat-validation.ts`'s own
 * header) : c'est ce qui rend observable, à travers un vrai navigateur, la transition VALID ->
 * autoliquidation que le client Null (le défaut sous NODE_ENV=test) ne pouvait pas montrer.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function setInvoiceTransport(transportId: string) {
	return cy
		.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: transportId } })
		.then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});
}

describe("Root TODO item 16 — le transfrontalier, à travers l'écran", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('un client allemand avec un numéro de TVA intracommunautaire (champ NOUVEAU) — facture FR→DE en email, 0%, catégorie AE, mention art. 196', () => {
		setInvoiceTransport("email");

		// 1. Le client allemand, créé PAR L'ÉCRAN — la preuve que le champ VAT est désormais offert
		// pour un pays qui n'avait AUCUN fichier `country-identifiers/data/*.json` avant cette tâche.
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Deutsche Autoliquidation GmbH");
		cy.selectCountry("client-country-select", "Germany");

		// Avant cette tâche, un pays sans country-identifiers/data/xx.json affichait seulement le
		// message "unknown country" — jamais un champ. Le prouver ABSENT est ce qui distingue "le
		// champ existe" de "le formulaire affiche juste quelque chose".
		cy.get('[data-cy="client-identifiers-unknown-country"]').should("not.exist");
		cy.get('[data-cy="client-identifier-VAT"]', { timeout: 10000 })
			.should("exist")
			.clear()
			.type("DE136695976"); // checksum-valide (ISO 7064 Mod 11,10) — voir vat-syntax.spec.ts

		cy.get('[name="contactEmail"]').clear().type("buchhaltung@deutsche-autoliquidation.example");
		cy.get('[name="address"]').clear().type("Friedrichstraße 42");
		cy.get('[name="postalCode"]').clear().type("10117");
		cy.get('[name="city"]').clear().type("Berlin");

		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Deutsche Autoliquidation GmbH", { timeout: 10000 });

		// 2. La facture FR→DE — créée par l'API (même convention que 30/32 : la donnée se prépare
		// par l'API, l'ACTION testée passe par l'écran), avec une ligne de SERVICES pour que le
		// moteur résolve l'autoliquidation (AE, art. 196), pas la livraison intra-UE (K, art. 138).
		cy.request({ url: `${api}/api/documents/references/client/search?q=Deutsche` })
			.its("body")
			.then((clients: { id: string; label: string }[]) => {
				const client = clients.find((c) => c.label.includes("Deutsche Autoliquidation"));
				expect(client, "le client allemand créé ci-dessus se retrouve par la recherche").to.exist;

				const data = {
					client: client!.id,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [
						{
							description: "Conseil stratégique",
							quantity: 1,
							unit: "day",
							unitPrice: 1000,
							vatRate: "20",
							supplyType: "SERVICES",
						},
					],
				};

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId).to.be.a("string");

					cy.visit("/documents/invoice");
					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Draft");

					// L'ACTION : un vrai clic sur "Send" — jamais un appel direct à l'action.
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// 3. Le XML téléchargé — la preuve : 0%, catégorie AE, mention d'autoliquidation.
					cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));
					cy.intercept({ method: "GET", pathname: `/api/documents/${invoiceId}/formats/cii` }).as(
						"xmlCiiCrossBorder",
					);
					cy.get(`[data-cy="document-xml-button-${invoiceId}"]`, { timeout: 10000 }).click();
					cy.get(`[data-cy="document-xml-cii-${invoiceId}"]`, { timeout: 10000 })
						.should("be.visible")
						.click();
					cy.wait("@xmlCiiCrossBorder", { timeout: 20000 }).then((x) => {
						expect(x.response?.statusCode, "le téléchargement CII réussit").to.eq(200);
						const body = String(x.response?.body);
						// BT-152/BT-151 — 0%, catégorie AE, jamais les 20% initialement saisis.
						expect(body).to.match(/<ram:RateApplicablePercent>0<\/ram:RateApplicablePercent>/);
						expect(body).to.contain("<ram:CategoryCode>AE</ram:CategoryCode>");
						// BG-1 (BT-22) — la mention du moteur, texte du repère, TEL QUEL.
						expect(body).to.contain(
							"Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC",
						);
						// Les totaux reflètent le traitement RÉSOLU (0%), jamais les 20% du brouillon.
						expect(body).to.match(
							/<ram:TaxTotalAmount currencyID="EUR">0\.00<\/ram:TaxTotalAmount>/,
						);
						expect(body).to.match(/<ram:GrandTotalAmount>1000\.00<\/ram:GrandTotalAmount>/);
					});

					// Et c'est bien ce qui est enregistré — l'assertion qui compte relit l'API.
					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body")
						.then((doc) => {
							expect(doc.status).to.eq("sent");
						});

					// 4. LE DÉFAUT DE LA TÂCHE 16 (correction chirurgicale) — la donnée STOCKÉE (celle que
					// `instance.data` porte désormais dès l'entrée en "sending") doit être la donnée
					// RÉSOLUE : la LISTE (le dialogue ouvert depuis une ligne) doit afficher le total
					// RÉSOLU (1000,00 €, 0 % de TVA), jamais 1 200,00 € (les 20 % saisis au brouillon).
					// Avant la correction, `instance.data` gardait le taux saisi et ce total aurait affiché
					// 1200.00 — cette assertion est celle qui aurait échoué sur le défaut.
					cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");
					cy.get('[data-cy="document-totals-gross"]', { timeout: 10000 })
						.should("contain", "1000.00")
						.and("not.contain", "1200.00");
					cy.get("body").type("{esc}");
					cy.get('[data-cy="document-edit-dialog"]').should("not.exist");

					// 5. Le PDF RE-téléchargé — un second téléchargement, après coup, pas seulement celui
					// qui a accompagné l'envoi — porte lui aussi le traitement résolu (0 %) : la requête
					// réseau que le clic déclenche réussit, sur le MÊME document déjà "sent".
					cy.intercept({ method: "GET", pathname: `/api/documents/${invoiceId}/pdf` }).as(
						"pdfCrossBorderReDownload",
					);
					cy.get(`[data-cy="document-pdf-button-${invoiceId}"]`, { timeout: 10000 }).click();
					cy.wait("@pdfCrossBorderReDownload", { timeout: 20000 }).then((x) => {
						expect(x.response?.statusCode, "le PDF re-téléchargé réussit").to.eq(200);
					});

					// 6. LE LETTRAGE d'une transfrontalière — un paiement de 1000,00 € (le total RÉSOLU,
					// jamais 1200,00 €) règle intégralement la facture : le badge devient "Settled", et
					// l'API le confirme sur les totaux STOCKÉS (jamais un recalcul caché qui masquerait le
					// défaut).
					cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
					cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");
					cy.get('[data-cy="document-action-record-payment"]', { timeout: 15000 }).click();
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="document-action-params-dialog"]')
						.find('[data-cy="document-field-amount-input"]')
						.clear({ force: true })
						.type("1000", { force: true });
					cy.get('[data-cy="document-action-params-confirm"]').click();
					cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");

					cy.get('[data-cy="document-settlement-badge"]', { timeout: 15000 }).should(
						"contain.text",
						"Settled",
					);

					cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
						.its("body")
						.then((body) => {
							// 1000,00 € résolus, jamais 1200,00 € (20 % du brouillon) — le nombre exact que
							// ce défaut faussait avant la correction.
							expect(body.totals.grossMinor, "total résolu : 1000,00 € (0 % AE)").to.eq(100000);
							expect(body.settlement.paidMinor).to.eq(100000);
							expect(body.settlement.outstandingMinor, "réglée intégralement").to.eq(0);
							expect(body.settlement.settled).to.eq(true);
						});
				});
			});
	});

	it("un client sans pays résolvable — l'envoi est refusé À L'ÉCRAN, message nommé, jamais un 0% silencieux", () => {
		setInvoiceTransport("email");

		// Le FORMULAIRE client exige un pays (validation zod côté écran) — ce client est donc créé
		// par l'API directement, comme un scripted client le ferait, pour amener l'invoice dans
		// l'état que ce test vise : c'est le REFUS À L'ENVOI que ce test prouve par l'écran, pas la
		// création du client elle-même (déjà prouvée par le test précédent).
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Sans Pays SARL",
				contactEmail: `sans-pays-${Date.now()}@example.com`,
				address: "1 Rue Inconnue",
				postalCode: "00000",
				city: "Nulle Part",
				country: "",
				currency: "EUR",
				isActive: true,
				type: "COMPANY",
			},
		}).then((createdClient) => {
			expect(createdClient.status).to.be.oneOf([200, 201]);
			const clientId = createdClient.body?.id as string;
			expect(clientId).to.be.a("string");

			const data = {
				client: clientId,
				issueDate: "2026-08-30",
				dueDate: "2026-09-30",
				currency: "EUR",
				lines: [{ description: "Conseil", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data },
			}).then((saved) => {
				const invoiceId = saved.body?.document?.id as string;
				expect(invoiceId).to.be.a("string");

				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

				// Le préflight bloque de façon SYNCHRONE — un toast nommé le dit tout de suite, même
				// discipline que 32-channel-mandate.cy.ts pour son propre refus au préflight.
				cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
					"contain.text",
					"buyer's country could not be determined",
				);

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(
							doc.status,
							'jamais persisté au-delà de "draft" — bloqué avant toute écriture, jamais un 0% silencieux',
						).to.eq("draft");
					});
			});
		});
	});

	// Root TODO item 16 FOLLOW-UP (2026-09-01) — the OSS gate's own real-world gap ("OSS hors FR"):
	// this task sourced Germany's real standard VAT rate (19%) from the European Commission's TEDB
	// (`documents/tax/tax-systems/data/de.json`'s own `provenance`), so a B2C sale of GOODS to a
	// German consumer with NO VAT number no longer hits `UnsupportedOssDestinationError` — it now
	// resolves to DE's own destination rate. Same discipline as the first test in this file: the
	// client is created BY THE SCREEN, the invoice is sent BY A REAL CLICK, and the assertion that
	// counts is the actual downloaded XML.
	it("un client allemand SANS numéro de TVA (B2C) — facture FR→DE en email, OSS charge le taux allemand LU (19%), total TTC chiffré", () => {
		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Privatkunde Ohne USt-IdNr");
		cy.selectCountry("client-country-select", "Germany");

		// The VAT field is OFFERED (same country-identifiers/data/de.json as the first test) but
		// deliberately left EMPTY — this is what makes `resolveBuyerRole` treat this buyer as B2C
		// (`resolve-invoice-tax.ts`'s own contract: no VAT value at all → B2C, before VIES is even
		// consulted), which is exactly the shape the OSS branch (not reverse charge) needs.
		cy.get('[data-cy="client-identifier-VAT"]', { timeout: 10000 }).should("exist");

		cy.get('[name="contactEmail"]').clear().type("privatkunde@ohne-ustidnr.example");
		cy.get('[name="address"]').clear().type("Alexanderplatz 1");
		cy.get('[name="postalCode"]').clear().type("10178");
		cy.get('[name="city"]').clear().type("Berlin");

		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Privatkunde Ohne USt-IdNr", { timeout: 10000 });

		// The invoice — a GOODS line (not SERVICES) so the engine actually reaches the OSS branch
		// (`tax-engine.ts`: B2C GOODS/DIGITAL across the union → `ossDestinationVat`; B2C SERVICES
		// falls back to the seller's own rate and never needs a destination table at all).
		cy.request({ url: `${api}/api/documents/references/client/search?q=Privatkunde` })
			.its("body")
			.then((clients: { id: string; label: string }[]) => {
				const client = clients.find((c) => c.label.includes("Privatkunde Ohne USt-IdNr"));
				expect(client, "le client allemand B2C créé ci-dessus se retrouve par la recherche").to.exist;

				const data = {
					client: client!.id,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [
						{
							description: "Casque audio sans fil",
							quantity: 10,
							unit: "unit",
							unitPrice: 100,
							vatRate: "20",
							supplyType: "GOODS",
						},
					],
				};

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId).to.be.a("string");

					cy.visit("/documents/invoice");
					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Draft");

					// L'ACTION : un vrai clic sur "Send".
					cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

					cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					// Le XML téléchargé — la preuve : 19% (le taux allemand LU depuis TEDB), catégorie
					// S (standard-rated, à destination), jamais les 20% saisis au brouillon et jamais un
					// blocage `UnsupportedOssDestinationError`.
					cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));
					cy.intercept({ method: "GET", pathname: `/api/documents/${invoiceId}/formats/cii` }).as(
						"xmlCiiOss",
					);
					cy.get(`[data-cy="document-xml-button-${invoiceId}"]`, { timeout: 10000 }).click();
					cy.get(`[data-cy="document-xml-cii-${invoiceId}"]`, { timeout: 10000 })
						.should("be.visible")
						.click();
					cy.wait("@xmlCiiOss", { timeout: 20000 }).then((x) => {
						expect(x.response?.statusCode, "le téléchargement CII réussit").to.eq(200);
						const body = String(x.response?.body);
						// BT-152/BT-151 — 19% (DE), catégorie S, jamais les 20% du vendeur français.
						expect(body).to.match(/<ram:RateApplicablePercent>19<\/ram:RateApplicablePercent>/);
						expect(body).to.contain("<ram:CategoryCode>S</ram:CategoryCode>");
						// Totaux : 10 × 100 = 1000,00 € HT, 19% de TVA = 190,00 €, TTC = 1190,00 €.
						expect(body).to.match(
							/<ram:TaxTotalAmount currencyID="EUR">190\.00<\/ram:TaxTotalAmount>/,
						);
						expect(body).to.match(/<ram:GrandTotalAmount>1190\.00<\/ram:GrandTotalAmount>/);
					});

					// Et c'est bien ce qui est enregistré et lettrable — même discipline que le premier
					// test : l'assertion qui compte relit l'API, sur les totaux RÉSOLUS et STOCKÉS.
					cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
						.its("body")
						.then((body) => {
							expect(body.totals.grossMinor, "total résolu : 1190,00 € (19% OSS DE)").to.eq(119000);
						});
				});
			});
	});

	// TODO_PRODUIT.md T4-c — LE CRITÈRE DU BORD verbatim : « éditer → pays inconnu → refus nommé ».
	// f6888eb2/d58caaa5 (l'ancien moteur, avant la refonte documents/) avaient bloqué le pays
	// acheteur irrésolu à L'ÉMISSION ET à la ré-édition d'une facture déjà émise ; le même trou a
	// resurgi dans le nouveau moteur — "save-draft" (invoice.descriptor.ts) peut TOUJOURS ré-écrire
	// "draft" depuis N'IMPORTE QUEL statut (`from: 'always'`) — et invoice-actions.ts's own
	// `registerInvoiceSaveDraftAction` (T4-c) le referme la même façon : réutilise le même chemin de
	// résolution que "send" (`runInvoiceCrossBorderTaxPreflight`).
	//
	// RUNS LAST IN THIS FILE ON PURPOSE — même discipline que 30-document-xml-format.cy.ts's own
	// dernier bloc : ce test bascule la société vendeuse en ÉTATS-UNIS, le seul pays (avec la
	// France) à porter son propre `country-policy/data/*.json` — et le SEUL des deux dont la règle
	// `invoice.save-draft` n'est PAS restreinte au statut "draft" (voir `us.json`'s own
	// resolutionNote, contre `fr.json`'s own `statuses: ["draft"]`, CGI art. 289 I.5) : c'est
	// justement pour ça qu'une facture française déjà "sent" ne peut PAS servir à exercer CE
	// garde-fou précis — son "save-draft" est refusé (409) par la country-policy AVANT même
	// d'atteindre le handler que ce test vise. Les deux tests précédents de ce fichier restent
	// intacts (aucun `beforeEach` ne réinitialise la société entre les `it` de CE fichier — voir
	// resetAndSeed's own per-FILE `before()`), donc l'ordre importe : ce bloc doit rester le DERNIER.
	it("éditer une facture US déjà envoyée, dont le client perd son pays, est refusé À L'ÉCRAN — jamais une démotion silencieuse en brouillon", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { country: "United States", countryCode: "US", invoiceTransportId: "email" },
		}).then((res) => {
			expect(res.status, "seller switched to a US company, email transport").to.be.oneOf([200, 201]);
		});

		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Edit Guard LLC",
				contactEmail: `edit-guard-${Date.now()}@example.com`,
				address: "1 Main St",
				postalCode: "10001",
				city: "New York",
				country: "United States",
				countryCode: "US",
				currency: "USD",
				isActive: true,
				type: "COMPANY",
			},
		}).then((createdClient) => {
			expect(createdClient.status).to.be.oneOf([200, 201]);
			const clientId = createdClient.body?.id as string;
			expect(clientId).to.be.a("string");

			// A DOMESTIC US-US invoice (never cross-border) — this test's own point is the buyer-
			// country guard on a RE-EDIT, not the cross-border engine itself, already proven above.
			const data = {
				client: clientId,
				issueDate: "2026-08-30",
				dueDate: "2026-09-30",
				currency: "USD",
				lines: [{ description: "Consulting", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "0" }],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data },
			}).then((saved) => {
				const invoiceId = saved.body?.document?.id as string;
				expect(invoiceId).to.be.a("string");

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: invoiceId, data },
				}).then((sent) => {
					expect(sent.status, "phase 1 (sending) accepted").to.be.oneOf([200, 201]);
				});

				// Really "sent" (the worker's phase 2 actually delivered by email/Mailpit) BEFORE this
				// test touches the buyer's own country — an edit attempted while still "sending" would
				// race the worker, which is not what this test is about.
				cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

				// The buyer's country becomes UNRESOLVABLE — both the free-text `country` AND the
				// explicit `countryCode` override, since `resolve-invoice-tax.ts`'s own
				// `resolveCountryCode` prefers the explicit code first (a cleared `country` alone,
				// with the OLD `countryCode` still "US", would still resolve).
				cy.request({
					method: "PATCH",
					url: `${api}/api/clients/${clientId}`,
					body: {
						id: clientId,
						name: "Edit Guard LLC",
						contactEmail: `edit-guard-${Date.now()}@example.com`,
						address: "1 Main St",
						postalCode: "10001",
						city: "New York",
						country: "",
						countryCode: null,
						currency: "USD",
						isActive: true,
						type: "COMPANY",
					},
				}).then((res) => {
					expect(res.status, "buyer's country cleared").to.be.oneOf([200, 201]);
				});

				// THE EDIT, through the actual screen: open the record, change nothing that matters
				// (this guard fires on ANY re-save of an already-issued record, not on a specific
				// field), and click "Save draft" — the exact same button, and the exact same generic
				// mechanism, a legitimate edit would use.
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
				cy.get('[data-cy="document-edit-dialog"]', { timeout: 5000 }).should("be.visible");

				cy.get('[data-cy="document-edit-dialog"]')
					.find('[data-cy="document-action-save-draft"]')
					.click();

				// Refus NOMMÉ à l'écran — le même message que le préflight de "send" (même fonction de
				// résolution réutilisée, jamais une seconde logique) — jamais un toast générique.
				cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
					"contain.text",
					"buyer's country could not be determined",
				);

				// La preuve qui compte : le document reste "sent" — jamais démoté en "draft" en
				// silence, exactement le trou que ce test ferme.
				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(
							doc.status,
							'bloqué avant toute écriture — jamais une démotion silencieuse en "draft"',
						).to.eq("sent");
					});
			});
		});
	});
});
