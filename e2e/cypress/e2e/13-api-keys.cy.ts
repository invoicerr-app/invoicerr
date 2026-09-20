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

        // The plaintext key is shown once, in the "API key created" section, inserted ABOVE the
        // "Active keys" list this button sits below. At the CI viewport (1000x660, Firefox) the
        // submit button stays exactly where it was rather than the page scrolling up to reveal what
        // just appeared above it, so both this notice and the key itself below can render outside the
        // current scroll position — `scrollIntoView()` first is what a real user, noticing nothing
        // changed, would do too.
        cy.contains(/this key will be shown only once/i, { timeout: 10000 }).scrollIntoView().should('be.visible');
        cy.contains('.font-mono', /^sk_/).scrollIntoView().should('be.visible');

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

        cy.get('body').then(($bodyBefore) => {
            const countBefore = $bodyBefore.find('[data-cy^="api-key-row-"]').length;

            // `api-keys.settings.tsx#handleCreate` refuses to even ATTEMPT the request for an empty
            // name (`if (!values.name?.trim()) return`, BEFORE `createApiKey` is ever called) — a
            // regression that let it through would fire a real `POST /api/api-keys`, which this
            // intercept would catch. Proving that directly replaces the old `cy.wait(1000)` + a
            // one-shot jQuery read: a slow backend (CI load, a cold Postgres start) could answer
            // AFTER that fixed wait and still slip the row/notice checks below past a snapshot taken
            // too early — `@createApiKey.all` and the two retrying `.should()`s below have no such
            // race, whatever the backend's own timing turns out to be.
            cy.intercept('POST', '**/api/api-keys').as('createApiKey');
            cy.get('input[name="name"]').clear();
            cy.contains('button', /create api key/i).click();
            cy.get('@createApiKey.all', { timeout: 3000 }).should('have.length', 0);

            // No "key created" notice and no extra row — `.should('have.length', countBefore)`
            // resolves immediately when `countBefore` is 0 (the explicit assertion overrides
            // `cy.get`'s own default "must exist" retry, unlike a bare `cy.get(selector)`).
            cy.contains(/this key will be shown only once/i).should('not.exist');
            cy.get('[data-cy^="api-key-row-"]').should('have.length', countBefore);
        });
    });
});
