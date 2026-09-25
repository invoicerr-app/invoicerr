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

// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })
// `cy.resetDatabase` used to live here — a browser-side `Cypress.Commands.add` whose body called
// Node's `child_process.exec`, which does not exist in a browser at all. Its own `Promise` was
// never returned or awaited either, so the command resolved (as a no-op) before that `exec` call
// could ever throw. Nothing in the suite called it — the ACTUAL reset (`cy.task('resetDatabase')`
// in `resetAndSeed` below) runs in the Node plugin process (`cypress.config.ts`'s own `on("task",
// ...)`), which is the only place `child_process`/`pg` can run at all. Removed along with its
// `index.d.ts` declaration and the `"child_process": "^1.0.2"` entry in `package.json`
// (`npm/security-holder`, a placeholder package — not the real Node builtin — that this file's
// `import` pulled into the browser bundle for nothing).
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
 * Waits for a Radix layer that was JUST DISMISSED to have finished tearing down, before the caller
 * opens another layer on top of it. Two facts, both observable, neither of them a sleep:
 *  1. the dismissed layer's content is GONE from the DOM -- `Presence` keeps it mounted for the
 *     whole exit animation (`data-[state=closed]:animate-out` on every content in components/ui/),
 *     so "the entry was clicked" is nowhere near "the menu is gone";
 *  2. focus has SETTLED on the element the caller names -- `@radix-ui/react-focus-scope` (1.1.10,
 *     dist/index.mjs) restores focus to the dismissed layer's trigger from the unmount cleanup's own
 *     `setTimeout(..., 0)`, i.e. one macrotask AFTER the unmount in (1), never synchronously with
 *     it; and when that trigger sits OUTSIDE a modal dialog that is still open (a row menu's entry
 *     that opened one), the dialog's own trapped `FocusScope` immediately bounces focus back inside
 *     it. Hence "where focus ends up", named by the caller, rather than "the trigger": both moves
 *     have to have happened, and the second one only exists in some of these hand-offs.
 *
 * Opening a popover in the window between (1) and (2) is what silently closes it again: the restore
 * fires while the NEW layer is already open, moves focus out of it, and its `DismissableLayer`
 * dismisses on focus-outside. Traced live on 2026-09-24 against a real stack, spec 29's own
 * sequence, with a `focusin` recorder on `document` (times relative to the recurrence dialog being
 * visible):
 *     21ms  focusin  -> DIV[data-cy=document-row-menu-content-<id>]   (menu still animating out)
 *     55ms  focusin  -> INPUT[placeholder="Search..."]                (cadence popover just opened)
 *     99ms  focusout <- INPUT[placeholder="Search..."]
 *    100ms  focusin  -> BUTTON[data-cy=document-row-menu-<id>]        (the menu's deferred restore)
 *    141ms  popover gone
 * which is exactly the failure CI reported on PR #447: `cy.click()` on the "Yearly" option "failed
 * because the page updated while this command was executing" -- the option had been visible a
 * moment earlier, the assertion right before it passed, and the popover was dismissed while Cypress
 * was still waiting for the button to become actionable.
 *
 * Asserting on a NAMED element rather than on "focus is anywhere" is deliberate: it is the one fact
 * that PROVES the deferred restore already ran. If a future Radix version leaves focus somewhere
 * else, this fails loudly on that named element instead of degrading back into a flake.
 *
 * ## Since the product fix for #451 (PR #456): (1) is unchanged, (2) changed meaning
 * `frontend/src/lib/close-auto-focus-guard.ts`, wired into every shared menu/popover/select content
 * and into `SearchSelect`, cancels the deferred restore when focus already sits on a connected
 * element other than <body> at the moment it fires -- i.e. when it would STEAL focus from a layer
 * the user already moved to. Otherwise the restore runs exactly as before. So:
 *  - (1) still holds and is still the wait: the dismissed content leaves the DOM in both worlds.
 *  - (2) is no longer a race guard -- opening the next layer inside the window no longer dismisses
 *    it -- but it is kept as an ASSERTION of the keyboard behaviour the guard must preserve. Measured
 *    on a real stack (Chromium, 2026-09-24): after a row-menu entry opens a dialog, focus is already
 *    on the dialog's first tabbable control (its own `FocusScope` mount-autofocus runs before the
 *    menu's deferred restore, which the guard then cancels); after a pick with nothing else opened,
 *    the restore runs and focus is back on the picker's trigger. Both are the element callers name.
 *    If the guard ever regresses into suppressing the restore outright, focus ends on <body> and
 *    this fails loudly -- which is exactly how the first version of #456 was caught.
 * Consequence: NO spec using this command can see the race come back (guard deleted, they all
 * stay green). The regression guard for that is `84-layer-focus-restore.cy.ts`, which makes the
 * race deterministic instead of waiting it out.
 * @example cy.waitForLayerTeardown(`[data-cy="document-row-menu-content-${id}"]`, '[data-cy="document-field-cadence-input"] button')
 */
Cypress.Commands.add('waitForLayerTeardown', (contentSelector: string, settledFocusSelector: string) => {
    cy.get(contentSelector, { timeout: 10000 }).should('not.exist');
    cy.focused({ timeout: 10000 }).should('match', settledFocusSelector);
});

/**
 * Picks one option in a document form's own `SearchSelect` field and does NOT return until that
 * picker has finished tearing down (`waitForLayerTeardown` above). The three-line "click the
 * trigger, wait for the options, click one" this replaces left the caller free to open its NEXT
 * layer -- very often a `DatePicker`, since "client/issueDate/dueDate/currency" is the invoice
 * wizard's own first step -- inside the window where the picker's deferred focus restore dismisses
 * it again.
 *
 * `option` picks WHICH entry: 'first' (the default, what almost every caller wants from a seeded
 * list of one) or an option's own `data-cy` suffix, i.e. its slugified label.
 * @example cy.pickDocumentFieldOption('currency', 'eur')
 */
Cypress.Commands.add('pickDocumentFieldOption', (fieldKey: string, option: string = 'first') => {
    const wrapper = `[data-cy="document-field-${fieldKey}-input"]`;
    const options = `[data-cy="document-field-${fieldKey}-input-options"]`;
    cy.openSearchSelect(`document-field-${fieldKey}-input`);
    if (option === 'first') {
        cy.get(`${options} button`).first().click();
    } else {
        cy.get(`[data-cy^="document-field-${fieldKey}-input-option-${option}"]`).first().click();
    }
    cy.waitForLayerTeardown(options, `${wrapper} button`);
});

/**
 * Picks a client in a document form and waits for BOTH things that pick sets in motion:
 *  1. the picker's own teardown (`pickDocumentFieldOption` above), and
 *  2. the descriptor refetch it triggers -- `use-document-form.ts` watches the single-target
 *     'reference' to "client" and re-fetches `GET /api/documents/types/<type>?clientId=…`, because
 *     the per-country field overlays (country-fields/) depend on the buyer. When that response
 *     lands, `effectiveDescriptor` is replaced and every rendered field node is rebuilt: a calendar
 *     opened in between is unmounted mid-command, which is the `[data-cy=date-picker-today]` never
 *     found that CI hit on PR #446.
 * The intercept is registered before the click that causes the request, which is the only order
 * that works.
 *
 * Only for a form that HAS a client field. A supplier picker (purchase-order, goods-receipt) drives
 * no refetch at all -- `cy.pickDocumentFieldOption('supplier')` is what those want, since waiting
 * here for a request nobody makes is a timeout, not a safety net.
 * @example cy.pickDocumentClient()
 */
Cypress.Commands.add('pickDocumentClient', (option: string = 'first') => {
    const apiUrl = Cypress.env('apiUrl') || 'http://localhost:4000';
    cy.intercept({ method: 'GET', url: `${apiUrl}/api/documents/types/*?clientId=*` }).as('clientAwareDescriptor');
    cy.pickDocumentFieldOption('client', option);
    cy.wait('@clientAwareDescriptor', { timeout: 20000 });
});

/**
 * Opens a `DatePicker` popover (frontend/src/components/date-picker.tsx, a Radix `Popover`) and
 * waits for it to have actually mounted, retrying the trigger click (bounded) if it didn't --
 * factored out of `pickToday` so a caller that needs the popover open for something OTHER than the
 * "Today" button (spec 29's `.rdp-button_previous` clicks) gets the same race protection instead of
 * reimplementing it. `scrollIntoView()` on the trigger first, because the popover anchors below it
 * and a trigger sitting under the fold of a tall dialog can open a popover that's itself off-screen.
 * Readiness is the popover's OWN open state: the content holding `[data-cy="date-picker-today"]`
 * carrying Radix's `data-state="open"`. Never that button's visibility (see `isOpen` below).
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
    // OPEN means Radix says open, not "the Today button is visible". date-picker.tsx caps the popover
    // to the available height and scrolls inside it, so an open calendar can legitimately clip its own
    // footer: measured on issue #459 (43-correction-routes, Chromium 141 under CPU load), the popover
    // was `data-state="open"` with "Today" at y=651..683 inside a content box ending at y=668. The old
    // `:visible` check read that as "did not open" and fired the retry click below, and a click on the
    // trigger of an OPEN popover TOGGLES IT CLOSED. The closing popover then passed the next poll
    // (still mounted for its exit animation, briefly unclipped), and `pickToday`'s click on "Today"
    // landed on a node the end of that animation removed: "the page updated while this command was
    // executing". A retry must only ever fire on a popover that is genuinely not open.
    const isOpen = () =>
        cy
            .get('body')
            .then(
                ($body) =>
                    $body.find('[data-cy="date-picker-today"]').closest('[data-state]').attr('data-state') === 'open',
            );
    const pollForOpen = (elapsedMs: number): Cypress.Chainable<boolean> =>
        isOpen().then((open) => {
            if (open || elapsedMs >= OPEN_TIMEOUT_MS) return cy.wrap(open);
            cy.wait(OPEN_POLL_MS);
            return pollForOpen(elapsedMs + OPEN_POLL_MS);
        });
    const openWithRetries = (attempt: number): void => {
        // `force: true` here too (added alongside the bounded retry above, not a leftover): CI run on
        // 43-correction-routes.cy.ts's own Poland KOR test hit a DIFFERENT failure than the one this
        // retry loop guards against — not "clicked but nothing opened", but Cypress's own
        // actionability WAIT (restored once support/e2e.ts's global `force: true` override was
        // removed) spanning long enough for this trigger's surrounding form to re-render (a
        // conditionally-required field appearing once other data resolves) and detach the exact node
        // this command had queried, "the page updated while this command was executing". Skipping
        // that wait removes the window; the retry loop above still catches a click that lands cleanly
        // but doesn't open the popover.
        cy.get(triggerSelector).scrollIntoView().click({ force: true });
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
    // CI run 35095412354 (commit 8d85ad5c, spec 38): a `position: fixed` Radix popover anchored to a
    // trigger sitting mid-page (e.g. the wizard's "Details" step, 3rd/4th field) has, at worst, only
    // ~39px of headroom on either side of the trigger for the calendar grid + this footer button
    // (~340px) to fit into at Cypress' own default 1000x660 viewport -- date-picker.tsx now caps the
    // popover to Radix's own computed available height and scrolls internally instead of overflowing
    // the window, but that means "Today" can genuinely start outside the now-scrollable popover's own
    // viewport (scrollTop 0 shows the calendar header first). `scrollIntoView()` here scrolls THAT
    // inner container -- unlike scrolling the page, which does nothing for a `position: fixed` portal.
    cy.get('[data-cy="date-picker-today"]', { timeout: 10000 }).scrollIntoView().should('be.visible').click();
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
    //
    // That fixed 50ms was a guess at how long the teardown takes. It is now an assertion on the
    // teardown itself: the content is gone (above) and focus is back on this DatePicker's own
    // trigger, which is the `FocusScope` unmount cleanup having actually run — see
    // `waitForLayerTeardown` above for the traced sequence and for what opening the next layer
    // inside that window does to it.
    cy.focused({ timeout: 10000 }).should('match', triggerSelector);
});

/**
 * Picks an explicit date through a `DatePicker`'s own month/year dropdowns
 * (`captionLayout="dropdown"`) instead of repeated `.rdp-button_previous`/`_next` clicks — the only
 * practical way to reach a date a year or more away. Selects the YEAR first: react-day-picker
 * regenerates the month dropdown's options for whatever year is currently displayed, so picking the
 * month before the year would pick from the wrong year's list. Both `select()` calls need
 * `force: true` — the dropdown is a real, native `<select>` but react-day-picker renders it
 * `opacity-0`, absolutely positioned over its own formatted caption text, so Cypress' actionability
 * check would otherwise refuse it as hidden.
 * @example cy.pickDate('[data-cy="document-field-dueDate-input"]', '2027-03-15')
 */
Cypress.Commands.add('pickDate', (triggerSelector: string, iso: string) => {
    const [year, month, day] = iso.split('-').map(Number);
    cy.openDatePicker(triggerSelector);
    cy.get('select[aria-label="Choose the Year"]').select(String(year), { force: true });
    cy.get('select[aria-label="Choose the Month"]').select(String(month - 1), { force: true });
    // Never ambiguous with an outside-month day: those only ever fill in the first/last week's
    // leftover cells (days 1-6 or the tail past a month's last day), so a mid-month day like the
    // 15th used by the caller above is unique in the grid without filtering by month.
    cy.get('[data-day]').contains(new RegExp(`^${day}$`)).first().click({ force: true });
    cy.get('[data-cy="date-picker-today"]').should('not.exist');
    // Same teardown assertion `pickToday` above ends on, for the identical race: the caller's very
    // next trigger click (e.g. the currency `SearchSelect` right after a due date, in the wizard's
    // Details step) must not fire while this popover is still handing focus back.
    cy.focused({ timeout: 10000 }).should('match', triggerSelector);
});

/**
 * Opens a Radix `Select` trigger and clicks one of its options, retrying the trigger click
 * (bounded) if the option never becomes visible — the same open-side race `openDatePicker` and
 * `openDocumentRowMenu` above guard against, hit here when the trigger sits right after a "more"
 * menu closes (that menu's own `DismissableLayer` still detaching its outside-pointerdown
 * listener on a deferred passive-effect cleanup): a scripted click on this trigger, fired inside
 * that window, is swallowed by the stale listener instead of opening the `Select`, so the option
 * never appears. CI run 35034664790 (spec 29, Electron only — a real user's next click lands well
 * past the passive-effect flush, and Firefox's own event timing never puts the two clicks in the
 * same tick, which is why this passed locally there).
 * @example cy.openSelect('[data-cy="document-field-cadence-input"] button', '[data-cy="document-field-cadence-input-option-yearly"]')
 */
Cypress.Commands.add('openSelect', (triggerSelector: string, optionSelector: string) => {
    const OPEN_POLL_MS = 100;
    const OPEN_TIMEOUT_MS = 800;
    const MAX_ATTEMPTS = 3;
    const isOpen = () =>
        cy.get('body', { log: false }).then(($body) => $body.find(`${optionSelector}:visible`).length > 0);
    const pollForOpen = (elapsedMs: number): Cypress.Chainable<boolean> =>
        isOpen().then((visible) => {
            if (visible || elapsedMs >= OPEN_TIMEOUT_MS) return cy.wrap(visible, { log: false });
            cy.wait(OPEN_POLL_MS, { log: false });
            return pollForOpen(elapsedMs + OPEN_POLL_MS);
        });
    const openWithRetries = (attempt: number): void => {
        cy.get(triggerSelector).scrollIntoView().click();
        pollForOpen(0).then((opened) => {
            if (opened || attempt >= MAX_ATTEMPTS) {
                if (attempt > 1) {
                    Cypress.log({
                        name: 'openSelect',
                        message: opened
                            ? `option visible after ${attempt} attempt(s)`
                            : `option still not visible after ${attempt} attempt(s), giving up retries`,
                    });
                }
                return;
            }
            Cypress.log({ name: 'openSelect', message: `option did not appear on attempt ${attempt} -- retrying` });
            openWithRetries(attempt + 1);
        });
    };
    // Same "wait before the click" as `openDatePicker`'s own OPEN-side guard, so a menu that just
    // closed has a chance to detach its stale listener before this trigger's click can race it.
    cy.wait(50);
    openWithRetries(1);
    cy.get(optionSelector, { timeout: 10000 }).should('be.visible').click();
});

/**
 * Opens a `SearchSelect` (components/search-input.tsx) popover WITHOUT picking an option — for the
 * callers that type a filter into it afterward instead of clicking the first entry (CurrencySelect,
 * used by both client-upsert.tsx's own currency field and every document "currency"/"client"/
 * "vatRate" field this app has). `openSelect` above can't serve these: it always ends on ONE fixed
 * option, but these callers narrow the list by typing first. Same bounded-retry shape as
 * `openSelect`/`openDatePicker` above, on the SAME Radix Popover primitive family, guarding against
 * the SAME open-side race — a trigger click landing inside the window a just-closed SIBLING layer
 * (a `Select`, another `SearchSelect`) is still detaching its own outside-pointerdown listener on a
 * deferred passive-effect cleanup. CI run 35095412354 (commit 8d85ad5c, spec 40): the DE case's own
 * `client-currency-select` trigger fires right after the "kind" `Select` (client-upsert.tsx) closes
 * on picking "Government" — a plain, unretried click there never opened the popover, and
 * `[data-cy="client-currency-select-options"]` was never found (4000ms default timeout). The
 * IDENTICAL code passed for the FR/IT/US cases in the very same run — proof this is a timing race,
 * not something specific to DE, hence fixing it here rather than only where it happened to fire that
 * one run.
 * @example cy.openSearchSelect('client-currency-select')
 */
Cypress.Commands.add('openSearchSelect', (dataCy: string) => {
    const triggerSelector = `[data-cy="${dataCy}"] button`;
    const optionsSelector = `[data-cy="${dataCy}-options"]`;
    const OPEN_POLL_MS = 100;
    const OPEN_TIMEOUT_MS = 800;
    const MAX_ATTEMPTS = 3;
    const isOpen = () =>
        cy.get('body', { log: false }).then(($body) => $body.find(`${optionsSelector}:visible`).length > 0);
    const pollForOpen = (elapsedMs: number): Cypress.Chainable<boolean> =>
        isOpen().then((visible) => {
            if (visible || elapsedMs >= OPEN_TIMEOUT_MS) return cy.wrap(visible, { log: false });
            cy.wait(OPEN_POLL_MS, { log: false });
            return pollForOpen(elapsedMs + OPEN_POLL_MS);
        });
    const openWithRetries = (attempt: number): void => {
        cy.get(triggerSelector).first().scrollIntoView().click({ force: true });
        pollForOpen(0).then((opened) => {
            if (opened || attempt >= MAX_ATTEMPTS) {
                if (attempt > 1) {
                    Cypress.log({
                        name: 'openSearchSelect',
                        message: opened
                            ? `option list visible after ${attempt} attempt(s)`
                            : `option list still not visible after ${attempt} attempt(s), giving up retries`,
                    });
                }
                return;
            }
            Cypress.log({ name: 'openSearchSelect', message: `popover did not open on attempt ${attempt} -- retrying` });
            openWithRetries(attempt + 1);
        });
    };
    cy.wait(50);
    openWithRetries(1);
    cy.get(optionsSelector, { timeout: 10000 }).should('be.visible');
});

/**
 * Advances the document CREATE dialog (document-create-dialog.tsx, built on
 * components/ui/stepped-dialog.tsx) from its current step to the next one. `handleContinue` there is
 * ASYNC (`await form.trigger(step.fields)` before it advances) — a bare
 * `cy.get('[data-cy="...-continue"]').click()` races that, which is exactly why every spec that
 * fills a multi-step create dialog goes through here instead of repeating the wait. Captures the
 * CURRENT step body's own `data-cy` (it carries the step id — `...-step-body-details`,
 * `...-step-body-lines`, ...) before clicking, then waits for that attribute to actually change.
 *
 * Retries the CLICK itself (bounded), not just the wait after it — the same open-side race
 * `openSelect`/`openSearchSelect`/`openDatePicker` above guard against: a "Continue" click fired
 * right after a sibling Radix popover (a `SearchSelect`/`Select` field on the step just filled)
 * closes can be swallowed by that popover's own `DismissableLayer`, still detaching its
 * outside-pointerdown listener on a deferred passive-effect cleanup. CI observed this landing the
 * click with no visible effect at all (05-clients.cy.ts's own "creates an individual client",
 * 36-received-invoices.cy.ts's own "Structured deposit with lines" — both type into a field then
 * call this immediately after, no intervening wait) once the global `force: true` override
 * (support/e2e.ts) that used to paper over it was removed.
 * @example cy.continueDocumentWizard()
 */
Cypress.Commands.add('continueDocumentWizard', () => {
    cy.get('[data-cy^="document-create-dialog-step-body-"]')
        .invoke('attr', 'data-cy')
        .then((before) => {
            const POLL_MS = 100;
            const TIMEOUT_MS = 800;
            const MAX_ATTEMPTS = 3;
            const hasAdvanced = () =>
                cy
                    .get('[data-cy^="document-create-dialog-step-body-"]', { log: false })
                    .invoke({ log: false }, 'attr', 'data-cy')
                    .then((current) => current !== before);
            const pollForAdvance = (elapsedMs: number): Cypress.Chainable<boolean> =>
                hasAdvanced().then((advanced) => {
                    if (advanced || elapsedMs >= TIMEOUT_MS) return cy.wrap(advanced, { log: false });
                    cy.wait(POLL_MS, { log: false });
                    return pollForAdvance(elapsedMs + POLL_MS);
                });
            const continueWithRetries = (attempt: number): void => {
                cy.get('[data-cy="document-create-dialog-continue"]').should('be.visible').click();
                pollForAdvance(0).then((advanced) => {
                    if (advanced || attempt >= MAX_ATTEMPTS) return;
                    Cypress.log({
                        name: 'continueDocumentWizard',
                        message: `step did not advance on attempt ${attempt} -- retrying the click`,
                    });
                    continueWithRetries(attempt + 1);
                });
            };
            continueWithRetries(1);
            cy.get('[data-cy^="document-create-dialog-step-body-"]', { timeout: 10000 }).should(($el) => {
                expect($el.attr('data-cy')).not.to.eq(before);
            });
        });
});

/**
 * The generic sibling of `continueDocumentWizard` above for any OTHER `stepped-dialog.tsx` wizard —
 * takes the dialog's own `dataCy` prefix instead of hardcoding "document-create-dialog", so
 * article-upsert.tsx and time-entry-upsert.tsx (and any later 3-step dialog) share this one command
 * rather than each spec re-deriving the same before/after `data-cy` wait. Same bounded click-retry
 * as `continueDocumentWizard` above, for the identical stale-listener race on the SAME underlying
 * `stepped-dialog.tsx` primitive.
 * @example cy.continueSteppedDialog('article-dialog')
 */
Cypress.Commands.add('continueSteppedDialog', (dataCy: string) => {
    cy.get(`[data-cy^="${dataCy}-step-body-"]`)
        .invoke('attr', 'data-cy')
        .then((before) => {
            const POLL_MS = 100;
            const TIMEOUT_MS = 800;
            const MAX_ATTEMPTS = 3;
            const hasAdvanced = () =>
                cy
                    .get(`[data-cy^="${dataCy}-step-body-"]`, { log: false })
                    .invoke({ log: false }, 'attr', 'data-cy')
                    .then((current) => current !== before);
            const pollForAdvance = (elapsedMs: number): Cypress.Chainable<boolean> =>
                hasAdvanced().then((advanced) => {
                    if (advanced || elapsedMs >= TIMEOUT_MS) return cy.wrap(advanced, { log: false });
                    cy.wait(POLL_MS, { log: false });
                    return pollForAdvance(elapsedMs + POLL_MS);
                });
            const continueWithRetries = (attempt: number): void => {
                cy.get(`[data-cy="${dataCy}-continue"]`).should('be.visible').click();
                pollForAdvance(0).then((advanced) => {
                    if (advanced || attempt >= MAX_ATTEMPTS) return;
                    Cypress.log({
                        name: 'continueSteppedDialog',
                        message: `step did not advance on attempt ${attempt} -- retrying the click`,
                    });
                    continueWithRetries(attempt + 1);
                });
            };
            continueWithRetries(1);
            cy.get(`[data-cy^="${dataCy}-step-body-"]`, { timeout: 10000 }).should(($el) => {
                expect($el.attr('data-cy')).not.to.eq(before);
            });
        });
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
 * Confirms the detail page's own lock-confirmation dialog (`document-detail-lock-confirm`,
 * DocumentActionLockConfirmHost in document-form.tsx) IF ONE OPENED — most actions never lock the
 * record (`actionLocksDocument`, action-presentation.ts), so the overwhelming majority of calls find
 * nothing here and move on immediately. `cy.wait(50)`: the SAME short buffer
 * `openDocumentRowMenu` above already needs for a Radix layer's own mount/dismiss timing — a dialog
 * driven by a `setState` inside the very click handler that just ran is normally already in the DOM
 * by the next command, but this closes the one-tick gap seen elsewhere in this file rather than
 * assuming it can never happen here too.
 */
function confirmDetailLockIfPresent(): void {
    const selector = '[data-cy="document-detail-lock-confirm-confirm"]';
    cy.wait(50, { log: false });
    cy.get('body', { log: false }).then(($body) => {
        if ($body.find(selector).length > 0) {
            cy.get(selector).should('be.visible').click();
        }
    });
}

/**
 * Runs one declared action from the detail page, wherever the page put it: the header's primary
 * button when `document-action-<id>` is visible on its own, otherwise the same selector inside the
 * "Actions" menu (opened first). Which one it is depends on the record's status and on whether the
 * form has unsaved edits (action-presentation.ts's `pickPrimaryAction`) — a spec should not have to
 * know, the same way a user does not: the label reads the same in both places. Also transparently
 * confirms the lock-confirmation dialog when the action opens one (see confirmDetailLockIfPresent
 * above) — a spec calling this command for "send" never has to know whether THIS record's country
 * locks it or not, the same way its own user would not either.
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
    confirmDetailLockIfPresent();
});

/**
 * Opens one list row's "more" menu (document-list.tsx's `document-row-menu-<id>`) and waits for its
 * content. Everything a row offers besides its ONE primary button lives in there — the secondary
 * declared actions (`document-row-action-<actionId>-<id>`), the PDF/XML downloads, the share link,
 * the recurrence — the same split the detail page's own "Actions" menu makes.
 * @example cy.openDocumentRowMenu(invoiceId)
 */
Cypress.Commands.add('openDocumentRowMenu', (documentId: string) => {
    const content = `[data-cy="document-row-menu-content-${documentId}"]`;
    cy.get(`[data-cy="document-list-row-${documentId}"]`, { timeout: 15000 }).should('exist');
    // Idempotent: a Radix trigger TOGGLES, so a second call while the menu is already open (a spec
    // that first asserts an entry exists, then clicks it) must not close what the first opened.
    // `data-state="open"`, not `:visible` — a menu that just closed (an entry was clicked) is still
    // in the DOM and visible for its exit animation, with `data-state="closed"`, and treating that
    // as "already open" is what left the next click landing on a menu that was going away.
    // Same open-side race `openDatePicker` above guards against, on the same primitive family: a
    // trigger clicked right after the PREVIOUS Radix layer closed (this very menu, after one of its
    // entries was clicked) can land inside the window where that layer's outside-pointerdown
    // listener is still attached, and the click never opens anything (scenario leg fr-pl, the
    // PDF entry then the XML entry back to back). Short wait, then click-and-verify with bounded
    // retries — a genuine regression still fails loudly on the final assertion below.
    const isOpen = () =>
        cy.get('body', { log: false }).then(($body) => $body.find(`${content}[data-state="open"]`).length > 0);
    const OPEN_POLL_MS = 100;
    const OPEN_TIMEOUT_MS = 800;
    const MAX_ATTEMPTS = 3;
    const pollForOpen = (elapsedMs: number): Cypress.Chainable<boolean> =>
        isOpen().then((open) => {
            if (open || elapsedMs >= OPEN_TIMEOUT_MS) return cy.wrap(open, { log: false });
            cy.wait(OPEN_POLL_MS, { log: false });
            return pollForOpen(elapsedMs + OPEN_POLL_MS);
        });
    const openWithRetries = (attempt: number): void => {
        cy.get(`[data-cy="document-row-menu-${documentId}"]`, { timeout: 15000 }).scrollIntoView().click();
        pollForOpen(0).then((opened) => {
            if (opened || attempt >= MAX_ATTEMPTS) return;
            Cypress.log({ name: 'openDocumentRowMenu', message: `menu did not open on attempt ${attempt} -- retrying` });
            openWithRetries(attempt + 1);
        });
    };
    isOpen().then((alreadyOpen) => {
        if (alreadyOpen) return;
        cy.wait(50, { log: false });
        openWithRetries(1);
    });
    cy.get(content, { timeout: 10000 }).should('be.visible').and('have.attr', 'data-state', 'open');
});

/**
 * Runs one declared action from a LIST row, wherever the row put it: the row's primary button when
 * `document-row-action-<actionId>-<id>` is visible on its own, otherwise the same selector inside
 * the row's "more" menu (opened first). Which one it is depends on the record's status
 * (action-presentation.ts's `pickPrimaryAction`, the same rule the detail page applies) — a spec
 * should not have to know, the same way a user does not: the label reads the same in both places.
 * The row-level twin of `runDocumentAction` above.
 *
 * `force: true` on both clicks — deliberately, not a leftover: this row is a LIVE card, re-rendered
 * by the same list-level polling that updates its own status badge while a document is mid-transit
 * (queue jobs, channel retries). CI hit "the page updated while this command was executing" here
 * twice (31-national-channels.cy.ts's own SdI send, 43-correction-routes.cy.ts's own Poland KOR
 * click) once Cypress's normal actionability wait — retrying visibility/stability for up to the
 * default command timeout — was restored (support/e2e.ts's removed global `force: true` override
 * used to hide this): the LONGER that wait runs, the more likely a background poll repaints the row
 * out from under the captured element reference. `force: true` skips that wait and clicks
 * immediately against the CURRENT DOM instead, which is what a real user's own, much faster click
 * would land on too.
 * Also transparently confirms the row's own lock-confirmation dialog
 * (`document-row-lock-confirm-<id>`, DocumentRowActions in document-list.tsx) when the action opens
 * one — see `confirmDetailLockIfPresent` above for why this never asks the caller whether THIS
 * record's country locks it or not.
 * @example cy.runDocumentRowAction(quoteId, 'send')
 */
Cypress.Commands.add('runDocumentRowAction', (documentId: string, actionId: string) => {
    const selector = `[data-cy="document-row-action-${actionId}-${documentId}"]`;
    cy.get(`[data-cy="document-list-row-${documentId}"]`, { timeout: 15000 }).should('exist');
    cy.get('body').then(($body) => {
        if ($body.find(`${selector}:visible`).length > 0) {
            cy.get(selector).scrollIntoView().click({ force: true });
            return;
        }
        cy.openDocumentRowMenu(documentId);
        cy.get(selector, { timeout: 10000 }).should('be.visible').click({ force: true });
    });
    const lockConfirmSelector = `[data-cy="document-row-lock-confirm-${documentId}-confirm"]`;
    cy.wait(50, { log: false });
    cy.get('body', { log: false }).then(($body) => {
        if ($body.find(lockConfirmSelector).length > 0) {
            cy.get(lockConfirmSelector).should('be.visible').click();
        }
    });
});

// The client dialog (client-upsert.tsx) uses the SAME generic `continueSteppedDialog('client-dialog')`
// above (no dedicated `continueClientWizard` — one dialog-agnostic command for every
// stepped-dialog.tsx wizard, client included, rather than a copy per dialog).

// `cy.ensureClient` used to live here — unused by any spec (every spec that needs a baseline client
// gets one from `resetAndSeed` below), and latently broken for the callers it was written for: a
// non-200 status silently `return`ed ("auth failed, skip") and the follow-up POST ran with
// `failOnStatusCode: false` and no assertion at all, so a session that had gone invalid, or a 500 on
// creation, would let the command return cleanly while leaving no client behind — the failure would
// only surface much later, at whatever screen actually needed one, in a form that gave no hint this
// command was the reason. Removed along with its `index.d.ts` declaration rather than fixed, since
// nothing calls it.

Cypress.on('window:before:load', (window) => {
    // `configurable: true` on both — `Object.defineProperty` defaults to `configurable: false`, and
    // this handler fires on EVERY `window:before:load` (every `cy.visit`, plus `cy.session()`'s own
    // internal re-visits when validating a cached session). A same-origin in-app navigation can reuse
    // the SAME `window`/`navigator` object across two such firings, and redefining an already
    // non-configurable property throws `TypeError: Cannot redefine property` — surfaced only once the
    // suite stopped swallowing every uncaught exception unconditionally (`support/e2e.ts`), where it
    // failed `cy.login()`'s own session setup for literally every spec.
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US'], configurable: true })
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
            // Ignored entirely outside SaaS mode (the ordinary e2e stack — see backend's own
            // `legal-signup-policy.ts`), but required WHEN that flag is set, or this seed sign-up
            // itself gets the very 400 `LEGAL_ACCEPTANCE_REQUIRED` `75-legal-acceptance.cy.ts` tests
            // for. Sending it unconditionally is what keeps every OTHER spec's baseline seed working
            // unchanged in either mode.
            acceptLegal: true,
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
