export {}; // makes this spec a module, not a global script -- see tsconfig.json

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

        // The plaintext key is shown once, in the "API key created" section
        cy.contains(/this key will be shown only once/i, { timeout: 10000 }).should('be.visible');
        cy.contains('.font-mono', /^sk_/).should('be.visible');

        // The new key appears in the list, as its own row (settings-section.tsx's `SettingsListRow`
        // grammar — a row is never a `[data-slot="card"]` any more, unlike the settings screen's OWN
        // section frames, so this spec locates it by the `api-key-row-` prefix, never by that slot).
        cy.contains('[data-cy^="api-key-row-"]', keyName, { timeout: 10000 })
            .should('exist')
            .invoke('attr', 'data-cy')
            .then((rowDataCy) => {
                const id = String(rowDataCy).replace('api-key-row-', '');

                // Revoke lives in the row's "..." menu (a revocation, same destructive-menu placement
                // as every other settings list in this app).
                cy.get(`[data-cy="api-key-menu-${id}"]`).click();
                cy.get(`[data-cy="api-key-revoke-${id}"]`).click();
            });
        cy.wait(1500);

        // The key is gone from the list
        cy.contains('[data-cy^="api-key-row-"]', keyName).should('not.exist');
    });

    it('does not create a key with an empty name', () => {
        cy.visit('/settings/apiKeys');
        cy.wait(1000);

        // `cy.get` on a prefix that may legitimately match zero rows (e.g. right after the previous
        // test revoked its only key) would hang until timeout, so the count is read via plain jQuery
        // inside `.then()` rather than asserted through Cypress's own retry-until-exists `cy.get`.
        cy.get('body').then(($bodyBefore) => {
            const countBefore = $bodyBefore.find('[data-cy^="api-key-row-"]').length;

            cy.get('input[name="name"]').clear();
            cy.contains('button', /create api key/i).click();
            cy.wait(1000);

            // No "key created" notice and no extra row
            cy.contains(/this key will be shown only once/i).should('not.exist');
            cy.get('body').then(($bodyAfter) => {
                expect($bodyAfter.find('[data-cy^="api-key-row-"]').length).to.eq(countBefore);
            });
        });
    });
});
