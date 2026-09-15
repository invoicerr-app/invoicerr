export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * TODO_FEATURES.md rank 1 ("paiement en ligne") — the last of the five. A company connects Stripe
 * (fake test-mode credentials, through the real Settings → Payments screen), an invoice gains a Pay
 * link in the client portal, clicking it opens a REAL checkout session against the backend's own
 * `NODE_ENV=test` fake Stripe client (no network, no account — see `stripe-checkout-client.ts`'s own
 * header), and the mocked provider "reports success" the only honest way an offline suite can: a
 * SIMULATED webhook call, signed with a REAL HMAC-SHA256 the exact way Stripe itself signs one
 * (`cy.task("stripeWebhookSignature")`, node's own `crypto`, mirroring
 * `stripe-signature.ts#verifyStripeSignature` byte-for-byte) — the backend's OWN, unmocked signature
 * verification is what actually accepts or rejects it, so a pass here is real evidence about THIS
 * app's webhook boundary, never a tautology.
 *
 * WHAT THIS SPEC DOES AND DOES NOT PROVE (say it here, not only in the backend's own comments): it
 * proves the WIRING end to end — a session is created, correlated by its own provider id, and turned
 * into a real `DocumentPayment` through the exact same "record-payment" action a hand-entered payment
 * uses, exactly once even when the webhook is redelivered. It does NOT prove a real card was ever
 * charged or that Stripe's own servers would actually deliver this request — that needs a real account
 * (see `stripe.live.spec.ts`'s own header for the exact command to run the day one exists).
 *
 * Same disciplines this suite already holds elsewhere:
 *  - actions by clicking, assertions by reading the record (28/34/37/45/56's own convention).
 *  - the checkout session itself is never actually opened (a nonexistent host,
 *    `mock-stripe.invalid`) — `window.open` (the Pay button's own new-tab mechanism, `PayButton`'s own
 *    header) is stubbed BEFORE the click, the same `cy.stub(win, "open")` idiom `19-document-pdf.cy.ts`/
 *    `30-document-xml-format.cy.ts` already use for a download link; the REAL POST this button makes is
 *    instead observed via `cy.intercept` (a spy, never a mocked response — the request still hits the
 *    real backend).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const STRIPE_SECRET_KEY = "sk_test_e2e_fake_secret_key";
const STRIPE_WEBHOOK_SECRET = "whsec_e2e_fake_webhook_secret";

function configureEmailTransport() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		})
		.then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});
}

function createClient(name: string, email: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				contactEmail: email,
				currency: "EUR",
				country: "FR",
				address: "1 Rue du Portail",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.its("body.id");
}

function createSentInvoice(clientId: string) {
	const data = {
		client: clientId,
		issueDate: "2026-08-31",
		dueDate: "2026-09-30",
		currency: "EUR",
		lines: [{ description: "Conseil", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" }],
	};
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			expect(id, "invoice draft created").to.be.a("string");
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/send`,
				body: { documentId: id, data },
			}).then((res) => expect(res.status, "invoice send accepted").to.be.oneOf([200, 201]));
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
			return cy.wrap(id);
		});
}

/** Connects Stripe through the REAL Settings → Payments screen — the same UI-driven discipline
 *  `31-national-channels.cy.ts` already holds for PDP/KSeF/SdI/Chorus Pro. Fake credentials: this
 *  backend runs `NODE_ENV=test` (`.env.test`), so `documents-core.module.ts#buildPaymentProviderRegistry`
 *  wires the network-free `FakeStripeCheckoutClient` regardless of what is typed here — see that
 *  factory's own header. Only the WEBHOOK SECRET typed here is ever actually used for real: it is what
 *  the simulated webhook later signs against. */
function connectStripe() {
	cy.visit("/settings/payments");
	cy.get('[data-cy="payment-provider-stripe-secretkey-input"]').clear().type(STRIPE_SECRET_KEY);
	cy.get('[data-cy="payment-provider-stripe-webhooksecret-input"]').clear().type(STRIPE_WEBHOOK_SECRET);
	cy.get('[data-cy="payment-provider-stripe-connect-button"]').click();
	cy.get('[data-cy="payment-provider-stripe-status"]', { timeout: 15000 }).should("contain", "Connected");
}

function inviteToPortal(clientId: string): Cypress.Chainable<string> {
	return cy
		.request({ method: "POST", url: `${api}/api/clients/${clientId}/portal-access` })
		.its("body.token") as Cypress.Chainable<string>;
}

describe("Online payment (TODO_FEATURES.md rank 1)", () => {
	beforeEach(() => {
		cy.login();
	});

	it("connects Stripe, opens a real (faked) checkout session from the portal, and a signed webhook settles the invoice exactly once", () => {
		configureEmailTransport();
		connectStripe();

		cy.request({ url: `${api}/api/company/info` })
			.its("body.id")
			.then((companyId: string) => {
				expect(companyId, "active company id resolved").to.be.a("string");

				createClient("Payer SARL", "payer@example.com").then((clientId: string) => {
					createSentInvoice(clientId).then((invoiceId: string) => {
						inviteToPortal(clientId).then((token: string) => {
							// The bootstrap route (`/portal/:token`) — a REAL browser navigation, exactly the
							// mechanism `56-client-portal.cy.ts` already proved end to end; not re-tested here.
							cy.visit(`/portal/${token}`);
							cy.url({ timeout: 15000 }).should("include", "/portal");
							cy.get(`[data-cy="portal-document-row-${invoiceId}"]`, { timeout: 15000 }).should(
								"be.visible",
							);

							// Never actually open the (nonexistent) provider host — see this file's own header.
							// Stubbed BEFORE the click so the very first call is caught.
							cy.window().then((win) => {
								cy.stub(win, "open").as("windowOpen");
							});
							cy.intercept("POST", "**/api/portal/documents/invoice/*/checkout-session").as(
								"createCheckoutSession",
							);

							cy.get(`[data-cy="portal-pay-button-${invoiceId}"]`).click();

							cy.wait("@createCheckoutSession").then((interception) => {
								expect(interception.response?.statusCode, "session opened").to.eq(201);
								const checkoutUrl = interception.response?.body?.checkoutUrl as string;
								expect(checkoutUrl, "a checkout URL came back").to.contain("mock-stripe.invalid");

								// The RETURN URL Stripe would send the buyer back to must carry THIS session's own
								// portal token (`/portal/<token>`, never bare `/portal`) — a checkout opened in a
								// NEW tab (`PayButton`'s own header) has no `localStorage` entry yet for the bare
								// `/portal` route to read a token from. `FakeStripeCheckoutClient` echoes the raw
								// `successUrl` it received as a `success_url` query param on the mock checkoutUrl —
								// see that class's own header — purely so this is observable end to end through a
								// real HTTP response, never a second, hand-rolled reimplementation of the fix.
								const returnUrl = new URL(checkoutUrl).searchParams.get("success_url");
								expect(
									returnUrl,
									"return URL carries this session's own portal token, not bare /portal",
								).to.contain(`/portal/${token}?payment=success`);
							});
							cy.get("@windowOpen").should(
								"have.been.calledWithMatch",
								/^https:\/\/mock-stripe\.invalid\//,
							);

							// The session this button just opened — read back through the STAFF-facing endpoint
							// (assertions via the API, same convention throughout this suite), never guessed.
							cy.request({ url: `${api}/api/payments/${invoiceId}/sessions` })
								.its("body")
								.then((sessions: { providerSessionId: string; status: string }[]) => {
									expect(sessions, "exactly one session opened").to.have.length(1);
									expect(sessions[0].status, "still pending — no webhook delivered yet").to.eq(
										"PENDING",
									);
									const providerSessionId = sessions[0].providerSessionId;

									const payload = JSON.stringify({
										id: "evt_e2e_1",
										type: "checkout.session.completed",
										data: { object: { id: providerSessionId, payment_status: "paid" } },
									});
									const timestampSeconds = Math.floor(Date.now() / 1000);

									cy.task("stripeWebhookSignature", {
										payload,
										secret: STRIPE_WEBHOOK_SECRET,
										timestampSeconds,
									}).then((signatureHeader) => {
										const send = () =>
											cy.request({
												method: "POST",
												url: `${api}/api/public/payments/stripe/${companyId}/webhook`,
												headers: {
													"Content-Type": "application/json",
													"Stripe-Signature": signatureHeader as string,
												},
												body: payload,
											});

										// FIRST delivery — the mocked provider "reports success". Asserted through the
										// API, never the DOM: the invoice's own settlement is the source of truth.
										send().then((res) => {
											expect(res.status, "webhook accepted").to.eq(201);
											expect(res.body).to.deep.equal({ received: true, outcome: "processed" });
										});
										cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
											.its("body.settlement")
											.then((settlement: { settled: boolean; paidMinor: number }) => {
												expect(settlement.settled, "the invoice is now fully settled").to.eq(true);
												expect(settlement.paidMinor, "exactly the invoice's own gross, in minor units").to.eq(
													12000,
												);
											});

										// THE REPLAY PROOF — a SECOND delivery of the exact same event (Stripe's own
										// documented at-least-once contract) must credit NOTHING more.
										send().then((res) => {
											expect(res.status, "replay still accepted (200-shaped), never an error").to.eq(
												201,
											);
											expect(res.body.outcome, "recognized as already-processed, not reprocessed").to.eq(
												"unknown_session",
											);
										});
										cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
											.its("body.settlement.paidMinor")
											.should("eq", 12000);
										cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
											.its("body.payments")
											.should("have.length", 1);
									});
								});
						});
					});
				});
			});
	});

	it("refuses a webhook signed with the WRONG secret — never touches the balance", () => {
		configureEmailTransport();
		connectStripe();

		createClient("Attacker Target SARL", "target@example.com").then((clientId: string) => {
			createSentInvoice(clientId).then((invoiceId: string) => {
				cy.request({ url: `${api}/api/company/info` })
					.its("body.id")
					.then((companyId: string) => {
						inviteToPortal(clientId).then((token: string) => {
							cy.visit(`/portal/${token}`);
							cy.get(`[data-cy="portal-document-row-${invoiceId}"]`, { timeout: 15000 }).should(
								"be.visible",
							);
							cy.window().then((win) => {
								cy.stub(win, "open").as("windowOpenForged");
							});
							cy.intercept("POST", "**/api/portal/documents/invoice/*/checkout-session").as(
								"createSessionForged",
							);
							cy.get(`[data-cy="portal-pay-button-${invoiceId}"]`).click();
							cy.wait("@createSessionForged");

							cy.request({ url: `${api}/api/payments/${invoiceId}/sessions` })
								.its("body.0.providerSessionId")
								.then((providerSessionId: string) => {
									const payload = JSON.stringify({
										id: "evt_e2e_forged",
										type: "checkout.session.completed",
										data: { object: { id: providerSessionId, payment_status: "paid" } },
									});
									const timestampSeconds = Math.floor(Date.now() / 1000);

									// Signed with a DIFFERENT secret than the one configured for this company.
									cy.task("stripeWebhookSignature", {
										payload,
										secret: "whsec_not_this_companys_secret",
										timestampSeconds,
									}).then((forgedSignature) => {
										cy.request({
											method: "POST",
											url: `${api}/api/public/payments/stripe/${companyId}/webhook`,
											headers: {
												"Content-Type": "application/json",
												"Stripe-Signature": forgedSignature as string,
											},
											body: payload,
											failOnStatusCode: false,
										}).then((res) => {
											expect(res.status, "refused — never accepted").to.eq(400);
										});
									});

									cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
										.its("body.settlement")
										.then((settlement: { settled: boolean; paidMinor: number }) => {
											expect(settlement.settled, "still unpaid — a forged webhook changed nothing").to.eq(
												false,
											);
											expect(settlement.paidMinor).to.eq(0);
										});
								});
						});
					});
			});
		});
	});
});
