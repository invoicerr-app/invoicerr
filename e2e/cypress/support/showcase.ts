/**
 * Shared machinery for the country showcase, used by two specs that differ only in what the stack
 * believes the date to be:
 *
 *   e2e/18-compliance-showcase.cy.ts     the real clock — France before its mandate
 *   e2e/mandate/showcase.cy.ts           the clock moved past 2026-09-01
 *
 * Both drive the real stack. Setup goes through the API rather than the onboarding dialog because
 * fifteen companies through a wizard would take longer than the rest of the suite combined.
 */
export const api = Cypress.env("apiUrl") || "http://localhost:4000";

export type Ids = { companyId: string; clientId: string };

/** Create a company in `country`, switch the session to it, and give it one domestic client. */
export function setupCountry(
	name: string,
	country: string,
	countryCode: string,
	identifiers: { scheme: string; value: string }[],
): Cypress.Chainable<Ids> {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/companies`,
			body: {
				name,
				description: `${countryCode} showcase`,
				phone: "+33123456789",
				email: `contact.${countryCode.toLowerCase()}@example.org`,
				address: "1 Main St",
				city: "City",
				postalCode: "00000",
				country,
				countryCode,
				currency: "EUR",
				identifiers,
			},
		})
		.then((res) => {
			expect(res.status, `company ${countryCode} created`).to.be.oneOf([
				200, 201,
			]);
			const companyId = res.body.id;
			return cy
				.request({
					method: "POST",
					url: `${api}/api/companies/switch`,
					body: { companyId },
				})
				.then(() =>
					cy.request({
						method: "POST",
						url: `${api}/api/clients`,
						body: {
							name: `${countryCode} Client`,
							contactEmail: `client.${countryCode.toLowerCase()}@example.org`,
							currency: "EUR",
							country: countryCode,
							address: "2 Main St",
							city: "City",
							postalCode: "00000",
							isActive: true,
							type: "COMPANY",
						},
					}),
				)
				.then((c) => {
					expect(c.status, `client ${countryCode} created`).to.be.oneOf([
						200, 201,
					]);
					return cy.wrap({ companyId, clientId: c.body.id } as Ids);
				});
		});
}

/** A one-line invoice, issued. Fails loudly rather than screenshotting a draft by accident. */
export function issuedInvoice(
	ids: Ids,
	vatRate = 20,
): Cypress.Chainable<string> {
	return cy
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
						vatRate,
						type: "SERVICE",
						order: 0,
					},
				],
			},
		})
		.then((res) => {
			expect(res.status, "draft created").to.be.oneOf([200, 201]);
			const id = res.body.id;
			return cy
				.request({
					method: "POST",
					url: `${api}/api/invoices/${id}/issue`,
					failOnStatusCode: false,
				})
				.then((iss) => {
					expect(
						iss.status,
						`invoice issued (${JSON.stringify(iss.body).slice(0, 200)})`,
					).to.be.oneOf([200, 201]);
					return cy.wrap(id as string);
				});
		});
}

/**
 * Push the document to a state where correction is offered.
 *
 * Correction is not an edit — it is a NEW document referencing the original — so the lifecycle only
 * opens it from DELIVERED / ACCEPTED / REPORTED. A freshly issued invoice is none of those.
 */
export function send(id: string) {
	// `{ id }`, not `{ invoiceId }`: the controller reads `@Body('id')` (invoices.controller.ts).
	// With the old key the parameter arrived `undefined`, the lookup found no invoice, and
	// `failOnStatusCode: false` swallowed the answer — so every caller of this helper believed it had
	// sent a document it had never sent. Spec 18's "restored once sending got the document to
	// DELIVERED" was written against that silence.
	return cy.request({
		method: "POST",
		url: `${api}/api/invoices/send`,
		body: { id },
		failOnStatusCode: false,
	});
}

/**
 * Wait for transmission to SETTLE before looking at the screen.
 *
 * `send` enqueues a BullMQ job; the outcome lands milliseconds or seconds later. Opening the dialog
 * straight afterwards is a race, and it reads as a flake: the same country shows "awaiting delivery
 * confirmation" on a fast machine and "never reached the authority" on a slow one. A full-suite run
 * caught exactly that on Poland after fourteen green ones.
 *
 * So poll the contract until the document stops moving, and say what it settled on if it never
 * does — a timeout that names the last status is debuggable; a four-second assertion is not.
 */
export function waitForSettled(
	id: string,
	attempts = 20,
): Cypress.Chainable<string> {
	const PENDING = [
		"PENDING",
		"SUBMITTED",
		"IN_PROGRESS",
		"QUEUED",
		null,
		undefined,
	];
	const poll = (
		left: number,
		last: string | null,
	): Cypress.Chainable<string> => {
		if (left === 0) {
			throw new Error(
				`transmission never settled; last compliance status was ${last}`,
			);
		}
		return cy
			.request({
				url: `${api}/api/invoices/${id}/available-actions`,
				failOnStatusCode: false,
			})
			.then((res) => {
				const status = res.body?.complianceStatus ?? null;
				if (!PENDING.includes(status)) return cy.wrap(status as string);
				return cy.wait(500).then(() => poll(left - 1, status));
			});
	};
	return poll(attempts, null);
}

/** Open the invoice detail dialog and wait for the compliance payload to have landed. */
export function openInvoice() {
	cy.visit("/invoices");
	cy.get('[data-cy="invoice-name"]', { timeout: 20000 }).first().click();
	cy.get('[role="dialog"]', { timeout: 10000 }).should("be.visible");
	cy.wait(1200);
}

/**
 * Bring the compliance panels into frame before capturing.
 *
 * They sit at the bottom of a scrollable dialog, so a viewport screenshot taken without this shows
 * the invoice header and none of the panel the case is about. The first run of this spec produced
 * exactly that — green assertions and a screenshot of the wrong half of the screen, because the
 * assertions used `exist` rather than `visible`.
 */
export function revealPanels() {
	cy.get('[data-cy="compliance-panels"]').scrollIntoView({
		offset: { top: -80, left: 0 },
	});
	cy.wait(300);
}

export function shot(name: string) {
	cy.screenshot(name, { capture: "viewport", overwrite: true });
}

/** A 0 % line, entered through the form, so the zero-rate controls can be shown. */
export function draftZeroRateLine(rate: string) {
	cy.contains("button", /add|new|créer|ajouter/i, { timeout: 15000 }).click();
	cy.get('[data-cy="invoice-dialog"]', { timeout: 10000 }).should("be.visible");
	cy.get('[data-cy="invoice-client-select"] button').first().click();
	cy.get('[data-cy="invoice-client-select-options"] button').first().click();
	cy.contains("button", /Add Item|Ajouter/i).click();
	cy.get('[name="items.0.name"]').type("Exempt service", { force: true });
	cy.get('[name="items.0.quantity"]')
		.clear({ force: true })
		.type("1", { force: true });
	cy.get('[name="items.0.unitPrice"]')
		.clear({ force: true })
		.type("500", { force: true });
	cy.get('[name="items.0.vatRate"]')
		.clear({ force: true })
		.type(rate, { force: true });
}
