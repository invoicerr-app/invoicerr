export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Electronic quote signature (email OTP) — HARDENED
 * (GHSA-vhjw-gwc5-pjfp closed). Proven THROUGH THE SCREEN, on the anonymous client side: the seller
 * requests a signature (`request-signature` action on a "sent" quote), the client receives a
 * high-entropy token link by email, opens the public `/signature/:token` page, reviews the document
 * (the Review step's own `GET .../document` PDF preview — the same frozen artifact `sign` will seal,
 * see the backend's own `SignaturesService.getPublicDocument` header), ticks the mandatory "I have
 * read the document" box, requests an OTP (sent by email), enters it, and signs — the quote moves to
 * SIGNED. The ASSERTIONS that matter read the API back; the real OTP and the real token are READ
 * from Mailpit (never guessed), the same discipline as 23-document-email.cy.ts. The anti-brute-force
 * guarantee (lifetime lockout ≤ 0.01%) and the CSPRNG are proven exhaustively in jest
 * (`signatures/otp.spec.ts`, `signatures.service.spec.ts`); here we prove the real on-screen JOURNEY +
 * the named refusal of a wrong code.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
const appOrigin = "http://localhost:6284";

function bodyOf(message: { Text?: string; HTML?: string }): string {
	return `${message.Text ?? ""}\n${message.HTML ?? ""}`;
}

/** Creates a quote, sends it (→ "sent"), then triggers `request-signature` — returns the signature
 *  token READ from the request email (never fabricated). The quote is sent to the seeded client
 *  (which carries a contactEmail), exactly the recipient the signature link is sent to. */
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

					// Mailpit is cleared JUST before the signature request, so "the last email" is
					// unambiguously the one carrying the link.
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

/**
 * The Review step's own gate: waits for the REAL `GET .../document` request the page fires as soon as
 * it resolves the token (never a stub — this proves the SAME network call a scripted client hitting
 * the public API directly would see — the intercept itself is armed by the caller, BEFORE `cy.visit`,
 * so it can never miss a request the page fires on mount — see this function's own call sites), then
 * ticks the mandatory checkbox that unlocks "Send verification code".
 */
function confirmDocumentReviewed(): void {
	cy.get('[data-cy="signature-card"]', { timeout: 15000 }).should("be.visible");
	cy.wait("@signatureDocument", { timeout: 15000 }).then((x) => {
		expect(x.response?.statusCode, "le document du Review se charge (200)").to.eq(200);
		expect(
			String(x.response?.headers["content-type"]),
			"et il est servi comme un PDF",
		).to.contain("application/pdf");
	});
	cy.get('[data-cy="signature-document-preview"]', { timeout: 15000 }).should("exist");
	cy.get('[data-cy="signature-confirm-read-checkbox"]').click();
}

/** "Sign" now only OPENS the confirmation dialog — it never signs by itself any more (issue #198).
 *  Every spec that needs to actually seal the document goes through this, never a bare click on
 *  `signature-sign-button`. */
function confirmSignatureDialog(): void {
	cy.get('[data-cy="signature-sign-button"]').click();
	cy.get('[data-cy="signature-confirm-dialog"]').should("be.visible");
	cy.get('[data-cy="signature-confirm-dialog-confirm"]').click();
}

/** A `GET` against an authenticated route, using a session cookie value captured EARLIER rather than
 *  `cy.login()` itself — `cy.session()` (which `cy.login()` wraps) navigates the browser to
 *  `about:blank` and wipes cookies/storage across every domain as part of restoring its cached
 *  session, even when that session is already the active one (confirmed on screen: a mid-test
 *  `cy.login()` call blanks whatever page is currently loaded). Harmless at the very END of a test,
 *  where nothing more happens on the page afterward — fatal to a test that still needs the public
 *  signature page alive after the check, which is exactly why this exists. */
function authedGet(authCookie: string, url: string) {
	return cy.request({ url, headers: { Cookie: `better-auth.session_token=${authCookie}` } });
}

describe("Electronic quote signature — client journey on screen, hardened", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	// This ONE journey deliberately carries three proofs, rather than three separate tests: the
	// "otp" route is throttled at 3/min/IP for real (`public-signatures.controller.ts`'s own
	// `@Throttle`), and every "request a code" click in this file spends one of those three — a
	// fourth `it()` block that also requests a code would throttle itself out the moment the whole
	// spec (not just this test) runs inside one 60s window, exactly the way the OTHER test below
	// spends the file's second and last one.
	it("a client opens the link, requests a code, backs out once, weathers a tab focus churn, then SIGNS — the quote moves to SIGNED", () => {
		// Captured BEFORE `cy.clearCookies()` below so Proof 1 can check the API mid-flow without
		// calling `cy.login()` again — see `authedGet`'s own header.
		cy.getCookie("better-auth.session_token").then((sessionCookie) => {
			expect(sessionCookie, "session cookie présent avant le passage en visiteur anonyme").to.not.be
				.null;
			cy.wrap((sessionCookie as Cypress.Cookie).value).as("authCookie");
		});

		createSentQuoteAndRequestSignature().then(({ quoteId, token }) => {
			// The public page is anonymous (no session) — the client side never logs in.
			cy.clearCookies();
			cy.clearEmails();
			// Armed BEFORE the visit: the page fires this request on mount, not on a later click — an
			// intercept registered after `cy.visit` could race the request and miss it entirely.
			cy.intercept("GET", "**/api/public/signatures/*/document").as(
				"signatureDocument",
			);
			// An EXACT match (no wildcard after the token) — `.../otp` and `.../sign` are different
			// URLs and must never bump this counter, or the focus-churn proof below would prove nothing.
			cy.intercept("GET", `**/api/public/signatures/${token}`).as(
				"signatureResolve",
			);
			cy.visit(`${appOrigin}/signature/${token}`);
			cy.wait("@signatureResolve");

			confirmDocumentReviewed();
			cy.get('[data-cy="signature-request-otp-button"]').click();
			cy.get('[data-cy="signature-otp-message"]', { timeout: 10000 }).should(
				"be.visible",
			);

			cy.getLastEmail().then((message: { Text?: string; HTML?: string }) => {
				// The email shows the code as two halves separated by a dash ("1234-5678") — it is
				// recombined into 8 digits for input.
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

				// Proof 1 — "Back" cancels: the dialog closes back onto the SAME Verify step, the code
				// stays exactly as typed, and nothing was signed (checked against the API, never just
				// the screen — a screen that merely forgot to re-show a stale success card would still
				// look right here otherwise).
				cy.get('[data-cy="signature-sign-button"]').click();
				cy.get('[data-cy="signature-confirm-dialog"]').should("be.visible");
				cy.get('[data-cy="signature-confirm-dialog-cancel"]').click();
				cy.get('[data-cy="signature-confirm-dialog"]').should("not.exist");
				cy.get('[data-cy="signature-otp-input"]').should("exist");
				cy.get('[data-cy="signature-card"]')
					.find("input")
					.first()
					.should("have.value", code);
				cy.get("@authCookie").then((authCookie) => {
					authedGet(authCookie as unknown as string, `${api}/api/documents/${quoteId}?typeId=quote`)
						.its("body")
						.then((doc) => {
							expect(
								doc.status,
								"'Back' ne déclenche jamais la signature",
							).to.eq("sent");
						});
				});

				// Proof 2 — a background-tab blur/focus/visibilitychange mid-entry (issue #380) is not
				// a gesture the app should react to: the token was already resolved once on mount, and
				// re-resolving it now has nothing to offer but a chance to reset state mid-entry.
				cy.get("@signatureResolve.all")
					.its("length")
					.as("resolveCallsBeforeFocusChurn");
				cy.window().then((win) => {
					win.dispatchEvent(new Event("blur"));
					win.dispatchEvent(new Event("focus"));
					win.document.dispatchEvent(new Event("visibilitychange"));
				});
				cy.get('[data-cy="signature-otp-input"]').should("exist");
				cy.get('[data-cy="signature-request-otp-button"]').should("not.exist");
				cy.get('[data-cy="signature-card"]')
					.find("input")
					.first()
					.should("have.value", code);

				// Proof 3 — the actual sign. No `cy.wait(ms)` for proof 2 above: this real sign
				// round-trip right after is itself the deterministic wait a would-be extra "resolve"
				// refetch would have had every chance to beat — one that never fires never will, and
				// the count is checked right after this settles.
				confirmSignatureDialog();
				cy.get('[data-cy="signature-success-card"]', { timeout: 15000 }).should(
					"be.visible",
				);
				cy.get("@resolveCallsBeforeFocusChurn").then((before) => {
					cy.get("@signatureResolve.all")
						.its("length")
						.should("eq", before);
				});
			});

			// The truth is in the database, read back via the API (never the screen alone): the quote is SIGNED.
			cy.get("@authCookie").then((authCookie) => {
				authedGet(authCookie as unknown as string, `${api}/api/documents/${quoteId}?typeId=quote`)
					.its("body")
					.then((doc) => {
						expect(
							doc.status,
							"le devis est passé SIGNED après signature réelle",
						).to.eq("signed");
					});
			});
		});
	});

	it("a wrong code is refused ON SCREEN (named message) and does NOT sign the quote", () => {
		createSentQuoteAndRequestSignature().then(({ quoteId, token }) => {
			cy.clearCookies();
			cy.intercept("GET", "**/api/public/signatures/*/document").as(
				"signatureDocument",
			);
			cy.visit(`${appOrigin}/signature/${token}`);

			confirmDocumentReviewed();
			cy.get('[data-cy="signature-request-otp-button"]').click();
			cy.get('[data-cy="signature-otp-message"]', { timeout: 10000 }).should(
				"be.visible",
			);

			// A deliberately WRONG code (never the one from the email) — the refusal must be named,
			// never a silent signature.
			cy.get('[data-cy="signature-card"]')
				.find("input")
				.first()
				.type("00000000", { force: true });
			confirmSignatureDialog();
			cy.get('[data-cy="signature-sign-error"]', { timeout: 10000 }).should(
				"be.visible",
			);
			cy.get('[data-cy="signature-success-card"]').should("not.exist");
			// The refusal closes the dialog back onto the Verify step — it must not linger over an
			// error it has nothing to say about.
			cy.get('[data-cy="signature-confirm-dialog"]').should("not.exist");

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
