beforeEach(() => {
    cy.login();
});

describe('Dashboard E2E', () => {
    describe('Dashboard Loading', () => {
        it('loads dashboard page', () => {
            cy.visit('/dashboard');
            cy.wait(1000);
            cy.url().should('include', '/dashboard');
        });

        it('displays main content', () => {
            cy.visit('/dashboard');
            cy.wait(1000);
            cy.get('main, [role="main"], .main-content').should('exist');
        });

        it('displays statistics cards', () => {
            cy.visit('/dashboard');
            cy.wait(2000);
            cy.get('[class*="Card"], [class*="card"]').should('have.length.at.least', 1);
        });
    });

    describe('Dashboard Statistics', () => {
        it('shows revenue data', () => {
            cy.visit('/dashboard');
            cy.wait(2000);
            cy.contains(/revenue|chiffre|€|\$/i);
        });

        it('shows quotes section', () => {
            cy.visit('/dashboard');
            cy.wait(2000);
            cy.contains(/quotes|devis/i);
        });

        it('shows invoices section', () => {
            cy.visit('/dashboard');
            cy.wait(2000);
            cy.contains(/invoices|factures/i);
        });
    });
});

describe('Navigation E2E', () => {
    describe('Sidebar Navigation', () => {
        it('navigates to dashboard', () => {
            cy.visit('/clients');
            cy.wait(1000);

            cy.get('[data-cy="sidebar-dashboard-link"]').click({ force: true });
            cy.url().should('include', '/dashboard');
        });

        it('navigates to clients', () => {
            cy.visit('/dashboard');
            cy.wait(1000);

            cy.get('[data-cy="sidebar-clients-link"]').click({ force: true });
            cy.url().should('include', '/clients');
        });

        it('navigates to quotes', () => {
            cy.visit('/dashboard');
            cy.wait(1000);

            cy.get('[data-cy="sidebar-quotes-link"]').click({ force: true });
            cy.url().should('include', '/quotes');
        });

        it('navigates to invoices', () => {
            cy.visit('/dashboard');
            cy.wait(1000);

            cy.get('[data-cy="sidebar-invoices-link"]').click({ force: true });
            cy.url().should('include', '/invoices');
        });

        it('navigates to receipts', () => {
            cy.visit('/dashboard');
            cy.wait(1000);

            cy.get('[data-cy="sidebar-receipts-link"]').click({ force: true });
            cy.url().should('include', '/receipts');
        });

        it('navigates to settings', () => {
            cy.visit('/dashboard');
            cy.wait(1000);

            cy.get('[data-cy="sidebar-settings-link"]').click({ force: true });
            cy.url().should('include', '/settings');
        });
    });

    describe('Page Direct Access', () => {
        it('accesses dashboard directly', () => {
            cy.visit('/dashboard');
            cy.url().should('include', '/dashboard');
        });

        it('accesses clients directly', () => {
            cy.visit('/clients');
            cy.url().should('include', '/clients');
        });

        it('accesses quotes directly', () => {
            cy.visit('/quotes');
            cy.url().should('include', '/quotes');
        });

        it('accesses invoices directly', () => {
            cy.visit('/invoices');
            cy.url().should('include', '/invoices');
        });

        it('accesses receipts directly', () => {
            cy.visit('/receipts');
            cy.url().should('include', '/receipts');
        });

        it('accesses settings directly', () => {
            cy.visit('/settings');
            cy.url().should('include', '/settings');
        });
    });

    describe('Breadcrumb and Back Navigation', () => {
        it('uses browser back button', () => {
            cy.visit('/dashboard');
            cy.wait(500);

            cy.get('[data-cy="sidebar-clients-link"]').click({ force: true });
            cy.wait(500);
            cy.url().should('include', '/clients');

            cy.go('back');
            cy.url().should('include', '/dashboard');
        });
    });
});
