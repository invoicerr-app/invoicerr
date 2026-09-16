export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * `Settings > Seats` — the seat-positions/over-capacity model: who sits at which numbered desk, the
 * `NO_FREE_SEAT` invitation refusal, and moving a member once a bought seat frees one up. Driven by
 * the real UI (actions par l'écran, assertions par l'API), in SaaS mode only — the same
 * `saasMode`-detect-and-adapt shape `75-legal-acceptance.cy.ts` already uses, for the same reason:
 * this e2e stack, like every other spec here, normally runs with no
 * `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` set, so `/api/billing/*` (and this whole tab) does not
 * exist at all on the ordinary CI stack.
 *
 * Seat QUANTITY is never pushed to Polar by this app (`backend/src/modules/billing/seat-sync.ts`'s
 * own header) — it only
 * ever reads what Polar says (a `subscription.*` webhook, or `seat-reconcile.ts`'s own SDK read).
 * `cy.task('setCompanySubscriptionSeats', ...)` stands in for that read, the same "write the row a
 * real event would otherwise set" shape `setStaleLegalAcceptance` already holds for `LegalAcceptance`.
 *
 * One finding worth recording (established by curling this exact flow against a throwaway SaaS-mode
 * backend, 2026-09-16, before trusting it in this spec): a `NO_FREE_SEAT` refusal happens from
 * better-auth's `user.create.AFTER` hook — the account row is already committed by the time it fires,
 * so the new user CAN sign in afterward; what actually rolled back is the invitation itself (still
 * unused) and the company membership (never created). The refused email is deliberately NOT asserted
 * unable to sign in here — see the "still unused" assertion below for the real, verified behavior.
 */
const api = Cypress.env('apiUrl') || 'http://localhost:4000';
const PASSWORD = 'Super_Secret_Password123!';
const OWNER_EMAIL = 'john.doe@acme.org';

function fillSignupForm({
	firstname,
	lastname,
	email,
	code,
	saasMode,
}: {
	firstname: string;
	lastname: string;
	email: string;
	code?: string;
	saasMode: boolean;
}) {
	cy.visit('/auth/sign-up');
	if (code) {
		cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).should('be.visible').type(code);
	}
	cy.get('[data-cy="auth-firstname-input"]', { timeout: 10000 }).should('be.visible').type(firstname);
	cy.get('[data-cy="auth-lastname-input"]').type(lastname);
	cy.get('[data-cy="auth-email-input"]').type(email);
	cy.get('[data-cy="auth-password-input"]').type(PASSWORD);
	if (saasMode) {
		cy.get('[data-cy="auth-accept-legal-checkbox"]').click();
	}
	cy.get('[data-cy="auth-submit-btn"]').click();
}

/** Same helper `03-auth.cy.ts` uses — a real button click, so the code consumed by a later sign-up is
 *  the actual redeemable string, never the truncated preview the table shows. */
function createInvitationCodeViaUI(): Cypress.Chainable<string> {
	cy.intercept('POST', '**/api/invitations').as('createSeatsInvitation');
	cy.visit('/settings/invitations');
	cy.wait(1000);
	cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
	return cy.wait('@createSeatsInvitation').its('response.body.code');
}

describe('Settings > Seats', () => {
	let saasMode = false;

	before(() => {
		cy.resetAndSeed();
		cy.login();
		cy.request({ url: `${api}/api/billing/status`, failOnStatusCode: false }).then((response) => {
			saasMode = response.status === 200;
			cy.log(`this instance's saasMode: ${saasMode}`);
		});
	});

	it('is hidden from the Settings nav outside SaaS mode', function () {
		if (saasMode) this.skip();
		cy.login();
		cy.visit('/settings');
		cy.get('aside', { timeout: 15000 }).should('exist').and('not.contain.text', 'Seats');
	});

	describe('SaaS mode', () => {
		const MEMBER_EMAIL = `seats-member-${Date.now()}@acme.org`;
		const REFUSED_EMAIL = `seats-refused-${Date.now()}@acme.org`;

		it('the OWNER alone sits at desk 1 on a brand-new company', function () {
			if (!saasMode) this.skip();

			cy.login();
			cy.visit('/settings/seats');
			cy.get('[data-cy="seats-view-office"]', { timeout: 15000 }).click();
			cy.get('[data-cy="seats-desks-summary"]').should('contain.text', '1 of 1');
			cy.get('[data-cy="seat-desk-1-occupied"]', { timeout: 10000 }).should('contain.text', 'John');
		});

		it('invites and seats a second member once a second seat is bought', function () {
			if (!saasMode) this.skip();

			// The company's own bought quantity, as a real `subscription.updated` webhook (or
			// `seat-reconcile.ts`'s own SDK read) would set it — see this file's own header. Set
			// BEFORE the invitation is accepted: the company starts on the TRIAL default of ONE seat,
			// already held by the OWNER, so accepting first would itself be the NO_FREE_SEAT case the
			// next test covers on purpose.
			cy.task('setCompanySubscriptionSeats', { email: OWNER_EMAIL, seats: 2 });

			cy.login();
			createInvitationCodeViaUI().then((code) => {
				cy.clearCookies();
				fillSignupForm({
					firstname: 'Mia',
					lastname: 'Member',
					email: MEMBER_EMAIL,
					code: code as string,
					saasMode,
				});
				cy.url({ timeout: 20000 }).should('include', '/auth/sign-in');
			});

			cy.login();
			cy.visit('/settings/seats');
			cy.get('[data-cy="seats-desks-summary"]', { timeout: 15000 }).should('contain.text', '2 of 2');
			cy.get('[data-cy="seats-view-list"]').click();
			cy.contains('[data-cy^="seats-list-row-"]', 'Mia Member', { timeout: 10000 }).should(
				'contain.text',
				'Seated',
			);
		});

		it('refuses a third invitation once the company has no free seat, named NO_FREE_SEAT — the invitation stays unused', function () {
			if (!saasMode) this.skip();

			cy.login();
			createInvitationCodeViaUI().then((code) => {
				cy.clearCookies();
				fillSignupForm({
					firstname: 'Zoe',
					lastname: 'Refused',
					email: REFUSED_EMAIL,
					code: code as string,
					saasMode,
				});
				// The refusal surfaces as a toast (better-auth's own `result.error.message`, this
				// app's exact `NoFreeSeatError` text) — never a silent success screen.
				cy.get('[data-sonner-toast]', { timeout: 15000 }).should('contain.text', 'no free seat');

				cy.login();
				cy.visit('/settings/invitations');
				// Proven by curling this exact flow (this file's own header): the account itself CAN
				// get created by better-auth before the membership hook refuses — what must NEVER
				// happen is the invitation being burned for nothing. Still "Active", never "Used".
				cy.contains('[data-cy^="invitation-row-"]', (code as string).substring(0, 8), {
					timeout: 10000,
				}).should('contain.text', 'Active');
			});
		});

		it('moves a member to a free desk once a third seat is bought', function () {
			if (!saasMode) this.skip();

			cy.task('setCompanySubscriptionSeats', { email: OWNER_EMAIL, seats: 3 });

			cy.login();
			cy.visit('/settings/seats');
			cy.get('[data-cy="seats-view-list"]', { timeout: 15000 }).click();
			cy.get('[data-cy="seats-desks-summary"]').should('contain.text', '2 of 3');

			cy.contains('[data-cy^="seats-list-row-"]', 'Mia Member').within(() => {
				cy.get('[data-cy^="seats-move-select-"]').click();
			});
			cy.get('[role="option"]').contains('Desk 3').click();
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should('contain.text', 'updated');
			cy.contains('[data-cy^="seats-list-row-"]', 'Mia Member', { timeout: 10000 }).should(
				'contain.text',
				'3',
			);

			cy.request(`${api}/api/billing/seats`).then((response) => {
				const moved = (response.body.members as Array<{ email: string; seatIndex: number }>).find(
					(m) => m.email === MEMBER_EMAIL,
				);
				expect(moved, 'moved member is still seated, not waiting').to.exist;
				expect(moved!.seatIndex).to.eq(3);
			});
		});
	});
});
