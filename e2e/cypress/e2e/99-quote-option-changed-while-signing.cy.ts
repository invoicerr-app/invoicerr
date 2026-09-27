export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #373 follow-up (review round 3, point 4): "after a refused option, the client cannot choose
 * again". A public signer picks an option, requests an OTP, and the issuer renames it (a "sent" quote
 * stays editable) while the code is in flight - before this fix, the Verify step resent the same
 * now-invalid name on every "Sign" click, with no explanation and no way to pick the current option,
 * only a page reload (which this spec never does) recovered. This spec proves, through the screen:
 * the refusal shows a message plus the option chooser again with the CURRENT options, the stale pick
 * is gone, and the client can choose the renamed option and sign successfully - with the SAME OTP
 * code the first attempt already typed (`signatures.service.ts#markSigned`'s own header: this one
 * refusal never touches the lifetime OTP-attempt counter, so nothing about it should force a resend).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const appOrigin = "http://localhost:6284";

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

describe("A quote's option is renamed while the client is verifying an OTP (issue #373, review round 3 point 4)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.viewport(1280, 720);
		cy.login();
	});

	it("shows a message and the current options again, clears the stale pick, and signs with the renamed option using the SAME code", () => {
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

						// The client's ORIGINAL choice: "Premium".
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
							// `InputOTPGroup`) - never a bare `.find("input").first()` off the whole card: once
							// the option chooser reappears below (this fix's own point), its OWN radio `input`s
							// sit ABOVE the OTP slots in the DOM, so "first input in the card" would silently
							// stop meaning "the OTP slot" the moment that happens.
							cy.get('input[data-slot="input-otp"]').type(code, { force: true });

							// The issuer renames "Premium" to "Gold" WHILE this client holds a live code -
							// a "sent" quote stays editable (quote.descriptor.ts's own `lockedStatuses`), the
							// exact scenario this fix exists for. Done through the DB task, not "save-draft":
							// that action would flip the quote back to "draft" (see cypress.config.ts's own
							// `renameQuoteOption` header), which is not what this spec is proving.
							cy.task("renameQuoteOption", { documentId: quoteId, from: "Premium", to: "Gold" });

							// Attempts to sign with the now-stale "Premium" choice - refused, but the message
							// and the CURRENT options reappear right here in the Verify step, no page reload.
							cy.get('[data-cy="signature-sign-button"]').click();
							cy.get('[data-cy="signature-confirm-dialog"]').should("be.visible");
							cy.get('[data-cy="signature-confirm-dialog-confirm"]').click();

							cy.get('[data-cy="signature-options-changed-message"]', { timeout: 10000 }).should(
								"be.visible",
							);
							cy.get('[data-cy="signature-confirm-dialog"]').should("not.exist");
							cy.get('[data-cy="signature-success-card"]').should("not.exist");

							cy.get('[data-cy="signature-option-chooser"]').should("be.visible");
							cy.get('[data-cy="signature-option-item"]').should(($items) => {
								const texts = $items.toArray().map((el) => el.textContent);
								expect(texts.some((t) => t?.includes("Basic"))).to.be.true;
								expect(texts.some((t) => t?.includes("Gold"))).to.be.true;
								expect(texts.some((t) => t?.includes("Premium"))).to.be.false;
							});
							// Nothing pre-selected any more - the stale "Premium" pick was cleared, never
							// silently kept as "Gold" on the client's behalf.
							cy.get('[data-cy="signature-option-radio"]').should(($radios) => {
								expect($radios.toArray().some((el) => (el as HTMLInputElement).checked)).to.be
									.false;
							});
							// The OTP code itself is untouched - proving the fix never forced a resend.
							cy.get('input[data-slot="input-otp"]').should("have.value", code);
							// Signing is blocked again until a fresh choice is made.
							cy.get('[data-cy="signature-sign-button"]').should("be.disabled");

							cy.screenshot("475-r3-4-after-options-changed", { capture: "viewport" });

							cy.contains('[data-cy="signature-option-item"]', "Gold")
								.find('[data-cy="signature-option-radio"]')
								.check({ force: true });
							cy.get('[data-cy="signature-sign-button"]').should("not.be.disabled").click();
							cy.get('[data-cy="signature-confirm-dialog"]').should("be.visible");
							cy.get('[data-cy="signature-confirm-dialog-confirm"]').click();
							cy.get('[data-cy="signature-success-card"]', { timeout: 15000 }).should("be.visible");
						});

						cy.request({
							url: `${api}/api/documents/${quoteId}?typeId=quote`,
							headers: { Cookie: `better-auth.session_token=${authCookie}` },
						}).then((res) => {
							expect(res.body.status, "the quote ends signed").to.eq("signed");
							expect(
								res.body.acceptedOption,
								"the signed document names the RENAMED option, not the stale one",
							).to.eq("Gold");
						});
					});
				});
			});
		});
	});
});
