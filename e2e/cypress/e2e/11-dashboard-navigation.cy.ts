export {}; // makes this spec a module, not a global script -- see tsconfig.json

beforeEach(() => {
	cy.login();
});

describe("Dashboard E2E", () => {
	describe("Dashboard Loading", () => {
		it("loads dashboard page", () => {
			cy.visit("/dashboard");
			cy.wait(1000);
			cy.url().should("include", "/dashboard");
		});

		it("displays main content", () => {
			cy.visit("/dashboard");
			cy.wait(1000);
			cy.get('main, [role="main"], .main-content').should("exist");
		});

		it("displays statistics cards", () => {
			cy.visit("/dashboard");
			cy.wait(2000);
			cy.get('[class*="Card"], [class*="card"]').should(
				"have.length.at.least",
				1,
			);
		});
	});

	describe("Dashboard Statistics", () => {
		// The dashboard is no longer a hand-written page: it aggregates whatever EACH document
		// type wants to show there. We therefore no longer require a word ("revenue", "quotes") that
		// belonged to the old screen, but the generic fact: at least one contribution is rendered, and
		// none of them falls on the "unrendered widget type" marker.
		it("renders at least one contribution, and none unrendered", () => {
			cy.visit("/dashboard");
			cy.get('[data-cy^="widget-"]', { timeout: 20000 }).should("exist");
			cy.get('[data-cy="widget-unsupported"]').should("not.exist");
		});

		it("shows invoices section", () => {
			cy.visit("/dashboard");
			// A bare `cy.contains(/invoices|factures/i)`, unscoped, matches the SIDEBAR's own
			// "Invoices" document-type link (`sidebar-document-type-link-invoice`, present as soon as
			// the type is registered, whatever the dashboard itself renders) — an empty or entirely
			// missing invoice widget would still pass. `invoice-contributions.ts` (backend) ids every
			// invoice widget `invoice:<name>` (`invoice:pending`, `invoice:all`, `invoice:count`, ...),
			// and each renderer stamps `data-cy="widget-<id>"` — scope to that instead, so a genuinely
			// empty dashboard contribution actually fails this test.
			cy.get('[data-cy^="widget-invoice:"]', { timeout: 20000 }).should("have.length.at.least", 1);
		});
	});
});

describe("Navigation E2E", () => {
	describe("Sidebar Navigation", () => {
		it("navigates to dashboard", () => {
			cy.visit("/clients");
			cy.wait(1000);

			cy.get('[data-cy="sidebar-dashboard-link"]').click({ force: true });
			cy.url().should("include", "/dashboard");
		});

		it("navigates to clients", () => {
			cy.visit("/dashboard");
			cy.wait(1000);

			cy.get('[data-cy="sidebar-clients-link"]').click({ force: true });
			cy.url().should("include", "/clients");
		});

		// Navigation to a document type is NOT tested here, and that is deliberate: this
		// spec only does `cy.login()`, with no `resetAndSeed()`. It therefore inherits the state left
		// by the previous spec and has no company whose country is guaranteed — and the Documents
		// group fills in from the COUNTRY policy. The test used to live here while the sidebar carried
		// hard-coded links; it followed the data and now lives in 17-document-descriptor.cy.ts,
		// which builds its own world before querying it.

		it("navigates to settings", () => {
			cy.visit("/dashboard");
			cy.wait(1000);

			cy.get('[data-cy="sidebar-settings-link"]').click({ force: true });
			cy.url().should("include", "/settings");
		});
	});

	describe("Page Direct Access", () => {
		it("accesses dashboard directly", () => {
			cy.visit("/dashboard");
			cy.url().should("include", "/dashboard");
		});

		it("accesses clients directly", () => {
			cy.visit("/clients");
			cy.url().should("include", "/clients");
		});

		it("accesses quotes directly", () => {
			cy.visit("/quotes");
			cy.url().should("include", "/quotes");
		});

		it("accesses invoices directly", () => {
			cy.visit("/invoices");
			cy.url().should("include", "/invoices");
		});

		it("accesses payments directly", () => {
			cy.visit("/payments");
			cy.url().should("include", "/payments");
		});

		it("accesses settings directly", () => {
			cy.visit("/settings");
			cy.url().should("include", "/settings");
		});
	});

	describe("Breadcrumb and Back Navigation", () => {
		it("uses browser back button", () => {
			cy.visit("/dashboard");
			cy.wait(500);

			cy.get('[data-cy="sidebar-clients-link"]').click({ force: true });
			cy.wait(500);
			cy.url().should("include", "/clients");

			cy.go("back");
			cy.url().should("include", "/dashboard");
		});
	});
});
