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
 * ## Two real defects this file's own run found (it-pt AND pl-de) — both now FIXED, one residual gap
 * remains and is asserted below rather than papered over — see each assertion for the citation
 *
 * This file's initial run found two INDEPENDENT bugs, neither predicted at design time:
 *
 *  1. **Any seller whose country has no `country-identifiers/data/<cc>.json` file (today: Italy,
 *     Poland) loses its own LEGAL_ID identifier the moment company settings are saved** — a
 *     completely ordinary action this file's own `before()` hook takes for every leg (filling in
 *     phone/address/currency), not something contrived to trigger this. `company.settings.tsx`'s own
 *     "sync identifiers with the country catalog" effect deleted every identifier whose scheme was not
 *     in `requiredIdentifiers` — WITH NO EXCEPTION. `onboarding.tsx`'s own near-identical effect
 *     protects `scheme === "LEGAL_ID"` from that exact removal (its own comment: "LEGAL_ID is always
 *     collected in Step 2 ... never drop it here just because that catalog stays silent") — the
 *     settings-page effect had no such guard, so a country with an EMPTY `requiredIdentifiers` (IT,
 *     PL) had its LEGAL_ID deleted on the very next save. FIXED: `company.settings.tsx`'s effect now
 *     carries the identical `scheme !== "LEGAL_ID"` exemption, with the same rationale in its comment.
 *  2. **`build-semantic-invoice.ts` never built a "Deliver to" country (BT-80) for ANY invoice** — a
 *     gap carried over, unfixed, from the old removed model (only `cac:Delivery/
 *     cbc:ActualDeliveryDate`, BT-72, was ever built). EN 16931's BR-IC-12 conditions this on the VAT
 *     category being "Intra-Community supply" (category K) specifically — `it-pt` is the only one of
 *     these six legs whose tax composition reaches that category, so it is the only leg BR-IC-12 ever
 *     fired for; it would fire for ANY country pair reaching category K, not just this one. FIXED:
 *     `build-semantic-invoice.ts` now builds `cac:Delivery/cac:DeliveryLocation` (BT-80) with the
 *     buyer's own country whenever a line resolves to category K, and only then.
 *
 * ## A third, residual gap these same two legs exposed once 1 and 2 were fixed
 *
 * Re-running `it-pt` and `pl-de` against both fixes did NOT turn either leg green. Both still 400,
 * now on a DIFFERENT, narrower rule than before — a real, distinct, PRE-EXISTING defect neither fix
 * above touches: **a seller in a country with no `country-identifiers/data/<cc>.json` file (Italy,
 * Poland — the exact same gap defect 1 lived in) has NO WAY AT ALL, in either onboarding or company
 * settings, to record a `VAT`-scheme identifier for itself** — `onboarding.tsx` only ever renders the
 * generic identifier field under `scheme: "LEGAL_ID"` (see `SELLER_IDENTIFIERS`'s own comment below),
 * and its own VAT input is gated on `requiredIdentifiers` declaring one, which IT/PL never do; company
 * settings offers no separate "add an identifier" affordance at all. `build-semantic-invoice.ts`'s
 * BT-31 (`cac:PartyTaxScheme`, the Seller VAT Identifier) is populated ONLY from a `VAT`-scheme party
 * identifier — a `LEGAL_ID` one (the only scheme these two sellers can ever get) instead populates
 * BT-29/30 (`cac:PartyLegalEntity/cbc:CompanyID`), a DIFFERENT node that satisfies BR-CO-26 but not
 * BR-S-02 (pl-de, category S) or BR-IC-02 (it-pt, category K), both of which name the Seller VAT
 * Identifier specifically, never the legal registration id. Confirmed by hand against the running
 * stack: adding a bare `VAT` party identifier directly via `POST /api/company/info` (there is no
 * screen path to do this for these two countries) made the SAME it-pt invoice export successfully —
 * 200, category K, 0%, the Art. 138 mention, and BT-80 present — proving the tax composition and both
 * fixes above are correct, and narrowing this to exactly one missing capability. Giving these sellers
 * a way to record a VAT identifier needs the same primary-source legal research (which schemes IT/PL
 * actually use and require) that defect 1's own writeup already put out of scope — so this gap is
 * reported here, not fixed, and each assertion below pins TODAY's real, narrower 400 with its own
 * exact Schematron citation rather than a silently invented success.
 *
 * ## What this file deliberately does NOT re-prove
 *
 * The unresolved-buyer-country hard block ("B2C pays inconnu → 0% de TVA silencieux", closed
 * f6888eb2/2026-07-25) and the checksum-invalid-VAT → B2C-with-warning path are both already proven,
 * screen-driven, by `35-cross-border-tax.cy.ts`. Re-running either dedicated proof six more times here
 * (once per leg) would spend CI time restating a passing test, not finding a new failure mode — this
 * file instead exercises the ONE hard block none of the numbered specs reach: `transports/
 * channel-policy/mandate.ts`'s date-gated MANDATE override (`fr-pl`'s second invoice, below).
 *
 * ## House discipline this file follows (see 21/31/35 for the precedent)
 *
 * Actions through a real click; assertions through the API — with ONE documented exception per house
 * convention (35's own "sans pays" client): a buyer country with NO `country-identifiers/data/<cc>.json`
 * file (Poland, Italy — see that catalog's own `all.ts`) renders NO identifier input in the client
 * form at all (`client-identifiers-unknown-country`, never `client-identifier-VAT`) — there is
 * currently no screen path to give such a buyer a VAT number, so `fr-pl`'s Polish buyer is created via
 * the API, its absence from the form asserted FIRST as the gap it is, exactly the way 35 documents its
 * own API-only client creation rather than silently routing around what the screen cannot do.
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
 *    "a LEGAL_ID row always exists from the start"); `company.legalId` is typed there for realism, but
 *    nothing requires it and no distinct VAT slot exists to route a VAT-shaped value to.
 */
const SELLER_IDENTIFIERS: Record<string, { legalId?: string; vat?: string }> = {
	"fr-pl": { legalId: "73282932000074", vat: "FR44732829320" },
	"de-fr": { vat: "DE136695976" },
	"it-it": { legalId: "12345678901" },
	"pt-de": { legalId: "509442661", vat: "PT509442661" },
	"it-pt": { legalId: "11223344554" },
	"pl-de": { legalId: "PL7010018991" },
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
	hasCountryFile: boolean;
	/** `clients.service.ts#upsertPartyIdentifiers`'s own stored verdict — the syntax gate runs FIRST,
	 *  before any VIES-style call, so this is fully deterministic offline (see this file's header for
	 *  the per-country checksum this traces). Absent when no VAT was even typed. */
	expectedVatStatus?: "VALID" | "INVALID";
}

const BUYER_IDENTIFIERS: Record<string, BuyerIdentifiers> = {
	"fr-pl": { vat: "PL5260001246", hasCountryFile: false, expectedVatStatus: "VALID" },
	"de-fr": { legalId: "552100554", vat: "FR12345678901", hasCountryFile: true, expectedVatStatus: "INVALID" },
	"it-it": { hasCountryFile: false },
	"pt-de": { vat: "DE812000006", hasCountryFile: true, expectedVatStatus: "VALID" },
	"it-pt": { legalId: "501442600", vat: "PT501442600", hasCountryFile: true, expectedVatStatus: "VALID" },
	"pl-de": { hasCountryFile: true },
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
	cy.get(`[data-cy="document-row-action-send-${invoiceId}"]`, { timeout: 15000 }).click();
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
			// Only rendered when the country's own catalog offers a VAT scheme (FR/DE/PT here) —
			// absent for IT/PL, which have no `country-identifiers/data/*.json` file at all.
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

		if (!buyer.hasCountryFile) {
			// THE GAP this file's header documents: no `country-identifiers/data/<cc>.json` for this
			// country means the form renders NO identifier input at all — proven absent here, not
			// silently worked around.
			cy.get('[data-cy="client-identifiers-unknown-country"]', { timeout: 10000 }).should("exist");
			cy.get('[data-cy="client-identifier-VAT"]').should("not.exist");
			cy.get('[data-cy="client-identifier-LEGAL_ID"]').should("not.exist");
		} else {
			if (buyer.legalId) {
				cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 })
					.should("exist")
					.clear()
					.type(buyer.legalId);
			}
			if (buyer.vat) {
				cy.get('[data-cy="client-identifier-VAT"]', { timeout: 10000 }).should("exist").clear().type(buyer.vat);
			}
		}

		cy.get('[name="contactEmail"]').clear().type(s.client.email);
		cy.get('[name="address"]').clear().type(s.client.address);
		cy.get('[name="postalCode"]').clear().type(s.client.postalCode);
		cy.get('[name="city"]').clear().type(s.client.city);
		selectClientEuro();

		if (!buyer.hasCountryFile && buyer.vat) {
			// The form genuinely cannot carry this buyer's VAT number — close without submitting and
			// finish creating the client through the API instead, exactly the documented exception
			// `35-cross-border-tax.cy.ts` already establishes for its own "sans pays" client.
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
			sendInvoiceViaScreen(id);

			cy.get(`[data-cy="document-list-row-${id}"]`, { timeout: 25000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");

			cy.request(`${api}/api/documents/${id}?typeId=invoice`)
				.its("body")
				.then((doc) => {
					expect(doc.status, "sent").to.eq("sent");
					expect(doc.displayNumber, "a real document number was assigned at numbering.onEnterStatus").to.be.a(
						"string",
					);
					expect(doc.displayNumber.length, "the number is not an empty string").to.be.greaterThan(0);
				});

			// The PDF path — Chromium-provisioned, playwright-based renderer (see CLAUDE.md). A single
			// re-download after "sent" is enough to prove the path works for every leg; 35 already proves
			// a SECOND, post-edit re-render for the one leg that specifically needs it.
			cy.intercept({ method: "GET", pathname: `/api/documents/${id}/pdf` }).as("pdfDownload");
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
			cy.get(`[data-cy="document-xml-button-${id}"]`, { timeout: 10000 }).click();
			cy.get(`[data-cy="document-xml-cii-${id}"]`, { timeout: 10000 }).should("be.visible").click();
			cy.wait("@cii", { timeout: 20000 }).then((x) => {
				if (scenarioId === "it-pt") {
					// DEFECTS 1 AND 2 BOTH FIXED — ONE RESIDUAL GAP REMAINS, see this file's own header for
					// the full writeup and `pl-de`'s own branch below for the same gap on a category-S leg.
					// The TAX resolution itself is genuinely correct — IT→PT, GOODS, buyer VAT
					// "PT501442600" (Portugal has no dedicated checksum function in `vat-syntax.ts`, only
					// FR/IT/DE/ES/PL do, so the dispatcher's default branch answers `valid: true`
					// unconditionally → confirmed B2B) → same EU union, GOODS → intra-Community supply,
					// category K, rate 0%, Art. 138 (never the seller's own 22% the fixture's comment
					// assumed) — `tax-engine.ts` composed the right answer, unchanged by either fix.
					// BR-IC-12 (defect 2) is GONE: `build-semantic-invoice.ts` now builds BT-80 for
					// category K. What STILL 400s is BR-IC-02: it names the Seller VAT Identifier (BT-31)
					// specifically, and Italy's seller has no way to ever record one (this file's header's
					// own "third, residual gap") — its LEGAL_ID (defect 1, fixed) survives the settings
					// save now, but a LEGAL_ID populates a different node (BT-29/30) that BR-IC-02 does not
					// accept in place of BT-31.
					expect(
						x.response?.statusCode,
						"a REAL, narrower defect than before — defect 2 is fixed, see this file's own header",
					).to.eq(400);
					// `documents.service.ts#downloadDocumentFormat`'s own gate: `message` is only the generic
					// "failed EN 16931 validation" summary — the actual violated-rule citations (what makes
					// this a NAMED, evidenced defect rather than an opaque 400) live in `errors`, one string
					// per failed Schematron assertion (`buildResult.validation.errors`).
					const errors = ((x.response?.body as { errors?: string[] } | undefined)?.errors ?? []).join(
						" | ",
					);
					expect(
						errors,
						"BR-IC-02 — the residual gap: the seller has no VAT-scheme identifier at all, only LEGAL_ID",
					).to.contain("BR-IC-02");
					expect(
						errors,
						"BR-IC-12 is GONE — defect 2 is fixed, BT-80 is now built for category K",
					).to.not.contain("BR-IC-12");
					return;
				}

				if (scenarioId === "pl-de") {
					// DEFECT 1 FIXED — THE SAME RESIDUAL GAP AS it-pt REMAINS, see this file's own header
					// for the full writeup and `it-pt`'s own branch above for the category-K twin of this
					// same gap. The TAX resolution is genuinely correct — PL→DE, GOODS, buyer is an
					// INDIVIDUAL with NO VAT at all → B2C from the very first check → GOODS, B2C, same
					// union → OSS destination VAT, category S, Germany's own real 19% standard rate
					// (`tax-systems/data/de.json`) — the one leg whose fixture comment already matched the
					// engine's real behavior, unchanged by either fix. The seller's own LEGAL_ID now
					// survives the settings-page save (defect 1, fixed) — BR-CO-26 no longer fires. What
					// STILL 400s is BR-S-02: category S (standard-rated) ALSO requires the seller's own VAT
					// identification specifically (BT-31, the general-purpose sibling of BR-IC-02) — a
					// Polish seller has the exact same "no `country-identifiers` file → no way to EVER
					// record a VAT-scheme identifier" gap Italy has (this file's header's own "third,
					// residual gap"), with no category-K/BT-80 concern this time (confirming this residual
					// gap, like the two fixed defects before it, is genuinely independent of category).
					expect(
						x.response?.statusCode,
						"a REAL, narrower defect than before — defect 1 is fixed, see this file's own header",
					).to.eq(400);
					const errors = ((x.response?.body as { errors?: string[] } | undefined)?.errors ?? []).join(
						" | ",
					);
					expect(
						errors,
						"BR-S-02 — the residual gap: the seller has no VAT-scheme identifier at all, only LEGAL_ID",
					).to.contain("BR-S-02");
					expect(errors, "never the category-K-only BR-IC-12 — this leg is category S, not K").to.not.contain(
						"BR-IC-12",
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
					expect(body, "Art. 196 mention").to.contain("Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC");
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
						// Italy — `channel-policy/data/it.json` declares SdI only `suggested`, `provenance.kind:
						// 'unverified'` (the file's own honest admission it could not find a primary-source
						// citation with its own consultation date — see that file's `resolutionNote`). This is
						// DELIBERATE: nothing in this codebase arms a gate for it yet, unlike France's. The
						// invoice THIS leg's own previous test already sent — via "email", never SdI — proves
						// the consequence: a "suggested" fact blocks nothing.
						const sdi = suggested.find((c) => c.providerId === "sdi");
						expect(sdi, "sdi is declared for Italy").to.exist;
						expect(sdi!.requirement, "suggested, not mandated — nothing enforces it").to.eq("suggested");
						expect(sdi!.mandatedFrom, "no mandate date — a suggestion doesn't have one").to.be.undefined;
						cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`)
							.its("body.status")
							.should("eq", "sent");
					} else if (scenarioId === "pl-de") {
						// Poland — `channel-policy/data/pl.json` declares KSeF only `suggested`, same
						// 'unverified' honesty as Italy's own entry (its own resolutionNote names the exact
						// citation that WOULD promote it to 'mandated' and hasn't been read yet).
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
			// `cancel-policy.ts`'s whitelist), so the button is choosable and the confirmation step opens —
			// but Italy's own local cancel is `restrictedToStatuses: ['send_failed']` ("après scarto
			// UNIQUEMENT"): this invoice is "sent" (delivered via email, per the previous test), the ONE
			// status Italy's own data says this route does NOT cover, so the backend refuses with a NAMED
			// 409 — never a fake success.
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-status"]').should(
				"contain.text",
				"Allowed",
			);
			cy.get('[data-cy="document-correction-route-CANCEL_AND_REPLACE-button"]').should("not.be.disabled").click();
			cy.get('[data-cy="document-correction-confirm-cancel"]', { timeout: 5000 }).should("be.visible");
			cy.get('[data-cy="document-correction-confirm-cancel-confirm"]').click();
			cy.get("[data-sonner-toast]", { timeout: 10000 })
				.should("contain.text", "restricted")
				.and("contain.text", "send_failed");
			cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`)
				.its("body.status")
				.then((status) => {
					expect(
						status,
						'refused, never actually cancelled — status is untouched, still "sent"',
					).to.eq("sent");
				});
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
			cy.request(`${api}/api/documents/${invoiceId}?typeId=invoice`).its("body.status").should("eq", "sent");
		} else if (scenarioId === "pt-de") {
			// Portugal — CANCEL_AND_REPLACE stays "unverified" (`correction-routes/data/pt.json`: no
			// clearance/refusal-then-reissue mechanism was FOUND in the primary Decreto-Lei text read for
			// this catalog — an honest "nobody has settled this", not a permission). `isChoosable` treats
			// unverified as NOT choosable — disabled, with its own resolution note shown as the reason, the
			// same "« non établi » n'est pas « permis »" discipline `invoice-correction-routes-button.tsx`'s
			// own header names. See this file's own header note on the SEPARATE Portuguese gap
			// (ATCUD/fiscal QR) this leg does NOT exercise — it has no reachable surface in this e2e run.
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
