/**
 * The country showcase, replayed with the whole stack believing it is 2 September 2026.
 *
 * Why re-run it rather than keep the August captures: France's mandate is the point of this
 * project, and on 28 August none of it is in force. The engine resolves obligations against the
 * invoice's issue date, so every French screen taken before the 1st shows the country the product
 * is leaving, not the one it is being built for. Five days of clock is the difference between a
 * demo of the past and a demo of the target.
 *
 * The other countries are unaffected — none of their profiles gate a rule on a date near now — so
 * running the whole set here gives one coherent series instead of two half-series.
 *
 * Lives outside the suite glob (`cypress/e2e/*.cy.ts` is not recursive): it only tells the truth
 * under a shifted clock and would fail, correctly, on an ordinary run. Spec 18 keeps asserting the
 * pre-mandate mirror image, and stays in the suite as the regression.
 *
 *   DATE_SHIFT_TO=2026-09-02T10:00:00Z \
 *   NODE_OPTIONS="--require $PWD/scripts/date-shift.cjs" \
 *   ./scripts/e2e-worktree.sh --browser firefox --spec "cypress/e2e/mandate/showcase.cy.ts"
 */
import {
	draftZeroRateLine,
	issuedInvoice,
	openInvoice,
	revealPanels,
	send,
	setupCountry,
	shot,
} from "../../support/showcase";

/** The browser half of the shift. The server half comes from NODE_OPTIONS. */
const MANDATE_DAY = new Date("2026-09-02T10:00:00Z").getTime();

/** `['Date']` only — freezing timers would stall TanStack Query and the dialog would never load. */
function shiftBrowserClock() {
	cy.clock(MANDATE_DAY, ["Date"], { log: false });
}

describe("Compliance showcase — 2 September 2026, the mandate in force", () => {
	before(() => cy.resetAndSeed());
	beforeEach(() => {
		cy.login();
		shiftBrowserClock();
	});

	// ── France, now that its mandate applies ──────────────────────────────────────────────────────
	it("01 FR — three obligation layers, each on its own clock", () => {
		setupCountry("Mandat FR", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000090" },
			{ scheme: "VAT", value: "FR44732829330" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="obligation-ISSUANCE"]').should("be.visible");
				cy.get('[data-cy="obligation-RECEPTION"]').should("be.visible");
				cy.get('[data-cy="obligation-ARCHIVAL"]').should("be.visible");
				cy.get('[data-cy="obligation-open-ISSUANCE"]').should("not.exist");
				shot("01-fr-three-obligation-layers");
			});
		});
	});

	it("02 FR — the invoice now has to reach an accredited platform, not an inbox", () => {
		setupCountry("Mandat FR 2", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000091" },
			{ scheme: "VAT", value: "FR44732829331" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.contains("button", /send by email/i).should("not.exist");
				cy.contains("button", /portal|clearance/i).should("be.visible");
				shot("02-fr-routed-to-platform");
			});
		});
	});

	it("03 FR — sent to a platform that will never answer, and the wait is open-ended", () => {
		setupCountry("Mandat FR 3", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000092" },
			{ scheme: "VAT", value: "FR44732829332" },
		]).then((ids) => {
			issuedInvoice(ids).then((id) => {
				send(id as unknown as string);
				openInvoice();
				// What the document actually reaches once sent to a PDP that has no credentials. Captured
				// before being asserted: the first version of this case assumed "not transmitted", which is
				// what Poland shows, and France does something else. Guessing the message would have made the
				// screenshot illustrate a sentence rather than the other way round.
				// Captured before being asserted: the first version assumed "not transmitted", which is what
				// Poland shows. France does something else, and the difference matters. Poland fails
				// honestly; France goes to "awaiting delivery confirmation" — a pending state that cannot
				// ever resolve, because no PDP has credentials (finding C1). An optimistic wait reads as
				// progress, and this one is not.
				cy.contains(/awaiting delivery confirmation/i).should("be.visible");
				revealPanels();
				shot("03-fr-awaiting-forever");
			});
		});
	});

	it("04 FR — an issued invoice is frozen: correction is a new document, never an edit", () => {
		setupCountry("Mandat FR 4", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000093" },
			{ scheme: "VAT", value: "FR44732829333" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.get('[data-cy="invoice-edit-button"]').should("not.exist");
				revealPanels();
				shot("04-fr-frozen-after-issue");
			});
		});
	});

	it("05 FR — no cancellation warning: France allows it with no strings attached", () => {
		setupCountry("Mandat FR 5", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000094" },
			{ scheme: "VAT", value: "FR44732829334" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="cancellation-policy"]').should("not.exist");
				shot("05-fr-no-cancellation-warning");
			});
		});
	});

	it("06 FR — ten years to keep it, and it is chained so it cannot be altered", () => {
		setupCountry("Mandat FR 6", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000095" },
			{ scheme: "VAT", value: "FR44732829335" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="archival-retention"]').should("contain.text", "10");
				cy.get('[data-cy="archival-integrity"]').should("be.visible");
				shot("06-fr-retention-and-chaining");
			});
		});
	});

	// ── The same screens, elsewhere ───────────────────────────────────────────────────────────────
	it("07 PL — cancellation does not exist, and the panel says what to do instead", () => {
		setupCountry("Mandat PL", "Poland", "PL", [
			{ scheme: "VAT", value: "PL1234567890" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="cancellation-condition-notAllowedByCountry"]').should(
					"be.visible",
				);
				shot("07-pl-cancellation-unavailable");
			});
		});
	});

	it("08 MX — two conditions at once, which one sentence could never show", () => {
		setupCountry("Mandat MX", "Mexico", "MX", [
			{ scheme: "RFC", value: "XAXX010101000" },
			{ scheme: "MX_DOMICILIO_FISCAL", value: "01000" },
			{ scheme: "MX_REGIMEN_FISCAL", value: "601" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="cancellation-condition-buyerConsent"]').should(
					"be.visible",
				);
				cy.get('[data-cy="cancellation-condition-authorityAck"]').should(
					"be.visible",
				);
				shot("08-mx-two-cancellation-conditions");
			});
		});
	});

	it("09 IT — cancellation waits on the tax authority", () => {
		setupCountry("Mandat IT", "Italy", "IT", [
			{ scheme: "LEGAL_ID", value: "12345678901" },
			{ scheme: "VAT", value: "IT12345678901" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="cancellation-condition-authorityAck"]').should(
					"be.visible",
				);
				shot("09-it-cancellation-authority-ack");
			});
		});
	});

	it("10 DE — one obligation layer, because Germany declares none of its own", () => {
		setupCountry("Mandat DE", "Germany", "DE", []).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="obligation-ISSUANCE"]').should("be.visible");
				cy.get('[data-cy="obligation-RECEPTION"]').should("not.exist");
				shot("10-de-single-obligation-layer");
			});
		});
	});

	it("11 US — no VAT at all: the sale is outside the scope of the tax", () => {
		setupCountry("Mandat US", "United States", "US", []).then((ids) => {
			issuedInvoice(ids, 0).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="archival-notice"]').should("be.visible");
				shot("11-us-out-of-scope");
			});
		});
	});

	// ── Retention: one component, three answers ───────────────────────────────────────────────────
	it("12 MX — five years", () => {
		setupCountry("Mandat MX 2", "Mexico", "MX", [
			{ scheme: "RFC", value: "XAXX010101001" },
			{ scheme: "MX_DOMICILIO_FISCAL", value: "01001" },
			{ scheme: "MX_REGIMEN_FISCAL", value: "601" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="archival-retention"]').should("contain.text", "5");
				cy.get('[data-cy="archival-residency"]').should("be.visible");
				shot("12-mx-retention-5-years");
			});
		});
	});

	it("13 US — seven years", () => {
		setupCountry("Mandat US 2", "United States", "US", []).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="archival-retention"]').should("contain.text", "7");
				shot("13-us-retention-7-years");
			});
		});
	});

	it("14 DE — eight years", () => {
		setupCountry("Mandat DE 2", "Germany", "DE", []).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="archival-retention"]').should("contain.text", "8");
				shot("14-de-retention-8-years");
			});
		});
	});

	// ── VAT on a zero-rated line ──────────────────────────────────────────────────────────────────
	it("15 FR — at 0 % the invoice must say which kind of zero this is", () => {
		setupCountry("Mandat FR 7", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000096" },
			{ scheme: "VAT", value: "FR44732829336" },
		]).then(() => {
			cy.visit("/invoices");
			draftZeroRateLine("0");
			cy.get('[data-cy="item-vat-category-0"]').scrollIntoView();
			cy.get('[data-cy="item-vat-category-0"]').should("be.visible");
			cy.get('[data-cy="item-vat-exemption-reason-0"]').should("be.visible");
			shot("15-fr-zero-rate-declaration");
		});
	});

	it("16 FR — at 20 % the question does not arise, and the controls stay away", () => {
		cy.visit("/invoices");
		draftZeroRateLine("20");
		cy.get('[data-cy="item-vat-category-0"]').should("not.exist");
		shot("16-fr-no-declaration-at-standard-rate");
	});
});
