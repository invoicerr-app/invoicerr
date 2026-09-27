export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * PR #473 review point 1, round 3 - "a document stuck in sending without a number can no longer get
 * out".
 *
 * `actions/async-send.ts`'s phase-2 branch used to REFUSE (a loud `ConflictException`) an invoice/
 * quote/purchase-order reaching "sending" with `number: null` - a state that only ever existed because
 * an earlier crash landed between the "sending" status write and its numbering (before
 * `numbering/sequence.ts#takeDocumentNumberWithStatusTransition` made the two ONE atomic write - see
 * that function's own header). No OTHER action ever leaves "sending" (cancel starts from "sent"/
 * "send_failed", "save-draft" is locked outside "draft"), so that refusal left the record stuck for
 * good - a retried "send" could never recover it, unlike before this file became asynchronous, where a
 * retry always could (`deliver()`/`send-document-email.ts` numbered it at delivery time).
 *
 * Fixed: phase 2 now takes the number itself, through the same atomic path phase 1 uses
 * (`fromStatuses: ['sending']`, `toStatus: 'sending'`), then delivers - ONE retry recovers the record.
 *
 * There is no route through this app that can produce a numberless "sending" record any more (the
 * atomic write makes it structurally impossible going forward) - `cy.task("makeDocumentStuckSendingUnnumbered", ...)`
 * is the same "migration scenario, direct DB write" simulation `91-credit-note-numbering.cy.ts`'s own
 * `makeCreditNoteLegacyUnnumbered` and `96-credit-note-followup.cy.ts`'s reuse of this exact task
 * already rest on.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Recovery Co",
				contactEmail: "recovery@example.com",
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Rue de la Reprise",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "the created client has an id").to.be.a("string");
			return id;
		});
}

describe("PR #473 review point 1 (round 3) - recovering an invoice stuck in \"sending\" with no number", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('a retried "send" numbers the stuck record and delivers it - ONE retry recovers it for good', () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
		}).then((res) => expect(res.status, "transport configured").to.be.oneOf([200, 201]));

		cy.clearEmails();

		createClient().then((clientId) => {
			const invoiceData = {
				client: clientId,
				// Before 2026-09-01 on purpose: from that date France's PDP mandate binds a domestic
				// invoice and "send" over email 501s (transports/channel-policy/mandate.ts) - the same
				// date `91-credit-note-numbering.cy.ts`'s own invoice fixture picks for the same reason.
				issueDate: "2026-08-30",
				dueDate: "2026-09-30",
				currency: "EUR",
				lines: [{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: invoiceData },
			}).then((saved) => {
				const invoiceId = saved.body?.document?.id as string;
				expect(invoiceId, "draft created").to.be.a("string");
				expect(saved.body?.document?.displayNumber, "a draft carries no number").to.be.oneOf([
					null,
					undefined,
				]);

				// Simulates the EXACT failure this fix closes: a crash between the "sending" status
				// write and its numbering, on a record that has NEVER been through a real "send" call
				// yet - the same stranded state review point 1 names, produced directly at the DB layer
				// since no route through this app can produce it through the API any more.
				cy.task("makeDocumentStuckSendingUnnumbered", { documentId: invoiceId, typeId: "invoice" }).then(
					() => {
						cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
							.its("body")
							.then((stuck) => {
								expect(stuck.status, "forced into the stranded state").to.eq("sending");
								expect(stuck.number, "no number yet").to.be.null;
							});

						// THE RETRY - the exact same "send" call a user or the worker would make on this
						// record. This USED to throw a ConflictException here; it must now recover it.
						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/send`,
							body: { documentId: invoiceId, data: invoiceData },
						}).then((retry) => {
							expect(retry.status, "the retry is accepted, never refused").to.be.oneOf([200, 201]);
						});

						cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]);

						cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
							.its("body")
							.then((after) => {
								expect(after.status, "delivered - ONE retry recovered it").to.eq("sent");
								expect(after.displayNumber, "numbered on the retry itself").to.eq(
									"INVOICE-2026-0001",
								);
							});

						// Delivered for real - the email actually reached Mailpit, proving the recovery
						// went all the way through `deliver()`, not just the status/number write.
						cy.getLastEmail().then((email) => {
							expect(email.To?.[0]?.Address, "delivered to the client's own address").to.eq(
								"recovery@example.com",
							);
						});
					},
				);
			});
		});
	});
});
