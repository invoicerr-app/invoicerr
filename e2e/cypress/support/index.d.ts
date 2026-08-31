
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
    }
}
