export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Per-company expense categories (product decision 2026-09-15) — Settings ->
 * Expense categories. Same discipline as 62-expense-attachments.cy.ts and 65-company-mail-settings.cy.ts:
 * ACTIONS (create/rename/archive) go through the SCREEN, a real click; every ASSERTION that matters
 * reads the record back via `cy.request` on the API, never the screen's own DOM as proof of what got
 * stored — a toast proves the request SETTLED, not what it wrote. Every save request is named with
 * `cy.intercept`/`cy.wait` and its status code checked BEFORE the toast is ever asserted on (same
 * discipline 65's own header documents, and the same CI-run precedent it cites for why).
 *
 * The OWNER/ADMIN-only write gate is proven at the API level directly, against a REAL MEMBER session
 * created via invitation — the exact same technique 50-approval.cy.ts already uses for its own
 * role-based gate, reused here rather than a DOM "is the tab/button hidden" check: the tab's own
 * client-side hiding (`-[tab].tsx`) is a UX nicety layered on top of this real boundary, never the
 * boundary itself — proving the DOM hides a button says nothing about what a scripted client posting
 * directly could still do.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const MEMBER_EMAIL = "member-expense-categories@example.com";
const PASSWORD = "Super_Secret_Password123!";

const DEFAULT_KEYS = [
	"travel",
	"meals",
	"accommodation",
	"office_supplies",
	"software",
	"equipment",
	"marketing",
	"professional_services",
	"utilities",
	"other",
];

interface ExpenseCategoryRow {
	id: string;
	key: string;
	label: string;
	archivedAt: string | null;
}

function listCategories(includeArchived = true) {
	return cy
		.request<ExpenseCategoryRow[]>({ url: `${api}/api/documents/expense-categories?includeArchived=${includeArchived}` })
		.its("body");
}

function expenseCategoryOptions() {
	return cy
		.request<{ fields: { key: string; options?: { value: string; label: string }[] }[] }>({
			url: `${api}/api/documents/types/expense`,
		})
		.its("body")
		.then((descriptor) => descriptor.fields.find((f) => f.key === "category")?.options ?? []);
}

function memberSession() {
	cy.session("member-expense-categories-session", () => {
		cy.visit("/auth/sign-in");
		cy.get('[data-cy="auth-email-input"]').type(MEMBER_EMAIL);
		cy.get('[data-cy="auth-password-input"]').type(PASSWORD);
		cy.get('[data-cy="auth-submit-btn"]').click();
		cy.url({ timeout: 20000 }).should("include", "/dashboard");
	});
}

describe("Expense categories — Settings screen, and the API it drives", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login(); // OWNER (john.doe@acme.org)
	});

	it("the default ten-plus-Other set is seeded on first access and shown on the settings screen", () => {
		cy.visit("/settings/expenseCategories");
		cy.get('[data-cy="expense-categories-settings"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="expense-categories-list"]', { timeout: 10000 }).should("contain.text", "Other");

		listCategories().then((categories) => {
			expect(categories, "dix catégories par défaut, une seule fois").to.have.length(10);
			expect(categories.map((c) => c.key).sort()).to.deep.equal([...DEFAULT_KEYS].sort());
			expect(categories.every((c) => c.archivedAt === null), "aucune n'est archivée au départ").to.eq(
				true,
			);
		});
	});

	it('creates a category through the screen — stored via the API, and offered on the expense form\'s own "category" options', () => {
		cy.visit("/settings/expenseCategories");

		cy.intercept("POST", `${api}/api/documents/expense-categories`).as("createCategory");
		cy.get('[data-cy="expense-category-label-input"]').type("Team Building");
		cy.get('[data-cy="expense-category-create-submit"]').click();
		cy.wait("@createCategory", { timeout: 10000 }).then((interception) => {
			expect(interception.response?.statusCode, "POST /api/documents/expense-categories must succeed").to.eq(
				201,
			);
		});

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Expense category created.");

		listCategories().then((categories) => {
			const created = categories.find((c) => c.label === "Team Building");
			expect(created, "la catégorie créée est bien retrouvée par l'API").to.exist;
			expect(created?.key, "la clé est dérivée du libellé").to.eq("team_building");
			expect(created?.archivedAt).to.be.null;
		});

		expenseCategoryOptions().then((options) => {
			expect(
				options.map((o) => o.value),
				'la nouvelle catégorie est offerte comme option du champ "category" — jamais une liste en dur',
			).to.include("team_building");
		});
	});

	it("renames a category through the screen — the key never changes, the API reflects the new label", () => {
		listCategories().then((categories) => {
			const target = categories.find((c) => c.label === "Team Building");
			expect(target, "la catégorie du test précédent existe toujours").to.exist;
			const targetId = target!.id;
			const originalKey = target!.key;

			cy.visit("/settings/expenseCategories");
			cy.get(`[data-cy="expense-category-rename-button-${targetId}"]`, { timeout: 10000 }).click();
			cy.get('[data-cy="expense-category-rename-dialog"]').should("be.visible");
			cy.get('[data-cy="expense-category-rename-label-input"]').clear().type("Team Offsite");

			cy.intercept("PUT", `${api}/api/documents/expense-categories/${targetId}`).as("renameCategory");
			cy.get('[data-cy="expense-category-rename-submit"]').click();
			cy.wait("@renameCategory", { timeout: 10000 }).then((interception) => {
				expect(interception.response?.statusCode, "PUT must succeed").to.eq(200);
			});

			cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Expense category updated.");

			listCategories().then((updated) => {
				const row = updated.find((c) => c.id === targetId);
				expect(row, "toujours présente après renommage").to.exist;
				expect(row?.label, "le libellé a bien changé").to.eq("Team Offsite");
				expect(row?.key, "la clé ne change JAMAIS").to.eq(originalKey);
			});
		});
	});

	it("archives a category through the screen — excluded from the expense form's options, never hard-deleted", () => {
		listCategories().then((categories) => {
			const target = categories.find((c) => c.label === "Team Offsite");
			expect(target, "la catégorie renommée du test précédent existe toujours").to.exist;
			const targetId = target!.id;
			const targetKey = target!.key;

			cy.visit("/settings/expenseCategories");
			cy.intercept("DELETE", `${api}/api/documents/expense-categories/${targetId}`).as("archiveCategory");
			// Archive lives in the row's "..." menu (`settings-section.tsx`'s `SettingsRowMenu` grammar)
			// rather than as a directly-clickable button. The list is long enough (ten seeded categories
			// plus this spec's own two) that the row sits below the fold at this suite's 1000×660
			// viewport, so the trigger is scrolled into view first — otherwise the popover it opens
			// renders past the visible area and Cypress refuses to click it.
			cy.get(`[data-cy="expense-category-menu-${targetId}"]`, { timeout: 10000 }).scrollIntoView().click();
			cy.get(`[data-cy="expense-category-archive-button-${targetId}"]`, { timeout: 10000 })
				.should("be.visible")
				.click();
			cy.wait("@archiveCategory", { timeout: 10000 }).then((interception) => {
				expect(interception.response?.statusCode, "DELETE (archive) must succeed").to.eq(200);
			});

			cy.get("[data-sonner-toast]", { timeout: 10000 }).should("contain.text", "Expense category archived.");

			listCategories().then((all) => {
				const row = all.find((c) => c.id === targetId);
				expect(row, "jamais une vraie suppression — la ligne existe toujours").to.exist;
				expect(row?.archivedAt, "archivedAt est maintenant renseigné").to.not.be.null;
			});
			listCategories(false).then((active) => {
				expect(
					active.find((c) => c.id === targetId),
					"exclue de la liste active",
				).to.be.undefined;
			});
			expenseCategoryOptions().then((options) => {
				expect(
					options.map((o) => o.value),
					"une catégorie archivée n'est plus offerte sur le formulaire de dépense",
				).to.not.include(targetKey);
			});
		});
	});

	describe("write access — OWNER/ADMIN only, read open to every member (proven at the API, like 50-approval.cy.ts)", () => {
		before(() => {
			cy.login(); // OWNER, to issue the invitation
			cy.request({ method: "POST", url: `${api}/api/invitations`, body: { expiresInDays: 7 } })
				.its("body.code")
				.then((code: string) => {
					cy.clearCookies();
					cy.visit("/auth/sign-up");
					cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).should("be.visible").type(code);
					cy.get('[data-cy="auth-firstname-input"]').type("Mia");
					cy.get('[data-cy="auth-lastname-input"]').type("Member");
					cy.get('[data-cy="auth-email-input"]').type(MEMBER_EMAIL);
					cy.get('[data-cy="auth-password-input"]').type(PASSWORD);
					cy.get('[data-cy="auth-submit-btn"]').click();
					cy.url({ timeout: 20000 }).should("include", "/auth/sign-in");
				});
		});

		it("a MEMBER can list categories (GET, 200) but is refused POST/PUT/DELETE (403), and nothing changes", () => {
			memberSession();

			cy.request({ url: `${api}/api/documents/expense-categories`, failOnStatusCode: false }).then((res) => {
				expect(res.status, "GET reste ouvert à tout membre authentifié").to.eq(200);
			});

			cy.request({
				method: "POST",
				url: `${api}/api/documents/expense-categories`,
				body: { label: "Member Attempt" },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "POST refusé à un MEMBER").to.eq(403);
			});

			listCategories().then((categories) => {
				const other = categories.find((c) => c.key === "other");
				expect(other, "la catégorie 'other' par défaut existe").to.exist;

				cy.request({
					method: "PUT",
					url: `${api}/api/documents/expense-categories/${other!.id}`,
					body: { label: "Hijacked" },
					failOnStatusCode: false,
				}).then((res) => {
					expect(res.status, "PUT refusé à un MEMBER").to.eq(403);
				});

				cy.request({
					method: "DELETE",
					url: `${api}/api/documents/expense-categories/${other!.id}`,
					failOnStatusCode: false,
				}).then((res) => {
					expect(res.status, "DELETE (archivage) refusé à un MEMBER").to.eq(403);
				});

				// Rien n'a changé : ni le libellé, ni l'archivage.
				listCategories().then((after) => {
					const stillOther = after.find((c) => c.id === other!.id);
					expect(stillOther?.label, "le libellé n'a pas bougé").to.eq(other!.label);
					expect(stillOther?.archivedAt, "toujours pas archivée").to.be.null;
				});
			});
		});

		it("an OWNER can still write — the gate blocks the ROLE, not the endpoint", () => {
			cy.login(); // returns to the OWNER session
			cy.request({
				method: "POST",
				url: `${api}/api/documents/expense-categories`,
				body: { label: "Owner Can Still Create" },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "un OWNER n'est jamais bloqué par ce même gate").to.eq(201);
			});
		});
	});
});
