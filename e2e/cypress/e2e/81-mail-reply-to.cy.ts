export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * A configurable Reply-To header on outgoing mail (#391): the operator can set one instance-wide
 * (`MAIL_REPLY_TO`), a company can set its OWN in Settings > Mail (`mail-settings-reply-to-*`,
 * independent of whether it also runs its own SMTP/Resend server), and the company value wins over
 * the instance one — see `backend/src/mail/mail.service.ts#resolveEffectiveReplyTo`.
 *
 * Usual discipline (`feedback-e2e-ui-driven`): the ACTION (typing the address, clicking Save, sending
 * the document) goes through the screen; the ASSERTIONS read the record back via the API
 * (`GET /api/company/mail-settings`) and the real message in Mailpit — never the screen's own toast
 * as proof of what actually got stored or what the wire actually carried. Same real-SMTP discipline
 * `23-document-email.cy.ts` already uses (the e2e stack's own Mailpit, no gate needed).
 *
 * `mailpitUrl` defaults to the e2e stack's usual `localhost:8025` (same default `commands.ts`'s own
 * `cy.getLastEmail`/`cy.clearEmails` hardcode) — overridable via `CYPRESS_mailpitUrl` for a run
 * against an isolated Mailpit instance without touching that shared helper.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const mailpitUrl = Cypress.env("mailpitUrl") || "http://localhost:8025";

interface CompanyMailSettingsStatus {
	configured: boolean;
	kind?: "smtp" | "resend";
	fromAddress?: string;
	replyTo: string | null;
}

function getMailSettingsStatus() {
	return cy
		.request({ url: `${api}/api/company/mail-settings` })
		.its("body") as unknown as Cypress.Chainable<CompanyMailSettingsStatus>;
}

function clearMailpitInbox() {
	return cy.request("DELETE", `${mailpitUrl}/api/v1/messages`);
}

/**
 * Same poll-budget discipline as `commands.ts#getLastEmail`: the backend sends mail asynchronously,
 * so a single-shot request can race a message that is simply still in flight. ~20 attempts * 500ms
 * ≈ 10s retry budget.
 *
 * Returns BOTH the parsed message (`GET /api/v1/message/{id}`, whose own `ReplyTo` field is already
 * Mailpit's own interpretation of the header) AND the RAW header map
 * (`GET /api/v1/message/{id}/headers`) — confirmed live, 2026-09-23, that `ReplyTo` is genuinely
 * absent from the first endpoint's response shape (no `Headers` key on it at all in this Mailpit
 * version), so checking "no Reply-To header on the wire" needs the dedicated headers endpoint, not a
 * key that was never there to begin with.
 */
function getLastMailpitMessage() {
	function pollForMessage(attemptsLeft: number): Cypress.Chainable<any> {
		return cy
			.request({ url: `${mailpitUrl}/api/v1/messages`, failOnStatusCode: false })
			.then((res) => {
				const messages = res.body?.messages || [];
				if (messages.length === 0 && attemptsLeft > 0) {
					cy.wait(500);
					return pollForMessage(attemptsLeft - 1);
				}
				expect(messages, "a message reached Mailpit after polling").to.have.length.greaterThan(0);
				const id = messages[0].ID;
				return cy.request(`${mailpitUrl}/api/v1/message/${id}`).then((messageRes) =>
					cy.request(`${mailpitUrl}/api/v1/message/${id}/headers`).then((headersRes) => ({
						message: messageRes.body,
						headers: headersRes.body as Record<string, string[]>,
					})),
				);
			});
	}
	return pollForMessage(20);
}

/**
 * Creates a draft quote for the seeded baseline client (API — company/client creation stays in API
 * per `feedback-e2e-ui-driven`'s own exception list) and sends it through a REAL click on the quotes
 * screen (never a direct call to the send action), exactly the pattern `23-document-email.cy.ts`
 * already proves for the PDF attachment. Returns the quote's id once the list shows it Sent.
 */
function createAndSendQuote(recipientEmail: string) {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			expect(clients, "the fixture seeds at least one client").to.have.length.greaterThan(0);

			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							currency: "EUR",
							lines: [{ description: "Consulting", quantity: 1, unitPrice: 500 }],
						},
					},
					failOnStatusCode: false,
				})
				.then((saved) => {
					expect(saved.status, "the quote draft was created").to.be.oneOf([200, 201]);
					const quoteId = saved.body?.document?.id as string;
					expect(quoteId, "the draft has an id").to.be.a("string");

					cy.visit("/documents/quote");
					cy.runDocumentRowAction(quoteId, "send");
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
					cy.get('[data-cy="document-field-recipient-input"]').clear().type(recipientEmail);
					cy.get('[data-cy="document-action-params-confirm"]').click();

					cy.get(`[data-cy="document-list-row-${quoteId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					return cy.wrap(quoteId);
				});
		});
}

const REPLY_TO_ADDRESS = "support-e2e@example.com";
const RECIPIENT_EMAIL = "reply-to-test-client@example.com";

describe("Reply-To address on outgoing mail (#391)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("nothing configured (company or instance): a sent document carries NO Reply-To header at all", () => {
		// Precondition, read back through the API rather than assumed: the fixture never sets a
		// company Reply-To, and this stack's own MAIL_REPLY_TO is unset (`.env.test`) -- but asserting
		// that here, before sending, is what turns a future accidental default into a failure on THIS
		// line instead of a confusing one three requests later.
		getMailSettingsStatus().then((status) => {
			expect(status.replyTo, "no company Reply-To override at the start").to.be.null;
		});

		clearMailpitInbox();
		createAndSendQuote(RECIPIENT_EMAIL);

		getLastMailpitMessage().then(({ message, headers }) => {
			expect(
				message.To?.[0]?.Address,
				"the message went to the recipient typed in the send dialog",
			).to.eq(RECIPIENT_EMAIL);
			expect(
				message.ReplyTo,
				"Mailpit's own parsed Reply-To is empty when nothing was set",
			).to.deep.equal([]);
			// Belt and suspenders on the RAW wire headers too -- "Mailpit's parsed ReplyTo is empty"
			// and "the raw Reply-To header was never sent" are two different claims, and this is the
			// one that matters: nodemailer honours `replyTo: undefined` by omitting the header
			// entirely, never by sending an empty one. `GET /api/v1/message/{id}/headers` is the raw
			// header map (confirmed live: the plain message endpoint above carries no `Headers` key
			// at all in this Mailpit version, so THIS is the only way to see the real wire headers).
			const headerNames = Object.keys(headers || {}).map((name) => name.toLowerCase());
			expect(headerNames, "no Reply-To header on the wire at all").to.not.include("reply-to");
		});
	});

	it('setting the Reply-To through Settings > Mail makes every subsequent send carry it', () => {
		cy.visit("/settings/mail");
		cy.get('[data-cy="mail-settings-reply-to-input"]', { timeout: 15000 }).clear().type(REPLY_TO_ADDRESS);

		cy.intercept("PUT", `${api}/api/company/mail-settings/reply-to`).as("saveReplyTo");
		cy.get('[data-cy="mail-settings-reply-to-save-button"]').click();
		cy.wait("@saveReplyTo", { timeout: 10000 }).then((interception) => {
			expect(
				interception.response?.statusCode,
				"PUT /api/company/mail-settings/reply-to must succeed",
			).to.eq(200);
		});
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Reply-To address saved");

		// The assertion that matters before we even send anything: read the SAME route the screen
		// just used, directly.
		getMailSettingsStatus().then((status) => {
			expect(status.replyTo, "the company's own Reply-To override is now stored").to.eq(
				REPLY_TO_ADDRESS,
			);
		});

		clearMailpitInbox();
		createAndSendQuote(RECIPIENT_EMAIL);

		getLastMailpitMessage().then(({ message, headers }) => {
			expect(
				message.To?.[0]?.Address,
				"the message went to the recipient typed in the send dialog",
			).to.eq(RECIPIENT_EMAIL);
			expect(
				message.ReplyTo,
				"exactly one Reply-To address, the one just configured",
			).to.have.length(1);
			expect(message.ReplyTo[0].Address).to.eq(REPLY_TO_ADDRESS);

			// The RAW wire header, not just Mailpit's own parsed interpretation of it — the literal
			// `Reply-To:` line nodemailer put on the message (see `getLastMailpitMessage`'s own header
			// on why this needs the dedicated `/headers` endpoint).
			expect(headers["Reply-To"], "the raw Reply-To header carries exactly this address").to.deep.equal([
				REPLY_TO_ADDRESS,
			]);
		});
	});
});
