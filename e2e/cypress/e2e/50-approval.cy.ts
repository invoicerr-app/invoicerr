/**
 * Workflow d'approbation interne (TODO_FEATURES.md rang 17) — un MEMBER ne peut PAS ENVOYER une
 * facture dont le total dépasse le seuil d'approbation de la société sans un ADMIN/OWNER ; un
 * OWNER le peut (son envoi EST l'approbation). Prouvé bout-en-bout avec une VRAIE session MEMBER
 * (créée par invitation), ce que les tests jest ne couvrent pas : le câblage `@ActiveRole` du
 * contrôleur → `runAction`. La logique de la garde (rôle × total × seuil) est couverte/mordue en
 * jest (`approval/approval-gate.spec.ts`) ; ici on prouve le blocage réel sur le vrai endpoint.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const MEMBER_EMAIL = "member-approval@example.com";
const PASSWORD = "Super_Secret_Password123!";
const THRESHOLD_MINOR = 50000; // 500,00 EUR

function memberSession() {
	cy.session("member-approval-session", () => {
		cy.visit("/auth/sign-in");
		cy.get('[data-cy="auth-email-input"]').type(MEMBER_EMAIL);
		cy.get('[data-cy="auth-password-input"]').type(PASSWORD);
		cy.get('[data-cy="auth-submit-btn"]').click();
		cy.url({ timeout: 20000 }).should("include", "/dashboard");
	});
}

function invoiceData(clientId: string, unitPrice: number) {
	return {
		client: clientId,
		issueDate: "2026-08-30",
		dueDate: "2026-09-30",
		currency: "EUR",
		lines: [{ description: "Consulting", quantity: 1, unit: "day", unitPrice, vatRate: "20" }],
	};
}

function saveDraftThenSend(clientId: string, unitPrice: number) {
	const data = invoiceData(clientId, unitPrice);
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			expect(id, "brouillon créé").to.be.a("string");
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: id, data },
					failOnStatusCode: false,
				})
				.then((sent) => ({ id, sendStatus: sent.status }));
		});
}

describe("Approbation au-delà d'un seuil — un MEMBER est bloqué, un OWNER passe", () => {
	let clientId: string;

	before(() => {
		cy.resetAndSeed();
		cy.login(); // OWNER (john.doe@acme.org)
		// Seuil + transport email, au niveau société.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { approvalThresholdMinor: THRESHOLD_MINOR, invoiceTransportId: "email" },
		}).then((res) => expect(res.status).to.be.oneOf([200, 201]));
		// Un client de la société.
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Approval Client SARL",
				contactEmail: "approval-client@example.com",
				currency: "EUR",
				country: "FR",
				address: "1 Rue de l'Approbation",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		}).then((res) => {
			clientId = res.body.id as string;
		});
		// Une invitation, puis inscription d'un MEMBER qui rejoint la société.
		cy.request({ method: "POST", url: `${api}/api/invitations`, body: { expiresInDays: 7 } })
			.its("body.code")
			.then((code: string) => {
				cy.clearCookies();
				cy.visit("/auth/sign-up");
				cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).should("be.visible").type(code);
				cy.get('[data-cy="auth-firstname-input"]').type("Mia");
				cy.get('[data-cy="auth-lastname-input"]').type("Member");
				cy.get('[data-cy="auth-email-input"]').type(MEMBER_EMAIL);
				cy.get('[data-cy="auth-password-input"]').type(PASSWORD);
				cy.get('[data-cy="auth-submit-btn"]').click();
				cy.url({ timeout: 20000 }).should("include", "/auth/sign-in");
			});
	});

	it("un MEMBER ne peut PAS envoyer une facture AU-DESSUS du seuil (403), et la facture reste en brouillon", () => {
		memberSession();
		// 1200,00 € TTC (1000 net + 20 %) = 120000 minor > 50000 → bloqué.
		saveDraftThenSend(clientId, 1000).then(({ id, sendStatus }) => {
			expect(sendStatus, "envoi refusé faute d'approbation").to.eq(403);
			// Rien n'a été émis : la facture est toujours un brouillon.
			cy.request({ url: `${api}/api/documents/${id}?typeId=invoice` })
				.its("body.status")
				.should("eq", "draft");
		});
	});

	it("un MEMBER PEUT envoyer une facture EN DESSOUS du seuil", () => {
		memberSession();
		// 120,00 € TTC (100 net + 20 %) = 12000 minor < 50000 → autorisé.
		saveDraftThenSend(clientId, 100).then(({ id, sendStatus }) => {
			expect(sendStatus, "envoi accepté sous le seuil").to.be.oneOf([200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
		});
	});

	it("un OWNER PEUT envoyer une facture AU-DESSUS du seuil — son envoi est l'approbation", () => {
		cy.login(); // revient à la session OWNER
		saveDraftThenSend(clientId, 1000).then(({ id, sendStatus }) => {
			expect(sendStatus, "un OWNER n'est jamais bloqué par le seuil").to.be.oneOf([200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
		});
	});
});
