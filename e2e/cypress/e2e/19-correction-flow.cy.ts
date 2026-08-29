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

import {
	draftCorrectionOf,
	eventually,
	getInvoice,
	issuedSentInvoice,
	onRow,
} from "../support/journey";
import { api } from "../support/showcase";

/** La France, en données. Le corps des tests ci-dessous ne la nomme jamais. */
const FR = {
	label: "Correction FR",
	name: "France",
	iso: "FR",
	identifiers: [
		{ scheme: "LEGAL_ID", value: "73282932000074" },
		{ scheme: "VAT", value: "FR44732829320" },
	],
	clientSlug: "fr-client",
	vatRate: 20,
};

describe("Correction flow — driven by the interface, asserted on the record", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	/** Une facture française émise et envoyée — construite entièrement depuis l'écran. */
	const anIssuedInvoice = () => issuedSentInvoice(FR);

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
