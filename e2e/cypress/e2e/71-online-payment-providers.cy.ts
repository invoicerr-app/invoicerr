export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Online payment ("paiement en ligne") — Mollie and PayPal, added 2026-09-15 alongside Stripe
 * (Stripe → Mollie → PayPal, product decision). Same UI-driven discipline as `60-online-payment.cy.ts`
 * (actions by clicking through Settings → Payments and the client portal, assertions by reading the
 * record via `cy.request`) and the SAME honesty: this backend runs `NODE_ENV=test`
 * (`documents-core.module.ts#buildPaymentProviderRegistry`), so every provider here is wired to its own
 * network-free Fake client (`FakeMollieClient`/`FakePayPalClient`) — a checkout session/order is REAL
 * end-to-end THROUGH THIS APPLICATION (persisted, correlated, turned into a `DocumentPayment`), but no
 * real Mollie/PayPal account is ever reached. See each provider's own header
 * (`backend/src/modules/documents/payments/providers/{mollie,paypal}/*-provider.ts`) for exactly what
 * that Fake wiring does and does not prove. RUN, green, 5/5 (2026-09-17): `connects Mollie...`,
 * `refuses a webhook naming a payment id this backend never opened...`, `connects PayPal...`,
 * `refuses a webhook missing the PayPal transmission headers...`, `refuses a webhook naming an
 * order id this backend never created...` — against the full e2e stack (`npm run start:test` on both
 * projects), never only typechecked.
 *
 * WHY TWO PROVIDERS NEED DIFFERENT WEBHOOK SHAPES THAN STRIPE'S OWN SPEC:
 *  - Mollie's webhook carries NO signature at all — a bare form-encoded `id=tr_xxx` POST. Verification
 *    is `FakeMollieClient.getPayment` recognizing an id it minted itself (see that class's own header)
 *    — no `cy.task` signing helper needed, unlike Stripe's real HMAC.
 *  - PayPal's webhook needs the five `PAYPAL-TRANSMISSION-*`/`PAYPAL-CERT-URL`/`PAYPAL-AUTH-ALGO`
 *    headers PRESENT (their CONTENT is irrelevant under the Fake client — see
 *    `FakePayPalClient.verifyWebhookSignature`'s own header — but a MISSING one is refused before the
 *    fake verification call ever runs, `paypal-provider.ts`'s own header check). PayPal also needs
 *    TWO webhook deliveries to settle an invoice, never one: `CHECKOUT.ORDER.APPROVED` (triggers the
 *    capture, settles NOTHING by itself) then `PAYMENT.CAPTURE.COMPLETED` (the actual credit) — see
 *    `paypal-provider.ts`'s own header on why capture is triggered from the approval event rather than
 *    a bespoke "return" endpoint.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const MOLLIE_API_KEY = "test_e2e_fake_api_key";
const PAYPAL_CLIENT_ID = "e2e-fake-client-id";
const PAYPAL_CLIENT_SECRET = "e2e-fake-client-secret";
const PAYPAL_WEBHOOK_ID = "WH-E2E-FAKE";

const PAYPAL_TRANSMISSION_HEADERS = {
	"PAYPAL-TRANSMISSION-ID": "e2e-transmission-id",
	"PAYPAL-TRANSMISSION-TIME": "2026-09-15T00:00:00Z",
	"PAYPAL-CERT-URL": "https://api.paypal.com/v1/notifications/certs/e2e",
	"PAYPAL-AUTH-ALGO": "SHA256withRSA",
	"PAYPAL-TRANSMISSION-SIG": "e2e-fake-signature",
};

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

function inviteToPortal(clientId: string): Cypress.Chainable<string> {
	return cy
		.request({ method: "POST", url: `${api}/api/clients/${clientId}/portal-access` })
		.its("body.token") as Cypress.Chainable<string>;
}

/** Opens the checkout session from the portal for whichever provider is currently connected — same
 *  "stub window.open BEFORE the click, spy on the real POST via cy.intercept" discipline
 *  `60-online-payment.cy.ts#connectStripe`'s own describe block already uses. Returns the
 *  `providerSessionId` this app persisted, read back via the STAFF-facing endpoint. */
function openCheckoutAndReadSessionId(invoiceId: string, mockHost: string): Cypress.Chainable<string> {
	cy.window().then((win) => {
		cy.stub(win, "open").as("windowOpen");
	});
	cy.intercept("POST", "**/api/portal/documents/invoice/*/checkout-session").as("createCheckoutSession");

	cy.get(`[data-cy="portal-pay-button-${invoiceId}"]`).click();

	cy.wait("@createCheckoutSession").then((interception) => {
		expect(interception.response?.statusCode, "session opened").to.eq(201);
		const checkoutUrl = interception.response?.body?.checkoutUrl as string;
		expect(checkoutUrl, "a checkout URL came back").to.contain(mockHost);
	});
	cy.get("@windowOpen").should("have.been.called");

	return cy
		.request({ url: `${api}/api/payments/${invoiceId}/sessions` })
		.its("body")
		.then((sessions: { providerSessionId: string; status: string }[]) => {
			expect(sessions, "exactly one session opened").to.have.length(1);
			expect(sessions[0].status, "still pending — no webhook delivered yet").to.eq("PENDING");
			return cy.wrap(sessions[0].providerSessionId);
		});
}

describe("Online payment — Mollie", () => {
	beforeEach(() => {
		cy.login();
	});

	function connectMollie() {
		cy.visit("/settings/payments");
		cy.get('[data-cy="payment-provider-mollie-apikey-input"]').clear().type(MOLLIE_API_KEY);
		cy.get('[data-cy="payment-provider-mollie-connect-button"]').click();
		cy.get('[data-cy="payment-provider-mollie-status"]', { timeout: 15000 }).should("contain", "Connected");

		// Connecting credentials alone never makes a provider the ACTIVE one the portal's Pay link
		// opens (`Company.paymentProviderId` — bring-your-own-account lets more than one provider be
		// connected at once, see `payments.settings.tsx`'s own `ActiveProviderSelector` header) — this
		// selector is the "own small selector on the Payments settings screen" that column's own
		// schema.prisma comment always promised.
		cy.get('[data-cy="payment-active-provider-select"]').click();
		cy.get('[data-cy="payment-active-provider-option-mollie"]').click();
		cy.get('[data-cy="payment-active-provider-select"]').should("contain", "Mollie");
	}

	it("connects Mollie, opens a real (faked) payment from the portal, and a webhook settles it exactly once", () => {
		configureEmailTransport();
		connectMollie();

		createClient("Mollie Payer SARL", "mollie-payer@example.com").then((clientId: string) => {
			createSentInvoice(clientId).then((invoiceId: string) => {
				inviteToPortal(clientId).then((token: string) => {
					cy.visit(`/portal/${token}`);
					cy.url({ timeout: 15000 }).should("include", "/portal");
					cy.get(`[data-cy="portal-document-row-${invoiceId}"]`, { timeout: 15000 }).should("be.visible");

					openCheckoutAndReadSessionId(invoiceId, "mock-mollie.invalid").then((providerSessionId) => {
						cy.request({ url: `${api}/api/company/info` })
							.its("body.id")
							.then((companyId: string) => {
								// Mollie's own webhook shape — form-encoded, no signature (see this file's own header).
								const post = () =>
									cy.request({
										method: "POST",
										url: `${api}/api/public/payments/mollie/${companyId}/webhook`,
										headers: { "Content-Type": "application/x-www-form-urlencoded" },
										body: `id=${providerSessionId}`,
									});

								// FIRST delivery — FakeMollieClient recognizes this id (it minted it) and reports
								// "paid" (that class's own always-succeeds-for-known-ids design).
								post().then((res) => {
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

								// THE REPLAY PROOF — a second identical delivery must credit NOTHING more.
								post().then((res) => {
									expect(res.status, "replay still accepted (200-shaped), never an error").to.eq(201);
									expect(res.body.outcome, "recognized as already-processed").to.eq("unknown_session");
								});
								cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
									.its("body.payments")
									.should("have.length", 1);
							});
					});
				});
			});
		});
	});

	it("refuses a webhook naming a payment id this backend never opened — never touches the balance", () => {
		configureEmailTransport();
		connectMollie();

		createClient("Mollie Attacker Target SARL", "mollie-target@example.com").then((clientId: string) => {
			createSentInvoice(clientId).then((invoiceId: string) => {
				cy.request({ url: `${api}/api/company/info` })
					.its("body.id")
					.then((companyId: string) => {
						cy.request({
							method: "POST",
							url: `${api}/api/public/payments/mollie/${companyId}/webhook`,
							headers: { "Content-Type": "application/x-www-form-urlencoded" },
							body: "id=tr_never_opened_by_this_backend",
							failOnStatusCode: false,
						}).then((res) => {
							expect(res.status, "refused — verification (re-fetch) failed").to.eq(400);
						});

						cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
							.its("body.settlement.paidMinor")
							.should("eq", 0);
					});
			});
		});
	});
});

describe("Online payment — PayPal", () => {
	beforeEach(() => {
		cy.login();
	});

	function connectPayPal() {
		cy.visit("/settings/payments");
		cy.get('[data-cy="payment-provider-paypal-environment-select"]').click();
		cy.get('[data-cy="payment-provider-paypal-environment-option-test"]').click();
		cy.get('[data-cy="payment-provider-paypal-clientid-input"]').clear().type(PAYPAL_CLIENT_ID);
		cy.get('[data-cy="payment-provider-paypal-clientsecret-input"]').clear().type(PAYPAL_CLIENT_SECRET);
		cy.get('[data-cy="payment-provider-paypal-webhookid-input"]').clear().type(PAYPAL_WEBHOOK_ID);
		cy.get('[data-cy="payment-provider-paypal-connect-button"]').click();
		cy.get('[data-cy="payment-provider-paypal-status"]', { timeout: 15000 }).should("contain", "Connected");

		// See `connectMollie`'s own comment — connecting is never the same as SELECTING.
		cy.get('[data-cy="payment-active-provider-select"]').click();
		cy.get('[data-cy="payment-active-provider-option-paypal"]').click();
		cy.get('[data-cy="payment-active-provider-select"]').should("contain", "PayPal");
	}

	it("connects PayPal, opens a real (faked) order, and TWO webhooks (approved, then captured) settle it exactly once", () => {
		configureEmailTransport();
		connectPayPal();

		createClient("PayPal Payer SARL", "paypal-payer@example.com").then((clientId: string) => {
			createSentInvoice(clientId).then((invoiceId: string) => {
				inviteToPortal(clientId).then((token: string) => {
					cy.visit(`/portal/${token}`);
					cy.url({ timeout: 15000 }).should("include", "/portal");
					cy.get(`[data-cy="portal-document-row-${invoiceId}"]`, { timeout: 15000 }).should("be.visible");

					openCheckoutAndReadSessionId(invoiceId, "mock-paypal.invalid").then((orderId) => {
						cy.request({ url: `${api}/api/company/info` })
							.its("body.id")
							.then((companyId: string) => {
								const webhookUrl = `${api}/api/public/payments/paypal/${companyId}/webhook`;

								// FIRST delivery — CHECKOUT.ORDER.APPROVED. Triggers a (faked) capture but settles
								// NOTHING by itself — see this file's own header.
								cy.request({
									method: "POST",
									url: webhookUrl,
									headers: { "Content-Type": "application/json", ...PAYPAL_TRANSMISSION_HEADERS },
									body: JSON.stringify({
										event_type: "CHECKOUT.ORDER.APPROVED",
										resource: { id: orderId },
									}),
								}).then((res) => {
									expect(res.status, "approval webhook accepted").to.eq(201);
									expect(res.body.outcome, "no credit from approval alone").to.eq("ignored");
								});
								cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
									.its("body.settlement.settled")
									.should("eq", false);

								// SECOND delivery — PAYMENT.CAPTURE.COMPLETED, keyed by the ORDER id via
								// `supplementary_data.related_ids.order_id` (never the capture's own id).
								cy.request({
									method: "POST",
									url: webhookUrl,
									headers: { "Content-Type": "application/json", ...PAYPAL_TRANSMISSION_HEADERS },
									body: JSON.stringify({
										event_type: "PAYMENT.CAPTURE.COMPLETED",
										resource: {
											id: "CAPTURE-E2E-1",
											supplementary_data: { related_ids: { order_id: orderId } },
										},
									}),
								}).then((res) => {
									expect(res.status, "capture webhook accepted").to.eq(201);
									expect(res.body).to.deep.equal({ received: true, outcome: "processed" });
								});
								cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
									.its("body.settlement")
									.then((settlement: { settled: boolean; paidMinor: number }) => {
										expect(settlement.settled, "the invoice is now fully settled").to.eq(true);
										expect(settlement.paidMinor).to.eq(12000);
									});

								// THE REPLAY PROOF — a redelivered PAYMENT.CAPTURE.COMPLETED credits nothing more.
								cy.request({
									method: "POST",
									url: webhookUrl,
									headers: { "Content-Type": "application/json", ...PAYPAL_TRANSMISSION_HEADERS },
									body: JSON.stringify({
										event_type: "PAYMENT.CAPTURE.COMPLETED",
										resource: {
											id: "CAPTURE-E2E-1",
											supplementary_data: { related_ids: { order_id: orderId } },
										},
									}),
								}).then((res) => {
									expect(res.body.outcome, "recognized as already-processed").to.eq("unknown_session");
								});
								cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
									.its("body.payments")
									.should("have.length", 1);
							});
					});
				});
			});
		});
	});

	it("refuses a webhook missing the PayPal transmission headers — never touches the balance", () => {
		configureEmailTransport();
		connectPayPal();

		createClient("PayPal Attacker Target SARL", "paypal-target@example.com").then((clientId: string) => {
			createSentInvoice(clientId).then((invoiceId: string) => {
				cy.request({ url: `${api}/api/company/info` })
					.its("body.id")
					.then((companyId: string) => {
						cy.request({
							method: "POST",
							url: `${api}/api/public/payments/paypal/${companyId}/webhook`,
							headers: { "Content-Type": "application/json" }, // no PAYPAL-TRANSMISSION-* headers
							body: JSON.stringify({
								event_type: "PAYMENT.CAPTURE.COMPLETED",
								resource: { id: "CAPTURE-FORGED", supplementary_data: { related_ids: { order_id: "EC-FORGED" } } },
							}),
							failOnStatusCode: false,
						}).then((res) => {
							expect(res.status, "refused — missing transmission headers").to.eq(400);
						});

						cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
							.its("body.settlement.paidMinor")
							.should("eq", 0);
					});
			});
		});
	});

	it("refuses a webhook naming an order id this backend never created — never touches the balance", () => {
		configureEmailTransport();
		connectPayPal();

		createClient("PayPal Forged Order SARL", "paypal-forged@example.com").then((clientId: string) => {
			createSentInvoice(clientId).then((invoiceId: string) => {
				cy.request({ url: `${api}/api/company/info` })
					.its("body.id")
					.then((companyId: string) => {
						cy.request({
							method: "POST",
							url: `${api}/api/public/payments/paypal/${companyId}/webhook`,
							headers: { "Content-Type": "application/json", ...PAYPAL_TRANSMISSION_HEADERS },
							body: JSON.stringify({
								event_type: "PAYMENT.CAPTURE.COMPLETED",
								resource: {
									id: "CAPTURE-FORGED",
									supplementary_data: { related_ids: { order_id: "EC-NEVER-CREATED-BY-THIS-BACKEND" } },
								},
							}),
							failOnStatusCode: false,
						}).then((res) => {
							expect(res.status, "refused — FakePayPalClient never minted this order id").to.eq(400);
						});

						cy.request({ url: `${api}/api/documents/${invoiceId}/settlement?typeId=invoice` })
							.its("body.settlement.paidMinor")
							.should("eq", 0);
					});
			});
		});
	});
});
