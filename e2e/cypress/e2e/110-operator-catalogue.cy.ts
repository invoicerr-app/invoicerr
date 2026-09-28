export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Operator catalogue (issue #526) - `backend/src/modules/documents/operators/`. No screen consumes
 * this yet (issue #527 is the screen); this spec is API-level only, per the owner's own instruction
 * for this PR, proving the two new/changed surfaces directly against the real backend:
 *
 *  - `GET /api/documents/operators` (optionally `?channel=<legalChannel>`) - the catalogue itself.
 *  - `GET /api/documents/transports` - now also carries each transport's own `credentialFields`
 *    (scope addition: the backend becomes the single source of truth for what a connect form must
 *    collect, replacing the frontend's own hard-coded `PROVIDER_FIELDS`).
 *  - `GET /api/company/channels` - each `configured` row now also carries `operatorId`, resolved
 *    server-side from the row's own `providerId` (+, only when genuinely ambiguous, its own
 *    connected `baseUrl`) - issue #526's "say how a pdp account maps to an operator (by baseUrl)".
 *
 * Every request goes through `cy.request` only - no `cy.visit`, matching "an API-level Cypress test
 * of the new endpoints is enough" (there is nothing to click: no screen changed in this PR).
 */
const api = Cypress.env("apiUrl");

/** Same closed-port trick 31-national-channels.cy.ts already uses for its own fake PDP credentials
 *  - port 1 (tcpmux) is never open on a normal dev/CI machine, so nothing here ever reaches a real
 *  network, and a real deposit is never attempted by these tests (they never pick a transport or
 *  send an invoice - only connect/inspect channel config). */
const CLOSED_PORT_URL = "http://127.0.0.1:1";

describe("Operator catalogue API (issue #526)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	describe("GET /api/documents/operators", () => {
		it("lists the seeded catalogue - ecosio excluded by owner's decision (2026-09-28)", () => {
			cy.request({ url: `${api}/api/documents/operators` })
				.its("body")
				.then((operators: { id: string }[]) => {
					const ids = operators.map((o) => o.id);
					expect(ids, "the operators this catalogue seeds").to.include.members([
						"superpdp",
						"acube",
						"billit",
						"iopole",
						"invopop",
						"chorus-pro",
						"ksef",
						"sdi",
						"pt-at",
					]);
					expect(ids, "ecosio was explicitly excluded, serves large groups only").to.not.include(
						"ecosio",
					);
					// Every entry carries its own provenance - never a bare fact (see schema.ts's own
					// assertValidOperatorFact, already enforced at load time; re-checked here at the
					// HTTP boundary too).
					for (const operator of operators as unknown as {
						id: string;
						provenance: { kind: string };
					}[]) {
						expect(
							["legal", "unverified"],
							`operator "${operator.id}" carries a valid provenance kind`,
						).to.include(operator.provenance.kind);
					}
				});
		});

		it('?channel=pdp lists exactly the "pdp" legal-channel operators - the whole reason this catalogue exists', () => {
			cy.request({ url: `${api}/api/documents/operators?channel=pdp` })
				.its("body")
				.then((operators: { id: string }[]) => {
					const ids = operators.map((o) => o.id).sort();
					expect(ids).to.deep.equal(
						[
							"b2brouter",
							"billit",
							"invopop",
							"iopole",
							"oneup",
							"sovos-saphety",
							"superpdp",
							"vosfactures",
							"weinvoice",
						].sort(),
					);
				});
		});

		it("?channel=sdi-pec returns EMPTY - deliberately no operator (bring-your-own PEC mailbox)", () => {
			cy.request({ url: `${api}/api/documents/operators?channel=sdi-pec` })
				.its("body")
				.should("deep.equal", []);
		});

		it("?channel=<unknown> returns EMPTY, never a 404 or a guess", () => {
			cy.request({ url: `${api}/api/documents/operators?channel=does-not-exist` })
				.its("body")
				.should("deep.equal", []);
		});

		it('"sdi" lists BOTH the direct government channel and the commercial intermediary (A-Cube)', () => {
			cy.request({ url: `${api}/api/documents/operators?channel=sdi` })
				.its("body")
				.then((operators: { id: string }[]) => {
					expect(operators.map((o) => o.id).sort()).to.deep.equal(["acube", "sdi"]);
				});
		});
	});

	describe("GET /api/documents/transports - credentialFields (scope addition)", () => {
		it('"pdp" declares exactly the three fields its own extractPdpCredentials reads', () => {
			cy.request({ url: `${api}/api/documents/transports` })
				.its("body")
				.then((transports: { id: string; credentialFields: { key: string; required: boolean }[] }[]) => {
					const pdp = transports.find((t) => t.id === "pdp");
					expect(pdp, "the pdp transport is registered").to.exist;
					expect(pdp!.credentialFields.map((f) => f.key).sort()).to.deep.equal(
						["baseUrl", "clientId", "clientSecret"].sort(),
					);
					expect(pdp!.credentialFields.every((f) => f.required)).to.eq(true);
				});
		});

		it('"email" (the built-in transport) declares NO credential fields', () => {
			cy.request({ url: `${api}/api/documents/transports` })
				.its("body")
				.then((transports: { id: string; credentialFields: unknown[] }[]) => {
					const email = transports.find((t) => t.id === "email");
					expect(email, "the email transport is registered").to.exist;
					expect(email!.credentialFields).to.deep.equal([]);
				});
		});

		it('"sdi" marks certificatePassword as NOT required - matching the parser, not the old frontend copy', () => {
			cy.request({ url: `${api}/api/documents/transports` })
				.its("body")
				.then((transports: { id: string; credentialFields: { key: string; required: boolean }[] }[]) => {
					const sdi = transports.find((t) => t.id === "sdi");
					const certPassword = sdi!.credentialFields.find((f) => f.key === "certificatePassword");
					expect(certPassword, "certificatePassword is declared").to.exist;
					expect(certPassword!.required, "a real PFX can carry an empty password").to.eq(false);
				});
		});
	});

	describe("GET /api/company/channels - operatorId (\"say how a pdp account maps to an operator, by baseUrl\")", () => {
		afterEach(() => {
			// Leaves no channel connected between tests in this describe block - each test below
			// connects its own provider and asserts on it in isolation.
			cy.request({ method: "DELETE", url: `${api}/api/company/channels/pdp`, failOnStatusCode: false });
			cy.request({ method: "DELETE", url: `${api}/api/company/channels/acube`, failOnStatusCode: false });
		});

		it("connecting pdp with SuperPDP's real baseUrl resolves operatorId=superpdp", () => {
			cy.request({
				method: "PUT",
				url: `${api}/api/company/channels/pdp`,
				body: {
					environment: "TEST",
					config: {
						baseUrl: "https://api.superpdp.tech",
						clientId: "e2e-fake-client-id",
						clientSecret: "e2e-fake-client-secret",
					},
				},
			}).its("status").should("be.oneOf", [200, 201]);

			cy.request({ url: `${api}/api/company/channels` })
				.its("body")
				.then((body: { configured: { providerId: string; operatorId: string | null }[] }) => {
					const pdp = body.configured.find((c) => c.providerId === "pdp");
					expect(pdp, "the pdp row exists").to.exist;
					expect(pdp!.operatorId, "resolved to SuperPDP by its own baseUrl").to.eq("superpdp");
				});
		});

		// TODAY exactly ONE operator (superpdp) is catalogued under the "pdp" transport - see
		// `operators/registry.spec.ts`'s own header on why the baseUrl-disambiguation branch is
		// proven against a BESPOKE two-operator catalog there (nothing in the real, shipped data
		// exercises it yet). This test documents that real, current behaviour honestly: a single
		// candidate resolves UNCONDITIONALLY, even against a baseUrl the catalogue does not
		// recognise - never a null here today, whatever the connected baseUrl actually is.
		it('connecting pdp with a DIFFERENT baseUrl still resolves operatorId=superpdp today - the only catalogued "pdp" operator', () => {
			cy.request({
				method: "PUT",
				url: `${api}/api/company/channels/pdp`,
				body: {
					environment: "TEST",
					config: {
						baseUrl: CLOSED_PORT_URL,
						clientId: "e2e-fake-client-id",
						clientSecret: "e2e-fake-client-secret",
					},
				},
			}).its("status").should("be.oneOf", [200, 201]);

			cy.request({ url: `${api}/api/company/channels` })
				.its("body")
				.then((body: { configured: { providerId: string; operatorId: string | null }[] }) => {
					const pdp = body.configured.find((c) => c.providerId === "pdp");
					expect(pdp, "the pdp row exists").to.exist;
					expect(
						pdp!.operatorId,
						"single-candidate resolution never reads baseUrl at all, today",
					).to.eq("superpdp");
				});
		});

		it('connecting "acube" (its own dedicated transport, no ambiguity) resolves operatorId=acube', () => {
			cy.request({
				method: "PUT",
				url: `${api}/api/company/channels/acube`,
				body: {
					environment: "TEST",
					config: { email: "e2e-fake@example.com", password: "e2e-fake-password" },
				},
			}).its("status").should("be.oneOf", [200, 201]);

			cy.request({ url: `${api}/api/company/channels` })
				.its("body")
				.then((body: { configured: { providerId: string; operatorId: string | null }[] }) => {
					const acube = body.configured.find((c) => c.providerId === "acube");
					expect(acube, "the acube row exists").to.exist;
					expect(acube!.operatorId, "a single-candidate transport resolves unconditionally").to.eq(
						"acube",
					);
				});
		});

		it("never leaks a credential value - operatorId is derived, the config blob itself stays out of the response", () => {
			cy.request({
				method: "PUT",
				url: `${api}/api/company/channels/pdp`,
				body: {
					environment: "TEST",
					config: {
						baseUrl: "https://api.superpdp.tech",
						clientId: "e2e-fake-client-id",
						clientSecret: "e2e-fake-never-leak-marker-a1b2c3",
					},
				},
			}).its("status").should("be.oneOf", [200, 201]);

			cy.request({ url: `${api}/api/company/channels` })
				.its("body")
				.then((body) => {
					expect(JSON.stringify(body)).to.not.contain("e2e-fake-never-leak-marker-a1b2c3");
				});
		});
	});
});
