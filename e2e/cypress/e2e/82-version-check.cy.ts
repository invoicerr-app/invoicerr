export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #371 — the installed version shown in the sidebar, and the "update available" notice.
 *
 * `GET /api/version` (`backend/src/modules/version/`) makes an outbound call to GitHub, server-side
 * — never something a browser request Cypress can see, so `cy.intercept` cannot stub it (same
 * reasoning `cypress.config.ts`'s own webhook-receiver comment gives for why a backend-to-backend
 * call needs a REAL local double, not an intercept). This e2e backend's own `.env.test` instead sets
 * `GITHUB_RELEASES_FAKE=1`, which swaps `VersionService`'s injected GitHub client for
 * `FakeGithubReleaseClient` (`modules/version/fake-github-release-client.ts`) — network-free,
 * deterministic, always reports one fake release (`v999.0.0`, always "newer" than whatever this e2e
 * stack's own installed version resolves to). That is what makes the update-available badge —
 * otherwise unreachable in CI, which must never depend on the real GitHub API being up —
 * observable through a REAL browser here, every run.
 *
 * The "no update" rendering branch is the one state `GITHUB_RELEASES_FAKE=1` does NOT naturally
 * produce (it is now the WHOLE suite's default). It is instead proven by stubbing this app's OWN
 * `GET /api/version` response for that one test (`cy.intercept` on a same-origin call the browser
 * really does make) — the one departure from "actions through the screen, assertions through the
 * API" this file takes, and only for that single negative-rendering assertion.
 *
 * Usual discipline otherwise (see 73-account-page.cy.ts): actions through the screen, the assertion
 * that matters reads the real API response back.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface VersionInfo {
	currentVersion: string;
	latestVersion: string | null;
	latestUrl: string | null;
	updateAvailable: boolean;
	checkedAt: string | null;
}

function getVersionInfo() {
	return cy.request(`${api}/api/version`).its("body") as unknown as Cypress.Chainable<VersionInfo>;
}

describe("Installed version + update check (sidebar)", () => {
	beforeEach(() => {
		cy.login();
	});

	it("(1) shows the real installed version, read from the API, not typed by hand", () => {
		getVersionInfo().then((info) => {
			expect(info.currentVersion, "GET /api/version currentVersion").to.be.a("string").and.not.be.empty;

			cy.visit("/dashboard");
			cy.get('[data-cy="sidebar-app-version"]', { timeout: 15000 })
				.should("be.visible")
				.and("contain.text", info.currentVersion);
		});
	});

	it("(2) shows an update-available badge under GITHUB_RELEASES_FAKE=1, linking to the real release URL the API named", () => {
		getVersionInfo().then((info) => {
			// Asserted here, not just trusted from the fixture comment above: if this ever comes back
			// false the rest of the test would still trivially pass on an absent badge, hiding a real
			// regression in VersionService's own comparison instead of catching it.
			expect(info.updateAvailable, "GET /api/version updateAvailable").to.eq(true);
			expect(info.latestVersion).to.eq("v999.0.0");
			expect(info.latestUrl).to.be.a("string").and.not.be.empty;

			cy.visit("/dashboard");
			cy.get('[data-cy="sidebar-update-available"]', { timeout: 15000 })
				.should("be.visible")
				.and("have.attr", "href", info.latestUrl)
				.and("have.attr", "target", "_blank");
			cy.get('[data-cy="sidebar-update-available"]').contains(/update available/i);
		});
	});

	it("(3) shows no badge at all when the API reports no update available", () => {
		// The one state GITHUB_RELEASES_FAKE=1 never produces on its own (see this file's own
		// header) — stubbed here for this single test only.
		cy.intercept("GET", `${api}/api/version`, {
			statusCode: 200,
			body: {
				currentVersion: "0.0.1",
				latestVersion: null,
				latestUrl: null,
				updateAvailable: false,
				checkedAt: new Date().toISOString(),
			} satisfies VersionInfo,
		}).as("versionNoUpdate");

		cy.visit("/dashboard");
		cy.wait("@versionNoUpdate");
		cy.get('[data-cy="sidebar-app-version"]', { timeout: 15000 })
			.should("be.visible")
			.and("contain.text", "0.0.1");
		cy.get('[data-cy="sidebar-update-available"]').should("not.exist");
	});
});
