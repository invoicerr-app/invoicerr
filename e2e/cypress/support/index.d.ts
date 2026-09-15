
declare namespace Cypress {
    interface Chainable {
        /**
         * Custom command to log in
         * @example cy.login()
         */
        login(): Chainable<void>

        /**
         * Custom command to reset the database
         * @example cy.resetDatabase()
         */
        resetDatabase(): Chainable<void>

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
         * Custom command to ensure a test client exists (creates one via API if none found)
         * @example cy.ensureClient()
         */
        ensureClient(): Chainable<void>

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
    }
}
