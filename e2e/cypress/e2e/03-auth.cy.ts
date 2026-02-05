describe('Authentication E2E', () => {
    describe('Login Validation', () => {
        it('shows error with empty email', () => {
            cy.visit('/auth/sign-in');
            cy.get('[data-cy="auth-password-input"]', { timeout: 5000 }).type('SomePassword123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.contains(/invalid|error|email/i, { timeout: 10000 });
        });

        it('shows error with invalid email format', () => {
            cy.visit('/auth/sign-in');
            cy.get('[data-cy="auth-email-input"]', { timeout: 5000 }).type('not-an-email');
            cy.get('[data-cy="auth-password-input"]').type('SomePassword123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.get('[data-cy="auth-email-input"]:invalid').should('exist');
        });

        it('shows error with wrong credentials', () => {
            cy.visit('/auth/sign-in');
            cy.get('[data-cy="auth-email-input"]', { timeout: 5000 }).type('wrong@example.com');
            cy.get('[data-cy="auth-password-input"]').type('WrongPassword123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.contains(/invalid|error|incorrect/i, { timeout: 10000 });
        });

        it('shows error with correct email but wrong password', () => {
            cy.visit('/auth/sign-in');
            cy.get('[data-cy="auth-email-input"]', { timeout: 5000 }).type('john.doe@acme.org');
            cy.get('[data-cy="auth-password-input"]').type('WrongPassword123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.contains(/invalid|error|incorrect/i, { timeout: 10000 });
        });

        it('has a link to sign up page', () => {
            cy.visit('/auth/sign-in');
            cy.get('[data-cy="auth-signup-link"]', { timeout: 5000 }).should('be.visible');
            cy.get('[data-cy="auth-signup-link"]').click();
            cy.url().should('include', '/auth/sign-up');
        });
    });

    describe('Signup Validation (Second user - invitation required)', () => {
        it('requires invitation code for second user', () => {
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).should('exist');
        });

        it('shows error when signup without invitation code', () => {
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).should('be.visible');
            cy.get('[data-cy="auth-firstname-input"]').type('Jane');
            cy.get('[data-cy="auth-lastname-input"]').type('Smith');
            cy.get('[data-cy="auth-email-input"]').type('jane.smith@acme.org');
            cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.contains(/invitation code is required/i, { timeout: 5000 });
        });

        it('shows error with invalid invitation code', () => {
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type('INVALID-CODE-123');
            cy.get('[data-cy="auth-firstname-input"]').type('Jane');
            cy.get('[data-cy="auth-lastname-input"]').type('Smith');
            cy.get('[data-cy="auth-email-input"]').type('jane.smith@acme.org');
            cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.contains(/invalid|not found|error/i, { timeout: 10000 });
        });

        it('has a link to sign in page', () => {
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-signin-link"]', { timeout: 5000 }).should('be.visible');
            cy.get('[data-cy="auth-signin-link"]').click();
            cy.url().should('include', '/auth/sign-in');
        });
    });

    describe('Invitation Code Management', () => {
        it('creates an invitation code and copies it', () => {
            cy.login();
            cy.visit('/settings/invitations');
            cy.wait(1000);
            cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
            cy.wait(1000);
            cy.get('table tbody tr', { timeout: 10000 }).should('have.length.at.least', 1);
            cy.get('table tbody tr').first().find('td').first().invoke('text').as('invitationCode');
        });

        it('allows signup with valid invitation code from UI', () => {
            cy.login();
            cy.visit('/settings/invitations');
            cy.wait(1000);
            cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
            cy.wait(1000);
            cy.get('table tbody tr', { timeout: 10000 }).first().find('td').first().invoke('text').then((code) => {
                const invitationCode = code.trim();
                cy.clearCookies();
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).should('be.visible').type(invitationCode);
                cy.get('[data-cy="auth-firstname-input"]').type('Jane');
                cy.get('[data-cy="auth-lastname-input"]').type('Smith');
                cy.get('[data-cy="auth-email-input"]').type('jane.smith@acme.org');
                cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.url({ timeout: 20000 }).should('include', '/auth/sign-up');
            });
        });

        it('blocks signup with already used invitation code', () => {
            cy.login();
            cy.visit('/settings/invitations');
            cy.wait(1000);
            cy.get('table tbody tr', { timeout: 10000 }).then(($rows) => {
                const usedRow = $rows.toArray().find(row => {
                    const text = Cypress.$(row).text().toLowerCase();
                    return text.includes('used') || text.includes('utilisé');
                });
                if (usedRow) {
                    const usedCode = Cypress.$(usedRow).find('td').first().text().trim();
                    cy.clearCookies();
                    cy.visit('/auth/sign-up');
                    cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).should('be.visible').type(usedCode);
                    cy.get('[data-cy="auth-firstname-input"]').type('Bob');
                    cy.get('[data-cy="auth-lastname-input"]').type('Wilson');
                    cy.get('[data-cy="auth-email-input"]').type('bob.wilson@acme.org');
                    cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                    cy.get('[data-cy="auth-submit-btn"]').click();
                    cy.contains(/already.*used|invalid|error/i, { timeout: 10000 });
                }
            });
        });
    });

    describe('Edge Cases', () => {
        it('handles special characters in name fields', () => {
            cy.login();
            cy.visit('/settings/invitations');
            cy.wait(1000);
            cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
            cy.wait(1000);
            cy.get('table tbody tr', { timeout: 10000 }).first().find('td').first().invoke('text').then((code) => {
                const invitationCode = code.trim();
                cy.clearCookies();
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type(invitationCode);
                cy.get('[data-cy="auth-firstname-input"]').type('Jean-Pierre');
                cy.get('[data-cy="auth-lastname-input"]').type("O'Connor");
                cy.get('[data-cy="auth-email-input"]').type('jean.pierre@acme.org');
                cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.url({ timeout: 20000 }).should('include', '/auth/sign-up');
            });
        });

        it('handles unicode characters in name fields', () => {
            cy.login();
            cy.visit('/settings/invitations');
            cy.wait(1000);
            cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
            cy.wait(1000);
            cy.get('table tbody tr', { timeout: 10000 }).first().find('td').first().invoke('text').then((code) => {
                const invitationCode = code.trim();
                cy.clearCookies();
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type(invitationCode);
                cy.get('[data-cy="auth-firstname-input"]').type('François');
                cy.get('[data-cy="auth-lastname-input"]').type('Müller');
                cy.get('[data-cy="auth-email-input"]').type('francois.muller@acme.org');
                cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.url({ timeout: 20000 }).should('include', '/auth/sign-up');
            });
        });

        it('blocks signup with already used email', () => {
            cy.login();
            cy.visit('/settings/invitations');
            cy.wait(1000);
            cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
            cy.wait(1000);
            cy.get('table tbody tr', { timeout: 10000 }).first().find('td').first().invoke('text').then((code) => {
                const invitationCode = code.trim();
                cy.clearCookies();
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type(invitationCode);
                cy.get('[data-cy="auth-firstname-input"]').type('John');
                cy.get('[data-cy="auth-lastname-input"]').type('Doe');
                cy.get('[data-cy="auth-email-input"]').type('john.doe@acme.org');
                cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.contains(/already|exists|duplicate/i, { timeout: 10000 });
            });
        });
    });

    describe('Session Management', () => {
        it('can logout and login again', () => {
            cy.login();
            cy.visit('/dashboard');
            cy.url({ timeout: 10000 }).should('include', '/dashboard');
            cy.visit('/auth/sign-out');
            cy.url({ timeout: 10000 }).should('include', '/auth/sign-in');
            cy.getCookie('better-auth.session_token').should('not.exist');
            cy.visit('/auth/sign-in');
            cy.get('[data-cy="auth-email-input"]', { timeout: 5000 }).type('john.doe@acme.org');
            cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.url({ timeout: 20000 }).should('include', '/dashboard');
        });

        it('redirects to login when accessing protected route without session', () => {
            cy.clearCookies();
            cy.visit('/dashboard');
            cy.url({ timeout: 10000 }).should('include', '/auth/sign-in');
        });
    });
});
