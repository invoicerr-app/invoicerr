const apiUrl = Cypress.env('apiUrl') as string;

/**
 * Generates an invitation code through the real Settings UI (a genuine button click, not a
 * direct API call) and returns the FULL code from the network response.
 *
 * The invitations table intentionally shows only a truncated preview of the code
 * (`invitation.code.substring(0, 8) + '...'`, see invitations.settings.tsx) plus a
 * clipboard-copy button with no visible text — reading the code back from the table's `<td>`
 * text, as this file used to, silently produces that truncated (unusable) string instead of
 * the real one. Every code-consuming test below intercepts the creation response instead, so
 * it exercises an invitation code that can actually be redeemed.
 */
function createInvitationCodeViaUI(): Cypress.Chainable<string> {
    cy.intercept('POST', '**/api/invitations').as('createInvitationRequest');
    cy.visit('/settings/invitations');
    cy.wait(1000);
    cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
    return cy.wait('@createInvitationRequest').its('response.body.code');
}

/** Same as above, but expired on arrival — `expiresInDays: -1` backdates `expiresAt`. The
 * create-invitation UI's `min="1"` guards against an operator typing a negative number by
 * hand, but the backend itself only ever receives a plain integer, so this is a real,
 * reachable state (a code created with a short expiry that has since lapsed), not a
 * contrivance. Requires an authenticated owner session (`cy.login()`), like the UI button
 * would.
 */
function createExpiredInvitationCode(): Cypress.Chainable<string> {
    return cy
        .request({
            method: 'POST',
            url: `${apiUrl}/api/invitations`,
            body: { expiresInDays: -1 },
        })
        .its('body.code');
}

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

    // Sign-up is open to everyone by default (backend/src/lib/registration-policy.ts) — an
    // invitation code is never required to register; it only ever serves to join an existing
    // company. These tests run against a DB that already has john.doe@acme.org / Acme Corp
    // from the global seed, i.e. every account created below is genuinely a "second user".
    describe('Signup Validation (open by default)', () => {
        const NOCODE_EMAIL = 'nocode.jane@acme.org';
        const INVALID_CODE_EMAIL = 'invalidcode.jane@acme.org';
        const EXPIRED_CODE_EMAIL = 'expiredcode.jane@acme.org';

        it('shows an optional invitation code field, for everyone, not just a "second user"', () => {
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).should('be.visible');
        });

        it('creates an account with no invitation code and lands on sign-in', () => {
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-firstname-input"]', { timeout: 10000 }).type('Jane');
            cy.get('[data-cy="auth-lastname-input"]').type('Smith');
            cy.get('[data-cy="auth-email-input"]').type(NOCODE_EMAIL);
            cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
            // Deliberately leave auth-invitation-code-input empty.
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.url({ timeout: 20000 }).should('include', '/auth/sign-in');
        });

        it('a no-code account has no company and lands on the company-creation wizard', () => {
            cy.visit('/auth/sign-in');
            cy.get('[data-cy="auth-email-input"]', { timeout: 5000 }).type(NOCODE_EMAIL);
            cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.url({ timeout: 20000 }).should('include', '/dashboard');
            // No invitation code means no UserCompany row: sidebar.tsx auto-opens the
            // onboarding wizard (frontend/src/components/onboarding.tsx) the moment it
            // observes zero companies, instead of a normal dashboard.
            cy.get('[data-cy="onboarding-dialog"]', { timeout: 15000 }).should('be.visible');
            cy.get('[data-cy="onboarding-country-next-btn"]').should('be.visible');
        });

        it('rejects an unknown invitation code, explicitly — not a silent fallback to open signup', () => {
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type('INVALID-CODE-123');
            cy.get('[data-cy="auth-firstname-input"]').type('Jane');
            cy.get('[data-cy="auth-lastname-input"]').type('Smith');
            cy.get('[data-cy="auth-email-input"]').type(INVALID_CODE_EMAIL);
            cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.contains(/invalid|not found|error/i, { timeout: 10000 });
            // A rejected code must not have silently created the account anyway.
            cy.url().should('include', '/auth/sign-up');
        });

        it('rejects an expired invitation code, explicitly', () => {
            cy.login();
            createExpiredInvitationCode().then((code) => {
                cy.clearCookies();
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type(code as string);
                cy.get('[data-cy="auth-firstname-input"]').type('Jane');
                cy.get('[data-cy="auth-lastname-input"]').type('Smith');
                cy.get('[data-cy="auth-email-input"]').type(EXPIRED_CODE_EMAIL);
                cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.contains(/expired/i, { timeout: 10000 });
            });
        });

        it('has a link to sign in page', () => {
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-signin-link"]', { timeout: 5000 }).should('be.visible');
            cy.get('[data-cy="auth-signin-link"]').click();
            cy.url().should('include', '/auth/sign-in');
        });
    });

    describe('Invitation Code Management', () => {
        const VALID_CODE_EMAIL = 'validcode.jane@acme.org';
        let consumedCode: string;

        beforeEach(() => {
            cy.login();
        });

        it('creates an invitation code and lists it as active', () => {
            createInvitationCodeViaUI().should('match', /^[0-9A-F]{32}$/);
            cy.get('table tbody tr', { timeout: 10000 }).should('have.length.at.least', 1);
            cy.contains('table tbody tr', /active/i, { timeout: 10000 }).should('exist');
        });

        it('signing up with a valid code attaches the new user to the right company', () => {
            createInvitationCodeViaUI().then((code) => {
                consumedCode = code;
                cy.clearCookies();
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 })
                    .should('be.visible')
                    .type(code);
                cy.get('[data-cy="auth-firstname-input"]').type('Jane');
                cy.get('[data-cy="auth-lastname-input"]').type('Smith');
                cy.get('[data-cy="auth-email-input"]').type(VALID_CODE_EMAIL);
                cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.url({ timeout: 20000 }).should('include', '/auth/sign-in');

                // The fact this actually worked: log back in as the invited user and check
                // they landed IN Acme Corp (the inviter's company) with no onboarding prompt —
                // not merely that the sign-up form stopped complaining.
                cy.get('[data-cy="auth-email-input"]', { timeout: 5000 }).clear().type(VALID_CODE_EMAIL);
                cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.url({ timeout: 20000 }).should('include', '/dashboard');
                cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should(
                    'contain.text',
                    'Acme Corp',
                );
                cy.get('[data-cy="onboarding-dialog"]').should('not.exist');
            });
        });

        it('blocks signup with an already-used invitation code, explicitly', () => {
            expect(consumedCode, 'the previous test must have consumed a code first').to.be.a('string');
            cy.clearCookies();
            cy.visit('/auth/sign-up');
            cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type(consumedCode);
            cy.get('[data-cy="auth-firstname-input"]').type('Bob');
            cy.get('[data-cy="auth-lastname-input"]').type('Wilson');
            cy.get('[data-cy="auth-email-input"]').type('reusedcode.bob@acme.org');
            cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
            cy.get('[data-cy="auth-submit-btn"]').click();
            cy.contains(/already.*used/i, { timeout: 10000 });
        });
    });

    describe('Edge Cases', () => {
        beforeEach(() => {
            cy.login();
        });

        it('handles special characters in name fields', () => {
            createInvitationCodeViaUI().then((code) => {
                cy.clearCookies();
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type(code);
                cy.get('[data-cy="auth-firstname-input"]').type('Jean-Pierre');
                cy.get('[data-cy="auth-lastname-input"]').type("O'Connor");
                cy.get('[data-cy="auth-email-input"]').type('jean.pierre@acme.org');
                cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.url({ timeout: 20000 }).should('include', '/auth/sign-in');
            });
        });

        it('handles unicode characters in name fields', () => {
            createInvitationCodeViaUI().then((code) => {
                cy.clearCookies();
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type(code);
                cy.get('[data-cy="auth-firstname-input"]').type('François');
                cy.get('[data-cy="auth-lastname-input"]').type('Müller');
                cy.get('[data-cy="auth-email-input"]').type('francois.muller@acme.org');
                cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.url({ timeout: 20000 }).should('include', '/auth/sign-in');
            });
        });

        it('blocks signup with an already-used email, even with a fresh valid code', () => {
            createInvitationCodeViaUI().then((code) => {
                cy.clearCookies();
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type(code);
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
