// ***********************************************************
// Cypress e2e support file — loaded before every spec.
// ***********************************************************

import './commands'

Cypress.on('fail', (error) => {
    console.error('Test failed:', error.message);
    throw error;
});

// A single spec can register a RegExp here to tolerate ONE specific, already-diagnosed application
// error for its own tests — never a substitute for the curated cross-cutting list below, which stays
// reserved for browser noise every spec can hit. Registering a SECOND `Cypress.on('uncaught:exception',
// ...)` listener does not work for this: Cypress invokes every registered listener, and the one below
// still `throw`s for anything it does not recognize regardless of what an additional listener returns
// — so a spec-local carve-out has to feed this same, single source of truth instead. State lives on
// the `Cypress` object itself (a real cross-file singleton the runner injects, `as` cast below rather
// than a `.d.ts` augmentation for one field), NOT a plain module-level array: Cypress bundles this
// support file and each spec file as SEPARATE entries, so a spec's own `import` of a bare exported
// array is a DIFFERENT module instantiation with its own copy — pushing to it would never be seen by
// the `uncaught:exception` handler below, which closes over whichever instantiation Cypress itself
// loaded as the support file. See `09-settings.cy.ts`'s own "creates a new invitation code" test for
// the one call site today.
interface CypressWithUncaughtToleranceList {
    __extraToleratedUncaughtExceptions: RegExp[]
}
(Cypress as unknown as CypressWithUncaughtToleranceList).__extraToleratedUncaughtExceptions = [];

/**
 * Tolerates ONE more uncaught exception pattern, for the CURRENT spec file only (the list is reset
 * fresh each time Cypress reloads this support file, i.e. once per spec file — see this file's own
 * module-level comment). Call from inside the one `it()` that needs it (or a shared helper only the
 * affected tests call, e.g. `03-auth.cy.ts#createInvitationCodeViaUI` — never at a spec's bare top
 * level), so the carve-out is visibly scoped to the action whose own comment explains why the app
 * error is real but out of scope here.
 */
export function tolerateUncaughtException(pattern: RegExp): void {
    (Cypress as unknown as CypressWithUncaughtToleranceList).__extraToleratedUncaughtExceptions.push(pattern);
}

// Only the browser-noise classes we've actually seen fire in this suite are tolerated — everything
// else (a thrown effect, `undefined.map`, a rejected promise) fails the test loudly. The suite used
// to swallow every uncaught exception unconditionally: a React render crashing into the app's own
// ErrorBoundary left the DOM in a dead-but-present state that a spec asserting on the API (rather
// than on the now-defunct screen) could not distinguish from a healthy one.
Cypress.on('uncaught:exception', (err) => {
    const tolerated = [
        // Chrome/Electron fires this when a `ResizeObserver` callback can't keep up with layout
        // churn (Radix popovers, the dashboard's charts) — cosmetic, never something the app code
        // can prevent, and long-documented as safe to ignore (https://stackoverflow.com/q/49384120).
        /ResizeObserver loop/,
        // A `fetch`/`AbortController` request cancelled by an unmount or a navigation (TanStack
        // Query refetch races) rejects with this — expected under Cypress' fast, scripted navigation.
        /AbortError/,
        // Belt-and-braces for the service-worker guard below: `getRegistrations()` on the blank page
        // Cypress shows before the first `cy.visit` rejects with a `DOMException` whose `message` is
        // a getter, which the runner's own error formatting cannot stringify — already caught at the
        // source (see the second `before()` hook), this is a backstop in case a future call site adds
        // a service-worker read that isn't.
        /object DOMException/,
        ...(Cypress as unknown as CypressWithUncaughtToleranceList).__extraToleratedUncaughtExceptions,
    ];
    if (tolerated.some((pattern) => pattern.test(err.message))) return false;
    throw err;
});

// Intercept and log auth API calls for debugging
beforeEach(() => {
    cy.intercept('POST', '**/api/auth/**').as('authRequest');
    cy.intercept('GET', '**/invitations/**').as('invitationsRequest');
});

// ---------------------------------------------------------------------------
// Radix UI scroll-lock residue, diagnostic cleanup only.
//
// Radix Dialog/Sheet sets `pointer-events: none` on <body> while a modal is open and clears it on
// unmount; in headless Electron the CSS exit-animation never fires `animationend`, so Radix Presence
// can leave that residue behind after a test that closed its own dialog correctly. This used to run
// in `beforeEach`, which wiped the residue before the NEXT test could see it — indistinguishable from
// a dialog that never releases `pointer-events` at all, i.e. a frozen page, since either way the
// following test started clean. Running it in `afterEach` instead keeps the hygiene (no test inherits
// a stuck lock from the one before it) without hiding that failure mode: a dialog that fails to close
// now leaves its actionability broken for the REST OF ITS OWN TEST, which is exactly the signal
// removing the global `force: true` overrides (below) was meant to restore.
afterEach(() => {
    cy.document({ log: false }).then((doc) => {
        doc.body.style.pointerEvents = '';
        doc.body.removeAttribute('data-scroll-locked');
        doc.querySelectorAll('style').forEach((s) => {
            if (s.textContent?.includes('data-scroll-locked')) s.remove();
        });
    });
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

// ---------------------------------------------------------------------------
// Belt and braces against a residual service worker.
//
// The app's own registration (src/main.tsx) already skips itself under `window.Cypress`, but that
// guard only stops a NEW registration — it does nothing about one a previous visit already installed
// (an old build tested earlier in this same browser profile, a manual visit in another tab sharing
// the profile, ...). Cypress does not unregister service workers between visits or specs on its own,
// so a stray one would keep controlling every page this run touches. A service worker has no
// legitimate role in a suite that only ever drives the app through its own screens and the API, and
// one intercepting navigations (or reloading on activation) is exactly the class of flakiness that
// broke 29-document-recurrence.cy.ts the day the PWA landed (b7a6581d) — a mid-command DOM
// detachment with no equivalent in the app's own code. Unregister anything found before every spec
// rather than trusting that nothing upstream ever registered one.
before(() => {
    cy.window({ log: false }).then((win) => {
        const serviceWorker = win.navigator.serviceWorker;
        if (!serviceWorker) return;
        // This hook runs BEFORE any `cy.visit`, on the blank page Cypress shows first: an opaque
        // origin, where `getRegistrations()` rejects with a `DOMException` (SecurityError) rather
        // than returning an empty list. Left uncaught, that rejection failed every spec's before-all
        // hook — and not even with its own message: the runner tries to re-label the error and a
        // `DOMException`'s `message` is a getter, so what surfaced was "Cannot set property message
        // of [object DOMException]". No origin means nothing could have been registered: swallow it.
        const noRegistrations = () => [] as readonly ServiceWorkerRegistration[];
        let lookup: Promise<readonly ServiceWorkerRegistration[]>;
        try {
            lookup = serviceWorker.getRegistrations().then((registrations) => registrations, noRegistrations);
        } catch {
            lookup = Promise.resolve(noRegistrations());
        }
        return lookup.then((registrations) => {
            registrations.forEach((registration) => registration.unregister());
        });
    });
});
