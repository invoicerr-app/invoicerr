export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #373 follow-up (PR #475 review). Covers the four points the owner asked for screenshots on:
 *
 *  3. request-deposit on a "sent" quote with 2+ options - the real, permanent-limitation message
 *     ("not supported for a quote with options"), never the old "try again once an option has been
 *     chosen" (which can never happen: choosing an option moves the quote OFF "sent").
 *  4. request-installments - same fix, same reasoning.
 *  5. the "see the attached document for each option..." sentence in the covering email, rendered in
 *     the recipient's own language (French here) - never the hard-coded English literal.
 *  7. the statistics table for a quote with 2+ options: a real currency (never blank) and a
 *     translated "N options" label (never the untranslated English string).
 *
 * Points 1/2 (the acceptance race and the stale-acceptedOption conversion refusal) are proven by
 * backend specs against the real database (signatures/quote-acceptance-race.spec.ts,
 * options/quote-options.spec.ts) - a race and a mid-flight rename are not reproducible through a
 * single Cypress run without an artificial synchronization point, which would test the test harness
 * more than the product.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const appOrigin = "http://localhost:6284";

function createClient(name: string, contactEmail: string, language?: string) {
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
				address: "1 Rue des Options",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				...(language ? { language } : {}),
			},
		})
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "the created client has an id").to.be.a("string");
			return id;
		});
}

function saveAndSendQuote(clientId: string, recipient: string) {
	const quoteData = {
		client: clientId,
		issueDate: new Date().toISOString().slice(0, 10),
		currency: "EUR",
		lines: [
			{ description: "Basic package", quantity: 1, unitPrice: 100, option: "Basic", vatRate: "20" },
			{ description: "Premium package", quantity: 1, unitPrice: 200, option: "Premium", vatRate: "20" },
		],
	};
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/quote/actions/save-draft`,
			body: { data: quoteData },
		})
		.then((draft) => {
			const quoteId = draft.body?.document?.id as string;
			expect(quoteId, "quote draft created").to.be.a("string");
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/send`,
					body: { documentId: quoteId, data: quoteData, params: { recipient } },
				})
				.then((res) => {
					expect(res.status, "send accepted").to.be.oneOf([200, 201]);
					return cy
						.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"])
						.then(() => quoteId);
				});
		});
}

describe("Quotes with options - PR #475 follow-up screenshots", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.viewport(1280, 720);
		cy.login();
	});

	it("point 3: request-deposit on a sent quote with options shows the real, permanent-limitation message", () => {
		createClient("Deposit Options Client", "deposit-options@example.com").then((clientId) => {
			saveAndSendQuote(clientId, "deposit-options@example.com").then((quoteId) => {
				cy.visit(`${appOrigin}/documents/quote`);
				cy.runDocumentRowAction(quoteId, "request-deposit");
				cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
				cy.get('[data-cy="document-field-percent-input"]', { timeout: 10000 })
					.should("be.visible")
					.click();
				cy.wait(50);
				cy.get('[data-cy="document-field-percent-input"]')
					.type("{selectall}25")
					.should("have.value", "25");
				cy.get('[data-cy="document-action-params-confirm"]').click();

				cy.get('[data-sonner-toast]', { timeout: 10000 }).should(
					"contain.text",
					"not supported for a quote with options",
				);
				cy.get('[data-sonner-toast]').should(
					"not.contain.text",
					"once an option has been chosen",
				);
				cy.wait(500);
				// An ELEMENT screenshot of the toast itself, not the viewport: a viewport capture at
				// this harness's own effective resolution cropped the message's right edge (the toast
				// sits near the screen edge and its own text runs wider than what a viewport crop kept)
				// - the toast's own bounding box is captured regardless of where it sits on the page.
				cy.get('[data-sonner-toast]').last().screenshot("475-after-deposit-message");
			});
		});
	});

	it("point 4: request-installments on a sent quote with options shows the real, permanent-limitation message", () => {
		createClient("Installments Options Client", "installments-options@example.com").then((clientId) => {
			saveAndSendQuote(clientId, "installments-options@example.com").then((quoteId) => {
				cy.visit(`${appOrigin}/documents/quote`);
				cy.runDocumentRowAction(quoteId, "request-installments");
				cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");

				// Two structurally-valid milestones - the options refusal fires before the percent-sum
				// rule ever runs (request-installments.ts's own header), so any valid-shaped pair proves
				// the same message.
				cy.get('[data-cy="document-field-milestones-add-row"]').click();
				cy.get('[data-cy="document-field-milestones-row-0"]').should("exist");
				cy.get('input[name="milestones.0.percent"]').clear({ force: true }).type("50", { force: true });
				cy.pickToday('[data-cy="document-field-milestones-row-0"] [data-cy="document-field-dueDate-input"]');

				cy.get('[data-cy="document-field-milestones-add-row"]').click();
				cy.get('[data-cy="document-field-milestones-row-1"]').should("exist");
				cy.get('input[name="milestones.1.percent"]').clear({ force: true }).type("50", { force: true });
				cy.pickToday('[data-cy="document-field-milestones-row-1"] [data-cy="document-field-dueDate-input"]');

				cy.get('[data-cy="document-action-params-confirm"]').click();

				cy.get('[data-sonner-toast]', { timeout: 10000 }).should(
					"contain.text",
					"not supported for a quote with options",
				);
				cy.get('[data-sonner-toast]').should(
					"not.contain.text",
					"once an option has been chosen",
				);
				cy.wait(500);
				// Element screenshot - same reasoning as the deposit test above.
				cy.get('[data-sonner-toast]').last().screenshot("475-after-installments-message");
			});
		});
	});

	it("point 5: the covering email's multi-option sentence renders in French for a French client", () => {
		const recipient = "options-fr@example.com";
		createClient("Client Options FR", recipient, "fr").then((clientId) => {
			cy.clearEmails();
			saveAndSendQuote(clientId, recipient).then(() => {
				cy.getLastEmail().then((message: { HTML?: string; Text?: string }) => {
					const html = message.HTML ?? "";
					const text = message.Text ?? "";
					expect(html + text, "the French sentence appears somewhere in the email").to.match(
						/consultez le document joint pour chaque option et son propre total/,
					);
					// Exactly one period ending the sentence, never a double one (the template's own
					// sentence already ends with "." right after the placeholder).
					expect(html + text, "no double period").to.not.match(/propre total\.\./);
					expect(html + text, "never the English literal").to.not.match(/see the attached document/i);

					// Render Mailpit's own HTML body into the browser so the screenshot shows the actual
					// rendered email, not raw markup.
					cy.document().then((doc) => {
						doc.open();
						doc.write(html || `<pre>${text}</pre>`);
						doc.close();
					});
					cy.wait(500);
					cy.screenshot("475-after-email-fr", { capture: "fullPage" });
				});
			});
		});
	});

	it("point 7: the statistics table shows a real currency and a translated option-count label", () => {
		createClient("Statistics Options Client", "statistics-options@example.com").then((clientId) => {
			saveAndSendQuote(clientId, "statistics-options@example.com").then(() => {
				cy.visit(`${appOrigin}/statistics`);
				cy.get('[data-cy="widget-quote:all"]', { timeout: 15000 }).should("be.visible");
				cy.get('[data-cy="widget-quote:all"]').should("contain.text", "EUR");
				cy.get('[data-cy="widget-quote:all"]').should("contain.text", "2 options");
				cy.wait(500);
				cy.get('[data-cy="widget-quote:all"]').scrollIntoView().screenshot("475-after-statistics");
			});
		});
	});
});
