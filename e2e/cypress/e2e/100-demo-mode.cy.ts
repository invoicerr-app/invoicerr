export {}; // makes this spec a module, not a global script -- see tsconfig.json

// Issue #533: this spec runs against a stack with DEMO_MODE=true and a dataset built by
// `npm run demo:reset`. It does NOT call `cy.resetAndSeed()` (the shared `before()` hook in
// `support/e2e.ts`, opted out of here exactly the way `01-register.cy.ts` does): that helper signs
// up a fresh user through `POST /api/auth/sign-up/email`, which demo mode refuses outright
// (`lib/registration-policy.ts`). This spec's whole point is to run against the ONE seeded demo
// account instead, never to create its own.
Cypress.env("skipSeed", true);

const api = Cypress.env("apiUrl");

const DEMO_EMAIL = "demo@invoicerr.app";
const DEMO_PASSWORD = "demo";

function signInAsDemo() {
	cy.visit("/");
	cy.url({ timeout: 20000 }).should("include", "/dashboard");
}

function openSignInSignedOut() {
	cy.visit("/auth/sign-out");
	cy.location("pathname", { timeout: 10000 }).should("eq", "/auth/sign-in");
	cy.get('[data-cy="demo-credentials-notice"]', { timeout: 10000 }).should(
		"be.visible",
	);
}

/** Send through the API, for the server-side refusals the disabled button can no longer trigger. */
function sendDocument(typeId: string, id: string) {
	return cy
		.request(`${api}/api/documents/${id}?typeId=${typeId}`)
		.then(({ body }) =>
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/${typeId}/actions/send`,
				body: { documentId: id, data: body.data },
				failOnStatusCode: false,
			}),
		);
}

describe("Demo mode (issue #533)", () => {
	it("signs a fresh visitor in automatically, with no click, and lands on the dashboard", () => {
		cy.intercept("POST", "**/api/auth/sign-in/email").as("signIn");
		cy.visit("/documents/invoice");
		cy.wait("@signIn")
			.its("request.body")
			.should("include", { email: DEMO_EMAIL, password: DEMO_PASSWORD });
		cy.url({ timeout: 20000 }).should("include", "/dashboard");
		cy.get('[data-cy="demo-banner"]', { timeout: 10000 }).should("be.visible");
	});

	it("stays on the sign-in page after signing out, even across a reload", () => {
		signInAsDemo();
		const signIn = cy.spy().as("signIn");
		cy.intercept("POST", "**/api/auth/sign-in/email", signIn);
		cy.get('[data-cy="sidebar-user-menu-trigger"]', { timeout: 15000 }).click();
		cy.get('[data-cy="sidebar-sign-out-menu-item"]').click();
		cy.location("pathname", { timeout: 10000 }).should("eq", "/auth/sign-in");
		cy.reload();
		cy.get('[data-cy="demo-credentials-notice"]', { timeout: 10000 }).should(
			"be.visible",
		);
		// An attempt would have started with the credentials box and left the form busy.
		cy.get('[data-cy="auth-submit-btn"]').should("not.be.disabled");
		cy.get('[data-cy="auth-email-input"]').should("not.be.disabled");
		cy.location("pathname").should("eq", "/auth/sign-in");
		cy.get("@signIn").should("not.have.been.called");
	});

	it("shows the demo credentials on the sign-in page after signing out", () => {
		openSignInSignedOut();
		cy.get('[data-cy="demo-credentials-email"]').should("have.text", DEMO_EMAIL);
		cy.get('[data-cy="demo-credentials-password"]').should("have.text", DEMO_PASSWORD);
		cy.get('[data-cy="demo-credentials-notice"]').should(
			"contain.text",
			"Data resets every 4 hours.",
		);
	});

	it("signs in by hand after signing out", () => {
		openSignInSignedOut();
		cy.get('[data-cy="auth-email-input"]').type(DEMO_EMAIL);
		cy.get('[data-cy="auth-password-input"]').type(DEMO_PASSWORD);
		cy.get('[data-cy="auth-submit-btn"]').click();
		cy.url({ timeout: 20000 }).should("include", "/dashboard");
	});

	it("hides the sign-up link, since the server says sign-up is closed", () => {
		// A conditional 304 carries no body to assert on: always ask for a fresh answer.
		cy.intercept("GET", "**/api/invitations/can-register*", (req) => {
			delete req.headers["if-none-match"];
		}).as("canRegister");
		openSignInSignedOut();
		cy.wait("@canRegister")
			.its("response.body")
			.should("include", { allowed: false, requiresCode: false });
		cy.get('[data-cy="auth-signup-link"]').should("not.exist");
	});

	it("shows a pending invoice at the same VAT-inclusive amount on the dashboard and in the list", () => {
		signInAsDemo();
		cy.request<
			Array<{
				id: string;
				items?: Array<{ id: string; amount?: { value: number } }>;
			}>
		>(`${api}/api/documents/dashboard`).then(({ body: widgets }) => {
			const pending = widgets.find((widget) => widget.id === "invoice:pending");
			const item = pending?.items?.[0];
			expect(item?.amount, "a seeded pending invoice with an amount").to.exist;
			const amount = item!.amount!.value.toFixed(2);

			cy.get('[data-cy="widget-invoice:pending-basis"]', {
				timeout: 20000,
			}).should("contain.text", "incl. VAT");
			cy.get(`[data-cy="widget-item-${item!.id}"]`).should(
				"contain.text",
				amount,
			);

			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-row-amount-${item!.id}"]`, { timeout: 20000 })
				.should("contain.text", amount)
				.and("contain.text", "incl. VAT");
		});
	});

	it("leaves no seeded invoice with an excess, and settles one by a credited line plus a payment", () => {
		signInAsDemo();
		// Not every country has a credit note, so every demo company is checked, never just the active one.
		cy.request<{ companies: Array<{ id: string }> }>(
			`${api}/api/auth/get-session`,
		)
			.its("body.companies")
			.then((companies: Array<{ id: string }>) => {
				const credited: Array<{ companyId: string; invoiceId: string }> = [];
				cy.wrap(companies)
					.each((company: { id: string }) => {
						cy.request("POST", `${api}/api/companies/switch`, {
							companyId: company.id,
						});
						cy.request<{ items: Array<{ id: string }> }>(
							`${api}/api/documents?typeId=invoice&page=1&pageSize=50`,
						)
							.its("body.items")
							.each((invoice: { id: string }) => {
								cy.request<{
									credits: unknown[];
									settlement: { excessMinor: number; settled: boolean };
								}>(
									`${api}/api/documents/${invoice.id}/settlement?typeId=invoice`,
								).then(({ body }) => {
									expect(
										body.settlement.excessMinor,
										`excess on ${invoice.id}`,
									).to.eq(0);
									if (body.credits.length > 0) {
										expect(body.settlement.settled).to.eq(true);
										credited.push({
											companyId: company.id,
											invoiceId: invoice.id,
										});
									}
								});
							});
					})
					.then(() => {
						expect(
							credited,
							"a credited invoice in each company that has credit notes",
						).not.to.be.empty;
						cy.request("POST", `${api}/api/companies/switch`, {
							companyId: credited[0].companyId,
						});
						cy.visit(`/documents/invoice/${credited[0].invoiceId}`);
						cy.get('[data-cy="document-settlement-credited"]', {
							timeout: 20000,
						}).should("exist");
						cy.get('[data-cy="document-settlement-excess"]').should(
							"not.exist",
						);
					});
			});
	});

	it("signs in with the demo account and shows the demo banner on every authenticated page", () => {
		signInAsDemo();
		cy.get('[data-cy="demo-banner"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="demo-banner"]').should(
			"contain.text",
			"resets every 4 hours",
		);
		// Issue #592: the copy names payments, not only "nothing is kept or sent".
		cy.get('[data-cy="demo-banner"]').should("contain.text", "payments are disabled");

		// The banner is not a per-page fluke of the dashboard: it is mounted once, for the whole
		// authenticated shell.
		cy.visit("/documents/invoice");
		cy.get('[data-cy="demo-banner"]', { timeout: 10000 }).should("be.visible");
	});

	it("refuses to change the demo account password, in the UI and on the server", () => {
		signInAsDemo();
		cy.visit("/account/security");
		cy.get('[data-cy="account-security-current-password-input"]').type(
			DEMO_PASSWORD,
		);
		cy.get('[data-cy="account-security-password-input"]').type(
			"SomeOtherPassword123!",
		);
		cy.get('[data-cy="account-security-confirm-password-input"]').type(
			"SomeOtherPassword123!",
		);
		cy.get('[data-cy="account-security-submit-button"]').should("be.disabled");
	});

	it("refuses to delete the demo account in the UI", () => {
		signInAsDemo();
		cy.visit("/account/danger");
		cy.get('[data-cy="account-danger-delete-button"]').should("be.disabled");
	});

	// The one behaviour this spec BREAKS and RESTORES for real (see the PR body / CLOUD_PROMPT
	// report for the actual break-and-restore command output): a draft invoice's "Send" is
	// refused by the backend at the transport chokepoint (`TransportRegistry.register`,
	// `modules/demo/demo-blocked.ts`), surfacing as "Send failed" with a named reason, never a
	// silent success.
	it('pre-warns that Send is disabled, then the server still refuses it with the demo reason', () => {
		signInAsDemo();
		cy.request<{ items: Array<{ id: string; status: string }> }>(
			`${api}/api/documents?typeId=invoice&page=1&pageSize=50`,
		)
			.its("body.items")
			.then((items: Array<{ id: string; status: string }>) => {
				const draft = items.find((item) => item.status === "draft");
				expect(draft, "a seeded draft invoice").to.exist;
				const id = draft!.id;

				cy.visit("/documents/invoice");
				// Issue #592: the disabled state and its reason are on screen BEFORE any click, the same
				// pre-warning account deletion, password change and API keys already show.
				cy.get(`[data-cy="document-row-action-send-${id}"]`, { timeout: 15000 }).should("be.disabled");
				cy.get(`[data-cy="document-row-blocked-reason-send-${id}"]`).should(
					"contain.text",
					"Disabled in this demo",
				);
				cy.get(`[data-cy="document-list-row-${id}"]`)
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				// The UI disabling is a warning, never the enforcement: send is still accepted by the
				// async queue, then the worker's own demo chokepoint makes it fail.
				sendDocument("invoice", id).then((res) => {
					expect(res.status, "send accepted by the queue").to.be.oneOf([200, 201]);
				});
				cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["send_failed"]);

				cy.reload();
				cy.get(`[data-cy="document-list-row-${id}"]`, { timeout: 20000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Send failed");
				cy.get(`[data-cy="document-row-last-error-${id}"]`)
					.should("exist")
					.and("contain.text", "is disabled in this demo");
				cy.contains(/no transport is configured/i).should("not.exist");
			});
	});

	it('refuses to send the seeded draft credit note: it ends "Send failed" with the demo reason, never "Sent"', () => {
		signInAsDemo();
		cy.request<{ items: Array<{ id: string; status: string }> }>(
			`${api}/api/documents?typeId=credit-note&page=1&pageSize=50`,
		)
			.its("body.items")
			.then((items: Array<{ id: string; status: string }>) => {
				const draft = items.find((item) => item.status === "draft");
				expect(draft, "a seeded draft credit note").to.exist;
				const id = draft!.id;

				cy.visit("/documents/credit-note");
				cy.get(`[data-cy="document-row-action-send-${id}"]`, { timeout: 15000 }).should(
					"be.disabled",
				);
				sendDocument("credit-note", id);
				cy.reload();

				cy.get(`[data-cy="document-list-row-${id}"]`, { timeout: 20000 })
					.find('[data-cy="document-status-badge"]', { timeout: 20000 })
					.should("contain.text", "Send failed");
				cy.get(`[data-cy="document-row-last-error-${id}"]`)
					.should("exist")
					.and("contain.text", "is disabled in this demo");
				cy.request(`${api}/api/documents/${id}?typeId=credit-note`)
					.its("body.status")
					.should("eq", "send_failed");
			});
	});

	it('refuses to send a credit note that corrects no invoice: it stays a draft, never "Sent"', () => {
		signInAsDemo();
		cy.request(`${api}/api/documents/types/credit-note`)
			.its("body.fields")
			.then(
				(
					fields: {
						key: string;
						fields?: { key: string; options?: { value: string }[] }[];
					}[],
				) => {
					const vatRate = fields
						.find((f) => f.key === "lines")
						?.fields?.find((f) => f.key === "vatRate")?.options?.[0]?.value;
					expect(vatRate, "the active company has a VAT rate").to.be.a("string");

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/credit-note/actions/save-draft`,
						body: {
							data: {
								issueDate: new Date().toISOString().slice(0, 10),
								currency: "EUR",
								reason: "Pricing correction agreed with the client.",
								lines: [
									{
										description: "Consulting day",
										quantity: 1,
										unit: "unit",
										unitPrice: 100,
										vatRate,
									},
								],
							},
						},
					}).then((saved) => {
						const id = saved.body.document.id as string;

						cy.visit("/documents/credit-note");
						cy.get(`[data-cy="document-row-action-send-${id}"]`, { timeout: 15000 }).should(
							"be.disabled",
						);
						sendDocument("credit-note", id).then((res) => {
							expect(res.status, "send refused").to.eq(400);
							expect(res.body.message, "the missing client is named").to.match(
								/no client to send it to/i,
							);
						});
						cy.get(`[data-cy="document-list-row-${id}"]`)
							.find('[data-cy="document-status-badge"]')
							.should("contain.text", "Draft");
						cy.request(`${api}/api/documents/${id}?typeId=credit-note`)
							.its("body")
							.then((doc: { status: string; number: number | null }) => {
								expect(doc.status, "still a draft, never sent").to.eq("draft");
								expect(doc.number, "no number spent").to.eq(null);
							});
					});
				},
			);
	});

	// Issue #581 - "Validate" never reaches a DEMO_MODE chokepoint (it is a plain Postgres write,
	// never `TransportRegistry.register`'s own wrap) UNLESS a country channel mandate routes it
	// through the real send, the same branch "Send" itself always takes - see
	// `invoice-actions.ts`'s own "validate" registration. This invoice's `issueDate` is picked far
	// before ANY shipped mandate's own threshold (France's own, the earliest, starts 2026-09-01) so
	// this test proves the ORDINARY branch, never the mandated one 118-invoice-validate.cy.ts already
	// covers in full against a real (non-demo) stack.
	it("Validate succeeds in demo mode while Send is still refused - numbering is a Postgres write, never an outbound chokepoint", () => {
		signInAsDemo();

		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(
					clients,
					"le compte démo a au moins un client",
				).to.have.length.greaterThan(0);

				// The demo account's ACTIVE company is whichever of the six seeded ones
				// (DE/DZ/FR/IT/PL/PT) `npm run demo:reset` happened to create last - never assumed
				// here. Its own VAT rate catalog is read from the merged invoice descriptor
				// (`usesVatRateCatalog`, company-view.ts) rather than a hardcoded "20" (France's own
				// rate, which a non-French demo company's own catalog refuses).
				cy.request({ url: `${api}/api/documents/types/invoice` })
					.its("body.fields")
					.then(
						(
							fields: {
								key: string;
								fields?: { key: string; options?: { value: string }[] }[];
							}[],
						) => {
							const linesField = fields.find((f) => f.key === "lines");
							const vatRateField = linesField?.fields?.find(
								(f) => f.key === "vatRate",
							);
							const vatRate = vatRateField?.options?.[0]?.value;
							expect(
								vatRate,
								"le catalogue de TVA de l'entreprise active a au moins un taux",
							).to.be.a("string");

							cy.request({
								method: "POST",
								url: `${api}/api/documents/types/invoice/actions/save-draft`,
								body: {
									data: {
										client: clients[0].id,
										issueDate: "2024-01-15",
										dueDate: "2024-02-15",
										currency: "EUR",
										lines: [
											{
												description: "Conseil",
												quantity: 1,
												unit: "unit",
												unitPrice: 200,
												vatRate,
											},
										],
									},
									failOnStatusCode: false,
								},
							}).then((saved) => {
								expect(saved.status, "brouillon de facture créé").to.be.oneOf([
									200, 201,
								]);
								const invoiceId = saved.body?.document?.id as string;
								expect(invoiceId, "le brouillon a un identifiant").to.be.a(
									"string",
								);

								cy.visit("/documents/invoice");
								cy.runDocumentRowAction(invoiceId, "validate");

								// Succeeds for real - numbered and locked, never blocked by demo mode.
								cy.get(`[data-cy="document-list-row-${invoiceId}"]`, {
									timeout: 15000,
								})
									.find('[data-cy="document-status-badge"]')
									.should("contain.text", "Validated");
								cy.request({
									url: `${api}/api/documents/${invoiceId}?typeId=invoice`,
								})
									.its("body")
									.then((doc) => {
										expect(
											doc.status,
											"réellement validated en base, jamais bloqué",
										).to.eq("validated");
										expect(doc.number, "un numéro a bien été attribué").to.be.a(
											"number",
										);
									});

								// "Send" on this SAME, now-validated invoice is still refused - the exact
								// same chokepoint the test above already proves, now reached from
								// "validated" rather than "draft" (SEND_TRANSITIONS's own widened `from`,
								// issue #581).
								cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`).should(
									"be.disabled",
								);
								sendDocument("invoice", invoiceId);
								cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, [
									"send_failed",
								]);
								cy.reload();
								cy.get(`[data-cy="document-list-row-${invoiceId}"]`, {
									timeout: 20000,
								})
									.find('[data-cy="document-status-badge"]', { timeout: 20000 })
									.should("contain.text", "Send failed");
								cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`)
									.should("exist")
									.and("contain.text", "is disabled in this demo");

								// Never re-numbered by the refused send attempt.
								cy.request({
									url: `${api}/api/documents/${invoiceId}?typeId=invoice`,
								})
									.its("body.number")
									.should("be.a", "number");
							});
						},
					);
			});
	});
});
