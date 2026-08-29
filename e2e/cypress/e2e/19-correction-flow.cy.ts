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
 * Fixtures (company, client, the invoice being corrected) stay on the API deliberately: they are the
 * situation, not the behaviour under test, and driving them through forms would make every failure
 * ambiguous.
 */
import {
	api,
	issuedInvoice,
	send,
	setupCountry,
	waitForSettled,
} from "../support/showcase";

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

/** Click a control on the row of a SPECIFIC invoice — never `.first()`, which drifts. */
const onRow = (invoiceId: string, dataCy: string) =>
	cy
		.get(`[data-cy="invoice-row"][data-invoice-id="${invoiceId}"]`, {
			timeout: 20000,
		})
		.find(`[data-cy="${dataCy}"]`)
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

describe("Correction flow — driven by the interface, asserted on the record", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	/** One issued, settled French invoice to correct. Fixture only. */
	const anIssuedInvoice = () =>
		setupCountry("Correction FR", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000074" },
			{ scheme: "VAT", value: "FR44732829320" },
		]).then((ids) =>
			issuedInvoice(ids).then((id) => {
				// The shared helper swallows a refused send; a fixture that half-worked is how a spec
				// ends up testing something other than what it claims.
				send(id as unknown as string).then((res) => {
					expect(
						res.status,
						`send responded — body: ${JSON.stringify(res.body)}`,
					).to.be.oneOf([200, 201]);
				});
				waitForSettled(id as unknown as string);
				return cy.wrap(id as unknown as string);
			}),
		);

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
