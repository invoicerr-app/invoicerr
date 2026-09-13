/**
 * B2G routing (`backend/src/modules/documents/b2g-routing/`) — a client marked GOVERNMENT
 * (`Client.kind`) changes which channel/format an invoice addressed to it MUST use, per THAT
 * CLIENT's OWN country — never the seller's, and never overridable by the company's own free
 * transport choice or by the seller-country mandate (see
 * `actions/invoice-actions.ts`'s own precedence header).
 *
 * Same discipline as 31/32/35: the ACTION passes by a real click on screen (create the client,
 * click "Send", click the XML download button) ; the ASSERTIONS that matter reread the record via
 * the API, or intercept the real network request the click triggers — never the screen alone as
 * proof of what was decided or sent.
 *
 * PRUNE 2026-09-10 (product narrowed to FR/PL/IT/PT/DE): the GOVERNMENT BE/NL/ES cases below were
 * REMOVED (their b2g-routing data deleted). What stays proven on screen: FR (chorus-pro), DE
 * (peppol/xrechnung), IT (SdI), plus the US negative (no B2G rule). The ES/NL/BE paragraphs that
 * follow are HISTORICAL — kept for the model's thesis, no longer exercised by a test.
 *
 * Four countries, four shipped rules, four different shapes of proof:
 *  - FR (Chorus Pro): **REINFORCED** — `transportId: "chorus-pro"` used to name a channel absent from
 *    `transport-registry.ts` (the thesis of this whole model: a rule may legitimately name a channel
 *    not implemented yet), so sending BLOCKED, synchronously, at the preflight. The
 *    channel now EXISTS (`transports/chorus-pro-transport.ts`) — this is the mechanism PROGRESSING,
 *    not weakening: a company that connects chorus-pro (fictitious PISTE credentials, same discipline
 *    31's own wave 3 already established) gets a REAL asynchronous send attempt, exactly the IT/SdI
 *    shape below, which genuinely fails against the real PISTE sandbox (never a silent success, never
 *    a silent email fallback) — the refusal moved from "this channel does not exist" to "this channel
 *    exists, is connected, and a real network attempt through it failed", a STRICTER proof than a
 *    static block ever was. The ORIGINAL "not connected" shape (chorus-pro registered but no channel
 *    connected) is NOT re-proven here at the screen level — it is the exact same `NotImplementedException`
 *    shape `chorus-pro-transport.spec.ts`'s own preflight tests already cover exhaustively (jest), and
 *    the identical wiring `invoice-b2g-routing.spec.ts`'s own "channel IS chosen but its OWN preflight
 *    refuses" test already proves for the (structurally identical) IT/sdi case.
 *  - DE (the federal e-invoicing portal, ZRE/OZG-RE): "the German B2G gap" — **REINFORCED**, same
 *    progression as FR/chorus-pro above. `transportId` used to be `"zre-ozgre"`, a channel absent from
 *    `transport-registry.ts` (the thesis of this whole model: a rule may legitimately name a channel
 *    not implemented yet — §4 Abs. 3 ERechV requires a PORTAL deposit, not email, so sending BLOCKED,
 *    synchronously, at the preflight, naming exactly that missing channel). It now routes to
 *    `transportId: "peppol"` — an ALREADY IMPLEMENTED channel — carrying `formatSyntax: "xrechnung"`
 *    via that transport's OWN format override (`transports/peppol-transport.ts`'s own header, "THE
 *    FORMAT OVERRIDE"; `b2g-routing/data/de.json`'s own ADDENDUM for the full, sourced resolution: the
 *    federal portal accepts Peppol as a CHANNEL, but XRechnung remains the CONTENT the law names,
 *    regardless of channel). This suite never connects a Peppol channel for Acme Corp, so the block
 *    persists — but its SHAPE changed, and this is the mechanism PROGRESSING, not weakening, EXACTLY
 *    like FR/chorus-pro: the refusal moved from "this channel does not exist at all" (a static,
 *    load-time block) to "this channel EXISTS but is not connected for this company" (the SAME
 *    `NotImplementedException` shape `peppol-transport.spec.ts`'s own preflight tests already cover
 *    exhaustively, jest) — a STRICTER, more honest proof, never a silent fall-back to email or to
 *    Peppol BIS. GENUINE STRUCTURAL LIMIT still holds, UNCHANGED: `download-xml` is only
 *    `availableWhen: ['sending', 'sent', 'send_failed']` (`invoice.descriptor.ts`'s own numbering
 *    paragraph — a "draft" has no invoice NUMBER yet, and BT-1 needs one) — and a B2G-blocked
 *    country's invoice NEVER reaches any of those three statuses (the whole point of blocking at the
 *    PREFLIGHT, before anything is persisted). So there is no screen path to ever download an
 *    XRechnung for a government invoice whose channel is connected-but-not-configured — proving the
 *    Leitweg-ID/BR-DE-15 mechanism AND the format-override/CustomizationID mechanism end-to-end stay
 *    JEST-level guarantees (`formats/xrechnung-provider.spec.ts`, `transports/peppol-transport.spec.
 *    ts`'s own "THE FORMAT OVERRIDE" block, `actions/invoice-b2g-de-peppol-send.spec.ts`'s own
 *    service-level proof, `documents.service.country-fields.spec.ts`'s own B2G field-hint block), not
 *    an E2E artifact. This spec proves what IS reachable on screen for DE: the client-side help panel,
 *    and the named channel block. A SEPARATE test below ("the Leitweg-ID field … appears REACTIVELY")
 *    closes the OTHER named gap (`document-form.tsx`'s own screen wiring, `use-document-types.ts`'s
 *    `clientId`-aware descriptor fetch): the field ITSELF, appearing and disappearing on the invoice
 *    FORM as the user picks a client, never just at the service level. The structural
 *    limit above still holds for it too — it proves the field on screen and the SAME named block,
 *    never a downloaded XRechnung (still a JEST-only guarantee, same citation).
 *  - IT (SdI): the ONE rule whose channel is ALREADY implemented. The company's own free choice is
 *    deliberately set to "email" (a channel that WOULD succeed) to prove precedence for real: the
 *    invoice still fails via SdI (a fake, unreachable endpoint — same fixture as 31's own SdI wave),
 *    never silently through email.
 *  - ES (FACe): a SECOND rule whose channel was ALREADY implemented (XAdES wiring + Ley 25/2013) — same
 *    "email" precedence proof as IT/FR, but a DIFFERENT shape of failure: FACe additionally required a
 *    Facturae SIGNED with XAdES, and this suite never configured a signing certificate, so the send
 *    failed at that LOCAL signature gate, before any network attempt against the real FACe sandbox —
 *    still a REAL, meaningful proof, arguably the more relevant one for the XAdES thesis: the first
 *    real consumer of the XAdES provider was wired end-to-end, through the actual screen, all the way
 *    to a company that never set up a certificate correctly being refused rather than silently sent
 *    unsigned. ES was also the FIRST rule in this file whose `requiredDocumentFields` named THREE
 *    fields at once (the DIR3 triad: órgano gestor/unidad tramitadora/oficina contable) rather than
 *    DE's single Leitweg-ID, proving the reactive on-screen field mechanism scales to three without any
 *    code change (`applyB2gDocumentFieldHints`'s own generic `requiredDocumentFields.map(...)` bridge).
 *    The FACe channel, its XAdES signing gate, and this DIR3 field set were deleted outright along with
 *    the rest of Spain's scope (2026-09-10, see `LIVE_TESTING.md`/`B2G_COVERAGE.md`) — nothing above is
 *    exercised by code any more; this paragraph stays only for the model's thesis.
 *  - NL (Peppol, NLCIUS content — vendored): structurally closer to BE than to DE at the SCREEN level —
 *    the "peppol" channel was ALREADY implemented, so (like BE) this test CONNECTED it (fictitious
 *    credentials, closed port — same fixture as BE/31's own Peppol wave) and proved the B2G precedence
 *    over the company's free "email" choice with a REAL network failure, never a preflight block the
 *    way DE stays in this suite. Content-wise it mirrored DE instead — a vendored NATIONAL CIUS carried
 *    via the SAME `formatOverride` mechanism, never a generic Peppol BIS substitute. The KVK-nummer
 *    (LEGAL_ID) was required for every Dutch client — same "nothing new to add on screen for this
 *    field" precedent as FR's own SIRET. The provider, its vendored Schematron delta, the format
 *    override, and the KVK requirement were all deleted outright along with the rest of the
 *    Netherlands' scope (2026-09-10, see `LIVE_TESTING.md`/`B2G_COVERAGE.md`) — nothing above is
 *    exercised by code any more; this paragraph stays only for the model's thesis, exactly like ES
 *    above.
 *
 * `cy.resetAndSeed()` seeds a FRENCH company (Acme Corp, SIRET/VAT already on file) — this file adds
 * an IBAN to it via the API before the DE case (BR-DE-1/23-a/23-b's own requirement, see
 * `formats/xrechnung-provider.ts`'s header) — the ONE piece Acme Corp's own seed doesn't carry, and
 * genuinely a company-level fact, not a per-invoice one.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const FAKE_SDI = {
	idTrasmittente: "IT01234567890",
	endpoint: "https://127.0.0.1:1/ricevi_file",
	certificate: "ZTJlLWZha2UtcGZ4LWNvbnRlbnRz",
	certificatePassword: "e2e-fake-cert-password",
};

/** Chorus Pro (FR) — same discipline as `31-national-channels.cy.ts`'s own "Vague 3": PISTE's OAuth
 *  hosts are fixed by environment, never a user-editable field, so these fictitious credentials reach
 *  the REAL public sandbox (`sandbox-oauth.piste.gouv.fr`) and are rejected for real (`HTTP 400
 *  invalid_client`) — never a closed port. See that file's own header for the manual verification. */
const FAKE_CHORUS_PRO = {
	clientId: "e2e-fake-piste-client-id",
	clientSecret: "e2e-fake-piste-client-secret",
	technicalAccountLogin: "TECH_1_e2e-fake@cpro.fr",
	technicalAccountPassword: "e2e-fake-tech-password",
};

function setInvoiceTransport(transportId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: transportId },
		})
		.then((res) => {
			expect(res.status, "transport configured").to.be.oneOf([200, 201]);
		});
}

// A plain BUSINESS client, created via the API — baseline data for the Leitweg-ID reactivity test
// below, never the subject of that test itself (same "create the setup by API, drive only the
// actual delta through the screen" convention 20-document-totals.cy.ts's own discount test already
// documents).
function createBusinessClient(name: string) {
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
			expect(res.status, "client BUSINESS créé par API").to.be.oneOf([
				200, 201,
			]);
			const id = res.body?.id as string;
			expect(id, "le client créé a un identifiant").to.be.a("string");
			return id;
		});
}

function findClientIdByName(name: string) {
	return cy
		.request({
			url: `${api}/api/documents/references/client/search?q=${encodeURIComponent(name)}`,
		})
		.its("body")
		.then((clients: { id: string; label: string }[]) => {
			const client = clients.find((c) => c.label.includes(name));
			expect(
				client,
				`le client "${name}" créé ci-dessus se retrouve par la recherche`,
			).to.exist;
			return client!.id;
		});
}

function createInvoiceDraft(
	clientId: string,
	extraData: Record<string, unknown> = {},
) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate: "2026-09-15",
					dueDate: "2026-10-15",
					currency: "EUR",
					lines: [
						{
							description: "Conseil",
							quantity: 1,
							unit: "day",
							unitPrice: 1000,
							vatRate: "20",
						},
					],
					...extraData,
				},
			},
			failOnStatusCode: false,
		})
		.then((saved) => {
			expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
			const invoiceId = saved.body?.document?.id as string;
			expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");
			return invoiceId;
		});
}

describe("B2G routing — the GOVERNMENT client imposes the channel/format of ITS OWN COUNTRY, never the company's", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("a BUSINESS client (the default) shows NO B2G hint at all — regression: nothing changes for it", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[data-cy="client-kind-select"]').should("contain.text", "Business");
		cy.get('[data-cy="client-b2g-hint"]').should("not.exist");

		cy.get("body").type("{esc}");
	});

	it("FR — a GOVERNMENT client shows the Chorus Pro hint, then sending forces the chorus-pro channel (connected, fake PISTE credentials) and genuinely fails, never a silent send through email", () => {
		// REINFORCEMENT (see this file's own header): chorus-pro now EXISTS
		// (`transports/chorus-pro-transport.ts`) — it is connected through the screen, exactly like 31's
		// own "Wave 3" already does, BEFORE creating the client/invoice. The company picks "email" (a
		// channel that WOULD genuinely work, Mailpit) — B2G precedence must ignore it completely,
		// exactly the same pattern as the IT/SdI case further down this file.
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-chorus-pro"]', { timeout: 15000 }).should(
			"exist",
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
		cy.get('[data-cy="channel-chorus-pro-connect-button"]').click();
		cy.get('[data-cy="channel-chorus-pro-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Connected",
		);

		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Mairie de Testville");
		cy.selectCountry("client-country-select", "France");

		cy.get('[data-cy="client-kind-select"]').click();
		cy.get('[data-cy="client-kind-government"]').click();

		// The B2G hint — never a wall: the client is created normally, the hint just says what
		// awaits the sending of an invoice to this client.
		cy.get('[data-cy="client-b2g-hint"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="client-b2g-hint-channel"]')
			.should("contain.text", "chorus-pro")
			.and("contain.text", "facturx");
		cy.get('[data-cy="client-b2g-hint"]').should(
			"contain.text",
			"Code de la commande publique",
		);

		// The SIRET — already required by the country-identifiers catalog for EVERY French client
		// (LEGAL_ID, appliesTo BOTH): the French B2G rule references it, it has nothing new to add
		// on screen for this specific field.
		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
			.clear()
			.type("21750001600017");

		cy.get('[name="contactEmail"]')
			.clear()
			.type("marches-publics@testville.example");
		cy.get('[name="address"]').clear().type("1 Place de la Mairie");
		cy.get('[name="postalCode"]').clear().type("75001");
		cy.get('[name="city"]').clear().type("Testville");
		cy.get('[data-cy="client-currency-select"] button')
			.scrollIntoView()
			.click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Mairie de Testville", { timeout: 10000 });

		findClientIdByName("Mairie de Testville").then((clientId) => {
			createInvoiceDraft(clientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, {
					timeout: 15000,
				}).click();

				// REINFORCEMENT (see this file's own header): the preflight now PASSES (chorus-pro is
				// registered AND connected) — B2G precedence still forces chorus-pro rather than
				// "email" (the company's free choice), exactly like the IT/SdI case further down. The
				// queue then GENUINELY fails, against the real PISTE sandbox (fake credentials,
				// HTTP 400 invalid_client) — never a silent success, never a send through email. Same
				// budget as 31's own chorus-pro/PDP/KSeF/SdI/Peppol tests.
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
					.find('[data-cy="document-status-badge"]', { timeout: 40000 })
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
							'la facture échoue réellement via Chorus Pro, jamais "sent" par email',
						).to.eq("send_failed");
						expect(
							doc.lastActionError,
							"l'erreur nomme Chorus Pro, jamais email",
						).to.match(/Chorus Pro/);
					});
			});
		});

		// Cleanup — leaves the channel disconnected so it does not pollute another spec that would
		// reread company/channels after this one (same discipline as 31's own last test and the IT
		// test further down this same file).
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-chorus-pro-status"]', { timeout: 15000 }).should(
			"contain.text",
			"Connected",
		);
		cy.get('[data-cy="channel-chorus-pro-disconnect-button"]').click();
		cy.get('[data-cy="channel-chorus-pro-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Not connected",
		);
	});

	// REINFORCED (see this file's own header): the "peppol" channel now EXISTS in this deployment —
	// this test's company never connects it, so sending still blocks, but the message no longer
	// names an absent channel ("zre-ozgre"): it names "peppol", not connected — the SAME
	// `NotImplementedException` that chorus-pro/IT/ES already hit before their own connection.
	it("DE — a GOVERNMENT client shows the federal portal hint, then sending blocks by name (the peppol channel exists but is not connected for this company), never a silent send through email", () => {
		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Stadt Testhausen");
		cy.selectCountry("client-country-select", "Germany");

		cy.get('[data-cy="client-kind-select"]').click();
		cy.get('[data-cy="client-kind-government"]').click();

		cy.get('[data-cy="client-b2g-hint"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="client-b2g-hint-channel"]')
			.should("contain.text", "peppol")
			.and("contain.text", "xrechnung");
		cy.get('[data-cy="client-b2g-hint"]').should("contain.text", "ERechV");
		cy.get('[data-cy="client-b2g-hint"]').should("contain.text", "Leitweg");

		cy.get('[name="contactEmail"]')
			.clear()
			.type("rechnungen@testhausen.example");
		cy.get('[name="address"]').clear().type("Rathausplatz 1");
		cy.get('[name="postalCode"]').clear().type("10117");
		cy.get('[name="city"]').clear().type("Testhausen");
		cy.get('[data-cy="client-currency-select"] button')
			.scrollIntoView()
			.click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Stadt Testhausen", { timeout: 10000 });

		findClientIdByName("Stadt Testhausen").then((clientId) => {
			// data.buyerReference (Leitweg-ID) — see this file's own header: the overlay/
			// buyerReference field exists generically (`shared-build.ts#extractBuyerReference`) and the
			// backend now also offers it on the creation screen as soon as a GOVERNMENT client is
			// chosen (`documents.service.ts#applyB2gDocumentFieldHints`, proved by
			// `documents.service.country-fields.spec.ts`) — but the invoice creation screen does not
			// yet wire the chosen client's id through to that lookup to offer it
			// INTERACTIVELY; set here via the API, as this field would once wired.
			createInvoiceDraft(clientId, {
				buyerReference: "04011000-1234512345-06",
			}).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				// The CHANNEL blocks, by name, SYNCHRONOUSLY at the preflight — never persisted past
				// "draft" (so never numbered — see this file's own header: this is exactly what makes
				// an XRechnung download unreachable from the screen for THIS document).
				// Never a silent send through email, whatever transport the company has chosen.
				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, {
					timeout: 15000,
				}).click();
				// REINFORCED: the toast no longer names "zre-ozgre" (an absent channel) but "peppol" (an
				// EXISTING channel, simply not connected for this company) — see this file's own
				// header.
				cy.get("[data-sonner-toast]", { timeout: 10000 })
					.should("contain.text", "peppol")
					.and("contain.text", "ERechV");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, 'jamais persisté au-delà de "draft"').to.eq(
							"draft",
						);
					});
			});
		});
	});

	// The gap named by 3cb39f91: the Leitweg field (`buyerReference`) was only proven at the SERVICE
	// LEVEL (`documents.service.country-fields.spec.ts`) — the creation form never passed the
	// selected client to the descriptor (`?clientId=`), so the field never appeared ON SCREEN,
	// whatever client was chosen. `document-form.tsx` now watches the form's "client" field and
	// re-runs `useDocumentType(typeId, clientId)` (`use-document-types.ts`) — this test proves it BY
	// SCREEN: the field is absent with a BUSINESS client, appears as soon as "Stadt Testhausen" (the
	// German GOVERNMENT client from the previous test, same file) is chosen — never a page reload.
	//
	// The starting draft is created by API with an ordinary BUSINESS client (baseline data — see
	// createBusinessClient's own header); ONLY the client change, filling in the Leitweg, and saving
	// go through the screen, exactly the portion this gap concerns. The XRechnung download itself
	// stays out of scope for THIS test — see this file's own header ("GENUINE STRUCTURAL LIMIT"): a
	// B2G rule blocked at the preflight never gets numbered, and "download-xml" requires a number; the
	// proof that this Leitweg-ID genuinely lands in BT-10 therefore stays at the Jest level
	// (`xrechnung-provider.spec.ts`, same value "04011000-1234512345-06").
	it("DE — the Leitweg-ID field (buyerReference) appears REACTIVELY on screen as soon as a German GOVERNMENT client is chosen in the form (never before, never for a BUSINESS client), with its sourced hint; sending still blocks by name — now on peppol, not connected", () => {
		setInvoiceTransport("email");

		createBusinessClient("Client Ordinaire SARL").then((businessClientId) => {
			createInvoiceDraft(businessClientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-edit-button-${invoiceId}"]`, {
					timeout: 15000,
				}).click();
				cy.get('[data-cy="document-edit-dialog"]', { timeout: 15000 }).should(
					"be.visible",
				);

				// BEFORE any change: the loaded client is BUSINESS — no Leitweg field on screen.
				cy.get('[data-cy="document-field-buyerReference"]').should("not.exist");

				// Change the client, ON SCREEN, to "Stadt Testhausen" — the German GOVERNMENT client
				// created by the previous DE test (same describe, same `before`, data preserved).
				cy.get('[data-cy="document-field-client-input"] button')
					.first()
					.click({ force: true });
				cy.get('[data-cy="document-field-client-input-options"]', {
					timeout: 10000,
				}).should("be.visible");
				cy.get('[data-cy="document-field-client-input"] input').type(
					"Stadt Testhausen",
				);
				cy.contains(
					'[data-cy="document-field-client-input-options"] button',
					"Stadt Testhausen",
					{ timeout: 10000 },
				).click();

				// REACTIVE, with no page reload: the field appears, with its `why` (the ERechV text)
				// sourced as a hint — never just a bare label. It is appended at the TAIL of the
				// descriptor (`applyFieldOverlay`'s own "add"), so it sits outside the dialog's own
				// visible frame until it is scrolled to — same pattern as the currency SearchSelect
				// elsewhere in this suite.
				cy.get('[data-cy="document-field-buyerReference"]', { timeout: 10000 })
					.scrollIntoView()
					.should("be.visible");
				cy.get('[data-cy="document-field-buyerReference"]').should(
					"contain.text",
					"ERechV",
				);

				cy.get('[data-cy="document-field-buyerReference-input"]')
					.scrollIntoView()
					.clear()
					.type("04011000-1234512345-06");

				// Waits for the REAL network request rather than the form's own visibility afterward
				// (the scrolling triggered by scrollIntoView above makes the latter flaky) — same
				// pattern as 20-document-totals.cy.ts's own discount test.
				cy.intercept(
					"POST",
					`${api}/api/documents/types/invoice/actions/save-draft`,
				).as("saveDraft");
				cy.get('[data-cy="document-action-save-draft"]')
					.scrollIntoView()
					.click();
				cy.wait("@saveDraft")
					.its("response.statusCode")
					.should("be.oneOf", [200, 201]);

				// Sending still blocks, by name — REINFORCED (this file's own header): now on "peppol"
				// (an EXISTING channel, simply not connected for this company), not "zre-ozgre" (an
				// absent channel) — THIS detour through the screen changes nothing about B2G
				// precedence; never a silent send through email.
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, {
					timeout: 15000,
				}).click();
				cy.get("[data-sonner-toast]", { timeout: 10000 })
					.should("contain.text", "peppol")
					.and("contain.text", "ERechV");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, 'jamais persisté au-delà de "draft"').to.eq(
							"draft",
						);
						// The client AND the Leitweg typed on screen are indeed the ones that got saved
						// — not just displayed for the length of a render.
						expect(
							doc.data?.client,
							"le nouveau client est bien celui enregistré",
						).to.not.eq(businessClientId);
						expect(
							doc.data?.buyerReference,
							"le Leitweg-ID tapé à l'écran est bien sauvegardé",
						).to.eq("04011000-1234512345-06");
					});
			});
		});
	});

	it("IT — a GOVERNMENT client requires the Codice Univoco Ufficio (IPA); sending forces SdI even though the company chose email, and genuinely fails (closed port), never through email", () => {
		// The SdI channel, connected through the screen, fake credentials (closed port — same fixture as 31).
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-sdi"]', { timeout: 15000 }).should("exist");
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
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Connected",
		);

		// The company chooses "email" — a channel that WOULD genuinely work (Mailpit). B2G precedence
		// must ignore it completely.
		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Comune di Testopoli");
		cy.selectCountry("client-country-select", "Italy");

		cy.get('[data-cy="client-kind-select"]').click();
		cy.get('[data-cy="client-kind-government"]').click();

		cy.get('[data-cy="client-b2g-hint"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="client-b2g-hint-channel"]')
			.should("contain.text", "sdi")
			.and("contain.text", "fatturapa");
		cy.get('[data-cy="client-b2g-hint"]').should(
			"contain.text",
			"Specifiche tecniche",
		);

		// The Codice Univoco Ufficio (IPA) — a NEW field, offered ONLY because this client is
		// GOVERNMENT (never for an ordinary Italian client — see b2g-routing/data/it.json).
		cy.get('[data-cy="client-identifier-IT_PA_CODE"]', { timeout: 10000 })
			.should("exist")
			.clear()
			.type("UFE0A1");

		cy.get('[name="contactEmail"]')
			.clear()
			.type("fatturazione@testopoli.example");
		cy.get('[name="address"]').clear().type("Via Roma 1");
		cy.get('[name="postalCode"]').clear().type("00100");
		cy.get('[name="city"]').clear().type("Testopoli");
		cy.get('[data-cy="client-currency-select"] button')
			.scrollIntoView()
			.click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Comune di Testopoli", { timeout: 10000 });

		findClientIdByName("Comune di Testopoli").then((clientId) => {
			createInvoiceDraft(clientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, {
					timeout: 15000,
				}).click();

				// Asynchronous (the B2G channel, sdi, IS implemented and connected): the queue genuinely
				// fails against the closed port — never a silent success through email.
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 40000 })
					.find('[data-cy="document-status-badge"]', { timeout: 40000 })
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
							'la facture échoue réellement via SdI, jamais "sent" par email',
						).to.eq("send_failed");
						expect(
							doc.lastActionError,
							"l'erreur nomme SdI, jamais email",
						).to.match(/SdI/);
					});
			});
		});

		// Cleanup — leaves the channel disconnected so it does not pollute another spec that would
		// reread company/channels after this one (same discipline as 31's own last test).
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 15000 }).should(
			"contain.text",
			"Connected",
		);
		cy.get('[data-cy="channel-sdi-disconnect-button"]').click();
		cy.get('[data-cy="channel-sdi-status"]', { timeout: 10000 }).should(
			"contain.text",
			"Not connected",
		);
	});

	it('a GOVERNMENT country with no declared B2G rule refuses honestly — never a silent B2B send (mutation guard #2, at the "screen" scale)', () => {
		setInvoiceTransport("email");

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Ministry of Nowhere");
		cy.selectCountry("client-country-select", "United States");

		cy.get('[data-cy="client-kind-select"]').click();
		cy.get('[data-cy="client-kind-government"]').click();

		// No B2G rule for US (b2g shipped: de/fr/it/pl only; US removed at the prune) — the hint says so honestly.
		cy.get('[data-cy="client-b2g-hint-no-rule"]', { timeout: 10000 }).should(
			"be.visible",
		);

		// US no longer has a country-identifiers file since the prune → no LEGAL_ID field to fill in
		// (invoicing a GOVERNMENT buyer outside the 5 supported countries remains legitimate). The
		// point of this test is the B2G refusal below ("No B2G routing rule is declared for US"),
		// never the identifier.
		cy.get('[name="contactEmail"]').clear().type("procurement@nowhere.example");
		cy.get('[name="address"]').clear().type("1 Federal Plaza");
		cy.get('[name="postalCode"]').clear().type("10001");
		cy.get('[name="city"]').clear().type("Nowhere City");
		cy.get('[data-cy="client-currency-select"] button')
			.scrollIntoView()
			.click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Dollar");
		cy.get(
			'[data-cy="client-currency-select-option-united-states-dollar-($)"]',
		).click();

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Ministry of Nowhere", { timeout: 10000 });

		findClientIdByName("Ministry of Nowhere").then((clientId) => {
			createInvoiceDraft(clientId).then((invoiceId) => {
				cy.visit("/documents/invoice");
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
					.find('[data-cy="document-status-badge"]')
					.should("contain.text", "Draft");

				cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, {
					timeout: 15000,
				}).click();

				cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
					"contain.text",
					'No B2G routing rule is declared for "US"',
				);

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(
							doc.status,
							"jamais un envoi B2B silencieux pour un pays non couvert",
						).to.eq("draft");
					});
			});
		});
	});
});
