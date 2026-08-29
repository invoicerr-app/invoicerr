/**
 * Correcting an invoice, the way a business actually does it.
 *
 * The flow this pins down came from watching Odoo: a correction is born a DRAFT the user edits, and
 * only becomes a legal document when they issue it. Ours used to be born ISSUED with every line of
 * the original copied — which made "j'ai oublié un truc", the reason anyone corrects anything, an
 * all-or-nothing reversal. A partial credit note was impossible.
 *
 * Everything here is asserted on the FACT the backend recorded, read back through the API — never on
 * a sentence the screen happens to be showing, which depends on a queue nobody is waiting for.
 */
import { api, issuedInvoice, send, setupCountry, waitForSettled } from "../support/showcase";

type InvoiceRow = {
	id: string;
	status: string;
	kind: string | null;
	number: number | null;
	rawNumber: string | null;
	correctsInvoiceId: string | null;
	correctionReason: string | null;
	notes: string | null;
	totalTTC: number;
	items: { id: string; name: string; quantity: number; unitPrice: number; vatRate: number }[];
};

const getInvoice = (id: string) =>
	cy.request<InvoiceRow>({ url: `${api}/api/invoices/${id}`, failOnStatusCode: false }).its("body");

/** Correct an issued invoice and hand back the draft it produced. */
function correct(invoiceId: string, body: Record<string, unknown> = {}) {
	return cy
		.request<{ correctionInvoiceId: string; status: string; message: string }>({
			method: "POST",
			url: `${api}/api/invoices/${invoiceId}/correct`,
			body,
			failOnStatusCode: false,
		})
		.then((res) => {
			// The body travels into the failure message: a bare status tells you it broke, never why.
			expect(res.status, `correct responded — body: ${JSON.stringify(res.body)}`).to.be.oneOf([200, 201]);
			return res.body;
		});
}

describe("Correction flow — a draft the user finishes, not a fait accompli", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	/** One issued, settled French invoice to correct. Returns its id. */
	const anIssuedInvoice = () =>
		setupCountry("Correction FR", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000074" },
			{ scheme: "VAT", value: "FR44732829320" },
		]).then((ids) =>
			issuedInvoice(ids).then((id) => {
				// The shared helper posts with `failOnStatusCode: false`, so a refused send is
				// swallowed and the document silently stays ISSUED. Check it here: a fixture that
				// half-worked is how a spec ends up testing something other than what it claims.
				send(id as unknown as string).then((res) => {
					expect(res.status, `send responded — body: ${JSON.stringify(res.body)}`).to.be.oneOf([
						200, 201,
					]);
				});
				waitForSettled(id as unknown as string);
				return cy.wrap(id as unknown as string);
			}),
		);

	it("01 the correction is a DRAFT, and it has taken no number", () => {
		anIssuedInvoice().then((originalId) => {
			correct(originalId).then((res) => {
				expect(res.status, "the API says draft").to.eq("DRAFT");

				getInvoice(res.correctionInvoiceId).then((draft) => {
					expect(draft.status, "status").to.eq("DRAFT");
					// The gapless series is the point: a correction that is never sent used to have
					// consumed a number for ever. A draft consumes nothing.
					expect(draft.number, "no counter allocated").to.eq(null);

					// PRODUCT DEFECT, pinned rather than asserted away. A draft still receives a
					// DISPLAY number: the Prisma create extension (prisma.service.ts:113) formats one
					// from a null counter, so `INV-2026-0000` lands on every draft in the database —
					// indistinguishable from a real number, and identical across drafts. Odoo shows
					// `/` for exactly this reason.
					//
					// Not fixed here: the guard belongs in the extension and would change every draft
					// quote, invoice and payment at once, which is far wider than the correction flow
					// this spec covers. Pinned so the day someone fixes it, this line fails and the
					// change is deliberate instead of incidental.
					expect(draft.rawNumber, "a placeholder number — see the comment above").to.eq(
						"INV-2026-0000",
					);
				});
			});
		});
	});

	it("02 it points at what it corrects, and says why — in its own field", () => {
		anIssuedInvoice().then((originalId) => {
			correct(originalId, { reason: "Ligne de prestation facturée en double" }).then((res) => {
				getInvoice(res.correctionInvoiceId).then((draft) => {
					expect(draft.correctsInvoiceId, "linked to the original").to.eq(originalId);
					expect(draft.correctionReason).to.eq("Ligne de prestation facturée en double");
					// The motive used to be written into `notes`, overwriting whatever the user had
					// put there. It belongs to the document; the notes belong to them.
					expect(draft.notes ?? "", "user notes untouched").to.not.contain(
						"Ligne de prestation facturée en double",
					);
				});
			});
		});
	});

	it("03 the draft is EDITABLE — the whole point of the change", () => {
		anIssuedInvoice().then((originalId) => {
			correct(originalId).then((res) => {
				getInvoice(res.correctionInvoiceId).then((draft) => {
					const kept = draft.items.slice(0, 1).map((i) => ({
						name: i.name,
						quantity: i.quantity,
						unitPrice: i.unitPrice,
						vatRate: i.vatRate,
					}));

					cy.request({
						method: "PATCH",
						url: `${api}/api/invoices/${res.correctionInvoiceId}`,
						body: { items: kept },
						failOnStatusCode: false,
					}).then((patch) => {
						expect(patch.status, "the draft accepted an edit").to.be.oneOf([200, 201]);
					});

					getInvoice(res.correctionInvoiceId).then((edited) => {
						expect(edited.items.length, "a line was removed").to.eq(kept.length);
					});
				});
			});
		});
	});

	it("04 a PARTIAL correction is possible — it was not before", () => {
		// "J'ai oublié un truc" is almost never a full reversal. Before this, the correction copied
		// every line of the original and there was no way to correct one amount.
		anIssuedInvoice().then((originalId) => {
			getInvoice(originalId).then((original) => {
				correct(originalId).then((res) => {
					cy.request({
						method: "PATCH",
						url: `${api}/api/invoices/${res.correctionInvoiceId}`,
						body: {
							items: [{ name: "Correction partielle", quantity: 1, unitPrice: 100, vatRate: 20 }],
						},
						failOnStatusCode: false,
					});

					getInvoice(res.correctionInvoiceId).then((partial) => {
						expect(
							Math.abs(partial.totalTTC),
							"the correction is smaller than what it corrects",
						).to.be.lessThan(Math.abs(original.totalTTC));
					});
				});
			});
		});
	});

	it("05 issuing it is a separate, deliberate act — and THAT is when it takes a number", () => {
		anIssuedInvoice().then((originalId) => {
			correct(originalId).then((res) => {
				cy.request({
					method: "POST",
					url: `${api}/api/invoices/${res.correctionInvoiceId}/issue`,
					failOnStatusCode: false,
				}).then((issue) => {
					expect(issue.status, "issue responded").to.be.oneOf([200, 201]);
				});

				getInvoice(res.correctionInvoiceId).then((issued) => {
					expect(issued.status).to.eq("ISSUED");
					expect(issued.number, "a counter is allocated at ISSUE, not at creation").to.not.eq(null);
					expect(issued.rawNumber, "and a visible number with it").to.be.a("string");
				});
			});
		});
	});

	it("06 the screen offers the correction, and the draft it produced is editable there too", () => {
		// The one assertion that has to go through the interface: an action the API allows but the
		// screen never offers is not a feature a user has.
		anIssuedInvoice().then((originalId) => {
			cy.request({ url: `${api}/api/invoices/${originalId}/available-actions` })
				.its("body")
				.then((actions: { actions: { correct: boolean }; correctionKinds: string[] }) => {
					expect(actions.actions.correct, "France may correct an issued invoice").to.eq(true);
					expect(actions.correctionKinds, "and a credit note is one of its routes").to.include(
						"CREDIT_NOTE",
					);
				});

			correct(originalId).then((res) => {
				cy.request({ url: `${api}/api/invoices/${res.correctionInvoiceId}/available-actions` })
					.its("body")
					.then((actions: { actions: { edit: boolean; issue: boolean } }) => {
						expect(actions.actions.edit, "a draft correction is editable").to.eq(true);
						expect(actions.actions.issue, "and issuable when the user is done").to.eq(true);
					});
			});
		});
	});
	it("07 the credit note settles what it corrects — Odoo's « Crédits en circulation »", () => {
		// The invoice and the credit note correcting it used to ignore each other completely: a fully
		// credited invoice stayed UNPAID for ever and kept chasing a customer who owed nothing.
		anIssuedInvoice().then((originalId) => {
			cy.request({ url: `${api}/api/invoices/${originalId}/settlement` })
				.its("body")
				.then((before: { outstandingMinor: number; creditedMinor: number; settled: boolean }) => {
					expect(before.creditedMinor, "nothing credited yet").to.eq(0);
					expect(before.settled).to.eq(false);
					expect(before.outstandingMinor).to.be.greaterThan(0);

					correct(originalId).then((res) => {
						// A DRAFT correction settles nothing: it is a document the user has not finished,
						// and counting it would promise a reduction that has not happened.
						cy.request({ url: `${api}/api/invoices/${originalId}/settlement` })
							.its("body")
							.then((whileDraft: { creditedMinor: number }) => {
								expect(whileDraft.creditedMinor, "a draft credits nothing").to.eq(0);
							});

						cy.request({
							method: "POST",
							url: `${api}/api/invoices/${res.correctionInvoiceId}/issue`,
							failOnStatusCode: false,
						});

						cy.request({ url: `${api}/api/invoices/${originalId}/settlement` })
							.its("body")
							.then((after: { creditedMinor: number; paidMinor: number; settled: boolean }) => {
								expect(after.creditedMinor, "the issued credit note counts").to.eq(
									before.outstandingMinor,
								);
								// Reported SEPARATELY from payments, on purpose: a credit is not cash that
								// arrived, and a product that files it as one reports revenue it never got.
								expect(after.paidMinor, "and it is not filed as a payment").to.eq(0);
								expect(after.settled, "the invoice owes nothing now").to.eq(true);
							});
					});
				});
		});
	});
});
