export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Electronic quote signature (email OTP) — HARDENED
 * (GHSA-vhjw-gwc5-pjfp closed). Proven THROUGH THE SCREEN, on the anonymous client side: the seller
 * requests a signature (`request-signature` action on a "sent" quote), the client receives a
 * high-entropy token link by email, opens the public `/signature/:token` page, requests an OTP (sent
 * by email), enters it, and signs — the quote moves to SIGNED. The ASSERTIONS that matter read the
 * API back; the real OTP and the real token are READ from Mailpit (never guessed), the same
 * discipline as 23-document-email.cy.ts. The anti-brute-force guarantee (lifetime lockout ≤ 0.01%)
 * and the CSPRNG are proven exhaustively in jest (`signatures/otp.spec.ts`,
 * `signatures.service.spec.ts`); here we prove the real on-screen JOURNEY + the named refusal of a
 * wrong code.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const appOrigin = "http://localhost:6284";

function bodyOf(message: { Text?: string; HTML?: string }): string {
	return `${message.Text ?? ""}\n${message.HTML ?? ""}`;
}

/** Creates a quote, sends it (→ "sent"), then triggers `request-signature` — returns the signature
 *  token READ from the request email (never fabricated). The quote is sent to the seeded client
 *  (which carries a contactEmail), exactly the recipient the signature link is sent to. */
const CLIENT_EMAIL = "sig-client@example.com";

function createSentQuoteAndRequestSignature(): Cypress.Chainable<{
	quoteId: string;
	token: string;
}> {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Signature Client",
				contactEmail: CLIENT_EMAIL,
				currency: "EUR",
				country: "FR",
				address: "1 Rue de la Signature",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((created) => {
			const clientId = created.body?.id as string;
			expect(
				clientId,
				"client de signature créé (avec un email de contact)",
			).to.be.a("string");
			const quoteData = {
				client: clientId,
				issueDate: "2026-08-30",
				currency: "EUR",
				lines: [{ description: "Consulting", quantity: 1, unitPrice: 500 }],
			};
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: { data: quoteData },
				})
				.then((saved) => {
					const quoteId = saved.body?.document?.id as string;
					expect(quoteId, "brouillon de devis créé").to.be.a("string");

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/send`,
						body: {
							documentId: quoteId,
							data: quoteData,
							params: { recipient: CLIENT_EMAIL },
						},
					}).then((sent) => {
						expect(sent.status, "envoi du devis accepté").to.be.oneOf([
							200, 201,
						]);
					});
					cy.waitForDocumentStatus(
						`${api}/api/documents/${quoteId}?typeId=quote`,
						["sent"],
					);

					// Mailpit is cleared JUST before the signature request, so "the last email" is
					// unambiguously the one carrying the link.
					cy.clearEmails();
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/request-signature`,
						body: { documentId: quoteId, data: quoteData },
					}).then((res) => {
						expect(res.status, "demande de signature acceptée").to.be.oneOf([
							200, 201,
						]);
					});

					return cy
						.getLastEmail()
						.then((message: { Text?: string; HTML?: string }) => {
							const match = bodyOf(message).match(
								/\/signature\/([0-9a-f]{64})/,
							);
							expect(
								match,
								"l'email de demande porte un lien /signature/<jeton 256 bits>",
							).to.not.be.null;
							return cy.wrap({
								quoteId,
								token: (match as RegExpMatchArray)[1],
							});
						});
				});
		});
}

describe("Electronic quote signature — client journey on screen, hardened", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("a client opens the link, requests a code, enters it and SIGNS — the quote moves to SIGNED", () => {
		createSentQuoteAndRequestSignature().then(({ quoteId, token }) => {
			// The public page is anonymous (no session) — the client side never logs in.
			cy.clearCookies();
			cy.clearEmails();
			cy.visit(`${appOrigin}/signature/${token}`);

			cy.get('[data-cy="signature-card"]', { timeout: 15000 }).should(
				"be.visible",
			);
			cy.get('[data-cy="signature-request-otp-button"]').click();
			cy.get('[data-cy="signature-otp-message"]', { timeout: 10000 }).should(
				"be.visible",
			);

			cy.getLastEmail().then((message: { Text?: string; HTML?: string }) => {
				// The email shows the code as two halves separated by a dash ("1234-5678") — it is
				// recombined into 8 digits for input.
				const otp = bodyOf(message).match(/\b(\d{4})-(\d{4})\b/);
				expect(
					otp,
					"l'email de code porte un OTP à 8 chiffres (format 1234-5678)",
				).to.not.be.null;
				const code = `${(otp as RegExpMatchArray)[1]}${(otp as RegExpMatchArray)[2]}`;

				cy.get('[data-cy="signature-card"]')
					.find("input")
					.first()
					.type(code, { force: true });
				cy.get('[data-cy="signature-sign-button"]').click();
				cy.get('[data-cy="signature-success-card"]', { timeout: 15000 }).should(
					"be.visible",
				);
			});

			// The truth is in the database, read back via the API (never the screen alone): the quote is SIGNED.
			cy.login();
			cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
				.its("body")
				.then((doc) => {
					expect(
						doc.status,
						"le devis est passé SIGNED après signature réelle",
					).to.eq("signed");
				});
		});
	});

	it("a wrong code is refused ON SCREEN (named message) and does NOT sign the quote", () => {
		createSentQuoteAndRequestSignature().then(({ quoteId, token }) => {
			cy.clearCookies();
			cy.visit(`${appOrigin}/signature/${token}`);

			cy.get('[data-cy="signature-card"]', { timeout: 15000 }).should(
				"be.visible",
			);
			cy.get('[data-cy="signature-request-otp-button"]').click();
			cy.get('[data-cy="signature-otp-message"]', { timeout: 10000 }).should(
				"be.visible",
			);

			// A deliberately WRONG code (never the one from the email) — the refusal must be named,
			// never a silent signature.
			cy.get('[data-cy="signature-card"]')
				.find("input")
				.first()
				.type("00000000", { force: true });
			cy.get('[data-cy="signature-sign-button"]').click();
			cy.get('[data-cy="signature-sign-error"]', { timeout: 10000 }).should(
				"be.visible",
			);
			cy.get('[data-cy="signature-success-card"]').should("not.exist");

			cy.login();
			cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
				.its("body")
				.then((doc) => {
					expect(
						doc.status,
						"un mauvais code ne signe jamais le devis",
					).to.not.eq("signed");
				});
		});
	});
});
