export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #519 -- "French invoices dated 2027 or later cannot be sent". `countries/data/fr.json (section "mentions")`'s own
 * `noteValues.lateFeeRate` table ends 2027-01-01 (the next scheduled semi-annual ECB check, C. com.
 * art. L441-10 II); before the fix, EVERY French invoice issued on or after that date refused to
 * send at all -- `UnresolvedInvoiceNotePlaceholderError` out of `legalMentionsFor`, surfaced as a 400
 * from `POST .../actions/send` (the PDF is rendered and attached as part of sending -- see
 * `actions/send-document-email.ts`'s own `renderDocumentInstance` call). The fix: PMD's own rule now
 * carries a `fallbackText` (`mentions/schema.ts`) quoting C. com. art. L441-10 II's own rate-setting
 * RULE verbatim instead of a stale/missing number, used whenever `lateFeeRate`'s value table has run
 * out -- a send is never blocked by a table nobody has updated yet.
 *
 * Proven at THREE dates the issue itself names or that a real un-maintained table produces:
 *   - 2026-08-30 (baseline, table covers it) -- unaffected, still the plain computed rate.
 *   - 2027-01-02 -- the day after the table's last window ends (first half of 2027).
 *   - 2027-07-02 -- still uncovered (second half of 2027) -- the gap recurs every six months, not a
 *     one-off the first fix date happens to paper over.
 *
 * Text is read out of the REAL rendered PDF (`cy.task("extractPdfText", ...)`, `pdf-parse` in the
 * Node plugin process -- see `cypress.config.ts`'s own header on that task, and
 * `20-document-totals.cy.ts` for the same discipline this spec reuses): Chromium's own PDF writer
 * compresses the content stream, so a byte-count/substring check on the raw response would prove
 * nothing about what actually got PRINTED.
 *
 * The 2027 cases use a GERMAN client, not the seeded (French) baseline one -- France now mandates
 * the "pdp" channel for a DOMESTIC operation only (`countries/data/fr.json (section "channelPolicy")`, both parties
 * established in France -- see `32-channel-mandate.cy.ts`'s own header), which the seeded baseline
 * client would trip on any issue date from 2026-09-01 onward, entirely unrelated to this issue. A
 * mandatory mention is a fact about the SELLER's own jurisdiction, never the buyer's
 * (`legalMentionsFor`'s own header) -- an FR seller -> DE buyer invoice still carries PMT/PMD/AAB,
 * exactly like `35-cross-border-tax.cy.ts`'s own FR->DE leg, while staying on "email" so this spec
 * exercises the SAME transport as issue #519 was actually reported against.
 */
const api = Cypress.env("apiUrl");

function createGermanClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Deutsche Spätzahlung GmbH",
				contactEmail: "billing@spaetzahlung.example",
				currency: "EUR",
				country: "Germany",
				countryCode: "DE",
				address: "Friedrichstraße 42",
				city: "Berlin",
				postalCode: "10117",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "VAT", value: "DE136695976" }], // checksum-valid (ISO 7064 Mod 11,10)
			},
		})
		.then((res) => {
			expect(res.status, "German client created").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "the created client has an id").to.be.a("string");
			return id;
		});
}

function createDraftInvoice(clientId: string, overrides: Record<string, unknown> = {}) {
	const data = {
		client: clientId,
		issueDate: "2026-08-30",
		dueDate: "2026-09-30",
		currency: "EUR",
		lines: [
			{
				description: "Consulting",
				quantity: 2,
				unit: "hour",
				unitPrice: 100,
				vatRate: "20",
			},
		],
		...overrides,
	};
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: { data },
		})
		.then((saved) => {
			expect(saved.status).to.be.oneOf([200, 201]);
			const id = saved.body?.document?.id as string;
			expect(id).to.be.a("string");
			return { id, data };
		});
}

function sendInvoice(id: string, data: Record<string, unknown>) {
	return cy.request({
		method: "POST",
		url: `${api}/api/documents/types/invoice/actions/send`,
		body: { documentId: id, data },
		failOnStatusCode: false,
	});
}

function pdfTextFor(id: string) {
	return cy
		.request({ url: `${api}/api/documents/${id}/pdf?typeId=invoice`, encoding: "binary" })
		.then((res) => {
			expect(res.status, "PDF download status").to.eq(200);
			const base64 = Cypress.Buffer.from(res.body as string, "binary").toString("base64");
			return cy.task("extractPdfText", base64).then((rawText) => String(rawText).replace(/\s+/g, " "));
		});
}

describe("French late-payment mention keeps invoices sendable past the rate table's last window (#519)", () => {
	before(() => {
		cy.resetAndSeed();
		// "send" refuses (501) at its own preflight when no transport is configured
		// (invoice-actions.ts's `resolveInvoiceTransport`) -- same setup 30-document-xml-format.cy.ts
		// already needs, for the same reason: the baseline seeded company sets none.
		cy.login();
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it("a baseline French invoice (issueDate inside the table) still sends and prints the plain computed rate", () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				createDraftInvoice(clients[0].id, { issueDate: "2026-08-30" }).then(({ id, data }) => {
					sendInvoice(id, data).then((sent) => {
						expect(sent.status, "send status").to.be.oneOf([200, 201]);
					});
					pdfTextFor(id).then((text) => {
						expect(text).to.contain("12,40 %");
						expect(text).not.to.contain("Banque centrale européenne");
					});
				});
			});
	});

	it("a French invoice dated 2027-01-02 (day after the table's last window ends) sends -- PMD falls back to the statutory rule wording", () => {
		createGermanClient().then((clientId) => {
			createDraftInvoice(clientId, { issueDate: "2027-01-02", dueDate: "2027-02-01" }).then(
				({ id, data }) => {
					sendInvoice(id, data).then((sent) => {
						expect(
							sent.status,
							`send status (body: ${JSON.stringify(sent.body)})`,
						).to.be.oneOf([200, 201]);
						expect(
							sent.body?.document?.displayNumber,
							"the number must be assigned",
						).to.be.a("string");
					});
					pdfTextFor(id).then((text) => {
						expect(text).to.contain("Banque centrale européenne");
						expect(text).to.contain("majoré de 10 points de pourcentage");
						expect(text).not.to.contain("{lateFeeRate}");
					});
				},
			);
		});
	});

	it("a French invoice dated 2027-07-02 (second half of 2027, still uncovered) sends too -- the gap recurs every six months", () => {
		createGermanClient().then((clientId) => {
			createDraftInvoice(clientId, { issueDate: "2027-07-02", dueDate: "2027-08-01" }).then(
				({ id, data }) => {
					sendInvoice(id, data).then((sent) => {
						expect(
							sent.status,
							`send status (body: ${JSON.stringify(sent.body)})`,
						).to.be.oneOf([200, 201]);
					});
					pdfTextFor(id).then((text) => {
						expect(text).to.contain("Banque centrale européenne");
					});
				},
			);
		});
	});

	// Screen-driven proof, the same "real click, real network intercept" discipline
	// 30-document-xml-format.cy.ts already holds for the XML download button: not just the API, the
	// actual button a user clicks. Screenshotted for the pull request (before/after, issue #519's own
	// rule on interface-adjacent changes) -- see the PR body for the paired "before" capture taken
	// with this fix reverted.
	it("the document list's own PDF button downloads a 2027 French invoice without error", () => {
		createGermanClient().then((clientId) => {
			createDraftInvoice(clientId, { issueDate: "2027-01-02", dueDate: "2027-02-01" }).then(
				({ id, data }) => {
					sendInvoice(id, data).then((sent) => {
						expect(sent.status).to.be.oneOf([200, 201]);
					});

					cy.visit("/documents/invoice", { timeout: 20000 });
					cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));

					cy.intercept({ method: "GET", pathname: `/api/documents/${id}/pdf` }).as("pdfDownload");
					cy.openDocumentRowMenu(id);
					cy.get(`[data-cy="document-pdf-button-${id}"]`, { timeout: 10000 }).click();
					cy.wait("@pdfDownload", { timeout: 20000 }).then((x) => {
						expect(x.response?.statusCode, "the click actually produced a PDF").to.eq(200);
					});
					cy.get("@windowOpen").its("callCount").should("eq", 1);

					cy.screenshot(`519-after-invoice-list-2027-01-02-pdf-downloaded`);
				},
			);
		});
	});
});
