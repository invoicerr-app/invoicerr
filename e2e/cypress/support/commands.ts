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
        cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('john.doe@acme.org');
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

/**
 * Login with specific credentials
 * Used for multi-tenant tests where multiple users need to be tested
 */
Cypress.Commands.add('loginAs', (email: string, password: string) => {
    cy.session(`user-session-${email}`, () => {
        cy.visit('/auth/sign-in');
        cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type(email);
        cy.get('[data-cy="auth-password-input"]').type(password);
        cy.get('[data-cy="auth-submit-btn"]').click();
        cy.url({ timeout: 20000 }).should('include', '/dashboard');
        cy.getCookie('better-auth.session_token').should('exist');
    }, {
        validate: () => {
            cy.getCookie('better-auth.session_token').should('exist');
        },
    });
});

/**
 * Switch to a different company (for multi-tenant)
 * Uses the company-switcher dropdown and clicks on a company by name
 */
Cypress.Commands.add('switchCompany', (companyName: string) => {
    cy.get('[data-cy="company-switcher"]', { timeout: 10000 }).click();
    cy.contains('[data-cy^="company-option-"]', companyName).click();
    cy.wait(1000);
});

/**
 * Create an invitation code and return it
 */
Cypress.Commands.add('createInvitation', () => {
    cy.visit('/settings/invitations');
    cy.wait(1000);
    cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
    cy.wait(1000);
    return cy.get('table tbody tr', { timeout: 10000 })
        .first()
        .find('td')
        .first()
        .invoke('text')
        .then((code) => code.trim());
});


Cypress.Commands.add('getLastEmail', () => {
    return cy
        .request('http://localhost:8025/api/v1/messages')
        .then(res => {
            const messages = res.body.messages;
            expect(messages).to.have.length.greaterThan(0);
            const id = messages[0].ID;
            return cy.request(`http://localhost:8025/api/v1/message/${id}`);
        })
        .then(res => res.body);
});

Cypress.Commands.add('clearEmails', () => {
    return cy.request('DELETE', 'http://localhost:8025/api/v1/messages');
});

Cypress.on('window:before:load', (window) => {
    Object.defineProperty(window.navigator, 'language', { value: 'en-US' })
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US'] })
})