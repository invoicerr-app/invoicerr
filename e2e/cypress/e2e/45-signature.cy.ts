/**
 * Signature électronique du devis (OTP par email) — DURCIE
 * (GHSA-vhjw-gwc5-pjfp fermé). Prouvé PAR L'ÉCRAN, côté client anonyme : le vendeur demande une
 * signature (action `request-signature` sur un devis "sent"), le client reçoit un lien à jeton
 * haute-entropie par email, ouvre la page publique `/signature/:token`, demande un OTP (envoyé par
 * email), le saisit, et signe — le devis passe SIGNED. Les ASSERTIONS qui comptent relisent l'API ;
 * le vrai OTP et le vrai jeton sont LUS dans Mailpit (jamais devinés), même discipline que
 * 23-document-email.cy.ts. La garantie anti-brute-force (verrou à vie ≤ 0,01 %) et le CSPRNG sont
 * prouvés exhaustivement en jest (`signatures/otp.spec.ts`, `signatures.service.spec.ts`) ; ici on
 * prouve le PARCOURS réel à l'écran + le refus nommé d'un mauvais code.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const appOrigin = "http://localhost:6284";

function bodyOf(message: { Text?: string; HTML?: string }): string {
	return `${message.Text ?? ""}\n${message.HTML ?? ""}`;
}

/** Crée un devis, l'envoie (→ "sent"), puis lance `request-signature` — renvoie le jeton de signature
 *  LU dans l'email de demande (jamais fabriqué). Le devis est envoyé au client seedé (qui porte un
 *  contactEmail), exactement le destinataire auquel part le lien de signature. */
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

					// On vide Mailpit JUSTE avant la demande de signature, pour que "le dernier email"
					// soit sans ambiguïté celui qui porte le lien.
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

describe("Signature électronique du devis — parcours client à l'écran, durci", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("un client ouvre le lien, demande un code, le saisit et SIGNE — le devis passe SIGNED", () => {
		createSentQuoteAndRequestSignature().then(({ quoteId, token }) => {
			// La page publique est anonyme (aucune session) — on ne se connecte pas côté client.
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
				// L'email affiche le code en deux moitiés séparées d'un tiret ("1234-5678") — on le
				// recompose en 8 chiffres pour la saisie.
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

			// La vérité est en base, relue via l'API (jamais l'écran seul) : le devis est SIGNED.
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

	it("un mauvais code est refusé À L'ÉCRAN (message nommé) et NE signe pas le devis", () => {
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

			// Un code volontairement FAUX (jamais celui de l'email) — le refus doit être nommé, jamais
			// une signature silencieuse.
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
