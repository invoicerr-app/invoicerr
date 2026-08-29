/**
 * Correcting an invoice, THROUGH THE INTERFACE.
 *
 * The first version of this spec drove every action with `cy.request()`. It proved the backend
 * worked; it proved nothing about whether a user could do any of it. This repository has two fresh
 * reminders of why that gap matters: the shared `send()` helper posted `{ invoiceId }` to a
 * controller reading `id`, so specs "sent" documents for months without sending anything, and the
 * Italian debit note existed in the API while the front threw it away. An API-driven test sees
 * neither.
 *
 * So the rule is split, and the split is the point:
 *   ACTIONS go through the UI — the button a person clicks. If a control is missing, wired to the
 *   wrong payload, or never rendered, this spec fails.
 *   ASSERTIONS read the API — the recorded fact, never a sentence the screen shows while a queue is
 *   still running. Screen prose is a timing race; the record is not.
 *
 * The fixture used to build its issued invoice with three `cy.request()` calls (create, issue,
 * send). That was the same shortcut this file's own header warns against — a fixture that
 * "half-worked" (an invoice that was never actually issuable, or a send the UI could never trigger)
 * would have gone unnoticed. So the fixture now drives the same three steps from the screen: the
 * creation form, the row's issue button, and the row's send button behind its confirmation dialog.
 *
 * Only the SITUATION stays on the API: the company and the client (`setupCountry`). They are
 * covered by specs 02 and 05, and driving them through onboarding forms here would make every
 * failure in this file ambiguous — a broken company wizard and a broken correction button would
 * fail the same test.
 */
import { api, setupCountry, waitForSettled } from "../support/showcase";

type InvoiceRow = {
	id: string;
	status: string;
	kind: string | null;
	number: number | null;
	rawNumber: string | null;
	correctsInvoiceId: string | null;
	totalTTC: number;
	items: { id: string; name: string }[];
};

const getInvoice = (id: string) =>
	cy.request<InvoiceRow>({ url: `${api}/api/invoices/${id}` }).its("body");

/**
 * The correction the UI just produced for `originalId`, whatever id it chose.
 *
 * Retried, for the same reason `eventually` exists: a click returns before the record is written, and
 * a single read turns "not yet" into "never happened". The earlier version also passed `?limit=100`,
 * which the endpoint ignores — its page size is fixed at 10 — so the parameter read as a safety net
 * while providing none.
 */
const draftCorrectionOf = (originalId: string, tries = 10) => {
	const attempt = (left: number): Cypress.Chainable<InvoiceRow> =>
		cy
			.request({ url: `${api}/api/invoices` })
			.its("body")
			.then((body: unknown) => {
				const rows = (
					Array.isArray(body)
						? body
						: ((body as { invoices?: InvoiceRow[] }).invoices ?? [])
				) as InvoiceRow[];
				const found = rows.find((r) => r.correctsInvoiceId === originalId);
				if (found) return cy.wrap(found);
				if (left <= 1) {
					expect(
						rows.map((r) => `${r.kind}:${r.status}`).join(" | ") || "(no rows)",
						`the UI produced a correction of ${originalId} — the page holds`,
					).to.eq(`a correction of ${originalId}`);
				}
				return cy.wait(700).then(() => attempt(left - 1));
			});
	return attempt(tries);
};

/**
 * The draft the CREATION FORM just produced, in this test's own freshly-made company.
 *
 * Same race as `draftCorrectionOf`, one step earlier: the dialog closes the tick `useDocumentUpsert`
 * gets its 2xx back, but the list it closes onto is a separate refetch. Filtering on
 * `status === "DRAFT" && number === null` rather than just "the only row" keeps this correct even if
 * a later change makes the fixture share a company across calls.
 */
const draftJustCreated = (tries = 10) => {
	const attempt = (left: number): Cypress.Chainable<InvoiceRow> =>
		cy
			.request({ url: `${api}/api/invoices` })
			.its("body")
			.then((body: unknown) => {
				const rows = (
					Array.isArray(body)
						? body
						: ((body as { invoices?: InvoiceRow[] }).invoices ?? [])
				) as InvoiceRow[];
				const found = rows.find(
					(r) => r.status === "DRAFT" && r.number === null,
				);
				if (found) return cy.wrap(found);
				if (left <= 1) {
					expect(
						rows.map((r) => `${r.kind}:${r.status}`).join(" | ") || "(no rows)",
						"the creation form produced a draft — the page holds",
					).to.eq("a fresh draft");
				}
				return cy.wait(700).then(() => attempt(left - 1));
			});
	return attempt(tries);
};

/**
 * Click a control on the row of a SPECIFIC invoice — never `.first()`, which drifts.
 *
 * Both queries carry the timeout, not just the outer one: a `{timeout}` on `cy.get` only governs
 * that command's own wait for the ROW to exist, not the `.find()` chained after it. Every previous
 * caller happened to follow a fresh `cy.visit`, where the row already had its final button set on
 * first paint — so the default 4s on `.find()` never mattered until a fixture stayed on the SAME
 * page across an in-place refetch (issue, then send, without navigating between them) and hit it.
 */
const onRow = (invoiceId: string, dataCy: string) =>
	cy
		.get(`[data-cy="invoice-row"][data-invoice-id="${invoiceId}"]`, {
			timeout: 20000,
		})
		.find(`[data-cy="${dataCy}"]`, { timeout: 20000 })
		.click();

/**
 * Read the record back until it says what we expect, or fail saying what it actually said.
 *
 * A single read after a 200 is a race: the response returns before the list has refetched and, more
 * to the point, a failure then tells you the value but never how long it stayed wrong. This retries
 * and reports the last thing it saw.
 */
const eventually = (
	id: string,
	predicate: (row: InvoiceRow) => boolean,
	what: string,
	tries = 10,
) => {
	const attempt = (left: number): Cypress.Chainable<InvoiceRow> =>
		cy.request<InvoiceRow>({ url: `${api}/api/invoices/${id}` }).then((res) => {
			if (predicate(res.body)) return cy.wrap(res.body);
			if (left <= 1) {
				expect(
					JSON.stringify({ status: res.body.status, number: res.body.number }),
					what,
				).to.eq(what);
			}
			return cy.wait(700).then(() => attempt(left - 1));
		});
	return attempt(tries);
};

/**
 * Confirm a send actually landed the document where correction is offered from —
 * DELIVERED / ACCEPTED / REPORTED, per the lifecycle comment `send()` used to carry — rather than
 * trusting that clicking the confirmation button produced a 2xx somewhere. A UI-driven send has no
 * HTTP response for the test to inspect the way the old `cy.request`-based helper did; reading the
 * backend-derived action back is the equivalent check on the record, not a weaker one — it fails
 * exactly when the fixture would have been half-worked (queued, then rejected).
 */
const eventuallyCorrectable = (id: string, tries = 15) => {
	const attempt = (left: number): Cypress.Chainable<unknown> =>
		cy
			.request<{
				complianceStatus: string | null;
				actions: Record<string, boolean>;
			}>({
				url: `${api}/api/invoices/${id}/available-actions`,
			})
			.its("body")
			.then((body) => {
				if (body.actions?.correct) return cy.wrap(body);
				if (left <= 1) {
					expect(
						`complianceStatus=${body.complianceStatus} actions=${JSON.stringify(body.actions)}`,
						"the send settled somewhere correction is offered from",
					).to.eq("the send settled somewhere correction is offered from");
				}
				return cy.wait(700).then(() => attempt(left - 1));
			});
	return attempt(tries);
};

/**
 * Fill in and submit the invoice CREATION form: the client, one line, submit.
 *
 * Assumes the create dialog is already open. `clientSlug` is the option's `data-cy` suffix
 * (`SearchSelect` slugs it from the option's label), so this only works for a client whose name is
 * known up front — exactly what `setupCountry` hands back.
 */
const fillAndSubmitInvoiceForm = (
	clientSlug: string,
	unitPrice: number,
	vatRate: number,
) => {
	cy.get('[data-cy="invoice-dialog"]', { timeout: 15000 }).should("be.visible");
	cy.get('[data-cy="invoice-client-select"]').find("button").click();
	cy.get(`[data-cy="invoice-client-select-option-${clientSlug}"]`, {
		timeout: 10000,
	}).click();
	cy.contains("button", /Add Item/i, { timeout: 15000 }).click();
	cy.get('[name="items.0.name"]').type("Consulting", { force: true });
	cy.get('[name="items.0.quantity"]')
		.clear({ force: true })
		.type("1", { force: true });
	cy.get('[name="items.0.unitPrice"]')
		.clear({ force: true })
		.type(String(unitPrice), { force: true });
	cy.get('[name="items.0.vatRate"]')
		.clear({ force: true })
		.type(String(vatRate), { force: true });
	cy.get('[data-cy="invoice-submit"]').click();
	cy.get('[data-cy="invoice-dialog"]', { timeout: 15000 }).should("not.exist");
};

describe("Correction flow — driven by the interface, asserted on the record", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	/** One issued, settled French invoice to correct — built entirely from the screen. */
	const anIssuedInvoice = () =>
		setupCountry("Correction FR", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000074" },
			{ scheme: "VAT", value: "FR44732829320" },
		]).then(() => {
			// Create: the add button, the form, the client, one line, submit.
			cy.visit("/invoices");
			cy.get('[data-cy="invoice-add-button"]', { timeout: 20000 }).click();
			fillAndSubmitInvoiceForm("fr-client", 1000, 20);

			return draftJustCreated().then((draft) => {
				// Issue: a SEPARATE click, on the row the draft just landed on.
				onRow(draft.id, "invoice-issue-button");

				return eventually(
					draft.id,
					(r) => r.status === "ISSUED" && r.number !== null,
					"the fixture invoice reached ISSUED, through its own issue button",
				).then(() => {
					// Send: the row's send button, THEN its confirmation dialog. Skipping the
					// confirmation is not a shortcut to the same result — it is a different action
					// that sends nothing, which is exactly what `send-confirmation-confirm` exists
					// to prevent a test (or a distracted user) from doing by accident.
					onRow(draft.id, "invoice-send-button");
					cy.get('[data-cy="send-confirmation-confirm"]', {
						timeout: 15000,
					}).click();

					waitForSettled(draft.id);
					return eventuallyCorrectable(draft.id).then(() => cy.wrap(draft.id));
				});
			});
		});

	it("01 clicking Correct in the LIST produces a draft, and lands the user on it", () => {
		anIssuedInvoice().then((originalId) => {
			cy.visit("/invoices");
			onRow(originalId, "invoice-correct-button");

			// The list used to show a toast and leave the user staring at the list. A correction is a
			// draft they now have to finish; making them find it again asks them to remember what just
			// happened.
			cy.get('[role="dialog"]', { timeout: 20000 }).should("be.visible");

			draftCorrectionOf(originalId).then((draft) => {
				expect(draft.status, "born a draft").to.eq("DRAFT");
				expect(
					draft.number,
					"no counter taken — a draft never sent must burn none",
				).to.eq(null);
			});
		});
	});

	it("02 the draft is editable FROM THE SCREEN — a line can be removed", () => {
		anIssuedInvoice().then((originalId) => {
			cy.visit("/invoices");
			onRow(originalId, "invoice-correct-button");
			cy.get('[role="dialog"]', { timeout: 20000 }).should("be.visible");

			draftCorrectionOf(originalId).then((draft) => {
				const before = draft.items.length;
				expect(before, "the fixture has something to remove").to.be.greaterThan(
					0,
				);

				cy.get('[data-cy="action-edit"]', { timeout: 15000 }).click();
				cy.get('[data-cy="invoice-dialog"]', { timeout: 15000 }).should(
					"be.visible",
				);
				// The control a person uses. If it stops existing, this fails — which is the whole
				// reason the actions go through the UI.
				cy.get('[data-cy="remove-item-0"]').click();
				cy.get('[data-cy="invoice-submit"]').click();
				cy.get('[data-cy="invoice-dialog"]', { timeout: 15000 }).should(
					"not.exist",
				);

				getInvoice(draft.id).then((edited) => {
					expect(edited.items.length, "the removal reached the record").to.eq(
						before - 1,
					);
				});
			});
		});
	});

	it("03 issuing it is a SEPARATE click, and that is when it takes a number", () => {
		anIssuedInvoice().then((originalId) => {
			cy.visit("/invoices");
			onRow(originalId, "invoice-correct-button");
			cy.get('[role="dialog"]', { timeout: 20000 }).should("be.visible");

			draftCorrectionOf(originalId).then((draft) => {
				cy.visit("/invoices");
				// `.first()` clicked whichever draft an earlier test left behind, then asserted on ours:
				// a test that fails while the feature works, and passes when the ordering happens to suit.
				onRow(draft.id, "invoice-issue-button");

				eventually(
					draft.id,
					(r) => r.status === "ISSUED",
					"the correction reached ISSUED",
				).then((issued) => {
					expect(
						issued.number,
						"a counter is allocated at ISSUE, not at creation",
					).to.not.eq(null);
					expect(issued.rawNumber).to.be.a("string");
				});
			});
		});
	});

	it("04 the issued credit note settles what it corrects", () => {
		// Odoo calls this "Crédits en circulation". The invoice and the credit note used to ignore each
		// other, so a fully credited invoice stayed UNPAID and kept chasing the customer.
		anIssuedInvoice().then((originalId) => {
			cy.request({ url: `${api}/api/invoices/${originalId}/settlement` })
				.its("body")
				.then((before: { outstandingMinor: number; creditedMinor: number }) => {
					expect(before.creditedMinor, "nothing credited yet").to.eq(0);

					cy.visit("/invoices");
					onRow(originalId, "invoice-correct-button");
					cy.get('[role="dialog"]', { timeout: 20000 }).should("be.visible");

					cy.visit("/invoices");
					draftCorrectionOf(originalId).then((draft) => {
						onRow(draft.id, "invoice-issue-button");
						// A DRAFT credit note settles nothing, so reading the balance before it is issued
						// would measure the wrong moment.
						eventually(
							draft.id,
							(r) => r.status === "ISSUED",
							"the credit note reached ISSUED",
						);
					});

					cy.request({ url: `${api}/api/invoices/${originalId}/settlement` })
						.its("body")
						.then(
							(after: {
								creditedMinor: number;
								paidMinor: number;
								settled: boolean;
							}) => {
								expect(
									after.creditedMinor,
									"the issued credit note counts",
								).to.eq(before.outstandingMinor);
								// Separately from payments, deliberately: a credit is not cash that arrived, and
								// a product that files it as one reports revenue it never received.
								expect(
									after.paidMinor,
									"and it is not filed as a payment",
								).to.eq(0);
								expect(after.settled).to.eq(true);
							},
						);
				});
		});
	});

	it("05 the DETAIL VIEW is the other way in, and both land on the same draft", () => {
		anIssuedInvoice().then((originalId) => {
			cy.visit("/invoices");
			onRow(originalId, "invoice-name");
			cy.get('[role="dialog"]', { timeout: 15000 }).should("be.visible");

			// France opens the credit note — CGI art. 289, I, 5. Italy would show no corrective button
			// at all, and spec 20 asserts that contrast.
			cy.get('[data-cy="action-correct"]', { timeout: 15000 })
				.should("be.visible")
				.click();

			draftCorrectionOf(originalId).then((draft) => {
				expect(draft.status, "the same flow from either entry point").to.eq(
					"DRAFT",
				);
			});
		});
	});
});
