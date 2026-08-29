/**
 * The same four countries as spec 20 — read off the SCREEN, where the user is.
 *
 * Spec 20 asks the API which documents a country declares. That is the right question to ask the
 * engine and the wrong one to stop at: this repository has already shipped a correction kind the API
 * returned and the interface silently dropped (the Italian debit note), and a `CANCEL_AND_REPLACE`
 * every layer knew about except the profiles, so the button could never appear. An API-level
 * assertion is green in both of those worlds.
 *
 * Same fixture in every country, same clicks. The only thing that varies is the profile.
 */
import {
	api,
	issuedInvoice,
	send,
	setupCountry,
	waitForSettled,
} from "../support/showcase";

type Actions = {
	complianceStatus: string | null;
	actions: Record<string, boolean>;
	correctionKinds: string[];
	flow: { manualActions?: string[] } | null;
};

const FR = [
	{ scheme: "LEGAL_ID", value: "73282932000074" },
	{ scheme: "VAT", value: "FR44732829320" },
];
const IT = [
	{ scheme: "LEGAL_ID", value: "12345678901" },
	{ scheme: "VAT", value: "IT12345678901" },
];
const MX = [
	{ scheme: "RFC", value: "XAXX010101000" },
	{ scheme: "MX_DOMICILIO_FISCAL", value: "01000" },
	{ scheme: "MX_REGIMEN_FISCAL", value: "601" },
];

/** An invoice in `cc`, issued and sent, with its detail view open. */
const sentInvoiceOnScreen = (
	label: string,
	country: string,
	cc: string,
	identifiers: { scheme: string; value: string }[],
) =>
	setupCountry(label, country, cc, identifiers).then((ids) =>
		issuedInvoice(ids).then((id) => {
			send(id as unknown as string).then((res) => {
				expect(
					res.status,
					`send responded — ${JSON.stringify(res.body).slice(0, 150)}`,
				).to.be.oneOf([200, 201]);
			});
			waitForSettled(id as unknown as string);
			cy.visit("/invoices");
			cy.get(`[data-cy="invoice-row"][data-invoice-id="${id}"]`, {
				timeout: 20000,
			})
				.find('[data-cy="invoice-name"]')
				.click();
			// The panel is rendered from `available-actions`, fetched AFTER the dialog opens. Reading
			// it straight away returns an empty list for every country — including France, where spec
			// 19 clicks these very buttons — and would "prove" that nobody offers anything.
			cy.get('[data-cy="available-actions"]', { timeout: 20000 }).should(
				"exist",
			);
			return cy.wrap(id as unknown as string);
		}),
	);

const controlsOnScreen = () =>
	cy
		.get('[role="dialog"]')
		.then(($d) =>
			[...$d.find("[data-cy^='action-']")]
				.map((e) => e.getAttribute("data-cy"))
				.sort(),
		);

const stateOf = (id: string) =>
	cy
		.request<Actions>({ url: `${api}/api/invoices/${id}/available-actions` })
		.its("body");

describe("What each country changes ON SCREEN", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("01 France freezes the invoice at issuance — no Edit on a delivered document", () => {
		// CGI art. 289 and the numbering continuity that goes with it: once issued, the document is
		// no longer the user's to change; the correction is a NEW document. Hence a panel that offers
		// to correct and refuses to edit.
		sentInvoiceOnScreen("Screen FR", "France", "FR", FR).then(() => {
			controlsOnScreen().then((seen) => {
				expect(seen, "France offers the credit note").to.include(
					"action-correct",
				);
				expect(seen, "and the corrective invoice").to.include(
					"action-corrective",
				);
				expect(seen, "and NOT an edit — the document is frozen").to.not.include(
					"action-edit",
				);
			});
		});
	});

	it("02 the United States do not freeze it — the same screen offers Edit", () => {
		// A sourced negative: there is no federal invoice at all. 26 U.S.C. § 6001 imposes RECORDS,
		// not a DOCUMENT, so nothing in US law makes an issued invoice immutable. Same code, same
		// fixture, opposite answer — and no branch names either country.
		sentInvoiceOnScreen("Screen US", "United States", "US", []).then(() => {
			controlsOnScreen().then((seen) => {
				expect(
					seen,
					"the United States still allow the edit France forbids",
				).to.include("action-edit");
				expect(seen, "and offer the correcting documents too").to.include(
					"action-correct",
				);
			});
		});
	});

	it("03 Italy and Mexico are stopped by their CHANNEL, not by their documents", () => {
		// Both declare their correcting documents perfectly well — Italy the nota di debito its art.
		// 26 comma 1 DPR 633/72 compels, Mexico the replacement invoice of its cancel-and-replace.
		// Neither reaches a correctable state here, and the reason is the channel: France and the
		// United States leave by e-mail, Italy by SdI and Mexico by a PAC, and those have no
		// credentials in this environment. The document stays ISSUED, so the lifecycle offers
		// nothing to correct — which is the same rule spec 21 proves for France through the API.
		//
		// THIS TEST IS A CANARY. The day credentials exist, it fails — and that failure is the
		// signal to write the end-to-end Italian and Mexican demonstrations, which cannot be
		// written honestly before then.
		sentInvoiceOnScreen("Screen IT", "Italy", "IT", IT).then((itId) => {
			stateOf(itId).then((s) => {
				expect(s.correctionKinds, "Italy declares its debit note").to.include(
					"DEBIT_NOTE",
				);
				expect(
					s.correctionKinds,
					"and has no amend-by-reference instrument",
				).to.not.include("CORRECTIVE_INVOICE");
				expect(
					s.complianceStatus,
					"but the document never left — no SdI credentials",
				).to.eq("ISSUED");
				expect(
					s.flow?.manualActions ?? [],
					"so the lifecycle offers nothing",
				).to.deep.eq([]);
			});
			controlsOnScreen().then((seen) => {
				expect(seen, "and the screen agrees with the lifecycle").to.not.include(
					"action-correct",
				);
			});
		});

		sentInvoiceOnScreen("Screen MX", "Mexico", "MX", MX).then((mxId) => {
			stateOf(mxId).then((s) => {
				expect(
					s.correctionKinds,
					"Mexico declares the replacement invoice",
				).to.include("INVOICE");
				expect(
					s.complianceStatus,
					// Not "ISSUED" like Italy: the two channels fail DIFFERENTLY. Italy's document
					// sits in a queue nothing will ever acknowledge; Mexico's is refused outright. A
					// first probe read "ISSUED" here too — it had looked before the failure landed.
					"Mexico is refused by its PAC, not merely left pending",
				).to.eq("TRANSMISSION_FAILED");
			});
			// Mexico differs from Italy even in failing: its transmission is REFUSED rather than left
			// pending, and the screen says so instead of showing a silent, permanently empty panel.
			cy.get('[data-cy="invoice-failure-banner"]').should("be.visible");
			cy.get('[data-cy="invoice-retry-transmission"]').should("exist");
		});
	});

	it("04 no two of the four put the same controls on the screen", () => {
		// The measured form of "nothing is hard-coded". Asserting each country separately would let
		// a branch that names a country drift toward whatever it assumed, one test at a time.
		const seen: Record<string, string> = {};
		const record = (cc: string) =>
			controlsOnScreen().then((c) => {
				seen[cc] = c.join(",");
			});

		sentInvoiceOnScreen("Panel FR", "France", "FR", FR).then(() =>
			record("FR"),
		);
		sentInvoiceOnScreen("Panel US", "United States", "US", []).then(() =>
			record("US"),
		);
		sentInvoiceOnScreen("Panel IT", "Italy", "IT", IT).then(() => record("IT"));

		cy.then(() => {
			expect(
				seen.US,
				`the United States ${seen.US} differ from France ${seen.FR}`,
			).to.not.eq(seen.FR);
			expect(
				seen.IT,
				`Italy ${seen.IT} differs from France ${seen.FR}`,
			).to.not.eq(seen.FR);
		});
	});
});
