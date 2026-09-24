
declare namespace Cypress {
    interface Chainable {
        /**
         * Custom command to log in
         * @example cy.login()
         */
        login(): Chainable<void>

        /**
         * Truncate, then rebuild the baseline world (user john.doe + company Acme Corp) via the API.
         * Runs before every spec; see the implementation for why one reset for seventeen specs was
         * producing order-dependent failures.
         */
        resetAndSeed(): Chainable<void>

        /**
         * Custom command to get the last email
         * @example cy.getLastEmail()
         */
        getLastEmail(): Chainable<any>

        /**
         * Custom command to clear all emails
         * @example cy.clearEmails()
         */
        clearEmails(): Chainable<any>

        /**
         * Polls GET `url` (a document instance endpoint) until its `status` is one of
         * `targetStatuses`, or ~10s elapse — item 22 (files d'attente) made "send" asynchronous, so a
         * single-shot `cy.request` can observe an intermediate "sending" that never re-resolves under
         * `.its().should()` (which re-reads the SAME response, never re-fires the request). Fails the
         * test with the actually-observed status once the retry budget is exhausted.
         * @example cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ['sent', 'send_failed'])
         */
        waitForDocumentStatus(url: string, targetStatuses: string[]): Chainable<any>

        /**
         * Custom command to pick a country from a CountrySelect component
         * @example cy.selectCountry('client-country-select', 'France')
         */
        selectCountry(dataCy: string, countryName: string): Chainable<void>

        /**
         * Opens a saved document's own page from the list currently on screen (the row's title
         * link), and waits for the page and its form to be mounted. Replaces the old
         * "click the edit button, wait for the edit dialog" pair everywhere.
         * @example cy.openDocument(invoiceId)
         */
        openDocument(documentId: string): Chainable<void>

        /**
         * Opens the detail page's "Actions" menu and waits for its content to be visible.
         * @example cy.openDocumentActionsMenu()
         */
        openDocumentActionsMenu(): Chainable<void>

        /**
         * Clicks one declared action on the detail page — the header's primary button when that is
         * where the page put it, otherwise the same entry inside the "Actions" menu.
         * @example cy.runDocumentAction('record-payment')
         */
        runDocumentAction(actionId: string): Chainable<void>

        /**
         * Opens one list row's "more" menu (`document-row-menu-<id>`) and waits for its content.
         * @example cy.openDocumentRowMenu(invoiceId)
         */
        openDocumentRowMenu(documentId: string): Chainable<void>

        /**
         * Clicks one declared action on a LIST row — the row's primary button when that is where
         * the row put it, otherwise the same entry inside the row's "more" menu.
         * @example cy.runDocumentRowAction(quoteId, 'send')
         */
        runDocumentRowAction(documentId: string, actionId: string): Chainable<void>

        /**
         * Picks "today" on a `DatePicker` via its own "Today" footer button (never a computed
         * `[data-day="M/D/YYYY"]` selector — see the implementation for the CI races that caused).
         * Scrolls the trigger into view, clicks it, waits for the "Today" button, clicks it, then
         * asserts the popover has actually closed.
         * @example cy.pickToday('[data-cy="document-field-issueDate-input"]')
         */
        pickToday(triggerSelector: string): Chainable<void>

        /**
         * Opens a `DatePicker` popover and waits for it to have actually mounted, retrying the
         * trigger click (bounded) if it didn't. Factored out of `pickToday` for callers that need the
         * popover open for something other than its "Today" button (e.g. the month-navigation
         * buttons) — see the implementation for the open-side CI race this guards against.
         * @example cy.openDatePicker('[data-cy="document-field-firstOccurrenceAt-input"]')
         */
        openDatePicker(triggerSelector: string): Chainable<void>

        /**
         * Picks an explicit date through a `DatePicker`'s month/year dropdowns
         * (`captionLayout="dropdown"`) — the only practical way to reach a date a year or more
         * away, unlike `.rdp-button_previous`/`_next` clicks. See the implementation for why the
         * year is selected before the month.
         * @example cy.pickDate('[data-cy="document-field-dueDate-input"]', '2027-03-15')
         */
        pickDate(triggerSelector: string, iso: string): Chainable<void>

        /**
         * Opens a Radix `Select` trigger and clicks one of its options, retrying the trigger click
         * (bounded) if the option never becomes visible — for a trigger that sits right after a
         * "more" menu closes, the same open-side race `openDatePicker` guards against on the
         * `DatePicker` popover.
         * @example cy.openSelect('[data-cy="document-field-cadence-input"] button', '[data-cy="document-field-cadence-input-option-yearly"]')
         */
        openSelect(triggerSelector: string, optionSelector: string): Chainable<void>

        /**
         * Waits for a Radix layer that was just dismissed (a "more" menu whose entry was clicked, a
         * `SearchSelect` whose option was picked) to have FINISHED tearing down, before another
         * layer is opened on top of it: its content gone from the DOM, and the deferred focus
         * restore its own `FocusScope` schedules on unmount already landed on the element named by
         * `settledFocusSelector`. Opening a popover before that restore fires is what silently
         * closes it again — see the implementation for the traced sequence.
         * @example cy.waitForLayerTeardown('[data-cy="document-row-menu-content-abc"]', '[data-cy="document-field-cadence-input"] button')
         */
        waitForLayerTeardown(contentSelector: string, settledFocusSelector: string): Chainable<void>

        /**
         * Opens a `SearchSelect` (components/search-input.tsx) popover WITHOUT picking an option —
         * for callers that type a filter into it afterward (CurrencySelect and friends) instead of
         * clicking a fixed entry. Same bounded-retry open-side guard as `openSelect`/`openDatePicker`
         * above, on the same Radix Popover primitive family.
         * @example cy.openSearchSelect('client-currency-select')
         */
        openSearchSelect(dataCy: string): Chainable<void>

        /**
         * Advances the document CREATE dialog (`document-create-dialog.tsx`, a
         * `components/ui/stepped-dialog.tsx` wizard: Details -> Lines -> Options -> Summary, a step
         * dropped when it has nothing to show) from its CURRENT step to the next one — waits for the
         * "Continue" button, clicks it, then waits for the step's own body to actually change
         * (`document-create-dialog-step-body-*`'s `data-cy` includes the new step's id), so a spec
         * never races `handleContinue`'s own `await form.trigger(...)` the way a bare
         * `cy.get(...).click()` would.
         * @example cy.continueDocumentWizard()
         */
        continueDocumentWizard(): Chainable<void>

        /**
         * The generic sibling of `continueDocumentWizard` for any OTHER `components/ui/stepped-dialog.tsx`
         * wizard (article-upsert.tsx, time-entry-upsert.tsx, ...) — takes the dialog's own `dataCy`
         * prefix (the same string passed to `<SteppedDialog dataCy="...">`) since those aren't hardcoded
         * to "document-create-dialog". Same "wait for the step body's own data-cy to actually change"
         * guard against `handleContinue`'s async `form.trigger(...)`.
         * @example cy.continueSteppedDialog('article-dialog')
         */
        continueSteppedDialog(dataCy: string): Chainable<void>
    }
}
