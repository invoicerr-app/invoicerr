/**
 * Internal approval workflow (TODO_FEATURES.md rank 17) — a MEMBER can NOT SEND an
 * invoice whose total exceeds the company's approval threshold without an ADMIN/OWNER; an
 * OWNER can (their send IS the approval). Proven end-to-end with a REAL MEMBER session
 * (created via invitation), which the jest tests don't cover: the controller's own `@ActiveRole`
 * wiring → `runAction`. The gate's own logic (role × total × threshold) is covered/bitten in
 * jest (`approval/approval-gate.spec.ts`); here the real block on the real endpoint is proven.
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

describe("Approval beyond a threshold — a MEMBER is blocked, an OWNER goes through", () => {
	let clientId: string;

	before(() => {
		cy.resetAndSeed();
		cy.login(); // OWNER (john.doe@acme.org)
		// Threshold + email transport, at the company level.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { approvalThresholdMinor: THRESHOLD_MINOR, invoiceTransportId: "email" },
		}).then((res) => expect(res.status).to.be.oneOf([200, 201]));
		// A client of the company.
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
		// An invitation, then sign-up of a MEMBER who joins the company.
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

	it("a MEMBER can NOT send an invoice ABOVE the threshold (403), and the invoice stays a draft", () => {
		memberSession();
		// 1200.00 € gross (1000 net + 20%) = 120000 minor > 50000 → blocked.
		saveDraftThenSend(clientId, 1000).then(({ id, sendStatus }) => {
			expect(sendStatus, "envoi refusé faute d'approbation").to.eq(403);
			// Nothing was sent: the invoice is still a draft.
			cy.request({ url: `${api}/api/documents/${id}?typeId=invoice` })
				.its("body.status")
				.should("eq", "draft");
		});
	});

	it("a MEMBER CAN send an invoice BELOW the threshold", () => {
		memberSession();
		// 120.00 € gross (100 net + 20%) = 12000 minor < 50000 → allowed.
		saveDraftThenSend(clientId, 100).then(({ id, sendStatus }) => {
			expect(sendStatus, "envoi accepté sous le seuil").to.be.oneOf([200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
		});
	});

	it("an OWNER CAN send an invoice ABOVE the threshold — their send is the approval", () => {
		cy.login(); // returns to the OWNER session
		saveDraftThenSend(clientId, 1000).then(({ id, sendStatus }) => {
			expect(sendStatus, "un OWNER n'est jamais bloqué par le seuil").to.be.oneOf([200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
		});
	});
});
