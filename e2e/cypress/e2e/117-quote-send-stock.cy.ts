export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #579 - "a sent quote moves stock, and its invoice converted from it moves it again".
 *
 * `declaresArticleReference` (stock/apply-stock-on-issuance.ts) used to answer "can a line of this
 * type reference an article" - TRUE for the quote too, since its own `lines` declares the exact same
 * `articleId` field the invoice's does (filled by a catalog pick). That made the quote's own "send"
 * (quote-actions.ts, unconditionally by email) decrement stock exactly like an invoice's, and
 * converting that quote into an invoice and sending IT decremented the SAME sale's stock a second
 * time. The fix: `DocumentTypeDescriptor.stockEffect` is now an EXPLICIT descriptor fact
 * (`stockEffect: 'decrement'`, invoice.descriptor.ts only) every `applyStockOnIssuance` call site
 * gates on instead - see descriptors/types.ts's own header for the full reasoning.
 *
 * This spec proves the real end-to-end wiring (the decrement happens server-side at issuance, never
 * client-side): an article starts at 10, sending a quote for 3 of it leaves the article at 10, and
 * sending the invoice converted from that quote brings it down to 7 - exactly once, exactly the
 * number the issue itself names.
 */
const api = Cypress.env("apiUrl");

function createTrackedArticle() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/articles`,
			body: { name: "Widget en stock (quote)", unitPrice: 100, vatRate: 20, quantity: 10 },
		})
		.then((res) => {
			expect(res.status, "article created").to.be.oneOf([200, 201]);
			expect(res.body.quantity, "initial stock").to.eq(10);
			return res.body.id as string;
		});
}

function createClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Issue 579 Client SARL",
				contactEmail: "issue-579-client@example.com",
				currency: "EUR",
				country: "FR",
				address: "1 Rue du Stock",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "987654321" }],
			},
		})
		.its("body.id");
}

describe("Issue #579 - a sent quote never moves stock, its converted invoice moves it exactly once", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
		}).then((res) => expect(res.status).to.be.oneOf([200, 201]));
	});
	beforeEach(() => {
		cy.login();
	});

	it("article stock 10, quote for 3 sent: still 10; its invoice sent: 7", () => {
		createTrackedArticle().then((articleId: string) => {
			createClient().then((clientId: string) => {
				const quoteData = {
					client: clientId,
					issueDate: "2026-09-20",
					currency: "EUR",
					lines: [
						{
							articleId,
							description: "Widget en stock (quote)",
							quantity: 3,
							unitPrice: 100,
							vatRate: "20",
						},
					],
				};

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: { data: quoteData },
				}).then((savedQuote) => {
					const quoteId = savedQuote.body?.document?.id as string;
					expect(quoteId, "quote draft created").to.be.a("string");

					// Before the quote is even sent: stock untouched, as always.
					cy.request({ url: `${api}/api/articles/${articleId}` })
						.its("body.quantity")
						.should("eq", 10);

					// Sending the QUOTE - the quote's own "send" is unconditionally by email, hence `recipient`.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/send`,
						body: { documentId: quoteId, data: quoteData, params: { recipient: "client@example.com" } },
					}).then((sent) => expect(sent.status, "quote send accepted").to.be.oneOf([200, 201]));
					cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"]);

					// THE FIX ITSELF: the quote is genuinely issued (numbered, sent)...
					cy.request({ url: `${api}/api/documents/${quoteId}?typeId=quote` })
						.its("body")
						.then((doc) => {
							expect(doc.status, "quote issued").to.eq("sent");
							expect(doc.number, "quote numbered").to.not.eq(null);
						});

					// ...and stock is EXACTLY what it was before: a sent quote never moves stock.
					cy.request({ url: `${api}/api/articles/${articleId}` })
						.its("body.quantity")
						.should("eq", 10);

					// Converting the sent quote into a draft invoice - actions/convert-to-invoice.ts copies
					// `lines` (articleId included) verbatim, but deliberately leaves `dueDate` unset and each
					// line's `unit` absent (the quote's own line shape has no `unit` field at all), so this
					// draft is not yet valid to send on its own.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/convert-to-invoice`,
						body: { documentId: quoteId, data: quoteData },
					}).then((converted) => {
						expect(converted.status, "convert-to-invoice accepted").to.be.oneOf([200, 201]);
						const invoiceId = converted.body?.document?.id as string;
						expect(invoiceId, "draft invoice created").to.be.a("string");
						const convertedData = converted.body?.document?.data as {
							client: string;
							issueDate: string;
							currency: string;
							lines: Array<Record<string, unknown>>;
						};
						expect(convertedData.lines[0].articleId, "the articleId followed the line over").to.eq(
							articleId,
						);

						// Completing the draft the way a user would on screen - the two fields
						// convert-to-invoice.ts deliberately leaves for the user to finish, PLUS
						// `issueDate` pulled back before France's PDP channel mandate takes effect
						// (2026-09-01); convert-to-invoice.ts always stamps the new invoice with TODAY,
						// which this run's own clock puts past that date; the mandate is a transport
						// concern unrelated to stock and not what this spec is about (see 49-stock.cy.ts's
						// own identical pre-mandate `issueDate` for the same reason).
						const invoiceData = {
							...convertedData,
							issueDate: "2026-08-30",
							dueDate: "2026-10-20",
							lines: convertedData.lines.map((line) => ({ ...line, unit: "unit" })),
						};

						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/save-draft`,
							body: { documentId: invoiceId, data: invoiceData },
						}).then((savedInvoice) =>
							expect(savedInvoice.status, "invoice draft completed").to.be.oneOf([200, 201]),
						);

						// Stock is STILL untouched - only ISSUING the invoice may move it, never converting
						// or saving a draft.
						cy.request({ url: `${api}/api/articles/${articleId}` })
							.its("body.quantity")
							.should("eq", 10);

						// Sending the INVOICE - THE one document type that actually decrements stock.
						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/send`,
							body: { documentId: invoiceId, data: invoiceData },
						}).then((sentInvoice) =>
							expect(sentInvoice.status, "invoice send accepted").to.be.oneOf([200, 201]),
						);
						cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

						cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
							.its("body")
							.then((doc) => {
								expect(doc.status, "invoice issued").to.eq("sent");
								expect(doc.number, "invoice numbered").to.not.eq(null);
							});

						// THE WHOLE POINT: 10 - 3 = 7, decremented EXACTLY ONCE for this one sale, never
						// twice (once by the quote, once by the invoice, the bug this issue fixes), never
						// zero (the invoice must still decrement - this is not "stock never moves at all").
						cy.request({ url: `${api}/api/articles/${articleId}` })
							.its("body.quantity")
							.should("eq", 7);
					});
				});
			});
		});
	});
});
