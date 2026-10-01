export {}; // makes this spec a module, not a global script -- see tsconfig.json

// Issue #533: this spec runs against a stack with DEMO_MODE=true and a dataset built by
// `npm run demo:reset`. It does NOT call `cy.resetAndSeed()` (the shared `before()` hook in
// `support/e2e.ts`, opted out of here exactly the way `01-register.cy.ts` does): that helper signs
// up a fresh user through `POST /api/auth/sign-up/email`, which demo mode refuses outright
// (`lib/registration-policy.ts`). This spec's whole point is to run against the ONE seeded demo
// account instead, never to create its own.
Cypress.env('skipSeed', true);

const DEMO_EMAIL = 'demo@invoicerr.app';
const DEMO_PASSWORD = 'demo';

function signInAsDemo() {
    cy.visit('/auth/sign-in');
    cy.get('[data-cy="auth-email-input"]').type(DEMO_EMAIL);
    cy.get('[data-cy="auth-password-input"]').type(DEMO_PASSWORD);
    cy.get('[data-cy="auth-submit-btn"]').click();
    cy.url({ timeout: 20000 }).should('include', '/dashboard');
}

describe('Demo mode (issue #533)', () => {
    it('shows the demo credentials on the sign-in page', () => {
        cy.visit('/auth/sign-in');
        cy.get('[data-cy="demo-credentials-notice"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-cy="demo-credentials-notice"]').should('contain.text', 'demo@invoicerr.app');
    });

    it('signs in with the demo account and shows the demo banner on every authenticated page', () => {
        signInAsDemo();
        cy.get('[data-cy="demo-banner"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-cy="demo-banner"]').should('contain.text', 'resets every 4 hours');

        // The banner is not a per-page fluke of the dashboard: it is mounted once, for the whole
        // authenticated shell.
        cy.visit('/documents/invoice');
        cy.get('[data-cy="demo-banner"]', { timeout: 10000 }).should('be.visible');
    });

    it('refuses to change the demo account password, in the UI and on the server', () => {
        signInAsDemo();
        cy.visit('/account/security');
        cy.get('[data-cy="account-security-current-password-input"]').type(DEMO_PASSWORD);
        cy.get('[data-cy="account-security-password-input"]').type('SomeOtherPassword123!');
        cy.get('[data-cy="account-security-confirm-password-input"]').type('SomeOtherPassword123!');
        cy.get('[data-cy="account-security-submit-button"]').should('be.disabled');
    });

    it('refuses to delete the demo account in the UI', () => {
        signInAsDemo();
        cy.visit('/account/danger');
        cy.get('[data-cy="account-danger-delete-button"]').should('be.disabled');
    });

    // The one behaviour this spec BREAKS and RESTORES for real (see the PR body / CLOUD_PROMPT
    // report for the actual break-and-restore command output): a draft invoice's "Send" is
    // refused by the backend at the transport chokepoint (`TransportRegistry.register`,
    // `modules/demo/demo-blocked.ts`), surfacing as "Send failed" with a named reason, never a
    // silent success.
    it('refuses to send a document: a draft invoice ends "Send failed" with the demo reason, never a silent success', () => {
        signInAsDemo();
        cy.visit('/documents/invoice');
        cy.contains(/^draft$/i, { timeout: 10000 }).should('be.visible');

        // The one draft row's own "Send" button, found by text (like 13-api-keys.cy.ts's own
        // create-button selector): this action has no stable per-test data-cy (its id is a fresh
        // document id every seed), so it is found by its visible label instead.
        cy.contains('button', /^send$/i, { timeout: 10000 }).click();
        // The confirmation dialog can render below the small default Cypress viewport, so
        // `scrollIntoView()` first, the same fix `13-api-keys.cy.ts` already uses for an
        // analogous "appeared but is outside the current scroll position" case.
        cy.contains('button', /^confirm$/i, { timeout: 10000 }).scrollIntoView().click();

        // The row itself is the real "did this stay blocked" signal: its status badge is never
        // clipped by `line-clamp`, so it is the guarantee that a send never silently succeeds.
        // Found by text, like the "Send"/"Confirm" buttons above: this status has no stable
        // per-test data-cy either.
        cy.contains('[data-cy="document-status-badge"]', /^send failed$/i, { timeout: 20000 }).should(
            'be.visible',
        );

        // The unique, load-bearing assertion: this exact refusal text only ever comes from
        // `DemoModeBlockedError` (`modules/demo/demo-blocked.ts`). `/send failed/i` alone is
        // ambiguous (it also names the list's OWN status filter tab), so the specific reason is
        // what this test actually pins down. Issue #570: the error paragraph itself is
        // `line-clamp-2` inside an `overflow: hidden` row, so asserting Cypress VISIBILITY on it
        // is layout-timing-dependent (a clamped element can read as "not visible" even though its
        // full text is right there in the DOM). Scroll it into view, then read its TEXT instead of
        // asking Cypress whether it is visible -- `contain.text` inspects the node's content
        // regardless of whether the clamp is currently clipping it. The row id in its own data-cy
        // is a fresh document id every seed (same reason the "Send" button above is found by text),
        // so the error paragraph is found by a prefix match instead.
        cy.get('[data-cy^="document-row-last-error-"]', { timeout: 20000 })
            .scrollIntoView()
            .should('contain.text', 'is disabled in this demo');
        // Never the ordinary "no transport configured" refusal a company with none chosen would
        // see: this specific company DOES have one (`invoiceTransportId: 'email'`, seeded by
        // `seed-company.ts`), so the ONLY reason it can fail is demo mode itself.
        cy.contains(/no transport is configured/i).should('not.exist');
    });
});
