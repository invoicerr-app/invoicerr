export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #517: VAT in the national currency on a foreign-currency invoice.
 *
 * The test backend runs with `VAT_CURRENCY_RATE_FAKE=1` (backend/.env.test), a deterministic,
 * network-free stand-in for the real ECB/NBP calls (`vat-currency/fake-rate-clients.ts`), the SAME
 * "a CI job must never depend on a real external feed" principle `VAT_VALIDATION_FAKE`/
 * `GITHUB_RELEASES_FAKE` already hold for their own outbound calls. The fake:
 *  - ECB: USD -> EUR at 0.85, GBP -> EUR at 1.15.
 *  - NBP: USD -> PLN at 4.20. GBP is DELIBERATELY ABSENT: this is what lets the Poland "no NBP rate
 *    available" refusal (issue #517's own explicit requirement) be proven through a real send, not
 *    only in a backend unit test.
 *
 * Three worlds:
 *  1. FRANCE (the seeded baseline company), a 1000.00 USD invoice at 20% VAT: net 1000.00, VAT
 *     200.00 USD -> 170.00 EUR (200 * 0.85), gross 1200.00 USD.
 *  2. POLAND (the company switched, same shape 105-numbering-formats-per-country.cy.ts already
 *     established for Italy), a 1000.00 USD invoice at 23% (Poland's own standard rate,
 *     countries/data/pl.json (section "vatRates")): VAT 230.00 USD -> 966.00 PLN (230 * 4.20).
 *  3. POLAND again, a GBP invoice: the send is REFUSED (400, naming NBP), never silently sent with
 *     no converted VAT, and never silently substituting the ECB fake instead.
 *
 * Both the domestic-vs-cross-border question and the buyer's own country are kept OUT of scope on
 * purpose: every invoice here bills the SAME-country baseline client the seed already creates (a
 * French client for the France case, a Polish one created below for the Poland case). A domestic
 * invoice never reaches the cross-border tax engine, so the vatRate typed on the line stays exactly
 * what was typed, and this spec's own hand-computed numbers hold without also having to model
 * `resolve-invoice-tax.ts`'s own cross-border resolution.
 */
const api = Cypress.env("apiUrl");

function setInvoiceTransportEmail() {
	return cy
		.request({ method: "POST", url: `${api}/api/company/info`, body: { invoiceTransportId: "email" } })
		.its("status")
		.should("be.oneOf", [200, 201]);
}

/** Mirrors `105-numbering-formats-per-country.cy.ts`'s own `switchCompanyToItaly`: mutate the
 *  seeded company, never create a second one. VAT + LEGAL_ID: the pair Poland's own
 *  country-identifiers file expects. */
function switchCompanyToPoland() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: {
				name: "Acme Sp. z o.o.",
				country: "Poland",
				countryCode: "PL",
				currency: "PLN",
				invoiceTransportId: "email",
				identifiers: [
					{ scheme: "VAT", value: "PL1234567890" },
					{ scheme: "LEGAL_ID", value: "0000123456" },
				],
			},
		})
		.its("status")
		.should("be.oneOf", [200, 201]);
}

function createPolishClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Klient Testowy Sp. z o.o.",
				contactEmail: "klient@example.com",
				currency: "PLN",
				country: "Poland",
				countryCode: "PL",
				address: "ul. Testowa 1",
				city: "Warszawa",
				postalCode: "00-001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			expect(res.status, "the Polish client must exist").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

function frenchClientId() {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => clients[0].id);
}

function sendUsdInvoice(clientId: string, vatRate: string) {
	const data = {
		client: clientId,
		issueDate: "2026-08-20",
		dueDate: "2026-09-20",
		currency: "USD",
		lines: [{ description: "Consulting services", quantity: 1, unit: "unit", unitPrice: 1000, vatRate }],
	};
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: id, data },
					failOnStatusCode: false,
				})
				.then((sent) => ({ id, sent }));
		});
}

function pdfTextFor(id: string) {
	return cy
		.request({ url: `${api}/api/documents/${id}/pdf?typeId=invoice`, encoding: "binary" })
		.then((res) => {
			expect(res.status).to.eq(200);
			const base64 = Cypress.Buffer.from(res.body as string, "binary").toString("base64");
			return cy.task("extractPdfText", base64) as Cypress.Chainable<string>;
		});
}

describe("Issue #517: VAT in the national currency on a foreign-currency invoice", () => {
	beforeEach(() => {
		cy.resetAndSeed();
		cy.login();
		setInvoiceTransportEmail();
	});

	it("FRANCE: a 1000.00 USD invoice prints VAT in EUR (170.00) on the PDF, the XML (BT-6/BT-111) and the detail page", () => {
		frenchClientId().then((clientId) => {
			sendUsdInvoice(clientId, "20").then(({ id, sent }) => {
				expect(sent.status, "invoice sent").to.be.oneOf([200, 201]);
				expect(sent.body?.document?.status).to.eq("sending");

				// The PDF: a real reader's own document.
				pdfTextFor(id).then((text) => {
					expect(text, "PDF prints the converted VAT line").to.include("VAT in EUR");
					expect(text, "PDF prints the converted amount").to.include("170.00");
					expect(text, "PDF prints the frozen rate").to.include("0.85");
				});

				// The EN 16931 XML: BT-6 (accounting currency) and BT-111 (converted VAT amount),
				// both syntaxes, exactly the two carriers `build-semantic-invoice.ts` wires.
				(["cii", "ubl"] as const).forEach((syntax) => {
					cy.request({ url: `${api}/api/documents/${id}/formats/${syntax}?typeId=invoice` }).then(
						(res) => {
							expect(res.status).to.eq(200);
							const xml = res.body as string;
							expect(xml).to.contain("EUR");
							expect(xml).to.contain("170.00");
						},
					);
				});

				// The detail page: issue #517's own frontend surface (document-detail.tsx).
				cy.visit(`/documents/invoice/${id}`);
				cy.get('[data-cy="document-vat-national-currency"]', { timeout: 15000 }).should("exist");
				cy.get('[data-cy="document-vat-national-currency-vat"]').should("contain.text", "170.00");
				cy.get('[data-cy="document-vat-national-currency-vat"]').should("contain.text", "EUR");
			});
		});
	});

	it("POLAND: a 1000.00 USD invoice prints VAT in PLN (966.00) on the PDF and the detail page", () => {
		switchCompanyToPoland();
		createPolishClient().then((clientId) => {
			sendUsdInvoice(clientId, "23").then(({ id, sent }) => {
				expect(sent.status, "invoice sent").to.be.oneOf([200, 201]);

				pdfTextFor(id).then((text) => {
					expect(text, "PDF prints the converted VAT line").to.include("VAT in PLN");
					expect(text, "PDF prints the converted amount").to.include("966.00");
					expect(text, "PDF prints the frozen NBP rate").to.include("4.2");
				});

				cy.visit(`/documents/invoice/${id}`);
				cy.get('[data-cy="document-vat-national-currency-vat"]', { timeout: 15000 }).should(
					"contain.text",
					"966.00",
				);
				cy.get('[data-cy="document-vat-national-currency-vat"]').should("contain.text", "PLN");
			});
		});
	});

	it("POLAND: a GBP invoice is REFUSED, no NBP rate for GBP in the fake table, never a silent fallback", () => {
		switchCompanyToPoland();
		createPolishClient().then((clientId) => {
			const data = {
				client: clientId,
				issueDate: "2026-08-20",
				dueDate: "2026-09-20",
				currency: "GBP",
				lines: [
					{ description: "Consulting services", quantity: 1, unit: "unit", unitPrice: 1000, vatRate: "23" },
				],
			};
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data },
			}).then((saved) => {
				const id = saved.body?.document?.id as string;
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: id, data },
					failOnStatusCode: false,
				}).then((sent) => {
					expect(sent.status, "the send is refused, never silently accepted").to.eq(400);
					expect(String(sent.body?.message ?? ""), "the refusal names NBP").to.include("NBP");

					// The document itself is untouched: still a draft, still unnumbered, never a
					// half-sent record with no converted VAT on it.
					cy.request({ url: `${api}/api/documents/${id}?typeId=invoice` }).then((doc) => {
						expect(doc.body?.status).to.eq("draft");
					});
				});
			});
		});
	});
});
