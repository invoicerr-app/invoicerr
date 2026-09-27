export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #421 - "accept a quote manually, without the e-signature code".
 *
 * A sent quote can now be marked accepted by the issuer, on screen, without going through the
 * OTP-signature flow (see the backend's `actions/quote-manual-acceptance.ts`). This spec proves the
 * whole surface the issue asks for:
 *  - the "Mark as accepted" button is absent for a quote nobody has sent yet, and present once it is;
 *  - the confirmation dialog refuses an empty note and shows the "not an electronic signature" warning;
 *  - submitting a note moves the quote to "accepted" and the status badge shows it;
 *  - the detail page's "Acceptance" section (this app has no document history/timeline view - this
 *    is a current-state summary, not a log) shows the manual acceptance, naming the actor and the
 *    note, and never says "Signed";
 *  - converting to invoice works from "accepted";
 *  - the legal archive keeps the distinction: a new archive row is written for the manual acceptance,
 *    readable back through the API, carrying method/actor/note and no signature evidence at all.
 *
 * For comparison, a SECOND quote goes through the REAL e-signature flow (the same OTP journey
 * `45-signature.cy.ts` drives, Mailpit included) so the two "Acceptance" sections can be asserted
 * DIFFERENT on screen - the one thing this whole feature exists to guarantee.
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
				address: "1 Rue de l'Acceptation",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "the created client has an id").to.be.a("string");
			return id;
		});
}

function quoteData(clientId: string) {
	return {
		client: clientId,
		issueDate: "2026-09-20",
		currency: "EUR",
		lines: [{ description: "Consulting", quantity: 1, unitPrice: 500 }],
	};
}

/** Creates a quote and sends it to the given recipient - returns its id once the API confirms "sent". */
function createSentQuote(clientId: string, recipient: string) {
	const data = quoteData(clientId);
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/quote/actions/save-draft`,
			body: { data },
		})
		.then((saved) => {
			const quoteId = saved.body?.document?.id as string;
			expect(quoteId, "quote draft created").to.be.a("string");

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/send`,
				body: { documentId: quoteId, data, params: { recipient } },
			}).then((sent) => {
				expect(sent.status, "send accepted").to.be.oneOf([200, 201]);
			});
			cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"]);

			return cy.wrap(quoteId);
		});
}

describe("Quote manual acceptance (issue #421)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("shows the button only once sent, refuses an empty note, records the acceptance, converts to invoice, and keeps the archive distinct", () => {
		createClient("Manual Acceptance Client", "manual-accept@example.com").then((clientId) => {
			// Before "send": no draft has the button at all - the action's own availableWhen is ["sent"].
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/save-draft`,
				body: { data: quoteData(clientId) },
			}).then((draft) => {
				const draftId = draft.body?.document?.id as string;
				cy.visit(`${appOrigin}/documents/quote/${draftId}`);
				cy.get('[data-cy="document-actions-menu"]').click();
				cy.get('[data-cy="document-accept-manually-button"]').should("not.exist");
				// Close the menu before moving on - Escape, never a raw body click at a fixed
				// coordinate, which can land on the dropdown's own dismissable overlay and time out.
				cy.get("body").type("{esc}");
			});

			createSentQuote(clientId, "manual-accept@example.com").then((quoteId) => {
				cy.visit(`${appOrigin}/documents/quote/${quoteId}`);
				cy.get('[data-cy="document-status-badge"]').should("contain.text", "Sent");

				cy.get('[data-cy="document-actions-menu"]').click();
				cy.get('[data-cy="document-accept-manually-button"]').should("be.visible").click();

				cy.get('[data-cy="mark-quote-accepted-dialog"]').should("be.visible");
				cy.get('[data-cy="mark-quote-accepted-warning"]').should(
					"contain.text",
					"not an electronic signature",
				);

				// Refuses an empty note - never sends the request.
				cy.intercept("POST", "**/api/documents/types/quote/actions/accept-manually").as(
					"acceptManually",
				);
				cy.get('[data-cy="mark-quote-accepted-confirm"]').click();
				cy.get('[data-cy="mark-quote-accepted-note-error"]').should("be.visible");
				cy.get("@acceptManually.all").its("length").should("eq", 0);
				cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
					.its("body.status")
					.should("eq", "sent");

				const note = "Accepted by phone on 2026-09-20, client confirmed the total.";
				cy.get('[data-cy="mark-quote-accepted-note"]').type(note);
				cy.get('[data-cy="mark-quote-accepted-confirm"]').click();
				cy.wait("@acceptManually").its("response.statusCode").should("be.oneOf", [200, 201]);
				cy.get('[data-cy="mark-quote-accepted-dialog"]').should("not.exist");

				cy.get('[data-cy="document-status-badge"]').should("contain.text", "Accepted");

				// The "Acceptance" section: names the actor and the note, and never says "Signed".
				cy.get('[data-cy="document-acceptance-section"]').should("exist");
				cy.get('[data-cy="document-acceptance-manual-label"]').should(
					"contain.text",
					"Accepted manually",
				);
				cy.get('[data-cy="document-acceptance-manual-entry"]')
					.should("contain.text", "John Doe")
					.and("contain.text", note);
				cy.get('[data-cy="document-acceptance-section"]')
					.invoke("text")
					.then((text) => {
						expect(text, 'the manual-acceptance section never claims "Signed"').to.not.match(
							/\bSigned\b/,
						);
					});
				cy.get('[data-cy="document-acceptance-signed"]').should("not.exist");

				// The API agrees: status "accepted", and the manual-acceptance record carries the same
				// facts the screen shows.
				cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
					.its("body.status")
					.should("eq", "accepted");
				cy.request({ url: `${api}/api/documents/${quoteId}/manual-acceptance?typeId=quote` }).then(
					(res) => {
						expect(res.status, "manual-acceptance record readable").to.eq(200);
						expect(res.body.note, "note persisted verbatim").to.eq(note);
						expect(res.body.actorName, "actor recorded").to.eq("John Doe");
						expect(res.body.actorEmail, "actor email recorded").to.eq("john.doe@acme.org");
						expect(res.body, "no signature-shaped field anywhere in the manifest").to.not.have.any.keys(
							"signedAt",
							"otp",
							"signature",
							"token",
						);
					},
				);

				// The legal archive keeps the distinction: a NEW archive row exists for the acceptance,
				// carrying its own "manual-acceptance" artifact - read back through the archives list,
				// never merely asserted from the write side.
				cy.request({ url: `${api}/api/documents/${quoteId}/archives?typeId=quote` }).then((res) => {
					expect(res.status, "archives readable").to.eq(200);
					const acceptanceArchive = (res.body as Array<{ kind: string; artifacts: Array<{ role: string }> }>).find(
						(a) => a.kind === "ACCEPTANCE",
					);
					expect(acceptanceArchive, "an ACCEPTANCE archive row exists").to.exist;
					expect(
						acceptanceArchive!.artifacts.some((a) => a.role === "manual-acceptance"),
						"its artifact is the manual-acceptance manifest, never a signature one",
					).to.be.true;
				});

				// Conversion to invoice works from "accepted". It is the page's PRIMARY button now, not a
				// menu entry: issue #468 locks "save-draft" on an accepted quote, and "save-draft" is
				// what used to take the primary slot here (action-presentation.ts#pickPrimaryAction), so
				// "convert-to-invoice" moves up out of the "Actions" menu.
				cy.get('[data-cy="document-action-convert-to-invoice"]').click();
				cy.url({ timeout: 15000 }).should("match", /\/documents\/invoice\/[^/]+$/);
				cy.get('[data-cy="document-status-badge"]').should("contain.text", "Draft");
				cy.url().then((url) => {
					const invoiceId = url.split("/").pop() as string;
					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` }).then((res) => {
						expect(res.status, "the converted invoice exists").to.eq(200);
						expect(res.body.data.client, "carries the same client over").to.eq(clientId);
					});
				});
			});
		});
	});

	it("a real e-signed quote's Acceptance section says SIGNED, never manual - and is never mistaken for one", () => {
		const CLIENT_EMAIL = "esign-compare@example.com";
		createClient("E-signature Compare Client", CLIENT_EMAIL).then((clientId) => {
			createSentQuote(clientId, CLIENT_EMAIL).then((quoteId) => {
				cy.clearEmails();
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/request-signature`,
					body: { documentId: quoteId, data: quoteData(clientId) },
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
						cy.get('[data-cy="signature-confirm-read-checkbox"]').click();
						cy.get('[data-cy="signature-request-otp-button"]').click();
						cy.get('[data-cy="signature-otp-message"]', { timeout: 10000 }).should("be.visible");

						cy.getLastEmail().then((otpMessage: { Text?: string; HTML?: string }) => {
							const otp = bodyOf(otpMessage).match(/\b(\d{4})-(\d{4})\b/);
							expect(otp, "OTP email carries an 8-digit code").to.not.be.null;
							const code = `${(otp as RegExpMatchArray)[1]}${(otp as RegExpMatchArray)[2]}`;
							cy.get('[data-cy="signature-card"]').find("input").first().type(code, { force: true });
							cy.get('[data-cy="signature-sign-button"]').click();
							cy.get('[data-cy="signature-confirm-dialog"]').should("be.visible");
							cy.get('[data-cy="signature-confirm-dialog-confirm"]').click();
							cy.get('[data-cy="signature-success-card"]', { timeout: 15000 }).should("be.visible");
						});

						cy.request({
							url: `${api}/api/documents/${quoteId}?typeId=quote`,
							headers: { Cookie: `better-auth.session_token=${authCookie}` },
						})
							.its("body.status")
							.should("eq", "signed");

						// The public signature page cleared cookies to act as the anonymous client - restore
						// an authenticated session before visiting the issuer-facing detail page below.
						cy.login();
						cy.visit(`${appOrigin}/documents/quote/${quoteId}`);
						cy.get('[data-cy="document-status-badge"]').should("contain.text", "Signed");
						cy.get('[data-cy="document-acceptance-signed"]').should("exist");
						cy.get('[data-cy="document-acceptance-signed-label"]').should(
							"contain.text",
							"Signed electronically",
						);
						cy.get('[data-cy="document-acceptance-manual"]').should("not.exist");

						// Never confused with a manual acceptance: no manual-acceptance record exists for
						// this quote at all, and its archive carries no ACCEPTANCE row.
						cy.request({
							url: `${api}/api/documents/${quoteId}/manual-acceptance?typeId=quote`,
						}).then((res) => {
							// `null` serializes as an empty body over the wire for this route (no JSON content
							// to parse) - either shape means "nothing recorded", which is the fact this
							// asserts; never a caller-supplied identity or a manual-acceptance manifest.
							expect(
								res.body === null || res.body === "",
								"an e-signed quote has no manual-acceptance record",
							).to.be.true;
						});
						cy.request({ url: `${api}/api/documents/${quoteId}/archives?typeId=quote` }).then(
							(res) => {
								const kinds = (res.body as Array<{ kind: string }>).map((a) => a.kind);
								expect(kinds, "no ACCEPTANCE archive row for an e-signed quote").to.not.include(
									"ACCEPTANCE",
								);
							},
						);
					});
				});
			});
		});
	});
});
