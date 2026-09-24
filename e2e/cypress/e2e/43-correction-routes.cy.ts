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

/**
 * Opens one invoice's "Correct" dialog from the list screen, waiting for the list itself rather
 * than for the button alone.
 *
 * The five callers below used to `cy.visit` and then click the button `{ force: true }` as soon as
 * `cy.get` found it. `force` skips Cypress's own actionability wait, so the click lands on whatever
 * node happens to be there at that instant — including one the list is about to replace, because
 * this button renders from the list response AND from the type descriptor, and the row re-renders
 * when either lands (plus again, for the "sending" caller, when SSE flips the status). A click on a
 * node that is then replaced does nothing at all, and the failure surfaces one command later as a
 * dialog that never opened.
 *
 * Waiting for the list request is what makes the rows real before anything is clicked; the click is
 * then an ordinary one, free to retry against the CURRENT DOM the way a user's own would.
 * `timeout` exists for the one caller whose invoice is still mid-send when it visits: there the
 * button genuinely appears later, once the worker has moved the record out of "sending".
 */
function openCorrectionDialog(invoiceId: string, timeout = 15000) {
	cy.intercept({ method: "GET", pathname: "/api/documents", query: { typeId: "invoice" } }).as(
		"invoiceListForCorrection",
	);
	cy.visit("/documents/invoice");
	cy.wait("@invoiceListForCorrection", { timeout: 20000 });
	cy.get(`[data-cy="document-correction-button-${invoiceId}"]`, { timeout }).click();
}

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
			expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
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
						expect(internalCreditNote, "INTERNAL_CREDIT_NOTE est présente").to
							.exist;
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
						lines: [{ description: "Conseil", quantity: 1, unitPrice: 1000 }],
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
					openCorrectionDialog(invoiceId);
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
					cy.get('[data-cy="document-create-dialog"]', {
						timeout: 10000,
					}).should("be.visible");

					// What the descriptor still requires UNCONDITIONALLY: only the credit note's own
					// issue date sits on "Details" now (`invoice` itself is OPTIONAL at the descriptor
					// level: a credit note can now be FREE, with nothing to correct at all). `invoice`
					// moved to the "Lines" step instead of "Options" — document-create-dialog.tsx's own
					// `buildFieldGroups` groups an OPTIONAL field with whatever `rowSelection` field
					// names it as `sourceField` — `correctedLines` has nothing useful to offer before
					// "invoice" resolves. `currency` FOLLOWS `invoice` onto that same step for the
					// identical reason (its own `lockedFromReference` lock only re-applies while both
					// fields are mounted together — `buildFieldGroups`'s own header spells out why).
					// Three `Continue` clicks still stand between here and the Summary step that
					// actually carries the `document-action-save-draft` button.
					cy.pickToday('[data-cy="document-field-issueDate-input"]');
					cy.continueDocumentWizard(); // Details -> Lines

					// "Lines" is where `invoice` AND `currency` both now live — `invoice` still
					// pre-filled and resolved to the client's own label (never a bare id or an empty
					// picker), and `currency` already locked to it (EUR, disabled) since the two are
					// mounted together on this same step.
					cy.get('[data-cy="document-field-invoice-input"] button', {
						timeout: 10000,
					}).should("contain.text", clientName);
					cy.get('[data-cy="document-field-currency-input"] button', {
						timeout: 10000,
					})
						.should("be.disabled")
						.and("contain.text", "EUR");
					cy.get(
						'[data-cy^="document-field-correctedLines-row-"][data-cy$="-checkbox"]',
						{ timeout: 10000 },
					)
						.first()
						.check({ force: true });
					cy.continueDocumentWizard(); // Lines -> Options
					cy.continueDocumentWizard(); // Options -> Recap

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
					openCorrectionDialog(invoiceId);
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
							expect(
								numberBefore,
								"la facture a bien un numéro avant annulation",
							).to.be.a("string");

							openCorrectionDialog(invoiceId);
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

					// A generous timeout (the pattern from 28-document-async-send.cy.ts): the "Correct"
					// button only appears once the invoice is "sent"/"send_failed" (isIssued, never
					// "sending" — invoice-correction-routes-button.tsx), and delivery is still in
					// progress at the moment of this visit. This is the one caller whose row is
					// genuinely re-rendered AFTER the first list response (SSE flips the status), which
					// is exactly why its click must stay an ordinary, retrying one — see
					// `openCorrectionDialog`'s own header on what `{ force: true }` did here.
					openCorrectionDialog(invoiceId, 30000);
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

/**
 * Poland's faktura korygująca (the KOR pattern) — CORRECTIVE_INVOICE, genuinely implemented for a
 * Polish seller only (`correction-routes.ts#isImplemented`, country-aware exactly like
 * CANCEL_AND_REPLACE above). Same country switch as `44-country-policy.cy.ts`'s own "THE UNBLOCKING"
 * (a Polish company FROM ITS OWN CREATION, `country: "Poland"`/`countryCode: "PL"`), and the same
 * "email" transport — `KSEF_AUTH_TOKEN` is absent from this environment, so a REAL KSeF round-trip
 * (and therefore the actual `RodzajFaktury = KOR` XML this correction eventually builds) is NOT
 * provable here; that half is covered by the REAL vendored `schemat_FA3.xsd`, against real fixtures,
 * in `backend/src/modules/documents/formats/national/fa3-provider.spec.ts` and `fa3-kor.spec.ts`.
 * This spec proves what the SCREEN can prove without KSeF: the route is offered and genuinely
 * implemented, choosing it opens the REAL invoice-creation screen pre-linked (never a stub), and
 * Poland's own conditionally-required "Correction reason" field (country-fields/data/pl.json) shows
 * up and is actually required once `correctsInvoiceId` resolves.
 */
describe("Correction routes — Poland's faktura korygująca (the KOR route)", () => {
	before(() => {
		cy.resetAndSeed();

		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: {
				name: "Acme Corp",
				country: "Poland",
				countryCode: "PL",
				invoiceTransportId: "email",
			},
		}).then((res) => {
			expect(
				res.status,
				"pays vendeur réglé sur la Pologne dès la création",
			).to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	function createPolishClient(name: string) {
		return cy
			.request({
				method: "POST",
				url: `${api}/api/clients`,
				body: {
					name,
					contactEmail: "klient.korekta@example.com",
					address: "ul. Przykładowa 1",
					postalCode: "00-001",
					city: "Warszawa",
					country: "Poland",
					countryCode: "PL",
					currency: "EUR",
					isActive: true,
				},
			})
			.then((res) => {
				expect(res.status, "client polonais créé par API").to.be.oneOf([
					200, 201,
				]);
				const id = res.body?.id as string;
				expect(id, "le client créé a un identifiant").to.be.a("string");
				return id;
			});
	}

	function polishInvoiceData(clientId: string) {
		return {
			client: clientId,
			issueDate: "2026-09-03",
			dueDate: "2026-10-03",
			currency: "EUR",
			lines: [
				{
					description: "Usługi doradcze",
					quantity: 1,
					unit: "day",
					unitPrice: 1000,
					vatRate: "23",
				},
			],
		};
	}

	it('CORRECTIVE_INVOICE is required by Polish law AND genuinely implemented — clicking it opens the REAL invoice screen, pre-linked to the corrected invoice, and Poland\'s own conditionally-required "Correction reason" field shows up (required only because this invoice corrects another)', () => {
		createPolishClient("Klient Korekta Sp. z o.o.").then((clientId) => {
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: polishInvoiceData(clientId) },
			}).then((saved) => {
				expect(
					saved.status,
					"brouillon de la facture originale créé",
				).to.be.oneOf([200, 201]);
				const originalId = saved.body?.document?.id as string;
				expect(originalId, "la facture originale a un identifiant").to.be.a(
					"string",
				);

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: originalId, data: polishInvoiceData(clientId) },
				}).then((res) => {
					expect(
						res.status,
						"la facture originale part (email — aucun canal n'est mandaté en Pologne)",
					).to.be.oneOf([200, 201]);
				});

				openCorrectionDialog(originalId, 20000);
				cy.get('[data-cy="document-correction-dialog"]', {
					timeout: 5000,
				}).should("be.visible");

				// The imposed route: status AND its own real mechanism, never the "not implemented" panel.
				cy.get(
					'[data-cy="document-correction-route-CORRECTIVE_INVOICE-status"]',
				).should("contain.text", "Required by law");
				cy.get(
					'[data-cy="document-correction-route-CORRECTIVE_INVOICE-button"]',
				)
					.should("not.be.disabled")
					.click();

				// THE REAL mechanism, pre-linked — never a stub: navigation to the INVOICE screen (never
				// credit-note: Poland has no separate credit-note instrument, correction-routes/data/pl.json's
				// own CREDIT_NOTE citation), a fresh create dialog opens.
				cy.location("pathname", { timeout: 10000 }).should(
					"eq",
					"/documents/invoice",
				);
				cy.get('[data-cy="document-create-dialog"]', { timeout: 10000 }).should(
					"be.visible",
				);

				// Details: client / issueDate / dueDate / currency — every field this descriptor
				// REQUIRES (`correctsInvoiceId` itself is optional at the descriptor level, so it does
				// NOT land here — see document-create-dialog.tsx's own buildFieldGroups).
				//
				// Picking a client is never just "a value changed" on this screen: `use-document-form.ts`
				// watches that field and RE-FETCHES the descriptor with `?clientId=…`, because the
				// per-country field overlays (country-fields/) depend on the buyer. When that response
				// lands, `effectiveDescriptor` is replaced and the whole field list is rebuilt — every
				// field node below is a NEW node. Registered before the pick, waited on right after,
				// so nothing is clicked while that rebuild is still in flight. Traced live on
				// 2026-09-24 with the response held back: the calendar this test opens next was still
				// on screen when the descriptor landed, and the rebuild unmounted it under the test —
				// which is the "`[data-cy=date-picker-today]` … never found" CI hit this on (PR #446).
				cy.intercept({
					method: "GET",
					url: `${api}/api/documents/types/invoice?clientId=*`,
				}).as("clientAwareDescriptor");
				cy.get('[data-cy="document-field-client-input"] button')
					.first()
					.click({ force: true });
				cy.get('[data-cy="document-field-client-input-options"]', {
					timeout: 10000,
				}).should("be.visible");
				cy.contains(
					'[data-cy="document-field-client-input-options"] button',
					"Klient Korekta",
				).click();
				// The picker that just closed still owes the page its own deferred focus restore
				// (support/commands.ts#waitForLayerTeardown) — opening the calendar before it fires is
				// what lets that restore dismiss the calendar on the spot.
				cy.waitForLayerTeardown(
					'[data-cy="document-field-client-input-options"]',
					'[data-cy="document-field-client-input"] button',
				);
				cy.wait("@clientAwareDescriptor", { timeout: 20000 });
				cy.pickToday('[data-cy="document-field-issueDate-input"]');
				cy.pickToday('[data-cy="document-field-dueDate-input"]');
				cy.get('[data-cy="document-field-currency-input"] button')
					.first()
					.click({ force: true });
				cy.get('[data-cy="document-field-currency-input-options"]', {
					timeout: 10000,
				}).should("be.visible");
				cy.get('[data-cy^="document-field-currency-input-option-eur"]')
					.first()
					.click();
				cy.continueDocumentWizard(); // Details -> Lines

				cy.get('[data-cy="document-field-lines-add-row"]').click();
				cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
				cy.get('input[name="lines.0.description"]').type("Korekta ilości", {
					force: true,
				});
				cy.get('input[name="lines.0.quantity"]')
					.clear({ force: true })
					.type("1", { force: true });
				cy.get('input[name="lines.0.unit"]').type("dzień", { force: true });
				cy.get('input[name="lines.0.unitPrice"]')
					.clear({ force: true })
					.type("1000", { force: true });
				// The VAT rate is a real SearchSelect for Poland (vat-rates/data/pl.json ships a
				// catalog) — "23% — Stawka podstawowa" is that catalog's own label for the standard rate.
				//
				// Targeted by its OWN data-cy, not `[data-cy$="-input"] button` + `.last()`: a Polish
				// seller's invoice lines also carry the optional "Supply type" select (country-fields'
				// `supplyType` overlay, appended AFTER `vatRate` by apply-overlay.ts's own `add`), so
				// `.last()` lands on that select instead and its GOODS/SERVICES list has no rate at all.
				// The same trap 20-document-totals.cy.ts already documents for a French seller.
				cy.get(
					'[data-cy="document-field-lines-row-0"] [data-cy="document-field-vatRate-input"] button',
				)
					.first()
					.click({ force: true });
				cy.get('[data-cy="document-field-vatRate-input-options"]', {
					timeout: 10000,
				}).should("be.visible");
				cy.contains(
					'[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]',
					/23\s?%/,
				)
					.first()
					.click();
				cy.continueDocumentWizard(); // Lines -> Options

				// Options: correctsInvoiceId (pre-linked, resolved to a label — never a bare id or an
				// empty picker) and Poland's own correctionReason, REQUIRED (the asterisk this app
				// renders for `field.required`/conditionally-`requiredIfPresent` alike, form.tsx's own
				// FormLabel) ONLY because correctsInvoiceId is now set — an ordinary Polish invoice
				// would never show this field as required.
				cy.get('[data-cy="document-field-correctsInvoiceId-input"] button', {
					timeout: 10000,
				}).should("contain.text", "Klient Korekta");
				cy.get('[data-cy="document-field-correctionReason"]').should(
					"contain.text",
					"*",
				);
				cy.get('[data-cy="document-field-correctionReason-input"]').type(
					"Erreur de quantité sur la ligne 1",
					{ force: true },
				);
				cy.continueDocumentWizard(); // Options -> Recap

				cy.intercept(
					"POST",
					`${api}/api/documents/types/invoice/actions/save-draft`,
				).as("saveCorrectionDraft");
				cy.get('[data-cy="document-action-save-draft"]')
					.scrollIntoView()
					.click();
				cy.wait("@saveCorrectionDraft").then((interception) => {
					expect(
						interception.response?.statusCode,
						"la facture de correction se crée",
					).to.be.oneOf([200, 201]);
					const correctionId = interception.response?.body?.document
						?.id as string;
					expect(
						correctionId,
						"la facture de correction a un identifiant",
					).to.be.a("string");
					expect(correctionId).not.to.eq(originalId);

					// The proof that matters, read back via the API: the correction is genuinely
					// LINKED to the original, and carries the reason typed on screen.
					cy.request({
						url: `${api}/api/documents/${correctionId}?typeId=invoice`,
					})
						.its("body")
						.then((doc) => {
							expect(
								doc.data?.correctsInvoiceId,
								"la nouvelle facture est bien liée à la facture originale",
							).to.eq(originalId);
							expect(
								doc.data?.correctionReason,
								"le motif tapé à l'écran est bien persisté",
							).to.eq("Erreur de quantité sur la ligne 1");
						});
				});
			});
		});
	});

	it('the server-side guard: a correction invoice with correctsInvoiceId set but NO correctionReason is refused, naming the field — never silently accepted, and the block fires as early as "save-draft" (the generic requiredIfPresent gate every action already runs through — documents.service.ts#runAction — not a bespoke send-time check)', () => {
		createPolishClient("Klient Sans Motif Sp. z o.o.").then((clientId) => {
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: polishInvoiceData(clientId) },
			}).then((saved) => {
				const originalId = saved.body?.document?.id as string;
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: originalId, data: polishInvoiceData(clientId) },
				});

				// The correction invoice itself — a scripted client bypassing the screen entirely,
				// correctsInvoiceId set, correctionReason deliberately left OUT.
				const correctionData = {
					...polishInvoiceData(clientId),
					correctsInvoiceId: originalId,
				};
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data: correctionData },
					failOnStatusCode: false,
				}).then((res) => {
					expect(
						res.status,
						"400 nommé dès save-draft — jamais un brouillon accepté avec un motif manquant",
					).to.eq(400);
					expect(JSON.stringify(res.body)).to.match(/[Cc]orrection reason/);
				});

				// Filled in, the SAME request succeeds — proving the gate is genuinely conditional, not
				// an unconditional block on correctsInvoiceId itself.
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: { ...correctionData, correctionReason: "Erreur de quantité" },
					},
				}).then((res) => {
					expect(
						res.status,
						"le même brouillon, motif rempli, se crée normalement",
					).to.be.oneOf([200, 201]);
				});
			});
		});
	});
});
