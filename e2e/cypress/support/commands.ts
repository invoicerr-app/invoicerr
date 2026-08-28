// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --

import { exec } from "child_process";

// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })
Cypress.Commands.add('resetDatabase', () => {
    new Promise((resolve, reject) => {
        exec('node ../backend/prisma/reset-db.test.ts', (err: any, stdout: any, stderr: any) => {
            if (err) {
                console.error(stderr);
                return reject(err);
            }
            console.log(stdout);
        });
    });
});

Cypress.Commands.add('login', () => {
    cy.session('user-session', () => {
        cy.visit('/auth/sign-in');
        cy.get('[data-cy="auth-email-input"]').type('john.doe@acme.org');
        cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
        cy.get('[data-cy="auth-submit-btn"]').click();
        cy.url({ timeout: 20000 }).should('include', '/dashboard');
        cy.getCookie('better-auth.session_token').should('exist');
    }, {
        validate: () => {
            cy.getCookie('better-auth.session_token').should('exist');
        },
    });
});


Cypress.Commands.add('getLastEmail', () => {
    // Backend sends mail asynchronously — under CI load the OTP email can lag
    // behind the request that triggered it. Poll mailpit instead of asserting
    // on a single-shot request, so we don't hard-fail on a mail that is simply
    // still in flight. ~20 attempts * 500ms wait ≈ 10s retry budget.
    function pollForMessage(attemptsLeft: number): Cypress.Chainable<any> {
        return cy
            .request({ url: 'http://localhost:8025/api/v1/messages', failOnStatusCode: false })
            .then((res) => {
                const messages = res.body?.messages || [];
                if (messages.length === 0 && attemptsLeft > 0) {
                    cy.wait(500);
                    return pollForMessage(attemptsLeft - 1);
                }
                // Retry budget exhausted (or messages present) — assert here so a
                // genuine failure (no mail ever arrived) still hard-fails clearly.
                expect(messages, 'mailpit message present after polling').to.have.length.greaterThan(0);
                const id = messages[0].ID;
                return cy.request(`http://localhost:8025/api/v1/message/${id}`);
            });
    }

    return pollForMessage(20).then(res => res.body);
});

Cypress.Commands.add('clearEmails', () => {
    return cy.request('DELETE', 'http://localhost:8025/api/v1/messages');
});

Cypress.Commands.add('selectCountry', (dataCy: string, countryName: string) => {
    cy.get(`[data-cy="${dataCy}"] button`).first().click({ force: true });
    cy.wait(500);
    cy.get(`[data-cy="${dataCy}-options"]`, { timeout: 3000 }).should('exist');
    cy.get(`[data-cy="${dataCy}"] input`).clear({ force: true }).type(countryName, { force: true });
    cy.wait(300);
    cy.get(`[data-cy="${dataCy}-option-${countryName.toLowerCase().replace(/\s+/g, '-')}"]`, { timeout: 3000 }).should('exist').click({ force: true });
});

Cypress.Commands.add('ensureClient', () => {
    const apiUrl = Cypress.env('apiUrl');
    cy.request({ url: `${apiUrl}/api/clients`, failOnStatusCode: false }).then(({ status, body }: any) => {
        if (status !== 200) return; // auth failed, skip
        const clients = Array.isArray(body) ? body : body?.clients ?? [];
        if (clients.length === 0) {
            cy.request({
                method: 'POST',
                url: `${apiUrl}/api/clients`,
                body: {
                    name: 'Test Client',
                    contactEmail: 'test.client@example.com',
                    currency: 'EUR',
                    country: 'FR',
                    address: '123 Test St',
                    city: 'Paris',
                    postalCode: '75001',
                    isActive: true,
                    type: 'COMPANY',
                },
                failOnStatusCode: false,
            });
        }
    });
});

Cypress.on('window:before:load', (window) => {
    Object.defineProperty(window.navigator, 'language', { value: 'en-US' })
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US'] })
})
/**
 * Reset to a known world, before every spec.
 *
 * The suite reset its database exactly ONCE — `cy.task('resetDatabase')` in `01-register` — and the
 * sixteen specs after it ran on whatever the previous ones had left. Three full runs in different
 * orders produced 11, 9 and 13 failures, overlapping only on the two that were real: `05-clients`
 * clicking an element that existed twice, `15-multi-company` finding three companies where it
 * expected two, `07-invoices` green in one order and red in another. Those are not flaky tests;
 * they are tests reading a world nobody defined.
 *
 * Resetting alone is not enough: `cy.login()` signs in as john.doe@acme.org, a user that `01`
 * registers, and every later spec assumes a company profile that `02` fills in. So the reset is
 * paired with a seed that rebuilds exactly that world through the API — same account, same company —
 * and with clearing Cypress' session cache, which otherwise replays a cookie for a user the
 * truncate just deleted.
 *
 * Seeding through HTTP rather than SQL on purpose: the password is hashed by better-auth, and a
 * fixture that writes its own hash is a fixture that breaks the day the auth library changes.
 */
Cypress.Commands.add('resetAndSeed', () => {
    const apiUrl = Cypress.env('apiUrl');
    cy.task('resetDatabase');
    // The truncate deletes the user; a cached session would then present a token for nobody.
    cy.then(() => Cypress.session.clearAllSavedSessions());

    cy.request({
        method: 'POST',
        url: `${apiUrl}/api/auth/sign-up/email`,
        body: {
            name: 'John Doe',
            firstname: 'John',
            lastname: 'Doe',
            email: 'john.doe@acme.org',
            password: 'Super_Secret_Password123!',
        },
        failOnStatusCode: false,
    }).then((signup) => {
        expect(signup.status, 'sign-up must succeed — every later spec logs in as this user').to.be.oneOf([
            200, 201,
        ]);
    });

    // Sign in so the company call carries a session cookie.
    cy.request({
        method: 'POST',
        url: `${apiUrl}/api/auth/sign-in/email`,
        body: { email: 'john.doe@acme.org', password: 'Super_Secret_Password123!' },
    })
        .its('status')
        .should('be.oneOf', [200, 201]);

    // The company profile `02-company` fills in by hand, and every later spec assumes: a French
    // company with a SIRET, because FR compliance refuses to issue without one.
    cy.request({
        method: 'POST',
        url: `${apiUrl}/api/companies`,
        body: {
            name: 'Acme Corp',
            description: 'A fictional company',
            phone: '+33123456789',
            email: 'contact@acme.org',
            address: '123 Main St',
            city: 'Paris',
            postalCode: '75001',
            country: 'FR',
            currency: 'EUR',
            legalId: '73282932000074',
            VAT: 'FR44732829320',
        },
        failOnStatusCode: false,
    }).then((res) => {
        expect(res.status, 'the baseline company must exist').to.be.oneOf([200, 201]);
    });
});
