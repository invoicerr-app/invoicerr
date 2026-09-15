export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The "Declarations" screen (TODO_FEATURES.md rank 10) — makes visible what
 * `reporting/report-on-send.ts` already does silently after every "send". Since the five-country
 * pivot only Portugal ("pt-at") has a declaration provider at all (status:
 * implemented-awaiting-accreditation — `reporting/providers/pt-declaration-provider.ts`'s own
 * header), this spec proves the screen is honest in BOTH directions:
 *  - a French seller (the default seed) has NO reporting obligation at all — the empty state says so
 *    plainly, never a permanently-empty table that looks like a loading bug;
 *  - a Portuguese seller with NO "pt-at" credentials configured produces a REAL, journaled
 *    `report:blocked` declaration the moment an invoice is sent — proven through a REAL click on
 *    "Send", never a direct call to the reporting mechanism. The real AT webservice is NEVER called:
 *    `ChannelCredentialsService.resolveActive` returns nothing for an unconfigured "pt-at" channel,
 *    so `pt-declaration-provider.ts` throws `ChannelNotConnectedError` BEFORE any HTTP call to
 *    Portugal's AT is ever attempted (see that file's own `declare()`) — this is the one declaration
 *    outcome this suite can reach honestly, without live AT credentials (compare
 *    `providers/pt-declaration-provider.live.spec.ts`, gated, for the real round trip).
 *
 * Actions go through the screen (the sidebar link, the real "Send" click); the assertions that matter
 * read back the API — same discipline as 28/31/39/44.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

/**
 * The report job runs asynchronously on the SAME queue "send" itself does (`report-job.ts`'s own
 * header) — there is no synchronous signal a plain `cy.request` can wait on, so this polls the new
 * `GET /api/documents/declarations` endpoint until a row for `documentId` appears. Same ~10s budget
 * (20 * 500ms) as `waitForDocumentStatus`/`getLastEmail` in `support/commands.ts`.
 */
function pollForDeclaration(documentId: string, attemptsLeft = 20): Cypress.Chainable<any> {
	return cy.request({ url: `${api}/api/documents/declarations`, failOnStatusCode: false }).then((res) => {
		const declarations = res.body?.declarations ?? [];
		const found = declarations.find((d: any) => d.documentId === documentId);
		if (!found && attemptsLeft > 0) {
			cy.wait(500);
			return pollForDeclaration(documentId, attemptsLeft - 1);
		}
		expect(found, "une déclaration a fini par être journalisée pour ce document").to.exist;
		return cy.wrap(found);
	});
}

function createPortugueseClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Lisboa Consultoria Lda",
				contactEmail: "cliente.pt@example.com",
				address: "Avenida da Liberdade 110",
				postalCode: "1250-096",
				city: "Lisboa",
				country: "Portugal",
				countryCode: "PT",
				currency: "EUR",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "501442600" }],
			},
		})
		.then((res) => {
			expect(res.status, "client portugais créé par API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "le client créé a un identifiant").to.be.a("string");
			return id as string;
		});
}

function createPortugueseInvoiceDraft(clientId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate: "2026-09-14",
					dueDate: "2026-10-14",
					currency: "EUR",
					lines: [
						{
							description: "Consultoria",
							quantity: 1,
							unit: "day",
							// Portugal's own standard rate (CIVA art. 18.º n.º 1 alínea c) — see
							// vat-rates/data/pt.json), a domestic PT-to-PT sale to keep this spec clear of the
							// cross-border tax engine entirely — the ONLY thing under test here is the
							// declarative-reporting mechanism, never the tax treatment.
							unitPrice: 500,
							vatRate: "23",
						},
					],
				},
			},
			failOnStatusCode: false,
		})
		.then((saved) => {
			expect(saved.status, "brouillon de facture portugaise créé").to.be.oneOf([200, 201]);
			const id = saved.body?.document?.id as string;
			expect(id, "le brouillon a un identifiant").to.be.a("string");
			return id as string;
		});
}

describe("Declarations — a country with no reporting obligation says so plainly", () => {
	before(() => {
		cy.resetAndSeed(); // the default seeded company is French — no reporting/data/fr.json file exists.
	});

	beforeEach(() => {
		cy.login();
	});

	it("the sidebar leads to the Declarations screen, which shows the no-obligation empty state for a French company", () => {
		cy.visit("/dashboard");
		cy.get('[data-cy="sidebar-declarations-link"]', { timeout: 15000 }).click();
		cy.url().should("include", "/declarations");

		cy.get('[data-cy="declarations-no-obligation"]', { timeout: 15000 }).should(
			"contain.text",
			"no declaration obligation",
		);
		cy.get('[data-cy="declarations-table"]').should("not.exist");

		// PROOF that matters: the API itself says so, not just the screen's own copy.
		cy.request({ url: `${api}/api/documents/declarations` })
			.its("body")
			.then((body) => {
				expect(body.hasObligation, "la France n'a aucune obligation de déclaration aujourd'hui").to.eq(
					false,
				);
				expect(body.declarations, "aucune déclaration pour cette société").to.deep.equal([]);
				expect(body.pageCount).to.eq(0);
			});
	});
});

describe("Declarations — a Portuguese seller's blocked pt-at declaration is journaled and shown", () => {
	before(() => {
		cy.resetAndSeed();

		// Switches the seller country to Portugal — same "mutate the seeded company, never create a
		// second one" convention `44-country-policy.cy.ts`'s own `before()` already established for
		// Poland. "pt-at" is left DELIBERATELY unconnected (no channel credentials configured anywhere
		// in this suite) — that is the whole point of this scenario: a blocked declaration, never a
		// real AT round trip.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: {
				name: "Acme Corp",
				country: "Portugal",
				countryCode: "PT",
				invoiceTransportId: "email",
				identifiers: [
					{ scheme: "LEGAL_ID", value: "509442661" },
					{ scheme: "VAT", value: "PT509442661" },
				],
			},
		}).then((res) => {
			expect(res.status, "société bascule au Portugal").to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it('sending a Portuguese invoice by email through a REAL click on "Send" journals a report:blocked declaration — never a silent gap', () => {
		cy.clearEmails();

		createPortugueseClient().then((clientId) => {
			createPortugueseInvoiceDraft(clientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				// A real click — never a direct call to the action (same discipline as 39/44).
				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();

				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Sent");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, "la facture portugaise est réellement \"sent\" en base").to.eq("sent");
					});

				// PROOF 1 — the API: a "pt-at" declaration was journaled, blocked, with a real reason —
				// never invisible the way a pre-existing declaration failure used to be.
				pollForDeclaration(invoiceId).then((declaration) => {
					expect(declaration.providerId, "le fournisseur portugais 'pt-at'").to.eq("pt-at");
					expect(declaration.countryCode, "rattachée au Portugal").to.eq("PT");
					expect(declaration.statusCode, "bloquée — aucun identifiant AT configuré").to.eq(
						"report:blocked",
					);
					expect(declaration.reason, "une raison humaine, jamais vide").to.be.a("string").and.not.be
						.empty;
					expect(declaration.typeId).to.eq("invoice");
					expect(declaration.displayNumber, "la facture porte un numéro").to.be.a("string");
				});

				// PROOF 2 — the screen: the SAME fact, rendered, reachable from the sidebar without a
				// direct URL guess.
				cy.visit("/dashboard");
				cy.get('[data-cy="sidebar-declarations-link"]').click();
				cy.url().should("include", "/declarations");

				cy.get('[data-cy="declarations-table"]', { timeout: 20000 }).should("be.visible");
				cy.contains('[data-cy^="declaration-row-"]', "PT", { timeout: 20000 })
					.should("be.visible")
					.within(() => {
						cy.get('[data-cy="declaration-status-badge"]').should("contain.text", "Blocked");
						cy.get('[data-cy="declaration-error"]').should("not.contain.text", "-");
					});

				// The status FILTER's own logic is proven at the API directly (assertions-through-the-API,
				// the same discipline this whole suite holds) — never by automating the shadcn/Radix
				// combobox's portal-rendered options, which this spec does not attempt.
				cy.request({ url: `${api}/api/documents/declarations?status=report:blocked` })
					.its("body.declarations")
					.should("have.length", 1);
				cy.request({ url: `${api}/api/documents/declarations?status=ACCEPTED` })
					.its("body.declarations")
					.should("deep.equal", []);
			});
		});
	});
});
