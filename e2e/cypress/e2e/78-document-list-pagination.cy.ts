export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Server-side pagination and filters (issue #318): `GET /documents` used to return a flat,
 * unpaginated `take: 50` array with every filter re-applied client-side against whatever those 50
 * rows happened to be — silently hiding anything past the cap. It now returns one PAGE
 * (`{ items, total, page, pageSize }`), with `status`/`clientId`/`dateFrom`/`dateTo`/`q`/`sort`/
 * `order` all evaluated server-side (`backend/src/modules/documents/persistence.ts#listDocumentsPage`).
 *
 * Seeded through the API (30 invoices, one API-key client, matching 21-document-lifecycle.cy.ts's own
 * "no spec drives the date-picker for document CREATION" convention) so this spec's own screen
 * interaction is entirely about the LIST's controls — search, status chips, the client filter,
 * pagination — never about filling a create form. Every assertion that matters reads the API, never
 * a DOM re-read, as proof of what the server actually returned.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

describe("Document list — server-side pagination and filters", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	let seededClientId: string;
	let secondClientId: string;
	let secondClientName: string;

	it("seeds 30 invoices for the default client, plus 5 more for a SECOND client", () => {
		cy.request({ url: `${api}/api/documents/references/client/search` })
			.its("body")
			.then((clients: { id: string; label: string }[]) => {
				expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);
				seededClientId = clients[0].id;

				secondClientName = "Zzyzx Filter Target Co";
				cy.request({
					method: "POST",
					url: `${api}/api/clients`,
					body: {
						name: secondClientName,
						address: "1 Filter Street",
						postalCode: "75001",
						city: "Paris",
						country: "France",
					},
				}).then((created) => {
					secondClientId = created.body.id;
					expect(secondClientId, "le second client a un identifiant").to.be.a("string");

					const invoiceData = (clientId: string, index: number) => ({
						client: clientId,
						issueDate: "2026-01-15",
						dueDate: "2026-02-15",
						currency: "EUR",
						lines: [
							{
								description: `Item ${index}`,
								quantity: 1,
								unit: "unit",
								unitPrice: 10 + index,
								vatRate: "20",
							},
						],
					});

					// 25 for the seeded client, 5 for the second one — 30 total, exactly one page (25) plus
					// a five-row second page, and enough of a second client to prove `clientId` narrows.
					for (let i = 0; i < 25; i++) {
						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/save-draft`,
							body: { data: invoiceData(seededClientId, i) },
						});
					}
					for (let i = 0; i < 5; i++) {
						cy.request({
							method: "POST",
							url: `${api}/api/documents/types/invoice/actions/save-draft`,
							body: { data: invoiceData(secondClientId, i) },
						});
					}
				});
			});
	});

	it("shows exactly 25 rows on page 1, and the remaining 5 on page 2 — total confirmed by the API", () => {
		cy.request({ url: `${api}/api/documents?typeId=invoice&pageSize=1` })
			.its("body.total")
			.should("eq", 30);

		cy.visit("/documents/invoice");
		cy.get('[data-cy^="document-list-row-"]', { timeout: 15000 }).should("have.length", 25);

		cy.contains("a", "2").click();
		cy.url().should("include", "page=2");
		cy.get('[data-cy^="document-list-row-"]', { timeout: 15000 }).should("have.length", 5);
	});

	it("filtering by a status with zero matches empties the list — the status chip reaches the server", () => {
		cy.visit("/documents/invoice");
		cy.get('[data-cy^="document-list-row-"]', { timeout: 15000 }).should("have.length", 25);

		cy.intercept("GET", `${api}/api/documents*`).as("listDocuments");
		// Every seeded invoice is "draft" — "sent" therefore matches nothing, which is exactly what
		// proves the click's own status actually reached the server (a client-side-only filter over
		// the already-loaded page would instead just show whatever this page already held).
		cy.get('[data-cy="document-status-filter-sent"]').click();
		cy.wait("@listDocuments")
			.its("request.url")
			.should("include", "status=sent");
		cy.get('[data-cy="document-list-empty"]', { timeout: 15000 }).should("be.visible");

		// Toggling it back off (multi-select: a second click removes it, not an exclusive swap)
		// restores the 25 "draft" rows.
		cy.get('[data-cy="document-status-filter-sent"]').click();
		cy.get('[data-cy^="document-list-row-"]', { timeout: 15000 }).should("have.length", 25);
	});

	it("the client filter narrows the list to exactly the 5 invoices of the second client", () => {
		cy.visit("/documents/invoice");
		cy.get('[data-cy^="document-list-row-"]', { timeout: 15000 }).should("have.length", 25);

		cy.get('[data-cy="document-list-filter-client"]').should("be.visible");
		cy.openSearchSelect("document-list-filter-client");
		cy.get('[data-cy="document-list-filter-client"] input').type("Zzyzx");
		cy.get(
			'[data-cy="document-list-filter-client-option-zzyzx-filter-target-co"]',
			{ timeout: 10000 },
		).click();

		cy.get('[data-cy^="document-list-row-"]', { timeout: 15000 }).should("have.length", 5);
		cy.url().should("include", "clientId=");

		cy.location("search").then((search) => {
			const clientIdParam = new URLSearchParams(search).get("clientId");
			expect(clientIdParam, "le clientId filtré est bien celui du second client").to.eq(
				secondClientId,
			);
			cy.request({ url: `${api}/api/documents?typeId=invoice&clientId=${clientIdParam}&pageSize=50` })
				.its("body")
				.then((body: { total: number; items: { id: string }[] }) => {
					expect(body.total, "l'API confirme le même total que l'écran").to.eq(5);
				});
		});
	});

	it("a search term matching only the second client's name narrows the list to its 5 invoices", () => {
		cy.visit("/documents/invoice");
		cy.get('[data-cy^="document-list-row-"]', { timeout: 15000 }).should("have.length", 25);

		cy.get('[data-cy="document-list-search"]').type("Zzyzx");
		// Debounced (300ms): on a slow CI runner, `cy.type`'s own keystrokes can each land more than
		// 300ms apart, so the debounce fires more than once ("q=Z", "q=Zz", ...) before the final
		// "q=Zzyzx" — `cy.wait` on a single intercept alias only ever catches the FIRST of those,
		// which is not what this test means to assert. The only stable signal is the end state: the
		// URL settled on the full term, then the list reflecting it.
		cy.location("search", { timeout: 5000 }).should("include", "q=Zzyzx");

		cy.get('[data-cy^="document-list-row-"]', { timeout: 15000 }).should("have.length", 5);

		cy.location("search").then((search) => {
			const q = new URLSearchParams(search).get("q");
			cy.request({ url: `${api}/api/documents?typeId=invoice&q=${encodeURIComponent(q ?? "")}&pageSize=50` })
				.its("body.total")
				.should("eq", 5);
		});
	});
});
