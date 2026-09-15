import { SCENARIOS, Scenario } from "../../fixtures/scenarios";

/**
 * The per-country business-scenario spec `.github/workflows/scenarios.yml` names — RESTORED after the
 * compliance-engine demolition (`fffbae77`, tag `avant-refonte-documents`) that removed both the old
 * version of this file AND the engine it was written against (`backend/src/compliance/`: one
 * `CountryComplianceProfile` per country, resolved into a `CompliancePlan`, executed by an assembled
 * lifecycle graph). What replaced it — `backend/src/modules/documents/` — has a DELIBERATELY different
 * shape: about a dozen narrow, independent catalogs (`country-policy/`, `country-identifiers/`,
 * `correction-routes/`, `transports/channel-policy/`, `tax/`, …), each with its own `data/<cc>.json`,
 * and ONE generic, country-blind document status machine — see CLAUDE.md's "documents module" section
 * for the full map. This file's OLD version (recoverable at `fffbae77^`) is readable for structure and
 * intent only: almost every assertion it made reached for shapes (`/api/invoices/...`,
 * `complianceDocuments[0].status`, a single-step onboarding dialog) that no longer exist. Nothing
 * below is a resurrection of that file — it is written fresh against the catalogs actually loaded
 * today, verified leg by leg against `tax/tax-engine.ts`, `transports/channel-policy/data/*.json` and
 * `correction-routes/data/*.json` themselves rather than against what the old engine, or this
 * fixture's own narrative comments (written for THAT engine), assumed they would say.
 *
 * ## Why several of this file's outcomes contradict `../../fixtures/scenarios.ts`'s own comments
 *
 * `scenarios.ts` was updated for the 5-country prune (2026-09-10) but its per-scenario tax narration
 * ("standard-rated cross-border", "seller's own standard rate") still describes the REMOVED engine's
 * behavior, not `tax/tax-engine.ts`'s actual cascade. Recomputing each leg by hand against that engine
 * (composing the seller's and buyer's own `tax-systems/data/*.json`, `tax/classification.ts`'s
 * `EU_MEMBERS`/`taxUnionOf`, and `tax/vat-syntax.ts`'s per-country checksum) found:
 *
 *  - `de-fr` and `it-pt` are declared "at the seller's own standard rate, not reverse-charged" — but a
 *    checksum-VALID buyer VAT number, cross-border, same union, GOODS or SERVICES, ALWAYS reverse-
 *    charges or zero-rates in `tax-engine.ts#determineLineTax` (§2). `de-fr`'s own buyer VAT number,
 *    "FR12345678901", in fact fails `validateFrVat`'s own key checksum (SIREN 345678901 → expected key
 *    15, given key 12) — the resulting B2C/OSS treatment (§below) is real, but for a DIFFERENT reason
 *    than the fixture's comment claims, and this file asserts THAT reason, not the comment's.
 *  - `it-pt`'s buyer VAT ("PT501442600") hits `vat-syntax.ts`'s DEFAULT branch (Portugal has no
 *    dedicated checksum function — only FR/IT/DE/ES/PL do) which always answers `valid: true`: this
 *    buyer is genuinely B2B with a confirmed VAT, so `it-pt` reverse-charges/zero-rates (GOODS →
 *    category K, intra-Community supply, 0%) — never "seller's own rate".
 *  - `pt-de`'s buyer VAT ("DE812000006") IS checksum-valid (verified against `validateDeVat`'s ISO
 *    7064 Mod 11,10 by hand) — SERVICES, B2B, same union → Art. 196 reverse charge, 0%, exactly like
 *    `fr-pl`, not the "standard 23%" the fixture's comment assumes.
 *  - `pl-de`'s B2C OSS destination charge (Germany's own 19%, `tax-systems/data/de.json`) is the ONE
 *    leg whose fixture comment already matches what the engine actually does.
 *
 * None of this is asserted from memory: every rate/category below is traced to the exact JSON file or
 * `vat-syntax.ts` function that produces it, cited inline at the point of assertion.
 *
 * ## Three real defects this file's own run found (it-pt AND pl-de) — all three now FIXED, each
 * assertion below pins the SUCCESSFUL outcome the fix produces, with its own citation
 *
 * This file's initial run found two independent bugs, neither predicted at design time, and — once
 * both were fixed — a third, narrower one hiding behind them:
 *
 *  1. **Any seller whose country has no `country-identifiers/data/<cc>.json` file (today: Italy,
 *     Poland) loses its own LEGAL_ID identifier the moment company settings are saved** — a
 *     completely ordinary action this file's own `before()` hook takes for every leg (filling in
 *     phone/address/currency), not something contrived to trigger this. `company.settings.tsx`'s own
 *     "sync identifiers with the country catalog" effect deleted every identifier whose scheme was not
 *     in `requiredIdentifiers` — WITH NO EXCEPTION. `onboarding.tsx`'s own near-identical effect
 *     protected `scheme === "LEGAL_ID"` from that exact removal (its own comment: "LEGAL_ID is always
 *     collected in Step 2 ... never drop it here just because that catalog stays silent") — the
 *     settings-page effect had no such guard, so a country with an EMPTY `requiredIdentifiers` (IT,
 *     PL) had its LEGAL_ID deleted on the very next save. FIXED, then GENERALIZED past the one-scheme
 *     special case: both effects now keep ANY identifier that carries a value, whatever its scheme,
 *     instead of special-casing `LEGAL_ID` alone — a scheme a catalog required yesterday and drops
 *     today (or, like `VAT` for IT/PL before fix 3 below, never declared at all) must never vanish from
 *     a saved company with no warning. `company.settings.tsx` also now shows any such "kept, not
 *     currently required" identifier explicitly (`company-identifiers-on-file`), so a user removes one
 *     on purpose instead of losing it by accident.
 *  2. **`build-semantic-invoice.ts` never built a "Deliver to" country (BT-80) for ANY invoice** — a
 *     gap carried over, unfixed, from the old removed model (only `cac:Delivery/
 *     cbc:ActualDeliveryDate`, BT-72, was ever built). EN 16931's BR-IC-12 conditions this on the VAT
 *     category being "Intra-Community supply" (category K) specifically — `it-pt` is the only one of
 *     these six legs whose tax composition reaches that category, so it is the only leg BR-IC-12 ever
 *     fired for; it would fire for ANY country pair reaching category K, not just this one. FIXED:
 *     `build-semantic-invoice.ts` now builds `cac:Delivery/cac:DeliveryLocation` (BT-80) with the
 *     buyer's own country whenever a line resolves to category K, and only then.
 *  3. **A seller in a country with no `country-identifiers/data/<cc>.json` file (Italy, Poland — the
 *     exact same gap defect 1 lived in) had NO WAY AT ALL, in either onboarding or company settings, to
 *     record a `VAT`-scheme identifier for itself.** Re-running `it-pt` and `pl-de` against fixes 1 and
 *     2 did not turn either leg green — both still 400'd, now on a DIFFERENT, narrower rule:
 *     `onboarding.tsx` only ever rendered the generic identifier field under `scheme: "LEGAL_ID"` (see
 *     `SELLER_IDENTIFIERS`'s own comment below), and its own VAT input was gated on
 *     `requiredIdentifiers` declaring one, which IT/PL never did; company settings offered no separate
 *     "add an identifier" affordance at all. `build-semantic-invoice.ts`'s BT-31 (`cac:PartyTaxScheme`,
 *     the Seller VAT Identifier) is populated ONLY from a `VAT`-scheme party identifier — a `LEGAL_ID`
 *     one (the only scheme these two sellers could ever get) instead populates BT-29/30
 *     (`cac:PartyLegalEntity/cbc:CompanyID`), a DIFFERENT node that satisfies BR-CO-26 but not BR-S-02
 *     (pl-de, category S) or BR-IC-02 (it-pt, category K), both of which name the Seller VAT Identifier
 *     specifically, never the legal registration id. FIXED at the layering level, not per-country: a
 *     VAT identifier is a requirement of the EN 16931 invoice FORMAT itself (BT-31), never a national
 *     one — `country-identifiers` exists to express what a country demands IN ADDITION (SIRET,
 *     Leitweg-ID, Codice Destinatario…), which is a different question from "does this format need a
 *     VAT number". `use-required-identifiers.ts#withVatIdentifier` now appends a generic VAT
 *     requirement to what BOTH onboarding and company settings offer, for EVERY country, unless that
 *     country's own catalog already declares a `VAT` scheme (France, Germany, Portugal do — never
 *     duplicated there). `it-pt` and `pl-de` below now type a real VAT number through the exact same
 *     `onboarding-vat-input` every other leg's seller already used, and their invoices export
 *     successfully — see each leg's own assertion for the exact citation (category, rate, mentions,
 *     BT-80).
 *
 * ## What this file deliberately does NOT re-prove
 *
 * The unresolved-buyer-country hard block ("B2C pays inconnu → 0% de TVA silencieux", closed
 * f6888eb2/2026-07-25) and the checksum-invalid-VAT → B2C-with-warning path are both already proven,
 * screen-driven, by `35-cross-border-tax.cy.ts`. Re-running either dedicated proof six more times here
 * (once per leg) would spend CI time restating a passing test, not finding a new failure mode — this
 * file instead exercises the hard block none of the numbered specs reach: `transports/
 * channel-policy/mandate.ts`'s date-gated MANDATE override — `fr-pl`'s second invoice (below) proves
 * it for France/PDP, and `it-it`/`it-pt` (armed 2026-09-13, D.Lgs. 127/2015 art. 1 comma 3) prove the
 * SAME mechanism for Italy/SdI, on their own MAIN invoice this time (Italy's mandate has been active
 * since 2019 — there is no "before the mandate" date left to pick for an Italian seller the way
 * fr-pl's second invoice picks "today" — see `connectFakeSdiAndMakeItTheTransport`'s own header).
 *
 * ## House discipline this file follows (see 21/31/35 for the precedent)
 *
 * Actions through a real click; assertions through the API — with ONE documented exception per house
 * convention (35's own "no country" client): the client form renders exactly the identifier schemes
 * the buyer country's own `country-identifiers/data/<cc>.json` declares, and nothing else. When a
 * buyer's VAT number has no input to go in, the client is created through the API instead, its
 * absence from the form asserted FIRST as the gap it is — the way 35 documents its own API-only
 * client creation rather than silently routing around what the screen cannot do.
 *
 * UPDATED 2026-09-13: this used to say "a buyer country with NO file (Poland, Italy)". Both countries
 * gained one that day, so the condition is no longer about the FILE but about the SCHEME — Poland's
 * own file ships `LEGAL_ID` and not `VAT`, so its buyer still needs the API path while its form does
 * now render an input. `BuyerIdentifiers.formOffers` below carries the real per-country list, and the
 * assertions check both directions: every declared scheme present, every undeclared one absent.
 */
const scenarioId = Cypress.env("scenario") as string;
const s: Scenario = SCENARIOS[scenarioId];
const api = Cypress.env("apiUrl") || "http://localhost:4000";

if (!s) {
	throw new Error(
		`Unknown scenario "${scenarioId}" — set CYPRESS_scenario to one of: ${Object.keys(SCENARIOS).join(", ")}. ` +
			"See e2e/cypress/fixtures/scenarios.ts.",
	);
}

/** Every scenario in this fixture uses the same currency — one constant, no per-scenario slug logic. */
const EURO_SLUG = "euro-(€)";

/**
 * The SELLER's own onboarding identifiers, decided from the REAL `country-identifiers/data/<cc>.json`
 * catalog rather than the fixture's own `company.identifierScheme` (see this file's header — that
 * field is directional guidance the fixture author wrote for a different engine, not always literal).
 *
 *  - FR (`country-identifiers/data/fr.json`): LEGAL_ID (SIREN/SIRET) required, VAT offered/optional.
 *  - DE (`data/de.json`): neither scheme required — `company.legalId` ("DE136695976") is VAT-shaped
 *    (the fixture's own `identifierScheme: 'VAT'` is right here), so it belongs in the VAT slot, not
 *    a fabricated Handelsregisternummer.
 *  - PT (`data/pt.json`): LEGAL_ID (NIF/NIPC) is the one REQUIRED scheme — the fixture's own
 *    `identifierScheme: 'VAT'` is WRONG for Portugal (this catalog requires the NIF, not the VAT
 *    number); `company.legalId` ("509442661") IS already a bare NIF, so it is the correct LEGAL_ID
 *    value, and `company.vat` ("PT509442661") separately fills the optional VAT slot the catalog also
 *    declares. Both fixture fields are used, neither is invented.
 *  - IT/PL: no `country-identifiers/data/{it,pl}.json` file at all — onboarding's own step 2 always
 *    offers ONE generic, unlabelled, non-required identifier field regardless (`onboarding.tsx`'s own
 *    "a LEGAL_ID row always exists from the start"), and `company.legalId` is typed there exactly as
 *    before. A VAT slot ALSO now exists for these two countries (this file's header, defect 3 —
 *    `use-required-identifiers.ts#withVatIdentifier` offers one for every country, not only the three
 *    whose own catalog declares it), rendered as the same `onboarding-vat-input` FR/DE/PT already use.
 *    `it-pt`'s "IT01234567897" is a real, checksum-valid Partita IVA (`vat-syntax.ts#validateItVat`'s
 *    own Luhn-like check — the exact digit string `formats/vendored/validate-schematron.spec.ts`
 *    already cites as checksum-valid, not invented here). `pl-de`'s "PL5260001246" is the same
 *    well-known KSeF sandbox test NIP `31-national-channels.cy.ts` already uses, checksum-valid per
 *    `validateNip`'s own weighted sum (verified by hand: weights [6,5,7,2,3,4,5,6,7] over 5,2,6,0,0,0,
 *    1,2,4 sum to 127, 127 mod 11 = 6, matching the check digit). `it-it` (Italy again, domestic-only)
 *    gets no VAT number: that leg's own branch below never reaches the cross-border BT-31 gate, so
 *    there is nothing for one to unblock there.
 */
const SELLER_IDENTIFIERS: Record<string, { legalId?: string; vat?: string }> = {
	"fr-pl": { legalId: "73282932000074", vat: "FR44732829320" },
	"de-fr": { vat: "DE136695976" },
	"it-it": { legalId: "12345678901" },
	"pt-de": { legalId: "509442661", vat: "PT509442661" },
	"it-pt": { legalId: "11223344554", vat: "IT01234567897" },
	"pl-de": { legalId: "PL7010018991", vat: "PL5260001246" },
};

/**
 * The BUYER client's own identifiers and how it can actually be created — see this file's header on
 * the `country-identifiers` gap for PL/IT. `legalId` is a FRESH, pattern-valid value for whichever
 * scheme the buyer's own country declares as LEGAL_ID (never reused across legs, though nothing would
 * actually break if it were — every leg runs against its own, freshly reset database).
 *
 *  - PL (`fr-pl`): NO file → API-only, VAT "PL5260001246" (the same well-known KSeF sandbox test NIP
 *    `31-national-channels.cy.ts` already uses — checksum-valid per `validateNip`'s own weighted sum).
 *  - FR (`de-fr`): LEGAL_ID (SIREN, `^\d{9}(\d{5})?$`) required; VAT offered — deliberately the
 *    fixture's OWN "FR12345678901" (checksum-INVALID, see header) to observe the real B2C/OSS path.
 *  - IT (`it-it`, domestic): no file — created via the SCREEN with no identifier at all (nothing to
 *    fill, nothing blocks the save).
 *  - DE (`pt-de`): VAT offered, not required; "DE812000006" is checksum-VALID (verified by hand
 *    against `validateDeVat`'s ISO 7064 Mod 11,10 in this file's own header).
 *  - PT (`it-pt`): LEGAL_ID (NIF) required; "501442600" is `client.vat`'s own "PT501442600" with the
 *    prefix stripped (`country-identifiers/data/pt.json`'s own notes: the two are conventionally the
 *    same number) — VAT slot filled with "PT501442600" itself.
 *  - DE (`pl-de`, INDIVIDUAL/B2C): no VAT at all, on purpose — an unregistered consumer is exactly the
 *    shape the OSS destination-VAT branch needs (`resolveBuyerRole`: no VAT value at all → B2C before
 *    any syntax check even runs).
 */
interface BuyerIdentifiers {
	legalId?: string;
	vat?: string;
	/**
	 * The identifier schemes the client form ACTUALLY renders for this buyer's country — i.e. exactly
	 * what `country-identifiers/data/<cc>.json` declares, nothing assumed.
	 *
	 * This replaced a `hasCountryFile: boolean` on 2026-09-13, because a boolean could no longer tell
	 * the truth: Poland's own file ships `LEGAL_ID` and NOT `VAT`, so "has a file" and "the form can
	 * carry this buyer's VAT number" stopped being the same question the day that file landed. An
	 * empty list means the country has no file at all and the form renders the honest
	 * `client-identifiers-unknown-country` placeholder instead of any input.
	 */
	formOffers: ("VAT" | "LEGAL_ID")[];
	/** `clients.service.ts#upsertPartyIdentifiers`'s own stored verdict — the syntax gate runs FIRST,
	 *  before any VIES-style call, so this is fully deterministic offline (see this file's header for
	 *  the per-country checksum this traces). Absent when no VAT was even typed. */
	expectedVatStatus?: "VALID" | "INVALID";
}

const BUYER_IDENTIFIERS: Record<string, BuyerIdentifiers> = {
	// Poland ships LEGAL_ID and NOT VAT (`country-identifiers/data/pl.json`), so this buyer's VAT
	// number still cannot go through the form — the API fallback below is still exercised, but for a
	// narrower and more accurate reason than "this country has no file".
	"fr-pl": { vat: "PL5260001246", formOffers: ["LEGAL_ID"], expectedVatStatus: "VALID" },
	"de-fr": { legalId: "552100554", vat: "FR12345678901", formOffers: ["LEGAL_ID", "VAT"], expectedVatStatus: "INVALID" },
	// Italy ships VAT + LEGAL_ID (`country-identifiers/data/it.json`, 2026-09-13). Both inputs render;
	// neither is typed here, which is correct — both schemes are `required: false`.
	"it-it": { formOffers: ["VAT", "LEGAL_ID"] },
	"pt-de": { vat: "DE812000006", formOffers: ["VAT", "LEGAL_ID"], expectedVatStatus: "VALID" },
	"it-pt": { legalId: "501442600", vat: "PT501442600", formOffers: ["LEGAL_ID", "VAT"], expectedVatStatus: "VALID" },
	"pl-de": { formOffers: ["VAT", "LEGAL_ID"] },
};

/** SERVICE/HOUR/DAY → SERVICES, PRODUCT → GOODS — `tax/types.ts`'s own `SupplyType`, the field the
 *  cross-border engine actually branches on (`tax-engine.ts#determineLineTax`); this fixture's own
 *  `item.type` (a display/UoM concept, `descriptors/invoice.descriptor.ts`'s `unit` field) is a
 *  DIFFERENT axis and never doubles as this one. */
const SUPPLY_TYPE: "GOODS" | "SERVICES" = s.item.type === "PRODUCT" ? "GOODS" : "SERVICES";
const UNIT = s.item.type === "PRODUCT" ? "unit" : s.item.type === "DAY" ? "day" : "hour";

function selectEuro(dataCyPrefix: string) {
	cy.get(`[data-cy="${dataCyPrefix}"] button`).scrollIntoView().click({ force: true });
	cy.wait(300);
	cy.get(`[data-cy="${dataCyPrefix}-options"]`, { timeout: 5000 }).should("be.visible");
	cy.get(`[data-cy="${dataCyPrefix}-option-${EURO_SLUG}"]`).click({ force: true });
}

function selectClientEuro() {
	cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
	cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
	cy.get('[data-cy="client-currency-select"] input').type("Euro");
	cy.get(`[data-cy="client-currency-select-option-${EURO_SLUG}"]`).click();
}

interface ClientSearchResult {
	id: string;
	name: string;
	contactFirstname: string | null;
	contactLastname: string | null;
	partyIdentifiers: { scheme: string; value: string; validationStatus: string | null }[];
}

/**
 * Looks the buyer client up via the plain clients search (never the reference-picker endpoint — this
 * file needs `partyIdentifiers` back, which only this endpoint's own `include` carries). An
 * INDIVIDUAL client (pl-de) is matched by contact first/last name, never by `name` — the client form
 * only ever fills `name` for a COMPANY client (`client-upsert.tsx`'s own conditional fields); an
 * individual's stored `name` is whatever the (untouched) form default left it, never the fixture's
 * own display convenience string ("Klaus Mueller").
 */
function findBuyerClient() {
	const isIndividual = s.client.type === "INDIVIDUAL";
	const searchTerm = isIndividual ? (s.client.contactLastname ?? "") : s.client.name;
	return cy
		.request({ url: `${api}/api/clients/search?query=${encodeURIComponent(searchTerm)}` })
		.its("body")
		.then((clients: ClientSearchResult[]) => {
			const client = clients.find((c) =>
				isIndividual
					? c.contactFirstname === s.client.contactFirstname && c.contactLastname === s.client.contactLastname
					: c.name === s.client.name,
			);
			expect(client, `buyer client found by search (term: "${searchTerm}")`).to.exist;
			return client!;
		});
}

function createInvoiceDraft(clientId: string, issueDate: string, dueDate: string, vatRate: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate,
					dueDate,
					currency: "EUR",
					notes: `Full lifecycle — ${scenarioId}`,
					lines: [
						{
							description: s.item.name,
							quantity: s.item.quantity,
							unit: UNIT,
							unitPrice: s.item.unitPrice,
							vatRate,
							// Undeclared on `invoice.descriptor.ts`'s own `fields` on purpose — the SAME extra,
							// tolerated key `35-cross-border-tax.cy.ts` already relies on: `resolve-invoice-
							// tax.ts#extractSupplyType` reads it straight off the raw line row, and nothing in
							// `descriptors/validate.ts` strips an undeclared key from a stored draft.
							supplyType: SUPPLY_TYPE,
						},
					],
				},
			},
			failOnStatusCode: false,
		})
		.then((res) => {
			expect(res.status, `invoice draft created — ${JSON.stringify(res.body).slice(0, 300)}`).to.be.oneOf([
				200, 201,
			]);
			const id = res.body?.document?.id as string;
			expect(id, "draft has an id").to.be.a("string");
			return id;
		});
}

/** A real click on the list row's own "Send" — invoice "send" declares NO params (the transport is a
 *  company setting, never typed per-send — `invoice.descriptor.ts`'s own header), so no params dialog
 *  ever appears here, unlike a quote's own "send". */
function sendInvoiceViaScreen(invoiceId: string) {
	cy.visit("/documents/invoice");
	cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
		.find('[data-cy="document-status-badge"]')
		.should("contain.text", "Draft");
	cy.runDocumentRowAction(invoiceId, "send");
}

/**
 * `channel-policy/data/it.json`'s "sdi" fact was armed `mandated`/`mandatedFrom: '2019-01-01'` on
 * 2026-09-13 (D.Lgs. 127/2015 art. 1 comma 3 — see that file's own `provenance`). Every leg's own
 * main invoice below is issued 2026-08-20 — chosen (see the top-of-file NOTE) to sit BEFORE France's
 * own PDP mandate (2026-09-01) so the shared "sends via email, reaches Sent" shape holds for every
 * OTHER leg — but Italy's mandate has been active since 2019, so for `it-it`/`it-pt` that same date is
 * always inside the mandate window; there is no "before" date left to pick for an Italian seller. The
 * two Italian legs therefore need the SAME two-step shape `32-channel-mandate.cy.ts` already
 * established for France (blocked by email, unblocked by connecting+choosing the mandated channel),
 * not the FR-pl trick of a second, separately-dated invoice — see this file's own header for why.
 * Real SdI credentials do not exist in CI (`31-national-channels.cy.ts`'s own header: SdI is
 * "implemented-awaiting-accreditation"), so — exactly like that spec's own SdI leg — this connects
 * FAKE credentials whose `endpoint` points at a closed port (immediate ECONNREFUSED, never a network
 * timeout): the mandate becomes SATISFIED (the chosen transport now matches "sdi"), but the real
 * delivery still fails, landing on "send_failed" rather than "sent" — the honest ceiling this branch
 * can reach without real AdE accreditation.
 */
const FAKE_SDI = {
	idTrasmittente: "IT01234567890",
	endpoint: "https://127.0.0.1:1/ricevi_file",
	certificate: "ZTJlLWZha2UtcGZ4LWNvbnRlbnRz",
	certificatePassword: "e2e-fake-cert-password",
};

function connectFakeSdiAndMakeItTheTransport() {
	cy.visit("/settings/channels");
	cy.get('[data-cy="channel-sdi"]', { timeout: 15000 }).should("exist");
	cy.get('[data-cy="channel-sdi-idtrasmittente-input"]').clear().type(FAKE_SDI.idTrasmittente);
	cy.get('[data-cy="channel-sdi-endpoint-input"]').clear().type(FAKE_SDI.endpoint);
	cy.get('[data-cy="channel-sdi-certificate-input"]').clear().type(FAKE_SDI.certificate);
	cy.get('[data-cy="channel-sdi-certificatepassword-input"]').clear().type(FAKE_SDI.certificatePassword);
	cy.get('[data-cy="channel-sdi-connect-button"]').click();
	cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Channel connected");
	cy.get('[data-cy="channel-sdi-status"]', { timeout: 10000 }).should("contain.text", "Connected");

	cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: { invoiceTransportId: "sdi" },
		failOnStatusCode: false,
	}).then((res) => {
		expect(res.status, "sdi configured as the invoice transport").to.be.oneOf([200, 201]);
	});
}

/**
 * Portugal's ATCUD (Portaria n.º 195/2020) — `pt-de` is the only leg in this file whose SELLER is
 * Portuguese (`it-pt`'s own Portugal is the BUYER, unaffected: `documents/actions/atcud-issuance.ts
 * #ensureAtcudIssuable` gates on the ISSUING company's own country, never the buyer's). Without this,
 * `pt-de`'s main invoice send below would now 400 at the preflight (`ensureAtcudIssuable`'s own
 * `AtcudFormatIncompatibleError`/`AtcudValidationCodeMissingError`) — this product's own shipped
 * default number format ("INVOICE-{year}-{number:4}", `numbering/format-number.ts
 * #defaultNumberFormatFor`) has no "/" at all, and no company has ever registered a validation code.
 * A real Portuguese company has to do exactly this — set an ATCUD-compatible invoice number format,
 * then register the AT-issued code for the series that format predicts — before it can send its
 * first invoice; this mirrors that real setup through the actual settings screen
 * (`settings/_components/atcud.settings.tsx`), the same "action through a real click" discipline this
 * file's own `connectFakeSdiAndMakeItTheTransport` already holds for Italy's own SdI mandate.
 *
 * The series identifier is "FT 2026", never "FT {issueDate's year}": numbering takes its `{year}` from
 * the REAL wall-clock moment the number is actually assigned (`numbering/sequence.ts
 * #takeDocumentNumber`'s own `issuedAt = new Date()` default), not from the invoice's own `issueDate`
 * field (2026-08-20, chosen only to sit before France's PDP mandate — see this file's own header) — so
 * the series this test registers has to match whatever year this suite actually runs in, not the
 * invoice's own backdated issue date.
 */
function configurePortugueseAtcud() {
	cy.visit("/settings/atcud");
	// `{ parseSpecialCharSequences: false }` — without it, Cypress's `.type()` would try to interpret
	// "{year}"/"{number:4}" as key-sequence commands (like "{enter}") rather than typing them literally.
	cy.get('[data-cy="atcud-number-format-input"]', { timeout: 15000 })
		.clear()
		.type("FT {year}/{number:4}", { parseSpecialCharSequences: false });
	cy.get('[data-cy="atcud-number-format-save-button"]').click();
	cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Invoice number format saved");

	const seriesId = `FT ${new Date().getFullYear()}`;
	cy.get('[data-cy="atcud-series-id-input"]').type(seriesId);
	cy.get('[data-cy="atcud-validation-code-input"]').type("E2EATCUDCODE1");
	cy.get('[data-cy="atcud-series-save-button"]').click();
	cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Series saved");
}

describe(`Full lifecycle — ${scenarioId}`, () => {
	let buyerClientId: string;
	let invoiceId: string;

	before(() => {
		cy.task("resetDatabase");

		// ── Sign-up + login — `cy.login()` is hardcoded to this exact account. ──────────────────────
		cy.visit("/auth/sign-up");
		cy.get('[data-cy="auth-firstname-input"]', { timeout: 10000 }).type("John");
		cy.get('[data-cy="auth-lastname-input"]').type("Doe");
		cy.get('[data-cy="auth-email-input"]').type("john.doe@acme.org");
		cy.get('[data-cy="auth-password-input"]').type("Super_Secret_Password123!");
		cy.get('[data-cy="auth-submit-btn"]').click();
		cy.url({ timeout: 20000 }).should("include", "/auth/sign-in");
		cy.login();

		// ── Onboarding — the FOUR-step wizard (`components/onboarding.tsx`): country → identifier
		// (LEGAL_ID, always offered, labelled per country) → company (the rest of the profile, plus any
		// OTHER identifier the country's own catalog declares) → channels (skipped here; `31-national-
		// channels.cy.ts` already covers connecting a channel from this exact step). ───────────────────
		const seller = SELLER_IDENTIFIERS[scenarioId];
		cy.visit("/");
		cy.wait(2000);
		cy.get('[data-cy="onboarding-dialog"]', { timeout: 15000 }).should("be.visible");

		cy.selectCountry("onboarding-company-country-input", s.company.country);
		cy.get('[data-cy="onboarding-country-next-btn"]').click();

		cy.get('[data-cy="onboarding-legalid-input"]', { timeout: 10000 }).should("be.visible");
		if (seller.legalId) {
			cy.get('[data-cy="onboarding-legalid-input"]').clear({ force: true }).type(seller.legalId, { force: true });
		}
		cy.get('[data-cy="onboarding-identifier-next-btn"]').click();

		cy.get('[data-cy="onboarding-company-name-input"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="onboarding-company-name-input"]').clear().type(s.company.name);
		if (seller.vat) {
			// Rendered for EVERY country now, not only the three (FR/DE/PT) whose own
			// `country-identifiers` catalog declares a VAT scheme — see this file's header, defect 3,
			// and `use-required-identifiers.ts#withVatIdentifier`. Same input, same data-cy, whether the
			// field came from the catalog or was synthesized for a country (IT, PL) with no catalog file.
			cy.get('[data-cy="onboarding-vat-input"]', { timeout: 10000 })
				.clear({ force: true })
				.type(seller.vat, { force: true });
		}
		cy.get('[data-cy="onboarding-submit-btn"]').click();

		cy.get('[data-cy="onboarding-finish-btn"]', { timeout: 15000 }).should("be.visible").click();
		cy.get('[data-cy="onboarding-dialog"]', { timeout: 20000 }).should("not.exist");
		cy.wait(2000);

		// ── Company settings — currency, contact details, PDF/date format (zod-required — see
		// `company.settings.tsx`'s own schema) and a baseline "email" transport so this leg's own send
		// isn't blocked on "no transport configured" (`invoice-actions.ts#resolveInvoiceTransport`).
		// Country/identifiers are left untouched — onboarding already saved them. ───────────────────────
		cy.visit("/settings/company");
		cy.get('[data-cy="company-name-input"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="company-phone-input"]').clear({ force: true }).type("+123456789", { force: true });
		cy.get('[data-cy="company-email-input"]').clear({ force: true }).type("company@example.com", { force: true });
		cy.get('[data-cy="company-address-input"]').clear({ force: true }).type("1 Main St", { force: true });
		cy.get('[data-cy="company-city-input"]').clear({ force: true }).type("City", { force: true });
		cy.get('[data-cy="company-postalcode-input"]').clear({ force: true }).type("10000", { force: true });
		selectEuro("company-currency-select");
		cy.get('[data-cy="company-pdfformat-select"]').click();
		cy.get('[data-cy="company-pdfformat-option-pdf"]').click();
		cy.get('[data-cy="company-dateformat-select"]').click();
		cy.get('[data-cy="company-dateformat-option-dd-MM-yyyy"]').first().click();
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait(3000);

		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "baseline email transport configured").to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it(`the buyer's own country's identifier requirements (or their honest absence) are what the client form actually offers — ${s.client.country}`, () => {
		const buyer = BUYER_IDENTIFIERS[scenarioId];

		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		if (s.client.type === "INDIVIDUAL") {
			cy.get('[data-cy="client-type-select"]').click();
			cy.get('[data-cy="client-type-individual"]').click();
			cy.get('[name="contactFirstname"]').clear().type(s.client.contactFirstname ?? "");
			cy.get('[name="contactLastname"]').clear().type(s.client.contactLastname ?? "");
		} else {
			cy.get('[name="name"]').clear().type(s.client.name);
		}
		cy.selectCountry("client-country-select", s.client.country);

		// The form must offer EXACTLY what the buyer country's own catalog declares — each declared
		// scheme present, each undeclared one absent. Asserting both directions is the point: a
		// missing input and an extra one are both wrong, and a country that gained a file (Italy and
		// Poland both did on 2026-09-13) must be noticed here rather than silently tolerated.
		if (buyer.formOffers.length === 0) {
			cy.get('[data-cy="client-identifiers-unknown-country"]', { timeout: 10000 }).should("exist");
		} else {
			cy.get(`[data-cy="client-identifier-${buyer.formOffers[0]}"]`, { timeout: 10000 }).should("exist");
			cy.get('[data-cy="client-identifiers-unknown-country"]').should("not.exist");
		}
		for (const scheme of ["VAT", "LEGAL_ID"] as const) {
			if (!buyer.formOffers.includes(scheme)) {
				cy.get(`[data-cy="client-identifier-${scheme}"]`).should("not.exist");
			}
		}
		if (buyer.legalId && buyer.formOffers.includes("LEGAL_ID")) {
			cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type(buyer.legalId);
		}
		if (buyer.vat && buyer.formOffers.includes("VAT")) {
			cy.get('[data-cy="client-identifier-VAT"]', { timeout: 10000 }).clear().type(buyer.vat);
		}

		cy.get('[name="contactEmail"]').clear().type(s.client.email);
		cy.get('[name="address"]').clear().type(s.client.address);
		cy.get('[name="postalCode"]').clear().type(s.client.postalCode);
		cy.get('[name="city"]').clear().type(s.client.city);
		selectClientEuro();

		if (buyer.vat && !buyer.formOffers.includes("VAT")) {
			// The form genuinely cannot carry this buyer's VAT number — close without submitting and
			// finish creating the client through the API instead, exactly the documented exception
			// `35-cross-border-tax.cy.ts` already establishes for its own "no country" client.
			// Note the condition is about the SCHEME, not about the country having a file at all:
			// Poland has a file and still offers no VAT input, which is precisely the case here.
			cy.get('[data-cy="client-cancel"]').click();
			cy.get('[data-cy="client-dialog"]').should("not.exist");

			const clientBody: Record<string, unknown> = {
				name: s.client.name,
				contactEmail: s.client.email,
				type: s.client.type,
				country: s.client.country,
				countryCode: "PL",
				address: s.client.address,
				postalCode: s.client.postalCode,
				city: s.client.city,
				currency: "EUR",
				isActive: true,
				identifiers: [{ scheme: "VAT", value: buyer.vat }],
			};
			cy.request({ method: "POST", url: `${api}/api/clients`, body: clientBody }).then((res) => {
				expect(res.status, "buyer client created via API (screen cannot carry this identifier)").to.be.oneOf([
					200, 201,
				]);
			});
		} else {
			cy.get('[data-cy="client-submit"]').click();
			cy.get('[data-cy="client-dialog"]').should("not.exist");
		}

		findBuyerClient().then((client) => {
			buyerClientId = client.id;
			if (buyer.vat) {
				const vatId = client.partyIdentifiers.find((i) => i.scheme === "VAT");
				expect(vatId, "the typed VAT identifier was actually stored").to.exist;
				// THE decisive proof behind every per-leg tax finding this file's own header traces: the
				// syntax gate (`vat-syntax.ts`, run synchronously at client-save time,
				// `clients.service.ts#upsertPartyIdentifiers`) already decided B2B-eligible or not, BEFORE
				// the invoice is even created below — a wrong verdict here would silently corrupt every
				// CII/settlement number the next test reads back.
				expect(vatId!.validationStatus, `VAT syntax verdict for "${buyer.vat}"`).to.eq(buyer.expectedVatStatus);
			}
		});
	});

	it("the invoice is created, cross-border tax is resolved by composing the seller's and buyer's own tax-systems, and it issues with a real number and a rendered PDF", () => {
		expect(buyerClientId, "buyer client id from the previous test").to.be.a("string");

		createInvoiceDraft(buyerClientId, "2026-08-20", "2026-09-20", String(s.item.vatRate)).then((id) => {
			invoiceId = id;

			const isItalianSeller = scenarioId === "it-it" || scenarioId === "it-pt";
			if (isItalianSeller) {
				// STEP 1 — the mandate blocks the baseline "email" transport (see this file's own
				// `connectFakeSdiAndMakeItTheTransport` header for why this leg cannot simply pick a
				// "before the mandate" date the way every other leg does). Never persisted past "draft" —
				// same synchronous-preflight discipline `32-channel-mandate.cy.ts` already proves for
				// France's own PDP mandate.
				sendInvoiceViaScreen(id);
				cy.get("[data-sonner-toast]", { timeout: 10000 })
					.should("contain.text", "2019-01-01")
					.and("contain.text", "sdi");
				cy.request(`${api}/api/documents/${id}?typeId=invoice`)
					.its("body.status")
					.then((status) => {
						expect(status, 'blocked at preflight — never left "draft"').to.eq("draft");
					});

				// STEP 2 — connect the mandated channel and choose it: the mandate is now SATISFIED, so
				// the send actually reaches the queue and a real delivery attempt is made — against a
				// closed port (no real AdE accreditation exists in CI, see `31-national-channels.cy.ts`'s
				// own header), so it fails for real, landing on "send_failed" rather than "sent".
				connectFakeSdiAndMakeItTheTransport();
			}
			if (scenarioId === "pt-de") {
				// See `configurePortugueseAtcud`'s own header — without this, the send below 400s at the
				// ATCUD preflight, never even reaching "sending".
				configurePortugueseAtcud();
			}
			sendInvoiceViaScreen(id);

			const expectedStatus = isItalianSeller ? "Send failed" : "Sent";
			cy.get(`[data-cy="document-list-row-${id}"]`, { timeout: 40000 })
				.find('[data-cy="document-status-badge"]', { timeout: 40000 })
				.should("contain.text", expectedStatus);

			if (isItalianSeller) {
				cy.get(`[data-cy="document-row-last-error-${id}"]`)
					.should("contain.text", "SdI")
					// The failure is the fake, unreachable endpoint — never the mandate any more, since the
					// mandated channel is now the one actually configured (same proof shape as
					// `32-channel-mandate.cy.ts`'s own PDP equivalent).
					.and("not.contain.text", "requires invoices");
			}

			const expectedFinalStatus = isItalianSeller ? "send_failed" : "sent";
			cy.request(`${api}/api/documents/${id}?typeId=invoice`)
				.its("body")
				.then((doc) => {
					expect(doc.status, expectedFinalStatus).to.eq(expectedFinalStatus);
					expect(doc.displayNumber, "a real document number was assigned at numbering.onEnterStatus").to.be.a(
						"string",
					);
					expect(doc.displayNumber.length, "the number is not an empty string").to.be.greaterThan(0);
				});

			// The PDF path — Chromium-provisioned, playwright-based renderer (see CLAUDE.md). Never
			// status-gated (`documents.service.ts#renderInstancePdf` reads the record as-is, whatever its
			// status), so this works identically for "sent" and for the two Italian legs' "send_failed". A single
			// re-download after "sent" is enough to prove the path works for every leg; 35 already proves
			// a SECOND, post-edit re-render for the one leg that specifically needs it.
			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/pdf` }).as("pdfDownload");
			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-pdf-button-${id}"]`, { timeout: 10000 }).click();
			cy.wait("@pdfDownload", { timeout: 20000 }).then((x) => {
				expect(x.response?.statusCode, "the PDF renders").to.eq(200);
			});

			if (scenarioId === "it-it") {
				// DOMESTIC (seller country === buyer country): `resolve-invoice-tax.ts` never calls the
				// cross-border engine at all for this leg — the user's own typed rate (22%, Italy's real
				// standard rate) stays the truth, only checked against a seller-country rate CATALOG that
				// doesn't exist for Italy (`vat-rates/data/` ships only fr.json/pt.json) — so nothing here
				// composes anything, on purpose; this leg's own tax proof IS that the typed rate survives
				// unchanged.
				cy.request(`${api}/api/documents/${id}/settlement?typeId=invoice`)
					.its("body.totals.grossMinor")
					.should("eq", Math.round(s.item.quantity * s.item.unitPrice * 1.22 * 100));
				return;
			}

			// Every OTHER leg is genuinely cross-border — download the CII export and read the RESOLVED
			// treatment (never the typed vatRate, which `resolve-invoice-tax.ts` always overwrites for a
			// cross-border line — see that file's own header, "the engine DECIDES").
			cy.window().then((win) => cy.stub(win, "open").as("windowOpen"));
			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/formats/cii` }).as("cii");
			cy.openDocumentRowMenu(id);
			cy.get(`[data-cy="document-xml-button-${id}"]`, { timeout: 10000 }).click();
			cy.get(`[data-cy="document-xml-cii-${id}"]`, { timeout: 10000 }).should("be.visible").click();
			cy.wait("@cii", { timeout: 20000 }).then((x) => {
				if (scenarioId === "it-pt") {
					// ALL THREE DEFECTS FIXED — see this file's own header for the full writeup, and
					// `pl-de`'s own branch below for the category-S twin of defect 3's fix. The TAX
					// resolution itself was always correct — IT→PT, GOODS, buyer VAT "PT501442600"
					// (Portugal has no dedicated checksum function in `vat-syntax.ts`, only FR/IT/DE/ES/PL
					// do, so the dispatcher's default branch answers `valid: true` unconditionally →
					// confirmed B2B) → same EU union, GOODS → intra-Community supply, category K, rate 0%,
					// Art. 138 (never the seller's own 22% the fixture's comment assumed) — `tax-engine.ts`
					// composed the right answer from the start. BR-IC-12 (defect 2) is gone:
					// `build-semantic-invoice.ts` now builds BT-80 for category K. BR-IC-02 (defect 3) is
					// ALSO gone: the seller's own "IT01234567897" VAT number, typed through
					// `onboarding-vat-input` (`SELLER_IDENTIFIERS`'s own comment — a real, checksum-valid
					// Partita IVA), now populates BT-31, so the export succeeds end to end.
					expect(x.response?.statusCode, "EN 16931 export succeeds — all three defects fixed").to.eq(
						200,
					);
					const body = String(x.response?.body);
					expect(body, "0% (intra-Community supply)").to.match(
						/<ram:RateApplicablePercent>0<\/ram:RateApplicablePercent>/,
					);
					expect(body, "category K").to.contain("<ram:CategoryCode>K</ram:CategoryCode>");
					// The mention is now the one the SELLER's own law names, not the generic text citing
					// the directive: the seller is Italian, and D.L. 331/1993 art. 46 comma 2 requires
					// stating, in place of the tax amount, « che si tratta di
					// operazione non imponibile ». Watch out for a citation trap: intra-Community supply
					// falls under that text, NOT DPR 633/1972 art. 21 comma 6 lett. b), which lists the
					// export cases (art. 8, 8-bis, 9, 38-quater) and yet carries the same wording.
					expect(body, "mention italienne « operazione non imponibile »").to.contain(
						"operazione non imponibile",
					);
					// BT-80 — the buyer's own country (Portugal), the same shape
					// `formats/providers.spec.ts`'s own BT-80 suite already proves for CII.
					expect(body, "BT-80 present, carrying the buyer's own country (PT)").to.match(
						/<ram:ShipToTradeParty>[\s\S]*?<ram:CountryID>PT<\/ram:CountryID>/,
					);
					return;
				}

				if (scenarioId === "pl-de") {
					// ALL THREE DEFECTS FIXED — see this file's own header, and `it-pt`'s own branch above
					// for the category-K twin of defect 3's fix. The TAX resolution was always correct —
					// PL→DE, GOODS, buyer is an INDIVIDUAL with NO VAT at all → B2C from the very first
					// check → GOODS, B2C, same union → OSS destination VAT, category S, Germany's own real
					// 19% standard rate (`tax-systems/data/de.json`) — the one leg whose fixture comment
					// already matched the engine's real behavior. BR-S-02 (defect 3) is gone: the seller's
					// own "PL5260001246" VAT number, typed through the exact same `onboarding-vat-input`
					// (`SELLER_IDENTIFIERS`'s own comment — the well-known KSeF sandbox test NIP, checksum-
					// valid), now populates BT-31, so the export succeeds end to end. No BT-80/category-K
					// concern here — this leg is category S, not K, confirming the fix is independent of
					// category, exactly like defects 1 and 2 before it.
					expect(x.response?.statusCode, "EN 16931 export succeeds — all three defects fixed").to.eq(
						200,
					);
					const body = String(x.response?.body);
					expect(body, "19% (OSS destination = Germany's own standard rate)").to.match(
						/<ram:RateApplicablePercent>19<\/ram:RateApplicablePercent>/,
					);
					expect(body, "category S (OSS is destination-STANDARD-rated, not exempt)").to.contain(
						"<ram:CategoryCode>S</ram:CategoryCode>",
					);
					return;
				}

				expect(x.response?.statusCode, "the CII export renders").to.eq(200);
				const body = String(x.response?.body);

				if (scenarioId === "fr-pl") {
					// FR→PL, SERVICES, buyer VAT "PL5260001246" — checksum-VALID (`validateNip`'s own
					// weighted sum, verified by hand in this file's header) → B2B confirmed → same EU union,
					// SERVICES → Art. 196 reverse charge (`tax-engine.ts` §2, category AE, rate 0%).
					expect(body, "0% (reverse charge)").to.match(/<ram:RateApplicablePercent>0<\/ram:RateApplicablePercent>/);
					expect(body, "category AE").to.contain("<ram:CategoryCode>AE</ram:CategoryCode>");
					expect(body, "Art. 196 mention").to.contain("Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC");
				}

				if (scenarioId === "de-fr") {
					// DE→FR, GOODS, buyer VAT "FR12345678901" — checksum-INVALID (see this file's header:
					// SIREN 345678901 mod 97 = 1, expected key 15, given key 12) → treated as B2C BEFORE any
					// stored VIES-style verdict is even consulted (`resolveBuyerRole`'s own "never a silent
					// B2B") → B2C GOODS across the same union → OSS destination VAT
					// (`tax-engine.ts#ossDestinationVat`), charging the BUYER's own country's rate
					// (`tax-systems/data/fr.json`, DERIVED from `vat-rates/data/fr.json`'s "fr-standard" 20%
					// entry) — 20%, category S. The number coincides with what was TYPED (also 20%) only
					// because France's own standard rate happens to be 20% too; the decisive proof this was
					// actually recomputed via OSS, not merely left alone, is the buyer's stored
					// `validationStatus` asserted in the previous test (INVALID, never left null).
					expect(body, "20% (OSS destination = France's own standard rate)").to.match(
						/<ram:RateApplicablePercent>20<\/ram:RateApplicablePercent>/,
					);
					expect(body, "category S (OSS is destination-STANDARD-rated, not exempt)").to.contain(
						"<ram:CategoryCode>S</ram:CategoryCode>",
					);
				}

				if (scenarioId === "pt-de") {
					// PT→DE, SERVICES, buyer VAT "DE812000006" — checksum-VALID (`validateDeVat`'s ISO 7064
					// Mod 11,10, verified by hand in this file's header) → B2B confirmed → same EU union,
					// SERVICES → Art. 196 reverse charge, category AE, 0% — the SAME shape as fr-pl, for a
					// DIFFERENT country pair, proving the engine composes rather than special-cases one pair.
					expect(body, "0% (reverse charge)").to.match(/<ram:RateApplicablePercent>0<\/ram:RateApplicablePercent>/);
					expect(body, "category AE").to.contain("<ram:CategoryCode>AE</ram:CategoryCode>");
					// The seller is PORTUGUESE, and CIVA art. 36.º n.º 13 requires the exact expression
					// « IVA - autoliquidação » whenever the recipient is liable for the tax. The
					// fr-pl leg, by contrast, keeps the generic text citing the directive: France imposes
					// no specific wording, and that contrast is what proves the engine follows the
					// SELLER's own law instead of applying one sentence to everyone.
					expect(body, "mention portugaise d'autoliquidation").to.contain("IVA - autoliquidação");
				}

			});
		});
	});

	it(`the transmission channel policy for ${s.company.country} is asserted as the catalog actually declares it — never assumed`, () => {
		cy.request(`${api}/api/company/channels`)
			.its("body.suggested")
			.then(
				(
					suggested: {
						providerId: string;
						requirement: "mandated" | "suggested";
						mandatedFrom?: string;
						effectiveNow?: boolean;
					}[],
				) => {
					if (scenarioId === "fr-pl") {
						// France — the ONLY seller country with a real, enforced MANDATE
						// (`channel-policy/data/fr.json`: pdp, mandatedFrom 2026-09-01, provenance 'legal').
						// `effectiveNow` is computed against the REAL clock (`channels.service.ts#suggestedChannels`),
						// so this is true today (2026-09-01 is already in the past by construction of this
						// branch's own timeline).
						const pdp = suggested.find((c) => c.providerId === "pdp");
						expect(pdp, "pdp is declared for France").to.exist;
						expect(pdp!.requirement, "MANDATED, not merely suggested").to.eq("mandated");
						expect(pdp!.mandatedFrom).to.eq("2026-09-01");
						expect(pdp!.effectiveNow, "the mandate has already come into force").to.eq(true);
					} else if (scenarioId === "it-it" || scenarioId === "it-pt") {
						// Italy — `channel-policy/data/it.json` now declares SdI `mandated` from 2019-01-01,
						// `provenance.kind: 'legal'`, sourced to D.Lgs. 127/2015 art. 1 comma 3 (armed
						// 2026-09-13 — see that file's own `provenance`/`notes`). The previous test's own
						// two-step proof (blocked via "email", unblocked by connecting+choosing "sdi", real
						// delivery still fails against a fake endpoint) IS the consequence of this now being
						// `mandated` — the invoice settles on "send_failed", never "sent", and never a silent
						// "email" success the way a merely-`suggested` fact used to allow.
						const sdi = suggested.find((c) => c.providerId === "sdi");
						expect(sdi, "sdi is declared for Italy").to.exist;
						expect(sdi!.requirement, "MANDATED since 2019-01-01, not merely suggested").to.eq("mandated");
						expect(sdi!.mandatedFrom).to.eq("2019-01-01");
						expect(sdi!.effectiveNow, "the mandate has already come into force").to.eq(true);
						cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`)
							.its("body.status")
							.should("eq", "send_failed");
					} else if (scenarioId === "pl-de") {
						// Poland — `channel-policy/data/pl.json` now carries a real `legal` citation (art.
						// 106ga ust. 1) but DELIBERATELY stays `requirement: 'suggested'` — see that file's own
						// `notes`: the statute's own transitional articles (145l/145m) make a single
						// `mandatedFrom` date wrong for most taxpayers today, so arming it would refuse
						// invoices that are still lawful. Sourced honesty is not the same thing as an armed
						// gate — this leg's own invoice still sends freely via "email".
						const ksef = suggested.find((c) => c.providerId === "ksef");
						expect(ksef, "ksef is declared for Poland").to.exist;
						expect(ksef!.requirement, "suggested, not mandated").to.eq("suggested");
					} else {
						// de-fr (Germany) and pt-de (Portugal) — NEITHER country has a `channel-policy/data/
						// {de,pt}.json` file at all (`transports/channel-policy/data/` ships only fr/it/pl.json
						// — verified by directory listing, not inferred). `suggested` is an empty array: the
						// product gives NO channel signal for these two sellers, honestly, rather than
						// inventing one.
						expect(suggested, `no channel-policy file for ${s.company.country} — empty, not guessed`).to.deep.equal(
							[],
						);
					}
				},
			);

		if (scenarioId === "fr-pl") {
			// THE decisive proof the France mandate is a real, ENFORCED block, not just a settings-screen
			// hint: a second draft, issued ON OR AFTER 2026-09-01 (today, by this branch's own forward-
			// moving timeline — see this file's header), with the transport still "email" (never changed
			// to "pdp") — `invoice-actions.ts#resolveInvoiceTransport`'s own mandate check runs BEFORE the
			// company's free choice is even consulted and throws, SYNCHRONOUSLY, before anything is
			// persisted or queued (its own header: "a doomed send is refused before anything is persisted").
			const today = new Date().toISOString().slice(0, 10);
			createInvoiceDraft(buyerClientId, today, "2026-12-31", "0").then((mandateTestId) => {
				sendInvoiceViaScreen(mandateTestId);

				cy.get("[data-sonner-toast]", { timeout: 10000 })
					.should("contain.text", "2026-09-01")
					.and("contain.text", "pdp");

				cy.request(`${api}/api/documents/${mandateTestId}?typeId=invoice`)
					.its("body.status")
					.then((status) => {
						expect(
							status,
							'never persisted past "draft" — the mandate blocks at preflight, before "sending" is even entered',
						).to.eq("draft");
					});
			});
		}
	});

	it(`the correction route ${s.company.country}'s own law allows is the one the UI actually offers — never a fabricated one`, () => {
		expect(invoiceId, "the main invoice from the previous tests").to.be.a("string");

		cy.visit("/documents/invoice");
		cy.get(`[data-cy="document-correction-button-${invoiceId}"]`, { timeout: 15000 }).click();
		cy.get('[data-cy="document-correction-dialog"]', { timeout: 10000 }).should("be.visible");
		// `.should("exist")`, never "be.visible" — the eleven-route list is routinely TALLER than the
		// dialog's own `max-h-[85vh] overflow-y-auto` (`invoice-correction-routes-button.tsx`), so
		// Cypress's visibility heuristic (which samples the CENTER of the element) can call the whole
		// container "not visible" even though it is genuinely rendered and scrolled to the top —
		// confirmed by screenshot on a real run. Each individual route row below is short enough that
		// Cypress's own auto-scroll-before-interacting handles it without any help from this line.
		cy.get('[data-cy="document-correction-routes-list"]', { timeout: 10000 }).should("exist");

		if (scenarioId === "fr-pl") {
			// France — `correction-routes/data/fr.json`: CANCEL_AND_REPLACE "allowed", and
			// `cancel-policy.ts`'s own whitelist marks it FULLY implementable for France, unrestricted by
			// status. The one leg where this dialogue's "cancel" actually SUCCEEDS end to end.
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-status"]').should(
				"contain.text",
				"Allowed",
			);
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-button"]').should("not.be.disabled").click();
			cy.get('[data-cy="document-correction-confirm-cancel"]', { timeout: 5000 }).should("be.visible");
			cy.get('[data-cy="document-correction-confirm-cancel-confirm"]').click();
			cy.get('[data-cy="document-correction-dialog"]', { timeout: 10000 }).should("not.exist");
			cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`).its("body.status").should("eq", "cancelled");
		} else if (scenarioId === "de-fr") {
			// Germany — `correction-routes/data/de.json`: INTERNAL_CREDIT_NOTE is "forbidden" (its own
			// NO_DOCUMENT_BY_LAW entry, "allowed", is Germany's real default correction route instead) —
			// the one universally-implemented route (`correction-routes.ts`'s own `IMPLEMENTED_ROUTE_IDS`)
			// that this seller's own law still refuses outright: NOT choosable, disabled, with its own
			// named reason. CANCEL_AND_REPLACE is "allowed" and genuinely implementable here too (Germany
			// is in `cancel-policy.ts`'s own unrestricted whitelist) — asserted available WITHOUT spending
			// a second full cancel run (fr-pl already proves that exact mechanics end to end).
			cy.get('[data-cy="document-correction-route-INTERNAL_CREDIT_NOTE-status"]').should(
				"contain.text",
				"Forbidden",
			);
			cy.get('[data-cy="document-correction-route-INTERNAL_CREDIT_NOTE-button"]').should("be.disabled");
			cy.get('[data-cy="document-correction-route-INTERNAL_CREDIT_NOTE-reason"]').should("exist");
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-status"]').should(
				"contain.text",
				"Allowed",
			);
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-button"]').should("not.be.disabled");
		} else if (scenarioId === "it-it") {
			// Italy — CANCEL_AND_REPLACE is "allowed" and `implemented: true` (Italy IS in
			// `cancel-policy.ts`'s whitelist), so the button is choosable and the confirmation step opens.
			// Italy's own local cancel is `restrictedToStatuses: ['send_failed']` ("only after a
			// scarto" — `cancel-policy.ts`'s own header: "this app's own 'send_failed' status IS
			// SdI's scarto"). Before the SdI mandate was armed (2026-09-13), this invoice reached "sent"
			// via plain email, the ONE status this route does NOT cover, so the backend used to refuse
			// with a named 409. Now that the mandate is armed, the earlier test's own two-step proof
			// (email refused, SdI connected+chosen, real delivery genuinely fails against a fake
			// endpoint) lands this invoice on "send_failed" for real — EXACTLY the status this route
			// was always meant to cover — so the cancel now genuinely SUCCEEDS instead of being refused:
			// arming the mandate didn't just block a channel, it made this leg's own correction-route
			// proof reach the real-world scenario `cancel-policy.ts`'s data was written to describe.
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-status"]').should(
				"contain.text",
				"Allowed",
			);
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-button"]').should("not.be.disabled").click();
			cy.get('[data-cy="document-correction-confirm-cancel"]', { timeout: 5000 }).should("be.visible");
			cy.get('[data-cy="document-correction-confirm-cancel-confirm"]').click();
			cy.get('[data-cy="document-correction-dialog"]', { timeout: 10000 }).should("not.exist");
			cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`)
				.its("body.status")
				.should("eq", "cancelled");
		} else if (scenarioId === "it-pt") {
			// Italy again (same seller as it-it, different buyer) — a DIFFERENT nuance this time: DEBIT_NOTE
			// is "required" by Italy's own law (choosable, per `isChoosable`'s own "required/allowed" rule)
			// but is NOT one of `correction-routes.ts`'s own `IMPLEMENTED_ROUTE_IDS` — no country's DEBIT_NOTE
			// has a real mechanism behind it. Clicking a choosable-but-unimplemented route shows the honest
			// "not implemented" panel, never a fabricated document — the GENERIC version of `fr-pl`'s own
			// PL-specific CANCEL_AND_REPLACE gap below, proving the same honesty holds for a route no
			// country implements, not only for one country's own missing mechanism.
			cy.get('[data-cy="document-correction-route-DEBIT_NOTE-status"]').should(
				"contain.text",
				"Required by law",
			);
			cy.get('[data-cy="document-correction-route-DEBIT_NOTE-button"]').should("not.be.disabled").click();
			cy.get('[data-cy="document-correction-not-implemented"]', { timeout: 5000 }).should("be.visible");
			// "send_failed", not "sent" — this seller is Italian too (see it-it's own branch above for
			// why: the armed SdI mandate makes "send_failed" this leg's own genuine final status, via
			// the same connect-SdI-then-real-fake-endpoint-failure path). The "not implemented" panel
			// never touches the record either way, so whatever status test 2 left it in is what survives.
			cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`).its("body.status").should("eq", "send_failed");
		} else if (scenarioId === "pt-de") {
			// Portugal — CANCEL_AND_REPLACE stays "unverified" (`correction-routes/data/pt.json`: no
			// clearance/refusal-then-reissue mechanism was FOUND in the primary Decreto-Lei text read for
			// this catalog — an honest "nobody has settled this", not a permission). `isChoosable` treats
			// unverified as NOT choosable — disabled, with its own resolution note shown as the reason, the
			// same "not established" is not "permitted" discipline `invoice-correction-routes-button.tsx`'s
			// own header names. The SEPARATE Portuguese ATCUD requirement (Portaria n.º 195/2020) — once a
			// real gap this leg did not exercise — IS now exercised, earlier in this same file: see
			// `configurePortugueseAtcud`'s own header and its call site, right before this leg's own main
			// invoice is sent. The fiscal QR code stays genuinely out of scope (required only for AT-
			// certified software — see `country-policy/data/pt.json`'s own `invoice.send` notes).
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-status"]').should(
				"contain.text",
				"Not established",
			);
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-button"]').should("be.disabled");
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-reason"]').should("exist");
		} else if (scenarioId === "pl-de") {
			// Poland — CANCEL_AND_REPLACE is "required" by Poland's own law (choosable at the UI level —
			// `isChoosable` only looks at status) but `cancel-policy.ts`'s own whitelist deliberately
			// excludes Poland: the route is executed AS a corrective invoice, never a status flip
			// (`data/pl.json`'s own notes, quoted verbatim in `cancel-policy.ts`'s header) — no mechanism
			// this repo builds. Choosing it shows the SAME honest "not implemented" panel as it-pt's own
			// DEBIT_NOTE case, but for a COUNTRY-SPECIFIC reason this time (the route id itself IS wired
			// for other countries — France and Germany just proved that two tests above).
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-status"]').should(
				"contain.text",
				"Required by law",
			);
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-button"]').should("not.be.disabled").click();
			cy.get('[data-cy="document-correction-not-implemented"]', { timeout: 5000 }).should("be.visible");
			cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`).its("body.status").should("eq", "sent");
		}
	});
});
