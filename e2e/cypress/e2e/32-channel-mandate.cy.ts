/**
 * Le canal imposé par pays (root TODO item 11, "canal imposé par pays") — la France impose désormais
 * PDP aux factures dont la date d'ÉMISSION (issueDate) est le 2026-09-01 ou plus tard
 * (`backend/.../transports/channel-policy/data/fr.json`, source reprise du repère git
 * `avant-refonte-documents`, voir ce fichier). Ce spec prouve, par l'écran, les trois effets du
 * mécanisme décrits dans le TODO :
 *
 *  1. l'écran Canaux montre un badge « imposé » distinct du badge « suggéré », avec sa source ;
 *  2. envoyer une facture ÉMISE à/après le mandat par un AUTRE transport (ici : email, le défaut
 *     produit) est refusé au PREFLIGHT — jamais persisté au-delà de "draft" — avec un message qui
 *     nomme le canal imposé et sa source ;
 *  3. connecter le canal imposé (par l'écran, comme en 31) puis le choisir comme transport fait
 *     PASSER le mandat : l'envoi n'est plus refusé pour ce motif — il échoue ensuite, comme en 31,
 *     au dépôt réel contre un serveur fictif (fake baseUrl), jamais au mandat.
 *
 * La régression que ce fichier protège explicitement : une facture ÉMISE AVANT le mandat part
 * librement par n'importe quel transport — le mandat ne mord jamais la date du jour du serveur, il
 * mord la date d'ÉMISSION du document (voir `channel-policy/mandate.ts`'s own header). C'est aussi ce
 * que les 14 tests de 31-national-channels.cy.ts prouvent déjà en creux (leurs factures y sont toutes
 * émises le 2026-08-31, avant le mandat) — ce fichier le rend explicite.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

/** Même identifiants fictifs que 31 — voir ce fichier's own header pour pourquoi (port 1, jamais
 *  ouvert sur une machine normale : ECONNREFUSED immédiat, aucune vraie plateforme derrière). */
const FAKE_PDP = {
	baseUrl: "http://127.0.0.1:1",
	clientId: "e2e-fake-client-id",
	clientSecret: "e2e-fake-client-secret",
};

function setInvoiceTransport(transportId: string | null) {
	return cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: { invoiceTransportId: transportId },
		failOnStatusCode: false,
	});
}

function createInvoiceDraft(issueDate: string) {
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
							issueDate,
							dueDate: "2026-12-31",
							currency: "EUR",
							lines: [
								{ description: "Conseil", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" },
							],
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
		});
}

describe("Canal imposé par pays — la France impose PDP aux factures émises depuis le 2026-09-01", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("l'écran Canaux montre le badge « imposé » pour PDP, distinct du badge « suggéré », avec sa source visible", () => {
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-pdp"]', { timeout: 15000 }).should("exist");
		// Le badge « suggéré » reste vrai même une fois le canal imposé — un mandat renforce une
		// suggestion, il ne la contredit pas (voir channels.settings.tsx's own comment).
		cy.get('[data-cy="channel-pdp-suggested"]').should("exist");
		cy.get('[data-cy="channel-pdp-mandated"]', { timeout: 10000 })
			.should("exist")
			.and("contain.text", "2026-09-01");
		// La source (la citation reprise du repère) est visible dans la description de la carte.
		cy.get('[data-cy="channel-pdp"]').should("contain.text", "plateforme agréée");
	});

	it("une facture ÉMISE AVANT le mandat (2026-08-31) part librement par email — le mandat ne mord jamais la date du jour", () => {
		setInvoiceTransport("email");
		createInvoiceDraft("2026-08-31").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");
		});
	});

	it('une facture ÉMISE le jour du mandat (2026-09-01), transport encore "email" → refus au PREFLIGHT, jamais persisté au-delà de "draft", message nommant PDP et sa source', () => {
		// Le transport reste "email" (test précédent) — c'est exactement le cas que le mandat doit
		// désormais refuser : le choix libre de la société ne suffit plus une fois le mandat actif.
		createInvoiceDraft("2026-09-01").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			// Le préflight bloque de façon SYNCHRONE, avant tout passage par la file — un toast visible
			// le dit tout de suite, même discipline que le test "déconnecte le canal" de 31.
			cy.get('[data-sonner-toast]', { timeout: 10000 })
				.should("contain.text", "pdp")
				.and("contain.text", "2026-09-01");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, 'jamais persisté au-delà de "draft" — bloqué avant toute écriture').to.eq(
						"draft",
					);
				});
		});
	});

	it("transport choisi = pdp (le canal imposé) mais NON CONNECTÉ → même refus nommé, jamais persisté", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', { timeout: 15000 }).click();
		cy.get('[data-cy="company-invoice-transport-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-pdp"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);

		createInvoiceDraft("2026-09-02").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			cy.get('[data-sonner-toast]', { timeout: 10000 })
				.should("contain.text", "PDP")
				.and("contain.text", "not connected");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, 'jamais persisté au-delà de "draft"').to.eq("draft");
				});
		});
	});

	it("connecte PDP par l'écran → le mandat ne bloque plus : la file part réellement et échoue ensuite au dépôt fictif, jamais au mandat (comme en 31)", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-pdp-baseurl-input"]', { timeout: 15000 }).clear().type(FAKE_PDP.baseUrl);
		cy.get('[data-cy="channel-pdp-clientid-input"]').clear().type(FAKE_PDP.clientId);
		cy.get('[data-cy="channel-pdp-clientsecret-input"]').clear().type(FAKE_PDP.clientSecret);
		cy.get('[data-cy="channel-pdp-connect-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel connected");
		cy.get('[data-cy="channel-pdp-status"]', { timeout: 10000 }).should("contain.text", "Connected");

		createInvoiceDraft("2026-09-03").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

			// Même budget documenté que 31 : ATTEMPTS=3 par défaut, backoff exponentiel base 2000ms.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
				.find('[data-cy="document-status-badge"]', { timeout: 40000 })
				.should("contain.text", "Send failed");

			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`)
				.should("contain.text", "PDP")
				// La cause du "Send failed" est bien le serveur fictif (le dépôt réel a échoué), jamais
				// le mandat — le mandat est SATISFAIT (le bon canal est choisi et connecté).
				.and("not.contain.text", "requires invoices");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, 'la facture est réellement "send_failed" en base').to.eq("send_failed");
					expect(doc.transportRef, "aucune référence de dépôt sans dépôt réel").to.not.be.a("string");
				});
		});
	});
});
