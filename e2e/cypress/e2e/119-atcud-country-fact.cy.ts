export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #603 (hardcode fix B) - ATCUD driven by the country's own `policy.documentValidationCode`
 * fact (`country-policy/schema.ts`), not by `=== 'PT'` / `!== 'PT'` literals scattered across
 * `actions/atcud-issuance.ts`, `company/company.service.ts`, the settings tab and the ATCUD
 * settings screen. Behaviour must be IDENTICAL to before this change: Portugal sees and uses ATCUD,
 * every other country does not - this spec proves both halves of that claim against the real API
 * and a real browser, never a mock of the gate itself.
 *
 * Three journeys:
 *  a) a Portuguese company sees the ATCUD settings tab, registers a series, and a real invoice it
 *     sends carries a real ATCUD (`ATCUD:<code>-<sequential>`), in the API;
 *  b) the default French company (`cy.resetAndSeed()`'s own seed) never sees the ATCUD tab at all,
 *     in the nav or by a direct, stale-bookmark URL;
 *  c) a screenshot of the settings sidebar for each company, light theme, desktop width - taken
 *     from this spec so a "before" run (against `dev`, before this pull request) and an "after" run
 *     (against this branch) are directly comparable: this change moves WHERE the decision comes
 *     from, never what either company sees.
 */
const api = Cypress.env("apiUrl");
const YEAR = new Date().getFullYear();
const FT_SERIES = "FT A";
const FT_CODE = "E2EFTCODE1";

function switchSellerToPortugal() {
	cy.request({
		method: "POST",
		url: `${api}/api/company/info`,
		body: {
			name: "Acme Corp",
			country: "Portugal",
			countryCode: "PT",
			currency: "EUR",
			invoiceTransportId: "email",
			identifiers: [{ scheme: "VAT", value: "PT980405319" }],
		},
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
}

function createPortugueseClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Lisboa Consultoria Lda",
				contactEmail: "cliente.pt@example.com",
				address: "Avenida da Liberdade 110",
				postalCode: "1250-096",
				city: "Lisboa",
				country: "Portugal",
				countryCode: "PT",
				currency: "EUR",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "501442600" }],
			},
		})
		.then((res) => {
			expect(res.status, "Portuguese client created").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

/** Issues and sends a domestic Portuguese invoice, returns its id and the ATCUD actually printed. */
function issueAndSendInvoice(clientId: string) {
	const data = {
		client: clientId,
		issueDate: `${YEAR}-09-14`,
		dueDate: `${YEAR}-10-14`,
		currency: "EUR",
		lines: [{ description: "Consultoria", quantity: 1, unit: "day", unitPrice: 500, vatRate: "23" }],
	};
	return cy
		.request({ method: "POST", url: `${api}/api/documents/types/invoice/actions/save-draft`, body: { data } })
		.then((saved) => {
			const id = saved.body.document.id as string;
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/send`,
				body: { documentId: id, data: saved.body.document.data },
			})
				.its("status")
				.should("be.oneOf", [200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]);
			return cy
				.request({ url: `${api}/api/documents/${id}?typeId=invoice` })
				.its("body")
				.then((invoice) => ({ id, atcud: invoice.atcud as string | null }));
		});
}

describe("Issue #603 - ATCUD gated by the country's own documentValidationCode fact, never a literal 'PT'", () => {
	beforeEach(() => {
		cy.resetAndSeed();
		cy.login();
		// Below `lg` the settings nav is a mobile picker, not the desktop sidebar the screenshots
		// below need - see 09-settings.cy.ts's own comment on the same Cypress default (1000x660).
		cy.viewport(1280, 720);
	});

	it("a Portuguese company sees the ATCUD tab, registers a series, and an issued invoice carries a real ATCUD", () => {
		switchSellerToPortugal();
		cy.request({
			method: "PUT",
			url: `${api}/api/company/atcud-series`,
			body: { typeId: "invoice", seriesId: FT_SERIES, validationCode: FT_CODE },
		})
			.its("status")
			.should("be.oneOf", [200, 201]);

		cy.visit("/settings");
		cy.get('[data-cy="settings-nav"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="settings-nav-atcud"]', { timeout: 15000 }).should("be.visible");

		// Screenshot for the pull request - settings sidebar, Portuguese company, light desktop.
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("not.exist");
		cy.screenshot("603-atcud-settings-sidebar-pt-light-desktop", { capture: "viewport" });

		cy.get('[data-cy="settings-nav-atcud"]').click();
		cy.url().should("include", "/settings/atcud");
		cy.get('[data-cy="atcud-section"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="atcud-not-applicable"]').should("not.exist");

		createPortugueseClient().then((clientId) => {
			issueAndSendInvoice(clientId).then(({ atcud }) => {
				expect(atcud, "the Portuguese invoice carries a real ATCUD").to.match(
					new RegExp(`^ATCUD:${FT_CODE}-\\d+$`),
				);
			});
		});
	});

	it("the default French company never sees the ATCUD tab, in the nav or by a direct, stale-bookmark URL", () => {
		cy.visit("/settings");
		cy.get('[data-cy="settings-nav"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="settings-nav-atcud"]').should("not.exist");
		cy.get('[data-cy="settings-nav-select-options"]').should("not.exist"); // sanity: desktop nav, not the mobile picker

		// Screenshot for the pull request - settings sidebar, French company, light desktop. Must
		// look identical to the Portuguese one above, minus the extra "ATCUD" entry.
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("not.exist");
		cy.screenshot("603-atcud-settings-sidebar-fr-light-desktop", { capture: "viewport" });

		// A stale bookmark from before the company's own country changed (or one that never applied
		// in the first place) renders the "company" tab instead - never a half-built ATCUD screen.
		cy.visit("/settings/atcud");
		cy.get('[data-cy="settings-tab-company"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="atcud-section"]').should("not.exist");
	});
});
