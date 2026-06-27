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