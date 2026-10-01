export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #581: a "Validate" action that assigns an invoice's legal number and locks it, WITHOUT
 * sending it. Modeled on 81-invoice-send-lock-confirmation.cy.ts (the generic lock-confirmation
 * dialog, reused unchanged here) and 31-national-channels.cy.ts (the PDP channel, connected with
 * fake credentials, "send_failed" naming the channel as proof a real attempt genuinely happened).
 *
 * The owner's decision (2026-10-01, issue #581): "Validating assigns the number and locks the
 * invoice. For a French domestic B2B invoice, validating also issues it through the accredited
 * platform, as the law requires; in every other case, sending by email stays a separate action."
 * `cy.resetAndSeed()`'s own baseline company (France) and client (France, COMPANY - see
 * support/commands.ts) are ALREADY a domestic B2B pair; what switches a given invoice between the
 * two branches below is only its own `issueDate`, against the PDP mandate's 2026-09-01 threshold
 * (`transports/channel-policy/data/fr.json`) - same convention 31/81 already use.
 *
 * Four facts, in the order the shared seed/company state below actually allows proving them:
 *  1. with NO transport configured at all, Validate on a mandated (on/after 2026-09-01) invoice is
 *     refused EXACTLY the way "send" would be - the mandate is never silently bypassed by taking
 *     "Validate" instead of "Send" (acceptance criterion: "the PDP mandate stays enforced... never
 *     bypassed by Validate").
 *  2. with an EMAIL transport configured, Validate on a NON-mandated (before 2026-09-01) invoice
 *     only numbers and locks it - the warning dialog appears first, naming both the lock AND the
 *     number it is about to assign; no email is sent; "Send" stays available afterward and, once
 *     run, delivers without ever re-assigning the number Validate already took.
 *  3. an already-validated invoice can never be re-validated.
 *  4. once the PDP channel is actually connected (fake credentials, closed port - same FAKE_PDP
 *     shape as 31), Validate on a mandated invoice genuinely ATTEMPTS the real transmission: it
 *     numbers the record and reaches "send_failed", the error naming the PDP channel - never a
 *     silent "validated" that pretends the legal platform was never required.
 */
const api = Cypress.env("apiUrl");

/** Port 1 (tcpmux): never open on a normal dev/CI machine - immediate ECONNREFUSED, no real
 *  platform behind these credentials. Identical to 31-national-channels.cy.ts's own FAKE_PDP. */
const FAKE_PDP = {
	baseUrl: "http://127.0.0.1:1",
	clientId: "e2e-fake-client-id",
	clientSecret: "e2e-fake-client-secret",
};

// INVOICE-2026-0001 - the year is never hardcoded: it comes from the backend's own clock, not a
// date picked for the test. Same convention as 22-document-numbering.cy.ts's own regex.
const DEFAULT_INVOICE_DISPLAY_NUMBER = (n: number) =>
	new RegExp(`^INVOICE-\\d{4}-${String(n).padStart(4, "0")}$`);

function invoiceData(clientId: string, issueDate: string) {
	return {
		client: clientId,
		issueDate,
		dueDate: "2026-10-31",
		currency: "EUR",
		lines: [{ description: "Conseil", quantity: 1, unit: "unit", unitPrice: 500, vatRate: "20" }],
	};
}

function createDraftInvoice(issueDate: string): Cypress.Chainable<string> {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: { data: invoiceData(clients[0].id, issueDate) },
					failOnStatusCode: false,
				})
				.then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id as string;
					expect(id, "le brouillon a un identifiant").to.be.a("string");
					expect(saved.body?.document?.number, "un brouillon n'a pas de numéro").to.be.null;
					return id;
				});
		});
}

describe("Invoice Validate (issue #581) - numbers and locks without sending, except where a country channel mandate requires the real send", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("blocks at the mandate, exactly like Send would, when NO transport is configured - a domestic B2B invoice issued on/after 2026-09-01 is never silently validated past CGI art. 289 bis I by taking Validate instead of Send", () => {
		createDraftInvoice("2026-09-15").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.openDocument(invoiceId);

			// "Validate" is declared AFTER "send" (invoice.descriptor.ts's own header on why), so it is
			// a SECONDARY action here - reached through the "Actions" menu, same as the issue's own
			// screenshot description ("Menu Actions avant/apres (ajout de Valider)"), never a second
			// top-level button. `cy.runDocumentAction` finds it wherever it is and auto-confirms the
			// warning dialog that opens first - purely status-driven, it has no opinion on transport
			// readiness, so it still appears before the backend's own mandate check ever runs.
			cy.runDocumentAction("validate");

			// The real POST fails - surfaced as a toast naming the mandated "pdp" channel, the exact
			// same refusal backend's own invoice-channel-mandate.spec.ts/invoice-validate.spec.ts pin
			// for "send", now proven through a real click on "Validate" instead.
			cy.get("[data-sonner-toast]", { timeout: 15000 }).should("contain.text", "pdp");

			// Never persisted: still "draft", no number ever spent on a refused attempt.
			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, "toujours draft après un Valider refusé").to.eq("draft");
					expect(doc.number, "aucun numéro dépensé sur un refus").to.be.null;
				});
		});
	});

	it('a draft invoice can be Validated: numbered, locked, no transmission - the warning names the lock AND the number it is about to assign; "Send" stays available afterward and never re-assigns the number', () => {
		// An email transport, so the LATER "Send" step in this same test can actually complete -
		// irrelevant to Validate itself (this invoice's own issueDate keeps it outside the PDP
		// mandate, so Validate never even looks at the company's transport).
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
		});

		cy.clearEmails();

		createDraftInvoice("2026-08-30").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.openDocument(invoiceId);

			cy.intercept("POST", `${api}/api/documents/types/invoice/actions/validate`).as("validateInvoice");

			// "Validate" is declared AFTER "send" (invoice.descriptor.ts's own header), so for a draft
			// invoice it is a SECONDARY action, reached through the "Actions" menu, exactly what the
			// issue's own screenshot description shows ("Menu Actions avant/apres (ajout de Valider)"),
			// never a second top-level button next to "Send".
			cy.openDocumentActionsMenu();
			cy.get('[data-cy="document-action-validate"]', { timeout: 15000 })
				.should("exist")
				.click();

			cy.get('[data-cy="document-detail-lock-confirm"]', { timeout: 10000 })
				.should("be.visible")
				.and("contain.text", "lock this document")
				// Proves the frontend's own `onEnterStatuses` fix (action-presentation.ts): "validate"
				// is correctly read as a numbering transition even though `numbering.onEnterStatus` is
				// now a SET (["sending", "validated"]), not the single string this dialog's copy used
				// to compare against.
				.and("contain.text", "assign its legal number");
			cy.get("@validateInvoice.all").should("have.length", 0);

			// Cancel first - the negative proof, read from the API: nothing happened.
			cy.get('[data-cy="document-detail-lock-confirm-cancel"]').click();
			cy.get('[data-cy="document-detail-lock-confirm"]').should("not.exist");
			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body.status")
				.should("eq", "draft");

			// Same click again (menu re-opened: Radix closes it on select), Confirm this time.
			cy.openDocumentActionsMenu();
			cy.get('[data-cy="document-action-validate"]').click();
			cy.get('[data-cy="document-detail-lock-confirm"]', { timeout: 10000 }).should("be.visible");
			cy.get('[data-cy="document-detail-lock-confirm-confirm"]').click();
			cy.wait("@validateInvoice").its("response.statusCode").should("be.oneOf", [200, 201]);

			// `document-form-number` - the DETAIL page's own number display (document-detail.tsx); the
			// list row's `document-number-<id>` (22-document-numbering.cy.ts's own selector) is a
			// different element this spec never visits after confirming.
			cy.get('[data-cy="document-form-number"]', { timeout: 15000 })
				.invoke("text")
				.should("match", DEFAULT_INVOICE_DISPLAY_NUMBER(1));
			cy.get('[data-cy="document-status-badge"]').should("contain.text", "Validated");

			let validatedNumber: number;
			let validatedDisplayNumber: string;
			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, "la facture est réellement validated en base").to.eq("validated");
					expect(doc.number, "un numéro a bien été attribué").to.be.a("number");
					expect(doc.displayNumber).to.match(DEFAULT_INVOICE_DISPLAY_NUMBER(1));
					validatedNumber = doc.number;
					validatedDisplayNumber = doc.displayNumber;
				});

			// No email, no transmission - the one guarantee this whole action exists for. A direct
			// Mailpit read, never `cy.getLastEmail()` (that helper POLLS for up to ~10s and then
			// HARD-FAILS if nothing arrives - built for "assert a mail DID come", the opposite of what
			// this line needs to prove).
			cy.request({ url: `${Cypress.env("mailpitUrl")}/api/v1/messages` })
				.its("body.messages")
				.should("have.length", 0);

			// "record-payment" stays refused (only offered once genuinely "sent"/"imported") - proof
			// a validated-but-unsent invoice is NOT conflated with a sent one anywhere on screen.
			cy.get('[data-cy="document-action-record-payment"]').should("not.exist");

			// "Send" is still offered, and NEVER opens a second lock-confirmation - the record is
			// already locked, so nothing NEW locks by sending it.
			cy.get('[data-cy="document-action-send"]', { timeout: 15000 })
				.should("exist")
				.and("not.be.disabled")
				.click();
			cy.get('[data-cy="document-detail-lock-confirm"]').should("not.exist");

			cy.get('[data-cy="document-status-badge"]', { timeout: 20000 }).should("contain.text", "Sent");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, "réellement sent en base, cette fois").to.eq("sent");
					// THE load-bearing proof for this whole scenario: sending an already-validated
					// invoice never re-assigns its number.
					expect(doc.number, "jamais re-numéroté par Envoyer").to.eq(validatedNumber);
					expect(doc.displayNumber).to.eq(validatedDisplayNumber);
				});

			// Sending it afterward DOES mail it - proving "no email" above was really about Validate,
			// never a broken mail pipeline that would have made both assertions pass for the wrong
			// reason. `cy.getLastEmail()` itself hard-fails if nothing arrives.
			cy.getLastEmail();
		});
	});

	it("a validated-but-unsent invoice can never be re-validated", () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string }[]) => {
				const data = invoiceData(clients[0].id, "2026-08-29");

				createDraftInvoice("2026-08-29").then((invoiceId) => {
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/validate`,
						body: { documentId: invoiceId, data },
						failOnStatusCode: false,
					}).then((res) => {
						expect(res.status, "première validation acceptée").to.be.oneOf([200, 201]);
					});

					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body.status")
						.should("eq", "validated");

					cy.visit("/documents/invoice");
					cy.openDocument(invoiceId);

					// The descriptor's own `VALIDATE_TRANSITIONS` only ever starts from "draft" -
					// "validate" is therefore not even offered any more, by construction, never merely
					// disabled. Opened first: a Radix dropdown's content is not even mounted while
					// closed, so checking "not.exist" without opening it first would prove nothing.
					cy.openDocumentActionsMenu();
					cy.get('[data-cy="document-action-validate"]').should("not.exist");

					// A scripted client retrying the same call is refused server-side too, never only
					// hidden on screen.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/validate`,
						body: { documentId: invoiceId, data },
						failOnStatusCode: false,
					}).then((res) => {
						expect(res.status, "une seconde validation est refusée").to.be.oneOf([400, 409]);
					});
				});
			});
	});

	it('France domestic B2B, PDP connected (fake credentials): Validate genuinely ATTEMPTS the real transmission - numbers the invoice, reaches "send_failed" naming the PDP channel, never a silent "validated"', () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-nav-pdp"]', { timeout: 15000 }).should("exist").click();
		cy.get('[data-cy="operator-superpdp-connect-button"]', { timeout: 10000 }).should("exist").click();
		cy.get('[data-cy="channel-pdp-baseurl-input"]', { timeout: 10000 }).clear().type(FAKE_PDP.baseUrl);
		cy.get('[data-cy="channel-pdp-clientid-input"]').clear().type(FAKE_PDP.clientId);
		cy.get('[data-cy="channel-pdp-clientsecret-input"]').clear().type(FAKE_PDP.clientSecret);
		cy.get('[data-cy="channel-pdp-connect-button"]').click();
		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Channel connected");

		cy.intercept("GET", `${api}/api/documents/transports`).as("transports");
		cy.visit("/settings/company");
		cy.wait("@transports", { timeout: 15000 });
		cy.get('[data-cy="company-invoice-transport-select"]', { timeout: 15000 }).should("exist");
		cy.openSelect(
			'[data-cy="company-invoice-transport-select"]',
			'[data-cy="company-invoice-transport-option-pdp"]',
		);
		cy.intercept("POST", `${api}/api/company/info`).as("saveCompany");
		cy.get('[data-cy="company-submit-btn"]').click();
		cy.wait("@saveCompany", { timeout: 15000 }).its("response.statusCode").should("be.oneOf", [200, 201]);

		createDraftInvoice("2026-09-20").then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			cy.runDocumentRowAction(invoiceId, "validate");

			// Same budget as 31-national-channels.cy.ts's own "sends an invoice via PDP" test, for the
			// identical reason: three real connect attempts to a closed local port, ~10-13s each.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 90000 })
				.find('[data-cy="document-status-badge"]', { timeout: 90000 })
				.should("contain.text", "Send failed");
			cy.get(`[data-cy="document-row-last-error-${invoiceId}"]`).should("contain.text", "PDP");

			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					// NEVER left "validated" while pretending the legal platform requirement was
					// honored: the real attempt genuinely happened and genuinely failed.
					expect(doc.status, "réellement send_failed, jamais validated silencieusement").to.eq(
						"send_failed",
					);
					expect(doc.lastActionError, "l'erreur nomme le canal PDP").to.match(/PDP/);
					// But it WAS numbered - Validate's own mandated branch runs the exact same phase-1
					// numbering "send" itself would, before the (failed) delivery attempt.
					expect(doc.number, "numérotée malgré l'échec de transmission").to.be.a("number");
					expect(doc.transportRef, "aucune référence sans dépôt réel").to.not.be.a("string");
				});
		});
	});
});
