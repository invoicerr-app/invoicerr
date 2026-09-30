export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #558 - Algeria (DZ) added as a country, data only.
 *
 * Two journeys, both against a brand-new Algerian company created through the real onboarding
 * wizard (never seeded through the API): the company is named, its country set to Algeria, and its
 * four country-specific identifiers (AI, NIF, NIS, RC - country-identifiers/data/dz.json) are filled
 * by hand, exactly as a self-hoster would.
 *
 *  a) a normal-regime invoice (19 % VAT, CTCA art. 21) and an IFU invoice (VAT suppressed via the
 *     company's own "VAT exempt" toggle - see tax/tax-systems/data/dz.json's own notes on why this
 *     approximation, not a real IFU regime, is what this product can express today) are each sent by
 *     a real click, numbered "INVOICE-<year>-<seq>" (country-policy/data/dz.json's own number
 *     format), and their resolved totals/PDF text are checked;
 *  b) issue #558's own schema addition, `country-policy/schema.ts#DomesticInvoiceCurrencyFact`:
 *     Algeria requires a domestic invoice (seller AND buyer both established there) to be issued in
 *     DZD (Banque d'Algerie reglement n. 07-01, art. 5). An invoice priced in EUR for a domestic
 *     Algerian client is refused at "send", before any number is spent, with a toast naming the
 *     required currency and the source - never silently taxed or converted.
 */
const api = Cypress.env("apiUrl");
const YEAR = new Date().getFullYear();

/**
 * Creates a brand-new Algerian company through the real onboarding wizard (country picker ->
 * identifier/lookup step -> business details, including the four country-specific identifiers ->
 * finish), the same dialog 18-onboarding-wizard.cy.ts already exercises for France. Leaves the new
 * company active (onboarding switches to it on "Finish" - confirmed via the API call right after).
 *
 * The four identifier inputs (AI, NIF, NIS, RC) carry no dedicated `data-cy` beyond VAT/LEGAL_ID
 * (see country-identifiers/schema.ts's own IdentifierSchemeFact and onboarding.tsx's generic
 * `requiredIdentifiers.map` loop) - they are found by their own `placeholder`, which is the exact
 * `label` each carries in country-identifiers/data/dz.json.
 */
function onboardAlgerianCompany() {
	cy.visit("/dashboard");
	cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).click();
	cy.get('[data-cy="sidebar-create-company-item"]').click();
	cy.get('[data-cy="onboarding-dialog"]', { timeout: 10000 }).should("be.visible");

	cy.selectCountry("onboarding-company-country-input", "Algeria");
	cy.get('[data-cy="onboarding-country-next-btn"]').click();

	// No register API for Algeria (company-lookup/registry.ts) - the generic "no automatic search"
	// note (transports/channel-policy/data/dz.json's own sibling finding) confirms the same negative
	// result this issue's own research pass reached for e-invoicing.
	cy.get('[data-cy="onboarding-identifier-no-lookup-note"]', { timeout: 10000 }).should("exist");
	cy.get('[data-cy="onboarding-legalid-input"]', { timeout: 10000 })
		.clear({ force: true })
		.type("16/00-1234567B25", { force: true });
	cy.get('[data-cy="onboarding-identifier-next-btn"]').click();

	cy.get('[data-cy="onboarding-company-name-input"]', { timeout: 10000 })
		.clear({ force: true })
		.type("Atelier Alger Design", { force: true });
	cy.get('[data-cy="onboarding-company-address-input"]').type("12 Rue Didouche Mourad", { force: true });
	cy.get('[data-cy="onboarding-company-postalcode-input"]').type("16000", { force: true });
	cy.get('[data-cy="onboarding-company-city-input"]').type("Alger", { force: true });

	// The four country-specific identifiers - decree 05-468 art. 3 for AI/NIF (RC/NIS, both legal),
	// the native contributor's own practice answer on issue #558 (2026-09-30) for AI/NIF (unverified).
	cy.get('input[placeholder="AI (Article d\'Imposition)"]', { timeout: 10000 }).type("16/2026", { force: true });
	cy.get('input[placeholder="NIF (Numero d\'Identification Fiscale)"]').type("000116000123456", { force: true });
	cy.get('input[placeholder="NIS (Numero d\'Identification Statistique)"]').type("16000123456789", {
		force: true,
	});
	cy.get('input[placeholder="RC (Registre du Commerce)"]').type("16/00-1234567B25", { force: true });

	cy.get('[data-cy="onboarding-submit-btn"]').click();
	// Algeria has no channel mandate (transports/channel-policy/data/dz.json's own empty `facts`) -
	// the wizard's "Channels" step offers nothing to connect and "Finish" closes it regardless, the
	// same as every other country with no mandate.
	cy.get('[data-cy="onboarding-finish-btn"]', { timeout: 10000 }).click();
	cy.get('[data-cy="onboarding-dialog"]', { timeout: 20000 }).should("not.exist");
	cy.wait(1000);

	cy.request(`${api}/api/company/info`)
		.its("body")
		.then((company) => {
			expect(company.countryCode, "onboarding switched the active company to the new one").to.eq("DZ");
			// LEGAL_ID also lands here: the wizard's identifier step (onboarding-legalid-input) always
			// stores its own value under that scheme, even for a country like Algeria that declares no
			// LEGAL_ID scheme of its own (country-identifiers/data/dz.json has none - RC plays that
			// role) - a generic onboarding mechanic, not an Algeria-specific fact this spec is about.
			expect(
				company.partyIdentifiers.map((i: { scheme: string }) => i.scheme).sort(),
				"the four Algerian identifiers filled by hand in the onboarding wizard",
			).to.deep.eq(["AI", "LEGAL_ID", "NIF", "NIS", "RC"]);
		});

	// "send" needs a configured transport (invoice-actions.ts) - not itself this issue's subject, set
	// through the API the same way 20-document-totals.cy.ts's own VAT-exempt describe block does.
	cy.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: "email" } })
		.its("status")
		.should("be.oneOf", [200, 201]);
}

/** A client established in Algeria too - every fact below only ever fires for a DOMESTIC operation. */
function createAlgerianClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Cafe des Arts Alger",
				contactEmail: "karim.hamdi@cafedesarts.dz",
				address: "5 Boulevard Zighout Youcef",
				postalCode: "16000",
				city: "Alger",
				country: "Algeria",
				countryCode: "DZ",
				currency: "DZD",
				isActive: true,
				type: "COMPANY",
				identifiers: [
					{ scheme: "AI", value: "16/2018" },
					{ scheme: "NIF", value: "000116000987654" },
					{ scheme: "NIS", value: "16000987654321" },
					{ scheme: "RC", value: "16/00-7654321B18" },
				],
			},
		})
		.then((res) => {
			expect(res.status, "Algerian client created").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

function saveInvoiceDraft(clientId: string, currency: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate: `${YEAR}-09-30`,
					dueDate: `${YEAR}-10-30`,
					currency,
					lines: [{ description: "Graphic design services", quantity: 1, unit: "unit", unitPrice: 50000, vatRate: "19" }],
				},
			},
		})
		.then((saved) => {
			expect(saved.status, "invoice draft saved").to.be.oneOf([200, 201]);
			return saved.body.document.id as string;
		});
}

function invoicePdfText(id: string): Cypress.Chainable<string> {
	return cy.request({ url: `${api}/api/documents/${id}/pdf?typeId=invoice`, encoding: "binary" }).then((res) => {
		expect(res.status, "invoice PDF rendered").to.eq(200);
		const base64 = Cypress.Buffer.from(res.body, "binary").toString("base64");
		return cy.task("extractPdfText", base64).then((raw) => String(raw).replace(/\s+/g, " "));
	});
}

describe("Issue #558 - Algeria (DZ): onboarding, identifiers, normal + IFU invoices", () => {
	beforeEach(() => {
		cy.resetAndSeed();
		cy.login();
		onboardAlgerianCompany();
	});

	it("a normal-regime invoice (19 % VAT) and an IFU invoice (VAT suppressed) are both sent by a real click, numbered INVOICE-<year>-<seq>", () => {
		createAlgerianClient().then((clientId) => {
			// -- Normal regime: 19 % VAT actually charged and printed. --
			saveInvoiceDraft(clientId, "DZD").then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.runDocumentRowAction(invoiceId, "send");

				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Sent");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status).to.eq("sent");
						expect(doc.displayNumber, "Algeria's own number format").to.match(
							new RegExp(`^INVOICE-${YEAR}-\\d{4}$`),
						);
					});

				cy.request({ url: `${api}/api/documents/${invoiceId}/totals?typeId=invoice` })
					.its("body")
					.then((totals) => {
						expect(totals.currency).to.eq("DZD");
						expect(totals.grossMinor, "50000 net + 19% VAT = 59500.00 DZD").to.eq(5950000);
					});

				invoicePdfText(invoiceId).then((text) => {
					expect(text, "the 19% rate is printed").to.match(/VAT 19% on 50000\.00/);
					expect(text).to.contain("59500.00 DZD");
				});

				// -- IFU: VAT suppressed by the company-level "VAT exempt" toggle (tax/load-and-resolve.ts
				// maps Company.exemptVat -> taxScheme: 'FRANCHISE_BASE', overriding the line's own raw
				// vatRate at resolve time - see this file's own header for why this is an approximation,
				// not a real IFU regime, and tax/tax-systems/data/dz.json's own notes for the schema gap. --
				cy.request({ method: "POST", url: `${api}/api/company/info`, body: { exemptVat: true } })
					.its("status")
					.should("be.oneOf", [200, 201]);

				saveInvoiceDraft(clientId, "DZD").then((ifuInvoiceId) => {
					cy.visit("/documents/invoice");
					cy.get(`[data-cy="document-list-row-${ifuInvoiceId}"]`, { timeout: 15000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Draft");

					cy.runDocumentRowAction(ifuInvoiceId, "send");

					cy.get(`[data-cy="document-list-row-${ifuInvoiceId}"]`, { timeout: 20000 })
						.find('[data-cy="document-status-badge"]')
						.should("contain.text", "Sent");

					cy.request({ url: `${api}/api/documents/${ifuInvoiceId}?typeId=invoice` })
						.its("body")
						.then((doc) => {
							expect(doc.status).to.eq("sent");
							expect(doc.displayNumber).to.match(new RegExp(`^INVOICE-${YEAR}-\\d{4}$`));
						});

					cy.request({ url: `${api}/api/documents/${ifuInvoiceId}/totals?typeId=invoice` })
						.its("body")
						.then((totals) => {
							expect(totals.currency).to.eq("DZD");
							expect(totals.grossMinor, "no VAT charged: gross == net == 50000.00 DZD").to.eq(5000000);
						});

					invoicePdfText(ifuInvoiceId).then((text) => {
						expect(text, "no VAT line printed, an exemption note instead").to.not.match(/VAT \d+%/);
						expect(text).to.match(/exempt/i);
						expect(text).to.contain("50000.00 DZD");
					});
				});
			});
		});
	});
});

describe("Issue #558 - Algeria (DZ): the domestic-currency block", () => {
	beforeEach(() => {
		cy.resetAndSeed();
		cy.login();
		onboardAlgerianCompany();
	});

	it("a domestic DZ invoice priced in EUR is refused at send, before any number is spent, naming DZD and the source", () => {
		createAlgerianClient().then((clientId) => {
			saveInvoiceDraft(clientId, "EUR").then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.runDocumentRowAction(invoiceId, "send");

				// The preflight blocks SYNCHRONOUSLY (country-policy/domestic-currency-issuance.ts), the
				// same discipline 32-channel-mandate.cy.ts's own PDP-mandate block already proves for a
				// different fact - a visible toast says so right away, naming the required currency and
				// quoting the Banque d'Algerie regulation itself.
				cy.get('[data-sonner-toast]', { timeout: 10000 })
					.should("contain.text", "DZD")
					.and("contain.text", "dinars algeriens");

				cy.get(`[data-cy="document-list-row-${invoiceId}"]`)
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, 'never persisted beyond "draft" - blocked before any write').to.eq("draft");
						expect(doc.displayNumber ?? null, "no number spent").to.eq(null);
					});
			});
		});

		// -- Restore: the SAME invoice, currency corrected to DZD, sends normally. Proves the block is
		// a real, recoverable gate, not a permanently broken document. --
		createAlgerianClient().then((clientId) => {
			saveInvoiceDraft(clientId, "DZD").then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.runDocumentRowAction(invoiceId, "send");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Sent");
			});
		});
	});
});
