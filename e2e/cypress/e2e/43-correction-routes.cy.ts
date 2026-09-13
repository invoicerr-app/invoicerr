export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * `GET /api/documents/:id/correction-routes?typeId=invoice`
 * (`backend/src/modules/documents/correction-routes/`). API LEVEL first, like the rest of the repo's
 * own "assertions via the API" discipline (cy.request for both the action AND the verification) —
 * the screen (the "Correct" button, the routes dialog) comes in the "Correct" describe further
 * down, NOT here.
 *
 * The default company (`cy.resetAndSeed()`) is already a FRENCH company (SIRET/VAT on file) —
 * exactly the canonical country whose internal credit note is `required` in
 * `correction-routes/data/fr.json` (see that file's own legal provenance). The first two describes
 * below therefore NEVER switch the company's country: the country-by-country pinned content
 * (the FR/PL contrast, the per-country sample) is already proven in jest
 * (`correction-routes/data/all.spec.ts`, `correction-routes/cancel-policy.spec.ts`) against the
 * REAL file — no need to redo it here at the cost of a browser round trip per country. Those specs
 * prove the WIRING end to end: the four gates composed by
 * `documents.service.ts#getCorrectionRoutes`, against the real server.
 *
 * The "Cancellation" describe, at the very bottom, IS the exception: it switches the
 * seller country to PL once — see its own header for why (at the time it was written, no
 * country-policy/ file existed for PL, which made it impossible to issue an invoice UNDER PL
 * directly; `country-policy/data/pl.json` has since been added, PROVEN by
 * `44-country-policy.cy.ts`'s own "THE UNBLOCKING" — keeping the after-the-fact switch here stays a
 * choice, not a necessity: it isolates the CANCEL gate, unrelated to country-policy/, without having
 * to duplicate the full PL issuance that 44 already covers). Last describe of the last
 * numbered file in the suite: the switch does not contaminate any other spec.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClient(name: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				address: "1 Rue Quelconque",
				postalCode: "75002",
				city: "Paris",
				country: "France",
				currency: "EUR",
				isActive: true,
			},
		})
		.then((res) => {
			expect(res.status, "client créé par API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "le client créé a un identifiant").to.be.a("string");
			return id;
		});
}

/** `issueDate`/`dueDate` are overridable — the "issued" test below needs a date BEFORE 2026-09-01
 *  (the FR seller-country PDP mandate, sourced 2026-08-27: "FR requires
 *  invoices issued on or after 2026-09-01 to go through the \"pdp\" channel") so a plain "email"
 *  transport (Mailpit, no PDP credentials configured anywhere in this suite) can actually reach
 *  the SYNCHRONOUS "sending" phase this spec needs — see `sendInvoice`'s own header. This mandate
 *  is UNRELATED to correction routes themselves; only old enough to predate it. */
function invoiceData(
	clientId: string,
	dates: { issueDate: string; dueDate: string } = {
		issueDate: "2026-09-15",
		dueDate: "2026-10-15",
	},
) {
	return {
		client: clientId,
		issueDate: dates.issueDate,
		dueDate: dates.dueDate,
		currency: "EUR",
		lines: [
			{
				description: "Conseil",
				quantity: 1,
				unit: "day",
				unitPrice: 1000,
				vatRate: "20",
			},
		],
	};
}

/** Same convention as `40-b2g-routing.cy.ts`'s own `setInvoiceTransport` — "email" (Mailpit) is
 *  enough to reach `sending`: this spec only needs the document NUMBERED and past "draft", never a
 *  genuinely delivered invoice (that proof belongs to 28-document-async-send.cy.ts). */
function setInvoiceTransport(transportId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: transportId },
		})
		.then((res) => {
			expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
		});
}

function createInvoiceDraft(
	clientId: string,
	dates?: { issueDate: string; dueDate: string },
) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: { data: invoiceData(clientId, dates) },
			failOnStatusCode: false,
		})
		.then((saved) => {
			expect(saved.status, "brouillon de facture créé").to.be.oneOf([
				200, 201,
			]);
			const invoiceId = saved.body?.document?.id as string;
			expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");
			return invoiceId;
		});
}

/** Moves a DRAFT invoice to `sending` (numbered) — the first phase of "send" is
 *  SYNCHRONOUS (see `actions/async-send.ts`'s own header: "persists 'sending' ... before ...
 *  returns"): the status is already no longer "draft" by the time THIS call returns, whatever the
 *  fate of the delivery itself afterwards (out of scope for this spec — see 28's own suite for that).
 *  `data` must be sent back together with `documentId` — the same convention as 21's own "send"
 *  (`runAction` always revalidates `data` against the descriptor, never an implicit re-read from
 *  the database).
 */
function sendInvoice(
	invoiceId: string,
	clientId: string,
	dates?: { issueDate: string; dueDate: string },
) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/send`,
			body: { documentId: invoiceId, data: invoiceData(clientId, dates) },
			failOnStatusCode: false,
		})
		.then((res) => {
			expect(
				res.status,
				`phase 1 de l'envoi (synchrone) : ${JSON.stringify(res.body)}`,
			).to.be.oneOf([200, 201]);
			expect(
				res.body?.document?.status,
				'la facture est partie ("sending")',
			).to.eq("sending");
		});
}

describe("Correction routes — GET /api/documents/:id/correction-routes", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('FR company (the default company) on a DRAFT invoice — 409, "a correction corrects an ISSUED document"', () => {
		createClient("Client Draft SARL").then((clientId) => {
			createInvoiceDraft(clientId).then((invoiceId) => {
				cy.request({
					url: `${api}/api/documents/${invoiceId}/correction-routes?typeId=invoice`,
					failOnStatusCode: false,
				}).then((res) => {
					expect(res.status, "409 sur un brouillon — rien n'est émis").to.eq(
						409,
					);
					expect(JSON.stringify(res.body)).to.match(/draft/);
				});
			});
		});
	});

	it("FR company (the default company) on an ISSUED invoice — the internal credit note (INTERNAL_CREDIT_NOTE) is `required` AND `implemented: true`; every other route honestly stays unimplemented; the seller×buyer composition limitation is always present", () => {
		// "email" (Mailpit) is enough to reach "sending" — see `invoiceData`'s own header on the
		// chosen date (before the French PDP mandate of 2026-09-01, without which the preflight
		// blocks BEFORE even attempting a send, whatever transport is chosen here).
		setInvoiceTransport("email");
		const preMandateDates = { issueDate: "2026-08-15", dueDate: "2026-09-15" };

		createClient("Client Émis SARL").then((clientId) => {
			createInvoiceDraft(clientId, preMandateDates).then((invoiceId) => {
				sendInvoice(invoiceId, clientId, preMandateDates).then(() => {
					cy.request({
						url: `${api}/api/documents/${invoiceId}/correction-routes?typeId=invoice`,
					}).then((res) => {
						expect(res.status).to.eq(200);
						expect(res.body.countryCode).to.eq("FR");

						const routes = res.body.routes as Array<{
							routeId: string;
							status: string;
							label: string;
							implemented: boolean;
						}>;
						expect(
							routes.length,
							"les onze voies canoniques sont rendues",
						).to.eq(11);

						const internalCreditNote = routes.find(
							(r) => r.routeId === "INTERNAL_CREDIT_NOTE",
						);
						expect(
							internalCreditNote,
							"INTERNAL_CREDIT_NOTE est présente",
						).to.exist;
						expect(
							internalCreditNote!.status,
							"l'avoir interne français est IMPOSÉ",
						).to.eq("required");
						expect(
							internalCreditNote!.implemented,
							"c'est la SEULE voie réellement branchée aujourd'hui",
						).to.eq(true);
						expect(internalCreditNote!.label).to.contain(
							"annulation comptable",
						);

						// CANCEL_AND_REPLACE is the SECOND route that is genuinely
						// wired, but ONLY for the countries that actually ground it locally (FR is one
						// of them — see correction-routes/cancel-policy.ts on the backend side): the
						// "implemented" mapping still never follows the legal status ALONE (PL/MX also
						// declare CANCEL_AND_REPLACE as "required" but are NOT wired).
						const cancelAndReplace = routes.find(
							(r) => r.routeId === "CANCEL_AND_REPLACE",
						);
						expect(cancelAndReplace, "CANCEL_AND_REPLACE est présente").to
							.exist;
						expect(
							cancelAndReplace!.implemented,
							"FR fonde une annulation locale",
						).to.eq(true);

						// Every OTHER route honestly stays unimplemented, whatever its status
						// (required/allowed/forbidden/unverified) — the "implemented" mapping NEVER
						// follows the legal status alone.
						for (const route of routes) {
							if (
								route.routeId !== "INTERNAL_CREDIT_NOTE" &&
								route.routeId !== "CANCEL_AND_REPLACE"
							) {
								expect(
									route.implemented,
									`${route.routeId} n'est pas branché`,
								).to.eq(false);
							}
						}

						// The limitation (the unwritten seller×buyer composition) is always
						// recorded, never left silent.
						expect(res.body.limitation).to.match(/seller/i);
						expect(res.body.limitation).to.match(/buyer/i);
					});
				});
			});
		});
	});

	it('a typeId other than "invoice" — a named 501, never a silent default', () => {
		createClient("Client Devis SARL").then((clientId) => {
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/save-draft`,
				body: {
					data: {
						client: clientId,
						issueDate: "2026-09-15",
						currency: "EUR",
						lines: [
							{ description: "Conseil", quantity: 1, unitPrice: 1000 },
						],
					},
				},
				failOnStatusCode: false,
			}).then((saved) => {
				expect(saved.status).to.be.oneOf([200, 201]);
				const quoteId = saved.body?.document?.id as string;
				cy.request({
					url: `${api}/api/documents/${quoteId}/correction-routes?typeId=quote`,
					failOnStatusCode: false,
				}).then((res) => {
					expect(
						res.status,
						'501 — seul typeId="invoice" est couvert par ce mécanisme aujourd\'hui',
					).to.eq(501);
					expect(JSON.stringify(res.body)).to.match(/invoice/);
				});
			});
		});
	});
});

/**
 * THE SCREEN: the "Correct" button (document-list.tsx's own per-row custom
 * slot, custom/invoice-correction-routes-button.tsx), the routes dialog, and the REAL mechanism
 * for the one wired route (INTERNAL_CREDIT_NOTE) — the PRE-LINKED credit note creation. The same
 * discipline as 25-document-settlement.cy.ts's own `lockedFromReference` test: the fixture (client,
 * issued invoice) is prepared via API — nothing new to prove with a click for THAT — but everything
 * the screen adds (opening the dialog, reading the imposed route, clicking, landing on the already
 * pre-filled credit-note screen, saving) goes through a REAL click, and the proof that matters is
 * read back via the API.
 */
describe("Correct — the screen, browser level", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("FR company on an ISSUED invoice: the imposed route (internal credit note) carries its legal basis and clicking it leads to the REAL PRE-LINKED credit-note screen (reference filled in, currency locked) — saving creates the credit note linked to the invoice", () => {
		setInvoiceTransport("email");
		const preMandateDates = { issueDate: "2026-08-10", dueDate: "2026-09-10" };
		const clientName = "Client Corriger SARL";

		createClient(clientName).then((clientId) => {
			createInvoiceDraft(clientId, preMandateDates).then((invoiceId) => {
				sendInvoice(invoiceId, clientId, preMandateDates).then(() => {
					cy.visit("/documents/invoice");

					cy.get(`[data-cy="document-correction-button-${invoiceId}"]`, {
						timeout: 15000,
					}).click({ force: true });
					cy.get('[data-cy="document-correction-dialog"]', {
						timeout: 5000,
					}).should("be.visible");

					// The imposed route: status AND legal basis — the API's own WORDS (the excerpt
					// from the DGFiP/AIFE specification file), never a summary rewritten on the frontend.
					cy.get(
						'[data-cy="document-correction-route-INTERNAL_CREDIT_NOTE-status"]',
					).should("contain.text", "Required by law");
					cy.get(
						'[data-cy="document-correction-route-INTERNAL_CREDIT_NOTE-label"]',
					).should("contain.text", "annulation comptable");

					cy.get(
						'[data-cy="document-correction-route-INTERNAL_CREDIT_NOTE-button"]',
					)
						.should("not.be.disabled")
						.click();

					// THE REAL mechanism, PRE-LINKED — never a stub: navigation to the credit-note
					// screen, the creation dialog already opens, the invoice reference is already
					// resolved (the backend label combines client + issue date — never an empty field)
					// and `lockedFromReference` already locks the currency, with no manual search at all.
					cy.location("pathname", { timeout: 10000 }).should(
						"eq",
						"/documents/credit-note",
					);
					cy.get('[data-cy="document-create-dialog"]', { timeout: 10000 }).should(
						"be.visible",
					);
					cy.get('[data-cy="document-field-invoice-input"] button', {
						timeout: 10000,
					}).should("contain.text", clientName);
					cy.get('[data-cy="document-field-currency-input"] button', {
						timeout: 10000,
					})
						.should("be.disabled")
						.and("contain.text", "EUR");

					// What the descriptor still requires: the credit note's own issue date and the
					// corrected line (taken from the linked invoice — the same pattern as 25's own
					// `lockedFromReference` test).
					cy.get('[data-cy="document-field-issueDate-input"]').click();
					const today = new Date().toLocaleDateString();
					cy.get(`[data-day="${today}"]`).click();

					cy.get(
						'[data-cy^="document-field-correctedLines-row-"][data-cy$="-checkbox"]',
						{ timeout: 10000 },
					)
						.first()
						.check({ force: true });

					cy.intercept(
						"POST",
						`${api}/api/documents/types/credit-note/actions/save-draft`,
					).as("saveCreditNoteDraft");
					cy.get('[data-cy="document-action-save-draft"]')
						.scrollIntoView()
						.click();
					cy.wait("@saveCreditNoteDraft").then((interception) => {
						expect(
							interception.response?.statusCode,
							"l'avoir se crée sans le blocage de devise",
						).to.be.oneOf([200, 201]);
						const creditNoteId = interception.response?.body?.document
							?.id as string;
						expect(creditNoteId, "l'avoir créé a un identifiant").to.be.a(
							"string",
						);

						// The proof that matters, read back via the API: the credit note exists and is
						// LINKED to the corrected invoice — never just the screen as proof.
						cy.request({
							url: `${api}/api/documents/${creditNoteId}?typeId=credit-note`,
						})
							.its("body")
							.then((doc) => {
								expect(
									doc.data?.invoice,
									"l'avoir est pré-lié à LA bonne facture",
								).to.eq(invoiceId);
								expect(
									doc.data?.currency,
									"la devise verrouillée est bien celle de la facture",
								).to.eq("EUR");
							});
					});
				});
			});
		});
	});

	it("a route declared by French law but not implemented here (CREDIT_NOTE): the honest state on screen, never a stub pretending otherwise", () => {
		setInvoiceTransport("email");
		const preMandateDates = { issueDate: "2026-08-11", dueDate: "2026-09-11" };

		createClient("Client Non Implémenté SARL").then((clientId) => {
			createInvoiceDraft(clientId, preMandateDates).then((invoiceId) => {
				sendInvoice(invoiceId, clientId, preMandateDates).then(() => {
					cy.visit("/documents/invoice");

					cy.get(`[data-cy="document-correction-button-${invoiceId}"]`, {
						timeout: 15000,
					}).click({ force: true });
					cy.get('[data-cy="document-correction-dialog"]', {
						timeout: 5000,
					}).should("be.visible");

					// CREDIT_NOTE is "allowed" in France (the YAML) but is NOT one of the wired
					// routes (only INTERNAL_CREDIT_NOTE is) — the button stays clickable (the
					// law permits it), but the click must never reach a credit-note screen.
					cy.get('[data-cy="document-correction-route-CREDIT_NOTE-button"]', {
						timeout: 5000,
					})
						.should("not.be.disabled")
						.click();

					cy.get('[data-cy="document-correction-not-implemented"]', {
						timeout: 5000,
					})
						.should("be.visible")
						.and("contain.text", "Credit note")
						.and("contain.text", "FR");

					cy.get('[data-cy="document-create-dialog"]').should("not.exist");
				});
			});
		});
	});
});

/**
 * LOCAL cancellation: the entry lives INSIDE the "Correct" dialog (the
 * CANCEL_AND_REPLACE row), never a second generic button next to the "Correct" button. A country
 * THAT GROUNDS IT (FR — see correction-routes/cancel-policy.ts on the backend side): choosing the
 * route opens an irreversibility confirmation, confirming REALLY cancels the invoice — verified via
 * API (status AND number never reused). A country that does NOT GROUND IT (PL — CANCEL_AND_REPLACE
 * is `required` there but its own mechanism is only a corrective invoice, never a cancellation): the
 * SAME route honestly stays unimplemented on screen (the 501 panel), and the API refuses a direct
 * POST with a named 403.
 */
describe("Cancellation — a country that grounds it, a country that doesn't", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("FR company (grounds it): CANCEL_AND_REPLACE → irreversibility confirmation → real cancellation; badge, status AND number (never reused) verified via API", () => {
		setInvoiceTransport("email");
		const preMandateDates = { issueDate: "2026-08-12", dueDate: "2026-09-12" };

		createClient("Client Annulation FR SARL").then((clientId) => {
			createInvoiceDraft(clientId, preMandateDates).then((invoiceId) => {
				sendInvoice(invoiceId, clientId, preMandateDates).then(() => {
					cy.request({
						url: `${api}/api/documents/${invoiceId}?typeId=invoice`,
					})
						.its("body")
						.then((before) => {
							const numberBefore = before.displayNumber as string;
							expect(numberBefore, "la facture a bien un numéro avant annulation").to.be.a(
								"string",
							);

							cy.visit("/documents/invoice");

							cy.get(`[data-cy="document-correction-button-${invoiceId}"]`, {
								timeout: 15000,
							}).click({ force: true });
							cy.get('[data-cy="document-correction-dialog"]', {
								timeout: 5000,
							}).should("be.visible");

							cy.get(
								'[data-cy="document-correction-route-CANCEL_AND_REPLACE-status"]',
							).should("contain.text", "Allowed");

							cy.get(
								'[data-cy="document-correction-route-CANCEL_AND_REPLACE-button"]',
							)
								.should("not.be.disabled")
								.click();

							// The irreversibility confirmation — never a direct click that cancels.
							cy.get('[data-cy="document-correction-confirm-cancel"]', {
								timeout: 5000,
							})
								.should("be.visible")
								.and("contain.text", "cannot be undone");

							cy.get(
								'[data-cy="document-correction-confirm-cancel-confirm"]',
							).click();

							// The dialog closes on success; the "Cancelled" badge appears on THE
							// correct row of the list (never an ambiguous data-cy shared between rows).
							cy.get('[data-cy="document-correction-dialog"]').should(
								"not.exist",
							);
							cy.get(`[data-cy="document-list-row-${invoiceId}"]`, {
								timeout: 10000,
							})
								.find('[data-cy="document-status-badge"]')
								.should("contain.text", "Cancelled");

							// The proof that matters, read back via the API: status AND number never reused.
							cy.request({
								url: `${api}/api/documents/${invoiceId}?typeId=invoice`,
							})
								.its("body")
								.then((after) => {
									expect(after.status, "la facture est bien annulée").to.eq(
										"cancelled",
									);
									expect(
										after.displayNumber,
										"le numéro n'est JAMAIS réutilisé ni renuméroté",
									).to.eq(numberBefore);
								});
						});
				});
			});
		});
	});

	it("PL company (doesn't ground it): the SAME route (CANCEL_AND_REPLACE) honestly stays unimplemented — never a click that cancels; the API refuses a direct POST with a named 403", () => {
		setInvoiceTransport("email");
		const preMandateDates = { issueDate: "2026-08-13", dueDate: "2026-09-13" };

		createClient("Client Annulation PL SARL").then((clientId) => {
			createInvoiceDraft(clientId, preMandateDates).then((invoiceId) => {
				sendInvoice(invoiceId, clientId, preMandateDates).then(() => {
					// Switches the SELLER country after issuance — this same invoice, read back through
					// the lens of a country that does NOT ground local cancellation. PL has since
					// received a real country-policy/ file (data/pl.json, where save-draft/send are
					// `allowed: true` — issuing an invoice UNDER PL directly is therefore possible
					// today, see 44-country-policy.cy.ts's own "THE UNBLOCKING"); this spec nonetheless
					// keeps the after-the-fact switch as a CHOICE, not a necessity — the gate tested
					// here is "cancel" (cancel-policy.ts), UNRELATED to country-policy/ (see that
					// file's own header), so reading back an invoice already issued under FR through
					// the PL lens isolates exactly this gate without having to duplicate the full PL
					// issuance that 44 already covers.
					//
					// The switch falls WHILE the asynchronous delivery is in flight (phase 2, the BullMQ
					// queue — see sendInvoice's own header: phase 1 has already gone through, "sending"):
					// the exact fate of that delivery (sent or send_failed) is therefore deliberately
					// IGNORED by this whole test — all that matters is that the invoice is NEVER
					// "cancelled", never its exact delivery status (neither "Sent" nor a wait on it).
					cy.request({
						method: "POST",
						url: `${api}/api/company/info`,
						body: { name: "Acme Corp", country: "Poland", countryCode: "PL" },
					}).then((res) => {
						expect(res.status, "pays vendeur basculé sur PL").to.be.oneOf([
							200, 201,
						]);
					});

					cy.visit("/documents/invoice");

					// A generous timeout (the pattern from 28-document-async-send.cy.ts): the "Correct"
					// button only appears once the invoice is "sent"/"send_failed" (isIssued, never
					// "sending" — invoice-correction-routes-button.tsx), and delivery is still in
					// progress at the moment of this visit.
					cy.get(`[data-cy="document-correction-button-${invoiceId}"]`, {
						timeout: 30000,
					}).click({ force: true });
					cy.get('[data-cy="document-correction-dialog"]', {
						timeout: 5000,
					}).should("be.visible");

					// PL declares CANCEL_AND_REPLACE `required` (hence choosable), but NO
					// real mechanism grounds it (executed as a corrective invoice, never a
					// cancellation — see data/pl.json).
					cy.get(
						'[data-cy="document-correction-route-CANCEL_AND_REPLACE-status"]',
					).should("contain.text", "Required by law");

					cy.get(
						'[data-cy="document-correction-route-CANCEL_AND_REPLACE-button"]',
					)
						.should("not.be.disabled")
						.click();

					// Never a cancellation confirmation: the honest, named 501 panel.
					cy.get('[data-cy="document-correction-not-implemented"]', {
						timeout: 5000,
					})
						.should("be.visible")
						.and("contain.text", "Cancel and replace")
						.and("contain.text", "PL");
					cy.get('[data-cy="document-correction-confirm-cancel"]').should(
						"not.exist",
					);

					// The API refuses a direct POST, by name — never plain silence for anyone
					// bypassing the screen.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/cancel`,
						body: {
							documentId: invoiceId,
							data: invoiceData(clientId, preMandateDates),
						},
						failOnStatusCode: false,
					}).then((res) => {
						expect(res.status, "403 nommé, jamais un silence").to.eq(403);
						expect(JSON.stringify(res.body)).to.match(/PL/);
					});

					// The invoice is NEVER "cancelled" — its exact DELIVERY status (sent or
					// send_failed) is not what this test proves (see the comment above about
					// the country switch falling during the asynchronous phase 2).
					cy.request({
						url: `${api}/api/documents/${invoiceId}?typeId=invoice`,
					})
						.its("body.status")
						.should("be.oneOf", ["sent", "send_failed"]);
				});
			});
		});
	});
});
