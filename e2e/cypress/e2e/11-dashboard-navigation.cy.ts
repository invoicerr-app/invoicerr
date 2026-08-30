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
		// Le tableau de bord n'est plus une page écrite à la main : il agrège ce que CHAQUE type de
		// document veut y montrer. On n'exige donc plus un mot ("revenue", "quotes") qui appartenait
		// à l'ancien écran, mais le fait générique : au moins une contribution est rendue, et aucune
		// ne tombe sur le marqueur « type de widget non rendu ».
		it("affiche au moins une contribution, et aucune non rendue", () => {
			cy.visit("/dashboard");
			cy.get('[data-cy^="widget-"]', { timeout: 20000 }).should("exist");
			cy.get('[data-cy="widget-unsupported"]').should("not.exist");
		});

		it("shows invoices section", () => {
			cy.visit("/dashboard");
			cy.wait(2000);
			cy.contains(/invoices|factures/i);
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

		// La navigation vers un type de document N'EST PAS testée ici, et c'est délibéré : cette
		// spec ne fait que `cy.login()`, sans `resetAndSeed()`. Elle hérite donc de l'état laissé par
		// la spec précédente et n'a aucune société dont le pays soit garanti — or le groupe Documents
		// se remplit depuis la politique du PAYS. Le test vivait ici tant que la sidebar portait des
		// liens en dur ; il a suivi la donnée et vit maintenant dans 17-document-descriptor.cy.ts,
		// qui construit son monde avant de l'interroger.

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
