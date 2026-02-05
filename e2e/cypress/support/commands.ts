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