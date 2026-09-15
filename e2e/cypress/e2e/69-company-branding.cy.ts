export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Document branding (`Settings > Branding`, `/settings/branding` tab — chantier B, TODO_FEATURES.md
 * rank 16, 2026-09-15 product decision). The PDF itself stays a FIXED document — nothing here edits
 * its content or layout; only THREE brand fields do: logo, one accent color, one font from a closed
 * catalog, plus named presets that set the last two at once.
 *
 * Properties that matter, none provable by reading back the DOM we just filled in:
 *  1. A named preset (clicked as a tile) writes BOTH `accentColor` and `font` in one PUT.
 *  2. An explicit accent-color edit in a LATER save wins over what a preset set, without touching the
 *     font that same preset also set.
 *  3. A real logo upload (`input[type=file]`) round-trips: `GET /api/company/branding` reports
 *     `hasLogo: true`, and `GET /api/company/branding/logo` actually serves image bytes back.
 *  4. Removing the logo really clears it — read back from the API, never only from the screen's own
 *     toast.
 *  5. `GET /api/company/branding/preview` — the render an OWNER/ADMIN sees in the "Preview" card —
 *     really contains the CURRENTLY SAVED accent color in its HTML.
 *  6. A MEMBER cannot write branding (403, the same `@Roles(OWNER, ADMIN)` gate every other write in
 *     this settings area already holds) — GET stays readable.
 *
 * Usual discipline: ACTIONS go through the screen (typing, clicking), the ASSERTIONS that matter read
 * the API back — never the DOM we just filled in as proof of what is actually stored. Every
 * save/upload/delete is `cy.intercept` + `cy.wait`ed, its status code asserted, BEFORE any toast
 * assertion — the toast alone proved nothing on CI before (see 65-company-mail-settings.cy.ts's own
 * header for the exact false-green this guards against).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface BrandingStatus {
	accentColor: string | null;
	font: string | null;
	preset: string | null;
	hasLogo: boolean;
	presets: { id: string; label: string; accentColor: string; font: string }[];
	fonts: { key: string; label: string }[];
}

function getBrandingStatus() {
	return cy
		.request({ url: `${api}/api/company/branding` })
		.its("body") as unknown as Cypress.Chainable<BrandingStatus>;
}

describe("Company branding — logo, accent color, font, presets", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("nothing branded at the start, and the full preset/font catalogs are exposed", () => {
		getBrandingStatus().then((status) => {
			expect(status.accentColor, "aucune couleur au départ").to.be.null;
			expect(status.font, "aucune police au départ").to.be.null;
			expect(status.preset, "aucun préréglage au départ").to.be.null;
			expect(status.hasLogo, "aucun logo au départ").to.eq(false);

			expect(
				status.presets.map((p) => p.id).sort(),
				"les 4 préréglages nommés sont exposés",
			).to.deep.equal(["bold", "classic", "minimal", "modern"]);
			expect(
				status.fonts.map((f) => f.key).sort(),
				"les 5 polices du jeu fermé sont exposées",
			).to.deep.equal(["dmSans", "ibmPlexSans", "inter", "lora", "sourceSerif4"]);
		});
	});

	it('picks the "Modern" preset from the tiles — sets BOTH accent color and font in one write (property 1)', () => {
		cy.visit("/settings/branding");
		cy.get('[data-cy="branding-presets-card"]', { timeout: 15000 }).should("exist");

		cy.intercept("PUT", `${api}/api/company/branding`).as("saveBranding");
		cy.get('[data-cy="branding-preset-modern"]').click();
		cy.wait("@saveBranding", { timeout: 10000 }).then((interception) => {
			expect(
				interception.response?.statusCode,
				"PUT /api/company/branding must succeed",
			).to.eq(200);
		});

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Branding updated",
		);

		getBrandingStatus().then((status) => {
			expect(status.preset, "le préréglage Modern est enregistré").to.eq("modern");
			const modern = status.presets.find((p) => p.id === "modern");
			expect(modern, "le catalogue connaît bien Modern").to.exist;
			expect(
				status.accentColor,
				"la couleur du préréglage Modern est appliquée",
			).to.eq(modern!.accentColor);
			expect(status.font, "la police du préréglage Modern est appliquée").to.eq(
				modern!.font,
			);
		});
	});

	it("hand-edits the accent color afterwards — the explicit color wins, the preset's font is untouched (property 2)", () => {
		cy.visit("/settings/branding");
		cy.get('[data-cy="branding-accent-color-input"]', { timeout: 15000 }).should(
			"exist",
		);

		const customColor = "#123abc";
		cy.get('[data-cy="branding-accent-color-input"]').clear().type(customColor);

		cy.intercept("PUT", `${api}/api/company/branding`).as("saveBranding");
		cy.get('[data-cy="branding-save-button"]').click();
		cy.wait("@saveBranding", { timeout: 10000 }).then((interception) => {
			expect(
				interception.response?.statusCode,
				"PUT /api/company/branding must succeed",
			).to.eq(200);
		});

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Branding updated",
		);

		getBrandingStatus().then((status) => {
			expect(
				status.accentColor,
				"la couleur tapée à la main remplace celle du préréglage",
			).to.eq(customColor);
			expect(
				status.font,
				"la police du préréglage Modern (choisi au test précédent) reste inchangée",
			).to.eq("dmSans");
			expect(
				status.preset,
				"le préréglage reste nommé Modern même après un ajustement manuel",
			).to.eq("modern");
		});
	});

	it("refuses an invalid hex color — the Save button itself becomes unusable, never a fired request", () => {
		cy.visit("/settings/branding");
		cy.get('[data-cy="branding-accent-color-input"]', { timeout: 15000 })
			.clear()
			.type("not-a-color");
		// scrollIntoView(): the error `<p>` is CONDITIONALLY rendered (branding.settings.tsx) — it
		// doesn't exist yet when `.type()` above auto-scrolls the input into view, so its own
		// appearance a moment later is never itself what triggers a scroll. On the CI viewport
		// (1000×660) it then renders just past the bottom edge of _layout.tsx's scrollable content
		// pane (`overflow-y-auto`), clipped rather than absent — confirmed against the CI screenshot
		// (the "Colour & font" card isn't in frame at all at scroll position 0). A real user sees it
		// one small scroll below the field they just typed into; this asserts on the same content a
		// user would reach, not on whatever happens to already be in the viewport.
		cy.get('[data-cy="branding-accent-color-error"]').scrollIntoView().should("be.visible");
		// Proof no PUT can even be attempted from here, without ever clicking a disabled button
		// (browsers don't fire a real click on one, and forcing the DOM event would test Cypress's
		// own force-click mechanics rather than this screen's actual behavior).
		cy.get('[data-cy="branding-save-button"]').should("be.disabled");
	});

	it("uploads a logo via the screen — GET /branding/logo serves real image bytes back (property 3)", () => {
		cy.visit("/settings/branding");
		cy.get('[data-cy="branding-logo-card"]', { timeout: 15000 }).should("exist");

		cy.intercept("POST", `${api}/api/company/branding/logo`).as("uploadLogo");
		cy.get('input[type=file]').selectFile(
			"cypress/fixtures/branding/logo-fixture.png",
			{ force: true },
		);
		cy.wait("@uploadLogo", { timeout: 10000 }).then((interception) => {
			expect(
				interception.response?.statusCode,
				"POST /api/company/branding/logo must succeed",
			).to.be.oneOf([200, 201]);
		});

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Logo uploaded",
		);

		// The screen's own preview `<img>` proves it re-fetched — but the API is the real proof.
		cy.get('[data-cy="branding-logo-preview"]', { timeout: 10000 }).should("exist");

		getBrandingStatus().then((status) => {
			expect(status.hasLogo, "le logo est bien enregistré").to.eq(true);
		});

		cy.request({ url: `${api}/api/company/branding/logo`, encoding: "binary" }).then(
			(response) => {
				expect(response.status, "GET /api/company/branding/logo doit répondre 200").to.eq(
					200,
				);
				expect(
					response.headers["content-type"],
					"le mime stocké est bien une image",
				).to.match(/^image\//);
				expect(
					response.body.length,
					"les octets du logo sont bien servis, non vides",
				).to.be.greaterThan(0);
			},
		);
	});

	it("the live preview reflects the CURRENTLY SAVED accent color (property 5)", () => {
		const previewColor = "#a10dce";
		cy.request({
			method: "PUT",
			url: `${api}/api/company/branding`,
			body: { accentColor: previewColor },
		}).then((res) => expect(res.status).to.eq(200));

		cy.request({ url: `${api}/api/company/branding/preview` }).then((response) => {
			expect(response.status, "GET /api/company/branding/preview doit répondre 200").to.eq(
				200,
			);
			expect(
				response.body.html,
				"la couleur d'accent enregistrée apparaît bien dans le HTML de prévisualisation",
			).to.include(previewColor);
		});
	});

	it("removes the logo via the screen — hasLogo goes back to false (property 4)", () => {
		cy.visit("/settings/branding");
		cy.get('[data-cy="branding-logo-remove-button"]', { timeout: 15000 }).should(
			"exist",
		);

		cy.intercept("DELETE", `${api}/api/company/branding/logo`).as("removeLogo");
		cy.get('[data-cy="branding-logo-remove-button"]').click();
		cy.wait("@removeLogo", { timeout: 10000 }).then((interception) => {
			expect(
				interception.response?.statusCode,
				"DELETE /api/company/branding/logo must succeed",
			).to.eq(200);
		});

		cy.get("[data-sonner-toast]", { timeout: 10000 }).should(
			"contain.text",
			"Logo removed",
		);
		cy.get('[data-cy="branding-logo-empty"]', { timeout: 10000 }).should("exist");

		getBrandingStatus().then((status) => {
			expect(status.hasLogo, "le logo a bien été retiré").to.eq(false);
		});
	});

	describe("role gating — OWNER/ADMIN only for a write (property 6)", () => {
		const MEMBER_EMAIL = "member-branding@example.com";
		const PASSWORD = "Super_Secret_Password123!";

		function memberSession() {
			cy.session("member-branding-session", () => {
				cy.visit("/auth/sign-in");
				cy.get('[data-cy="auth-email-input"]').type(MEMBER_EMAIL);
				cy.get('[data-cy="auth-password-input"]').type(PASSWORD);
				cy.get('[data-cy="auth-submit-btn"]').click();
				cy.url({ timeout: 20000 }).should("include", "/dashboard");
			});
		}

		before(() => {
			cy.login(); // OWNER (john.doe@acme.org)
			cy.request({ method: "POST", url: `${api}/api/invitations`, body: { expiresInDays: 7 } })
				.its("body.code")
				.then((code: string) => {
					cy.clearCookies();
					cy.visit("/auth/sign-up");
					cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 })
						.should("be.visible")
						.type(code);
					cy.get('[data-cy="auth-firstname-input"]').type("Mia");
					cy.get('[data-cy="auth-lastname-input"]').type("Member");
					cy.get('[data-cy="auth-email-input"]').type(MEMBER_EMAIL);
					cy.get('[data-cy="auth-password-input"]').type(PASSWORD);
					cy.get('[data-cy="auth-submit-btn"]').click();
					cy.url({ timeout: 20000 }).should("include", "/auth/sign-in");
				});
		});

		it("a MEMBER can read branding but is refused (403) writing it", () => {
			memberSession();

			cy.request({ url: `${api}/api/company/branding` }).then((res) => {
				expect(res.status, "GET reste lisible pour un MEMBER").to.eq(200);
			});

			cy.request({
				method: "PUT",
				url: `${api}/api/company/branding`,
				body: { accentColor: "#000000" },
				failOnStatusCode: false,
			}).then((res) => {
				expect(res.status, "un MEMBER ne peut pas écrire le branding").to.eq(403);
			});
		});
	});
});
