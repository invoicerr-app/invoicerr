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
    // Backend sends mail asynchronously — under CI load the OTP email can lag
    // behind the request that triggered it. Poll mailpit instead of asserting
    // on a single-shot request, so we don't hard-fail on a mail that is simply
    // still in flight. ~20 attempts * 500ms wait ≈ 10s retry budget.
    function pollForMessage(attemptsLeft: number): Cypress.Chainable<any> {
        return cy
            .request({ url: 'http://localhost:8025/api/v1/messages', failOnStatusCode: false })
            .then((res) => {
                const messages = res.body?.messages || [];
                if (messages.length === 0 && attemptsLeft > 0) {
                    cy.wait(500);
                    return pollForMessage(attemptsLeft - 1);
                }
                // Retry budget exhausted (or messages present) — assert here so a
                // genuine failure (no mail ever arrived) still hard-fails clearly.
                expect(messages, 'mailpit message present after polling').to.have.length.greaterThan(0);
                const id = messages[0].ID;
                return cy.request(`http://localhost:8025/api/v1/message/${id}`);
            });
    }

    return pollForMessage(20).then(res => res.body);
});

Cypress.Commands.add('clearEmails', () => {
    return cy.request('DELETE', 'http://localhost:8025/api/v1/messages');
});

Cypress.Commands.add('waitForDocumentStatus', (url: string, targetStatuses: string[]) => {
    // Item 22 (queues) made "send" asynchronous: a `cy.request().its().should()` does NOT
    // RE-TRIGGER the request on each new attempt — it always rereads the SAME response already
    // received, and a status still "sending" at the time of that response would stay that way forever
    // as far as the test is concerned. A real poll loop is needed for a purely API-driven test (with
    // no screen to benefit from its own polling — see 28-document-async-send.cy.ts, which polls on
    // the UI side via `cy.get(...).should(...)`, which does re-trigger the DOM read on each attempt).
    // Same budget as `getLastEmail`: ~20 attempts * 500ms ≈ 10s.
    function poll(attemptsLeft: number): Cypress.Chainable<any> {
        return cy.request({ url, failOnStatusCode: false }).then((res) => {
            const status = res.body?.status;
            if (!targetStatuses.includes(status) && attemptsLeft > 0) {
                cy.wait(500);
                return poll(attemptsLeft - 1);
            }
            expect(
                targetStatuses,
                `le document a atteint un statut cible après polling — reçu "${status}"`,
            ).to.include(status);
            return cy.wrap(res.body);
        });
    }

    return poll(20);
});

Cypress.Commands.add('selectCountry', (dataCy: string, countryName: string) => {
    cy.get(`[data-cy="${dataCy}"] button`).first().click({ force: true });
    cy.wait(500);
    cy.get(`[data-cy="${dataCy}-options"]`, { timeout: 3000 }).should('exist');
    cy.get(`[data-cy="${dataCy}"] input`).clear({ force: true }).type(countryName, { force: true });
    cy.wait(300);
    cy.get(`[data-cy="${dataCy}-option-${countryName.toLowerCase().replace(/\s+/g, '-')}"]`, { timeout: 3000 }).should('exist').click({ force: true });
});

/**
 * Opens a `DatePicker` popover (frontend/src/components/date-picker.tsx, a Radix `Popover`) and
 * waits for it to have actually mounted, retrying the trigger click (bounded) if it didn't --
 * factored out of `pickToday` so a caller that needs the popover open for something OTHER than the
 * "Today" button (spec 29's `.rdp-button_previous` clicks) gets the same race protection instead of
 * reimplementing it. `scrollIntoView()` on the trigger first, because the popover anchors below it
 * and a trigger sitting under the fold of a tall dialog can open a popover that's itself off-screen.
 * Readiness is checked on `[data-cy="date-picker-today"]`: the "Today" footer button is part of the
 * SAME popover content regardless of what the caller clicks next, so its visibility is a valid proxy
 * for "the popover is open" for every caller, not just `pickToday`.
 * @example cy.openDatePicker('[data-cy="document-field-issueDate-input"]')
 */
Cypress.Commands.add('openDatePicker', (triggerSelector: string) => {
    // OPEN-side race: CI runs 34966958790 (spec 70) and 34961385407 (specs 63/70) timed out waiting
    // for `[data-cy="date-picker-today"]` to even APPEAR (10s) -- a failed/undone open, not a slow
    // one. Reading the installed `@radix-ui/react-dismissable-layer` (1.1.13) shows the mechanism:
    // `usePointerDownOutside` registers its document-level `pointerdown` listener via a deferred
    // `setTimeout(0)` on mount but only detaches it in a passive effect's cleanup on unmount -- not
    // synchronous with the `setOpen(false)` that closed the PREVIOUS layer (a `SearchSelect` combobox,
    // or the sibling `DatePicker` an earlier call just used). A scripted click on THIS trigger fired
    // inside that window is still visible to the old, stale listener, which fires its own
    // dismiss/replay handling on the very pointerdown that was meant to open this popover -- a real
    // user's next click, tens of milliseconds later, never lands inside that window. Retained
    // hypothesis, not a proven single trace (the CI video artifact for these runs is ~400MB, too large
    // to pull apart here) -- but it is the same class of bug as the CLOSE side documented in
    // `pickToday` below, on the OPEN side, and the fix is the mirror image: wait before the click,
    // then verify the popover actually opened and retry the click (bounded) if it didn't, so a genuine
    // product regression still fails loudly instead of looping forever or timing out with no
    // diagnostic.
    cy.wait(50);
    const OPEN_POLL_MS = 100;
    const OPEN_TIMEOUT_MS = 800;
    const MAX_ATTEMPTS = 3;
    const isOpen = () =>
        cy.get('body').then(($body) => $body.find('[data-cy="date-picker-today"]:visible').length > 0);
    const pollForOpen = (elapsedMs: number): Cypress.Chainable<boolean> =>
        isOpen().then((visible) => {
            if (visible || elapsedMs >= OPEN_TIMEOUT_MS) return cy.wrap(visible);
            cy.wait(OPEN_POLL_MS);
            return pollForOpen(elapsedMs + OPEN_POLL_MS);
        });
    const openWithRetries = (attempt: number): void => {
        cy.get(triggerSelector).scrollIntoView().click();
        pollForOpen(0).then((opened) => {
            if (opened || attempt >= MAX_ATTEMPTS) {
                if (attempt > 1) {
                    Cypress.log({
                        name: 'openDatePicker',
                        message: opened
                            ? `popover opened after ${attempt} attempt(s)`
                            : `popover still not open after ${attempt} attempt(s), giving up retries`,
                    });
                }
                return;
            }
            Cypress.log({ name: 'openDatePicker', message: `popover did not open on attempt ${attempt} -- retrying` });
            openWithRetries(attempt + 1);
        });
    };
    openWithRetries(1);
});

/**
 * Picks "today" on a `DatePicker` (frontend/src/components/date-picker.tsx) through its own "Today"
 * footer button, never a computed `[data-day="M/D/YYYY"]` selector. That selector depended on the
 * test computing the SAME locale/timezone string react-day-picker would compute for its own "today"
 * cell, and on the popover having actually mounted that cell inside the CI viewport (1000x660) by the
 * time the click fired — three independent ways to race or mismatch, all observed in CI (runs
 * 34954776077, 34930840117, 34951814251).
 * @example cy.pickToday('[data-cy="document-field-issueDate-input"]')
 */
Cypress.Commands.add('pickToday', (triggerSelector: string) => {
    cy.openDatePicker(triggerSelector);
    cy.get('[data-cy="date-picker-today"]', { timeout: 10000 }).should('be.visible').click();
    // The popover's content unmounts on close (Radix `Presence`, no `forceMount`) -- its own "Today"
    // button is gone, not merely hidden, which is what actually proves the popover closed.
    cy.get('[data-cy="date-picker-today"]').should('not.exist');
    // CI run 34958157645 (commit 0ff4b8be, which introduced this "Today" button): THREE specs
    // (62/66/70) failed on the very next `[data-cy="...-input-options"]` -- the following `SearchSelect`
    // (search-input.tsx,
    // itself a `@radix-ui/react-popover`, the same primitive this DatePicker is built on) never
    // opened, even though its trigger's own click landed. Traced to the library, not this screen:
    // `PopoverContent`'s `DismissableLayer` binds its outside-pointerdown listener straight on
    // `document` (`@radix-ui/react-dismissable-layer`'s own `usePointerDownOutside`), and detaches it
    // in a PASSIVE effect's cleanup -- scheduled after this commit's paint, not synchronous with the
    // `setOpen(false)` the "Today" click just ran. A click fired before that cleanup flushes is still
    // caught by the stale listener as "pointerdown outside", which replays it onto the (unrelated)
    // NEXT trigger via `dispatchDiscreteCustomEvent` -- a `ReactDOM.flushSync` dispatched while that
    // trigger's own click is already in flight, racing the click that should have opened it. A real
    // user's next click lands tens of milliseconds later, well past one passive-effect flush; only a
    // scripted click fired in the same tick the popover closed hits this. `not.exist` above proves the
    // DOM is gone, not that this listener has been torn down -- so it is not by itself enough. The
    // same "short fixed wait after closing a Radix popover" already covers `selectCountry`'s own
    // Radix combobox (right above) for the identical class of race.
    cy.wait(50);
});

/**
 * Opens a saved document's OWN page from its type's list: clicks the row's title link
 * (`document-open-link-<id>`, the one keyboard-reachable "open" control document-list.tsx renders)
 * and waits for the page root (`document-detail-page`, document-detail.tsx). The page is what
 * replaced the old edit dialog — every spec that used to click `document-edit-button-<id>` and wait
 * for `document-edit-dialog` goes through here, so a change to how a record is opened is one edit.
 * Assumes the list is already on screen (`cy.visit('/documents/<typeId>')` first).
 * @example cy.openDocument(invoiceId)
 */
Cypress.Commands.add('openDocument', (documentId: string) => {
    cy.get(`[data-cy="document-open-link-${documentId}"]`, { timeout: 15000 }).scrollIntoView().click();
    cy.get('[data-cy="document-detail-page"]', { timeout: 15000 }).should('be.visible');
    // The record's own GET has resolved and the form is mounted — `document-form` is the fields
    // block (document-form.tsx); the header's badges and the side sections keep loading after it,
    // each with its own selector, so a caller asserting one of those still waits on it explicitly.
    cy.get('[data-cy="document-form"]', { timeout: 15000 }).should('exist');
});

/**
 * Opens the detail page's "Actions" menu (document-detail.tsx) and waits for its content — every
 * secondary action (`document-action-<id>`), PDF/XML downloads, share link and recurrence live in
 * there; only the ONE primary action is a plain button in the header.
 * @example cy.openDocumentActionsMenu()
 */
Cypress.Commands.add('openDocumentActionsMenu', () => {
    cy.get('[data-cy="document-actions-menu"]', { timeout: 15000 }).scrollIntoView().click();
    cy.get('[data-cy="document-actions-menu-content"]', { timeout: 10000 }).should('be.visible');
});

/**
 * Runs one declared action from the detail page, wherever the page put it: the header's primary
 * button when `document-action-<id>` is visible on its own, otherwise the same selector inside the
 * "Actions" menu (opened first). Which one it is depends on the record's status and on whether the
 * form has unsaved edits (action-presentation.ts's `pickPrimaryAction`) — a spec should not have to
 * know, the same way a user does not: the label reads the same in both places.
 * @example cy.runDocumentAction('send')
 */
Cypress.Commands.add('runDocumentAction', (actionId: string) => {
    const selector = `[data-cy="document-action-${actionId}"]`;
    cy.get('body').then(($body) => {
        if ($body.find(`${selector}:visible`).length > 0) {
            cy.get(selector).scrollIntoView().click();
            return;
        }
        cy.openDocumentActionsMenu();
        cy.get(selector, { timeout: 10000 }).should('be.visible').click();
    });
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
/**
 * Reset to a known world, before every spec.
 *
 * The suite reset its database exactly ONCE — `cy.task('resetDatabase')` in `01-register` — and the
 * sixteen specs after it ran on whatever the previous ones had left. Three full runs in different
 * orders produced 11, 9 and 13 failures, overlapping only on the two that were real: `05-clients`
 * clicking an element that existed twice, `15-multi-company` finding three companies where it
 * expected two, `07-invoices` green in one order and red in another. Those are not flaky tests;
 * they are tests reading a world nobody defined.
 *
 * Resetting alone is not enough: `cy.login()` signs in as john.doe@acme.org, a user that `01`
 * registers, and every later spec assumes a company profile that `02` fills in. So the reset is
 * paired with a seed that rebuilds exactly that world through the API — same account, same company —
 * and with clearing Cypress' session cache, which otherwise replays a cookie for a user the
 * truncate just deleted.
 *
 * Seeding through HTTP rather than SQL on purpose: the password is hashed by better-auth, and a
 * fixture that writes its own hash is a fixture that breaks the day the auth library changes.
 */
Cypress.Commands.add('resetAndSeed', () => {
    const apiUrl = Cypress.env('apiUrl');
    cy.task('resetDatabase');
    // The truncate deletes the user; a cached session would then present a token for nobody.
    cy.then(() => Cypress.session.clearAllSavedSessions());

    cy.request({
        method: 'POST',
        url: `${apiUrl}/api/auth/sign-up/email`,
        body: {
            name: 'John Doe',
            firstname: 'John',
            lastname: 'Doe',
            email: 'john.doe@acme.org',
            password: 'Super_Secret_Password123!',
        },
        failOnStatusCode: false,
    }).then((signup) => {
        expect(signup.status, 'sign-up must succeed — every later spec logs in as this user').to.be.oneOf([
            200, 201,
        ]);
    });

    // Sign in so the company call carries a session cookie.
    cy.request({
        method: 'POST',
        url: `${apiUrl}/api/auth/sign-in/email`,
        body: { email: 'john.doe@acme.org', password: 'Super_Secret_Password123!' },
    })
        .its('status')
        .should('be.oneOf', [200, 201]);

    // The company profile `02-company` fills in by hand, and every later spec assumes: a French
    // company with a SIRET, because FR compliance refuses to issue without one.
    cy.request({
        method: 'POST',
        url: `${apiUrl}/api/companies`,
        body: {
            name: 'Acme Corp',
            description: 'A fictional company',
            phone: '+33123456789',
            email: 'contact@acme.org',
            address: '123 Main St',
            city: 'Paris',
            postalCode: '75001',
            // `country` is the human name (the column the app stores from the picker) and
            // `countryCode` its ISO override — both, because FR compliance resolves on the code and
            // refuses to guess. The identifiers do NOT live on Company: createCompany peels
            // `identifiers` off the DTO and spreads the rest straight into prisma.company.create,
            // so a stray legalId/VAT key is a PrismaClientValidationError, which is exactly the 500
            // the first run of this seed produced.
            country: 'France',
            countryCode: 'FR',
            currency: 'EUR',
            identifiers: [
                { scheme: 'LEGAL_ID', value: '73282932000074' },
                { scheme: 'VAT', value: 'FR44732829320' },
            ],
        },
        failOnStatusCode: false,
    }).then((res) => {
        expect(res.status, 'the baseline company must exist').to.be.oneOf([200, 201]);
    });

    // One baseline client, because a world with a company and no client is a world several specs
    // cannot start in: 06-quotes, 07-invoices and 10-recurring all open a picker and click its
    // first option. Before per-spec isolation they were reading clients that 05 happened to leave
    // behind, which is precisely the dependency being removed — so the world has to contain one on
    // purpose instead of by accident. French, domestic, so a quote or an invoice built on it is the
    // simple case and not an unintended cross-border test.
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
    }).then((res) => {
        expect(res.status, 'the baseline client must exist').to.be.oneOf([200, 201]);
    });
});
