export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #479, point 1: once a quote with options is ACCEPTED (`acceptedOption` set), every summary
 * place shows the accepted option's own total instead of "N options" or no amount at all - the
 * document list, the detail header, the statistics table and the client portal. Before the fix all
 * four only tested the NUMBER of options, so a quote signed for "Premium" still read "2 options".
 *
 * The quote below carries one COMMON (untagged) line plus one line per option, so the expected figure
 * also proves the common line is folded into the accepted option's total, never dropped:
 *   Setup 50 (common) + Premium 200 = 250 net, +20% VAT = 300.00 gross.
 *   Setup 50 (common) + Basic 100   = 150 net, +20% VAT = 180.00 gross.
 * Neither 300.00 nor 180.00 is the sum of every line (350 net, 420.00 gross), so a regression back to
 * "sum everything" fails here too.
 *
 * The acceptance goes through the REAL e-signature path (`request-signature` -> emailed token ->
 * public OTP -> public sign with `option`), driven over HTTP rather than through the public page:
 * that page's own option chooser is already proven by 92-quote-options.cy.ts, what this spec guards
 * is what happens AFTER a signature. A second quote is left "sent" (nothing accepted) to prove the
 * "N options" display is untouched while no choice exists.
 *
 * Mail is read by RECIPIENT through Mailpit's search API, never "the last message" and never by
 * clearing the inbox, so this spec does not depend on (or disturb) mail another spec sends.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const mailpit = Cypress.env("mailpitUrl") || "http://localhost:8025";

const CLIENT_EMAIL = "accepted-option-479@example.com";

const LINES = [
	{ description: "Setup", quantity: 1, unitPrice: 50, vatRate: "20" },
	{
		description: "Basic plan",
		quantity: 1,
		unitPrice: 100,
		vatRate: "20",
		option: "Basic",
	},
	{
		description: "Premium plan",
		quantity: 1,
		unitPrice: 200,
		vatRate: "20",
		option: "Premium",
	},
];

type MailBody = { Text?: string; HTML?: string };

/** Every message body Mailpit holds for `to`, newest first. */
function mailBodies(to: string): Cypress.Chainable<string[]> {
	const bodies: string[] = [];
	return cy
		.request({
			url: `${mailpit}/api/v1/search`,
			qs: { query: `to:"${to}"` },
			failOnStatusCode: false,
		})
		.then((res) => {
			const ids: string[] = (res.body?.messages ?? []).map(
				(message: { ID: string }) => message.ID,
			);
			for (const id of ids) {
				cy.request(`${mailpit}/api/v1/message/${id}`).then((message) => {
					const body = message.body as MailBody;
					bodies.push(`${body.Text ?? ""}\n${body.HTML ?? ""}`);
				});
			}
			return cy.wrap(bodies);
		});
}

/** Polls until a message to `to` matches `pattern`, returning the match from the newest one. */
function findMail(
	to: string,
	pattern: RegExp,
	attemptsLeft = 30,
): Cypress.Chainable<RegExpMatchArray> {
	return mailBodies(to).then((bodies) => {
		const match = bodies
			.map((body) => body.match(pattern))
			.find((found): found is RegExpMatchArray => found !== null);
		if (match) return cy.wrap(match);
		expect(attemptsLeft, `a mail to ${to} matching ${pattern}`).to.be.greaterThan(
			0,
		);
		cy.wait(500);
		return findMail(to, pattern, attemptsLeft - 1);
	});
}

function createClient(): Cypress.Chainable<string> {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Accepted Option Client",
				contactEmail: CLIENT_EMAIL,
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Rue des Options",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.its("body.id");
}

function quoteData(clientId: string) {
	return {
		client: clientId,
		issueDate: new Date().toISOString().slice(0, 10),
		currency: "EUR",
		lines: LINES,
	};
}

function createSentQuote(clientId: string): Cypress.Chainable<string> {
	const data = quoteData(clientId);
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/quote/actions/save-draft`,
			body: { data },
		})
		.then((draft) => {
			const quoteId = draft.body?.document?.id as string;
			expect(quoteId, "quote draft created").to.be.a("string");
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/send`,
				body: {
					documentId: quoteId,
					data,
					params: { recipient: CLIENT_EMAIL },
				},
			});
			cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, [
				"sent",
			]);
			return cy.wrap(quoteId);
		});
}

/** Signs `quoteId` for `option` through the real public signature endpoints. */
function signQuote(clientId: string, quoteId: string, option: string) {
	cy.request({
		method: "POST",
		url: `${api}/api/documents/types/quote/actions/request-signature`,
		body: { documentId: quoteId, data: quoteData(clientId) },
	});
	findMail(CLIENT_EMAIL, /\/signature\/([0-9a-f]{64})/).then((tokenMatch) => {
		const token = tokenMatch[1];
		cy.request({
			method: "POST",
			url: `${api}/api/public/signatures/${token}/otp`,
		});
		findMail(CLIENT_EMAIL, /\b(\d{4})-(\d{4})\b/).then((otp) => {
			cy.request({
				method: "POST",
				url: `${api}/api/public/signatures/${token}/sign`,
				body: { code: `${otp[1]}${otp[2]}`, option },
			})
				.its("status")
				.should("eq", 200);
		});
	});
	cy.request(`${api}/api/documents/${quoteId}?typeId=quote`).then((res) => {
		expect(res.body.status).to.eq("signed");
		expect(res.body.acceptedOption).to.eq(option);
	});
}

/** The figures use the mono web font; a screenshot taken before it has loaded shows blank space
 *  where every amount should be, while the DOM assertions still pass. */
function screenshotOnceFontsLoaded(name: string) {
	cy.document().its("fonts.status").should("eq", "loaded");
	cy.screenshot(name, { capture: "viewport" });
}

describe("Quotes with options: the accepted option's total (issue #479)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.viewport(1280, 720);
		cy.login();
	});

	it("shows the signed option's total in the list, the header, the statistics and the portal", () => {
		createClient().then((clientId) => {
			createSentQuote(clientId).then((openQuoteId) => {
				createSentQuote(clientId).then((signedQuoteId) => {
					signQuote(clientId, signedQuoteId, "Premium");

					// The document list: the signed quote carries Premium's total, the open one none.
					cy.visit("/documents/quote");
					cy.get(`[data-cy="document-list-title-${signedQuoteId}"]`, {
						timeout: 20000,
					}).should("contain.text", "Accepted Option Client");
					cy.get(`[data-cy="document-row-amount-${signedQuoteId}"]`)
						.should("contain.text", "300.00")
						.and("not.contain.text", "420.00");
					cy.get(`[data-cy="document-row-amount-${openQuoteId}"]`).should(
						"not.exist",
					);
					screenshotOnceFontsLoaded("479-list");

					// The detail header.
					cy.visit(`/documents/quote/${signedQuoteId}`);
					cy.get('[data-cy="document-totals-card"]', { timeout: 20000 }).should(
						"be.visible",
					);
					cy.get('[data-cy="document-detail-amount"]').should(
						"contain.text",
						"300.00",
					);
					screenshotOnceFontsLoaded("479-header");

					// The statistics table, read from the API and from the screen.
					cy.request(`${api}/api/documents/statistics`).then((res) => {
						const table = (
							res.body as Array<{
								id: string;
								rows?: Array<Record<string, unknown>>;
							}>
						).find((widget) => widget.id === "quote:all");
						const totals = (table?.rows ?? []).map((row) => ({
							total: row.total,
							optionsCount: row.optionsCount,
						}));
						expect(totals).to.deep.include({ total: 300, optionsCount: undefined });
						expect(totals).to.deep.include({ total: undefined, optionsCount: 2 });
					});
					cy.visit("/statistics");
					cy.get('[data-cy="widget-quote:all"]', { timeout: 20000 })
						.should("be.visible")
						.scrollIntoView();
					cy.get('[data-cy="widget-quote:all"] tbody tr').then(($rows) => {
						const cells = [...$rows].map(
							(row) => row.querySelector("td:last-child")?.textContent ?? "",
						);
						expect(cells).to.include("300");
						expect(cells).to.include("2 options");
					});
					screenshotOnceFontsLoaded("479-statistics");

					// The client portal, with no staff session at all.
					cy.request({
						method: "POST",
						url: `${api}/api/clients/${clientId}/portal-access`,
					}).then((res) => {
						const token = res.body.token as string;
						cy.clearCookies();
						cy.visit(`/portal/${token}`);
						cy.location("pathname", { timeout: 15000 }).should("eq", "/portal");
						cy.get(`[data-cy="portal-quote-row-${signedQuoteId}"]`, {
							timeout: 15000,
						}).should("be.visible");
						cy.get(`[data-cy="portal-quote-amount-${signedQuoteId}"]`)
							.should("contain.text", "300.00")
							.and("not.contain.text", "options");
						cy.get(`[data-cy="portal-quote-amount-${openQuoteId}"]`).should(
							"contain.text",
							"2 options",
						);
						cy.get(`[data-cy="portal-quote-row-${signedQuoteId}"]`).scrollIntoView();
						screenshotOnceFontsLoaded("479-portal");
					});
				});
			});
		});
	});
});
