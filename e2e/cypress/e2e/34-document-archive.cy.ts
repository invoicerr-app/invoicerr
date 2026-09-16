export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Legal archiving — proven THROUGH THE SCREEN,
 * the same discipline as 28/33: the send goes through a real click on "Send", the ASSERTIONS that
 * matter read back the API (never the screen as proof of what's in the database), and the verify
 * genuinely RE-HASHES the bytes stored server-side — never a client-cached verdict.
 *
 * The seed company (cy.resetAndSeed()) is French (Acme Corp, countryCode FR) — exactly the case
 * where the legal retention has a sourced fact: max(tax 6 years LPF L102 B, commercial 10 years
 * C. com. L123-22) = 10 years, see backend/src/modules/documents/archive/retention/data/fr.json.
 * An invoice is sent by email (the simplest transport to make succeed in CI): the only artifact
 * actually delivered is the PDF — signed if it was — never a structured format invented for a
 * transport that doesn't produce one.
 *
 * Regressions covered: 28 (the asynchronous send keeps working once
 * archiving is wired in after "sent" — never a send broken by this addition).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface DocumentArchive {
	id: string;
	contentHash: string;
	archivedAt: string;
	retentionUntil: string | null;
	retentionBasis: string | null;
}

function createInvoiceDraft() {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-31",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{ description: "Conseil", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" },
							],
						},
					},
					failOnStatusCode: false,
				})
				.then((saved) => {
					expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id as string;
					expect(id, "le brouillon a un identifiant").to.be.a("string");
					return id;
				});
		});
}

describe('Legal archiving ⚖ — hash, date, verification and FR retention, proven through the screen', () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it('an invoice sent by email shows its archive on screen (hash, date), and "verify" answers intact', () => {
		cy.clearEmails();

		// The simplest transport to make succeed in CI — see this file's own header.
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport configuré").to.be.oneOf([200, 201]);
		});

		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/documents/invoice");
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 15000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Draft");

			// A real click — never a direct call to the action, which would bypass the screen.
			cy.runDocumentRowAction(invoiceId, "send");

			// The displayed status reaches "Sent" via the frontend's own polling (the same mechanism
			// as 28) — the invoice has no "send" param at all (the transport reads the client, not a
			// typed field), so there's no params dialog to go through here.
			cy.get(`[data-cy="document-list-row-${invoiceId}"]`, { timeout: 20000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Sent");

			// The assertion that matters reads the API, never the screen as proof of what's in the
			// database — the same discipline as 28.
			cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
				.its("body")
				.then((doc) => {
					expect(doc.status, "la facture est réellement \"sent\" en base").to.eq("sent");
				});

			cy.getLastEmail().then((message: any) => {
				expect(message.To?.[0]?.Address, "le message va au client du seed").to.eq(
					"test.client@example.com",
				);
				expect(message.Attachments, "le PDF réellement envoyé — l'artefact archivé").to.have.length(1);
			});

			// The document screen shows the archive: opening the invoice's own page, now
			// "sent".
			cy.openDocument(invoiceId);

			// Under the page's `lg` breakpoint (CI viewport 1000×660) the side sections stack under the
			// form (document-detail.tsx), so the archive must be scrolled into view before any
			// visibility assertion.
			cy.get('[data-cy="document-archive-section"]', { timeout: 15000 })
				.scrollIntoView()
				.should("be.visible");
			cy.get('[data-cy="document-archive-hash"]').should("be.visible").invoke("text").then((text) => {
				expect(text.trim().length, "un hash abrégé, non vide").to.be.greaterThan(0);
			});
			cy.get('[data-cy="document-archive-date"]').should("be.visible");
			// FR retention (⚖) shown on screen, never an invented duration — see data/fr.json: the
			// rule that applies (commercial, 10 years) is CITED, not just a number.
			cy.get('[data-cy="document-archive-retention"]').should("contain.text", "C. com. art. L123-22");

			// The verification genuinely RE-HASHES the bytes server-side (persistence.ts#verifyDocumentArchive)
			// — never a static client-side verdict.
			cy.get('[data-cy^="document-archive-verify-"]').first().click();
			cy.get('[data-cy^="document-archive-verify-result-"]', { timeout: 15000 }).should(
				"contain.text",
				"Intact",
			);

			// The API lists the archive with retentionUntil and basis for the FR company — the proof
			// that matters, independent of any rendering.
			cy.request({ url: `${api}/api/documents/${invoiceId}/archives?typeId=invoice` })
				.its("body")
				.then((archives: DocumentArchive[]) => {
					// Exactly one — never merely "at least one": this invoice was sent exactly ONCE, and
					// a `length.greaterThan(0)` check would stay green even for a double archive (an
					// on-terminal hook firing twice, or a retry) going unnoticed.
					expect(archives, "une seule archive pour cette facture envoyée une seule fois").to.have.length(
						1,
					);
					const archive = archives[0];
					expect(archive.contentHash, "un hash SHA-256 réel").to.match(/^[0-9a-f]{64}$/);
					expect(archive.retentionUntil, "FR : une échéance de rétention, jamais nulle").to.be.a(
						"string",
					);
					expect(archive.retentionBasis, "la règle retenue est citée").to.match(
						/C\. com\. art\. L123-22/,
					);
					expect(archive.retentionBasis, "la seconde obligation simultanée est nommée aussi").to.match(
						/LPF art\. L102 B/,
					);

					// The API-side verification too: intact.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/${invoiceId}/archives/${archive.id}/verify?typeId=invoice`,
					})
						.its("body")
						.then((result) => {
							expect(result.status, "intact via l'API aussi").to.eq("intact");
						});
				});
		});
	});
});
