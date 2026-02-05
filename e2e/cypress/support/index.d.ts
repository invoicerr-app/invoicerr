
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
         * Custom command to get the last email
         * @example cy.getLastEmail()
         */
        getLastEmail(): Chainable<any>

        /**
         * Custom command to clear all emails
         * @example cy.clearEmails()
         */
        clearEmails(): Chainable<any>
    }
}
