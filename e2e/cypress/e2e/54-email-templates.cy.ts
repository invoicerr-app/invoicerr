/**
 * Gabarits d'email PAR TYPE DE DOCUMENT (`Settings > Email Templates`, onglet `/settings/email`) —
 * jusqu'ici sans AUCUNE couverture e2e : `09-settings.cy.ts` ne visite jamais cet onglet, et
 * `23-document-email.cy.ts` ne prouve qu'un seul fait (un clic réel sur "Send" joint le PDF et
 * interpole le sujet), jamais que l'ÉDITEUR lui-même enregistre, révoque, ou refuse ce que le
 * serveur refuse. La grammaire des placeholders (simple accolade `{nom}`), le contrat "un
 * placeholder inconnu est SIGNALÉ, jamais refusé" et le contrat opposé "un sujet vide, ou ni corps
 * ni html, EST refusé" sont déjà prouvés unitairement côté serveur
 * (`backend/src/modules/documents/actions/email-template.spec.ts`,
 * `documents.service.email-templates.spec.ts`) ; ce fichier prouve que l'ÉCRAN respecte exactement
 * ce même contrat, bout en bout.
 *
 * Discipline habituelle : les ACTIONS passent par l'écran (taper, cliquer), les ASSERTIONS qui
 * comptent relisent l'API — jamais le DOM qu'on vient de remplir comme preuve de ce qui est
 * réellement stocké.
 *
 * Deux types choisis délibérément pour leurs FORMES différentes (voir ce même fichier backend,
 * `derives the right vocabulary for each shipped type`) :
 *  - `quote` / `invoice` : un client (`recipientName`) et des lignes chiffrées (`totalGross`).
 *  - `expense` : ni l'un ni l'autre — la vocabulaire minimale (`companyName`, `displayNumber`,
 *    `typeLabel`).
 * C'est `invoice`/`expense`, pas `invoice`/`quote`, qui prouve que le vocabulaire est GENUINEMENT
 * par type : `quote` et `invoice` ont en réalité le même jeu de clés (les deux ont un client ET des
 * lignes chiffrées), seul le texte des exemples diffère.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface DocumentTypeSummary {
	id: string;
	label: string;
}

interface DocumentEmailTemplateApiView {
	typeId: string;
	label: string;
	subject: string;
	body: string;
	html?: string;
	source: "company" | "descriptor" | "generic";
	variables: Record<string, string>;
}

/** Relit le gabarit RÉSOLU d'un type — la même lecture que l'écran fait lui-même à l'ouverture, mais
 *  ici comme preuve indépendante du DOM. */
function getDocumentEmailTemplate(typeId: string) {
	return cy
		.request({ url: `${api}/api/documents/types/${typeId}/email-template` })
		.its("body") as Cypress.Chainable<DocumentEmailTemplateApiView>;
}

/** Ouvre l'éditeur d'un type par un clic réel sur son toggle, et attend que le champ sujet soit bien
 *  monté avant de continuer — l'éditeur n'existe dans le DOM que pendant que la ligne est dépliée
 *  (`templates.settings.tsx`'s own "un seul éditeur ouvert à la fois"). N'exige que l'EXISTENCE, pas
 *  la visibilité : `<main>` (`-[tab].tsx`) est un panneau `overflow-auto`, et une carte pour un type
 *  situé plus bas dans la liste (ex. "invoice") s'ouvre hors du viewport visible tant qu'on n'a pas
 *  scrollé — Cypress rapporte alors, à raison, un champ "clipped by a parent... overflow", ce qui
 *  n'est pas un bug de l'écran. Les actions réelles qui suivent (`.clear()`/`.type()`) scrollent
 *  elles-mêmes l'élément dans la vue avant d'agir. */
function openTemplateEditor(typeId: string) {
	cy.get(`[data-cy="email-template-toggle-${typeId}"]`, { timeout: 15000 }).click();
	cy.get(`[data-cy="email-template-subject-${typeId}"]`, { timeout: 10000 }).should("exist");
}

describe("Settings — gabarits d'email par type de document", () => {
	// Une seule capture du gabarit PAR DÉFAUT de "quote", prise avant que tout test n'y touche —
	// c'est CE gabarit-là (pas une valeur recopiée à la main, qui divergerait le jour où le
	// descripteur change) que le test de révocation doit retrouver.
	let quoteDefaultTemplate: DocumentEmailTemplateApiView;

	before(() => {
		cy.resetAndSeed();
		cy.login();
		getDocumentEmailTemplate("quote").then((template) => {
			quoteDefaultTemplate = template;
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it("l'onglet charge sur /settings/email et liste chaque type de document avec le gabarit qui s'applique réellement", () => {
		cy.request({ url: `${api}/api/documents/types` })
			.its("body")
			.then((types: DocumentTypeSummary[]) => {
				const ids = types.map((type) => type.id);
				// Les cinq types que cette branche enregistre (documents-core.module.ts) — si l'un
				// disparaissait silencieusement du registre, c'est ICI que ça casserait, pas seulement
				// à l'écran.
				expect(ids, "les types de document que cette branche enregistre").to.include.members([
					"quote",
					"invoice",
					"credit-note",
					"expense",
					"received-invoice",
				]);

				cy.request({ url: `${api}/api/documents/email-templates` })
					.its("body")
					.then((templates: DocumentEmailTemplateApiView[]) => {
						cy.visit("/settings/email");
						cy.url().should("include", "/settings/email");

						for (const template of templates) {
							cy.get(`[data-cy="email-template-card-${template.typeId}"]`, { timeout: 15000 }).should(
								"exist",
							);
						}

						// Déplier UN type montre l'éditeur PRÉ-REMPLI avec exactement ce que l'API dit
						// s'appliquer — la preuve que l'écran charge le gabarit RÉSOLU, pas un formulaire
						// vide ni un texte codé en dur.
						const invoiceTemplate = templates.find((t) => t.typeId === "invoice");
						expect(invoiceTemplate, "le type invoice a une entrée").to.exist;
						openTemplateEditor("invoice");
						cy.get('[data-cy="email-template-subject-invoice"]').should(
							"have.value",
							invoiceTemplate!.subject,
						);
						cy.get('[data-cy="email-template-body-invoice"]').should("have.value", invoiceTemplate!.body);
					});
			});
	});

	it("modifier le sujet et le corps d'un type par l'écran les enregistre, et l'API rapporte une surcharge de la société", () => {
		const distinctiveSubject = "Sujet distinctif e2e {displayNumber}";
		const distinctiveBody = "Corps distinctif e2e — rien à voir avec le gabarit livré.";

		cy.visit("/settings/email");
		openTemplateEditor("quote");

		// `{displayNumber}` contient des accolades qu'un `.type()` cypress interpréterait sinon comme
		// une séquence spéciale (`{selectall}`, etc.) — désactivé ici pour taper l'accolade littérale.
		cy.get('[data-cy="email-template-subject-quote"]')
			.clear()
			.type(distinctiveSubject, { parseSpecialCharSequences: false });
		cy.get('[data-cy="email-template-body-quote"]').clear().type(distinctiveBody);
		cy.get('[data-cy="email-template-save-quote"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "saved successfully");

		getDocumentEmailTemplate("quote").then((stored) => {
			expect(stored.subject, "exactement ce qui a été tapé, sans altération").to.eq(distinctiveSubject);
			expect(stored.body, "exactement ce qui a été tapé, sans altération").to.eq(distinctiveBody);
			expect(stored.source, "la société a maintenant sa propre surcharge pour ce type").to.eq("company");
		});
	});

	it("la révocation par l'écran fait réapparaître le gabarit livré, et source n'est plus une surcharge", () => {
		cy.visit("/settings/email");
		openTemplateEditor("quote");

		cy.get('[data-cy="email-template-reset-quote"]').click();
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "reset to its default");

		getDocumentEmailTemplate("quote").then((restored) => {
			expect(restored.source, "ce n'est plus une surcharge de la société").to.not.eq("company");
			expect(
				restored.subject,
				"revenu exactement au gabarit livré capturé avant que quoi que ce soit n'y touche",
			).to.eq(quoteDefaultTemplate.subject);
			expect(restored.body).to.eq(quoteDefaultTemplate.body);
		});
	});

	it("un placeholder inconnu s'enregistre AVEC SUCCÈS et fait apparaître un avertissement — signalé, jamais refusé", () => {
		const subjectWithTypo = "Merci pour votre devis {notAThing}";

		cy.visit("/settings/email");
		openTemplateEditor("quote");

		// Aucun avertissement avant cet enregistrement — l'état vient d'être rechargé depuis zéro.
		cy.get('[data-cy="email-template-warnings"]').should("not.exist");

		cy.get('[data-cy="email-template-subject-quote"]')
			.clear()
			.type(subjectWithTypo, { parseSpecialCharSequences: false });
		cy.get('[data-cy="email-template-save-quote"]').click();

		// L'enregistrement a RÉUSSI (jamais un 400) — un toast de succès, jamais un toast d'erreur.
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "saved successfully");

		cy.get('[data-cy="email-template-warnings"]', { timeout: 10000 })
			.should("exist")
			.and("contain.text", "notAThing");

		getDocumentEmailTemplate("quote").then((stored) => {
			expect(
				stored.subject,
				"la faute de frappe traverse jusqu'au stockage — signalée, jamais amputée ni refusée",
			).to.include("{notAThing}");
		});
	});

	it("refuse un sujet vide — le bouton Enregistrer se désactive plutôt que d'envoyer une requête, et l'API elle-même répond 400", () => {
		cy.visit("/settings/email");
		openTemplateEditor("quote");

		cy.get('[data-cy="email-template-subject-quote"]').clear();
		cy.get('[data-cy="email-template-save-quote"]').should("be.disabled");

		// Le second côté du même contrat, prouvé directement contre l'API — jamais fié uniquement à
		// ce que l'écran empêche de faire.
		cy.request({
			method: "PUT",
			url: `${api}/api/documents/types/quote/email-template`,
			body: { subject: "", body: "Un corps" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "le serveur lui-même refuse un sujet vide").to.eq(400);
		});
	});

	it("le vocabulaire de placeholders est GENUINEMENT par type — invoice et expense n'annoncent pas la même liste", () => {
		getDocumentEmailTemplate("invoice").then((invoiceTemplate) => {
			getDocumentEmailTemplate("expense").then((expenseTemplate) => {
				const invoiceKeys = Object.keys(invoiceTemplate.variables).sort();
				const expenseKeys = Object.keys(expenseTemplate.variables).sort();

				expect(
					invoiceKeys,
					"invoice a un champ client ET des lignes chiffrées — les deux placeholders dérivés",
				).to.include.members(["recipientName", "totalGross"]);
				expect(
					expenseKeys,
					"une dépense n'a ni référence client ni total de lignes — jamais un placeholder qu'un vrai envoi ne pourrait remplir",
				).to.not.include.members(["recipientName", "totalGross"]);
				expect(
					invoiceKeys,
					"les deux listes sont réellement différentes, pas le même ensemble simplement relabellisé",
				).to.not.deep.equal(expenseKeys);
			});
		});
	});

	// Le payoff bout en bout : le sujet configuré par l'écran doit être celui que Mailpit reçoit
	// réellement — même discipline que 23-document-email.cy.ts (relecture Mailpit, jamais devinée),
	// et même mécanique de clic que 42-webhooks.cy.ts pour l'envoi d'une facture : l'action "send" de
	// invoice ne déclare AUCUN param (invoice.descriptor.ts), donc un clic réel l'exécute directement
	// sans dialogue — voir use-document-action-runner.ts's own `if (!action.params ...)`.
	it("un sujet distinctif configuré pour invoice se retrouve, interpolé, dans le vrai email envoyé", () => {
		const marker = "E2E-TEMPLATE-MARKER";
		const distinctiveSubject = `${marker} {displayNumber}`;

		cy.visit("/settings/email");
		openTemplateEditor("invoice");
		cy.get('[data-cy="email-template-subject-invoice"]')
			.clear()
			.type(distinctiveSubject, { parseSpecialCharSequences: false });
		cy.get('[data-cy="email-template-save-invoice"]').click();
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "saved successfully");

		cy.clearEmails();

		// Sans transport configuré, "send" refuse tout net (501, `invoice-actions.ts`'s own
		// `getCompanyInvoiceTransportId` guard) — un frais `resetAndSeed()` n'en configure aucun, donc
		// ce réglage est un préalable au clic, pas la chose sous test ici (même étape que
		// 42-webhooks.cy.ts avant son propre envoi de facture).
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport email configuré").to.be.oneOf([200, 201]);
		});

		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Email Template E2E Co",
				contactEmail: "email-template-e2e-client@example.com",
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Template Street",
				city: "Paris",
				postalCode: "75004",
				isActive: true,
				type: "COMPANY",
			},
			failOnStatusCode: false,
		}).then((created) => {
			expect(created.status, "client (avec un vrai email de contact) créé").to.eq(201);
			const clientId = created.body.id as string;

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: {
					data: {
						client: clientId,
						issueDate: "2026-08-31",
						dueDate: "2026-09-30",
						currency: "EUR",
						lines: [
							{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" },
						],
					},
				},
				failOnStatusCode: false,
			}).then((saved) => {
				expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
				const invoiceId = saved.body?.document?.id as string;
				expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();
				// The `timeout` that actually governs a `.should()` retry belongs on the LAST queryable
				// command before it — putting it on the outer `.get()` alone (as a first pass here did)
				// silently caps the retry at Cypress' 4s default instead of the 20s this async send
				// (BullMQ) genuinely needs.
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`)
					.find('[data-cy="document-status-badge"]', { timeout: 20000 })
					.should("contain.text", "Sent");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.displayNumber, "la facture envoyée porte un numéro").to.be.a("string");

						cy.getLastEmail().then((message: any) => {
							expect(
								message.To?.[0]?.Address,
								"le message va au contact du client réellement facturé",
							).to.eq("email-template-e2e-client@example.com");
							expect(
								message.Subject,
								"le sujet du VRAI message porte à la fois le marqueur du gabarit et le displayNumber interpolé",
							).to.eq(`${marker} ${doc.displayNumber}`);
						});
					});
			});
		});
	});
});
