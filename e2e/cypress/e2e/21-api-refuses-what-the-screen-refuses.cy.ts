/**
 * The guard the interface respects, and the API used to ignore.
 *
 * Spec 19 drives the buttons, deliberately. This one does the opposite, just as deliberately: the
 * subject under test IS the scripted client. `available-actions` computed `correct` from the
 * assembled lifecycle graph and the screen obeyed it, while `POST /:id/correct` accepted anything —
 * so a script, a stale tab or a retry could correct a document the country's lifecycle lets nobody
 * correct. A guard only the front honours is not a guard, and only an HTTP call can prove it.
 *
 * The last test is what stops this from being vacuous: an endpoint that always refuses would satisfy
 * every assertion above it. So the same call, on a document that HAS reached a correctable state,
 * must succeed.
 */
import { api, send, setupCountry, waitForSettled } from "../support/showcase";

type Actions = {
	status: string;
	actions: Record<string, boolean>;
};

const actionsOf = (id: string) =>
	cy
		.request<Actions>({ url: `${api}/api/invoices/${id}/available-actions` })
		.its("body");

const tryCorrect = (id: string) =>
	cy.request({
		method: "POST",
		url: `${api}/api/invoices/${id}/correct`,
		body: {},
		failOnStatusCode: false,
	});

/** A French draft — created, not issued. */
const aFrenchDraft = () =>
	setupCountry("Guard FR", "France", "FR", [
		{ scheme: "LEGAL_ID", value: "73282932000074" },
		{ scheme: "VAT", value: "FR44732829320" },
	]).then((ids) =>
		cy
			.request({
				method: "POST",
				url: `${api}/api/invoices`,
				body: {
					clientId: ids.clientId,
					currency: "EUR",
					notes: "",
					discountRate: 0,
					items: [
						{
							name: "Consulting",
							description: "",
							quantity: 1,
							unitPrice: 1000,
							vatRate: 20,
							type: "SERVICE",
							order: 0,
						},
					],
				},
			})
			.then((res) => {
				expect(res.status, "draft created").to.be.oneOf([200, 201]);
				return cy.wrap(res.body.id as string);
			}),
	);

describe("A scripted client cannot go where the screen will not", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("01 a DRAFT is not correctable, and the endpoint agrees with available-actions", () => {
		aFrenchDraft().then((id) => {
			actionsOf(id).then((a) => {
				expect(
					a.actions.correct,
					"the screen offers no correction on a draft",
				).to.eq(false);

				tryCorrect(id).then((res) => {
					// Refused, not "accepted with a message". A 200 carrying a refusal is how a retry
					// loop ends up believing it succeeded.
					expect(
						res.status,
						`the endpoint refused too — it answered ${JSON.stringify(res.body).slice(0, 200)}`,
					).to.be.within(400, 499);
				});
			});
		});
	});

	it("02 ISSUED but never sent is not correctable either — the two answers still agree", () => {
		aFrenchDraft().then((id) => {
			cy.request({
				method: "POST",
				url: `${api}/api/invoices/${id}/issue`,
			}).then((iss) => {
				expect(iss.status, "issued").to.be.oneOf([200, 201]);

				actionsOf(id).then((a) => {
					// A correction is a NEW document referencing one the other side holds. Nothing has
					// left yet, so there is nothing to correct — and that is the lifecycle talking, not
					// a hard-coded status list.
					expect(
						a.actions.correct,
						`the screen, at compliance status ${a.status}`,
					).to.eq(false);

					tryCorrect(id).then((res) => {
						expect(
							res.status,
							`and the endpoint — ${JSON.stringify(res.body).slice(0, 200)}`,
						).to.be.within(400, 499);
					});
				});
			});
		});
	});

	it("03 once delivered, the very same call succeeds — the guard is a guard, not a wall", () => {
		aFrenchDraft().then((id) => {
			cy.request({
				method: "POST",
				url: `${api}/api/invoices/${id}/issue`,
			}).then((iss) => {
				expect(iss.status, "issued").to.be.oneOf([200, 201]);
				send(id).then((res) => {
					expect(
						res.status,
						`send responded — ${JSON.stringify(res.body).slice(0, 200)}`,
					).to.be.oneOf([200, 201]);
				});
				waitForSettled(id);

				actionsOf(id).then((a) => {
					expect(
						a.actions.correct,
						`the screen now offers it at ${a.status}`,
					).to.eq(true);

					tryCorrect(id).then((res) => {
						expect(
							res.status,
							`and the endpoint accepts — ${JSON.stringify(res.body).slice(0, 200)}`,
						).to.be.oneOf([200, 201]);
						// Born a draft, as spec 19 asserts through the interface. Same fact, other door.
						expect(
							res.body.status,
							"and it is a draft the user still has to finish",
						).to.eq("DRAFT");
					});
				});
			});
		});
	});
});
