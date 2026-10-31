export {}; // makes this spec a module, not a global script -- see tsconfig.json
import { companyLawFor } from "../fixtures/company-law";
import { FRENCH_BUYER_IDENTIFIERS } from "../fixtures/identifiers";

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
 * route "allowed" (`countries/data/fr.json (section "correctionRoutes")`), so a free credit note is unblocked for it. The
 * "country gate" describe below switches the seller country to POLAND — the one seller country this
 * catalog already pins as CREDIT_NOTE "forbidden" (`countries/data/pl.json (section "correctionRoutes")`,
 * `correction-routes/data/all.spec.ts`'s own pinned test): Poland has no separate "nota kredytowa"
 * instrument, only the referenced faktura korygująca (art. 106j ust. 1 ustawy o VAT).
 */
const api = Cypress.env("apiUrl");

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
				contactEmail: `free-credit-${Date.now()}@example.com`,
				address: "1 Rue Quelconque",
				postalCode: "75002",
				city: "Paris",
				country: "France",
				countryCode: "FR",
				currency: "EUR",
				type: "COMPANY",
				identifiers: FRENCH_BUYER_IDENTIFIERS,
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

	it("is sent once it names a client, delivered through that client's transport", () => {
		createClient("Client Avoir Libre Envoi SARL").then((clientId) => {
			cy.request({
				method: "POST",
				url: `${api}/api/company/info`,
				body: { invoiceTransportId: "email" },
			})
				.its("status")
				.should("be.oneOf", [200, 201]);

			// Before France's e-invoicing mandate date, so the client's email transport is lawful.
			const data = freeCreditNoteData({
				client: clientId,
				issueDate: "2026-08-31",
			});
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/credit-note/actions/save-draft`,
				body: { data },
			}).then((saved) => {
				expect(saved.status, "the free credit note is created with a client").to.be.oneOf(
					[200, 201],
				);
				expect(saved.body.document.data.client, "the client is kept").to.eq(
					clientId,
				);
				const id = saved.body.document.id as string;
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/credit-note/actions/send`,
					body: { documentId: id, data: saved.body.document.data },
				})
					.its("status")
					.should("be.oneOf", [200, 201]);
				cy.waitForDocumentStatus(
					`${api}/api/documents/${id}?typeId=credit-note`,
					["sent"],
				);
			});
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
				companyLaw: companyLawFor("PL"),
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

	it("is BLOCKED for a Polish seller, naming the country and pointing to the corrective invoice - never a silent accept", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/credit-note/actions/save-draft`,
			body: { data: freeCreditNoteData() },
			failOnStatusCode: false,
		}).then((res) => {
			// 403 - countries/data/pl.json (section "policy")'s own `allowed: false` rule
			// (documents.service.ts#resolveActionPolicy) refuses this BEFORE any handler runs.
			expect(res.status, "la Pologne n'a pas d'instrument avoir séparé").to.eq(
				403,
			);
			expect(String(res.body?.message)).to.match(/forbidden for "PL"/);
			expect(String(res.body?.message)).to.match(/korygując/i);
			// The pointer to what to do instead - documents.service.ts's own
			// `appendCorrectiveInvoiceGuidance`, orchestrator follow-up.
			expect(String(res.body?.message)).to.match(/corrective invoice/i);
		});
	});

	// PR #473 review point 2 (owner decision, reversing the earlier behaviour this test used to pin -
	// see credit-note-actions.ts's own `assertCreditNoteAllowedForCountry` header for the full "why"):
	// a LINKED credit note is now ALSO refused for a Polish seller, not only the free shape. The
	// faktura korygująca (already implemented as a KOR invoice) is the only corrective instrument.
	it("ALSO blocks a LINKED credit note for the same Polish seller - not only the free shape", () => {
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
				const lines = invoiceRes.body?.document?.data?.lines as { __rowId?: string }[];

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/credit-note/actions/save-draft`,
					body: {
						data: {
							invoice: invoiceId,
							issueDate: "2026-09-10",
							currency: "EUR",
							correctedLines: lines?.[0]?.__rowId ? [lines[0].__rowId] : [],
						},
					},
					failOnStatusCode: false,
				}).then((res) => {
					// Refused by the COUNTRY GATE now, not merely a shape/currency guard - the message
					// names Poland and the corrective invoice, exactly like the free shape above.
					expect(res.status).to.eq(403);
					expect(String(res.body?.message)).to.match(/forbidden for "PL"/);
					expect(String(res.body?.message)).to.match(/korygując/i);
					expect(String(res.body?.message)).to.match(/corrective invoice/i);
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
		createClient("Client Avoir Libre Écran SARL").then(() => {
			cy.visit("/documents/credit-note");
			cy.get('[data-cy="document-create-button"]').click();
			cy.get('[data-cy="document-create-dialog"]', { timeout: 10000 }).should(
				"be.visible",
			);

			// Details: the optional "invoice" (left empty), its own client, the date, and "currency", a
			// normal editable select since no invoice locks it.
			cy.openSearchSelect("document-field-client-input");
			cy.contains(
				'[data-cy="document-field-client-input-options"] button',
				"Client Avoir Libre Écran SARL",
			).click();
			cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.get('[data-cy="document-field-currency-input"] button')
			.should("not.be.disabled")
			.click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', {
			timeout: 10000,
		}).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]')
			.first()
			.click();
		cy.continueDocumentWizard(); // Details -> Lines

		// Lines: "Corrected lines" waits for a source that is never picked; the free "Lines" table
		// carries the amount.
		cy.get('[data-cy="document-field-correctedLines-no-source"]').should(
			"be.visible",
		);
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
		// The VAT rate is a real SearchSelect (countries/data/fr.json (section "vatRates")'s own catalog) — the exact rate
		// picked is irrelevant here (only the totals engine's own arithmetic is covered by jest), so
		// the first offered option is enough to move on.
		// Targeted by its own data-cy: credit note lines also carry the "Supply type" select.
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]').first().click();
		cy.continueDocumentWizard(); // Lines -> Options

		// Options: "notes" (left empty) and "reason", REQUIRED the moment
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
			// `typeId` is not optional here: it is the only thing that carries the document TYPE into
			// the lookup, in the scope check and in the SQL alike, so a call that omits it is refused.
			cy.request(`${api}/api/documents/${savedId}?typeId=credit-note`).then((res) => {
				expect(res.status).to.eq(200);
				expect(res.body?.data?.invoice, "toujours aucune facture d'origine").to
					.be.undefined;
				expect(res.body?.data?.reason).to.contain("trop-perçu");
				expect(res.body?.data?.client, "the chosen client is kept").to.be.a(
					"string",
				);
				expect(res.body?.data?.lines).to.have.length(1);
			});
		});
		});
	});
});
