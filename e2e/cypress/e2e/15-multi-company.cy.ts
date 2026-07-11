beforeEach(() => {
    cy.login();
});

// Runs last (numeric ordering after 01-14): by this point john.doe@acme.org
// already owns "Acme Corp" (see 01-register.cy.ts / 02-company.cy.ts). These
// tests add a second company via the switcher and always switch back to
// Acme Corp at the end so later re-runs of the earlier specs aren't affected.
describe('Multi-Company Switcher E2E', () => {
    it('shows the current company in the sidebar switcher', () => {
        cy.visit('/dashboard');
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should('contain.text', 'Acme Corp');
    });

    it('creates a second company from the switcher and switches to it', () => {
        cy.visit('/dashboard');
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).click();
        cy.get('[data-cy="sidebar-create-company-item"]').click();

        cy.get('[data-cy="onboarding-dialog"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-cy="onboarding-company-name-input"]').clear().type('Globex Corporation');
        cy.selectCountry('onboarding-company-country-input', 'France');
        // France requires a LEGAL_ID (SIRET) identifier — the dialog refuses to
        // submit without it (same required-fields check as the first company).
        cy.get('[data-cy="onboarding-legalid-input"]', { timeout: 10000 })
            .clear({ force: true })
            .type('73282932000074', { force: true });
        cy.get('[data-cy="onboarding-submit-btn"]').click();
        cy.get('[data-cy="onboarding-dialog"]', { timeout: 20000 }).should('not.exist');
        cy.wait(3000);

        // Creating a company switches the active session to it immediately
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should('contain.text', 'Globex Corporation');
    });

    it('isolates data between companies: Acme\'s clients are not visible from Globex', () => {
        cy.visit('/clients');
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should('contain.text', 'Globex Corporation');
        // Globex is a brand-new company with zero clients — the list must show
        // the empty state, not any of Acme's clients (created by 05-clients.cy.ts).
        // Checking for the literal substring "acme" would also match the logged-in
        // user's own email (john.doe@acme.org), which is unrelated to company data.
        cy.contains(/no clients yet/i, { timeout: 10000 }).should('be.visible');

        // Switch back to Acme Corp and confirm its clients are visible again
        cy.get('[data-cy="sidebar-company-button"]').click();
        cy.get('[data-cy="sidebar-company-switch-item"]').contains('Acme Corp').click();
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should('contain.text', 'Acme Corp');
        cy.visit('/clients');
        cy.contains(/no clients yet/i).should('not.exist');
    });

    it('lists both companies with roles in the switcher', () => {
        cy.visit('/dashboard');
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).click();
        cy.get('[data-cy="sidebar-company-switch-item"]').should('have.length', 2);
        cy.get('[data-cy="sidebar-company-switch-item"]').contains('Acme Corp').should('exist');
        cy.get('[data-cy="sidebar-company-switch-item"]').contains('Globex Corporation').should('exist');

        // Leave Acme Corp active for the rest of the suite
        cy.get('body').type('{esc}');
    });
});
