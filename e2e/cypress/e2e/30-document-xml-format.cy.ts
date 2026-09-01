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

function createAndSendInvoice(overrides: Record<string, unknown> = {}) {
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

	// Root TODO item 15's own remainder — BT-23, wired via the FR `country-fields/` overlay
	// (`supplyType`, a line subfield) and `content-requirements/` (the sourced, dated country rule —
	// see `formats/semantic/business-process.ts`'s own header). The overlay field is checked THROUGH
	// THE SCREEN (the form itself, not the API); the resulting code is checked on the real downloaded
	// XML, the same "screen for the action, network intercept for the assertion" discipline this
	// file's own two tests above already hold.
	it("the FR overlay's supplyType field is visible on an invoice line, and the downloaded XML carries the derived BT-23 code", () => {
		cy.visit("/documents/invoice", { timeout: 20000 });
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("be.visible");

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]', { timeout: 10000 }).should("exist");

		// The overlay field: OPTIONAL, "select"-kind, GOODS/SERVICES only — resetAndSeed's own
		// baseline company is French, so this is visible with no extra company setup (the same
		// reason the mentions test above needs none either).
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-supplyType-input"]', {
			timeout: 10000,
		}).should("exist");
		cy.get(
			'[data-cy="document-field-lines-row-0"] [data-cy="document-field-supplyType-input"] button',
		)
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-supplyType-input-options"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="document-field-supplyType-input-options"]').within(() => {
			cy.contains("Goods").should("exist");
			cy.contains("Services").should("exist");
		});
		cy.contains('[data-cy*="-option-"]', "Services").first().click();

		// `issueDate` must be on/after the content requirement's own `mandatedFrom` (2026-09-01) for
		// BT-23 to be derived at all — but that is the EXACT SAME date root TODO item 11's own channel
		// MANDATE binds from (32-channel-mandate.cy.ts): the seeded baseline's default transport
		// ("email", set in this file's own `before()`) is refused at preflight for any invoice issued
		// on/after it. So, exactly like 31/32, this one test connects PDP with FICTITIOUS credentials
		// pointing at a closed port and switches the transport to it — "send" then clears the
		// preflight (the point this test actually needs) and fails downstream at the real deposit
		// attempt, which does not matter here: numbering already happened at "sending", before that
		// attempt, and `download-xml` only needs a number (see invoice.descriptor.ts's own numbering
		// paragraph) — the SAME reasoning `createAndSendInvoice`'s own comment already gives.
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-pdp"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-pdp-baseurl-input"]').clear().type("http://127.0.0.1:1");
		cy.get('[data-cy="channel-pdp-clientid-input"]').clear().type("e2e-bt23-fake-client-id");
		cy.get('[data-cy="channel-pdp-clientsecret-input"]').clear().type("e2e-bt23-fake-client-secret");
		cy.get('[data-cy="channel-pdp-connect-button"]').click();
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel connected");
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "pdp" },
		}).then((res) => {
			expect(res.status, "transport switched to pdp").to.be.oneOf([200, 201]);
		});

		// The rest of the document is created via the API (same convention as every other spec in
		// this suite — see 20-document-totals.cy.ts's own comment on this exact split): the field's
		// SCREEN visibility is what this test proves through the UI, the derived CODE is proven on
		// the real downloaded artifact.
		createAndSendInvoice({
			issueDate: "2026-09-01",
			dueDate: "2026-09-30",
			lines: [
				{
					description: "Consulting",
					quantity: 2,
					unit: "hour",
					unitPrice: 100,
					vatRate: "20",
					supplyType: "SERVICES",
				},
			],
		}).then(({ id }) => {
			cy.visit("/documents/invoice", { timeout: 20000 });
			cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));

			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/cii` }).as("xmlCiiBt23");
			cy.get(`[data-cy="document-xml-button-${id}"]`, { timeout: 10000 }).click();
			cy.get(`[data-cy="document-xml-cii-${id}"]`, { timeout: 10000 }).should("be.visible").click();
			cy.wait("@xmlCiiBt23", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode).to.eq(200);
				// Pretty-printed (real newlines/tabs between elements) — see providers.spec.ts's own
				// `businessProcessValueFrom` for why this reuses a whitespace-tolerant pattern.
				expect(String(x.response?.body)).to.match(
					/<(?:ram:)?BusinessProcessSpecifiedDocumentContextParameter>\s*<(?:ram:)?ID>S1<\/(?:ram:)?ID>/,
				);
			});

			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/ubl` }).as("xmlUblBt23");
			cy.get(`[data-cy="document-xml-button-${id}"]`).click();
			cy.get(`[data-cy="document-xml-ubl-${id}"]`, { timeout: 10000 }).should("be.visible").click();
			cy.wait("@xmlUblBt23", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode).to.eq(200);
				expect(String(x.response?.body)).to.match(/<cbc:ProfileID>S1<\/cbc:ProfileID>/);
			});
		});
	});

	// Root TODO item 26 ("Peppol/Allemagne") — the two NEW EN 16931 profiles, each judged by the base
	// Schematron PLUS its own vendored delta (backend/src/modules/documents/formats/{peppol-bis,
	// xrechnung}-provider.ts). Same discipline as the rest of this file: the ACTION is a real click,
	// the ASSERTIONS intercept the real network request, never the screen alone.
	describe("XRechnung (KoSIT) — the named refusal without an IBAN, then the full happy path", () => {
		// FIRST, deliberately: the seeded baseline company (resetAndSeed) never sets an IBAN, so this
		// runs before the next test gives it one — proving the refusal on the company's OWN, real
		// "nothing set yet" state, not a state this spec engineered by clearing a field back out.
		it("without an IBAN on file, downloading xrechnung through the screen refuses, naming BR-DE-1", () => {
			// buyerReference (BT-10, Leitweg-ID) IS provided — the seeded FR company has no
			// country-fields overlay UI for it (that is DE-only, see country-fields/data/de.json's
			// own header), so it is set directly via the API body, exactly like this file's own
			// `createAndSendInvoice` already does for every other field. The intent is a clean,
			// SINGLE-cause refusal: the IBAN, and only the IBAN, is missing.
			createAndSendInvoice({ buyerReference: "04011000-1234512345-06" }).then(({ id }) => {
				cy.visit("/documents/invoice", { timeout: 20000 });

				cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/xrechnung` }).as(
					"xrechnungNoIban",
				);
				cy.get(`[data-cy="document-xml-button-${id}"]`, { timeout: 10000 }).click();
				cy.get(`[data-cy="document-xml-xrechnung-${id}"]`, { timeout: 10000 })
					.should("be.visible")
					.click();
				cy.wait("@xrechnungNoIban", { timeout: 20000 }).then((x) => {
					expect(x.response?.statusCode, "refused, never served").to.eq(400);
				});
				// The NAMED refusal — the toast carries the backend's own `errors` array (the exact
				// rule id), not just the generic "failed EN 16931 validation" wrapper.
				cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "BR-DE-1");
			});
		});

		it("sets the IBAN via Settings on screen, then a complete DE-ready invoice downloads a real XRechnung — 0 error", () => {
			cy.visit("/settings/company", { timeout: 20000 });
			// The form renders immediately with EMPTY defaults and only fills in from the real
			// company (including `invoiceTransportId`, set in this file's own `before()`) once its
			// own GET resolves and calls `form.reset(data)` — waiting for the NAME's real VALUE (not
			// merely the input's existence) is what actually proves that reset already ran, so
			// submitting below never clobbers `invoiceTransportId` back to empty (a real 501 this
			// spec hit once, "no transport configured", before this wait was added).
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("have.value", "Acme Corp");
			cy.get('[data-cy="company-iban-input"]', { timeout: 15000 }).should("exist");
			// Same overflow-clipped-by-a-parent quirk `company-legalid-input` already has a documented
			// fix for (02-company.cy.ts's own `completeCompanyProfile`) — scroll it into view first.
			cy.get('[data-cy="company-iban-input"]').scrollIntoView();
			// ISO 13616's own published example (Deutsche Bundesbank) — the same fixture value the
			// jest master proof uses, never a real account.
			cy.get('[data-cy="company-iban-input"]').clear({ force: true }).type("DE89370400440532013000", {
				force: true,
			});
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("be.visible");
			cy.wait(1000);

			createAndSendInvoice({ buyerReference: "04011000-1234512345-06" }).then(({ id, displayNumber }) => {
				cy.visit("/documents/invoice", { timeout: 20000 });
				cy.window().then((win) => cy.stub(win, "open").as("windowOpenXRechnung"));

				cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/xrechnung` }).as(
					"xrechnungOk",
				);
				cy.get(`[data-cy="document-xml-button-${id}"]`, { timeout: 10000 }).click();
				cy.get(`[data-cy="document-xml-xrechnung-${id}"]`, { timeout: 10000 })
					.should("be.visible")
					.click();
				cy.wait("@xrechnungOk", { timeout: 20000 }).then((x) => {
					expect(x.response?.statusCode, "a real, validated XRechnung export").to.eq(200);
					const body = String(x.response?.body);
					expect(body).to.contain(displayNumber);
					expect(body).to.contain("240.00");
					expect(body).to.contain("<cbc:BuyerReference>04011000-1234512345-06</cbc:BuyerReference>");
					expect(body).to.contain("DE89370400440532013000");
					expect(body).to.contain(
						"urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
					);
				});
				cy.get("@windowOpenXRechnung").its("callCount").should("eq", 1);
			});
		});
	});

	// The seeded baseline seller is French — its own three mandatory C. com. mentions (BG-1) push
	// `cbc:Note` past Peppol's own PEPPOL-EN16931-R002 cap of one, a KNOWN, DOCUMENTED gap (see
	// `peppol-bis-provider.ts`'s own header, and its spec's "a documented gap" test) that this ticket
	// does not fix (it would mean collapsing the note-array mechanism `cii-post-process.ts` and every
	// FR mentions test already depend on — a cross-cutting change, out of scope here). Proving a real
	// HAPPY PATH through the actual application therefore needs a seller with no mandated BG-1
	// mentions at all — the US (mentions/data/all.ts ships only 'fr') is also the ONLY other country
	// with its OWN `country-policy/data/*.json` file (`us.json`, so save-draft/send/download-xml stay
	// allowed): switching to Germany instead was tried FIRST and empirically hits a SEPARATE,
	// unrelated gate — `country-policy` denies EVERY action for any country with no policy file at
	// all ("No document action policy is declared for 'DE'"), a real, pre-existing gap this ticket
	// does not attempt to close (it would mean writing a sourced DE country-policy file, a distinct,
	// unrelated body of legal research this ticket's own scope — two new FORMATS — never asked for).
	//
	// A DOMESTIC US-US invoice, not a cross-border US-seller/FR-buyer one: also tried FIRST and
	// empirically hit a SECOND, unrelated pre-existing gap — a non-EU seller against an EU buyer
	// makes `tax/resolve-invoice-tax.ts` (root TODO item 16) recategorize the line "O" (out of
	// scope), but `build-semantic-invoice.ts` still emits BT-152 (the item VAT rate) unconditionally,
	// which BR-O-05 forbids for that category — a genuine gap in the item-16 cross-border bridge,
	// unrelated to Peppol/XRechnung format work, so this spec routes AROUND it (both parties in the
	// same country) rather than silently depending on a fix that belongs to a different ticket.
	//
	// Both parties also need a REAL electronic address (`cbc:EndpointID`) the Peppol codelist itself
	// accepts (PEPPOL-EN16931-CL008) — this bridge's own base-layer fallback ('EM', a bare email, see
	// `build-semantic-invoice.ts#endpointFor`) is NOT one of Peppol's own CEF-EAS codes, discovered
	// empirically the same way, so both sides are given a REAL `PEPPOL_ENDPOINT` party identifier —
	// the EXACT EXISTING mechanism item 10 already built (`explicitEndpointFor`), the same one the
	// Settings screen's own "Peppol / Electronic routing" section (company.settings.tsx) already
	// collects for a company. Set here via the API for the SAME reason every other piece of this
	// file's own supporting data is (the client's own country/identifiers have no dedicated screen
	// beyond what client-upsert.tsx already covers) — the DOWNLOAD itself, the one thing this test
	// exists to prove, still happens through a real click.
	//
	// Runs LAST in this file on purpose — it changes the seeded company's own country and
	// identifiers, and every OTHER spec file gets a fresh `resetAndSeed()` regardless (see
	// e2e/cypress/support/e2e.ts's own global `before()`), the same reasoning 15-multi-company.cy.ts's
	// own header already documents for switching the active company.
	describe("Peppol BIS Billing 3.0", () => {
		it("a domestic US invoice downloads a real Peppol BIS export through the screen — 0 error", () => {
			cy.request({
				method: "POST",
				url: `${api}/api/company/info`,
				body: {
					country: "United States",
					countryCode: "US",
					identifiers: [
						{ scheme: "VAT", value: "US987654321" },
						{ scheme: "PEPPOL_ENDPOINT", value: "0060:123456789" },
					],
				},
			}).then((res) => {
				expect(res.status, "seller switched to a Peppol-ready US company").to.be.oneOf([200, 201]);
			});

			cy.request({ url: `${api}/api/documents/references/client/search` })
				.its("body")
				.then((clients: { id: string }[]) => {
					cy.request({
						method: "PATCH",
						url: `${api}/api/clients/${clients[0].id}`,
						body: {
							name: "Test Client",
							country: "United States",
							countryCode: "US",
							identifiers: [{ scheme: "PEPPOL_ENDPOINT", value: "9945:987654321" }],
						},
					}).then((res) => {
						expect(res.status, "buyer switched to a Peppol-ready US client").to.be.oneOf([200, 201]);
					});
				});

			createAndSendInvoice({ buyerReference: "PO-2026-00099" }).then(({ id, displayNumber }) => {
				cy.visit("/documents/invoice", { timeout: 20000 });
				cy.window().then((win) => cy.stub(win, "open").as("windowOpenPeppol"));

				cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/peppol-bis` }).as(
					"peppolBisOk",
				);
				cy.get(`[data-cy="document-xml-button-${id}"]`, { timeout: 10000 }).click();
				cy.get(`[data-cy="document-xml-peppol-bis-${id}"]`, { timeout: 10000 })
					.should("be.visible")
					.click();
				cy.wait("@peppolBisOk", { timeout: 20000 }).then((x) => {
					expect(x.response?.statusCode, "a real, validated Peppol BIS export").to.eq(200);
					const body = String(x.response?.body);
					expect(body).to.contain(displayNumber);
					expect(body).to.contain("240.00");
					expect(body).to.contain("<cbc:BuyerReference>PO-2026-00099</cbc:BuyerReference>");
					expect(body).to.contain(
						"urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
					);
					// The real Peppol endpoints on both sides — CL008's own requirement, not the base
					// bridge's plain-email fallback.
					expect(body).to.contain('schemeID="0060">123456789<');
					expect(body).to.contain('schemeID="9945">987654321<');
				});
				cy.get("@windowOpenPeppol").its("callCount").should("eq", 1);
			});
		});
	});
});
