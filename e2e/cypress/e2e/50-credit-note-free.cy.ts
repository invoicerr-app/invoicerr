export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The FREE credit note: no `invoice` field at all — a commercial gesture, a refund of
 * an overpayment nobody ever tied to one invoice line, nothing to "correct". See
 * `backend/src/modules/documents/descriptors/credit-note.descriptor.ts`'s own "Two shapes, one type"
 * header and `credit-note-actions.ts`'s own guards (`assertCreditNoteAmountSourceIsUnambiguous`,
 * `assertFreeCreditNoteAllowedForCountry`).
 *
 * Same split `43-correction-routes.cy.ts`/`44-country-policy.cy.ts` already hold: API level first
 * (fast, exhaustive over every guard and the per-country gate, against the REAL server — never a
 * mock), then ONE screen-level test proving the real wizard a user would actually click through.
 *
 * The default company (`cy.resetAndSeed()`) is a FRENCH company — France keeps its own CREDIT_NOTE
 * route "allowed" (`correction-routes/data/fr.json`), so a free credit note is unblocked for it. The
 * "country gate" describe below switches the seller country to POLAND — the one seller country this
 * catalog already pins as CREDIT_NOTE "forbidden" (`correction-routes/data/pl.json`,
 * `correction-routes/data/all.spec.ts`'s own pinned test): Poland has no separate "nota kredytowa"
 * instrument, only the referenced faktura korygująca (art. 106j ust. 1 ustawy o VAT).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function freeCreditNoteData(overrides: Record<string, unknown> = {}) {
	return {
		issueDate: "2026-09-10",
		currency: "EUR",
		reason:
			"Geste commercial — remboursement d'un trop-perçu non rattaché à une facture.",
		lines: [
			{
				description: "Remboursement",
				quantity: 1,
				unitPrice: 42,
				vatRate: "0",
			},
		],
		...overrides,
	};
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

describe("Free credit note (API) — no invoice to correct, France (open CREDIT_NOTE route)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("is created with no invoice, a reason, and free lines — the reason survives, no invoice reference at all", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: { data: freeCreditNoteData() },
		}).then((res) => {
			expect(res.status, "l'avoir libre se crée").to.be.oneOf([200, 201]);
			const doc = res.body?.document;
			expect(doc?.data?.invoice, "pas de facture d'origine").to.be.undefined;
			expect(doc?.data?.reason, "le motif est conservé").to.contain(
				"trop-perçu",
			);
		});
	});

	it('refuses a free credit note with no "reason" — 400, the descriptor\'s own requiredIfAbsent', () => {
		const data = freeCreditNoteData();
		delete (data as Record<string, unknown>).reason;

		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: { data },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "motif obligatoire sans facture d'origine").to.eq(400);
			expect(JSON.stringify(res.body)).to.match(/Reason/i);
		});
	});

	it('refuses a free credit note with no "lines" at all — nothing to credit', () => {
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: { data: freeCreditNoteData({ lines: [] }) },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "aucune ligne libre, rien à créditer").to.eq(400);
			expect(JSON.stringify(res.body)).to.match(/at least one line/i);
		});
	});

	it("refuses BOTH an invoice AND free lines together — never two disagreeing sources of the same amount", () => {
		createClient("Client Avoir Libre SARL").then((clientId) => {
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: {
					data: {
						client: clientId,
						issueDate: "2026-09-10",
						dueDate: "2026-10-10",
						currency: "EUR",
						lines: [
							{
								description: "Article",
								quantity: 1,
								unit: "unit",
								unitPrice: 10,
								vatRate: "0",
							},
						],
					},
				},
			}).then((invoiceRes) => {
				expect(invoiceRes.status).to.be.oneOf([200, 201]);
				const invoiceId = invoiceRes.body?.document?.id as string;
				expect(invoiceId, "la facture créée a un identifiant").to.be.a(
					"string",
				);

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/credit-note/actions/save-draft`,
					body: {
						data: freeCreditNoteData({
							invoice: invoiceId,
							correctedLines: [],
						}),
					},
					failOnStatusCode: false,
				}).then((res) => {
					expect(res.status, "invoice + lines à la fois, refusé").to.eq(400);
					expect(JSON.stringify(res.body)).to.match(/never both at once/i);
				});
			});
		});
	});
});

describe("Free credit note (API) — the country gate: Poland has no separate credit-note instrument", () => {
	before(() => {
		cy.resetAndSeed();
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: {
				name: "Sklep Testowy",
				country: "Poland",
				countryCode: "PL",
				invoiceTransportId: "email",
			},
		}).then((res) => {
			expect(res.status, "pays vendeur réglé sur la Pologne").to.be.oneOf([
				200, 201,
			]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it("is BLOCKED for a Polish seller, naming the country and the catalog's own citation — never a silent accept", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: { data: freeCreditNoteData() },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "la Pologne n'a pas d'instrument avoir séparé").to.eq(
				400,
			);
			expect(JSON.stringify(res.body)).to.match(
				/PL requires this credit note to reference/,
			);
		});
	});

	it("does NOT block a LINKED credit note for the same Polish seller — the gate only ever looks at FREE ones", () => {
		createClient("Klient Powiązany Sp. z o.o.").then((clientId) => {
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: {
					data: {
						client: clientId,
						issueDate: "2026-09-10",
						dueDate: "2026-10-10",
						currency: "EUR",
						lines: [
							{
								description: "Usługa",
								quantity: 1,
								unit: "unit",
								unitPrice: 10,
								vatRate: "23",
							},
						],
					},
				},
			}).then((invoiceRes) => {
				expect(invoiceRes.status).to.be.oneOf([200, 201]);
				const invoiceId = invoiceRes.body?.document?.id as string;

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/credit-note/actions/save-draft`,
					body: {
						data: {
							invoice: invoiceId,
							issueDate: "2026-09-10",
							currency: "EUR",
							correctedLines: [],
						},
					},
					failOnStatusCode: false,
				}).then((res) => {
					// Still refused — but for the ORDINARY "needs at least one corrected line" reason
					// (correctedLines is empty here), never the country gate: the 400 message must NOT
					// mention Poland/the country at all, proving the gate itself let this linked attempt
					// through before the generic "at least one" check took over.
					expect(res.status).to.eq(400);
					expect(JSON.stringify(res.body)).to.match(
						/at least one corrected line/i,
					);
					expect(JSON.stringify(res.body)).to.not.match(
						/PL requires this credit note/,
					);
				});
			});
		});
	});
});

describe("Free credit note — the screen, browser level", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('is created from the credit-note list\'s own "New" button — wizard-driven, no invoice ever picked', () => {
		cy.visit("/documents/credit-note");
		cy.get('[data-cy="document-create-button"]').click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 10000 }).should(
			"be.visible",
		);

		// Details: only "issueDate" — the one field this descriptor still requires
		// unconditionally that stays there. "invoice" is optional now (credit-note.descriptor.ts's own
		// "Two shapes, one type") and moved to "Lines" (it feeds "correctedLines"' own `sourceField`);
		// "currency" FOLLOWS it onto that same step too, since its own `lockedFromReference` lock would
		// otherwise never re-apply once "invoice" resolves on a step it isn't even mounted on
		// (document-create-dialog.tsx's own `buildFieldGroups`, see that function's own header).
		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.continueDocumentWizard(); // Details -> Lines

		// Lines: "Corrected lines" (rowSelection) shows its own "pick a source first" placeholder —
		// never touched, since no invoice was ever picked. "currency" is a normal, editable, empty
		// select here too (the lock only engages once an invoice actually resolves — never touched in
		// this FREE flow). "Lines" (the FREE table) is what actually carries this credit note's own
		// amount.
		cy.get('[data-cy="document-field-correctedLines-no-source"]').should(
			"be.visible",
		);
		cy.get('[data-cy="document-field-currency-input"] button')
			.should("not.be.disabled")
			.click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', {
			timeout: 10000,
		}).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]')
			.first()
			.click();
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').type("Geste commercial", {
			force: true,
		});
		cy.get('input[name="lines.0.quantity"]')
			.clear({ force: true })
			.type("1", { force: true });
		cy.get('input[name="lines.0.unitPrice"]')
			.clear({ force: true })
			.type("42", { force: true });
		// The VAT rate is a real SearchSelect (vat-rates/data/fr.json's own catalog) — the exact rate
		// picked is irrelevant here (only the totals engine's own arithmetic is covered by jest), so
		// the first offered option is enough to move on.
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy$="-input"] button')
			.last()
			.click({ force: true });
		cy.get('[data-cy$="-input-options"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy*="-option-"]').first().click();
		cy.continueDocumentWizard(); // Lines -> Options

		// Options: "invoice" (never picked), "notes" (left empty), and "reason" — REQUIRED, the moment
		// there is no invoice to correct (the same asterisk convention `43-correction-routes.cy.ts`'s
		// own Polish "correctionReason" test already proves for the sibling `requiredIfPresent` hint).
		cy.get('[data-cy="document-field-reason"]').should("contain.text", "*");
		cy.get('[data-cy="document-field-reason-input"]').type(
			"Remboursement d'un trop-perçu non rattaché à une facture.",
			{ force: true },
		);
		cy.continueDocumentWizard(); // Options -> Recap

		cy.intercept(
			"POST",
			`${api}/api/documents/types/credit-note/actions/save-draft`,
		).as("saveFreeCreditNote");
		cy.get('[data-cy="document-action-save-draft"]').scrollIntoView().click();
		cy.wait("@saveFreeCreditNote").then((interception) => {
			expect(
				interception.response?.statusCode,
				"l'avoir libre se crée depuis l'écran",
			).to.be.oneOf([200, 201]);
			const savedId = interception.response?.body?.document?.id as string;
			expect(savedId, "l'avoir créé a un identifiant").to.be.a("string");

			// Assertion via l'API, jamais via l'écran seul — même discipline que le reste de la suite.
			cy.request(`${api}/api/documents/${savedId}`).then((res) => {
				expect(res.status).to.eq(200);
				expect(res.body?.data?.invoice, "toujours aucune facture d'origine").to
					.be.undefined;
				expect(res.body?.data?.reason).to.contain("trop-perçu");
				expect(res.body?.data?.lines).to.have.length(1);
			});
		});
	});
});
