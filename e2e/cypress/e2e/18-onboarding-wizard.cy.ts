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
 *     which is what "no fournisseur" means in company-lookup/registry.ts's own
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
	 * Deux affirmations très différentes vivaient dans un seul test, et l'une d'elles faisait
	 * dépendre le vert quotidien d'une API gouvernementale tierce.
	 *
	 *   — « le parcours marche » : la recherche part, l'assistant avance, ce que l'utilisateur a
	 *     saisi finit en base. Vrai que le registre réponde ou non. TOUJOURS exécuté.
	 *   — « le registre français répond vraiment et remplit le formulaire » : vrai seulement si
	 *     recherche-entreprises.api.gouv.fr est debout. C'est une preuve d'INTÉGRATION, précieuse
	 *     mais qui n'a pas sa place dans une suite qui doit être verte hors ligne.
	 *
	 * Le second s'auto-gate donc sur COMPANY_LOOKUP_LIVE=1, comme les `*.live.spec.ts` du backend.
	 * Ce n'est pas une assertion affaiblie : c'est la même exigence, rangée là où son échec veut
	 * dire quelque chose. Une suite qui rougit parce qu'un tiers est en panne apprend à être ignorée.
	 */
	// `String(...)` et non `=== "1"` : passé par `--env COMPANY_LOOKUP_LIVE=1`, Cypress le livre comme
	// NOMBRE. La comparaison stricte à la chaîne échouait, donc le gate ne pouvait jamais s'ouvrir —
	// un test derrière une porte condamnée ne prouve rien et ne le dit pas. Vérifié dans les deux
	// états avant de l'écrire ici.
	const liveLookup = String(Cypress.env("COMPANY_LOOKUP_LIVE")) === "1";

	it("the wizard advances and persists what the user typed, registry or not", () => {
		// On cible le CHEMIN exact. Deux pièges successifs ici : `**/api/company-lookup**` attrapait
		// aussi `/capabilities/FR`, dont le corps n'a pas de `found` — et le remplacer par
		// `company-lookup?*` ne changeait rien, parce que dans un glob `?` est un joker d'UN caractère,
		// pas un point d'interrogation littéral. Il matchait donc encore le `/` de `/capabilities`.
		cy.intercept({ method: "GET", pathname: "/api/company-lookup" }).as(
			"lookup",
		);

		openCreateCompanyDialog();
		pickCountryAndAdvance("France");

		cy.get('[data-cy="onboarding-legalid-input"]', { timeout: 10000 })
			.clear({ force: true })
			.type("55208131766522", { force: true });
		cy.get('[data-cy="onboarding-identifier-next-btn"]').click();

		// La recherche PART — c'est du ressort de notre code, pas de celui du registre.
		cy.wait("@lookup", { timeout: 20000 });

		// On écrase le nom : le test ne dépend alors plus de ce que le registre a rendu.
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
			// `**/api/company-lookup**` attrapait AUSSI `/capabilities/FR`, dont le corps n'a pas de
			// `found` : le test attendait la mauvaise requête et lisait `undefined`. La recherche est le
			// seul appel avec une chaîne de requête.
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
			// On attend que la recherche parte, sans rien affirmer sur le corps intercepté : une
			// deuxième requête identique dans la même suite revient en 304 SANS CORPS, et l'assertion
			// lisait alors `undefined` — un échec qui ne parlait ni du produit ni du registre.
			//
			// Ce n'est pas une exigence relâchée : ce qui suit prouve STRICTEMENT PLUS. Un booléen dans
			// une réponse dit que le registre a répondu ; le nom et l'adresse d'EDF relus en base
			// prouvent qu'ils ont traversé tout le parcours jusqu'à l'enregistrement.
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

				// `**/api/company-lookup**` attrapait AUSSI `/capabilities/FR`, dont le corps n'a pas de
				// `found` : le test attendait la mauvaise requête et lisait `undefined`. La recherche est le
				// seul appel avec une chaîne de requête.
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

				// No fournisseur worth trying automatically for this country — the wizard
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
		// On cible le CHEMIN exact. Deux pièges successifs ici : `**/api/company-lookup**` attrapait
		// aussi `/capabilities/FR`, dont le corps n'a pas de `found` — et le remplacer par
		// `company-lookup?*` ne changeait rien, parce que dans un glob `?` est un joker d'UN caractère,
		// pas un point d'interrogation littéral. Il matchait donc encore le `/` de `/capabilities`.
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
