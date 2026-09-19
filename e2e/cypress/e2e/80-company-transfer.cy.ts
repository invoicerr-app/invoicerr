export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Company ownership transfer (product decision 2026-09-17) — OWNER A (john.doe@acme.org, "Acme
 * Corp") transfers ownership to B, driven through both screens: A's own danger-zone section
 * (`transfer-company.section.tsx`) to initiate, B's `/account/transfers` to accept. Every claim about
 * what actually changed is read back through the API, never the screen alone — same split
 * `79-danger-zone.cy.ts` already uses.
 *
 * Two scenarios:
 *  1. B already has an account — A sees the SAME generic message the ghost-email case below also
 *     gets, B sees the request and accepts it, and the API then proves B is OWNER and A is ADMIN.
 *  2. A targets an email with NO account at all — identical screen outcome, but nothing is created
 *     (no pending transfer for the company, no mail sent to a ghost inbox).
 */
const api = Cypress.env('apiUrl') || 'http://localhost:4000';

const OWNER_A_EMAIL = 'john.doe@acme.org';
const OWNER_B_EMAIL = 'jane.roe@example.org';
const OWNER_B_PASSWORD = 'Super_Secret_Password123!';

/** A second, independently-cached session — `cy.login()` (support/commands.ts) always signs in as
 *  john.doe@acme.org under the fixed `'user-session'` key; this uses B's own key so switching between
 *  A and B mid-spec never replays the wrong cookie. */
function loginAsOwnerB() {
    cy.session(['user-session', OWNER_B_EMAIL], () => {
        cy.visit('/auth/sign-in');
        cy.get('[data-cy="auth-email-input"]').type(OWNER_B_EMAIL);
        cy.get('[data-cy="auth-password-input"]').type(OWNER_B_PASSWORD);
        cy.get('[data-cy="auth-submit-btn"]').click();
        cy.url({ timeout: 20000 }).should('include', '/dashboard');
        cy.getCookie('better-auth.session_token').should('exist');
    }, {
        validate: () => {
            cy.getCookie('better-auth.session_token').should('exist');
        },
    });
}

/** Reads the danger-zone OTP straight off the mailpit inbox — same helper `79-danger-zone.cy.ts`
 *  already uses (its own message shape: "...is: 12345678"). */
function extractOtpDigits(message: { Text?: string; HTML?: string }): string {
    const body = message.Text || message.HTML || '';
    const match = body.match(/is: (\d{8})/);
    expect(match, 'the OTP e-mail carries an 8-digit code').to.not.be.null;
    return (match as RegExpMatchArray)[1];
}

/** Fills the transfer form, requests a real OTP, reads it back from mailpit, types it, and clicks
 *  confirm — stops right after the click so each test reads the outcome (a toast, the API) itself. */
function initiateTransferThroughScreen(toEmail: string) {
    cy.visit('/settings/danger');
    cy.clearEmails();
    cy.get('[data-cy="transfer-company-email-input"]', { timeout: 15000 })
        .should('be.visible')
        .clear()
        .type(toEmail);
    cy.get('[data-cy="transfer-company-start-button"]').should('not.be.disabled').click();

    cy.get('[data-cy="transfer-company-otp-input"]', { timeout: 10000 }).should('be.visible');
    cy.getLastEmail().then((message) => {
        const otp = extractOtpDigits(message);
        cy.get('[data-cy="transfer-company-otp-input"]').type(otp);
    });
    cy.get('[data-cy="transfer-company-otp-confirm"]').should('not.be.disabled').click();
}

const GENERIC_MESSAGE = 'If an account exists for this address, a transfer request has been sent to it.';

describe('Company ownership transfer ⇄ — initiate through A\'s screen, accept through B\'s', () => {
    let acmeCorpId: string;
    let transferId: string;

    before(() => {
        cy.resetAndSeed();

        // Read A's own company BEFORE signing B up: `cy.request` shares the browser's cookie jar, and
        // better-auth's sign-up response sets a fresh session cookie for whoever it just created —
        // signing B up here would silently swap the jar from A's session to B's, and the read below
        // would then fail as B (no active company yet) instead of succeeding as A.
        cy.request({ url: `${api}/api/company/info` }).its('body.id').then((id) => {
            acmeCorpId = id as string;
        });

        // B's account must ALREADY exist before A ever types their email — the whole point of the
        // anti-enumeration check this spec proves. Seeded via the API, like every other setup step
        // (`resetAndSeed`'s own convention) — the UI sign-up form is not what this spec is about.
        cy.request({
            method: 'POST',
            url: `${api}/api/auth/sign-up/email`,
            body: {
                name: 'Jane Roe',
                firstname: 'Jane',
                lastname: 'Roe',
                email: OWNER_B_EMAIL,
                password: OWNER_B_PASSWORD,
                acceptLegal: true,
            },
            failOnStatusCode: false,
        })
            .its('status')
            .should('be.oneOf', [200, 201]);
    });

    beforeEach(() => {
        cy.login(); // back to A before every test — `cy.session` makes this a cheap no-op re-check.
    });

    it('A initiates a transfer to B (an existing account) and sees the generic, anti-enumeration message', () => {
        initiateTransferThroughScreen(OWNER_B_EMAIL);

        cy.contains(GENERIC_MESSAGE, { timeout: 10000 }).should('be.visible');
        // The dialog closed and the screen now shows the pending card, not the form — the real,
        // observable proof (for THIS caller, the OWNER of their own company) that a row was created.
        cy.get('[data-cy="transfer-company-pending"]', { timeout: 10000 }).should('contain.text', OWNER_B_EMAIL);

        cy.request({ url: `${api}/api/companies/transfer` }).then((res) => {
            expect(res.body, 'a PENDING transfer now exists for Acme Corp').to.not.be.null;
            expect(res.body.status).to.eq('PENDING');
            expect(res.body.toEmail).to.eq(OWNER_B_EMAIL);
            transferId = res.body.id as string;
        });
    });

    it('B sees the request at /account/transfers and accepts it', () => {
        loginAsOwnerB();
        cy.visit('/account/transfers');

        cy.get('[data-cy="account-transfers-pending-card"]', { timeout: 15000 }).should('contain.text', 'Acme Corp');
        cy.contains('[data-cy^="account-transfer-accept-"]', 'Accept').click();
        cy.get('[data-cy="account-transfer-confirm-confirm"]', { timeout: 10000 }).click();

        cy.contains('You are now the owner of "Acme Corp"', { timeout: 10000 }).should('be.visible');
    });

    it('proves, through the API, that B is now OWNER and A is now ADMIN of Acme Corp', () => {
        loginAsOwnerB();
        // Explicit switch rather than trusting B's default `activeCompanyId` — the accept flow
        // deliberately does not auto-switch the recipient's active company (product decision: it
        // becomes visible in their own switcher, nothing silently changes what they were looking at).
        cy.request({
            method: 'POST',
            url: `${api}/api/companies/switch`,
            body: { companyId: acmeCorpId },
        }).its('status').should('be.oneOf', [200, 201]);

        cy.request({ url: `${api}/api/companies/members` })
            .its('body')
            .then((members: { email: string; role: string }[]) => {
                const b = members.find((m) => m.email === OWNER_B_EMAIL);
                const a = members.find((m) => m.email === OWNER_A_EMAIL);
                expect(b, 'B is a member of Acme Corp').to.exist;
                expect((b as { role: string }).role, 'B is now OWNER').to.eq('OWNER');
                expect(a, 'A is still a member of Acme Corp').to.exist;
                expect((a as { role: string }).role, 'A stepped down to ADMIN').to.eq('ADMIN');
            });

        // The finished transfer itself reads back ACCEPTED, never left dangling as PENDING.
        cy.request({ url: `${api}/api/account/transfers` })
            .its('body')
            .then((transfers: { id: string; status: string }[]) => {
                const mine = transfers.find((t) => t.id === transferId);
                expect(mine?.status).to.eq('ACCEPTED');
            });
    });

    it('B, now the owner, targets an email with no account — the same message, but nothing is created', () => {
        // A stepped down to ADMIN in the previous test — `TransferController` is `@Roles(OWNER)`, so A
        // could no longer reach this form at all; B is the one who can, on the SAME company (still
        // switched to Acme Corp from the previous test's own explicit switch).
        loginAsOwnerB();
        const ghostEmail = `nobody-${Date.now()}@example.org`;

        initiateTransferThroughScreen(ghostEmail);

        cy.contains(GENERIC_MESSAGE, { timeout: 10000 }).should('be.visible');

        // No pending row for the company — the form is what's still showing, not a pending card
        // naming an email nobody owns.
        cy.get('[data-cy="transfer-company-email-input"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-cy="transfer-company-pending"]').should('not.exist');
        // `null` leaves the wire as a zero-length body (Nest/Express's own `res.send(null)`, not the
        // JSON text "null") — `cy.request` surfaces that as `''`, not the JS value `null`, so
        // chai's `not.ok` (falsy) is what actually matches either shape rather than asserting on one
        // transport accident.
        cy.request({ url: `${api}/api/companies/transfer` })
            .its('body')
            .should('not.be.ok');
    });
});
