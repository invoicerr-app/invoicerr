describe("Multi-Tenant System", () => {
	beforeEach(() => {
		// Login or setup test user for each test
		cy.visit("/auth/sign-in");
		cy.get('[data-testid="email-input"]').type("test@example.com");
		cy.get('[data-testid="password-input"]').type("Password123!");
		cy.get('[data-testid="sign-in-button"]').click();
		cy.url().should("include", "/dashboard");
	});

	describe("Company Isolation", () => {
		it("should create company with unique settings", () => {
			cy.visit("/settings");

			// Check company info
			cy.get('[data-testid="company-name"]').should("contain", "Test Company");
			cy.get('[data-testid="company-currency"]').should("contain", "EUR");

			// Test currency change
			cy.get('[data-testid="currency-select"]').select("USD");
			cy.get('[data-testid="save-settings"]').click();

			cy.get('[data-testid="success-toast"]').should("be.visible");
			cy.get('[data-testid="company-currency"]').should("contain", "USD");
		});

		it("should maintain separate client lists", () => {
			// Create client in first company
			cy.visit("/clients");
			cy.get('[data-testid="add-client-button"]').click();
			cy.get('[data-testid="client-name"]').type("Company 1 Client");
			cy.get('[data-testid="client-email"]').type("client1@company1.com");
			cy.get('[data-testid="save-client"]').click();

			cy.get('[data-testid="client-list"]').should(
				"contain",
				"Company 1 Client",
			);

			// Logout and login with different company
			cy.get('[data-testid="user-menu"]').click();
			cy.get('[data-testid="logout-button"]').click();

			// Login with second company user
			cy.visit("/auth/sign-in");
			cy.get('[data-testid="email-input"]').type("company2@example.com");
			cy.get('[data-testid="password-input"]').type("Password123!");
			cy.get('[data-testid="sign-in-button"]').click();

			cy.visit("/clients");
			cy.get('[data-testid="client-list"]').should(
				"not.contain",
				"Company 1 Client",
			);
		});

		it("should isolate invoice data between companies", () => {
			// Create invoice in first company
			cy.visit("/invoices");
			cy.get('[data-testid="create-invoice-button"]').click();

			cy.get('[data-testid="invoice-number"]').should("be.visible");
			cy.get('[data-testid="save-invoice"]').click();

			// Logout and check second company
			cy.get('[data-testid="user-menu"]').click();
			cy.get('[data-testid="logout-button"]').click();

			cy.visit("/auth/sign-in");
			cy.get('[data-testid="email-input"]').type("company2@example.com");
			cy.get('[data-testid="password-input"]').type("Password123!");
			cy.get('[data-testid="sign-in-button"]').click();

			cy.visit("/invoices");
			cy.get('[data-testid="invoice-list"]').should("be.empty");
		});
	});

	describe("Authentication Flow", () => {
		it("should redirect unauthenticated users", () => {
			cy.clearCookies();
			cy.visit("/clients");
			cy.url().should("include", "/auth/sign-in");

			cy.visit("/invoices");
			cy.url().should("include", "/auth/sign-in");

			cy.visit("/settings");
			cy.url().should("include", "/auth/sign-in");
		});

		it("should prevent access to other company data", () => {
			// Try to access another company's invoice directly via URL
			cy.visit("/invoices/some-other-company-invoice-id");
			cy.get('[data-testid="not-found"]')
				.or('[data-testid="access-denied"]')
				.should("be.visible");
		});
	});

	describe("Multi-Tenant Settings", () => {
		it("should maintain separate numbering sequences", () => {
			cy.visit("/settings");

			// Check invoice numbering settings
			cy.get('[data-testid="invoice-numbering"]').within(() => {
				cy.get('[data-testid="starting-number"]').should("have.value", "1");
				cy.get('[data-testid="number-format"]').should(
					"have.value",
					"INV-{year}-{number:4}",
				);
			});

			// Change numbering
			cy.get('[data-testid="starting-number"]').clear().type("100");
			cy.get('[data-testid="save-settings"]').click();

			// Create new invoice to test numbering
			cy.visit("/invoices");
			cy.get('[data-testid="create-invoice-button"]').click();
			cy.get('[data-testid="invoice-number"]').should("contain", "100");
		});

		it("should handle different PDF formats per company", () => {
			cy.visit("/settings");

			// Test PDF format options
			cy.get('[data-testid="pdf-format-select"]').should("contain", "Factur-X");
			cy.get('[data-testid="pdf-format-select"]').select("PDF");
			cy.get('[data-testid="save-settings"]').click();

			// Verify setting is saved
			cy.get('[data-testid="pdf-format-select"]').should("have.value", "pdf");
		});

		it("should maintain separate date formats", () => {
			cy.visit("/settings");

			cy.get('[data-testid="date-format-select"]').should(
				"have.value",
				"dd/MM/yyyy",
			);
			cy.get('[data-testid="date-format-select"]').select("MM/dd/yyyy");
			cy.get('[data-testid="save-settings"]').click();

			// Date format should be reflected throughout the app
			cy.visit("/clients");
			cy.get('[data-testid="created-date"]').should(
				"match",
				/\d{2}\/\d{2}\/\d{4}/,
			);
		});
	});

	describe("Webhooks and Integrations", () => {
		it("should configure webhooks per company", () => {
			cy.visit("/settings/webhooks");

			cy.get('[data-testid="add-webhook-button"]').click();
			cy.get('[data-testid="webhook-url"]').type(
				"https://company1.example.com/webhook",
			);
			cy.get('[data-testid="webhook-events"]').check([
				"invoice.created",
				"client.created",
			]);
			cy.get('[data-testid="save-webhook"]').click();

			cy.get('[data-testid="webhook-list"]').should(
				"contain",
				"https://company1.example.com/webhook",
			);
		});

		it("should not show webhooks from other companies", () => {
			// Setup webhook in first company
			cy.visit("/settings/webhooks");
			cy.get('[data-testid="add-webhook-button"]').click();
			cy.get('[data-testid="webhook-url"]').type(
				"https://company1.example.com/webhook",
			);
			cy.get('[data-testid="save-webhook"]').click();

			// Switch to second company
			cy.get('[data-testid="user-menu"]').click();
			cy.get('[data-testid="logout-button"]').click();

			cy.visit("/auth/sign-in");
			cy.get('[data-testid="email-input"]').type("company2@example.com");
			cy.get('[data-testid="password-input"]').type("Password123!");
			cy.get('[data-testid="sign-in-button"]').click();

			cy.visit("/settings/webhooks");
			cy.get('[data-testid="webhook-list"]').should(
				"not.contain",
				"https://company1.example.com/webhook",
			);
		});
	});

	describe("Dashboard Navigation", () => {
		it("should show company-specific data", () => {
			cy.visit("/dashboard");

			// Dashboard should show only current company's data
			cy.get('[data-testid="total-invoices"]').should("be.visible");
			cy.get('[data-testid="total-clients"]').should("be.visible");
			cy.get('[data-testid="company-name"]').should("contain", "Test Company");

			// Create some test data
			cy.visit("/clients");
			cy.get('[data-testid="add-client-button"]').click();
			cy.get('[data-testid="client-name"]').type("Dashboard Test Client");
			cy.get('[data-testid="client-email"]').type("dashboard@test.com");
			cy.get('[data-testid="save-client"]').click();

			cy.visit("/dashboard");
			cy.get('[data-testid="total-clients"]').should("contain", "1");
		});

		it("should handle responsive design for different screen sizes", () => {
			cy.visit("/dashboard");

			// Test mobile view
			cy.viewport("iphone-x");
			cy.get('[data-testid="mobile-menu-button"]').should("be.visible");
			cy.get('[data-testid="sidebar"]').should("not.be.visible");

			cy.get('[data-testid="mobile-menu-button"]').click();
			cy.get('[data-testid="mobile-menu"]').should("be.visible");

			// Test desktop view
			cy.viewport("macbook-15");
			cy.get('[data-testid="sidebar"]').should("be.visible");
		});
	});
});
