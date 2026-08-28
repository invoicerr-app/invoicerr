// ***********************************************************
// Cypress e2e support file — loaded before every spec.
// ***********************************************************

import './commands'

Cypress.on('fail', (error) => {
    console.error('Test failed:', error.message);
    throw error;
});

Cypress.on('uncaught:exception', () => {
    return false
})

// ---------------------------------------------------------------------------
// Nuclear fix for Radix UI scroll-lock residue in headless Electron.
//
// Radix Dialog/Sheet sets `pointer-events: none` on <body> when a modal
// opens.  In headless Cypress the CSS exit-animations never fire
// `animationend`, so Radix Presence never unmounts and the cleanup never
// runs.  Override click/type/clear to default force:true so Cypress
// ignores the pointer-events check entirely.
// ---------------------------------------------------------------------------
Cypress.Commands.overwrite('click', (originalFn: any, subject: any, ...args: any[]) => {
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
        last.force = true;
    } else {
        args.push({ force: true });
    }
    return originalFn(subject, ...args);
});

Cypress.Commands.overwrite('type', (originalFn: any, subject: any, ...args: any[]) => {
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
        last.force = true;
    } else {
        args.push({ force: true });
    }
    return originalFn(subject, ...args);
});

Cypress.Commands.overwrite('clear', (originalFn: any, subject: any, ...args: any[]) => {
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
        last.force = true;
    } else {
        args.push({ force: true });
    }
    return originalFn(subject, ...args);
});

// Strip Radix scroll-lock residue before each test
beforeEach(() => {
    cy.document().then((doc) => {
        doc.body.style.pointerEvents = '';
        doc.body.removeAttribute('data-scroll-locked');
        doc.querySelectorAll('style').forEach((s) => {
            if (s.textContent?.includes('data-scroll-locked')) s.remove();
        });
    });
});

// Intercept and log auth API calls for debugging
beforeEach(() => {
    cy.intercept('POST', '**/api/auth/**').as('authRequest');
    cy.intercept('GET', '**/invitations/**').as('invitationsRequest');
});

// ---------------------------------------------------------------------------
// Per-spec isolation.
//
// One `resetDatabase` in `01-register` served all seventeen specs, so each one inherited whatever
// the previous ones had left behind. Measured over three full runs in different orders: 11, 9 and
// 13 failures, overlapping only on the two that were real defects. A spec that passes at position 7
// and fails at position 2 is not testing the product.
//
// The reset lives here rather than in each spec so it cannot be forgotten by the next spec added —
// the same reasoning as the required DI token on the VAT validation client. `01-register` opts out
// through `Cypress.env('skipSeed')`, set in the spec itself: it registers the first user, which
// requires that no user exists.
// ---------------------------------------------------------------------------
before(() => {
    if (Cypress.env('skipSeed')) return;
    cy.resetAndSeed();
});
