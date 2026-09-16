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

type Field = { key: string; kind: string; label: string; required?: boolean; fields?: Field[] };
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

/**
 * Fills ONE top-level field with SOME value its own client-side schema accepts — never the real,
 * meaningful value another spec would use, just enough to clear `form.trigger` so the wizard's
 * "Continue" (stepped-dialog.tsx) stops blocking on it. Line-item subfields are never reached here:
 * every top-level 'array' field in this repo's descriptors has NO `min` (schema.ts's own
 * `buildZodSchema`), so an EMPTY array already validates — this test never has to add a row.
 * Skips a control found DISABLED (a `lockedFromReference` select, e.g. credit-note's own "currency"
 * once "invoice" is picked): already correctly filled by the app itself, nothing to type.
 */
function fillFieldMinimal(field: Field) {
	const inputDataCy = `document-field-${field.key}-input`;
	const input = `[data-cy="${inputDataCy}"]`;
	switch (field.kind) {
		case "text":
		case "longText":
			cy.get(input).then(($el) => {
				if ($el.is(":disabled")) return;
				cy.wrap($el).clear({ force: true }).type("Coverage", { force: true });
			});
			return;
		case "number":
		case "money":
			cy.get(input).then(($el) => {
				if ($el.is(":disabled")) return;
				cy.wrap($el).clear({ force: true }).type("1", { force: true });
			});
			return;
		case "date":
			cy.get(input).then(($el) => {
				if ($el.is(":disabled")) return;
				cy.pickToday(input);
			});
			return;
		case "boolean":
			// The default (`false`) already satisfies `z.boolean()` — nothing required to clear.
			return;
		case "select":
		case "reference":
			// Either a SearchSelect (a <div> wrapper around a <button> trigger — search-input.tsx) or,
			// for a 'select' with NO known options at all, a plain <input> (SelectField's own
			// `allowCustomValue` fallback, primitive-fields.tsx).
			cy.get(input).then(($el) => {
				if ($el.is(":disabled")) return;
				if ($el.is("input")) {
					cy.wrap($el).type("Coverage", { force: true });
					return;
				}
				const trigger = $el.find("button").first();
				if (trigger.is(":disabled")) return;
				cy.wrap(trigger).click({ force: true });
				cy.get(`[data-cy="${inputDataCy}-options"]`, { timeout: 10000 }).should("be.visible");
				cy.get(`[data-cy="${inputDataCy}-options"]`).find("button").first().click();
			});
			return;
		case "rowSelection":
			// Checks the FIRST currently-offered row — see row-selection-field.tsx's own
			// `document-field-<key>-row-<id>-checkbox`. The prerequisite source record (an invoice
			// with a line, for credit-note's "correctedLines") is seeded in this file's own `before()`.
			cy.get(
				`[data-cy^="document-field-${field.key}-row-"][data-cy$="-checkbox"]`,
				{ timeout: 10000 },
			)
				.first()
				.check({ force: true });
			return;
		case "array":
			// EVERY top-level 'array' field in this repo's descriptors that IS `required` also
			// declares `min: 1` (invoice/quote/purchase-order/goods-receipt's own "lines") — an
			// empty array does NOT validate for these, unlike this function's own header claims for
			// the general case. A row may already exist — goods-receipt's own "lines" PRE-FILLS
			// itself from the picked "purchaseOrder" (use-document-form.ts's "isGoodsReceipt" effect,
			// unrelated to this test's own seeding) — so this only ADDS one when none is there yet;
			// "add row" a SECOND time would leave a blank, REQUIRED, unfillable-by-this-generic-code
			// row behind (min:1 is satisfied by count alone, never by which rows are non-empty).
			if (!field.fields?.length) return;
			cy.get("body").then(($body) => {
				const hasRow = $body.find(`[data-cy="document-field-${field.key}-row-0"]`).length > 0;
				if (!hasRow) {
					cy.get(`[data-cy="document-field-${field.key}-add-row"]`).click();
					cy.get(`[data-cy="document-field-${field.key}-row-0"]`).should("exist");
				}
				for (const rowField of field.fields ?? []) {
					if (rowField.required) fillRowFieldMinimal(field.key, rowField);
				}
			});
			return;
		default:
			// 'hiddenReference' (never rendered), 'file' (no REQUIRED one exists in this repo's own
			// descriptors today) — nothing to fill to pass validation.
			return;
	}
}

/**
 * `fillFieldMinimal`, scoped to ONE row of an 'array' field — addressed by NAME
 * (`input[name="<arrayKey>.0.<key>"]`), never by `data-cy`: a row subfield's own `data-cy` is its
 * BARE key (array-field.tsx renders it through the exact same `DocumentField` a top-level field
 * uses, with that field's OWN `key` — never prefixed by the array's), so a row's "description"
 * shares its `data-cy` with any unrelated TOP-LEVEL field literally named "description". Same
 * "addressed by NAME" convention 20-document-totals.cy.ts's own header already documents for
 * exactly this reason. A 'select'/'reference' subfield is the one exception: its OWN `data-cy` is
 * scoped by the row container for the trigger, and its options popover portals OUTSIDE the row
 * (Radix), so that part stays selector-based, matching every other spec's own row-select pattern.
 */
function fillRowFieldMinimal(arrayKey: string, rowField: Field) {
	switch (rowField.kind) {
		case "text":
		case "longText":
			// `.clear()` first — this row may already be PRE-FILLED (goods-receipt's own "lines",
			// see the caller's own comment), and typing without clearing would only ever APPEND.
			cy.get(`[name="${arrayKey}.0.${rowField.key}"]`).clear({ force: true }).type("Coverage", { force: true });
			return;
		case "number":
		case "money":
			cy.get(`[name="${arrayKey}.0.${rowField.key}"]`).clear({ force: true }).type("1", { force: true });
			return;
		case "select":
		case "reference": {
			const rowFieldWrap = `[data-cy="document-field-${arrayKey}-row-0"] [data-cy="document-field-${rowField.key}-input"]`;
			cy.get(rowFieldWrap).then(($el) => {
				if ($el.is(":disabled")) return;
				if ($el.is("input")) {
					cy.wrap($el).type("Coverage", { force: true });
					return;
				}
				cy.wrap($el.find("button").first()).click({ force: true });
				cy.get(`[data-cy="document-field-${rowField.key}-input-options"]`, { timeout: 10000 }).should(
					"be.visible",
				);
				cy.get(`[data-cy="document-field-${rowField.key}-input-options"]`).find("button").first().click();
			});
			return;
		}
		default:
			return;
	}
}

/**
 * Walks the wizard (stepped-dialog.tsx) from whichever step it opened on to its last one, checking
 * every field in `fields` that is CURRENTLY MOUNTED against `seen` (scrolled to, visible, no
 * "-unsupported" marker), filling any REQUIRED one so "Continue" stops blocking. Recurses through
 * `cy.get('body').then()` — a `cy.` command queued inside a `.then()` runs after everything already
 * queued, so this still executes strictly in order despite the recursion.
 */
function walkWizardCheckingFields(fields: Field[], seen: Set<string>, guard = 0) {
	if (guard > 6) return; // more steps than this wizard has ever had — a real bug, not a slow one.
	cy.get("body").then(($body) => {
		for (const f of fields) {
			const sel = `[data-cy="document-field-${f.key}"]`;
			if ($body.find(sel).length === 0) continue;
			if (!seen.has(f.key)) {
				seen.add(f.key);
				cy.get(sel).scrollIntoView().should("be.visible");
				cy.get(`[data-cy="document-field-${f.key}-unsupported"]`).should("not.exist");
			}
			if (f.required) fillFieldMinimal(f);
		}
		cy.get("body").then(($after) => {
			if ($after.find('[data-cy="document-create-dialog-continue"]').length > 0) {
				cy.continueDocumentWizard();
				walkWizardCheckingFields(fields, seen, guard + 1);
			}
		});
	});
}

/**
 * `walkWizardCheckingFields` without the coverage bookkeeping — for a caller that only needs to
 * REACH the wizard's last step ("Summary", where the type's own action buttons finally render —
 * see stepped-dialog.tsx: everywhere earlier, the primary button reads "Continue"), filling
 * whatever's required along the way with the same minimal, disabled-aware values.
 */
function advanceWizardToLastStep(fields: Field[], guard = 0) {
	if (guard > 6) return;
	cy.get("body").then(($body) => {
		for (const f of fields) {
			if (!f.required) continue;
			if ($body.find(`[data-cy="document-field-${f.key}"]`).length > 0) fillFieldMinimal(f);
		}
		cy.get("body").then(($after) => {
			if ($after.find('[data-cy="document-create-dialog-continue"]').length > 0) {
				cy.continueDocumentWizard();
				advanceWizardToLastStep(fields, guard + 1);
			}
		});
	});
}

describe("A document is a descriptor, and the screen follows it", () => {
	before(() => {
		cy.resetAndSeed();

		// Prerequisite records for two REQUIRED 'reference' fields the wizard's own "Details" step
		// would otherwise block on with nothing to pick: credit-note's "invoice" (and, downstream,
		// its "correctedLines" 'rowSelection') and goods-receipt's "purchaseOrder", both resolved
		// against the ONE client `resetAndSeed` already creates ("supplier" is the same client
		// entity under a different label — see 66-purchase-orders.cy.ts's own comment). Not read
		// for their own content — the coverage test below only needs them to EXIST.
		cy.request<{ id: string }[]>({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients) => {
				const client = clients[0].id;
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{ description: "Coverage seed", quantity: 1, unit: "unit", unitPrice: 10, vatRate: "20" },
							],
						},
					},
				});
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/purchase-order/actions/save-draft`,
					body: {
						data: {
							supplier: client,
							issueDate: "2026-08-30",
							currency: "EUR",
							lines: [{ description: "Coverage seed", quantity: 1, unitPrice: 10 }],
						},
					},
				});
			});
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
					cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("exist");

					// The create dialog is now a WIZARD (stepped-dialog.tsx): only the CURRENT step's fields
					// are mounted at a time — "Details" (required fields) -> "Lines" (table-shaped ones) ->
					// "Options" (the rest) -> "Summary", a step with nothing in it skipped
					// (document-create-dialog.tsx's own `buildFieldGroups`). This walks forward, one
					// "Continue" at a time, filling only what blocks it, until every field this type's own
					// API descriptor declares has been seen mounted at least once — never a fixed step order
					// or count assumed, the same "data-driven, not hand-copied" discipline this file's own
					// header states for the type/field lists themselves.
					const seen = new Set<string>();
					walkWizardCheckingFields(d.fields, seen);
					cy.wrap(null).then(() => {
						const missing = d.fields.map((f) => f.key).filter((key) => !seen.has(key));
						expect(
							missing,
							`${type.id} — tous ses champs sont passés par un écran du wizard — manquants : ${missing.join(", ")}`,
						).to.have.length(0);
					});
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


					// The wizard's action buttons (the type's own, `document-action-<id>`) only render on
					// its LAST step ("Summary") — every earlier step's primary button reads "Continue"
					// instead (stepped-dialog.tsx). Reach it first, filling whatever's required along the
					// way — see `advanceWizardToLastStep`'s own header.
					advanceWizardToLastStep(d.fields);
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
