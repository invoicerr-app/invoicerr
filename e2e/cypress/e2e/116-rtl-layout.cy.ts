export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #559 - right-to-left layout.
 *
 * No Arabic, Hebrew, Persian or Urdu translation exists yet (RTL_LOCALES's own comment in
 * frontend/src/lib/i18n.ts), so this suite drives the app through the dev-only "rtltest" locale: a
 * verbatim copy of the English catalog, registered under a code the explicit RTL_LOCALES mechanism
 * also recognizes as right-to-left, built ONLY when `import.meta.env.DEV` is true and never exposed
 * in the language picker - confirmed absent from a real `vite build` output (the PR body pastes that
 * check). `npm run start:test` (what this suite runs against, per the frontend's own CLAUDE.md) is a
 * dev-mode `vite` server, so the locale is live here the same way it is in local dev.
 *
 * Activated the same way `73-account-page.cy.ts` activates a real language: writing `i18nextLng` to
 * localStorage, then a real `cy.reload()` so the i18next instance that already booted actually
 * re-reads it - flipping the storage key alone does not re-render a mounted page, the identical
 * reasoning `109-revenue-basis-cashed-view.cy.ts`'s own theme-toggle helpers already document.
 */
const api = Cypress.env("apiUrl");

function enableRtlTestLocale() {
	cy.window().then((win) => win.localStorage.setItem("i18nextLng", "rtltest"));
	cy.reload();
}

function enableEnglish() {
	cy.window().then((win) => win.localStorage.setItem("i18nextLng", "en"));
	cy.reload();
}

/** Same shape as 39-document-conformity.cy.ts's own `createInvoiceDraft` - a minimal one-line
 *  invoice against the seeded baseline client, just to have a real amount on the list screen. */
function createInvoiceDraft() {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			expect(clients, "the seed data has a client").to.have.length.greaterThan(0);
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
								{ description: "Consulting", quantity: 1, unit: "hour", unitPrice: 1234, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				})
				.then((saved) => {
					expect(saved.status, "invoice draft created").to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id as string;
					expect(id, "the draft has an id").to.be.a("string");
					return id;
				});
		});
}

describe("RTL layout (#559)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("sets dir=rtl and lang on the document root for the RTL test locale, and reverts to ltr for English", () => {
		cy.visit("/dashboard");
		cy.get("html").should("have.attr", "dir", "ltr");

		enableRtlTestLocale();
		cy.get("html", { timeout: 10000 }).should("have.attr", "dir", "rtl");
		cy.get("html").should("have.attr", "lang", "rtltest");

		enableEnglish();
		cy.get("html", { timeout: 10000 }).should("have.attr", "dir", "ltr");
		cy.get("html").should("have.attr", "lang", "en");
	});

	it("mirrors the sidebar to the right edge of the viewport under the RTL test locale", () => {
		cy.viewport(1280, 720);
		cy.visit("/dashboard");
		enableRtlTestLocale();

		// `data-cy="app-sidebar"` (components/sidebar.tsx) lands on ui/sidebar.tsx's own
		// `sidebar-container` div (props spread onto it) - `data-side` is set one level up, on its
		// parent (the "group peer" wrapper that also carries `data-slot="sidebar"`).
		cy.get('[data-cy="app-sidebar"]', { timeout: 10000 })
			.should("be.visible")
			.parent()
			.should("have.attr", "data-side", "right");

		cy.get('[data-cy="app-sidebar"]').then(($sidebar) => {
			const rect = $sidebar[0].getBoundingClientRect();
			expect(
				rect.right,
				"the sidebar's own right edge sits at the viewport's right edge",
			).to.be.closeTo(1280, 2);
		});
	});

	it("keeps a document list amount reading left-to-right inside RTL text", () => {
		createInvoiceDraft().then((id) => {
			cy.visit("/documents/invoice");
			enableRtlTestLocale();

			cy.get(`[data-cy="document-row-amount-${id}"]`, { timeout: 10000 })
				.should("be.visible")
				.find('[dir="ltr"]')
				.should("exist")
				.invoke("text")
				.should("match", /\d/);
		});
	});
});
