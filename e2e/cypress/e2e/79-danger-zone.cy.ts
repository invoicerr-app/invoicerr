export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Danger zone — "Reset company data" vs "Delete company", proven through the screen.
 *
 * Setup (seeding a document, a client, a second company) goes through the API — the same split
 * `34-document-archive.cy.ts` already uses: only the ACTION under test (requesting the OTP, typing
 * it, confirming) is a real click through `danger.settings.tsx`; every assertion that matters reads
 * the backend back, never the screen alone as proof of what changed in the database.
 *
 * Three scenarios, chained in one company lifecycle for the last two (create → seed data → reset →
 * delete), mirroring how an owner would actually use these two actions in sequence:
 *  1. Acme Corp (the seeded FR company) has a real, ARCHIVED invoice — "Reset company data" must be
 *     refused, visibly, BEFORE any OTP is even requested.
 *  2. A brand-new company, with no archived document at all, resets cleanly: its client and its
 *     document are gone afterward, while the company itself and its membership survive.
 *  3. That same (now emptied) company is deleted entirely: afterward this user can no longer switch
 *     into it at all — the company, and this user's own membership on it, are genuinely gone.
 */
const api = Cypress.env('apiUrl') || 'http://localhost:4000';

function createInvoiceDraftFor(clientId: string) {
    return cy
        .request({
            method: 'POST',
            url: `${api}/api/documents/types/invoice/actions/save-draft`,
            body: {
                data: {
                    client: clientId,
                    issueDate: '2026-08-31',
                    dueDate: '2026-09-30',
                    currency: 'EUR',
                    lines: [{ description: 'Conseil', quantity: 1, unit: 'hour', unitPrice: 100, vatRate: '20' }],
                },
            },
            failOnStatusCode: false,
        })
        .then((saved) => {
            expect(saved.status, 'brouillon de facture créé').to.be.oneOf([200, 201]);
            return saved.body?.document as { id: string; data: Record<string, unknown> };
        });
}

/** Reads the OTP straight off the email mailpit received (`{{count}}-digit code, "is: 12345678"` —
 *  see `danger.service.ts#requestOtp`'s own message) — never guessed, never read off the screen: the
 *  screen's own `formatOtp` inserts the dash as the user types, so typing the RAW 8 digits here is
 *  exactly what a real user does with the code from their inbox. */
function extractOtpDigits(message: { Text?: string; HTML?: string }): string {
    const body = message.Text || message.HTML || '';
    const match = body.match(/is: (\d{8})/);
    expect(match, 'the OTP e-mail carries an 8-digit code').to.not.be.null;
    return (match as RegExpMatchArray)[1];
}

/** Requests the OTP through the real button, reads it back from mailpit, and types both the code and
 *  the confirmation keyword into the dialog — stops just short of the final "Confirm" click so each
 *  test can assert on the STILL-OPEN dialog first when it needs to. */
function openDangerDialogAndFillForm(buttonCy: string, keyword: string) {
    cy.clearEmails();
    // The two danger-zone cards sit below "Transfer ownership" in a scrollable settings pane — off
    // the fold at the 1000×660 default viewport, which Cypress's own visibility check (unlike a
    // plain page-scroll) treats as genuinely clipped by the scrollable ancestor's `overflow`.
    cy.get(`[data-cy="${buttonCy}"]`, { timeout: 10000 })
        .scrollIntoView()
        .should('be.visible')
        .and('not.be.disabled')
        .click();
    cy.get('[data-cy="danger-otp-input"]', { timeout: 10000 }).should('be.visible');
    cy.getLastEmail().then((message) => {
        const otp = extractOtpDigits(message);
        cy.get('[data-cy="danger-otp-input"]').type(otp);
    });
    cy.get('[data-cy="danger-confirm-input"]').clear({ force: true }).type(keyword, { force: true });
}

describe('Danger zone ⚠ — reset company data vs delete company, through the screen', () => {
    // Set by the second test, read by the third — a plain module-level variable (never a `cy.as()`
    // alias, which Cypress clears between tests), the same convention `21-document-lifecycle.cy.ts`'s
    // own `let quoteId` already holds for chaining state across `it` blocks in one spec.
    let companyBId: string;

    before(() => {
        cy.resetAndSeed();
    });

    beforeEach(() => {
        cy.login();
    });

    it('refuses "Reset company data" for Acme Corp while its sent invoice is still under legal FR retention', () => {
        // The simplest transport to make succeed in CI (same choice 34-document-archive.cy.ts makes).
        cy.request({
            method: 'POST',
            url: `${api}/api/company/info`,
            body: { invoiceTransportId: 'email' },
            failOnStatusCode: false,
        }).its('status').should('be.oneOf', [200, 201]);

        cy.request({ url: `${api}/api/documents/references/client/search` })
            .its('body')
            .then((clients: { id: string }[]) => {
                expect(clients, 'le jeu d\'essai contient un client').to.have.length.greaterThan(0);
                return createInvoiceDraftFor(clients[0].id);
            })
            .then((invoice) => {
                // "send" re-validates the FULL document `data` against the descriptor's required
                // fields (`documents.service.ts`'s own `runAction` never merges a partial body onto
                // the stored draft) — echoing back what `save-draft` just returned is what every other
                // API-driven send in this suite does (e.g. 20-document-totals.cy.ts), never `{}`.
                cy.request({
                    method: 'POST',
                    url: `${api}/api/documents/types/invoice/actions/send`,
                    body: { documentId: invoice.id, data: invoice.data },
                    failOnStatusCode: false,
                }).its('status').should('be.oneOf', [200, 201]);

                // "send" is asynchronous (item 22 — queues); archiving runs INLINE with the same
                // phase-2 delivery that flips the document to "sent" (`archive-on-send.ts`), so
                // polling the document's own status until it reaches "sent" is what 34-document-
                // archive.cy.ts already relies on before reading the archive list back.
                cy.waitForDocumentStatus(`${api}/api/documents/${invoice.id}?typeId=invoice`, ['sent']);
                cy.request({ url: `${api}/api/documents/${invoice.id}/archives?typeId=invoice` })
                    .its('body')
                    .should('have.length.greaterThan', 0);
            });

        // The tab's own `value` is "danger" (`-[tab].tsx#TAB_GROUPS`) — an unrecognized segment
        // falls back to the "company" tab silently rather than 404ing, which is exactly what made
        // this URL look plausible while actually rendering company settings.
        cy.visit('/settings/danger');

        cy.get('[data-cy="danger-reset-company-data-button"]', { timeout: 15000 }).should('be.disabled');
        // Below the fold of the settings pane's own scroll container (see `openDangerDialogAndFillForm`'s
        // own comment) — `scrollIntoView()` first, or the visibility check reads it as clipped.
        cy.get('[data-cy="danger-retention-blocked-alert"]', { timeout: 15000 })
            .scrollIntoView()
            .should('be.visible')
            .and('contain.text', '1');
    });

    it('resets a brand-new company\'s data through the screen — its client and document are gone, the company and its membership survive', () => {
        cy.request({
            method: 'POST',
            url: `${api}/api/companies`,
            body: {
                name: 'Globex Corporation',
                description: 'A fictional company',
                phone: '+33123456789',
                email: 'contact@globex.example',
                address: '1 Globex Plaza',
                city: 'Paris',
                postalCode: '75001',
                country: 'France',
                countryCode: 'FR',
                currency: 'EUR',
                identifiers: [{ scheme: 'LEGAL_ID', value: '73282932000074' }],
            },
            failOnStatusCode: false,
        })
            .then((res) => {
                expect(res.status, 'la seconde société est créée').to.be.oneOf([200, 201]);
                companyBId = res.body.id as string;
                return cy.request({
                    method: 'POST',
                    url: `${api}/api/companies/switch`,
                    body: { companyId: companyBId },
                    failOnStatusCode: false,
                });
            })
            .its('status')
            .should('be.oneOf', [200, 201]);

        cy.request({
            method: 'POST',
            url: `${api}/api/clients`,
            body: {
                name: 'Globex Client',
                contactEmail: 'client@globex.example',
                currency: 'EUR',
                country: 'FR',
                address: '2 Globex Plaza',
                city: 'Paris',
                postalCode: '75001',
                isActive: true,
                type: 'COMPANY',
            },
            failOnStatusCode: false,
        }).then((res) => {
            expect(res.status, 'un client existe pour la société B').to.be.oneOf([200, 201]);
            createInvoiceDraftFor(res.body.id as string);
        });

        // The tab's own `value` is "danger" (`-[tab].tsx#TAB_GROUPS`) — an unrecognized segment
        // falls back to the "company" tab silently rather than 404ing, which is exactly what made
        // this URL look plausible while actually rendering company settings.
        cy.visit('/settings/danger');

        // The preflight (no OTP involved) reports what will be deleted — a fresh company under NO
        // retention at all, so the button must be enabled and show the counts just seeded.
        cy.get('[data-cy="danger-reset-company-data-button"]', { timeout: 15000 }).should('not.be.disabled');
        cy.get('[data-cy="danger-reset-counts"]', { timeout: 15000 }).scrollIntoView().should('be.visible');
        cy.get('[data-cy="danger-retention-blocked-alert"]').should('not.exist');

        openDangerDialogAndFillForm('danger-reset-company-data-button', 'RESET');
        cy.get('[data-cy="danger-modal-confirm"]').should('not.be.disabled').click();

        cy.url({ timeout: 20000 }).should('include', '/dashboard');

        // The active company is still B (this action never switches it) — reading these back proves
        // the DATABASE is empty, never merely that the screen stopped rendering rows.
        cy.request({ url: `${api}/api/clients` })
            .its('body.clients')
            .should('have.length', 0);
        cy.request({ url: `${api}/api/documents?typeId=invoice` })
            .its('body.total')
            .should('eq', 0);
        // The company itself, and this user's own membership on it, survive — "reset", not "delete":
        // the company keeps answering for its own info, and still lists an OWNER.
        cy.request({ url: `${api}/api/company/info` }).then((res) => {
            expect(res.status, 'la société B répond toujours').to.eq(200);
            expect(res.body.id, 'toujours la société B, jamais recréée').to.eq(companyBId);
            expect(res.body.name).to.eq('Globex Corporation');
        });
        cy.request({ url: `${api}/api/companies/members` })
            .its('body')
            .should('have.length.greaterThan', 0);
    });

    it('deletes that same (now emptied) company through the screen — afterward this user can no longer reach it at all', () => {
        // Still active from the previous test (chained deliberately, like 15-multi-company.cy.ts's own
        // suite) — re-assert it here so this test does not silently depend on execution order.
        cy.request({ url: `${api}/api/company/info` }).its('body.id').should('eq', companyBId);

        // The tab's own `value` is "danger" (`-[tab].tsx#TAB_GROUPS`) — an unrecognized segment
        // falls back to the "company" tab silently rather than 404ing, which is exactly what made
        // this URL look plausible while actually rendering company settings.
        cy.visit('/settings/danger');
        openDangerDialogAndFillForm('danger-delete-company-button', 'Globex Corporation');
        cy.get('[data-cy="danger-modal-confirm"]').should('not.be.disabled').click();

        cy.url({ timeout: 20000 }).should('include', '/dashboard');

        // The SCREEN itself must have switched, not merely the URL — a stale company switcher still
        // reading "Globex Corporation" here, while the API/session below already fell back to Acme
        // Corp, is exactly the bug a soft SPA navigate used to leave behind: every company-scoped
        // query stayed cached under the just-deleted company, never invalidated, until a manual
        // refresh. A real page load is what this asserts actually happened.
        cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).should('contain.text', 'Acme Corp');

        // No `GET /companies/:id` exists on this API to 404 against directly — the real, checkable
        // fact a caller who once belonged to this company can observe is that switching INTO it is
        // refused (403, "not a member") now that both the Company row and this user's own UserCompany
        // row are gone (`billing/deletion.ts#deleteCompanyPermanentlyNow`, cascade).
        cy.request({
            method: 'POST',
            url: `${api}/api/companies/switch`,
            body: { companyId: companyBId },
            failOnStatusCode: false,
        })
            .its('status')
            .should('eq', 403);

        // The session itself no longer lists it either, and fell back to the one remaining company
        // (Acme Corp) — the exact fallback `backend/src/lib/auth.ts`'s own `customSession` plugin
        // performs.
        cy.request({ url: `${api}/api/auth/get-session` })
            .its('body')
            .then((session: { companies: { id: string; name: string }[]; activeCompanyId: string }) => {
                expect(session.companies.map((c) => c.id), 'la société B a disparu de la session').to.not.include(
                    companyBId,
                );
                expect(session.companies.map((c) => c.name)).to.include('Acme Corp');
            });
    });
});
