// ***********************************************************
// This example support/e2e.js is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands'

Cypress.on('fail', (error) => {
    console.error('Test failed:', error.message);
    throw error;
});

Cypress.on('uncaught:exception', () => {
    return false
})


// Reset Radix UI scroll-lock residue.
// Headless Cypress never fires CSS animationend, so Radix's Presence
// never unmounts the dialog → body stays stuck with pointer-events:none
// and data-scroll-locked="1".  A MutationObserver continuously strips
// these residues so they never block clicks.
beforeEach(() => {
    cy.document().then((doc) => {
        // Immediate cleanup from previous test
        doc.body.style.pointerEvents = '';
        doc.body.removeAttribute('data-scroll-locked');

        // Persistent cleanup: strip scroll-lock residue whenever it reappears
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'style') {
                    if (doc.body.style.pointerEvents === 'none') {
                        doc.body.style.pointerEvents = '';
                    }
                }
                if (m.type === 'attributes' && m.attributeName === 'data-scroll-locked') {
                    doc.body.removeAttribute('data-scroll-locked');
                }
                if (m.type === 'childList') {
                    // Radix may re-add a <style> tag for RemoveScroll; remove it
                    m.addedNodes.forEach((node) => {
                        if (node instanceof doc.defaultView.HTMLStyleElement &&
                            node.textContent?.includes('data-scroll-locked')) {
                            node.remove();
                        }
                    });
                }
            }
        });
        observer.observe(doc.body, {
            attributes: true,
            attributeFilter: ['style', 'data-scroll-locked'],
            childList: true,
            subtree: true,
        });
    });
});

// Intercept and log auth API calls for debugging
beforeEach(() => {
    cy.intercept('POST', '**/api/auth/**').as('authRequest');
    cy.intercept('GET', '**/invitations/**').as('invitationsRequest');
});
