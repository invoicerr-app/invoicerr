// filepath: /users/but/info/chevrier/Projets/invoicerr/e2e/cypress/e2e/1-register.cy.ts
// This spec registers the FIRST user, so it needs a database with no user in it — the opposite of
// the baseline every other spec now gets from the global `before` in support/e2e.ts. Opting out has
// to happen at load time, before that hook runs.
Cypress.env('skipSeed', true);

describe('First User Registration E2E', () => {
    before(() => {
        cy.task('resetDatabase');
    });

    describe('First User Signup (No invitation required)', () => {
        it('allows the first user to sign up without invitation code', () => {
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-firstname-input"]', { timeout: 10000 }).should('be.visible');
            cy.get('[data-cy="auth-firstname-input"]').type('John');
            cy.get('[data-cy="auth-lastname-input"]').type('Doe');
            cy.get('[data-cy="auth-email-input"]').type('john.doe@acme.org');
            cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.url({ timeout: 20000 }).should('include', '/auth/sign-in');
        });

        it('redirects to dashboard after login', () => {
            cy.visit('/auth/sign-in');
            cy.get('[data-cy="auth-email-input"]', { timeout: 5000 }).should('be.visible');
            cy.get('[data-cy="auth-email-input"]').type('john.doe@acme.org');
            cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.url({ timeout: 20000 }).should('include', '/dashboard');
            cy.getCookie('better-auth.session_token').should('exist');
        });
    });
});
