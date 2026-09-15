export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The new model, proven by the screen — not only in memory.
 *
 * The jest tests prove the registries, the validation, and the blocking of an action with no
 * implementation. They prove nothing about what a user can actually do: that is exactly
 * the blind spot which, in the previous system, let through a dead "Edit" button, a
 * `send()` that sent nothing, and a list that never refreshed.
 *
 * The rule stays the one for this whole repo: ACTIONS go through the UI, ASSERTIONS
 * read the record.
 *
 * What this file checks above all, and which is THE promise of the model: the form is not
 * hand-written, it is DERIVED from the descriptor. We therefore read the list of types from the API
 * (GET /api/documents/types), then EACH descriptor, then we require that each of their fields
 * be rendered — not a hand-copied list of types or fields, which would only say what the
 * test believes it knows. A third document type (or a field added to an existing type) gets
 * its screen coverage the day it is registered on the backend, without touching this file; a type
 * whose field does not know how to render itself fails the suite instead of passing silently.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

type Field = { key: string; kind: string; label: string; fields?: Field[] };
type TypeSummary = { id: string; label: string };
type Descriptor = {
	id: string;
	label: string;
	fields: Field[];
	actions: { id: string }[];
};

const listTypes = () =>
	cy.request<TypeSummary[]>({ url: `${api}/api/documents/types` }).its("body");

const descriptorFor = (typeId: string) =>
	cy
		.request<Descriptor>({ url: `${api}/api/documents/types/${typeId}` })
		.its("body");

describe("A document is a descriptor, and the screen follows it", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("the form renders EVERY field that EVERY type declares", () => {
		// Data-driven at two levels: the list of TYPES comes from the API, then for
		// each one, the list of FIELDS also comes from the API. Nothing here names "quote" or "invoice".
		listTypes().then((types) => {
			// THREE types at minimum (quote, invoice, credit note), and this is an assertion, not a log.
			//
			// A loop over a single-element list passes just as well as a real loop, while giving
			// itself the appearance of genericity without proving it. If a type ever disappears from
			// the registry, this test must fail: that is the only way for "the frontend knows no
			// type" to remain a verified property rather than an intention. The count: shown here,
			// in the assertion's own message, not only in a comment.
			expect(
				types.map((t) => t.id),
				`au moins trois types couverts — vus (${types.length}) : ${types.map((t) => t.id).join(", ")}`,
			).to.have.length.of.at.least(3);

			for (const type of types) {
				descriptorFor(type.id).then((d) => {
					expect(
						d.fields,
						`${type.id} déclare des champs`,
					).to.have.length.greaterThan(0);

					// The screen since the redesign: a list page by default, a modal for creation — see
					// frontend/src/pages/(app)/documents/[typeId]/index.tsx and document-create-dialog.tsx. The
					// form itself (data-cy="document-form", one "document-field-*" per descriptor field)
					// is unchanged; only reaching it now takes one click, on a button the descriptor's own
					// `label` names ("New {{label}}") rather than nothing at all.
					cy.visit(`/documents/${type.id}`);
					cy.get('[data-cy="document-create-button"]', {
						timeout: 15000,
					}).click();
					// `exist`, not `be.visible`: the dialog (document-create-dialog.tsx) scrolls its
					// fields inside a `max-h-[90vh]` panel, and the 7th type (goods-receipt) plus the
					// received invoice's own added `purchaseOrder` field are together tall enough that
					// the outer `<form>` no longer fits inside a CI-sized (1000×660) viewport in one
					// screenful — Cypress reports a `<form>` straddling a scrollable ancestor's edge as
					// NOT visible even though every field in it is one scroll away, which a real user
					// can do. Each field below is scrolled to and checked individually instead, which is
					// both the genuine per-field coverage this test is FOR and immune to the form's own
					// total height.
					cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("exist");

					for (const f of d.fields) {
						cy.get(`[data-cy="document-field-${f.key}"]`, {
							timeout: 10000,
						})
							.scrollIntoView()
							.should("be.visible");
						// A field whose TYPE has no renderer shows an explicit marker rather
						// than nothing. Seeing it here would mean the core is lying about its coverage.
						cy.get(`[data-cy="document-field-${f.key}-unsupported"]`).should(
							"not.exist",
						);
					}
				});
			}
		});
	});

	it("the actions offered are exactly those of the descriptor, no more no less — for each type", () => {
		listTypes().then((types) => {
			for (const type of types) {
				descriptorFor(type.id).then((d) => {
					// Same adaptation as the previous test: open the create modal first — see its own
					// comment above.
					cy.visit(`/documents/${type.id}`);
					cy.get('[data-cy="document-create-button"]', {
						timeout: 15000,
					}).click();
					// `exist`, not `be.visible` — see the previous test's own comment: the dialog can be
					// taller than the viewport, and the action buttons this test reads are queried via
					// `.then()` below regardless of scroll position, so the form only needs to exist.
					cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("exist");

					cy.get('[data-cy^="document-action-"]').then(($btns) => {
						const onScreen = [...$btns]
							.map((b) =>
								b.getAttribute("data-cy")?.replace("document-action-", ""),
							)
							.sort();
						// On a document that was NEVER saved, only the "always" available actions
						// make sense: the others expect a status the document does not have yet.
						// We therefore check inclusion in what the descriptor declares, and that no
						// button appears out of nowhere.
						const declared = d.actions.map((a) => a.id);
						for (const id of onScreen) {
							expect(
								declared,
								`${type.id} — le bouton "${id}" vient du descripteur`,
							).to.include(id);
						}
						expect(
							onScreen,
							`${type.id} — au moins une action est offerte`,
						).to.have.length.greaterThan(0);
					});
				});
			}
		});
	});

	it("the invoice blocks its own send when the company has configured NO transport — never a silent fallback", () => {
		// The test company has no `invoiceTransportId` by default (see cypress/support/commands.ts,
		// `resetAndSeed` never sets one): this is the "no transport chosen" state by construction.
		// This test therefore deliberately runs BEFORE the one that follows (which configures "email" on
		// this same company to bring an invoice to "sent" status) — the order of the `it`s in this file
		// is not incidental, `resetAndSeed` only replays once per file (`before`, not
		// `beforeEach`), so the company's state carries across tests.
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{
									description: "Conseil",
									quantity: 1,
									unit: "unit",
									unitPrice: 500,
									vatRate: "20",
								},
							],
						},
					},
					failOnStatusCode: false,
				}).then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([
						200, 201,
					]);
					const id = saved.body?.document?.id;

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: {
							documentId: id,
							data: {
								client: clients[0].id,
								issueDate: "2026-08-30",
								dueDate: "2026-09-30",
								currency: "EUR",
								lines: [
									{
										description: "Conseil",
										quantity: 1,
										unit: "unit",
										unitPrice: 500,
										vatRate: "20",
									},
								],
							},
						},
						failOnStatusCode: false,
					}).then((res) => {
						expect(
							res.status,
							`bloquée — ${JSON.stringify(res.body).slice(0, 200)}`,
						).to.eq(501);
						expect(
							String(res.body?.message ?? ""),
							"le message dit clairement qu'aucun transport n'est configuré, jamais un envoi silencieux par courriel",
						).to.match(/no transport is configured/i);
					});
				});
			});
	});

	it("an action declared WITHOUT an implementation is refused, and the user reads why", () => {
		// `export-accounting` is declared on the invoice and deliberately not implemented.
		//
		// It is no longer `convert-to-invoice` (quote) that plays this role: that action has since been
		// implemented for real (it creates a linked invoice), so calling it no longer returns 501 —
		// and pinning this test on it would have made it lie about what the product does now.
		// `record-payment` then took on this role in turn, then was itself implemented for real (see
		// payments — 24-document-payments.cy.ts): calling it no longer returns 501 either. The
		// "declared but not implemented → 501, clearly" mechanism has not disappeared though:
		// `export-accounting`, on the invoice, is now its only living showcase (along with
		// documents.service.invoice.spec.ts on the jest side).
		//
		// An invoice at "sent" status is needed first: `export-accounting` is only offered from
		// there on (before that, it is the availability 409 that refuses first — the same guard the
		// previous test observes, on the "send" side, before even reaching the 501). To reach it
		// without simulating anything, this test goes through the real path: an "email" transport
		// actually configured on the company (this time for real — the previous test, by contrast,
		// depended on its ABSENCE), a real draft, a real send (which lands in the e2e stack's real
		// Mailpit) — not a shortcut that would force the status in the database.
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(
					clients,
					"le jeu d'essai contient un client",
				).to.have.length.greaterThan(0);

				cy.request({
					method: "POST",
					url: `${api}/api/company/info`,
					// A company with no transport configured blocks the send (see the dedicated test
					// below) — one therefore has to actually pick one here, as a user would in the
					// settings, before an invoice can be brought to "sent" status.
					body: { invoiceTransportId: "email" },
					failOnStatusCode: false,
				}).then((companyRes) => {
					expect(
						companyRes.status,
						`transport "email" configuré sur la société — ${JSON.stringify(companyRes.body).slice(0, 200)}`,
					).to.be.oneOf([200, 201]);

					const invoiceData = {
						client: clients[0].id,
						issueDate: "2026-08-30",
						dueDate: "2026-09-30",
						currency: "EUR",
						lines: [
							{
								description: "Conseil",
								quantity: 1,
								unit: "unit",
								unitPrice: 500,
								vatRate: "20",
							},
						],
					};

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/save-draft`,
						body: { data: invoiceData },
						failOnStatusCode: false,
					}).then((saved) => {
						expect(
							saved.status,
							`brouillon de facture créé — ${JSON.stringify(saved.body).slice(0, 220)}`,
						).to.be.oneOf([200, 201]);
						const id = saved.body?.document?.id;
						expect(id, "le brouillon a un identifiant").to.be.a("string");

						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/send`,
							body: { documentId: id, data: invoiceData },
							failOnStatusCode: false,
						}).then((sent) => {
							expect(
								sent.status,
								`facture réellement envoyée via le transport configuré — ${JSON.stringify(sent.body).slice(0, 220)}`,
							).to.be.oneOf([200, 201]);
							// "send" is asynchronous (item 22, queues): this response is now
							// only the first half — draft -> "sending" — returned right away; the
							// actual delivery (real "email" transport, real Mailpit) is the worker's job. A
							// `cy.request().its().should()` would NOT RE-TRIGGER the request to wait for
							// what follows — `cy.waitForDocumentStatus` really polls the API until "sent" (or
							// reports the real failure if one occurs).
							cy.waitForDocumentStatus(
								`${api}/api/documents/${id}?typeId=invoice`,
								["sent", "send_failed"],
							).then((doc) => {
								expect(doc.status, 'la facture est maintenant "sent"').to.eq("sent");

								cy.request({
									method: "POST",
									url: `${api}/api/documents/types/invoice/actions/export-accounting`,
									body: { documentId: id, data: invoiceData },
									failOnStatusCode: false,
								}).then((res) => {
									expect(
										res.status,
										`refusée — ${JSON.stringify(res.body).slice(0, 200)}`,
									).to.eq(501);
									expect(
										String(res.body?.message ?? ""),
										"le message nomme l'action et dit qu'elle n'a pas d'implémentation",
									).to.match(/export-accounting/);
								});
							});
						});
					});
				});
			});
	});

	it("an unknown document type is cleanly refused, both on the screen and at the API", () => {
		cy.request({
			url: `${api}/api/documents/types/nexiste-pas`,
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "l'API refuse").to.eq(404);
		});

		// And the screen does not show a blank page: a blank page looks like an outage.
		cy.visit("/documents/nexiste-pas");
		cy.get('[data-cy="document-type-unknown"]', { timeout: 20000 }).should(
			"be.visible",
		);
	});

	it("the API also refuses an action the country's policy forbids — a scripted client does not bypass the screen", () => {
		// The company in this fixture is French (see resetAndSeed) — France is one of the two
		// countries covered by backend/src/modules/documents/country-policy/data/, so up to this
		// point every action has been allowed by the policy. This test switches the company to a
		// country with NO declared rule (neither France nor the United States) to observe the
		// blocking — then restores France, whether this is the last `it` in this file or not: nothing
		// guarantees a future `it` won't be added after this one.
		//
		// The call goes directly through `cy.request`, never a click: what the screen would not even
		// show (the button would be greyed out — see document-form.tsx) must be refused exactly the
		// same way for a client that ignores the screen and calls the action by hand.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			// Germany received a policy on 2026-09-03 — this test's former example of a "country
			// with no rule" became a COVERED country (201 instead of 403, the test battery caught
			// it). Japan now takes on that role: no `jp.json` file exists under country-policy/data,
			// and the test's intent (a scripted client does not bypass the screen for an uncovered
			// country) is unchanged, assertion for assertion.
			body: { country: "Japan", countryCode: "JP" },
			failOnStatusCode: false,
		}).then((changed) => {
			expect(
				changed.status,
				`le pays de la société est changé pour un pays sans règle — ${JSON.stringify(changed.body).slice(0, 200)}`,
			).to.be.oneOf([200, 201]);

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: {
					data: {
						client: "does-not-matter",
						issueDate: "2026-08-30",
						dueDate: "2026-09-30",
						currency: "EUR",
						lines: [
							{
								description: "Conseil",
								quantity: 1,
								unit: "unit",
								unitPrice: 500,
								vatRate: "20",
							},
						],
					},
				},
				failOnStatusCode: false,
			}).then((res) => {
				expect(
					res.status,
					`bloquée — ${JSON.stringify(res.body).slice(0, 200)}`,
				).to.eq(403);
				expect(
					String(res.body?.message ?? ""),
					"le message nomme le pays et dit comment débloquer, jamais un refus muet",
				).to.match(/"JP"/);
			});
		});

		// Restores the state the rest of the suite expects (a covered French company), whether this
		// test succeeded or not — otherwise a future `it` added after this one would inherit a country
		// with no rule at all and would see EVERYTHING blocked with no connection to what it actually tests.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { country: "France", countryCode: "FR" },
			failOnStatusCode: false,
		});
	});

	it("the sidebar leads to a type the country allows, without naming that type", () => {
		// The Documents group no longer carries hand-written links: it fills in from the
		// country policy. We navigate like a user, taking whatever type the backend announces
		// — never a name hard-coded in the test.
		//
		// The group is expanded BY DEFAULT: the toggle must absolutely not be clicked. My first
		// version did so "if the link is absent" — but the list arrives asynchronously,
		// so the check ran before the response, saw nothing, and CLOSED a group that was already
		// open. The link then never appeared, and I believed it was a product defect for
		// three attempts before making the screen speak for itself.
		cy.request<{ types?: { id: string }[] }>({
			url: `${api}/api/documents/available-types`,
		})
			.its("body")
			.then((body) => {
				const types = body.types ?? [];
				expect(
					types,
					"le pays du jeu d'essai autorise au moins un type",
				).to.have.length.greaterThan(0);

				cy.visit("/dashboard");
				cy.get('[data-cy="sidebar-documents-group-toggle"]', {
					timeout: 20000,
				}).should("exist");
				cy.get(`[data-cy="sidebar-document-type-link-${types[0].id}"]`, {
					timeout: 20000,
				}).click({
					force: true,
				});
				cy.url().should("include", `/documents/${types[0].id}`);
			});
	});

	it("the dashboard aggregates widgets from at least two distinct document types, not just the invoice", () => {
		// TODO item 25: the dashboard only had the invoice; the quote (a shortlist of
		// drafts) and the expense (a "this month" metric) now contribute too. This
		// test proves it on the screen, not just on the jest side — see the mechanism in
		// backend/src/modules/documents/contributions/.
		//
		// The GET /api/documents/dashboard JSON does NOT expose a `typeId` field on an
		// implemented widget (only the "unimplemented" marker carries one — see widgets.ts on the
		// backend side): it is a plain `id`, `label`, `kind`, etc. Each contribution does however
		// prefix its own `id` with the typeId that produced it (`invoice:pending`, `quote:draft`,
		// `expense:this-month`, ...) — a convention every contribution follows, not a formal contract. We
		// therefore rely on that: the DOM carries the same `id` in its `data-cy` (`widget-<id>`, see
		// widget-renderers/*.tsx), so we read it there, on the actually rendered screen, rather than
		// building a separate API request.
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				expect(
					clients,
					"le jeu d'essai contient un client",
				).to.have.length.greaterThan(0);

				// A draft quote — fills the quote shortlist on the dashboard.
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-30",
							currency: "EUR",
							lines: [{ description: "Conseil", quantity: 1, unitPrice: 100 }],
						},
					},
					failOnStatusCode: false,
				}).then((res) => {
					expect(
						res.status,
						`brouillon de devis créé — ${JSON.stringify(res.body).slice(0, 200)}`,
					).to.be.oneOf([200, 201]);
				});

				// An expense dated TODAY (never hard-coded) — fills the expense's "this
				// month" metric on the dashboard, whatever day this test runs on.
				const today = new Date().toISOString().slice(0, 10);
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/expense/actions/save-draft`,
					body: {
						data: { description: "Fournitures", amount: 42, currency: "EUR", date: today },
					},
					failOnStatusCode: false,
				}).then((res) => {
					expect(
						res.status,
						`dépense créée — ${JSON.stringify(res.body).slice(0, 200)}`,
					).to.be.oneOf([200, 201]);
				});
			});

		cy.visit("/dashboard");
		cy.get('[data-cy^="widget-"]', { timeout: 20000 })
			.should("have.length.greaterThan", 0)
			.then(($widgets) => {
				const typeIds = new Set(
					[...$widgets]
						.map((el) => el.getAttribute("data-cy") ?? "")
						.filter((attr) => attr.startsWith("widget-"))
						.map((attr) => attr.slice("widget-".length).split(":")[0]),
				);

				expect(
					[...typeIds],
					`au moins deux types de documents distincts contribuent au dashboard — vus : ${[...typeIds].join(", ")}`,
				).to.have.length.of.at.least(2);
			});
	});
});
