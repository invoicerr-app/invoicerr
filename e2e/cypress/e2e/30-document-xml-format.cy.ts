export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Normalized EN 16931 export — same discipline as
 * 19-document-pdf.cy.ts: the ACTION is a real click on the screen, the ASSERTIONS that matter
 * intercept the real network request the click triggers (never the screen alone as proof of what
 * was actually served), and the body is checked for the exact figures `compute-totals.ts` produced
 * for this fixture — never a re-sum.
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
							const displayNumber = sent.body?.document
								?.displayNumber as string;
							expect(
								displayNumber,
								"the number must already be assigned",
							).to.be.a("string");
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
					expect(
						res.headers["content-type"],
						`${syntax} content-type`,
					).to.include("application/xml");
					expect(
						res.body,
						`${syntax} body carries the invoice number`,
					).to.include(displayNumber);
					expect(
						res.body,
						`${syntax} body carries the expected gross total (BT-112/BT-115)`,
					).to.include("240.00");
				});
			}
		});
	});

	it("shows the XML download button on the list screen, and clicking it actually downloads both syntaxes", () => {
		createAndSendInvoice().then(({ id, displayNumber }) => {
			cy.visit("/documents/invoice", { timeout: 20000 });

			cy.openDocumentRowMenu(id);

			cy.get(`[data-cy="document-xml-button-${id}"]`, {
				timeout: 10000,
			}).should("exist");

			cy.window().then((win) => {
				// window.open would escape Cypress' control the same way document-pdf's own spec
				// neutralizes it — the assertion is on the real network request, not the new tab.
				cy.stub(win, "open").as("windowOpen");
			});

			// CII first.
			cy.intercept({
				method: "GET",
				pathname: `/api/documents/${id}/formats/cii`,
			}).as("xmlCii");
			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-xml-button-${id}"]`).click();
			cy.get(`[data-cy="document-xml-cii-${id}"]`, { timeout: 10000 })
				.should("be.visible")
				.click();
			cy.wait("@xmlCii", { timeout: 20000 }).then((x) => {
				expect(
					x.response?.statusCode,
					"the click actually produced a CII export",
				).to.eq(200);
				expect(String(x.response?.headers["content-type"])).to.contain(
					"application/xml",
				);
				const body = String(x.response?.body);
				expect(body).to.contain(displayNumber);
				expect(body).to.contain("240.00");
			});

			// Then UBL — the SAME dropdown, reopened, proving both syntaxes are reachable from one button.
			cy.intercept({
				method: "GET",
				pathname: `/api/documents/${id}/formats/ubl`,
			}).as("xmlUbl");
			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-xml-button-${id}"]`).click();
			cy.get(`[data-cy="document-xml-ubl-${id}"]`, { timeout: 10000 })
				.should("be.visible")
				.click();
			cy.wait("@xmlUbl", { timeout: 20000 }).then((x) => {
				expect(
					x.response?.statusCode,
					"the click actually produced a UBL export",
				).to.eq(200);
				expect(String(x.response?.headers["content-type"])).to.contain(
					"application/xml",
				);
				const body = String(x.response?.body);
				expect(body).to.contain(displayNumber);
				expect(body).to.contain("240.00");
			});

			cy.get("@windowOpen").its("callCount").should("eq", 2);
		});
	});

	// The seeded baseline company is French
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

			cy.intercept({
				method: "GET",
				pathname: `/api/documents/${id}/formats/cii`,
			}).as("xmlCiiMentions");
			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-xml-button-${id}"]`, {
				timeout: 10000,
			}).click();
			cy.get(`[data-cy="document-xml-cii-${id}"]`, { timeout: 10000 })
				.should("be.visible")
				.click();
			cy.wait("@xmlCiiMentions", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode).to.eq(200);
				const body = String(x.response?.body);
				// PMT (flat-rate compensation for recovery costs) — the exact absence a real superpdp
				// fr:213 cited.
				expect(body).to.contain("frais de recouvrement");
				expect(body).to.contain("40 €");
				// PMD (late-payment penalties) — issueDate 2026-08-30 falls in the second half of 2026:
				// the rate FROZEN at issue, per `mentions/data/fr.json`'s own dated table.
				expect(body).to.contain("12,40 %");
				// AAB (early-payment discount) — the prescribed "néant" wording, doctrine F31808.
				expect(body).to.contain("Escompte pour paiement anticipé");
				// BT-21 subject codes, recovered by `splitCiiIncludedNotes` into their own element.
				expect(body).to.contain("<ram:SubjectCode>PMT</ram:SubjectCode>");
				expect(body).to.contain("<ram:SubjectCode>PMD</ram:SubjectCode>");
				expect(body).to.contain("<ram:SubjectCode>AAB</ram:SubjectCode>");
			});

			// UBL carries the same three mentions as `#CODE#text` — the shape BR-CL-08 itself
			// validates (proven offline by the REAL vendored Schematron — see
			// `formats/legal-mentions.spec.ts`), asserted here through the screen too.
			cy.intercept({
				method: "GET",
				pathname: `/api/documents/${id}/formats/ubl`,
			}).as("xmlUblMentions");
			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-xml-button-${id}"]`).click();
			cy.get(`[data-cy="document-xml-ubl-${id}"]`, { timeout: 10000 })
				.should("be.visible")
				.click();
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
						{
							description: "Consulting",
							quantity: 2,
							unit: "hour",
							unitPrice: 100,
							vatRate: "20",
						},
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
					cy.get(`[data-cy="document-list-row-${id}"]`, {
						timeout: 10000,
					}).should("exist");
					cy.openDocumentRowMenu(id);
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

	// BT-23, wired via the FR `country-fields/` overlay
	// (`supplyType`, a line subfield) and `content-requirements/` (the sourced, dated country rule —
	// see `formats/semantic/business-process.ts`'s own header). The overlay field is checked THROUGH
	// THE SCREEN (the form itself, not the API); the resulting code is checked on the real downloaded
	// XML, the same "screen for the action, network intercept for the assertion" discipline this
	// file's own two tests above already hold.
	it("the FR overlay's supplyType field is visible on an invoice line, and the downloaded XML carries the derived BT-23 code", () => {
		cy.visit("/documents/invoice", { timeout: 20000 });
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should(
			"be.visible",
		);

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]', { timeout: 10000 }).should(
			"exist",
		);

		// The overlay field: OPTIONAL, "select"-kind, GOODS/SERVICES only — resetAndSeed's own
		// baseline company is French, so this is visible with no extra company setup (the same
		// reason the mentions test above needs none either).
		cy.get(
			'[data-cy="document-field-lines-row-0"] [data-cy="document-field-supplyType-input"]',
			{
				timeout: 10000,
			},
		).should("exist");
		cy.get(
			'[data-cy="document-field-lines-row-0"] [data-cy="document-field-supplyType-input"] button',
		)
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-supplyType-input-options"]', {
			timeout: 10000,
		}).should("be.visible");
		cy.get('[data-cy="document-field-supplyType-input-options"]').within(() => {
			cy.contains("Goods").should("exist");
			cy.contains("Services").should("exist");
		});
		cy.contains('[data-cy*="-option-"]', "Services").first().click();

		// `issueDate` must be on/after the content requirement's own `mandatedFrom` (2026-09-01) for
		// BT-23 to be derived at all — but that is the EXACT SAME date the channel
		// MANDATE binds from (32-channel-mandate.cy.ts): the seeded baseline's default transport
		// ("email", set in this file's own `before()`) is refused at preflight for any invoice issued
		// on/after it. So, exactly like 31/32, this one test connects PDP with FICTITIOUS credentials
		// and switches the transport to it — "send" then clears the preflight (the point this test
		// actually needs) and fails downstream at the real deposit attempt, which does not matter
		// here: numbering already happened at "sending", before that attempt, and `download-xml` only
		// needs a number (see invoice.descriptor.ts's own numbering paragraph) — the SAME reasoning
		// `createAndSendInvoice`'s own comment already gives.
		//
		// The fake base URL is this spec's own running backend (`api`), NOT a closed loopback port
		// (31/32/40's own choice, and this test's original one) — kept from d4d3f3e0, still a real
		// improvement, but NOT the actual fix for this test (see below): a fast-failing URL alone left
		// CI run 34867394301 exactly as red as 34857663543, the same 3/3 failures.
		//
		// THE REAL CAUSE, established by comparing both CI runs and reproducing the exact failure mode
		// locally (not the timestamp correlation d4d3f3e0 leaned on, which proved incomplete):
		// `pdp-transport.ts#send()` builds and Schematron-validates a FULL Factur-X document
		// (`facturxFormatProvider.build`) BEFORE it ever touches the network — on EVERY retry attempt,
		// regardless of how fast the target URL fails. That build alone measures ~2.1s per call on an
		// idle dev machine (`GET .../formats/facturx`, timed directly); this repo's own CI comment
		// (`.github/workflows/cypress.yml`, the `backend-tests` job) independently documents this exact
		// operation — Factur-X + full EN 16931 Schematron — blowing up from ~4s locally past a 30s CI
		// budget under runner contention, worse than the flat 4.5x measured for the whole suite.
		// `DOCUMENT_ACTION_QUEUE_ATTEMPTS=3` with exponential backoff means that CPU-bound work repeats
		// up to 3 times per failed deposit, entirely inside the SAME single Node process (`WORKER_INLINE`
		// default true) that also serves this test's own foreground CII/UBL downloads — proven back to
		// back in both CI runs: job `send-invoice-cmu1gz29z…` (34867394301's own backend-logs) took 10s
		// for attempt 1 and 13s for attempt 2 — attempt 2 still running when this test's own UBL wait
		// reported its failure — and the OLDER run's job (`send-invoice-cmu1druik…`, the closed-port URL)
		// took a near-identical 11s and 12s per attempt. The URL fix changed the ERROR MESSAGE
		// ("fetch failed" -> "oauth2/token: 404") but not the per-attempt DURATION at all, which is the
		// tell that the network leg was never the bottleneck. Confirmed locally too: a burst of 8
		// concurrent PDP sends measurably starves the event loop — a plain `GET .../formats/ubl` that
		// normally answers in ~0.37s took up to 400x longer (a trivial 404 lookup went from ~0.005s to
		// ~1.6s) while the backlog drained.
		//
		// This also explains the ORIGINAL failure signature precisely, not just its timing: CI's
		// `AssertionError: expected undefined to equal 200` is NOT what `cy.wait()` throws when its own
		// 20s budget runs out (reproduced locally with an artificially short timeout: that throws a
		// distinct `CypressError: ... No response ever occurred`). Cypress's own net-stubbing
		// (`RESPONSE_WAITED_STATES = ['Complete', 'Errored']`) resolves `cy.wait()` the moment an
		// intercepted request's recorded state becomes EITHER — an `Errored` request yields exactly
		// `{ response: undefined }`, well before any 20s ceiling, which is what both CI runs actually hit.
		// NOT ESTABLISHED: the precise mechanism that flips "severely delayed" into that `Errored` state
		// (a Cypress-proxy-side timeout distinct from the driven `cy.wait` timeout is the leading
		// candidate — local reproduction only ever produced delay, up to 400x, never an outright error,
		// even under an 8-invoice burst) — deciding between that and any other candidate would need
		// another CI run with server-side request timing instrumentation this spec cannot add on its own.
		//
		// THE FIX: hand the transport back to "email" (and disconnect the fake PDP channel) IMMEDIATELY
		// after `send()` returns below — before this test ever touches the screen — instead of only at
		// the very end as before. `requireConnectedPdp` (pdp-transport.ts) is the FIRST thing every
		// delivery attempt does, BEFORE the expensive build, and re-resolves the channel's live state on
		// EVERY attempt (that file's own comment: "the company's configuration could have changed...
		// between the two calls") — so at most the ONE attempt BullMQ's in-process worker may already have
		// grabbed before this lands still pays the full build cost; every attempt after fails on a cheap
		// "channel not connected" lookup instead of repeating it. This also fixes the OLD cleanup's own
		// fragility: it only ran at the very end of THIS test, so failing mid-test (exactly what happened)
		// skipped it, leaving "pdp" active — with its own still-running retry storm — for the NEXT test's
		// `createAndSendInvoice` to inherit. That is the proven cause of failures 2 and 3 (not merely
		// "plausible collateral damage"): job `send-invoice-cmu1gzshy…` (34867394301's own log) was
		// enqueued the moment job 1's attempt 2 failed, at the exact timestamp the very next test's own
		// invoice was sent — because THIS test's transport reset never ran. Moving the reset to right
		// after `send()` makes it run unconditionally (Cypress already executes it before any later
		// command in this same chain can fail), regardless of what the rest of this test goes on to
		// assert.
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-pdp"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-pdp-baseurl-input"]').clear().type(api);
		cy.get('[data-cy="channel-pdp-clientid-input"]')
			.clear()
			.type("e2e-bt23-fake-client-id");
		cy.get('[data-cy="channel-pdp-clientsecret-input"]')
			.clear()
			.type("e2e-bt23-fake-client-secret");
		cy.get('[data-cy="channel-pdp-connect-button"]').click();
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Channel connected",
		);
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
			// Hand the transport back to "email" and disconnect the fake PDP channel BEFORE this test
			// ever touches the screen — see the big comment above ("THE FIX") for why this has to
			// happen HERE, not at the end: it starves every BullMQ delivery retry after the first of
			// the expensive Factur-X build that used to compete with the foreground downloads just
			// below, and it runs UNCONDITIONALLY (Cypress executes queued commands in order, so this
			// completes before anything later in this same chain gets a chance to fail) — unlike the
			// old end-of-test placement, which a failure right here used to skip entirely.
			cy.request({
				method: "POST",
				url: `${api}/api/company/info`,
				body: { invoiceTransportId: "email" },
			}).then((res) => {
				expect(res.status, "transport reset to email").to.be.oneOf([200, 201]);
			});
			cy.request({
				method: "DELETE",
				url: `${api}/api/company/channels/pdp`,
				failOnStatusCode: false,
			});

			cy.visit("/documents/invoice", { timeout: 20000 });
			cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));

			cy.intercept({
				method: "GET",
				pathname: `/api/documents/${id}/formats/cii`,
			}).as("xmlCiiBt23");
			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-xml-button-${id}"]`, {
				timeout: 10000,
			}).click();
			cy.get(`[data-cy="document-xml-cii-${id}"]`, { timeout: 10000 })
				.should("be.visible")
				.click();
			cy.wait("@xmlCiiBt23", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode).to.eq(200);
				// Pretty-printed (real newlines/tabs between elements) — see providers.spec.ts's own
				// `businessProcessValueFrom` for why this reuses a whitespace-tolerant pattern.
				expect(String(x.response?.body)).to.match(
					/<(?:ram:)?BusinessProcessSpecifiedDocumentContextParameter>\s*<(?:ram:)?ID>S1<\/(?:ram:)?ID>/,
				);
			});

			cy.intercept({
				method: "GET",
				pathname: `/api/documents/${id}/formats/ubl`,
			}).as("xmlUblBt23");
			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-xml-button-${id}"]`).click();
			cy.get(`[data-cy="document-xml-ubl-${id}"]`, { timeout: 10000 })
				.should("be.visible")
				.click();
			cy.wait("@xmlUblBt23", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode).to.eq(200);
				expect(String(x.response?.body)).to.match(
					/<cbc:ProfileID>S1<\/cbc:ProfileID>/,
				);
			});
		});
	});

	// The two NEW EN 16931 profiles, each judged by the base
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
			createAndSendInvoice({ buyerReference: "04011000-1234512345-06" }).then(
				({ id }) => {
					cy.visit("/documents/invoice", { timeout: 20000 });

					cy.intercept({
						method: "GET",
						pathname: `/api/documents/${id}/formats/xrechnung`,
					}).as("xrechnungNoIban");
					cy.openDocumentRowMenu(id);
					cy.get(`[data-cy="document-xml-button-${id}"]`, {
						timeout: 10000,
					}).click();
					cy.get(`[data-cy="document-xml-xrechnung-${id}"]`, { timeout: 10000 })
						.should("be.visible")
						.click();
					cy.wait("@xrechnungNoIban", { timeout: 20000 }).then((x) => {
						expect(x.response?.statusCode, "refused, never served").to.eq(400);
					});
					// The NAMED refusal — the toast carries the backend's own `errors` array (the exact
					// rule id), not just the generic "failed EN 16931 validation" wrapper.
					cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
						"contain.text",
						"BR-DE-1",
					);
				},
			);
		});

		it("sets the IBAN via Settings on screen, then a complete DE-ready invoice downloads a real XRechnung — 0 error", () => {
			cy.visit("/settings/company", { timeout: 20000 });
			// The form renders immediately with EMPTY defaults and only fills in from the real
			// company (including `invoiceTransportId`, set in this file's own `before()`) once its
			// own GET resolves and calls `form.reset(data)` — waiting for the NAME's real VALUE (not
			// merely the input's existence) is what actually proves that reset already ran, so
			// submitting below never clobbers `invoiceTransportId` back to empty (a real 501 this
			// spec hit once, "no transport configured", before this wait was added).
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should(
				"have.value",
				"Acme Corp",
			);
			cy.get('[data-cy="company-iban-input"]', { timeout: 15000 }).should(
				"exist",
			);
			// Same overflow-clipped-by-a-parent quirk `company-legalid-input` already has a documented
			// fix for (02-company.cy.ts's own `completeCompanyProfile`) — scroll it into view first.
			cy.get('[data-cy="company-iban-input"]').scrollIntoView();
			// ISO 13616's own published example (Deutsche Bundesbank) — the same fixture value the
			// jest master proof uses, never a real account.
			cy.get('[data-cy="company-iban-input"]')
				.clear({ force: true })
				.type("DE89370400440532013000", {
					force: true,
				});
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.get("[data-sonner-toast]", { timeout: 10000 }).should("be.visible");
			cy.wait(1000);

			createAndSendInvoice({ buyerReference: "04011000-1234512345-06" }).then(
				({ id, displayNumber }) => {
					cy.visit("/documents/invoice", { timeout: 20000 });
					cy.window().then((win) =>
						cy.stub(win, "open").as("windowOpenXRechnung"),
					);

					cy.intercept({
						method: "GET",
						pathname: `/api/documents/${id}/formats/xrechnung`,
					}).as("xrechnungOk");
					cy.openDocumentRowMenu(id);
					cy.get(`[data-cy="document-xml-button-${id}"]`, {
						timeout: 10000,
					}).click();
					cy.get(`[data-cy="document-xml-xrechnung-${id}"]`, { timeout: 10000 })
						.should("be.visible")
						.click();
					cy.wait("@xrechnungOk", { timeout: 20000 }).then((x) => {
						expect(
							x.response?.statusCode,
							"a real, validated XRechnung export",
						).to.eq(200);
						const body = String(x.response?.body);
						expect(body).to.contain(displayNumber);
						expect(body).to.contain("240.00");
						expect(body).to.contain(
							"<cbc:BuyerReference>04011000-1234512345-06</cbc:BuyerReference>",
						);
						expect(body).to.contain("DE89370400440532013000");
						expect(body).to.contain(
							"urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
						);
					});
					cy.get("@windowOpenXRechnung").its("callCount").should("eq", 1);
				},
			);
		});
	});
});
