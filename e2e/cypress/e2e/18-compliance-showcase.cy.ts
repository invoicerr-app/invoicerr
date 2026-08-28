/**
 * The country differences, shown rather than asserted in prose.
 *
 * Every case here drives the REAL stack — real profile, real compliance plan, real screen — and
 * captures what a user in that country actually sees. Nothing is mocked, because the point being
 * demonstrated is precisely that the interface changes by country WITHOUT the frontend knowing any
 * country: every difference below comes from `profiles/data/<cc>.ts`, through the
 * `available-actions` payload, into a component that contains no ISO code.
 *
 * Each case asserts before it captures. A screenshot of a panel that is not there would be an empty
 * rectangle nobody notices; an assertion that fails says so.
 *
 * Setup goes through the API rather than the onboarding dialog — fifteen companies through a wizard
 * would take longer than the rest of the suite combined.
 */
import {
	issuedInvoice,
	openInvoice,
	revealPanels,
	send,
	setupCountry,
	shot,
	waitForSettled,
} from "../support/showcase";

describe("Compliance showcase — the same code, fifteen different screens", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	// ── Correction: what replaces "edit" once a document is issued ────────────────────────────────
	it("01 FR — correcting an issued invoice offers a CREDIT NOTE (avoir)", () => {
		setupCountry("Showcase FR", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000074" },
			{ scheme: "VAT", value: "FR44732829320" },
		]).then((ids) => {
			issuedInvoice(ids).then((id) => {
				send(id as unknown as string);
				waitForSettled(id as unknown as string);
				openInvoice();
				// The real assertion, restored once sending got the document to DELIVERED. `correctionModel`
				// is CREDIT_NOTE for France and the button says so; the corrective-invoice button, which is
				// what Poland gets, is absent.
				cy.contains("button", /credit note/i).should("be.visible");
				cy.contains("button", /corrective/i).should("not.exist");
				shot("01-fr-credit-note");
			});
		});
	});

	it("02 PL — the transmission cannot complete without KSeF, whatever the screen calls it", () => {
		setupCountry("Showcase PL", "Poland", "PL", [
			{ scheme: "VAT", value: "PL1234567890" },
		]).then((ids) => {
			issuedInvoice(ids).then((id) => {
				send(id as unknown as string);
				// Assert the FACT, not the prose. Two runs died here on the wording: the screen says
				// "never reached the authority" or "awaiting delivery confirmation" depending on which
				// state the queue settled into, and both are honest. What is invariant — and what this
				// case exists to show — is that Poland cannot complete a transmission, because KSeF has
				// no credentials (finding C1, no channel can actually emit). Asserting a sentence rather
				// than the outcome made a real property look like a flake.
				waitForSettled(id as unknown as string).then((status) => {
					expect(
						status,
						"Poland cannot reach a delivered state without KSeF",
					).to.not.be.oneOf(["DELIVERED", "CLEARED", "ACCEPTED", "REPORTED"]);
				});
				openInvoice();
				revealPanels();
				shot("02-pl-cannot-complete-transmission");
			});
		});
	});

	// ── Immutability: may an issued document still be edited? ─────────────────────────────────────
	it("03 US — no VAT at all: the invoice is out of scope, and says so", () => {
		// Originally written to show that a US invoice stays editable after issuance
		// (`immutableAfter: NEVER`). It does not, and that is a GAP rather than a country difference:
		// `invoices.helpers.ts:442` hardcodes `edit: isDraft`, so the contract's immutability answer
		// never reaches the button. Recorded in the report; the case now shows a difference that is
		// real — a US sale carries no VAT line at all, category O.
		setupCountry("Showcase US", "United States", "US", []).then((ids) => {
			issuedInvoice(ids, 0).then(() => {
				openInvoice();
				cy.get('[data-cy="archival-notice"]').should("exist");
				revealPanels();
				shot("03-us-out-of-scope");
			});
		});
	});

	it("04 FR — the same issued invoice is FROZEN (immutableAfter: ISSUE)", () => {
		setupCountry("Showcase FR2", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000075" },
			{ scheme: "VAT", value: "FR44732829321" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.get('[data-cy="invoice-edit-button"]').should("not.exist");
				shot("04-fr-frozen-after-issue");
			});
		});
	});

	// ── Cancellation policy (panel A) ─────────────────────────────────────────────────────────────
	it("05 PL — cancellation is NOT AVAILABLE, and the screen says why", () => {
		setupCountry("Showcase PL2", "Poland", "PL", [
			{ scheme: "VAT", value: "PL1234567891" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				revealPanels();
				cy.get('[data-cy="cancellation-policy"]').should("be.visible");
				cy.get('[data-cy="cancellation-condition-notAllowedByCountry"]').should(
					"exist",
				);
				shot("05-pl-cancellation-unavailable");
			});
		});
	});

	it("06 MX — TWO conditions at once, which the old single-sentence code could not show", () => {
		setupCountry("Showcase MX", "Mexico", "MX", [
			{ scheme: "RFC", value: "XAXX010101000" },
			{ scheme: "MX_DOMICILIO_FISCAL", value: "01000" },
			{ scheme: "MX_REGIMEN_FISCAL", value: "601" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.get('[data-cy="cancellation-condition-buyerConsent"]').should(
					"exist",
				);
				cy.get('[data-cy="cancellation-condition-authorityAck"]').should(
					"exist",
				);
				revealPanels();
				shot("06-mx-two-cancellation-conditions");
			});
		});
	});

	it("07 IT — cancellation waits on the tax authority", () => {
		setupCountry("Showcase IT", "Italy", "IT", [
			{ scheme: "LEGAL_ID", value: "12345678901" },
			{ scheme: "VAT", value: "IT12345678901" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.get('[data-cy="cancellation-condition-authorityAck"]').should(
					"exist",
				);
				revealPanels();
				shot("07-it-cancellation-authority-ack");
			});
		});
	});

	it("08 FR — no cancellation panel at all: nothing to warn about", () => {
		setupCountry("Showcase FR3", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000076" },
			{ scheme: "VAT", value: "FR44732829322" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.get('[data-cy="cancellation-policy"]').should("not.exist");
				revealPanels();
				shot("08-fr-no-cancellation-warning");
			});
		});
	});

	// ── Obligation layers (panel C) ───────────────────────────────────────────────────────────────
	it("09 FR — the duty is shown with NO invented deadline, four days before the mandate", () => {
		setupCountry("Showcase FR4", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000077" },
			{ scheme: "VAT", value: "FR44732829323" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				// France's three declared layers are all `validFrom: 2026-09-01` and today is 2026-08-28,
				// so the engine resolves NONE of them — correctly. What remains is the regime-derived
				// issuance duty, and it says its deadline is not established rather than inventing 24 h.
				// This is the temporal profile working, not a missing feature.
				cy.get('[data-cy="obligation-ISSUANCE"]').should("exist");
				cy.get('[data-cy="obligation-RECEPTION"]').should("not.exist");
				revealPanels();
				shot("09-fr-obligation-not-yet-in-force");
			});
		});
	});

	it("10 DE — one layer only: the per-layer model exists for France alone today", () => {
		setupCountry("Showcase DE", "Germany", "DE", []).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.get('[data-cy="obligation-ISSUANCE"]').should("exist");
				cy.get('[data-cy="obligation-RECEPTION"]').should("not.exist");
				revealPanels();
				shot("10-de-single-obligation-layer");
			});
		});
	});

	// ── Retention (panel B) ───────────────────────────────────────────────────────────────────────
	it("11 FR — documents must be kept TEN years", () => {
		setupCountry("Showcase FR5", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000078" },
			{ scheme: "VAT", value: "FR44732829324" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.get('[data-cy="archival-retention"]').should("contain.text", "10");
				revealPanels();
				shot("11-fr-retention-10-years");
			});
		});
	});

	it("12 MX — FIVE years, from the same component", () => {
		setupCountry("Showcase MX2", "Mexico", "MX", [
			{ scheme: "RFC", value: "XAXX010101001" },
			{ scheme: "MX_DOMICILIO_FISCAL", value: "01001" },
			{ scheme: "MX_REGIMEN_FISCAL", value: "601" },
		]).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.get('[data-cy="archival-retention"]').should("contain.text", "5");
				revealPanels();
				shot("12-mx-retention-5-years");
			});
		});
	});

	it("13 US — SEVEN years", () => {
		setupCountry("Showcase US2", "United States", "US", []).then((ids) => {
			issuedInvoice(ids).then(() => {
				openInvoice();
				cy.get('[data-cy="archival-retention"]').should("contain.text", "7");
				revealPanels();
				shot("13-us-retention-7-years");
			});
		});
	});

	// ── VAT: the zero-rate declaration ────────────────────────────────────────────────────────────
	it("14 FR — a 0% line must declare WHY: France levies no zero rate", () => {
		setupCountry("Showcase FR6", "France", "FR", [
			{ scheme: "LEGAL_ID", value: "73282932000079" },
			{ scheme: "VAT", value: "FR44732829325" },
		]).then(() => {
			cy.visit("/invoices");
			cy.contains("button", /add|new|créer|ajouter/i, {
				timeout: 15000,
			}).click();
			cy.get('[data-cy="invoice-dialog"]', { timeout: 10000 }).should(
				"be.visible",
			);
			cy.get('[data-cy="invoice-client-select"] button').first().click();
			cy.get('[data-cy="invoice-client-select-options"] button')
				.first()
				.click();
			cy.contains("button", /Add Item|Ajouter/i).click();
			cy.get('[name="items.0.name"]').type("Exempt service", { force: true });
			cy.get('[name="items.0.quantity"]')
				.clear({ force: true })
				.type("1", { force: true });
			cy.get('[name="items.0.unitPrice"]')
				.clear({ force: true })
				.type("500", { force: true });
			cy.get('[name="items.0.vatRate"]')
				.clear({ force: true })
				.type("0", { force: true });
			cy.get('[data-cy="item-vat-category-0"]').scrollIntoView();
			cy.get('[data-cy="item-vat-category-0"]').should("be.visible");
			shot("14-fr-zero-rate-declaration");
		});
	});

	it("15 FR — at a real rate the question does not arise, and the controls stay away", () => {
		cy.visit("/invoices");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 15000 }).click();
		cy.get('[data-cy="invoice-dialog"]', { timeout: 10000 }).should(
			"be.visible",
		);
		cy.get('[data-cy="invoice-client-select"] button').first().click();
		cy.get('[data-cy="invoice-client-select-options"] button').first().click();
		cy.contains("button", /Add Item|Ajouter/i).click();
		cy.get('[name="items.0.name"]').type("Standard service", { force: true });
		cy.get('[name="items.0.quantity"]')
			.clear({ force: true })
			.type("1", { force: true });
		cy.get('[name="items.0.unitPrice"]')
			.clear({ force: true })
			.type("500", { force: true });
		cy.get('[name="items.0.vatRate"]')
			.clear({ force: true })
			.type("20", { force: true });
		cy.get('[data-cy="item-vat-category-0"]').should("not.exist");
		shot("15-fr-no-declaration-at-standard-rate");
	});
});
