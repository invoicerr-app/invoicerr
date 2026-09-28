export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #515 - the document number restarts at 1 every year where the law allows it, for a country
 * whose format carries `reset: "yearly"` (backend's country-policy/data/xx.json own `numberFormats`).
 *
 * The seeded company is French by default (`cy.resetAndSeed()`), and FR is one of the countries this
 * pass found a primary source that actually permits a calendar-year series (BOFiP
 * BOI-TVA-DECLA-30-20-20-10 SS90) - the settings-screen journey below stays on it, and switches to
 * Portugal for the negative case the owner's own brief asks for by name.
 *
 * The FUNCTIONAL restart journey (actually issuing documents across the cutover) uses GERMANY
 * instead, deliberately: France is the one country in this catalog with its own free-text legal
 * MENTIONS mechanism (`mentions/data/fr.json`), and its `lateFeeRate` table's newest entry is only
 * valid THROUGH 2027-01-01 (`validTo`) - a real, pre-existing, unrelated data-maintenance gap (the
 * next ECB semi-annual rate was never going to be published before this feature's own 2027 cutover),
 * confirmed against a real send: a French invoice dated exactly on the cutover fails with
 * `UnresolvedInvoiceNotePlaceholderError` ("no value is in force for it on 2027-01-01"), for every
 * date on/after the cutover, not a fluke of one particular date. Germany carries the SAME `reset:
 * "yearly"` permission (UStAE 14.5 Abs. 10-11) with no such mechanism to collide with (CLAUDE.md:
 * "mentions... France only"), so it is what actually proves the restart end to end without touching
 * unrelated FR legal-mention data, which is out of this issue's own scope.
 *
 * Four journeys, against the real API and screen:
 *  a) Settings > Company shows the reset rule and its source next to the format, for FR (yearly) and
 *     for Portugal (never, switched to mid-spec) - read-only, the same convention issue #496 already
 *     established for the rest of this card.
 *  b) A German invoice dated before the cutover, one dated on/after it, and a LATE one dated before
 *     the cutover but numbered after several after-cutover invoices already exist - proving the
 *     counter keys by the document's own issue year, not the order documents are numbered in, and
 *     that the two years never collide or skip a number.
 *  c) A Polish invoice (`reset: "never"`) never restarts across the same year boundary - the negative
 *     case, so this spec cannot pass by accident just because SOME country resets.
 */
const api = Cypress.env("apiUrl");

interface NumberFormatRow {
	typeId: string;
	pattern: string;
	reset: "yearly" | "never";
	nextNumber: number;
}

function switchCompanyToGermany() {
	cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: {
			name: "Acme Corp",
			country: "Germany",
			countryCode: "DE",
			currency: "EUR",
			invoiceTransportId: "email",
			identifiers: [{ scheme: "VAT", value: "DE129273398" }],
		},
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
}

function switchCompanyToPortugal() {
	cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: {
			name: "Acme Corp",
			country: "Portugal",
			countryCode: "PT",
			currency: "EUR",
			invoiceTransportId: "email",
			identifiers: [{ scheme: "VAT", value: "PT980405319" }],
		},
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
}

function switchCompanyToPoland() {
	cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: {
			name: "Acme Corp",
			country: "Poland",
			countryCode: "PL",
			currency: "PLN",
			invoiceTransportId: "email",
			identifiers: [{ scheme: "VAT", value: "PL5260001246" }],
		},
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
}

/** A business buyer in Germany: cross-border for a Polish seller, so plain email transport is always
 *  available (Poland carries no domestic channel mandate in this catalog). */
function createGermanBuyer() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Käufer Berlin GmbH",
				contactEmail: "kaufer@example.com",
				currency: "EUR",
				country: "Germany",
				countryCode: "DE",
				address: "10 Musterstraße",
				city: "Berlin",
				postalCode: "10115",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "VAT", value: "DE123456789" }],
			},
		})
		.then((res) => {
			expect(res.status, "buyer created").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

/** A business buyer in France: cross-border for a German seller, so plain email transport is always
 *  available (no channel mandate in this catalog binds a DE<->FR operation). */
function createFrenchBuyer() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Acheteur Lyon SAS",
				contactEmail: "acheteur@example.com",
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "3 Rue de l'Avoir",
				city: "Lyon",
				postalCode: "69001",
				isActive: true,
				type: "COMPANY",
				identifiers: [
					{ scheme: "LEGAL_ID", value: "73282932000074" },
					{ scheme: "VAT", value: "FR44732829320" },
				],
			},
		})
		.then((res) => {
			expect(res.status, "buyer created").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

function sendInvoice(clientId: string, issueDate: string, unitPrice: number) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate,
					dueDate: issueDate,
					currency: "EUR",
					lines: [{ description: "Consulting", quantity: 1, unit: "unit", unitPrice, vatRate: "0" }],
				},
			},
		})
		.then((saved) => {
			expect(saved.status, "invoice draft saved").to.be.oneOf([200, 201]);
			const id = saved.body?.document?.id as string;
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/send`,
				body: { documentId: id, data: saved.body?.document?.data },
			})
				.its("status")
				.should("be.oneOf", [200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
			return cy.request({ url: `${api}/api/documents/${id}?typeId=invoice` }).its("body");
		});
}

describe("Issue #515 - the settings screen shows the reset rule and its source", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
	});

	beforeEach(() => {
		cy.login();
		// Below Tailwind's lg breakpoint the sticky settings nav gives way to a select, so it never
		// sits over the section in the screenshot - same convention 105's own settings screenshot uses.
		cy.viewport(1000, 900);
	});

	it("a French company (yearly): the invoice and credit-note rows show 'restarts every year' with the BOFiP source", () => {
		cy.intercept("GET", `${api}/api/company/number-formats`).as("numberFormats");
		cy.visit("/settings/company");
		cy.wait("@numberFormats", { timeout: 15000 }).its("response.statusCode").should("eq", 200);

		cy.get('[data-cy="number-formats-section"]', { timeout: 15000 }).scrollIntoView().should("be.visible");
		for (const typeId of ["invoice", "credit-note"]) {
			cy.get(`[data-cy="number-format-${typeId}"]`).within(() => {
				cy.get('[data-cy="number-format-reset"]').should("contain.text", "Restarts every year");
				cy.get('[data-cy="number-format-reset-source"]')
					.should("contain.text", "restarts at 1 on 1 January")
					.and("contain.text", "source read 2026-09-28");
			});
		}
		// Quote is unconstrained: no source read governs it, so it stays "never" too.
		cy.get('[data-cy="number-format-quote"]').within(() => {
			cy.get('[data-cy="number-format-reset"]').should("contain.text", "Never restarts");
		});

		cy.get('[data-cy="number-formats-section"]').scrollIntoView({ offset: { top: -16, left: 0 } });
		cy.screenshot("515-after-number-formats-fr", { capture: "viewport" });
	});

	it("a Portuguese company (never): the invoice row shows 'never restarts' with the AT FAQ 4318 source", () => {
		switchCompanyToPortugal();
		cy.intercept("GET", `${api}/api/company/number-formats`).as("numberFormats");
		cy.visit("/settings/company");
		cy.wait("@numberFormats", { timeout: 15000 }).its("response.statusCode").should("eq", 200);

		cy.get('[data-cy="number-formats-section"]', { timeout: 15000 }).scrollIntoView().should("be.visible");
		cy.get('[data-cy="number-format-invoice"]').within(() => {
			cy.get('[data-cy="number-format-pattern"]').should("have.text", "FT A/{number}");
			cy.get('[data-cy="number-format-reset"]').should("contain.text", "Never restarts");
			cy.get('[data-cy="number-format-reset-source"]')
				.should("contain.text", "never restarts")
				.and("contain.text", "source read 2026-09-28");
		});

		cy.get('[data-cy="number-formats-section"]').scrollIntoView({ offset: { top: -16, left: 0 } });
		cy.screenshot("515-after-number-formats-pt", { capture: "viewport" });
	});
});

describe("Issue #515 - a German invoice (reset: yearly) restarts at 1 from the first document dated 2027-01-01 or later", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		switchCompanyToGermany();
	});

	it("keeps the old continuous counter for documents dated before the cutover, restarts at 1 for the first one dated on/after it, and a LATE old-year document (numbered after new-year ones already exist) still continues the OLD counter without colliding", () => {
		createFrenchBuyer().then((clientId) => {
			// Two invoices dated in 2026 (before the cutover) - a plain continuous 1, 2.
			sendInvoice(clientId, "2026-11-01", 100).then((inv1) => {
				expect(inv1.displayNumber, "first 2026 invoice").to.eq("INVOICE-2026-0001");
			});
			sendInvoice(clientId, "2026-12-31", 100).then((inv2) => {
				expect(inv2.displayNumber, "second 2026 invoice, dated New Year's Eve").to.eq(
					"INVOICE-2026-0002",
				);
			});

			// Two invoices dated in 2027 (on/after the cutover) - a FRESH counter, back to 1.
			sendInvoice(clientId, "2027-01-01", 100).then((inv3) => {
				expect(inv3.displayNumber, "first 2027 invoice - the restart").to.eq("INVOICE-2027-0001");
			});
			sendInvoice(clientId, "2027-06-15", 100).then((inv4) => {
				expect(inv4.displayNumber, "second 2027 invoice - continuous within its own year").to.eq(
					"INVOICE-2027-0002",
				);
			});

			// THE EDGE CASE issue #515 names explicitly: a document dated in the OLD year, numbered
			// (here, and always) after several NEW-year documents already exist - it must continue the
			// OLD year's counter (0003, not 1, not colliding with 2027's 0001/0002), never a fresh row.
			sendInvoice(clientId, "2026-12-20", 100).then((inv5) => {
				expect(inv5.displayNumber, "a late 2026-dated invoice, numbered well into 2027").to.eq(
					"INVOICE-2026-0003",
				);
			});

			// No two documents of this company ever printed the same number - the concurrency proof's
			// end-to-end counterpart, through the real API and a real running server.
			cy.request({ url: `${api}/api/documents?typeId=invoice` }).then((res) => {
				const numbers = (res.body.items as { displayNumber: string }[]).map((d) => d.displayNumber);
				expect(new Set(numbers).size, "every printed number is distinct").to.eq(numbers.length);
			});
		});
	});
});

describe("Issue #515 - a Polish invoice (reset: never) never restarts, whatever the document's own year", () => {
	before(() => {
		cy.resetAndSeed();
		cy.login();
		switchCompanyToPoland();
	});

	it("the 2027-dated invoice continues the SAME counter the 2026-dated one used - no restart", () => {
		createGermanBuyer().then((clientId) => {
			sendInvoice(clientId, "2026-11-01", 100).then((inv1) => {
				expect(inv1.displayNumber, "2026 Polish invoice").to.eq("INVOICE-2026-0001");
			});
			sendInvoice(clientId, "2027-02-01", 100).then((inv2) => {
				// NEVER "INVOICE-2027-0001" - Poland stays on the one continuous counter.
				expect(inv2.displayNumber, "2027 Polish invoice - no restart").to.eq("INVOICE-2027-0002");
			});

			cy.request({ url: `${api}/api/company/number-formats` })
				.its("body.formats")
				.then((formats: NumberFormatRow[]) => {
					const invoice = formats.find((f) => f.typeId === "invoice");
					expect(invoice, "Poland's invoice format is 'never'").to.include({ reset: "never" });
				});
		});
	});
});
