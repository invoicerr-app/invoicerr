export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #477: an e-signature must bind to the exact version the client read.
 *
 * Proven through the screen, on the anonymous client side, with the real token and the real OTP read
 * from Mailpit (never guessed):
 *  1. a valid link shows the delivered PDF and the options of the version it was sent for;
 *  2. the client asks for a code, the issuer edits the sent quote (Premium 300 -> 900, the option
 *     NAMES unchanged, which #475's "option no longer exists" check could never catch) and sends it
 *     again WITHOUT a new signature request; the client presses Sign with the code in hand: refused,
 *     the page says the document changed, and the quote is NOT signed;
 *  3. the old link, opened again, shows only that explanation;
 *  4. a new request, issued after the new send, signs the new version.
 *
 * The edit goes through the same "save-draft" action the document form's own Save button calls,
 * followed by the same "send" action: the two calls an issuer's "fix a typo and send again" makes.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function bodyOf(message: { Text?: string; HTML?: string }): string {
	return `${message.Text ?? ""}\n${message.HTML ?? ""}`;
}

const CLIENT_EMAIL = "bound-version@example.com";

function quoteData(clientId: string, premiumPrice: number) {
	return {
		client: clientId,
		issueDate: new Date().toISOString().slice(0, 10),
		currency: "EUR",
		lines: [
			{ description: "Basic line", quantity: 1, unitPrice: 100, option: "Basic", vatRate: "20" },
			{
				description: "Premium line",
				quantity: 1,
				unitPrice: premiumPrice,
				option: "Premium",
				vatRate: "20",
			},
		],
	};
}

function authed(authCookie: string) {
	return { Cookie: `better-auth.session_token=${authCookie}` };
}

/** Requests a signature (as the issuer) and returns the token read from the emailed link. */
function requestSignature(
	quoteId: string,
	data: Record<string, unknown>,
	authCookie: string,
): Cypress.Chainable<string> {
	cy.clearEmails();
	cy.request({
		method: "POST",
		url: `${api}/api/documents/types/quote/actions/request-signature`,
		headers: authed(authCookie),
		body: { documentId: quoteId, data },
	}).then((res) => {
		expect(res.status, "signature request accepted").to.be.oneOf([200, 201]);
	});
	return cy.getLastEmail().then((message: { Text?: string; HTML?: string }) => {
		const match = bodyOf(message).match(/\/signature\/([0-9a-f]{64})/);
		expect(match, "the signature request email carries the token link").to.not.be.null;
		return (match as RegExpMatchArray)[1];
	});
}

/** Sends the quote (as the issuer) and waits until it is "sent". */
function send(quoteId: string, data: Record<string, unknown>, authCookie: string) {
	cy.request({
		method: "POST",
		url: `${api}/api/documents/types/quote/actions/send`,
		headers: authed(authCookie),
		body: { documentId: quoteId, data, params: { recipient: CLIENT_EMAIL } },
	}).then((res) => {
		expect(res.status, "send accepted").to.be.oneOf([200, 201]);
	});
	waitForStatus(quoteId, "sent", authCookie);
}

function waitForStatus(quoteId: string, status: string, authCookie: string, attempts = 40) {
	cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote`, headers: authed(authCookie) }).then(
		(res) => {
			if (res.body.status === status) return;
			if (attempts <= 0) throw new Error(`quote never reached "${status}" (last: ${res.body.status})`);
			cy.wait(500);
			waitForStatus(quoteId, status, authCookie, attempts - 1);
		},
	);
}

describe("An e-signature is bound to the exact version the client read (issue #477)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.viewport(1280, 900);
		cy.login();
	});

	it("refuses to sign through a link whose quote was edited and sent again, and a new link signs the new version", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Bound Version Client",
				contactEmail: CLIENT_EMAIL,
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Rue de la Version",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		}).then((created) => {
			const clientId = created.body?.id as string;
			expect(clientId, "client created").to.be.a("string");
			const v1 = quoteData(clientId, 300);
			const v2 = quoteData(clientId, 900);

			cy.getCookie("better-auth.session_token").then((sessionCookie) => {
				const authCookie = (sessionCookie as Cypress.Cookie).value;

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					headers: authed(authCookie),
					body: { data: v1 },
				}).then((draft) => {
					const quoteId = draft.body?.document?.id as string;
					expect(quoteId, "quote draft created").to.be.a("string");
					send(quoteId, v1, authCookie);

					requestSignature(quoteId, v1, authCookie).then((oldToken) => {
						// 1. The valid link: the delivered PDF and the options of the version sent.
						cy.clearCookies();
						cy.clearEmails();
						cy.visit(`/signature/${oldToken}`);
						cy.get('[data-cy="signature-card"]', { timeout: 15000 }).should("be.visible");
						cy.get('[data-cy="signature-document-preview"]', { timeout: 15000 }).should("exist");
						cy.contains('[data-cy="signature-option-item"]', "Premium")
							.find('[data-cy="signature-option-total"]')
							.invoke("text")
							.should("match", /360/);
						// The options and their totals sit below the PDF: scrolled into view so the image shows
						// them. The embedded PDF viewer lays itself out inside the <object>, where Cypress cannot
						// wait on anything, and shifts the page while it does: a short settle before the image.
						cy.wait(1500);
						cy.get('[data-cy="signature-option-chooser"]').scrollIntoView({ offset: { top: -420, left: 0 } });
						cy.screenshot("477-after-valid-link", { capture: "viewport" });

						cy.contains('[data-cy="signature-option-item"]', "Premium")
							.find('[data-cy="signature-option-radio"]')
							.check({ force: true });
						cy.get('[data-cy="signature-confirm-read-checkbox"]').click();
						cy.get('[data-cy="signature-request-otp-button"]').should("not.be.disabled").click();
						cy.get('[data-cy="signature-otp-message"]', { timeout: 10000 }).should("be.visible");

						cy.getLastEmail().then((otpMessage: { Text?: string; HTML?: string }) => {
							const otp = bodyOf(otpMessage).match(/\b(\d{4})-(\d{4})\b/);
							expect(otp, "OTP email carries an 8-digit code").to.not.be.null;
							const code = `${(otp as RegExpMatchArray)[1]}${(otp as RegExpMatchArray)[2]}`;
							cy.get('input[data-slot="input-otp"]').type(code, { force: true });

							// 2. The issuer edits the sent quote and sends it again, while the client holds
							// a live code. No new signature request is issued.
							cy.request({
								method: "POST",
								url: `${api}/api/documents/types/quote/actions/save-draft`,
								headers: authed(authCookie),
								body: { documentId: quoteId, data: v2 },
							}).then((res) => {
								expect(res.body?.document?.status, "the edit reopens the quote").to.eq("draft");
							});
							send(quoteId, v2, authCookie);

							// The client presses Sign with the code from the OLD version in hand.
							cy.get('[data-cy="signature-sign-button"]').should("not.be.disabled").click();
							cy.get('[data-cy="signature-confirm-dialog"]').should("be.visible");
							cy.get('[data-cy="signature-confirm-dialog-confirm"]').click();

							cy.get('[data-cy="signature-document-changed-card"]', { timeout: 10000 }).should(
								"be.visible",
							);
							cy.get('[data-cy="signature-success-card"]').should("not.exist");
							cy.get('[data-cy="signature-card"]').should("not.exist");
						});

						cy.request({
							url: `${api}/api/documents/${quoteId}?typeId=quote`,
							headers: authed(authCookie),
						}).then((res) => {
							expect(res.body.status, "the quote was NOT signed through the old link").to.eq("sent");
							expect(res.body.acceptedOption, "no option was recorded").to.be.null;
						});

						// 3. The old link, opened again: only the explanation, no form, no document.
						cy.visit(`/signature/${oldToken}`);
						cy.get('[data-cy="signature-document-changed-card"]', { timeout: 15000 })
							.should("be.visible")
							.and("contain.text", "changed");
						cy.get('[data-cy="signature-request-otp-button"]').should("not.exist");
						cy.get('[data-cy="signature-document-preview"]').should("not.exist");
						cy.screenshot("477-after-old-link-quote-changed", { capture: "viewport" });

						// 4. A new request, issued after the new send, signs the NEW version.
						requestSignature(quoteId, v2, authCookie).then((newToken) => {
							expect(newToken, "a fresh token").to.not.eq(oldToken);
							cy.clearCookies();
							cy.clearEmails();
							cy.visit(`/signature/${newToken}`);
							cy.get('[data-cy="signature-card"]', { timeout: 15000 }).should("be.visible");
							cy.get('[data-cy="signature-document-preview"]', { timeout: 15000 }).should("exist");
							cy.contains('[data-cy="signature-option-item"]', "Premium")
								.find('[data-cy="signature-option-total"]')
								.invoke("text")
								.should("match", /1[\s,.  ]?080/);
							cy.contains('[data-cy="signature-option-item"]', "Premium")
								.find('[data-cy="signature-option-radio"]')
								.check({ force: true });
							cy.get('[data-cy="signature-confirm-read-checkbox"]').click();
							cy.get('[data-cy="signature-request-otp-button"]').should("not.be.disabled").click();
							cy.get('[data-cy="signature-otp-message"]', { timeout: 10000 }).should("be.visible");
							cy.getLastEmail().then((otpMessage: { Text?: string; HTML?: string }) => {
								const otp = bodyOf(otpMessage).match(/\b(\d{4})-(\d{4})\b/);
								const code = `${(otp as RegExpMatchArray)[1]}${(otp as RegExpMatchArray)[2]}`;
								cy.get('input[data-slot="input-otp"]').type(code, { force: true });
								cy.get('[data-cy="signature-sign-button"]').should("not.be.disabled").click();
								cy.get('[data-cy="signature-confirm-dialog-confirm"]').click();
								cy.get('[data-cy="signature-success-card"]', { timeout: 15000 }).should("be.visible");
							});

							cy.request({
								url: `${api}/api/documents/${quoteId}?typeId=quote`,
								headers: authed(authCookie),
							}).then((res) => {
								expect(res.body.status, "the new link signs").to.eq("signed");
								expect(res.body.acceptedOption).to.eq("Premium");
							});
						});
					});
				});
			});
		});
	});
});
