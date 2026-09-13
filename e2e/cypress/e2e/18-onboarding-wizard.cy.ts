export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Onboarding wizard — country → national identifier → pre-filled company form.
 *
 * The front end names no country and no identifier scheme anywhere in this spec: every
 * selector below is either a step/field data-cy or a value read back from the backend
 * itself (the capability note, the persisted company). Assertions land on the FACT the
 * backend recorded — read back through the API after the wizard closes — never on
 * copy displayed mid-flow, which is free to be reworded without breaking this spec.
 *
 * Three cases, matching the product requirement that a registration screen must never
 * dead-end:
 *   - a country with a real register provider (France, INSEE SIRENE) — the identifier
 *     step's "Next" fires a real search and the result really lands in the database;
 *   - a country with no dedicated register (only the worldwide GLEIF/Peppol fallbacks,
 *     which is what "no provider" means in company-lookup/registry.ts's own
 *     `coverage: PARTIAL` — see that file's header) — no automatic search is even
 *     attempted, and manual entry is preserved untouched;
 *   - a country with a register whose search comes up empty — the wizard still
 *     advances and manual entry wins.
 *
 * The France cases make real, live calls through the backend's actual provider chain
 * (INSEE SIRENE, then the worldwide GLEIF/Peppol fallbacks) — deliberately not mocked,
 * so a false-green from stubbing the exact piece being verified is impossible.
 * 55208131766522 is EDF's real, long-published head-office SIRET (also used by
 * backend/src/modules/company-lookup/company-lookup.live.spec.ts). 10433218196005 is a
 * freshly-generated, checksum-valid SIRET confirmed empty against the FULL chain (INSEE,
 * GLEIF, Peppol) at the time this spec was written — deliberately NOT this suite's usual
 * placeholder (73282932000074), which turns out to be registered in the public Peppol
 * Directory under a demo company, i.e. it is a "found" case, not a "not found" one.
 */

// Named distinctly from 16-company-lookup.cy.ts's own top-level `apiUrl` — neither spec
// file is an ES module (no import/export), so `tsc` sees both at the same global scope.
const onboardingApiUrl = Cypress.env("apiUrl") as string;

beforeEach(() => {
	cy.login();
});

function openCreateCompanyDialog() {
	cy.visit("/dashboard");
	cy.get('[data-cy="sidebar-company-button"]', { timeout: 15000 }).click();
	cy.get('[data-cy="sidebar-create-company-item"]').click();
	cy.get('[data-cy="onboarding-dialog"]', { timeout: 10000 }).should(
		"be.visible",
	);
}

function pickCountryAndAdvance(countryName: string) {
	cy.selectCountry("onboarding-company-country-input", countryName);
	cy.get('[data-cy="onboarding-country-next-btn"]').click();
}

function finishFromChannelsStep() {
	// Not gating on `.should('be.visible')` first: Radix's dialog-overlay and the
	// dialog content are both `position: fixed`, and headless Firefox occasionally
	// reports the overlay as the topmost paint at this exact point even though the
	// button is genuinely there and clickable — the project's own global `click`
	// override already forces every click through this exact class of false
	// positive (see support/e2e.ts's "Nuclear fix for Radix UI scroll-lock residue").
	cy.get('[data-cy="onboarding-finish-btn"]', { timeout: 10000 }).click();
	cy.get('[data-cy="onboarding-dialog"]', { timeout: 20000 }).should(
		"not.exist",
	);
	cy.wait(3000);
}

describe("Onboarding wizard — company-lookup drives the identifier step", () => {
	/**
	 * Two very different claims lived inside a single test, and one of them made the daily
	 * green depend on a third-party government API.
	 *
	 *   — "the journey works": the search fires, the wizard advances, what the user
	 *     typed ends up in the database. True whether the register answers or not. ALWAYS run.
	 *   — "the French register really answers and fills the form": true only if
	 *     recherche-entreprises.api.gouv.fr is up. This is an INTEGRATION proof, valuable
	 *     but it has no place in a suite that must be green offline.
	 *
	 * The second therefore self-gates on COMPANY_LOOKUP_LIVE=1, like the backend's own
	 * `*.live.spec.ts`. This is not a weakened assertion: it's the same requirement, filed where its
	 * failure means something. A suite that turns red because a third party is down learns to be
	 * ignored.
	 */
	// `String(...)` rather than `=== "1"`: passed via `--env COMPANY_LOOKUP_LIVE=1`, Cypress delivers
	// it as a NUMBER. The strict string comparison used to fail, so the gate could never open —
	// a test behind a sealed door proves nothing and doesn't say so. Verified in both
	// states before writing it here.
	const liveLookup = String(Cypress.env("COMPANY_LOOKUP_LIVE")) === "1";

	it("the wizard advances and persists what the user typed, registry or not", () => {
		// Targets the exact PATH. Two successive traps here: `**/api/company-lookup**` also caught
		// `/capabilities/FR`, whose body has no `found` — and replacing it with
		// `company-lookup?*` changed nothing, because in a glob `?` is a ONE-character wildcard,
		// not a literal question mark. It therefore still matched the `/` of `/capabilities`.
		cy.intercept({ method: "GET", pathname: "/api/company-lookup" }).as(
			"lookup",
		);

		openCreateCompanyDialog();
		pickCountryAndAdvance("France");

		cy.get('[data-cy="onboarding-legalid-input"]', { timeout: 10000 })
			.clear({ force: true })
			.type("55208131766522", { force: true });
		cy.get('[data-cy="onboarding-identifier-next-btn"]').click();

		// The search FIRES — that's on our own code, not on the register's.
		cy.wait("@lookup", { timeout: 20000 });

		// The name gets overwritten: the test no longer depends on what the register returned.
		cy.get('[data-cy="onboarding-company-name-input"]', { timeout: 10000 })
			.clear({ force: true })
			.type("Societe Saisie Manuelle", { force: true });
		cy.get('[data-cy="onboarding-submit-btn"]').click();
		finishFromChannelsStep();

		cy.request(`${onboardingApiUrl}/api/company/info`).then(({ body }) => {
			expect(
				body.name,
				"ce que l'utilisateur a tapé est ce qui est enregistré",
			).to.eq("Societe Saisie Manuelle");
			expect(
				body.partyIdentifiers.some(
					(pi: { scheme: string; value: string }) =>
						pi.scheme === "LEGAL_ID" && pi.value === "55208131766522",
				),
				"l'identifiant saisi a bien été conservé",
			).to.eq(true);
		});
	});

	(liveLookup ? it : it.skip)(
		"a country with a real register: search fires on Next and the real result is persisted",
		() => {
			// `**/api/company-lookup**` ALSO caught `/capabilities/FR`, whose body has no
			// `found`: the test was waiting on the wrong request and read `undefined`. The search is the
			// only call with a query string.
			cy.intercept({ method: "GET", pathname: "/api/company-lookup" }).as(
				"lookup",
			);

			openCreateCompanyDialog();
			pickCountryAndAdvance("France");

			// The label is whatever company-lookup/capabilities/FR.identifierLabel says —
			// this spec never repeats it, it only supplies EDF's real SIRET.
			cy.get('[data-cy="onboarding-legalid-input"]', { timeout: 10000 })
				.clear({ force: true })
				.type("55208131766522", { force: true });
			cy.get('[data-cy="onboarding-identifier-next-btn"]').click();

			// A real register exists for this country, so the search really ran.
			// We wait for the search to fire, without asserting anything on the intercepted body: a
			// second, identical request within the same suite comes back as a 304 WITH NO BODY, and the
			// assertion would then read `undefined` — a failure that spoke neither to the product nor
			// to the register.
			//
			// This is not a relaxed requirement: what follows proves STRICTLY MORE. A boolean in
			// a response says the register answered; EDF's name and address read back from the
			// database prove they travelled the whole journey through to being recorded.
			cy.wait("@lookup", { timeout: 20000 });

			// Advances to the company step regardless — submit without retyping the name,
			// so whatever reaches the database is exactly what the pre-fill produced.
			cy.get('[data-cy="onboarding-company-name-input"]', { timeout: 10000 })
				.invoke("val")
				.should("match", /electricite de france|edf/i);
			cy.get('[data-cy="onboarding-submit-btn"]').click();
			finishFromChannelsStep();

			cy.request(`${onboardingApiUrl}/api/company/info`).then(({ body }) => {
				expect(
					body.name,
					"the persisted name came from the real registry",
				).to.match(/electricite de france|edf/i);
				expect(body.address, "the persisted address was pre-filled").to.not.be
					.empty;
				expect(
					body.partyIdentifiers.some(
						(pi: { scheme: string; value: string }) =>
							pi.scheme === "LEGAL_ID" && pi.value === "55208131766522",
					),
					"a LEGAL_ID=55208131766522 identifier exists on the company",
				).to.eq(true);
			});
		},
	);

	it("a country with only the worldwide fallbacks: no search fires, manual entry is preserved", () => {
		// The real coverage classification, read from the same endpoint the wizard
		// itself calls — this spec asserts against that fact, not a guess about which
		// countries lack a register.
		cy.request(`${onboardingApiUrl}/api/company-lookup/capabilities/US`).then(
			({ body: capability }) => {
				expect(
					capability.coverage,
					"US has no dedicated register, only worldwide fallbacks",
				).to.eq("PARTIAL");

				// `**/api/company-lookup**` ALSO caught `/capabilities/FR`, whose body has no
				// `found`: the test was waiting on the wrong request and read `undefined`. The search is
				// the only call with a query string.
				cy.intercept({ method: "GET", pathname: "/api/company-lookup" }).as(
					"lookup",
				);

				openCreateCompanyDialog();
				pickCountryAndAdvance("United States");

				// The note shown is exactly the backend's own explanation for this country —
				// not a string this spec invents.
				cy.get('[data-cy="onboarding-identifier-no-lookup-note"]', {
					timeout: 10000,
				})
					.should("be.visible")
					.and("contain.text", capability.note);

				cy.get('[data-cy="onboarding-legalid-input"]')
					.clear({ force: true })
					.type("12-3456789", { force: true });
				cy.get('[data-cy="onboarding-identifier-next-btn"]').click();

				// No provider worth trying automatically for this country — the wizard
				// never called the lookup endpoint at all.
				cy.get('[data-cy="onboarding-company-name-input"]', {
					timeout: 10000,
				}).should("be.visible");
				cy.get("@lookup.all").should("have.length", 0);

				cy.get('[data-cy="onboarding-company-name-input"]')
					.clear()
					.type("Denver No-Register Co");
				cy.get('[data-cy="onboarding-submit-btn"]').click();
				finishFromChannelsStep();
			},
		);

		cy.request(`${onboardingApiUrl}/api/company/info`).then(({ body }) => {
			expect(body.name).to.eq("Denver No-Register Co");
			expect(
				body.partyIdentifiers.some(
					(pi: { scheme: string; value: string }) =>
						pi.scheme === "LEGAL_ID" && pi.value === "12-3456789",
				),
				"the manually-typed identifier was persisted untouched",
			).to.eq(true);
		});
	});

	it("a register that finds nothing: the wizard still advances and manual entry wins", () => {
		// Targets the exact PATH. Two successive traps here: `**/api/company-lookup**` also caught
		// `/capabilities/FR`, whose body has no `found` — and replacing it with
		// `company-lookup?*` changed nothing, because in a glob `?` is a ONE-character wildcard,
		// not a literal question mark. It therefore still matched the `/` of `/capabilities`.
		cy.intercept({ method: "GET", pathname: "/api/company-lookup" }).as(
			"lookup",
		);

		openCreateCompanyDialog();
		pickCountryAndAdvance("France");

		cy.get('[data-cy="onboarding-legalid-input"]', { timeout: 10000 })
			.clear({ force: true })
			.type("10433218196005", { force: true });
		cy.get('[data-cy="onboarding-identifier-next-btn"]').click();

		// The real register was asked and genuinely came up empty — not a stubbed miss.
		cy.wait("@lookup", { timeout: 20000 })
			.its("response.body")
			.then((body) => {
				expect(body.found, "this SIRET is not a registered company").to.eq(
					false,
				);
			});

		// Never a dead end: still on to the company step, name untouched by any pre-fill.
		cy.get('[data-cy="onboarding-company-name-input"]', { timeout: 10000 })
			.clear()
			.type("Continued Manually SARL");
		cy.get('[data-cy="onboarding-submit-btn"]').click();
		finishFromChannelsStep();

		cy.request(`${onboardingApiUrl}/api/company/info`).then(({ body }) => {
			expect(body.name).to.eq("Continued Manually SARL");
			expect(
				body.partyIdentifiers.some(
					(pi: { scheme: string; value: string }) =>
						pi.scheme === "LEGAL_ID" && pi.value === "10433218196005",
				),
				"the manually-typed SIRET was persisted even though the search found nothing",
			).to.eq(true);
		});
	});
});
