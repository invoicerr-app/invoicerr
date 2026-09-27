export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The 5 sourced country-policy files (DE, IT, PL, ES, MX,
 * `backend/src/modules/documents/country-policy/data/`). Before this file, a company whose country
 * had no country-policy/ file saw EVERY document action refused (403, "no document
 * action policy is declared for..." — country-policy.ts's own DECISION 1): Poland, a primary
 * market of this product, could not even ISSUE an invoice. This file proves THE UNBLOCKING
 * itself, through the screen, for Poland (`data/pl.json`) — never through one more jest test, which
 * cannot prove that the REAL "Send" button works behind a REAL click against the REAL server.
 *
 * Two angles, a single describe:
 *  1. The unblocking: a Polish company, FROM ITS OWN CREATION (never a switch afterward — unlike
 *     `43-correction-routes.cy.ts`'s own PL cancel test, which had to issue under FR
 *     THEN switch, for lack of a PL file at the time — that constraint no longer exists), issues a
 *     REAL invoice through a REAL click on "Send".
 *  2. The restriction read: `pl.json`'s own `invoice.save-draft` quotes the Podręcznik KSeF verbatim
 *     ("nie jest możliwe jej edytowanie" — not editable once transmitted) and carries it as
 *     `statuses: ["draft"]`. Composed by `country-policy.ts`/`documents.service.ts` with the
 *     document's own status, this restriction produces a 409 (never a 403 — see `country-policy.ts`'s
 *     own header: the action IS allowed by this country in principle, just not from this status,
 *     exactly what a 409 already means for `availableWhen`), and makes the "Save draft" button
 *     disappear from the edit screen of an already-issued invoice — never a visible button that
 *     would silently fail. None of the five new rules is `allowed: false` (the research found
 *     no clean-cut prohibition for the (type, action) pairs covered — an invented `allowed: false`
 *     would be exactly the invented tax rule this repository forbids): this test therefore proves the
 *     GENUINELY sourced restriction (the status), not a `policyBlockedReason`, which has no reason to
 *     exist here for lack of a prohibition to source.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createClient(name: string, country: string, countryCode: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				// A simple, valid address — never derived from the name (which carries Polish
				// dots/spaces), which made a first version of this test fail on real delivery
				// ("send_failed", an SMTP fluke unrelated to what this country-policy/ file gates).
				contactEmail: "klient.testowy@example.com",
				address: "ul. Przykładowa 1",
				postalCode: "00-001",
				city: "Warszawa",
				country,
				countryCode,
				currency: "EUR",
				isActive: true,
			},
		})
		.then((res) => {
			expect(res.status, "client polonais créé par API").to.be.oneOf([200, 201]);
			const id = res.body?.id as string;
			expect(id, "le client créé a un identifiant").to.be.a("string");
			return id;
		});
}

function invoiceData(clientId: string) {
	return {
		client: clientId,
		issueDate: "2026-09-03",
		dueDate: "2026-10-03",
		currency: "EUR",
		lines: [
			{
				description: "Usługi doradcze",
				quantity: 1,
				unit: "day",
				unitPrice: 1000,
				// The normal Polish rate (23%) — a content choice, unrelated to what this
				// country-policy/ file gates (the ACTION, not the rate); no vat-rates/ catalog
				// dedicated to Poland exists to date (only fr.json is there), so this rate is not
				// validated against any list — a plain number carried by the line.
				vatRate: "23",
			},
		],
	};
}

function createInvoiceDraft(clientId: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: { data: invoiceData(clientId) },
			failOnStatusCode: false,
		})
		.then((saved) => {
			expect(saved.status, "brouillon de facture polonaise créé par API (déjà un premier déblocage : ce POST était un 403 nommé avant ce fichier)").to.be.oneOf([200, 201]);
			const invoiceId = saved.body?.document?.id as string;
			expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");
			return invoiceId as string;
		});
}

describe("Country policy — Poland can now issue, and its own sourced restriction blocks where KSeF says so", () => {
	// `invoiceId` is set by the FIRST test below and read by the SECOND — a sequential business
	// narrative sharing one document, deliberately, the same house convention
	// `scenarios/full-lifecycle.cy.ts` (and dozens of other numbered specs — 43/66 among them) already
	// use rather than each `it` re-deriving its own fixture from scratch. This means the second test
	// cannot run meaningfully in isolation (`it.only`, a name-grep, or a re-ordered file) — but nothing
	// this suite's own documented tooling does ever runs a single `it` out of a spec: every command in
	// CLAUDE.md's E2E section runs a WHOLE spec file (`npx cypress run --spec
	// "cypress/e2e/44-country-policy.cy.ts"`), in file order, every time.
	let invoiceId: string;

	before(() => {
		cy.resetAndSeed();

		// Switches the seller country BEFORE any document is created — unlike
		// `43-correction-routes.cy.ts`'s own PL test, which had to issue under FR first for lack of a
		// country-policy/ file for Poland. This file PROVES that constraint is gone.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { name: "Acme Corp", country: "Poland", countryCode: "PL", invoiceTransportId: "email" },
		}).then((res) => {
			expect(res.status, "pays vendeur réglé sur la Pologne dès la création").to.be.oneOf([200, 201]);
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it('THE UNBLOCKING: a Polish company issues a REAL invoice through a REAL click on "Send" — impossible before this file (403 on EVERY action)', () => {
		createClient("Klient Testowy Sp. z o.o.", "Poland", "PL").then((clientId) => {
			createInvoiceDraft(clientId).then((id) => {
				invoiceId = id;

				cy.visit("/documents/invoice");
				cy.openDocument(invoiceId);

				// The "Send" button is genuinely OFFERED on screen for this Polish company (no
				// `policyBlockedReason` on it) — the most direct proof that `invoice.send` is
				// `allowed: true` in `pl.json`, sourced on art. 106m/106na of the ustawa o VAT.
				cy.get('[data-cy="document-action-send"]', { timeout: 15000 })
					.should("exist")
					.and("not.be.disabled");
				cy.runDocumentAction("send");

				// The proof that sending genuinely succeeded: "record-payment" is only offered on a
				// "sent" invoice (same pattern as 24-document-payments.cy.ts).
				cy.get('[data-cy="document-action-record-payment"]', { timeout: 20000 }).should("exist");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.status, "la facture polonaise est réellement \"sent\" en base").to.eq(
							"sent",
						);
						expect(
							doc.displayNumber,
							"une facture polonaise émise porte un numéro, comme n'importe quel autre pays fondé",
						).to.be.a("string");
					});
			});
		});
	});

	it('THE RESTRICTION READ: "invoice.save-draft" (Podręcznik KSeF, "nie jest możliwe jej edytowanie") blocks RE-saving as draft an already-issued Polish invoice — named 409, never a silence, and the button disappears from the screen', () => {
		expect(invoiceId, "la facture polonaise émise par le test précédent existe toujours").to.be.a(
			"string",
		);

		// On the API side first — the proof that matters: a direct POST on "save-draft" with this
		// `documentId` (a scripted client that would bypass the screen) is refused with a NAMED 409,
		// never a silence nor a success that would quietly overwrite an already-transmitted invoice.
		//
		// Issue #468: `invoice.descriptor.ts` now declares its OWN `lockedStatuses` (every status but
		// "draft") - a TYPE-level, code-only refusal that composes BEFORE country-policy's own
		// per-status restriction is even reached (`documents.service.ts#runAction`'s ordering), so
		// pl.json's `invoice.save-draft` -> `statuses: ["draft"]` rule (still sourced on the KSeF
		// manual, still declared, still the second layer CLAUDE.md's own documents-module section
		// asks for) is now SHADOWED here: the CODE guard is what a Polish company's own scripted
		// client actually hits first. This still proves KSeF's own "nie jest możliwe jej
		// edytowanie" rule holds in practice (refused, 409, invoice untouched) - the message just
		// names the type-level reason rather than the country-policy one now.
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				documentId: invoiceId,
				data: invoiceData("00000000-0000-0000-0000-000000000000"),
			},
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "409 — la facture émise n'est plus éditable, jamais un 200 silencieux").to.eq(
				409,
			);
			expect(
				String(res.body?.message ?? ""),
				'the message names the TYPE-level refusal (issue #468 - "an issued document is never rewritten")',
			).to.match(/refused once the document has left draft.*status "sent".*an issued document is never rewritten/i);
		});

		// On the screen side next — the same restriction, composed in `isActionAvailable` (types.ts),
		// makes the "Save draft" button disappear rather than leaving it clickable to silently fail
		// (same discipline as `policyBlockedReason`: a visible rule, never a trap).
		cy.visit("/documents/invoice");
		cy.openDocument(invoiceId);
		// Neither as the header's primary nor inside the "Actions" menu (opened, so the absence is
		// proven against a rendered menu rather than a closed one).
		cy.get('[data-cy="document-action-save-draft"]').should("not.exist");
		cy.openDocumentActionsMenu();
		cy.get('[data-cy="document-action-save-draft"]').should("not.exist");

		// And the invoice genuinely stays "sent", never downgraded — the negative proof that closes the loop.
		cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
			.its("body.status")
			.should("eq", "sent");
	});
});
