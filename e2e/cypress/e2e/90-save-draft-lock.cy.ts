export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #468 - "save-draft" no longer demotes an already-issued document back to "draft".
 *
 * Before this fix, every "save-draft" action declared `{ from: 'always', to: 'draft' }`
 * (backend's invoice/credit-note/quote descriptors), so nothing in the TYPE itself stopped it from
 * rewriting a sent invoice, a sent credit note (legally an invoice - CGI art. 289, I, 5), or a
 * signed/accepted quote. Only the country policy DATA narrowed `invoice.save-draft` to `["draft"]`
 * (all five shipped country files do) - a credit note had NO such protection anywhere, and a sixth
 * country file without that line would have reopened the same hole for invoices too.
 *
 * The fix is a new, CODE-level fact (`DocumentActionDescriptor.lockedStatuses`,
 * backend/src/modules/documents/descriptors/types.ts) that the country policy can never widen:
 *  - invoice / credit-note: every status but "draft" locks "save-draft";
 *  - quote: only "signed" and "accepted" lock it - "sent" stays editable (fixing a typo on an
 *    unanswered quote is normal), and so does "refused" (nothing binding was ever agreed).
 *
 * Four independent journeys, each through the real API AND the real screen - never a mock:
 *  a) a SENT invoice: "save-draft" 409s with the code-guard message, on screen the save is gone and
 *     the locked notice is shown;
 *  b) the same for a SENT credit note (free - no `invoice` to correct, same shape 50-credit-note-
 *     free.cy.ts already uses for France, the default seeded company's own country);
 *  c) a SIGNED quote (the real OTP e-signature flow - see 45-signature.cy.ts / 89-quote-manual-
 *     acceptance.cy.ts for the same journey) - "save-draft" 409s too, same notice;
 *  d) a SENT quote (never locked, unlike a) and b)): "save-draft" still succeeds, and the screen
 *     still offers it with no locked notice at all.
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
				address: "1 Rue du Verrou",
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

describe('Issue #468 - "save-draft" refuses to rewrite an issued document', () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('a SENT invoice: "save-draft" 409s with the CODE-guard message (not the country-policy one), status stays "sent", and the screen offers no save with the locked notice visible', () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((companyRes) => {
			expect(companyRes.status, "transport configured").to.be.oneOf([200, 201]);
		});

		createClient("Invoice Lock Client", "invoice-lock@example.com").then((clientId) => {
			const invoiceData = {
				client: clientId,
				// Before 2026-09-01 on purpose: from that date France's PDP mandate binds a domestic
				// invoice and "send" over email 501s (transports/channel-policy/mandate.ts), the same
				// date 21-document-lifecycle.cy.ts already picks for the same reason.
				issueDate: "2026-08-30",
				dueDate: "2026-09-30",
				currency: "EUR",
				lines: [{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: invoiceData },
			}).then((saved) => {
				const invoiceId = saved.body?.document?.id as string;
				expect(invoiceId, "invoice draft created").to.be.a("string");

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: invoiceId, data: invoiceData },
				}).then((sent) => {
					expect(sent.status, "send accepted").to.be.oneOf([200, 201]);
				});
				cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

				// AT THE API: refused, and the message names the CODE guard specifically (the "left
				// draft ... an issued document is never rewritten" wording - see documents.service.ts's
				// runAction), never the country-policy "restricted by this company's country policy"
				// sentence 21-document-lifecycle.cy.ts already proves for France's own invoice.save-draft
				// rule - proving THIS guard fired, not merely that country data agrees with it.
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { documentId: invoiceId, data: invoiceData },
					failOnStatusCode: false,
				}).then((res) => {
					expect(res.status, `refused - ${JSON.stringify(res.body).slice(0, 200)}`).to.eq(409);
					const message = String(res.body?.message ?? "");
					expect(message, "the message names the TYPE-level refusal, never the country policy").to.match(
						/refused once the document has left draft.*status "sent".*an issued document is never rewritten/i,
					);
					expect(message, "never the country-policy message").to.not.match(
						/restricted by this company's country policy/i,
					);
				});

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body.status")
					.should("eq", "sent");

				// ON SCREEN: no save offered, and the notice explains why.
				cy.visit(`${appOrigin}/documents/invoice/${invoiceId}`);
				cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should("contain.text", "Sent");
				cy.get('[data-cy="document-save-locked-notice"]', { timeout: 10000 })
					.should("be.visible")
					.and("contain.text", "issued")
					.and("contain.text", "credit note");
				cy.get('[data-cy="document-action-save-draft"]').should("not.exist");
				cy.openDocumentActionsMenu();
				cy.get('[data-cy="document-action-save-draft"]').should("not.exist");

				// Point 3 of the reviewer's follow-up: the notice alone used to leave the fields
				// underneath white and clickable. `document-form-readonly.tsx`'s provider is what makes
				// the form AGREE with the notice - the marker element proves it fired, and a real field
				// input proves the effect is not merely cosmetic.
				cy.get('[data-cy="document-form-readonly"]').should("exist");
				cy.get('[data-cy="document-field-issueDate-input"]').should("be.disabled");
				cy.get('[data-cy="document-field-lines-add-row"]').should("be.disabled");
			});
		});
	});

	it('a SENT free credit note: "save-draft" 409s with the CODE-guard message, status stays "sent", and the screen shows the locked notice', () => {
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: {
				data: {
					issueDate: "2026-09-20",
					currency: "EUR",
					reason: "Goodwill refund of an overpayment not tied to any invoice.",
					lines: [{ description: "Remboursement", quantity: 1, unitPrice: 42, vatRate: "0" }],
				},
			},
		}).then((saved) => {
			const creditNoteId = saved.body?.document?.id as string;
			expect(creditNoteId, "credit note draft created").to.be.a("string");

			const creditNoteData = saved.body?.document?.data;

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/credit-note/actions/send`,
				body: { documentId: creditNoteId, data: creditNoteData },
			}).then((sent) => {
				expect(sent.status, "send accepted").to.be.oneOf([200, 201]);
			});
			cy.waitForDocumentStatus(`${api}/api/documents/${creditNoteId}?typeId=credit-note`, ["sent"]);

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/credit-note/actions/save-draft`,
				body: { documentId: creditNoteId, data: creditNoteData },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, `refused - ${JSON.stringify(res.body).slice(0, 200)}`).to.eq(409);
				expect(
					String(res.body?.message ?? ""),
					"the message names the TYPE-level refusal for the credit note",
				).to.match(
					/refused once the document has left draft.*status "sent".*an issued document is never rewritten/i,
				);
			});

			cy.request({ url: `${api}/api/documents/${creditNoteId}?typeId=credit-note` })
				.its("body.status")
				.should("eq", "sent");

			cy.visit(`${appOrigin}/documents/credit-note/${creditNoteId}`);
			cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should("contain.text", "Sent");
			cy.get('[data-cy="document-save-locked-notice"]', { timeout: 10000 })
				.should("be.visible")
				.and("contain.text", "credit note");
			cy.get('[data-cy="document-action-save-draft"]').should("not.exist");

			// Point 3 - see the invoice test's own comment just above for the full "why".
			cy.get('[data-cy="document-form-readonly"]').should("exist");
			cy.get('[data-cy="document-field-issueDate-input"]').should("be.disabled");
			cy.get('[data-cy="document-field-lines-add-row"]').should("be.disabled");
		});
	});

	it('a SIGNED quote (real OTP e-signature flow): "save-draft" 409s, and the screen shows the locked notice', () => {
		const CLIENT_EMAIL = "signed-quote-lock@example.com";
		createClient("Signed Quote Lock Client", CLIENT_EMAIL).then((clientId) => {
			const quoteData = {
				client: clientId,
				issueDate: "2026-09-20",
				currency: "EUR",
				lines: [{ description: "Consulting", quantity: 1, unitPrice: 500 }],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/save-draft`,
				body: { data: quoteData },
			}).then((saved) => {
				const quoteId = saved.body?.document?.id as string;
				expect(quoteId, "quote draft created").to.be.a("string");

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/send`,
					body: { documentId: quoteId, data: quoteData, params: { recipient: CLIENT_EMAIL } },
				}).then((sent) => {
					expect(sent.status, "send accepted").to.be.oneOf([200, 201]);
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

						// AT THE API, from the authenticated (issuer) side: refused, code-guard message.
						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/quote/actions/save-draft`,
							body: { documentId: quoteId, data: quoteData },
							failOnStatusCode: false,
							headers: { Cookie: `better-auth.session_token=${authCookie}` },
						}).then((res) => {
							expect(res.status, `refused - ${JSON.stringify(res.body).slice(0, 200)}`).to.eq(409);
							expect(
								String(res.body?.message ?? ""),
								"the message names the refusal for a signed quote",
							).to.match(
								/refused once the document has left draft.*status "signed".*an issued document is never rewritten/i,
							);
						});

						// The public signature page cleared cookies to act as the anonymous client -
						// restore an authenticated session before visiting the issuer-facing detail page.
						cy.login();
						cy.visit(`${appOrigin}/documents/quote/${quoteId}`);
						cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should(
							"contain.text",
							"Signed",
						);
						cy.get('[data-cy="document-save-locked-notice"]', { timeout: 10000 })
							.should("be.visible")
							.and("contain.text", "signed")
							.and("contain.text", "create a new quote");
						cy.get('[data-cy="document-action-save-draft"]').should("not.exist");

						// Point 3 - see the invoice test's own comment (earlier in this file) for the
						// full "why". The quote's own `issueDate` field is what every fixture in this
						// file sets, same as the invoice/credit-note ones above.
						cy.get('[data-cy="document-form-readonly"]').should("exist");
						cy.get('[data-cy="document-field-issueDate-input"]').should("be.disabled");
						cy.get('[data-cy="document-field-lines-add-row"]').should("be.disabled");
					});
				});
			});
		});
	});

	it('a SENT quote is NOT locked: "save-draft" still succeeds, and the screen keeps offering it with no locked notice', () => {
		const CLIENT_EMAIL = "sent-quote-still-editable@example.com";
		createClient("Sent Quote Still Editable Client", CLIENT_EMAIL).then((clientId) => {
			const quoteData = {
				client: clientId,
				issueDate: "2026-09-20",
				currency: "EUR",
				lines: [{ description: "Consulting", quantity: 1, unitPrice: 500 }],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/save-draft`,
				body: { data: quoteData },
			}).then((saved) => {
				const quoteId = saved.body?.document?.id as string;
				expect(quoteId, "quote draft created").to.be.a("string");

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/send`,
					body: { documentId: quoteId, data: quoteData, params: { recipient: CLIENT_EMAIL } },
				}).then((sent) => {
					expect(sent.status, "send accepted").to.be.oneOf([200, 201]);
				});
				cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"]);

				// AT THE API: "save-draft" on a "sent" quote still WORKS - never locked, unlike the
				// invoice/credit-note "any non-draft status" rule.
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: { documentId: quoteId, data: quoteData },
					failOnStatusCode: false,
				}).then((res) => {
					expect(res.status, "a sent quote stays editable").to.be.oneOf([200, 201]);
					expect(res.body?.document?.status, "it goes back to draft, as before").to.eq("draft");
				});

				// Re-send it so the SCREEN part of this test starts from "sent" again, like the other
				// three journeys in this file.
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/send`,
					body: { documentId: quoteId, data: quoteData, params: { recipient: CLIENT_EMAIL } },
				}).then((sent) => {
					expect(sent.status, "second send accepted").to.be.oneOf([200, 201]);
				});
				cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"]);

				cy.visit(`${appOrigin}/documents/quote/${quoteId}`);
				cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should("contain.text", "Sent");
				cy.get('[data-cy="document-save-locked-notice"]').should("not.exist");
				cy.openDocumentActionsMenu();
				cy.get('[data-cy="document-action-save-draft"]').should("exist");

				// Point 3, the mirror case: nothing is locked, so nothing should be disabled either-
				// a "sent" quote stays as editable on screen as it already is at the API.
				cy.get('[data-cy="document-form-readonly"]').should("not.exist");
				cy.get('[data-cy="document-field-issueDate-input"]').should("not.be.disabled");
				cy.get('[data-cy="document-field-lines-add-row"]').should("not.be.disabled");
			});
		});
	});

	/**
	 * Reviewer finding #2 on the #468 lock: a "send_failed" invoice/credit-note is a LOCKED record
	 * (its own "save-draft" refuses every status but "draft") whose NUMBER is already spent - but
	 * "send" used to persist whatever `data` a RETRY submitted, which is exactly what a frontend
	 * re-submitting `form.getValues()` (use-document-form.ts) does on every action. The fix
	 * (documents.service.ts#runAction, right after the country-policy per-status check) replaces the
	 * submitted `data` with the STORED one whenever the record's current status is one this type's
	 * own "save-draft" locks - proven here against a REAL "send_failed" invoice (a client with no
	 * contactEmail makes the "email" transport fail deterministically, the same fixture
	 * 28-document-async-send.cy.ts already uses), retried with modified `data` sent directly to the
	 * API - never through the screen, which doesn't even offer editing a locked record any more
	 * (the point 3 assertions right above).
	 */
	it('a "send_failed" invoice retried with modified `data` keeps the STORED content - the caller\'s edit is silently ignored, never persisted', () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});

		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Send Failed Retry Co",
				// No contactEmail - makes the "email" transport fail deterministically, every attempt,
				// exactly like 28-document-async-send.cy.ts's own "No Email Co" fixture.
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Silent Street",
				city: "Paris",
				postalCode: "75003",
				isActive: true,
				type: "COMPANY",
			},
			failOnStatusCode: false,
		}).then((created) => {
			expect(created.status, "client with no email created").to.eq(201);
			const clientId = created.body.id as string;

			const originalData = {
				client: clientId,
				issueDate: "2026-08-31",
				dueDate: "2026-09-30",
				currency: "EUR",
				lines: [
					{ description: "Original description", quantity: 1, unit: "unit", unitPrice: 80, vatRate: "20" },
				],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: originalData },
			}).then((saved) => {
				const invoiceId = saved.body?.document?.id as string;
				expect(invoiceId, "invoice draft created").to.be.a("string");

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: invoiceId, data: originalData },
				}).then((sent) => {
					expect(sent.status, "send accepted (queued)").to.be.oneOf([200, 201]);
				});

				// Real BullMQ attempts (DOCUMENT_ACTION_QUEUE_ATTEMPTS, exponential backoff) - the
				// same generous budget 28-document-async-send.cy.ts's own "send_failed" test absorbs.
				cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["send_failed"]);

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((before) => {
						expect(before.status, 'really "send_failed"').to.eq("send_failed");
						expect(before.number, "already numbered - the number is spent").to.be.a("number");

						const modifiedData = {
							...originalData,
							lines: [
								{
									...originalData.lines[0],
									description: "REWRITTEN after the fact - must never be stored",
									unitPrice: 999999,
								},
							],
						};

						// The retry itself - modified `data`, sent straight to the API, exactly what a
						// form re-submitting its own current (edited) values would send.
						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/send`,
							body: { documentId: invoiceId, data: modifiedData },
							failOnStatusCode: false,
						}).then((retry) => {
							expect(retry.status, "the retry itself is accepted (still queued)").to.be.oneOf([
								200, 201,
							]);
						});

						// It fails again (same client, still no email) - waiting for "send_failed" once
						// more is what proves the retry actually ran (not merely got queued) before the
						// assertion below reads the STORED content back.
						cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, [
							"send_failed",
						]);

						cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
							.its("body")
							.then((after) => {
								expect(
									after.data?.lines?.[0]?.description,
									"the STORED description is untouched by the retry's own edit",
								).to.eq("Original description");
								expect(
									after.data?.lines?.[0]?.unitPrice,
									"the STORED unit price is untouched by the retry's own edit",
								).to.eq(80);
								expect(after.number, "the same spent number, never a new one").to.eq(
									before.number,
								);
							});
					});
			});
		});
	});
});
