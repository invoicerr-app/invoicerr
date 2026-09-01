/**
 * B2G routing (`backend/src/modules/documents/b2g-routing/`) — a client marked GOVERNMENT
 * (`Client.kind`) changes which channel/format an invoice addressed to it MUST use, per THAT
 * CLIENT's OWN country — never the seller's, and never overridable by the company's own free
 * transport choice or by root TODO item 11's own seller-country mandate (see
 * `actions/invoice-actions.ts`'s own precedence header).
 *
 * Same discipline as 31/32/35: the ACTION passes by a real click on screen (create the client,
 * click "Send", click the XML download button) ; the ASSERTIONS that matter reread the record via
 * the API, or intercept the real network request the click triggers — never the screen alone as
 * proof of what was decided or sent.
 *
 * Three countries, three shipped rules, three different shapes of proof:
 *  - FR (Chorus Pro): `transportId: "chorus-pro"` does not exist in `transport-registry.ts` — the
 *    thesis of this whole model (a rule may legitimately name a channel not implemented yet).
 *    Sending BLOCKS, synchronously, at the preflight — never persisted past "draft".
 *  - DE (the federal e-invoicing portal, ZRE/OZG-RE): SAME shape — `transportId: "zre-ozgre"`
 *    doesn't exist either (§4 Abs. 3 ERechV requires a PORTAL deposit, not email — see
 *    `b2g-routing/data/de.json`'s own header for why email was deliberately NOT chosen as a
 *    stand-in). GENUINE STRUCTURAL LIMIT FOUND WHILE WRITING THIS SPEC, worth recording rather than
 *    routing around: `download-xml` is only `availableWhen: ['sending', 'sent', 'send_failed']`
 *    (`invoice.descriptor.ts`'s own numbering paragraph — a "draft" has no invoice NUMBER yet, and
 *    BT-1 needs one) — and a B2G-blocked country's invoice NEVER reaches any of those three statuses
 *    (the whole point of blocking at the PREFLIGHT, before anything is persisted). So there is no
 *    screen path to ever download an XRechnung for a government invoice whose channel is not
 *    implemented — proving the Leitweg-ID/BR-DE-15 mechanism end-to-end stays a JEST-level guarantee
 *    (`formats/xrechnung-provider.spec.ts`, `documents.service.country-fields.spec.ts`'s own new B2G
 *    describe block for the field-hint bridge), not an E2E artifact. This spec proves what IS
 *    reachable on screen for DE: the client-side help panel, and the named channel block. A SEPARATE
 *    test below ("le champ Leitweg-ID … apparaît RÉACTIVEMENT") closes the OTHER named gap
 *    (`document-form.tsx`'s own screen wiring, `use-document-types.ts`'s `clientId`-aware descriptor
 *    fetch): the field ITSELF, appearing and disappearing on the invoice FORM as the user picks a
 *    client, never just at the service level. The structural limit above still holds for it too — it
 *    proves the field on screen and the SAME named block, never a downloaded XRechnung (still a
 *    JEST-only guarantee, same citation).
 *  - IT (SdI): the ONE rule whose channel is ALREADY implemented. The company's own free choice is
 *    deliberately set to "email" (a channel that WOULD succeed) to prove precedence for real: the
 *    invoice still fails via SdI (a fake, unreachable endpoint — same fixture as 31's own SdI wave),
 *    never silently through email.
 *
 * `cy.resetAndSeed()` seeds a FRENCH company (Acme Corp, SIRET/VAT already on file) — this file adds
 * an IBAN to it via the API before the DE case (BR-DE-1/23-a/23-b's own requirement, see
 * `formats/xrechnung-provider.ts`'s header) — the ONE piece Acme Corp's own seed doesn't carry, and
 * genuinely a company-level fact, not a per-invoice one.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const FAKE_SDI = {
	idTrasmittente: "IT01234567890",
	endpoint: "https://127.0.0.1:1/ricevi_file",
	certificate: "ZTJlLWZha2UtcGZ4LWNvbnRlbnRz",
	certificatePassword: "e2e-fake-cert-password",
};

function setInvoiceTransport(transportId: string) {
	return cy
		.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: transportId } })
		.then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});
}

// A plain BUSINESS client, created via the API — baseline data for the Leitweg-ID reactivity test
// below, never the subject of that test itself (same "create the setup by API, drive only the
// actual delta through the screen" convention 20-document-totals.cy.ts's own discount test already
// documents).
function createBusinessClient(name: string) {
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
			expect(res.status, "client BUSINESS créé par API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "le client créé a un identifiant").to.be.a("string");
			return id;
		});
}

function findClientIdByName(name: string) {
	return cy
		.request({ url: `${api}/api/documents/references/client/search?q=${encodeURIComponent(name)}` })
		.its("body")
		.then((clients: { id: string; label: string }[]) => {
			const client = clients.find((c) => c.label.includes(name));
			expect(client, `le client "${name}" créé ci-dessus se retrouve par la recherche`).to.exist;
			return client!.id;
		});
}

function createInvoiceDraft(clientId: string, extraData: Record<string, unknown> = {}) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate: "2026-09-15",
					dueDate: "2026-10-15",
					currency: "EUR",
					lines: [
						{ description: "Conseil", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" },
					],
					...extraData,
				},
			},
			failOnStatusCode: false,
		})
		.then((saved) => {
			expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
			const invoiceId = saved.body?.document?.id as string;
			expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");
			return invoiceId;
		});
}

describe("B2G routing — le client GOVERNMENT impose le canal/format de SON PAYS, jamais celui de la société", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("un client BUSINESS (le défaut) n'affiche AUCUNE aide B2G — régression : rien ne change pour lui", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[data-cy="client-kind-select"]').should("contain.text", "Business");
		cy.get('[data-cy="client-b2g-hint"]').should("not.exist");

		cy.get("body").type("{esc}");
	});

	it('FR — un client GOVERNMENT affiche l\'aide Chorus Pro, puis l\'envoi bloque nommément ("chorus-pro" pas encore disponible)', () => {
		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Mairie de Testville");
		cy.selectCountry("client-country-select", "France");

		cy.get('[data-cy="client-kind-select"]').click();
		cy.get('[data-cy="client-kind-government"]').click();

		// L'aide B2G — jamais un mur : le client se crée normalement, l'aide dit juste ce qui
		// attend l'envoi d'une facture à ce client.
		cy.get('[data-cy="client-b2g-hint"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="client-b2g-hint-channel"]')
			.should("contain.text", "chorus-pro")
			.and("contain.text", "facturx");
		cy.get('[data-cy="client-b2g-hint"]').should("contain.text", "Code de la commande publique");

		// Le SIRET — déjà exigé par le catalogue country-identifiers pour TOUT client français
		// (LEGAL_ID, appliesTo BOTH) : la règle B2G française le référence, elle n'a rien à ajouter
		// de nouveau à l'écran pour ce champ précis.
		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("21750001600017");

		cy.get('[name="contactEmail"]').clear().type("marches-publics@testville.example");
		cy.get('[name="address"]').clear().type("1 Place de la Mairie");
		cy.get('[name="postalCode"]').clear().type("75001");
		cy.get('[name="city"]').clear().type("Testville");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Mairie de Testville", { timeout: 10000 });

		findClientIdByName("Mairie de Testville").then((clientId) => {
			createInvoiceDraft(clientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

				// Bloqué SYNCHRONE, au préflight — jamais persisté au-delà de "draft", même si la
				// société a "email" comme transport (préséance B2G > choix libre de la société).
				cy.get('[data-sonner-toast]', { timeout: 10000 })
					.should("contain.text", "chorus-pro")
					.and("contain.text", "Code de la commande publique");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(
							doc.status,
							'jamais persisté au-delà de "draft" — Chorus Pro bloque avant toute écriture',
						).to.eq("draft");
					});
			});
		});
	});

	it("DE — un client GOVERNMENT affiche l'aide du portail fédéral, puis l'envoi bloque nommément (le portail ZRE/OZG-RE n'est pas encore connecté), jamais un envoi silencieux par email", () => {
		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Stadt Testhausen");
		cy.selectCountry("client-country-select", "Germany");

		cy.get('[data-cy="client-kind-select"]').click();
		cy.get('[data-cy="client-kind-government"]').click();

		cy.get('[data-cy="client-b2g-hint"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="client-b2g-hint-channel"]')
			.should("contain.text", "zre-ozgre")
			.and("contain.text", "xrechnung");
		cy.get('[data-cy="client-b2g-hint"]').should("contain.text", "ERechV");
		cy.get('[data-cy="client-b2g-hint"]').should("contain.text", "Leitweg");

		cy.get('[name="contactEmail"]').clear().type("rechnungen@testhausen.example");
		cy.get('[name="address"]').clear().type("Rathausplatz 1");
		cy.get('[name="postalCode"]').clear().type("10117");
		cy.get('[name="city"]').clear().type("Testhausen");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Stadt Testhausen", { timeout: 10000 });

		findClientIdByName("Stadt Testhausen").then((clientId) => {
			// data.buyerReference (Leitweg-ID) — voir ce fichier's own header : le champ overlay/
			// buyerReference existe génériquement (`shared-build.ts#extractBuyerReference`) et le
			// backend l'offre désormais aussi sur l'écran de création dès qu'un client GOVERNMENT est
			// choisi (`documents.service.ts#applyB2gDocumentFieldHints`, prouvé par
			// `documents.service.country-fields.spec.ts`) — mais l'écran de création de facture ne
			// branche pas encore l'id du client choisi vers cette récupération pour l'offrir
			// INTERACTIVEMENT ; posé ici via l'API, comme le ferait ce champ une fois câblé.
			createInvoiceDraft(clientId, { buyerReference: "04011000-1234512345-06" }).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				// Le CANAL bloque, nommément, SYNCHRONE au préflight — jamais persisté au-delà de
				// "draft" (donc jamais numéroté — voir ce fichier's own header : c'est exactement ce
				// qui rend un téléchargement XRechnung inatteignable par l'écran pour CE document).
				// Jamais un envoi silencieux par email, quel que soit le transport choisi par la société.
				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();
				cy.get('[data-sonner-toast]', { timeout: 10000 })
					.should("contain.text", "zre-ozgre")
					.and("contain.text", "ERechV");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, 'jamais persisté au-delà de "draft"').to.eq("draft");
					});
			});
		});
	});

	// Le trou nommé par 3cb39f91 : le champ Leitweg (`buyerReference`) n'était prouvé qu'au NIVEAU
	// SERVICE (`documents.service.country-fields.spec.ts`) — le formulaire de création ne passait
	// jamais le client sélectionné au descripteur (`?clientId=`), donc le champ n'apparaissait jamais
	// À L'ÉCRAN, quel que soit le client choisi. `document-form.tsx` watche désormais le champ
	// "client" du formulaire et refait vivre `useDocumentType(typeId, clientId)`
	// (`use-document-types.ts`) — ce test le prouve PAR L'ÉCRAN : le champ est absent avec un client
	// BUSINESS, apparaît dès que "Stadt Testhausen" (le client GOVERNMENT allemand du test précédent,
	// même fichier) est choisi — jamais un rechargement de page.
	//
	// Le brouillon de départ est créé par API avec un client BUSINESS ordinaire (donnée de base —
	// voir createBusinessClient's own header) ; SEUL le changement de client, le remplissage du
	// Leitweg et l'enregistrement passent par l'écran, exactement la portion que ce trou concerne.
	// Le téléchargement XRechnung lui-même reste hors de portée de CE test — voir l'en-tête de ce
	// fichier ("GENUINE STRUCTURAL LIMIT") : un B2G bloqué au préflight ne numérote jamais, et
	// "download-xml" exige un numéro ; la preuve que ce Leitweg-ID atterrit bien en BT-10 reste donc
	// au niveau Jest (`xrechnung-provider.spec.ts`, même valeur "04011000-1234512345-06").
	it("DE — le champ Leitweg-ID (buyerReference) apparaît RÉACTIVEMENT à l'écran dès qu'un client GOVERNMENT allemand est choisi dans le formulaire (jamais avant, jamais pour un client BUSINESS), avec son aide sourcée ; l'envoi bloque toujours nommément sur zre-ozgre", () => {
		setInvoiceTransport("email");

		createBusinessClient("Client Ordinaire SARL").then((businessClientId) => {
			createInvoiceDraft(businessClientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, { timeout: 15000 }).click();
				cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should("be.visible");

				// AVANT tout changement : le client chargé est BUSINESS — aucun champ Leitweg à l'écran.
				cy.get('[data-cy="document-field-buyerReference"]').should("not.exist");

				// Change le client, À L'ÉCRAN, vers "Stadt Testhausen" — le client GOVERNMENT allemand
				// créé par le test DE précédent (même describe, même `before`, données conservées).
				cy.get('[data-cy="document-field-client-input"] button').first().click({ force: true });
				cy.get('[data-cy="document-field-client-input-options"]', { timeout: 10000 }).should(
					"be.visible",
				);
				cy.get('[data-cy="document-field-client-input"] input').type("Stadt Testhausen");
				cy.contains(
					'[data-cy="document-field-client-input-options"] button',
					"Stadt Testhausen",
					{ timeout: 10000 },
				).click();

				// RÉACTIF, sans rechargement de page : le champ apparaît, avec son `why` (le texte de
				// l'ERechV) sourcé en aide — jamais juste un label nu. Il est ajouté en QUEUE de
				// descripteur (`applyFieldOverlay`'s own "add"), donc hors du cadre visible de la boîte
				// de dialogue tant qu'on ne l'y fait pas défiler — même motif que le SearchSelect de la
				// devise ailleurs dans cette suite.
				cy.get('[data-cy="document-field-buyerReference"]', { timeout: 10000 })
					.scrollIntoView()
					.should("be.visible");
				cy.get('[data-cy="document-field-buyerReference"]').should("contain.text", "ERechV");

				cy.get('[data-cy="document-field-buyerReference-input"]').scrollIntoView().clear().type("04011000-1234512345-06");

				// Attend la VRAIE requête réseau plutôt que la visibilité du formulaire après coup (le
				// défilement provoqué par scrollIntoView ci-dessus rend cette dernière fragile) — même
				// motif que 20-document-totals.cy.ts's own discount test.
				cy.intercept("POST", `${api}/api/documents/types/invoice/actions/save-draft`).as("saveDraft");
				cy.get('[data-cy="document-action-save-draft"]').scrollIntoView().click();
				cy.wait("@saveDraft").its("response.statusCode").should("be.oneOf", [200, 201]);

				// L'envoi bloque toujours, nommément, sur zre-ozgre — CE détour par l'écran ne change
				// rien à la préséance B2G ; jamais un envoi silencieux par email.
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();
				cy.get('[data-sonner-toast]', { timeout: 10000 })
					.should("contain.text", "zre-ozgre")
					.and("contain.text", "ERechV");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, 'jamais persisté au-delà de "draft"').to.eq("draft");
						// Le client ET le Leitweg tapés à l'écran sont bien ceux qui ont été enregistrés
						// — pas seulement affichés le temps d'un rendu.
						expect(doc.data?.client, "le nouveau client est bien celui enregistré").to.not.eq(
							businessClientId,
						);
						expect(
							doc.data?.buyerReference,
							"le Leitweg-ID tapé à l'écran est bien sauvegardé",
						).to.eq("04011000-1234512345-06");
					});
			});
		});
	});

	it("IT — un client GOVERNMENT exige le Codice Univoco Ufficio (IPA) ; l'envoi force SdI même si la société a choisi email, et échoue réellement (port fermé), jamais par email", () => {
		// Le canal SdI, connecté par l'écran, identifiants fictifs (port fermé — même fixture que 31).
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-sdi"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-sdi-idtrasmittente-input"]').clear().type(FAKE_SDI.idTrasmittente);
		cy.get('[data-cy="channel-sdi-endpoint-input"]').clear().type(FAKE_SDI.endpoint);
		cy.get('[data-cy="channel-sdi-certificate-input"]').clear().type(FAKE_SDI.certificate);
		cy.get('[data-cy="channel-sdi-certificatepassword-input"]').clear().type(FAKE_SDI.certificatePassword);
		cy.get('[data-cy="channel-sdi-connect-button"]').click();
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 10000 }).should("contain.text", "Connected");

		// La société choisit "email" — un canal qui MARCHERAIT réellement (Mailpit). La préséance B2G
		// doit l'ignorer complètement.
		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Comune di Testopoli");
		cy.selectCountry("client-country-select", "Italy");

		cy.get('[data-cy="client-kind-select"]').click();
		cy.get('[data-cy="client-kind-government"]').click();

		cy.get('[data-cy="client-b2g-hint"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="client-b2g-hint-channel"]').should("contain.text", "sdi").and("contain.text", "fatturapa");
		cy.get('[data-cy="client-b2g-hint"]').should("contain.text", "Specifiche tecniche");

		// Le Codice Univoco Ufficio (IPA) — un champ NOUVEAU, offert UNIQUEMENT parce que ce client
		// est GOVERNMENT (jamais pour un client italien ordinaire — voir b2g-routing/data/it.json).
		cy.get('[data-cy="client-identifier-IT_PA_CODE"]', { timeout: 10000 })
			.should("exist")
			.clear()
			.type("UFE0A1");

		cy.get('[name="contactEmail"]').clear().type("fatturazione@testopoli.example");
		cy.get('[name="address"]').clear().type("Via Roma 1");
		cy.get('[name="postalCode"]').clear().type("00100");
		cy.get('[name="city"]').clear().type("Testopoli");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Comune di Testopoli", { timeout: 10000 });

		findClientIdByName("Comune di Testopoli").then((clientId) => {
			createInvoiceDraft(clientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

				// Asynchrone (le canal B2G, sdi, EST implémenté et connecté) : la file échoue
				// réellement contre le port fermé — jamais un succès silencieux via email.
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
					.find('[data-cy="document-status-badge"]', { timeout: 40000 })
					.should("contain.text", "Send failed");
				cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should("contain.text", "SdI");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, 'la facture échoue réellement via SdI, jamais "sent" par email').to.eq(
							"send_failed",
						);
						expect(doc.lastActionError, "l'erreur nomme SdI, jamais email").to.match(/SdI/);
					});
			});
		});

		// Nettoyage — laisse le canal déconnecté pour ne pas polluer un autre spec qui relirait
		// company/channels après celui-ci (même discipline que 31's own dernier test).
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 15000 }).should("contain.text", "Connected");
		cy.get('[data-cy="channel-sdi-disconnect-button"]').click();
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 10000 }).should("contain.text", "Not connected");
	});

	it('un pays GOVERNMENT sans règle B2G déclarée refuse honnêtement — jamais un envoi B2B silencieux (mutation guard #2, à l\'échelle "écran")', () => {
		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Ministry of Nowhere");
		cy.selectCountry("client-country-select", "United States");

		cy.get('[data-cy="client-kind-select"]').click();
		cy.get('[data-cy="client-kind-government"]').click();

		// Aucune règle B2G pour US dans cette vague (fr/de/it seuls) — l'aide le dit honnêtement.
		cy.get('[data-cy="client-b2g-hint-no-rule"]', { timeout: 10000 }).should("be.visible");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("12-3456789");
		cy.get('[name="contactEmail"]').clear().type("procurement@nowhere.example");
		cy.get('[name="address"]').clear().type("1 Federal Plaza");
		cy.get('[name="postalCode"]').clear().type("10001");
		cy.get('[name="city"]').clear().type("Nowhere City");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Dollar");
		cy.get('[data-cy="client-currency-select-option-united-states-dollar-($)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Ministry of Nowhere", { timeout: 10000 });

		findClientIdByName("Ministry of Nowhere").then((clientId) => {
			createInvoiceDraft(clientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

				cy.get('[data-sonner-toast]', { timeout: 10000 })
					.should("contain.text", "No B2G routing rule is declared for \"US\"");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, "jamais un envoi B2B silencieux pour un pays non couvert").to.eq(
							"draft",
						);
					});
			});
		});
	});
});
