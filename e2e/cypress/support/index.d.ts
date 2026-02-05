
declare namespace Cypress {
    interface Chainable {
        /**
         * Custom command to log in with default user
         * @example cy.login()
         */
        login(): Chainable<void>

        /**
         * Custom command to log in with specific credentials
         * Used for multi-tenant tests where multiple users need to be tested
         * @example cy.loginAs('user@example.com', 'password123')
         */
        loginAs(email: string, password: string): Chainable<void>

        /**
         * Custom command to switch to a different company (multi-tenant)
         * @example cy.switchCompany('Company Alpha')
         */
        switchCompany(companyName: string): Chainable<void>

        /**
         * Custom command to create an invitation code
         * @example cy.createInvitation().then((code) => { ... })
         */
        createInvitation(): Chainable<string>

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
