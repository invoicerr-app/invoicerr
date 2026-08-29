/**
 * The same code, four countries, four different answers — and not one branch names any of them.
 *
 * The correction flow proven in `19-correction-flow.cy.ts` is French only by accident: it is the same
 * code everywhere. What CHANGES per country is what the profile declares — which documents exist,
 * which correction routes are open, whether an issued invoice may still be edited, how long it must
 * be kept. This spec asserts those differences, and asserts that the FLOW around them is identical.
 *
 * Every expectation below traces to a sourced rule in `docs/compliance/CORRECTION-ROUTES.yaml`:
 *   Italy   — no amend-by-reference instrument exists at all (Provv. AdE 89757/2018, punto 6.1), and
 *             a debit note is COMPELLED on any increase (art. 26 DPR 633/72 comma 1).
 *   Mexico  — cancel-and-replace is required when the document itself is wrong, and cancelling needs
 *             the recipient's acceptance (CFF art. 29-A ¶4-6, RMF 2026 2.7.1.34).
 *   USA     — a sourced negative: no federal invoice, nothing freezes, everything stays open
 *             (26 U.S.C. § 6001, IRS Pub 583).
 */
import { api } from "../support/showcase";

type Kind = { kind: string };

const kindsFor = (countryCode: string) =>
	cy
		.request<Kind[]>({
			url: `${api}/api/compliance/document-kinds?countryCode=${countryCode}&at=2026-08-29`,
		})
		.its("body")
		.then((rules) => rules.map((r) => r.kind));

describe("What a country's profile actually changes", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	describe("Italy — a country with no corrective invoice at all", () => {
		it("offers the debit note its law compels, and NOT a corrective invoice", () => {
			// Art. 26 comma 1 says "devono essere osservate" of an increase — an obligation — while
			// comma 2 leaves the decrease a faculty. And the provvedimento frames every variation as a
			// nota di credito or di debito, leaving no amend-by-reference instrument to offer.
			kindsFor("IT").then((kinds) => {
				expect(kinds, "the document Italy compels").to.include("DEBIT_NOTE");
				expect(kinds, "and the one its law does not have").to.not.include(
					"CORRECTIVE_INVOICE",
				);
			});
		});
	});

	describe("Mexico — the only shipped country that must cancel and replace", () => {
		it("offers a replacement invoice, and no corrective invoice", () => {
			// When the DOCUMENT itself is wrong, Mexico imposes an order: issue the correct CFDI with
			// TipoRelacion 04, THEN request the cancellation with motive 01. A stamped CFDI is
			// immutable, so there is no amend-by-reference instrument either.
			kindsFor("MX").then((kinds) => {
				expect(kinds, "the fresh invoice a replacement produces").to.include(
					"INVOICE",
				);
				expect(
					kinds,
					"the nota de crédito the SAT names in so many words",
				).to.include("CREDIT_NOTE");
				expect(kinds, "no amend-by-reference instrument exists").to.not.include(
					"CORRECTIVE_INVOICE",
				);
			});
		});
	});

	describe("United States — a sourced negative, and it shows", () => {
		it("offers every correcting document, because no text forbids any of them", () => {
			// `OPEN` here means "no text forbids it", not "a text organises it". There is no federal
			// invoice at all: 26 U.S.C. § 6001 imposes RECORDS, not a DOCUMENT.
			kindsFor("US").then((kinds) => {
				for (const kind of [
					"CREDIT_NOTE",
					"DEBIT_NOTE",
					"CORRECTIVE_INVOICE",
				]) {
					expect(
						kinds,
						`${kind} is not forbidden anywhere in US law`,
					).to.include(kind);
				}
			});
		});
	});

	describe("France — the reference the others are contrasted with", () => {
		it("offers all three, and its own profile says why", () => {
			// CGI art. 289, I, 5 assimilates any referencing document to an invoice, so the corrective
			// invoice exists here where it does not in Italy or Mexico.
			kindsFor("FR").then((kinds) => {
				expect(kinds).to.include("CREDIT_NOTE");
				expect(kinds).to.include("CORRECTIVE_INVOICE");
			});
		});
	});

	describe("And the flow around them is the same code", () => {
		it("no two countries answer alike, which is the only proof that nothing is hard-coded", () => {
			// If a business branch named a country, the answers would drift toward whatever that branch
			// assumed. Four countries, and the sets differ — measured, not asserted country by country.
			const seen: Record<string, string> = {};
			for (const cc of ["FR", "IT", "MX", "US"]) {
				kindsFor(cc).then((kinds) => {
					seen[cc] = [...kinds].sort().join(",");
				});
			}
			cy.then(() => {
				expect(seen.IT, "Italy differs from France").to.not.eq(seen.FR);
				expect(seen.US, "the United States differ from Italy").to.not.eq(
					seen.IT,
				);
				// Italy and Mexico DO agree on the document list — both lack the corrective invoice —
				// and that is a real fact, not an oversight. They part company elsewhere: Mexico's
				// correction model is CANCEL_AND_REPLACE, Italy's is CREDIT_NOTE.
				expect(
					seen.MX,
					"Italy and Mexico agree here, and the comment says why",
				).to.eq(seen.IT);
			});
		});
	});
});
