export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * i18n of descriptor labels (raw data today). The mechanism
 * (frontend/src/lib/descriptor-i18n.ts, wired into
 * hooks/queries/use-document-types.ts and use-widgets.ts) makes the frontend try a DERIVED key
 * (`documents.descriptors.<typeId>...`) with a FALLBACK to the descriptor's raw label when it
 * does not exist — never the other way round. locales/en/translation.json only carries keys for the
 * FIVE NATIVE types, and their EN values are the descriptors' CURRENT text, word for word: this
 * file therefore does NOT prove the screen changes (it must not), but that the mechanism is really
 * this one, not a lucky coincidence:
 *
 *  1. the type, its fields (including a field nested inside an 'array'), its actions, and a
 *     draft's status all display identically to before — the key exists, its EN value = the
 *     raw label;
 *  2. the FALLBACK is seen for real on a concrete case this app already exposes in production: the
 *     VAT rate catalog (vat-rates/, backend/src/modules/documents/descriptors/company-view.ts) fills
 *     the `vatRate` select's OPTIONS PER COMPANY, AT RUNTIME, in whatever language the country's
 *     catalog is written in (French for FR — see vat-rates/data/fr.json); no
 *     `documents.descriptors.invoice.fields.lines.fields.vatRate.options.<rate>` key exists (and
 *     CANNOT exist, the content depends on the active company) — the value therefore stays the
 *     backend's RAW label, as is, in French, on a screen whose active language is English.
 *     This is the most direct and most "genuine" proof of the "an untranslated plugin stays
 *     displayed as-is" escape hatch that this app can offer today: it has no third-party
 *     document type actually registered yet to demonstrate it any other way.
 *
 * The REAL proof of non-regression is the full battery (outside this file): the existing
 * specs assert en masse on the descriptors' current English text (17, 20, 21, 24, 26,
 * 28, 34, 37…) — they must pass AS THEY ARE, without a single weakened assertion, since the
 * EN values added here are, word for word, the labels they already expected.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

function createInvoiceDraft() {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);
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
								{ description: "Conseil", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				})
				.then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id as string;
					expect(id, "le brouillon a un identifiant").to.be.a("string");
					return id;
				});
		});
}

describe("i18n descriptors (item 25) -- key derived in EN, falling back to the raw label otherwise", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("the type, its fields (including nested ones), its actions display identically to before", () => {
		cy.visit("/documents/invoice");

		// The sidebar names the type — documents.descriptors.invoice.label now exists on the EN side,
		// with exactly the same value as the descriptor's raw label.
		cy.get('[data-cy="sidebar-document-type-link-invoice"]').should("contain.text", "Invoice");

		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("be.visible");

		// The dialog's title interpolates the translated type label (documents.form.newTitle, already
		// existing — {{label}} now becomes the derivation's result, not the raw value directly).
		cy.get('[data-cy="document-create-dialog"]').should("contain.text", "New: Invoice");

		// Fields at TWO DEPTHS: top-level (documents.descriptors.invoice.fields.<key>.label)
		// and a row of the "lines" array (…fields.lines.fields.<key>.label) — the same derivation
		// covers both, wired only once on the hooks/queries/use-document-types.ts side. The dialog is
		// now the stepped wizard (owner decision 2026-09-16, document-create-dialog.tsx's
		// `buildFieldGroups`): client/issueDate/dueDate/currency (all `required`) sit on "Details",
		// "lines" (table-shaped) gets its own "Lines" step, and notes/origin/clientReference
		// (optional) land on "Options" — filling each step's own required fields with REAL values
		// (the same pattern as 20-document-totals.cy.ts) is what actually walks this test far enough
		// to reach "notes" and the "save-draft" action on the closing Summary step.
		cy.get('[data-cy="document-field-client"]').should("contain.text", "Client");
		cy.get('[data-cy="document-field-issueDate"]').should("contain.text", "Date");
		cy.get('[data-cy="document-field-dueDate"]').should("contain.text", "Due date");
		cy.get('[data-cy="document-field-currency"]').should("contain.text", "Currency");

		// Picking the client is not just a value change: the screen re-fetches its own descriptor
		// with that client (the country field overlays depend on the buyer) and rebuilds every field
		// node below when the answer lands. `pickDocumentClient` (support/commands.ts) waits for that
		// rebuild AND for the picker's own teardown, so the calendar opened on the next line is not
		// unmounted or dismissed under the command driving it.
		cy.pickDocumentClient();
		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.pickToday('[data-cy="document-field-dueDate-input"]');
		cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();
		cy.continueDocumentWizard(); // Details -> Lines

		cy.get('[data-cy="document-field-lines"]').should("contain.text", "Lines");
		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]')
			.should("contain.text", "Designation")
			.and("contain.text", "Quantity")
			.and("contain.text", "Unit")
			.and("contain.text", "Unit price")
			.and("contain.text", "VAT rate")
			.and("contain.text", "Discount %");

		// A full, valid line — quantity/unitPrice are numeric (an untouched row leaves them
		// `undefined`, which fails the wizard's own per-step `form.trigger` on Continue).
		cy.get('input[name="lines.0.description"]').type("Conseil", { force: true });
		cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("1", { force: true });
		cy.get('input[name="lines.0.unit"]').type("hour", { force: true });
		cy.get('input[name="lines.0.unitPrice"]').clear({ force: true }).type("100", { force: true });
		cy.get('[data-cy="document-field-lines-row-0"] [data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-vatRate-input-options"] button').first().click();
		cy.continueDocumentWizard(); // Lines -> Options

		cy.get('[data-cy="document-field-notes"]').should("contain.text", "Notes");
		cy.continueDocumentWizard(); // Options -> Summary

		// The actions — documents.descriptors.invoice.actions.<id>.label, the same EN value as before.
		// "send" only appears once the document has been saved a first time (its derived
		// `availableWhen` never includes a record with no status, unlike "save-draft", declared
		// `from: 'always'`): "save-draft" alone is enough here to prove the derivation on an action.
		cy.get('[data-cy="document-action-save-draft"]').should("contain.text", "Save draft");
	});

	it("a draft's status badge reads the descriptor's DECLARED label, not just the capitalized id", () => {
		// document-status-badge.tsx now receives `label` (the TRANSLATED status that
		// useDocumentType() has already resolved) and only falls back to `capitalize(status)` when
		// that status is not declared at all — here "draft" IS declared, so it is indeed
		// documents.descriptors.invoice.statuses.draft (= "Draft" in EN) that gets displayed.
		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");
		});
	});

	it("FALLBACK: the VAT rate options (per-company catalog, never translated here) stay the backend's RAW label — in French, on an English screen", () => {
		cy.visit("/documents/invoice");
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("be.visible");

		// "client"/"issueDate"/"dueDate"/"currency" (all `required`) are the wizard's own "Details"
		// step, ahead of "Lines" — nothing this test actually reads, just what has to be filled to
		// reach the row the vatRate field lives on (document-create-dialog.tsx's `buildFieldGroups`).
		// Picking the client is not just a value change: the screen re-fetches its own descriptor
		// with that client (the country field overlays depend on the buyer) and rebuilds every field
		// node below when the answer lands. `pickDocumentClient` (support/commands.ts) waits for that
		// rebuild AND for the picker's own teardown, so the calendar opened on the next line is not
		// unmounted or dismissed under the command driving it.
		cy.pickDocumentClient();
		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.pickToday('[data-cy="document-field-dueDate-input"]');
		cy.get('[data-cy="document-field-currency-input"] button').first().click({ force: true });
		cy.get('[data-cy="document-field-currency-input-options"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy^="document-field-currency-input-option-eur"]').first().click();
		cy.continueDocumentWizard(); // Details -> Lines

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('[data-cy="document-field-lines-row-0"]')
			.find('[data-cy="document-field-vatRate-input"] button')
			.first()
			.click({ force: true });

		// Portaled outside the row (Radix Popover) — queried directly, the same technique as
		// 14-articles.cy.ts for the "from catalog" picker.
		cy.get('[data-cy="document-field-vatRate-input-options"]', { timeout: 10000 })
			.should("be.visible")
			// vat-rates/registry.ts composes this label ({{rate}}% — {{label}}) from
			// vat-rates/data/fr.json ("Taux normal") — never from this translation file, and
			// no "…fields.vatRate.options.20" key was added (the content depends on the
			// active company, not a static language catalog). The mechanism still tries
			// the derived key, does not find it, and renders this text as-is.
			.should("contain.text", "20% — Taux normal");
	});
});
