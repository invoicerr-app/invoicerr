import { tolerateUncaughtException } from '../support/e2e';

beforeEach(() => {
    cy.login();
});

describe('Settings E2E', () => {
    // The personal-profile block that used to live here tested `/settings/account`, which has not
    // existed since the account area moved OUTSIDE company Settings (option B, product decision —
    // see `73-account-page.cy.ts`'s own header): that route falls back to the Company tab
    // (`isTabId(tab) ? tab : "company"`, `frontend/src/pages/(app)/settings/-[tab].tsx`), so every
    // assertion below was silently matching the COMPANY form instead —
    // `input[name="firstname"], input[name="name"]` found the company name field, and
    // `cy.contains(/account|compte/i)` matched the IBAN field's own "receiving bank account" help
    // text. The `if` in "updates profile information" was therefore always false and the test body,
    // save-click included, never ran at all. `73-account-page.cy.ts` covers the REAL `/account` page
    // end to end (real `data-cy` selectors, `/api/auth/get-session` read back after save) — this file
    // does not need a second, inferior copy of that coverage.

    describe('Company Settings', () => {
        it('loads company settings page', () => {
            cy.visit('/settings/company');
            cy.wait(1000);
            cy.contains(/company|entreprise|société/i, { timeout: 10000 });
        });

        it('displays company form', () => {
            cy.visit('/settings/company');
            cy.wait(1000);

            cy.get('[data-cy="company-name-input"], input[name="name"]').should('exist');
        });
    });

    describe('Invitations Settings', () => {
        it('loads invitations page', () => {
            cy.visit('/settings/invitations');
            cy.wait(1000);
            cy.contains(/invitation/i, { timeout: 10000 });
        });

        it('creates a new invitation code', () => {
            // `invitations.settings.tsx#createInvitation` awaits the POST, THEN calls
            // `navigator.clipboard.writeText(...)` with no `try`/`catch` around it — by the time that
            // promise resolves, the click's own "user activation" window has already closed, so the
            // browser throws "Clipboard write was blocked due to lack of user activation" as an
            // UNHANDLED rejection. Reproducible for a real user too on any sufficiently slow network,
            // not a Cypress-only artifact — a genuine gap in the screen this e2e-only pass does not
            // fix (out of this file's own perimeter): tolerated HERE, for this one test, rather than
            // added to the GLOBAL allowlist in `support/e2e.ts`, which exists to keep catching this
            // exact class of regression everywhere else.
            tolerateUncaughtException(/Clipboard write was blocked/);

            cy.visit('/settings/invitations');
            cy.get('input#expiresInDays', { timeout: 10000 }).type('30');

            cy.intercept('POST', '**/api/invitations').as('createInvitation');
            cy.contains('button', /create|créer|generate|générer/i).click();
            cy.wait('@createInvitation').its('response.statusCode').should('be.oneOf', [200, 201]);
            cy.get('[data-cy^="invitation-row-"]', { timeout: 10000 }).should('have.length.at.least', 1);
        });

        it('displays invitation codes list', () => {
            // The previous test's own creation left at least one row behind — `invitations.settings.tsx`
            // renders the list as `SettingsListRow`/`invitation-row-<id>` (no `<table>` any more), so a
            // guard on `<table>` was permanently false and the assertion inside it never ran.
            cy.visit('/settings/invitations');
            cy.get('[data-cy^="invitation-row-"]', { timeout: 10000 }).should('have.length.at.least', 1);
        });
    });

    describe('Danger Zone Settings', () => {
        it('loads danger zone page', () => {
            cy.visit('/settings/danger-zone');
            cy.wait(1000);
            cy.contains(/danger/i, { timeout: 10000 });
        });

        it('shows reset buttons', () => {
            cy.visit('/settings/danger-zone');
            cy.wait(1000);

            cy.get('button').should('have.length.at.least', 1);
        });
    });

    describe('Settings Sidebar Navigation', () => {
        /**
         * Picks one entry from the mobile settings picker (`settings-nav-select`) — deliberately NOT
         * `cy.openSelect`: that command's own bounded retry RE-CLICKS THE TRIGGER when the option
         * doesn't appear in time, which is wrong for a native Radix `Select` specifically (unlike the
         * `SearchSelect`/`DatePicker` popovers it was built for): while open, Radix locks `body`'s own
         * `pointer-events` and only re-enables the TRIGGER once closed, so a retry-click while still
         * open times out on exactly the CSS guard this file hit in CI (`ensureElDoesNotHaveCSS`,
         * `pointer-events: none` inherited from `body`). This picker's OWN option list is also long
         * (20 tabs across six groups) — long enough that the first render can still be settling past
         * `openSelect`'s 800ms poll window, which is what triggered that retry in the first place. One
         * deliberate click, a generous wait for the options panel, then `scrollIntoView` on the target
         * option (it may render below the panel's own capped, scrollable height) is what an actual user
         * does here, and is not this specific race.
         */
        function pickSettingsNavOption(tabId: string) {
            cy.get('[data-cy="settings-nav-select"]').click();
            cy.get('[data-cy="settings-nav-select-options"]', { timeout: 10000 }).should('be.visible');
            cy.get(`[data-cy="settings-nav-option-${tabId}"]`, { timeout: 10000 }).scrollIntoView().click();
        }

        it('navigates between settings sections', () => {
            // A bare `cy.visit(x)` + `cy.url().should('include', x)` proves nothing: the URL was set
            // by the visit itself, not by any navigation control. Cypress's own default viewport
            // (1000x660) sits BELOW Tailwind's `lg` breakpoint (1024px), so the desktop rail
            // (`settings-nav-*`, `hidden lg:block`) is not on screen here — the control an actual user
            // has at this width is the mobile picker (`settings-nav-select`, `lg:hidden`), and that is
            // what this test drives. `/settings/account` is deliberately not exercised here: that route
            // has no distinct tab of its own any more (falls back to "company", see this file's own
            // header) — the real account area lives at `/account` (`73-account-page.cy.ts`).
            cy.visit('/settings/company');
            cy.get('[data-cy="settings-tab-company"]', { timeout: 10000 }).should('be.visible');

            pickSettingsNavOption('invitations');
            cy.url().should('include', '/settings/invitations');
            cy.get('[data-cy="settings-tab-invitations"]', { timeout: 10000 }).should('be.visible');

            pickSettingsNavOption('company');
            cy.url().should('include', '/settings/company');
            cy.get('[data-cy="settings-tab-company"]', { timeout: 10000 }).should('be.visible');
        });
    });
});
