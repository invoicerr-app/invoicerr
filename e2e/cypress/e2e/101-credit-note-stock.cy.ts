export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * PR #473 review point 2 - "a credit note must never decrement stock".
 *
 * Credit notes are now numbered (issue #471), so `applyStockOnIssuance` runs at issuance the same way
 * it does for an invoice. A credit note's own line shape declares no article-reference field at all
 * (`credit-note.descriptor.ts`'s "Lines" field has no `articleId`) - but the line VALIDATOR
 * (`descriptors/validate.ts`) keeps any undeclared key a caller still posts, so the API genuinely
 * ACCEPTS an `articleId` on a credit-note line. The fix gates the stock effect itself on what the
 * document TYPE's own descriptor declares (`stock/apply-stock-on-issuance.ts#declaresArticleReference`)
 * rather than refusing the field - this proves the API still accepts it (never silently dropped) and
 * that the article's stock is nonetheless UNCHANGED once the credit note is sent.
 */
const api = Cypress.env("apiUrl");

function createTrackedArticle() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/articles`,
			body: { name: "Widget crédité", unitPrice: 100, vatRate: 20, quantity: 10, lowStockThreshold: 3 },
		})
		.then((res) => {
			expect(res.status, "article created").to.be.oneOf([200, 201]);
			expect(res.body.quantity, "initial stock").to.eq(10);
			return res.body.id as string;
		});
}

describe('PR #473 review point 2 - a credit note with an articleId on its line never decrements stock', () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('posting and sending a FREE credit note whose line carries a stock-tracked articleId leaves the article\'s stock untouched', () => {
		createTrackedArticle().then((articleId) => {
			const creditNoteData = {
				issueDate: "2026-09-20",
				currency: "EUR",
				reason: "Geste commercial - remboursement d'un trop-perçu non rattaché à une facture.",
				// THE PROOF this API call means to make: the SAME `articleId` a stock-tracked invoice
				// line would use (49-stock.cy.ts), on a credit-note line - accepted (never rejected),
				// but never read by the stock effect at all.
				lines: [
					{
						articleId,
						description: "Widget crédité",
						quantity: 4,
						unitPrice: 100,
						vatRate: "20",
					},
				],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/credit-note/actions/save-draft`,
				body: { data: creditNoteData },
			}).then((saved) => {
				const creditNoteId = saved.body?.document?.id as string;
				expect(creditNoteId, "credit note draft created").to.be.a("string");
				// THE API GENUINELY ACCEPTS IT - the line validator keeps any undeclared key, so the
				// `articleId` survives straight into the persisted draft. The fix is never "reject this
				// field", only "never act on it for stock".
				const persistedLines = saved.body?.document?.data?.lines as Array<{ articleId?: string }>;
				expect(persistedLines?.[0]?.articleId, "the articleId survived validation, unrejected").to.eq(
					articleId,
				);

				// Before issuance: stock unchanged (as always - the decrement, if it ran at all, would
				// only ever happen at ISSUANCE).
				cy.request({ url: `${api}/api/articles/${articleId}` })
					.its("body.quantity")
					.should("eq", 10);

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/credit-note/actions/send`,
					body: { documentId: creditNoteId, data: creditNoteData },
				}).then((sent) => {
					expect(sent.status, "send accepted").to.be.oneOf([200, 201]);
				});
				cy.waitForDocumentStatus(`${api}/api/documents/${creditNoteId}?typeId=credit-note`, ["sent"]);

				// THE FIX ITSELF: the credit note is genuinely issued (numbered, sent)...
				cy.request({ url: `${api}/api/documents/${creditNoteId}?typeId=credit-note` })
					.its("body")
					.then((doc) => {
						expect(doc.status, "issued").to.eq("sent");
						expect(doc.displayNumber, "numbered like every credit note since issue #471").to.eq(
							"CN-2026-0001",
						);
					});

				// ...and the article's stock is EXACTLY what it was before - never decremented by a
				// credit note, whatever its lines carry.
				cy.request({ url: `${api}/api/articles/${articleId}` })
					.its("body.quantity")
					.should("eq", 10);
			});
		});
	});
});
