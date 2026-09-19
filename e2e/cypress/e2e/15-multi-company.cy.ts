export {}; // makes this spec a module, not a global script -- see tsconfig.json

const api = Cypress.env('apiUrl') || 'http://localhost:4000';
const TEST_PASSWORD = 'Super_Secret_Password123!';

beforeEach(() => {
    cy.login();
});

// Runs last (numeric ordering after 01-14): by this point john.doe@acme.org
// already owns "Acme Corp" (see 01-register.cy.ts / 02-company.cy.ts). These
// tests add a second company via the switcher and always switch back to
// Acme Corp at the end so later re-runs of the earlier specs aren't affected.
describe('Multi-Company Switcher E2E', () => {
    it('shows the current company in the sidebar switcher', () => {
        cy.visit('/dashboard');
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should('contain.text', 'Acme Corp');
    });

    it('creates a second company from the switcher and switches to it', () => {
        cy.visit('/dashboard');
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).click();
        cy.get('[data-cy="sidebar-create-company-item"]').click();

        cy.get('[data-cy="onboarding-dialog"]', { timeout: 10000 }).should('be.visible');

        // Step 1 — country only. The identifier's label and the next step both
        // derive from it; nothing here names a country in the assertions below.
        cy.selectCountry('onboarding-company-country-input', 'France');
        cy.get('[data-cy="onboarding-country-next-btn"]').click();

        // Step 2 — the national identifier. France requires a LEGAL_ID (SIRET) —
        // the wizard refuses to advance without it (same required-fields check as
        // the first company). "Next" also fires the backend company-lookup search
        // before moving on; it always advances regardless of what that finds.
        cy.get('[data-cy="onboarding-legalid-input"]', { timeout: 10000 })
            .clear({ force: true })
            .type('73282932000074', { force: true });
        cy.get('[data-cy="onboarding-identifier-next-btn"]').click();

        // Step 3 — the company form, pre-filled by whatever the search found.
        cy.get('[data-cy="onboarding-company-name-input"]', { timeout: 10000 }).clear().type('Globex Corporation');
        cy.get('[data-cy="onboarding-submit-btn"]').click();
        // Company creation now advances the wizard to the channels step instead of
        // closing the dialog — finish onboarding from there.
        cy.get('[data-cy="onboarding-finish-btn"]', { timeout: 10000 }).should('be.visible').click();
        cy.get('[data-cy="onboarding-dialog"]', { timeout: 20000 }).should('not.exist');
        cy.wait(3000);

        // Creating a company switches the active session to it immediately
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should('contain.text', 'Globex Corporation');
    });

    it('isolates data between companies: Acme\'s clients are not visible from Globex', () => {
        cy.visit('/clients');
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should('contain.text', 'Globex Corporation');
        // Globex is a brand-new company with zero clients — the list must show
        // the empty state, not any of Acme's clients (created by 05-clients.cy.ts).
        // Checking for the literal substring "acme" would also match the logged-in
        // user's own email (john.doe@acme.org), which is unrelated to company data.
        cy.contains(/no clients yet/i, { timeout: 10000 }).should('be.visible');

        // Switch back to Acme Corp and confirm its clients are visible again
        cy.get('[data-cy="sidebar-company-button"]').click();
        cy.get('[data-cy="sidebar-company-switch-item"]').contains('Acme Corp').click();
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should('contain.text', 'Acme Corp');
        cy.visit('/clients');
        cy.contains(/no clients yet/i).should('not.exist');
    });

    it('lists both companies with roles in the switcher', () => {
        cy.visit('/dashboard');
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).click();
        cy.get('[data-cy="sidebar-company-switch-item"]').should('have.length', 2);
        cy.get('[data-cy="sidebar-company-switch-item"]').contains('Acme Corp').should('exist');
        cy.get('[data-cy="sidebar-company-switch-item"]').contains('Globex Corporation').should('exist');

        // Leave Acme Corp active for the rest of the suite
        cy.get('body').type('{esc}');
    });
});

/**
 * "Leave company" — proven through the screen with a real (disposable) SECOND user rather than
 * john.doe@acme.org: leaving is destructive to the caller's OWN membership, and john.doe's Acme
 * Corp/Globex Corporation memberships are load-bearing for every later spec in this suite. Each
 * test invites a fresh account into Acme Corp (john.doe is its OWNER, so no last-owner refusal
 * applies to a plain MEMBER leaving it) and signs it up for real through `/auth/sign-up` — the same
 * form `01-register.cy.ts` exercises, just with an invitation code this time.
 */
describe('Leave Company', () => {
    /** John Doe's own Acme Corp id, read off his session rather than hard-coded — his own suite
     *  above already re-selects it as the active company before this describe block runs, but
     *  re-asserting here (like `79-danger-zone.cy.ts`'s own `companyBId` checks) keeps this spec
     *  honest about not depending on execution order. */
    function acmeCorpId(): Cypress.Chainable<string> {
        return cy.request({ url: `${api}/api/auth/get-session` }).then((res) => {
            const companies = res.body.companies as { id: string; name: string }[];
            const acme = companies.find((c) => c.name === 'Acme Corp');
            expect(acme, 'Acme Corp is one of john.doe\'s companies').to.exist;
            const acmeId = (acme as { id: string }).id;
            if (res.body.activeCompanyId !== acmeId) {
                cy.request({ method: 'POST', url: `${api}/api/companies/switch`, body: { companyId: acmeId } });
            }
            return acmeId;
        });
    }

    /** Mints a MEMBER invitation for the ACTIVE company (must be Acme Corp, John's own) and signs a
     *  brand-new account up with it through the real form — never a raw `useInvitation` call, since
     *  that only ever runs from better-auth's OWN sign-up hook (see `invitations.controller.ts`'s
     *  own routes: nothing on that controller lets an EXISTING user consume a code for a second
     *  company — signing up fresh is the only door this product actually offers). Ends on
     *  `/auth/sign-in`, matching `sign-up.tsx`'s own post-submit navigation. */
    function signUpMemberOfAcme(email: string) {
        cy.request({ method: 'POST', url: `${api}/api/invitations`, body: { role: 'MEMBER' } })
            .its('body.code')
            .then((code: string) => {
                cy.visit('/auth/sign-up');
                cy.get('[data-cy="auth-firstname-input"]', { timeout: 10000 }).type('Léa');
                cy.get('[data-cy="auth-lastname-input"]').type('Membre');
                cy.get('[data-cy="auth-email-input"]').type(email);
                cy.get('[data-cy="auth-password-input"]').type(TEST_PASSWORD);
                cy.get('[data-cy="auth-invitation-code-input"]').type(code);
                cy.get('[data-cy="auth-submit-btn"]').click();
                cy.url({ timeout: 20000 }).should('include', '/auth/sign-in');
            });
    }

    function loginAs(email: string) {
        cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type(email);
        cy.get('[data-cy="auth-password-input"]').type(TEST_PASSWORD);
        cy.get('[data-cy="auth-submit-btn"]').click();
        cy.url({ timeout: 20000 }).should('include', '/dashboard');
    }

    it('member of two companies leaves the ACTIVE one and lands on the dashboard of the other', () => {
        const email = `leave-two-${Date.now()}@example.com`;

        acmeCorpId().then((acmeId) => {
            signUpMemberOfAcme(email);
            loginAs(email);

            // A second company of this user's OWN, created via the exact same self-service door
            // `companies.controller.ts#create` documents ("open to any authenticated user"). Never
            // switched into explicitly (`onboarding.tsx` does that itself after a UI-driven create,
            // see this file's own comment on `createCompany` never touching the session) — a FRESH
            // login's `activeCompanyId` is still unset, so it stays resolved to Acme Corp (the
            // OLDER of the two memberships) until this test's own "Leave company" click below.
            cy.request({
                method: 'POST',
                url: `${api}/api/companies`,
                body: {
                    name: 'Léa Solo Co',
                    description: 'A fictional solo company',
                    phone: '+33123456789',
                    email: 'contact@lea-solo.example',
                    address: '1 Solo Street',
                    city: 'Paris',
                    postalCode: '75001',
                    country: 'France',
                    countryCode: 'FR',
                    currency: 'EUR',
                    identifiers: [{ scheme: 'LEGAL_ID', value: '73282932000074' }],
                },
                failOnStatusCode: false,
            })
                .its('status')
                .should('be.oneOf', [200, 201]);

            // Precondition, asserted before the action under test: two companies, Acme Corp active.
            cy.request({ url: `${api}/api/auth/get-session` }).then((res) => {
                const companies = res.body.companies as { id: string; name: string }[];
                expect(companies, 'now a member of two companies').to.have.length(2);
                expect(res.body.activeCompanyId, 'Acme Corp is still the active one').to.eq(acmeId);
            });

            cy.visit('/account/danger');
            cy.get('[data-cy="account-leave-company-card"]', { timeout: 15000 }).should(
                'contain.text',
                'Acme Corp',
            );
            cy.get('[data-cy="account-leave-company-button"]').click();
            cy.get('[data-cy="account-leave-company-confirm"]', { timeout: 10000 })
                .should('be.visible')
                .click();

            cy.url({ timeout: 20000 }).should('include', '/dashboard');
            // The screen switched to whatever company is active now — the same regression
            // `79-danger-zone.cy.ts`'s own "Delete company" screen assertion proves for the sibling
            // "company gone" path.
            cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should(
                'contain.text',
                'Léa Solo Co',
            );

            // Verified by the API: Acme Corp is gone from this user's session, "Léa Solo Co" (the
            // other company) is now active.
            cy.request({ url: `${api}/api/auth/get-session` })
                .its('body')
                .then((session: { companies: { id: string; name: string }[]; activeCompanyId: string }) => {
                    expect(session.companies.map((c) => c.name), 'Acme Corp left').to.not.include('Acme Corp');
                    expect(session.companies, 'exactly the one remaining company').to.have.length(1);
                    expect(session.companies[0].name).to.eq('Léa Solo Co');
                    expect(session.activeCompanyId).to.eq(session.companies[0].id);
                });
        });
    });

    it("a plain MEMBER of a single company leaves it and the create-company dialog opens", () => {
        const email = `leave-solo-${Date.now()}@example.com`;

        acmeCorpId().then(() => {
            signUpMemberOfAcme(email);
            loginAs(email);

            cy.visit('/account/danger');
            // No sole-owner refusal possible here: this account is a plain MEMBER of its one and
            // only company, never an OWNER.
            cy.get('[data-cy="account-leave-company-button"]', { timeout: 15000 }).click();
            cy.get('[data-cy="account-leave-company-confirm"]', { timeout: 10000 })
                .should('be.visible')
                .click();

            cy.url({ timeout: 20000 }).should('include', '/dashboard');
            // Zero companies left — the exact case Sidebar's own onboarding effect auto-opens for
            // (`sidebar.tsx`, `!companiesLoading && companies.length === 0`).
            cy.get('[data-cy="onboarding-dialog"]', { timeout: 15000 }).should('be.visible');

            cy.request({ url: `${api}/api/auth/get-session` })
                .its('body.companies')
                .should('have.length', 0);
        });
    });
});
