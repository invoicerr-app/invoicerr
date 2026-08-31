/**
 * Normalized EN 16931 export (root TODO item 12, "formats normalisés") — same discipline as
 * 19-document-pdf.cy.ts: the ACTION is a real click on the screen, the ASSERTIONS that matter
 * intercept the real network request the click triggers (never the screen alone as proof of what
 * was actually served), and the body is checked for the exact figures `compute-totals.ts` produced
 * for this fixture — never a re-sum, per this ticket's own point (c).
 *
 * The fixture: one line, quantity 2 × unit price 100.00 EUR at 20% VAT.
 *   net = 200.00, VAT = 40.00, gross (BT-112/BT-115) = 240.00 — the exact string this spec looks for
 * in the downloaded body, both syntaxes.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createAndSendInvoice() {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			const data = {
				client: clients[0].id,
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
					// "send" — draft/send_failed -> sending, where the number (BT-1) is ALREADY taken
					// (invoice.descriptor.ts's own numbering paragraph) — the download-xml action never
					// needs the async worker to finish, only for sending to have STARTED.
					return cy
						.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/send`,
							body: { documentId: id, data },
						})
						.then((sent) => {
							expect(sent.status).to.be.oneOf([200, 201]);
							const displayNumber = sent.body?.document?.displayNumber as string;
							expect(displayNumber, "the number must already be assigned").to.be.a("string");
							return { id, displayNumber };
						});
				});
		});
}

describe("Normalized XML export (EN 16931 CII/UBL)", () => {
	before(() => {
		cy.resetAndSeed();
		// "send" REFUSES (501) at its own preflight when no transport is configured
		// (invoice-actions.ts's `resolveInvoiceTransport`) — `resetAndSeed`'s baseline company sets
		// none, so this spec configures one the same way 28-document-async-send.cy.ts already does,
		// or the invoice would never actually get its number (BT-1) at all.
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

	it("the API builds and serves a real, validated CII and UBL export of a sent invoice", () => {
		createAndSendInvoice().then(({ id, displayNumber }) => {
			for (const syntax of ["cii", "ubl"] as const) {
				cy.request({
					url: `${api}/api/documents/${id}/formats/${syntax}?typeId=invoice`,
					encoding: "binary",
				}).then((res) => {
					expect(res.status, `${syntax} status`).to.eq(200);
					expect(res.headers["content-type"], `${syntax} content-type`).to.include("application/xml");
					expect(res.body, `${syntax} body carries the invoice number`).to.include(displayNumber);
					expect(res.body, `${syntax} body carries the expected gross total (BT-112/BT-115)`).to.include(
						"240.00",
					);
				});
			}
		});
	});

	it("shows the XML download button on the list screen, and clicking it actually downloads both syntaxes", () => {
		createAndSendInvoice().then(({ id, displayNumber }) => {
			cy.visit("/documents/invoice", { timeout: 20000 });

			cy.get(`[data-cy="document-xml-button-${id}"]`, { timeout: 10000 }).should("exist");

			cy.window().then((win) => {
				// window.open would escape Cypress' control the same way document-pdf's own spec
				// neutralizes it — the assertion is on the real network request, not the new tab.
				cy.stub(win, "open").as("windowOpen");
			});

			// CII first.
			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/cii` }).as("xmlCii");
			cy.get(`[data-cy="document-xml-button-${id}"]`).click();
			cy.get(`[data-cy="document-xml-cii-${id}"]`, { timeout: 10000 }).should("be.visible").click();
			cy.wait("@xmlCii", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode, "the click actually produced a CII export").to.eq(200);
				expect(String(x.response?.headers["content-type"])).to.contain("application/xml");
				const body = String(x.response?.body);
				expect(body).to.contain(displayNumber);
				expect(body).to.contain("240.00");
			});

			// Then UBL — the SAME dropdown, reopened, proving both syntaxes are reachable from one button.
			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/ubl` }).as("xmlUbl");
			cy.get(`[data-cy="document-xml-button-${id}"]`).click();
			cy.get(`[data-cy="document-xml-ubl-${id}"]`, { timeout: 10000 }).should("be.visible").click();
			cy.wait("@xmlUbl", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode, "the click actually produced a UBL export").to.eq(200);
				expect(String(x.response?.headers["content-type"])).to.contain("application/xml");
				const body = String(x.response?.body);
				expect(body).to.contain(displayNumber);
				expect(body).to.contain("240.00");
			});

			cy.get("@windowOpen").its("callCount").should("eq", 2);
		});
	});

	// Root TODO item 15 ("mentions obligatoires") — the seeded baseline company is French
	// (resetAndSeed's own fixture: country "France" / countryCode "FR"), so the SAME click this
	// spec already drives now also carries the three C. com. art. L441-9 I al. 5 mentions in BG-1.
	// This is precisely what makes a real superpdp deposit's conformity check stop citing
	// "BR-FR-05/BT-22 : La mention relative aux frais de recouvrement (code PMT) est absente" — see
	// `pdp/pdp.live.spec.ts`'s own header for that live round-trip; here the same fact is proven
	// through the SCREEN, by intercepting the exact request the download button triggers, never by
	// asserting on the screen alone.
	it("a sent French invoice's downloaded XML carries the mandatory mentions — recovery fee + the rate actually in force", () => {
		createAndSendInvoice().then(({ id }) => {
			cy.visit("/documents/invoice", { timeout: 20000 });
			cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));

			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/cii` }).as("xmlCiiMentions");
			cy.get(`[data-cy="document-xml-button-${id}"]`, { timeout: 10000 }).click();
			cy.get(`[data-cy="document-xml-cii-${id}"]`, { timeout: 10000 }).should("be.visible").click();
			cy.wait("@xmlCiiMentions", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode).to.eq(200);
				const body = String(x.response?.body);
				// PMT (indemnité forfaitaire) — the exact absence a real superpdp fr:213 cited.
				expect(body).to.contain("frais de recouvrement");
				expect(body).to.contain("40 €");
				// PMD (pénalités de retard) — issueDate 2026-08-30 falls in the second half of 2026:
				// the rate FROZEN at issue, per `mentions/data/fr.json`'s own dated table.
				expect(body).to.contain("12,40 %");
				// AAB (escompte) — the prescribed "néant" wording, doctrine F31808.
				expect(body).to.contain("Escompte pour paiement anticipé");
				// BT-21 subject codes, recovered by `splitCiiIncludedNotes` into their own element.
				expect(body).to.contain("<ram:SubjectCode>PMT</ram:SubjectCode>");
				expect(body).to.contain("<ram:SubjectCode>PMD</ram:SubjectCode>");
				expect(body).to.contain("<ram:SubjectCode>AAB</ram:SubjectCode>");
			});

			// UBL carries the same three mentions as `#CODE#text` — the shape BR-CL-08 itself
			// validates (proven offline by the REAL vendored Schematron — see
			// `formats/legal-mentions.spec.ts`), asserted here through the screen too.
			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/ubl` }).as("xmlUblMentions");
			cy.get(`[data-cy="document-xml-button-${id}"]`).click();
			cy.get(`[data-cy="document-xml-ubl-${id}"]`, { timeout: 10000 }).should("be.visible").click();
			cy.wait("@xmlUblMentions", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode).to.eq(200);
				const body = String(x.response?.body);
				expect(body).to.contain("#PMT#");
				expect(body).to.contain("#PMD#");
				expect(body).to.contain("#AAB#");
				expect(body).to.contain("12,40 %");
			});

			// The PDF a user downloads carries the same mentions too — proven directly at the
			// rendering-unit level (`rendering/render-html.spec.ts`, "legal mentions" describe block)
			// against the REAL HTML the PDF is printed from. Not re-asserted here on the binary PDF
			// itself: this spec's OWN sibling (19-document-pdf.cy.ts) never decodes a downloaded
			// PDF's body beyond its `%PDF` magic bytes either — a compressed PDF stream is not a
			// plain-text match target, and building a decompression step into this suite for one
			// more string assertion would cost far more than it proves beyond the unit coverage.
		});
	});

	it("on a draft (never numbered), the button is absent AND the API refuses, saying why", () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				const data = {
					client: clients[0].id,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency: "EUR",
					lines: [
						{ description: "Consulting", quantity: 2, unit: "hour", unitPrice: 100, vatRate: "20" },
					],
				};
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data },
				}).then((saved) => {
					const id = saved.body?.document?.id as string;
					expect(saved.body?.document?.status).to.eq("draft");

					// The screen never offers the button for a draft.
					cy.visit("/documents/invoice", { timeout: 20000 });
					cy.get(`[data-cy="document-list-row-${id}"]`, { timeout: 10000 }).should("exist");
					cy.get(`[data-cy="document-xml-button-${id}"]`).should("not.exist");

					// And a scripted client hitting the endpoint directly gets the same refusal, not a
					// looser check because the path is different.
					cy.request({
						url: `${api}/api/documents/${id}/formats/cii?typeId=invoice`,
						failOnStatusCode: false,
					}).then((res) => {
						expect(res.status).to.eq(409);
						expect(res.body.message).to.contain("definitive invoice number");
					});
				});
			});
	});
});
