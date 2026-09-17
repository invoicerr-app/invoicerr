export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * NATIONAL transports — wave 1: the credentials groundwork + the PDP channel,
 * proven by the screen: we connect the PDP channel with FAKE credentials pointing at a server
 * that does not exist (a closed port locally), we pick `pdp` as the invoicing transport, and we
 * observe the queue's real failure (BullMQ retry then "send_failed", the error naming the channel).
 * The REAL PDP deposit (superpdp sandbox) is proven elsewhere, for real, by
 * `backend/src/modules/documents/transports/pdp/pdp.live.spec.ts` (jest, `PDP_LIVE=1`) — never by
 * this spec, which never talks to any real server FOR PDP.
 *
 * Wave 2 (KSeF/PL, SdI/IT) extends this file with the SAME pattern — country suggestion → connect
 * via the screen → choose the transport → send → "send_failed" naming the channel — genuinely AS
 * that country's own company, with ONE assumed difference, documented here rather than guessed
 * silently:
 *
 *  1. `country-policy/data/{pl,it}.json` now exist (added `d2fab703`, after this file was first
 *     written) — every action these tests need (`save-draft`, `send`) is allowed for both, so the
 *     company genuinely STAYS Poland/Italy through connect → pick-transport → create → send, never
 *     switching back to France first. It still needs a VAT identifier of its own, though: `send()`
 *     builds each country's NATIONAL format (FA(3) for KSeF, FatturaPA for SdI) before ever reaching
 *     the network, and that format's own XSD requires the seller's VAT number
 *     (`fa3-provider.ts`/`fatturapa-provider.ts`, `getIdentifier(company, 'VAT')`) — a company with
 *     none would fail THAT validation and never reach the real sandbox at all, which is the one thing
 *     these tests exist to prove. `setCompanyCountry` below therefore also sets a real VAT (Italy:
 *     also a LEGAL_ID/Codice Fiscale) whenever it switches country, and the France leg (Chorus Pro,
 *     right after) restores the SEEDED French company's own SIRET/VAT explicitly — both schemes are
 *     `@@unique([companyId, scheme])` in `schema.prisma`, so setting a Polish/Italian VAT overwrote
 *     the French one in place rather than adding a second row.
 *  2. Unlike PDP (whose URL is a field typed by the user, and thus falsifiable toward a
 *     closed port), the KSeF URL is FIXED per environment (`ksef-client.ts`'s own `BASE_URLS`) —
 *     no configuration field replaces it. The KSeF test therefore sends a FAKE token to the REAL
 *     public sandbox `ksef-test.mf.gov.pl`, which really rejects it (code 450, "invalid
 *     token") — verified by hand before writing this test (direct probe: response in under
 *     300ms, never a network block). SdI now has a real SOAP client (`sdicoop-client.ts`,
 *     "implemented-awaiting-accreditation" — AdE accreditation not obtained, see
 *     `sdi-transport.ts`'s own header): like PDP, its `endpoint` is a field typed by the user, and
 *     thus falsifiable toward the same closed port — the deposit really fails (ECONNREFUSED),
 *     never a canned message.
 *
 * Wave 3 (Chorus Pro/FR, B2G) — the same pattern again, with the SAME assumed difference as KSeF
 * (point 2 above), for the SAME reason: the PISTE OAuth/API hosts are FIXED per environment
 * (`chorus-pro-transport.ts`'s own `CHORUS_PRO_URLS`), never a configuration field. The test
 * therefore sends fake PISTE credentials to the REAL public sandbox `sandbox-oauth.piste.gouv.fr`,
 * which really rejects them — verified by hand before writing this test (direct `curl`: `HTTP 400
 * {"error":"invalid_client"}` in well under a second, never a network block — see
 * `choruspro-client.ts`'s own header for the same verification, done the same day). No
 * `country-policy` rule is needed here (France already has one) — this wave picks "chorus-pro" as
 * the company's FREE transport for an ordinary BUSINESS client, never through B2G routing (see
 * `40-b2g-routing.cy.ts` for the FR B2G path itself, with a GOVERNMENT client).
 *
 * The ACTION goes through a real click on the screen (connect, pick the transport, send,
 * disconnect); the ASSERTIONS that matter read the record back via the API — the same discipline
 * as 28 (async send) and the rest of this suite.
 *
 * `cy.resetAndSeed()` already seeds a FRENCH company (SIRET/VAT on `Acme Corp`, see
 * support/commands.ts) — exactly what the Factur-X bridge (facturx-provider.ts, EN 16931 Schematron
 * gate) needs to build a VALID artifact; the deposit therefore fails here only because of the
 * closed port, never because of an invalid invoice that would mask the real cause under test.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

/** Port 1 (tcpmux): never open on a normal dev/CI machine — immediate ECONNREFUSED, no waiting on
 *  a network timeout. No real platform listens behind these credentials. */
const FAKE_PDP = {
	baseUrl: "http://127.0.0.1:1",
	clientId: "e2e-fake-client-id",
	clientSecret: "e2e-fake-client-secret",
};

/** A structurally valid NIP (the well-known test NIP from the Polish Ministry of Finance — see
 *  `fa3-provider.spec.ts`'s own fixture) but a FAKE token: the real sandbox
 *  ksef-test.mf.gov.pl really rejects it (code 450) — see this file's own header, point 2. */
const FAKE_KSEF = {
	nip: "5260001246",
	ksefToken: "e2e-fake-ksef-token",
};

/** A real SOAP client now exists (`sdicoop-client.ts`) — `endpoint` points at the same closed port
 *  as `FAKE_PDP` (immediate ECONNREFUSED, no real platform behind it); the content of the other
 *  three fields does not matter at all, only their PRESENCE counts (the form requires them before
 *  declaring the channel "connected" — see `sdi-transport.ts#extractCredentials`). */
const FAKE_SDI = {
	idTrasmittente: "IT01234567890",
	endpoint: "https://127.0.0.1:1/ricevi_file",
	certificate: "ZTJlLWZha2UtcGZ4LWNvbnRlbnRz",
	certificatePassword: "e2e-fake-cert-password",
};

/** Chorus Pro (FR, B2G) — see this file's own header, "Wave 3": both PISTE OAuth2 fields, garbage on
 *  purpose, sent to the REAL public sandbox (`sandbox-oauth.piste.gouv.fr`), which rejects them for
 *  real (`HTTP 400 invalid_client`) — never a closed port, since these hosts are fixed by environment,
 *  not user-editable (see `chorus-pro-transport.ts`'s own `CHORUS_PRO_URLS`). The technical-account
 *  pair's own CONTENT is irrelevant (never reached — PISTE auth fails first); only its PRESENCE
 *  matters, exactly like `FAKE_SDI`'s own certificate fields above. */
const FAKE_CHORUS_PRO = {
	clientId: "e2e-fake-piste-client-id",
	clientSecret: "e2e-fake-piste-client-secret",
	technicalAccountLogin: "TECH_1_e2e-fake@cpro.fr",
	technicalAccountPassword: "e2e-fake-tech-password",
};

/** Switches the seeded company's country — genuinely, for the rest of that wave (connect, pick
 *  transport, create, send), never switched back before sending — see this file's own header,
 *  point 1. `identifiers` replaces whichever identifier the given scheme already carries
 *  (`@@unique([companyId, scheme])`, `schema.prisma`) — pass the ones the TARGET country's own
 *  national format needs (or the seeded French ones, to restore them before the Chorus Pro wave). */
function setCompanyCountry(
	country: string,
	countryCode: string,
	identifiers?: { scheme: string; value: string }[],
) {
	return cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: { name: "Acme Corp", country, countryCode, ...(identifiers ? { identifiers } : {}) },
	});
}

/**
 * `vatRate` is validated against the ISSUING company's OWN `vat-rates/data/<cc>.json` catalog
 * (`validateAgainstDescriptor`) — a seller-country-specific list of ALLOWED rates, never a bare
 * "any percentage" field. "20" is France's own standard rate (`fr.json`, `fr-standard`) and stays the
 * default for the PDP/Chorus Pro waves below (both French); the KSeF/SdI waves — genuinely Polish/
 * Italian now (see this file's own header, point 1) — pass their OWN standard rate explicitly ("23",
 * "22" — `pl.json`/`it.json`'s own `pl-standard`/`it-standard`), since neither would validate against
 * the OTHER country's list.
 */
function createInvoiceDraft(vatRate = "20") {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			expect(
				clients,
				"le jeu d'essai contient un client",
			).to.have.length.greaterThan(0);
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-31",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{
									description: "Conseil",
									quantity: 2,
									unit: "hour",
									unitPrice: 150,
									vatRate,
								},
							],
						},
					},
					failOnStatusCode: false,
				})
				.then((saved) => {
					expect(
						saved.status,
						`brouillon de facture créé — ${JSON.stringify(saved.body).slice(0, 220)}`,
					).to.be.oneOf([200, 201]);
					const invoiceId = saved.body?.document?.id as string;
					expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");
					return invoiceId;
				});
		});
}

describe("National transports — the PDP channel, connected/disconnected via the screen", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('connects the PDP channel via the screen with fake credentials — status "Connected"', () => {
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-pdp"]', { timeout: 15000 }).should("exist");
		// France (the seeded company) suggests PDP — the data comes from the country file
		// (transports/channel-policy/data/fr.json), never an `if` on the country here.
		cy.get('[data-cy="channel-pdp-suggested"]').should("exist");
		cy.get('[data-cy="channel-pdp-status"]').should(
			"contain.text",
			"Not connected",
		);

		cy.get('[data-cy="channel-pdp-baseurl-input"]')
			.clear()
			.type(FAKE_PDP.baseUrl);
		cy.get('[data-cy="channel-pdp-clientid-input"]')
			.clear()
			.type(FAKE_PDP.clientId);
		cy.get('[data-cy="channel-pdp-clientsecret-input"]')
			.clear()
			.type(FAKE_PDP.clientSecret);
		// Environment left on "Test (sandbox)", the form's default value.
		cy.get('[data-cy="channel-pdp-connect-button"]').click();

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Channel connected",
		);
		cy.get('[data-cy="channel-pdp-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Connected",
		);

		// And that is indeed what gets stored — never a secret in clear text in the response: the GET
		// only returns the status (channels.service.ts's own ChannelConfigStatus).
		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then(
				(body: {
					configured: {
						providerId: string;
						isActive: boolean;
						environment: string;
					}[];
				}) => {
					const pdp = body.configured.find((c) => c.providerId === "pdp");
					expect(pdp, "le canal pdp est bien en base, actif").to.include({
						isActive: true,
						environment: "TEST",
					});
				},
			);
	});

	it("picks pdp as the invoicing transport, on the company settings screen", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', {
			timeout: 15000,
		}).click();
		cy.get('[data-cy="company-invoice-transport-options"]', {
			timeout: 10000,
		}).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-pdp"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);

		cy.request({ url: `${api}/api/company/info` })
			.its("body")
			.then((company: { invoiceTransportId: string }) => {
				expect(
					company.invoiceTransportId,
					"le transport choisi est bien enregistré",
				).to.eq("pdp");
			});
	});

	it('sends an invoice via PDP → the queue really fails (fake server) and "send_failed" names the channel', () => {
		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			// A real click — the invoice has no "send" param (the transport reads the client, not a
			// typed field — see invoice-actions.ts), so there is no params dialog to go through.
			cy.runDocumentRowAction(invoiceId, "send");

			// A large, documented budget, same reasoning as 28-document-async-send.cy.ts:
			// DOCUMENT_ACTION_QUEUE_ATTEMPTS=3 by default, exponential backoff base 2000ms — up to
			// ~6s of queueing before the final failure. `timeout` on the `.find()` itself, not just
			// the preceding `cy.get()` (a Cypress pitfall documented in this same file 28).
			//
			// UNLIKE 28's own scenario (a structural refusal — no contact email — that fails every
			// attempt near-instantly), this one is a REAL connect attempt to the fake PDP baseUrl
			// (a closed local port). That was assumed near-instant too (ECONNREFUSED) when 40000ms
			// was chosen; measured on CI 2026-09-14 it is not — each of the 3 attempts took ~10-13s
			// there (fetch/undici's own connect timeout firing before an immediate refusal), pushing
			// the total past 40s and failing this exact assertion in that run (32-channel-mandate.cy.ts
			// runs the identical scenario). 90000ms leaves real margin; the assertion itself — a real
			// "Send failed", never a silent success — is unchanged.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 90000 })
				.find('[data-cy="document-status-badge"]', { timeout: 90000 })
				.should("contain.text", "Send failed");

			// The VISIBLE error names the channel — never a generic message.
			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should(
				"contain.text",
				"PDP",
			);

			// The assertion that matters reads the API, never the screen as proof of what is in the database.
			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(
						doc.status,
						'la facture est réellement "send_failed" en base',
					).to.eq("send_failed");
					expect(
						doc.lastActionError,
						"l'erreur enregistrée nomme le canal PDP",
					).to.match(/PDP/);
					// Never a success with an empty reference: since the fake server never responded,
					// no deposit identifier could have been recorded — see mutation #1 of the topic.
					expect(
						doc.transportRef,
						"aucune référence de dépôt sans dépôt réel",
					).to.not.be.a("string");
				});
		});
	});

	it("disconnects the channel via the screen → a new send is blocked at PREFLIGHT, and says so", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-pdp-status"]', { timeout: 15000 }).should(
			"contain.text",
			"Connected",
		);
		// `force: true` on both clicks — the trigger sits inside a `Tooltip`+`DropdownMenu`
		// pair, and Cypress's own visibility heuristic false-negatives on a Radix portal'd
		// popover this far down a tall page (it reads the popper's `position: fixed`
		// ancestor as "overflowed", even though the item is genuinely on screen).
		cy.get('[data-cy="channel-pdp-menu"]').scrollIntoView().click({ force: true });
		cy.get('[data-cy="channel-pdp-disconnect-button"]').should("exist").click({ force: true });

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Channel disconnected",
		);
		cy.get('[data-cy="channel-pdp-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Not connected",
		);

		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then((body: { configured: { providerId: string }[] }) => {
				expect(
					body.configured.find((c) => c.providerId === "pdp"),
					"plus aucune ligne pdp en base — un disconnect complet, pas juste isActive:false",
				).to.be.undefined;
			});

		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.runDocumentRowAction(invoiceId, "send");

			// PREFLIGHT blocks BEFORE any persistence — even the transition to "sending" never
			// happens (see async-send.ts / pdp-transport.ts's own header): a visible toast says so
			// right away, no waiting on the queue.
			cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
				"contain.text",
				"PDP channel is not connected",
			);

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(
						doc.status,
						'jamais persisté au-delà de "draft" — bloqué avant toute écriture',
					).to.eq("draft");
				});
		});
	});

	// ── Wave 2: KSeF (Poland) — see this file's own header for the two assumed differences ──

	it("a POLISH company sees the KSeF suggestion on the channels screen — the data comes from data/pl.json, never an `if`", () => {
		// A real Polish VAT (the well-known KSeF sandbox test NIP, `PL5260001246` — the same one
		// `scenarios/full-lifecycle.cy.ts` already uses as a buyer identifier) — needed for the FA(3)
		// send further down, not for this suggestion check itself; set once, here, since the company
		// STAYS Poland for the rest of this wave (see this file's own header, point 1).
		setCompanyCountry("Poland", "PL", [{ scheme: "VAT", value: "PL5260001246" }]);
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-ksef"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-ksef-suggested"]').should("exist");
		// PDP is no longer suggested to a Polish company — the suggestion follows the country, never
		// a fixed default channel.
		cy.get('[data-cy="channel-pdp-suggested"]').should("not.exist");
	});

	it('connects the KSeF channel via the screen with fake credentials — status "Connected"', () => {
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-ksef"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-ksef-status"]').should(
			"contain.text",
			"Not connected",
		);

		cy.get('[data-cy="channel-ksef-nip-input"]').clear().type(FAKE_KSEF.nip);
		cy.get('[data-cy="channel-ksef-kseftoken-input"]')
			.clear()
			.type(FAKE_KSEF.ksefToken);
		// Environment left on "Test (sandbox)" — that is precisely what points to the REAL
		// ksef-test.mf.gov.pl (see this file's own header, point 2).
		cy.get('[data-cy="channel-ksef-connect-button"]').click();

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Channel connected",
		);
		cy.get('[data-cy="channel-ksef-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Connected",
		);

		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then(
				(body: {
					configured: {
						providerId: string;
						isActive: boolean;
						environment: string;
					}[];
				}) => {
					const ksef = body.configured.find((c) => c.providerId === "ksef");
					expect(ksef, "le canal ksef est bien en base, actif").to.include({
						isActive: true,
						environment: "TEST",
					});
				},
			);
	});

	it("picks ksef as the invoicing transport, on the company settings screen", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', {
			timeout: 15000,
		}).click();
		cy.get('[data-cy="company-invoice-transport-options"]', {
			timeout: 10000,
		}).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-ksef"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);

		cy.request({ url: `${api}/api/company/info` })
			.its("body")
			.then((company: { invoiceTransportId: string }) => {
				expect(
					company.invoiceTransportId,
					"le transport choisi est bien enregistré",
				).to.eq("ksef");
			});
	});

	it('sends an invoice via KSeF → the queue really fails (fake token rejected by the real ksef-test.mf.gov.pl) and "send_failed" names the channel', () => {
		createInvoiceDraft("23").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.runDocumentRowAction(invoiceId, "send");

			// Same budget as the PDP test above — see its comment for why it is 90000ms, not the
			// 40000ms this was originally set to. The real KSeF rejection is in practice near-instant
			// (probed by hand: < 300ms) — that part of the estimate holds — but the queueing/attempt
			// overhead around it does not always, on CI, per the PDP test's own measurement.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 90000 })
				.find('[data-cy="document-status-badge"]', { timeout: 90000 })
				.should("contain.text", "Send failed");

			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should(
				"contain.text",
				"KSeF",
			);

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(
						doc.status,
						'la facture est réellement "send_failed" en base',
					).to.eq("send_failed");
					// `ksef-transport.ts` wraps EVERY failure (DNS, timeout, a blocked sandbox egress) in a
					// message that names the channel — matching only `/KSeF/` would pass identically for a
					// broken `BASE_URLS` entry or a runner with no outbound network at all, silently
					// blind to its own reachability. The real sandbox's own rejection code for an invalid
					// token — verified against a real run: `ksef-transport.ts`'s own auth-step wrapper
					// produces "KSeF authentication rejected (code 450: ...)", the Polish description
					// untranslated — only an actual round-trip to ksef-test.mf.gov.pl can produce this.
					expect(
						doc.lastActionError,
						"l'erreur enregistrée est le vrai rejet KSeF (code 450), pas un message générique",
					).to.match(/code 450/);
					expect(
						doc.transportRef,
						"aucune référence de session/facture sans soumission acceptée",
					).to.not.be.a("string");
				});
		});
	});

	it("disconnects the KSeF channel via the screen", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-ksef-status"]', { timeout: 15000 }).should(
			"contain.text",
			"Connected",
		);
		// `force: true` on both clicks — the trigger sits inside a `Tooltip`+`DropdownMenu`
		// pair, and Cypress's own visibility heuristic false-negatives on a Radix portal'd
		// popover this far down a tall page (it reads the popper's `position: fixed`
		// ancestor as "overflowed", even though the item is genuinely on screen).
		cy.get('[data-cy="channel-ksef-menu"]').scrollIntoView().click({ force: true });
		cy.get('[data-cy="channel-ksef-disconnect-button"]').should("exist").click({ force: true });

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Channel disconnected",
		);
		cy.get('[data-cy="channel-ksef-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Not connected",
		);

		// The toast/badge pair above only proves the SCREEN'S OWN local state changed — an optimistic
		// UI update ahead of a server-side failure would look identical. Read the row back from the
		// API, the same proof the PDP disconnect test above already holds for this exact button.
		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then((body: { configured: { providerId: string }[] }) => {
				expect(
					body.configured.find((c) => c.providerId === "ksef"),
					"plus aucune ligne ksef en base — un disconnect complet, pas juste isActive:false",
				).to.be.undefined;
			});
	});

	// ── Wave 2: SdI (Italy) — same pattern as PDP, fake server (closed port) — a real SOAP
	// client now exists (`sdicoop-client.ts`, "implemented-awaiting-accreditation") ──

	it("an ITALIAN company sees SdI as a MANDATED channel (not merely suggested) on the channels screen — the data comes from data/it.json, never an `if`", () => {
		// Armed on 2026-09-13 (D.Lgs. 127/2015 art. 1 comma 3, `mandatedFrom: '2019-01-01'` —
		// see data/it.json's own `provenance`/`notes`): the "suggested" badge stays true (a mandate
		// reinforces a suggestion, it does not contradict it — the same convention as PDP/France,
		// already proven by 32-channel-mandate.cy.ts), and the "mandated" badge now appears too.
		//
		// VAT + LEGAL_ID (Codice Fiscale) — the same pair `scenarios/full-lifecycle.cy.ts` already uses
		// for its own `it-pt` leg's Italian seller — needed for the FatturaPA send further down
		// (`fatturapa-provider.ts` reads both off the seller company), not for this suggestion check
		// itself; set once, here, since the company STAYS Italy for the rest of this wave (see this
		// file's own header, point 1).
		setCompanyCountry("Italy", "IT", [
			{ scheme: "VAT", value: "IT01234567897" },
			{ scheme: "LEGAL_ID", value: "11223344554" },
		]);
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-sdi"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-sdi-suggested"]').should("exist");
		cy.get('[data-cy="channel-sdi-mandated"]', { timeout: 10000 })
			.should("exist")
			.and("contain.text", "2019-01-01");
		cy.get('[data-cy="channel-pdp-suggested"]').should("not.exist");
	});

	it('connects the SdI channel via the screen with fake credentials — status "Connected"', () => {
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-sdi"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-sdi-status"]').should(
			"contain.text",
			"Not connected",
		);

		cy.get('[data-cy="channel-sdi-idtrasmittente-input"]')
			.clear()
			.type(FAKE_SDI.idTrasmittente);
		cy.get('[data-cy="channel-sdi-endpoint-input"]')
			.clear()
			.type(FAKE_SDI.endpoint);
		cy.get('[data-cy="channel-sdi-certificate-input"]')
			.clear()
			.type(FAKE_SDI.certificate);
		cy.get('[data-cy="channel-sdi-certificatepassword-input"]')
			.clear()
			.type(FAKE_SDI.certificatePassword);
		cy.get('[data-cy="channel-sdi-connect-button"]').click();

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Channel connected",
		);
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Connected",
		);

		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then(
				(body: {
					configured: {
						providerId: string;
						isActive: boolean;
						environment: string;
					}[];
				}) => {
					const sdi = body.configured.find((c) => c.providerId === "sdi");
					expect(sdi, "le canal sdi est bien en base, actif").to.include({
						isActive: true,
						environment: "TEST",
					});
				},
			);
	});

	it("picks sdi as the invoicing transport, on the company settings screen", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', {
			timeout: 15000,
		}).click();
		cy.get('[data-cy="company-invoice-transport-options"]', {
			timeout: 10000,
		}).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-sdi"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);

		cy.request({ url: `${api}/api/company/info` })
			.its("body")
			.then((company: { invoiceTransportId: string }) => {
				expect(
					company.invoiceTransportId,
					"le transport choisi est bien enregistré",
				).to.eq("sdi");
			});
	});

	it('sends an invoice via SdI → the queue really fails (fake server, closed port) and "send_failed" names the channel', () => {
		createInvoiceDraft("22").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.runDocumentRowAction(invoiceId, "send");

			// Same budget as the PDP test above — see its comment: a closed-port connect (SdI's fake
			// server here, same as PDP's) was assumed near-instant when 40000ms was chosen; measured
			// ~10-13s per attempt on CI instead. 40-b2g-routing.cy.ts's own SdI test passed at
			// 37983ms out of the old 40000ms on 2026-09-14 — under 5% of margin, not a real one.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 90000 })
				.find('[data-cy="document-status-badge"]', { timeout: 90000 })
				.should("contain.text", "Send failed");

			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should(
				"contain.text",
				"SdI",
			);

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(
						doc.status,
						'la facture est réellement "send_failed" en base',
					).to.eq("send_failed");
					expect(
						doc.lastActionError,
						"l'erreur enregistrée nomme le canal SdI",
					).to.match(/SdI/);
					expect(
						doc.transportRef,
						"aucune référence idSdI sans soumission acceptée",
					).to.not.be.a("string");
				});
		});
	});

	it("disconnects the SdI channel via the screen", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 15000 }).should(
			"contain.text",
			"Connected",
		);
		// `force: true` on both clicks — the trigger sits inside a `Tooltip`+`DropdownMenu`
		// pair, and Cypress's own visibility heuristic false-negatives on a Radix portal'd
		// popover this far down a tall page (it reads the popper's `position: fixed`
		// ancestor as "overflowed", even though the item is genuinely on screen).
		cy.get('[data-cy="channel-sdi-menu"]').scrollIntoView().click({ force: true });
		cy.get('[data-cy="channel-sdi-disconnect-button"]').should("exist").click({ force: true });

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Channel disconnected",
		);
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Not connected",
		);

		// The toast/badge pair above only proves the SCREEN'S OWN local state changed — an optimistic
		// UI update ahead of a server-side failure would look identical. Read the row back from the
		// API, the same proof the PDP disconnect test above already holds for this exact button.
		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then((body: { configured: { providerId: string }[] }) => {
				expect(
					body.configured.find((c) => c.providerId === "sdi"),
					"plus aucune ligne sdi en base — un disconnect complet, pas juste isActive:false",
				).to.be.undefined;
			});
	});

	// ── Wave 3: Chorus Pro (France, B2G) — see this file's own header for the assumed difference
	// (fixed PISTE hosts, never a configuration field → fake credentials sent to the REAL public
	// sandbox, which really rejects them) ──

	it('connects the chorus-pro channel via the screen with fake credentials — status "Connected"', () => {
		// Chorus Pro is the FRENCH B2G channel: the company must be in France for the rest of the
		// group (transport choice, send → PISTE rejection) to exercise the right routing. Made
		// explicit here since the 5-country prune (the Peppol/BE group that fixed a country just
		// before this one was removed). The Polish/Italian VAT the two waves above set (see this
		// file's own header, point 1) overwrote the SEEDED French company's own VAT in place
		// (`@@unique([companyId, scheme])`) — restored here alongside its SIRET, both the exact values
		// `support/commands.ts#resetAndSeed` gave this company originally.
		setCompanyCountry("France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000074" },
			{ scheme: "VAT", value: "FR44732829320" },
		]);
		cy.visit("/settings/channels");

		cy.get('[data-cy="channel-chorus-pro"]', { timeout: 15000 }).should(
			"exist",
		);
		cy.get('[data-cy="channel-chorus-pro-status"]').should(
			"contain.text",
			"Not connected",
		);

		cy.get('[data-cy="channel-chorus-pro-clientid-input"]')
			.clear()
			.type(FAKE_CHORUS_PRO.clientId);
		cy.get('[data-cy="channel-chorus-pro-clientsecret-input"]')
			.clear()
			.type(FAKE_CHORUS_PRO.clientSecret);
		cy.get('[data-cy="channel-chorus-pro-technicalaccountlogin-input"]')
			.clear()
			.type(FAKE_CHORUS_PRO.technicalAccountLogin);
		cy.get('[data-cy="channel-chorus-pro-technicalaccountpassword-input"]')
			.clear()
			.type(FAKE_CHORUS_PRO.technicalAccountPassword);
		// Environment left on "Test (sandbox)" — that is precisely what points to the REAL
		// sandbox-oauth.piste.gouv.fr (see this file's own header, Wave 3).
		cy.get('[data-cy="channel-chorus-pro-connect-button"]').click();

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Channel connected",
		);
		cy.get('[data-cy="channel-chorus-pro-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Connected",
		);

		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then(
				(body: {
					configured: {
						providerId: string;
						isActive: boolean;
						environment: string;
					}[];
				}) => {
					const chorusPro = body.configured.find(
						(c) => c.providerId === "chorus-pro",
					);
					expect(
						chorusPro,
						"le canal chorus-pro est bien en base, actif",
					).to.include({
						isActive: true,
						environment: "TEST",
					});
				},
			);
	});

	it("picks chorus-pro as the invoicing transport, on the company settings screen", () => {
		cy.visit("/settings/company");
		cy.get('[data-cy="company-invoice-transport-select"]', {
			timeout: 15000,
		}).click();
		cy.get('[data-cy="company-invoice-transport-options"]', {
			timeout: 10000,
		}).should("be.visible");
		cy.get('[data-cy="company-invoice-transport-option-chorus-pro"]').click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(2000);

		cy.request({ url: `${api}/api/company/info` })
			.its("body")
			.then((company: { invoiceTransportId: string }) => {
				expect(
					company.invoiceTransportId,
					"le transport choisi est bien enregistré",
				).to.eq("chorus-pro");
			});
	});

	it('sends an invoice via chorus-pro → the queue really fails (fake PISTE credentials rejected by the real sandbox-oauth.piste.gouv.fr) and "send_failed" names the channel', () => {
		// `chorus-pro-transport.ts` refuses BEFORE ever reaching PISTE when the RECIPIENT has no
		// SIRET/SIREN on file (it identifies every Chorus Pro recipient by that number) — the seeded
		// baseline client (`support/commands.ts#resetAndSeed`) has none. Setting one here is what lets
		// this test actually reach the real PISTE rejection it claims to prove, rather than stopping one
		// gate earlier at a DIFFERENT, generic-sounding 400 that the OLD, loose `/Chorus Pro/` match
		// would have hidden.
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string; label: string }[]) => {
				cy.request({
					method: "PATCH",
					url: `${api}/api/clients/${clients[0].id}`,
					// `EditClientsDto` validates a company client's "name" even on a partial PATCH — the
					// seeded client's own name, unchanged, plus the one field this test actually adds.
					body: { name: clients[0].label, identifiers: [{ scheme: "LEGAL_ID", value: "73282932000074" }] },
				}).then((res) => expect(res.status, "SIRET client enregistré").to.be.oneOf([200, 201]));
			});

		// A SECOND, SEPARATE preflight gate — verified against a real run — refuses just as early when
		// the SELLER has no active payment method: "a public-sector invoice is always paid by bank
		// transfer to the supplier's own account". Enabling "Bank transfer" with a real-shaped IBAN is
		// what lets this test clear THIS gate too, on top of the client's own SIRET above.
		cy.request({
			method: "PATCH",
			url: `${api}/api/payment-methods/bank_transfer`,
			body: { enabled: true, config: { iban: "FR1420041010050500013M02606" } },
		}).then((res) => expect(res.status, "moyen de paiement bank_transfer activé").to.be.oneOf([200, 201]));

		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.runDocumentRowAction(invoiceId, "send");

			// Same budget as the PDP/KSeF/SdI tests above — see their comment for why it is
			// 90000ms, not 40000ms. The real PISTE rejection is in practice near-instant (probed by
			// hand: well under a second) — that part holds — but 40-b2g-routing.cy.ts's own
			// chorus-pro test measured ~11-12s of preamble before each of the 3 attempts even reaches
			// PISTE on CI, pushing the total to 42s (over the old 40000ms budget) on 2026-09-14.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 90000 })
				.find('[data-cy="document-status-badge"]', { timeout: 90000 })
				.should("contain.text", "Send failed");

			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should(
				"contain.text",
				"Chorus Pro",
			);

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(
						doc.status,
						'la facture est réellement "send_failed" en base',
					).to.eq("send_failed");
					// Same tightening as the KSeF test above — `/Chorus Pro/` alone would also match a
					// broken `CHORUS_PRO_URLS` entry or a sandboxed runner with no egress at all.
					// `choruspro-client.ts` names the PISTE sandbox's own real rejection as an HTTP status
					// (verified by hand — see this file's own header, "Wave 3": a genuine
					// `HTTP 400 {"error":"invalid_client"}`), which only an actual round-trip to
					// sandbox-oauth.piste.gouv.fr can produce.
					expect(
						doc.lastActionError,
						"l'erreur enregistrée est le vrai rejet PISTE (HTTP 400), pas un message générique",
					).to.match(/HTTP 400/);
					expect(
						doc.transportRef,
						"aucun numeroFluxDepot sans dépôt accepté",
					).to.not.be.a("string");
				});
		});
	});

	it("disconnects the chorus-pro channel via the screen", () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-chorus-pro-status"]', { timeout: 15000 }).should(
			"contain.text",
			"Connected",
		);
		// `force: true` on both clicks — the trigger sits inside a `Tooltip`+`DropdownMenu`
		// pair, and Cypress's own visibility heuristic false-negatives on a Radix portal'd
		// popover this far down a tall page (it reads the popper's `position: fixed`
		// ancestor as "overflowed", even though the item is genuinely on screen).
		cy.get('[data-cy="channel-chorus-pro-menu"]').scrollIntoView().click({ force: true });
		cy.get('[data-cy="channel-chorus-pro-disconnect-button"]').should("exist").click({ force: true });

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Channel disconnected",
		);
		cy.get('[data-cy="channel-chorus-pro-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Not connected",
		);

		// The toast/badge pair above only proves the SCREEN'S OWN local state changed — an optimistic
		// UI update ahead of a server-side failure would look identical. Read the row back from the
		// API, the same proof the PDP disconnect test above already holds for this exact button.
		cy.request({ url: `${api}/api/company/channels` })
			.its("body")
			.then((body: { configured: { providerId: string }[] }) => {
				expect(
					body.configured.find((c) => c.providerId === "chorus-pro"),
					"plus aucune ligne chorus-pro en base — un disconnect complet, pas juste isActive:false",
				).to.be.undefined;
			});
	});
});
