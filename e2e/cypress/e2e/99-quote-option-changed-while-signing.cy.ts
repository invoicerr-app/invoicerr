export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * A quote's option is renamed while the client is verifying an OTP.
 *
 * Issue #373 follow-up (review round 3, point 4) first made this scenario recoverable by showing the
 * client the CURRENT options again and letting them sign the renamed one with the same code. Issue
 * #477 reverses that on purpose: the client would then sign an option their PDF never showed. A
 * signature request is now bound to the version the client was sent, so any change to the quote's
 * data, a rename included, makes the link unsignable: the Sign attempt is refused, the page explains
 * that the document changed, and the quote is NOT signed. The rename is done straight in the database
 * (the `renameQuoteOption` task), which keeps the status "sent": the edit a "save-draft" would make
 * also moves the quote back to "draft", which `103-signature-bound-version.cy.ts` covers.
 */
const api = Cypress.env("apiUrl");
const appOrigin = Cypress.config("baseUrl");

function bodyOf(message: { Text?: string; HTML?: string }): string {
	return `${message.Text ?? ""}\n${message.HTML ?? ""}`;
}

function createClient(name: string, contactEmail: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				contactEmail,
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Rue des Options Changeantes",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([
				200, 201,
			]);
			const id = res.body?.id as string;
			expect(id, "the created client has an id").to.be.a("string");
			return id;
		});
}

describe("A quote's option is renamed while the client is verifying an OTP (issues #373 and #477)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.viewport(1280, 720);
		cy.login();
	});

	it("refuses the signature, says the document changed, and leaves the quote unsigned", () => {
		const CLIENT_EMAIL = "options-changed@example.com";
		createClient("Options-Changed Client", CLIENT_EMAIL).then((clientId) => {
			const quoteData = {
				client: clientId,
				issueDate: new Date().toISOString().slice(0, 10),
				currency: "EUR",
				lines: [
					{
						description: "Basic line",
						quantity: 1,
						unitPrice: 100,
						option: "Basic",
						vatRate: "20",
					},
					{
						description: "Premium line",
						quantity: 1,
						unitPrice: 300,
						option: "Premium",
						vatRate: "20",
					},
				],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/save-draft`,
				body: { data: quoteData },
			}).then((draft) => {
				const quoteId = draft.body?.document?.id as string;
				expect(quoteId, "quote draft created").to.be.a("string");

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/send`,
					body: { documentId: quoteId, data: quoteData, params: { recipient: CLIENT_EMAIL } },
				}).then((res) => {
					expect(res.status, "send accepted").to.be.oneOf([200, 201]);
				});
				cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"]);

				cy.clearEmails();
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/request-signature`,
					body: { documentId: quoteId, data: quoteData },
				}).then((res) => {
					expect(res.status, "signature request accepted").to.be.oneOf([200, 201]);
				});

				cy.getLastEmail().then((message: { Text?: string; HTML?: string }) => {
					const match = bodyOf(message).match(/\/signature\/([0-9a-f]{64})/);
					expect(match, "signature request email carries the token link").to.not.be.null;
					const token = (match as RegExpMatchArray)[1];

					cy.getCookie("better-auth.session_token").then((sessionCookie) => {
						const authCookie = (sessionCookie as Cypress.Cookie).value;
						cy.clearCookies();
						cy.clearEmails();
						cy.visit(`${appOrigin}/signature/${token}`);
						cy.get('[data-cy="signature-card"]', { timeout: 15000 }).should("be.visible");
						cy.get('[data-cy="signature-document-preview"]', { timeout: 15000 }).should("exist");

						// The client's ORIGINAL choice: "Premium". Issue #512 pinned the chooser inside the
						// signing card's own sticky action bar, so it is on screen without scrolling and does
						// not depend on the PDF preview's own layout (#509's own flakiness) - a bare
						// visibility assertion is reliable here now.
						cy.get('[data-cy="signature-option-chooser"]').should("be.visible");
						cy.get('[data-cy="signature-option-item"]').should("have.length", 2);
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
							// `input[data-slot="input-otp"]` - the ONE real `<input>` the `input-otp` library
							// renders (a SIBLING of the visible slots, per its own source, never a descendant of
							// `InputOTPGroup`) - never a bare `.find("input").first()` off the whole card.
							cy.get('input[data-slot="input-otp"]').type(code, { force: true });

							// The issuer renames "Premium" to "Gold" WHILE this client holds a live code.
							// Done through the DB task, not "save-draft": that action would flip the quote back
							// to "draft" (see cypress.config.ts's own `renameQuoteOption` header), which is
							// `103-signature-bound-version.cy.ts`'s case, not this one.
							cy.task("renameQuoteOption", { documentId: quoteId, from: "Premium", to: "Gold" });

							// Attempts to sign with the "Premium" choice the client's PDF shows: refused, and
							// the whole page now says the document changed. No chooser offering "Gold".
							cy.get('[data-cy="signature-sign-button"]').click();
							cy.get('[data-cy="signature-confirm-dialog"]').should("be.visible");
							cy.get('[data-cy="signature-confirm-dialog-confirm"]').click();

							cy.get('[data-cy="signature-document-changed-card"]', { timeout: 10000 }).should(
								"be.visible",
							);
							cy.get('[data-cy="signature-success-card"]').should("not.exist");
							cy.get('[data-cy="signature-option-chooser"]').should("not.exist");
							cy.get('[data-cy="signature-sign-button"]').should("not.exist");
						});

						cy.request({
							url: `${api}/api/documents/${quoteId}?typeId=quote`,
							headers: { Cookie: `better-auth.session_token=${authCookie}` },
						}).then((res) => {
							expect(res.body.status, "the quote is NOT signed").to.eq("sent");
							expect(res.body.acceptedOption, "no option was recorded").to.be.null;
						});
					});
				});
			});
		});
	});
});
