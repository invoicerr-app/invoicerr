export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Multi-milestone installment billing — from a SENT quote, the
 * `request-installments` action generates N draft invoices (one per milestone), whose gross-total
 * SUM equals EXACTLY the quote's own gross total, split according to each milestone's own PERCENT —
 * never merely as many equal shares as there are milestones. The split's OWN arithmetic (which axis
 * is made exact, who carries the remainder; refusal on mixed VAT rates) is covered/bitten in jest
 * (`actions/request-installments.spec.ts`); here we prove the real journey through the SCREEN (the
 * action's own params dialog, `ArrayField` — the exact same component a document's own "lines" field
 * already uses).
 *
 * The quote's amount is deliberately one that does NOT divide evenly: 1000.03 net at 20% carries
 * 200.01 of VAT (round(200.006)), and neither its net nor its gross is divisible by 30/40/30 without
 * a remainder. A round 1000.00 quote would sum correctly however the split rounded, and would
 * therefore prove nothing about the cent. Expected gross totals: 360.01/480.02/360.01, i.e. EXACTLY
 * 36001/48002/36001 minor — not merely three amounts that happen to sum to the quote's own total (a
 * 40/40/40 split, with every percent silently ignored, would pass a sum-only check identically).
 *
 * All three milestones share the SAME due date ("today", via `cy.pickToday`) — nothing in
 * `request-installments.ts` requires them distinct or ordered, and "today" is reachable without
 * navigating the calendar's month/year dropdowns to an arbitrary future date.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";
// Quote: 1000.03 net @ 20% → VAT 20001, gross 120004 minor. 30/40/30 → 36001/48002/36001 = 120004.
const QUOTE_GROSS_MINOR = 120004;

describe("Installment billing — N invoices whose sum equals the quote's own gross total", () => {
	let clientEmail: string;

	before(() => {
		cy.resetAndSeed();
		cy.login();
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
		}).then((res) => expect(res.status).to.be.oneOf([200, 201]));
	});
	beforeEach(() => {
		cy.login();
	});

	it("a quote with 3 milestones 30/40/30 generates 3 draft invoices, sum of gross totals = the quote's own gross total", () => {
		clientEmail = "installments-client@example.com";
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Installments Client SARL",
				contactEmail: clientEmail,
				currency: "EUR",
				country: "FR",
				address: "1 Rue de l'Échéance",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		})
			.its("body.id")
			.then((clientId: string) => {
				const quoteData = {
					client: clientId,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [
						{ description: "Prestation", quantity: 1, unit: "day", unitPrice: 1000.03, vatRate: "20" },
					],
				};
				// Quote → draft → send (the installment-schedule action requires 'sent').
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: { data: quoteData },
				}).then((saved) => {
					const quoteId = saved.body?.document?.id as string;
					expect(quoteId, "devis créé").to.be.a("string");

					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/send`,
						body: { documentId: quoteId, data: quoteData, params: { recipient: clientEmail } },
					}).then((sent) => expect(sent.status).to.be.oneOf([200, 201]));
					cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, ["sent"]);

					// The installment schedule: 30/40/30 — driven through the SCREEN's own action-params
					// dialog (`action-params-dialog.tsx`, the exact same `DocumentField`/`ArrayField`
					// components a document's own "lines" field already uses), never a raw `cy.request`:
					// this action is exposed exactly there, on the quote's list row. All three due dates
					// are "today" — nothing in `request-installments.ts` requires them distinct or
					// ordered (each milestone's own `percent` is the only thing under test here), and
					// "today" is the one date a `cy.pickToday` click reaches without navigating the
					// calendar's month/year dropdowns to an arbitrary future date.
					cy.visit("/documents/quote");
					cy.runDocumentRowAction(quoteId, "request-installments");
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should(
						"be.visible",
					);

					const milestones = [30, 40, 30];
					milestones.forEach((_, index) => {
						cy.get('[data-cy="document-field-milestones-add-row"]').click();
						cy.get(`[data-cy="document-field-milestones-row-${index}"]`).should("exist");
					});
					milestones.forEach((percent, index) => {
						cy.get(`[name="milestones.${index}.percent"]`)
							.clear({ force: true })
							.type(String(percent), { force: true });
						cy.pickToday(
							`[data-cy="document-field-milestones-row-${index}"] [data-cy="document-field-dueDate-input"]`,
						);
					});

					cy.get('[data-cy="document-action-params-confirm"]').click();
					cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("not.exist");

					// The 3 invoices generated from THIS quote (via data.origin.id).
					cy.request({ url: `${api}/api/documents?typeId=invoice` })
						.its("body")
						.then((body) => {
							// GET /api/documents is now a paged `{ items, total, page, pageSize }` — never a
							// bare array (documents.controller.ts's own "List document instances").
							const invoices = (Array.isArray(body) ? body : (body.items ?? [])) as {
								id: string;
								data: { origin?: { id?: string }; dueDate?: string };
							}[];
							const mine = invoices.filter((d) => d.data?.origin?.id === quoteId);
							expect(mine, "3 factures d'échéance créées").to.have.length(3);

							// Sum AND repartition of gross totals. The sum is read off each INVOICE's own
							// totals endpoint, i.e. the amount actually being asked of the client — the
							// only place a cent lost between the split and the invoice's recomputed VAT
							// can show up. And the repartition matters because the sum alone would pass
							// just as well for an (ignored-percentages) 40/40/40 split: 1000.03 net @ 20%
							// = 1200.04 gross TTC, so 30 % → 360.01 (36001 minor) and 40 % → 480.02
							// (48002 minor).
							const ids = mine.map((d) => d.id);
							const grosses: number[] = [];
							cy.wrap(ids).each((id) => {
								cy.request({ url: `${api}/api/documents/${id}/totals?typeId=invoice` })
									.its("body.grossMinor")
									.then((g: number) => grosses.push(g));
							});
							cy.then(() => {
								const sum = grosses.reduce((a, b) => a + b, 0);
								expect(sum, "somme des bruts = TTC du devis").to.eq(QUOTE_GROSS_MINOR);
								expect(
									[...grosses].sort((a, b) => a - b),
									"répartition 30/40/30 — jamais 40/40/40, qui donnerait la même somme",
								).to.deep.eq([36001, 36001, 48002]);
							});
						});
				});
			});
	});
});
