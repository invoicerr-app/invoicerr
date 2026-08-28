
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
