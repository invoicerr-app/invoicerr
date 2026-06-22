beforeEach(() => {
    cy.login();
});

describe('API Keys Settings E2E', () => {
    it('loads the API keys page', () => {
        cy.visit('/settings/apiKeys');
        cy.wait(1000);
        cy.contains(/api keys/i, { timeout: 10000 });
    });

    it('displays the create form', () => {
        cy.visit('/settings/apiKeys');
        cy.wait(1000);

        cy.get('input[name="name"]').should('exist');
        cy.contains('button', /create api key/i).should('exist');
    });

    it('creates an API key, shows the plaintext key once, then revokes it', () => {
        const keyName = `Cypress Key ${Date.now()}`;

        cy.visit('/settings/apiKeys');
        cy.wait(1000);

        // Create
        cy.get('input[name="name"]').clear().type(keyName);
        cy.contains('button', /create api key/i).click();
        cy.wait(1500);

        // The plaintext key is shown once, in the "API key created" card
        cy.contains(/this key will be shown only once/i, { timeout: 10000 }).should('be.visible');
        cy.contains('.font-mono', /^sk_/).should('be.visible');

        // The new key appears in the list
        cy.contains('[data-slot="card"]', keyName, { timeout: 10000 }).should('exist');

        // Revoke it
        cy.contains('[data-slot="card"]', keyName)
            .within(() => {
                cy.contains('button', /revoke/i).click();
            });
        cy.wait(1500);

        // The key is gone from the list
        cy.contains('[data-slot="card"]', keyName).should('not.exist');
    });

    it('does not create a key with an empty name', () => {
        cy.visit('/settings/apiKeys');
        cy.wait(1000);

        cy.get('[data-slot="card"]').then($cardsBefore => {
            const countBefore = $cardsBefore.length;

            cy.get('input[name="name"]').clear();
            cy.contains('button', /create api key/i).click();
            cy.wait(1000);

            // No "key created" notice and no extra card
            cy.contains(/this key will be shown only once/i).should('not.exist');
            cy.get('[data-slot="card"]').should('have.length', countBefore);
        });
    });
});
