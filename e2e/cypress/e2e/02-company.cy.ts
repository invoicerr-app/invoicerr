export {}; // makes this spec a module, not a global script -- see tsconfig.json

const api = Cypress.env("apiUrl") || "http://localhost:4000";

beforeEach(() => {
	cy.login();
});

// The simplified onboarding only collects name + country. The rest of the profile
// (address, contact, currency, numbering/PDF/date formats) is filled in afterwards via
// Settings > Company, which several tests below assume is already valid.
function completeCompanyProfile() {
	cy.visit("/settings/company");
	cy.wait(3000);
	cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should(
		"be.visible",
	);

	cy.get('[data-cy="company-name-input"]').clear().type("Acme Corp");
	cy.get('[data-cy="company-description-input"]')
		.clear()
		.type("A fictional company");
	cy.get('[data-cy="company-phone-input"]').clear().type("+33123456789");
	cy.get('[data-cy="company-email-input"]').clear().type("contact@acme.org");
	cy.get('[data-cy="company-address-input"]').clear().type("123 Main St");
	cy.get('[data-cy="company-address-line2-input"]').clear();
	cy.get('[data-cy="company-city-input"]').clear().type("Paris");
	cy.get('[data-cy="company-state-input"]').clear();
	cy.get('[data-cy="company-postalcode-input"]').clear().type("75001");
	cy.selectCountry("company-country-input", "France");

	// Fill SIRET (required by FR compliance — may be clipped by overflow:hidden)
	cy.get('[data-cy="company-legalid-input"]', { timeout: 10000 }).should(
		"exist",
	);
	cy.get('[data-cy="company-legalid-input"]').scrollIntoView();
	cy.get('[data-cy="company-legalid-input"]')
		.clear({ force: true })
		.type("73282932000074", { force: true });

	cy.get('[data-cy="company-currency-select"] button').first().click();
	cy.wait(300);
	cy.get('[data-cy="company-currency-select-options"]').should("be.visible");
	cy.get('[data-cy="company-currency-select-option-euro-(€)"]').click();

	cy.get('[data-cy="company-pdfformat-select"]').click();
	cy.get('[data-cy="company-pdfformat-option-pdf"]').click();

	cy.get('[data-cy="company-dateformat-select"]').click();
	cy.get('[data-cy="company-dateformat-option-dd-MM-yyyy"]').first().click();

	cy.get('[data-cy="company-submit-btn"]').click();
	cy.wait(5000);
}

/**
 * One entry per FIELD-LEVEL zod check the client-side `companySchema` (`company.settings.tsx`)
 * actually refuses to submit — five of the original six; `email` is its own dedicated test right
 * after this array's `describe` block, for a reason its own comment below explains. `cy.contains(regex)`
 * used to be the only proof here, matched anywhere on the page — and every one of the original six
 * regexes ALSO matches the field's own ALWAYS-VISIBLE label ("Company Name", "Postal Code format is
 * invalid" reads `/format|invalid|postal/i` off a label that literally never disappears): those six
 * tests passed identically whether the real validation fired or the zod rule for that field had been
 * deleted outright. `expectedError` is the EXACT text
 * `FormMessage` renders for that failure (traced to the precise zod check that fires first for
 * `invalidValue` — `.min()`/`.refine()` order matters: see e.g. `phone`, where a value shorter than 8
 * characters trips the LENGTH check before the format `.refine()` ever runs), asserted on the
 * `FormMessage` sibling of the field's own input specifically (`FormItem`'s DOM shape —
 * `form.tsx`: `<FormItem><FormLabel/><FormControl><Input data-cy=".."/></FormControl>
 * <FormMessage/></FormItem>`, `Input` renders no wrapping element of its own, so the input's
 * `.parent()` IS the `FormItem` div holding both it and its own message) — never the page at large.
 */
interface ValidationCase {
	field: string;
	dataCy: string;
	invalidValue: string;
	expectedError: string;
	validValue: string;
}

const VALIDATION_CASES: ValidationCase[] = [
	{ field: "company name", dataCy: "company-name-input", invalidValue: "", expectedError: "Company name cannot be empty", validValue: "Acme Corp" },
	{ field: "address", dataCy: "company-address-input", invalidValue: "", expectedError: "Address is required", validValue: "123 Main St" },
	{ field: "city", dataCy: "company-city-input", invalidValue: "", expectedError: "City is required", validValue: "Paris" },
	// 2 characters: below the format regex's own 3-10 length bound (`/^[0-9A-Z\s-]{3,10}$/`) — the
	// ONLY check this field has, so this is unambiguously the format error, not a second rule racing it.
	{ field: "postal code", dataCy: "company-postalcode-input", invalidValue: "AB", expectedError: "Postal code format is invalid", validValue: "75001" },
	// 8 characters — clears the `.min(8, ...)` length check on its own, so the letter "A" (which the
	// format regex `/^[+]?[0-9\s\-()]{8,20}$/` rejects) is what actually fires here, never the length
	// message a shorter string (e.g. the old test's "123") would trip INSTEAD of the format one this
	// test claims to cover.
	{ field: "phone", dataCy: "company-phone-input", invalidValue: "0000000A", expectedError: "Phone number format is invalid", validValue: "+33123456789" },
	// Email is deliberately NOT in this list — see the dedicated test right after this `describe`
	// block: the input is `type="email"` (native HTML5 constraint validation), which refuses the
	// browser's own submit event before React's `onSubmit`/zodResolver ever run for a shape as
	// malformed as "not-an-email", so neither zod's default `.email()` message nor its `.refine` ever
	// gets a chance to render here — confirmed against a real run, not assumed.
];

describe("Company Settings E2E", () => {
	describe("1 - Initial Company Setup (Required for other tests)", () => {
		it("creates the company via onboarding", () => {
			// Visit root and wait for either onboarding dialog OR dashboard to load
			cy.visit("/");
			cy.wait(5000);

			// Check if onboarding dialog appeared; if not, company already exists.
			// Note: don't gate on offsetParent — DialogContent is `position: fixed`,
			// which makes offsetParent null in every browser regardless of visibility.
			// Radix unmounts the dialog from the DOM when closed, so presence alone
			// is a reliable signal here (same check as scenarios/full-lifecycle.cy.ts).
			cy.document().then((doc) => {
				const dialog = doc.querySelector('[data-cy="onboarding-dialog"]');
				if (dialog) {
					// Step 1 — country only.
					cy.selectCountry("onboarding-company-country-input", "France");
					cy.get('[data-cy="onboarding-country-next-btn"]').click();
					// Step 2 — the national identifier, labeled by the backend. France
					// requires a LEGAL_ID (SIRET) — the wizard refuses to advance without
					// it. "Next" also fires the backend company-lookup search before
					// moving on; it always advances regardless of what that finds.
					cy.get('[data-cy="onboarding-legalid-input"]', { timeout: 10000 })
						.clear({ force: true })
						.type("73282932000074", { force: true });
					cy.get('[data-cy="onboarding-identifier-next-btn"]').click();
					// Step 3 — the company form, pre-filled by whatever the search found.
					cy.get('[data-cy="onboarding-company-name-input"]', {
						timeout: 10000,
					})
						.clear()
						.type("Acme Corp");
					cy.get('[data-cy="onboarding-submit-btn"]').click();
					// Company creation now advances the wizard to the channels step
					// instead of closing the dialog — finish onboarding from there.
					cy.get('[data-cy="onboarding-finish-btn"]', { timeout: 10000 })
						.should("be.visible")
						.click();
					// Company creation switches to the new company and reloads the page —
					// wait for the dialog to be gone and the reloaded app to settle before
					// moving on, otherwise later steps race the reload.
					cy.get('[data-cy="onboarding-dialog"]', { timeout: 20000 }).should(
						"not.exist",
					);
					cy.wait(3000);
				} else {
					cy.log("Onboarding dialog not visible — company already exists");
				}
			});

			// Ensure company exists before continuing to other tests
			cy.visit("/settings/company");
			cy.wait(3000);
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should(
				"be.visible",
			);
			cy.get('[data-cy="company-name-input"]')
				.invoke("val")
				.then((val) => {
					if (!val) {
						cy.get('[data-cy="company-name-input"]').clear().type("Acme Corp");
						cy.selectCountry("company-country-input", "France");
						cy.get('[data-cy="company-legalid-input"]', { timeout: 10000 })
							.scrollIntoView()
							.clear({ force: true })
							.type("73282932000074", { force: true });
						cy.get('[data-cy="company-address-input"]')
							.clear()
							.type("123 Rue de Rivoli");
						cy.get('[data-cy="company-city-input"]').clear().type("Paris");
						cy.get('[data-cy="company-postalcode-input"]')
							.clear()
							.type("75001");
						cy.get('[data-cy="company-submit-btn"]').click();
						cy.wait(5000);
						// Re-fetch from the server rather than trusting the still-typed
						// local form state, so this assertion can't false-positive on a
						// submit that actually failed server-side.
						cy.visit("/settings/company");
						cy.wait(3000);
					}
				});
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should(
				"have.value",
				"Acme Corp",
			);
		});
	});

	describe("2 - Complete Company Profile (Required for other tests)", () => {
		it("fills in the rest of the company profile via Settings", () => {
			completeCompanyProfile();

			cy.visit("/settings/company");
			cy.wait(3000);
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should(
				"be.visible",
			);
			cy.get('[data-cy="company-address-input"]').should(
				"have.value",
				"123 Main St",
			);
		});
	});

	describe("3 - Validation Errors", () => {
		VALIDATION_CASES.forEach(({ field, dataCy, invalidValue, expectedError, validValue }) => {
			it(`refuses to submit with an invalid ${field}, then accepts it once fixed`, () => {
				cy.visit("/settings/company");
				cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("be.visible");

				cy.intercept("POST", `${api}/api/company/info`).as("saveCompany");

				// NEGATIVE — client-side zod refuses the submission outright (never a bare
				// `cy.contains` on the page: that also matches the field's own always-visible label).
				const field$ = cy.get(`[data-cy="${dataCy}"]`, { timeout: 10000 });
				if (invalidValue === "") {
					field$.clear();
				} else {
					field$.clear().type(invalidValue);
				}
				cy.get('[data-cy="company-submit-btn"]').click();
				cy.get(`[data-cy="${dataCy}"]`)
					.parent()
					.should("contain.text", expectedError);
				// The form never even reached the network — `zodResolver` blocks `onSubmit` itself.
				cy.get("@saveCompany.all").should("have.length", 0);

				// POSITIVE — the SAME field, fixed, submits for real and the message disappears.
				cy.get(`[data-cy="${dataCy}"]`).clear().type(validValue);
				cy.get('[data-cy="company-submit-btn"]').click();
				cy.wait("@saveCompany", { timeout: 10000 }).then((interception) => {
					expect(interception.response?.statusCode, `${field} accepted once valid`).to.be.oneOf([
						200, 201,
					]);
				});
				cy.get(`[data-cy="${dataCy}"]`).parent().should("not.contain.text", expectedError);
			});
		});

		it("refuses to submit with an invalid email (native HTML5 constraint), then accepts it once fixed", () => {
			cy.visit("/settings/company");
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("be.visible");

			cy.intercept("POST", `${api}/api/company/info`).as("saveCompany");

			// NEGATIVE — `type="email"` makes this the browser's OWN constraint validation, not
			// React/zod: the submit event never fires at all, so there is no `FormMessage` to read
			// here (verified against a real run) — `validity.valid` on the input element itself is
			// the actual, honest proof a malformed email was refused.
			cy.get('[data-cy="company-email-input"]').clear().type("not-an-email");
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.get('[data-cy="company-email-input"]').then(($input) => {
				expect(
					($input[0] as HTMLInputElement).validity.valid,
					"the browser's own email constraint refuses this value",
				).to.eq(false);
			});
			cy.get("@saveCompany.all").should("have.length", 0);

			// POSITIVE — fixed, the native constraint clears and the save reaches the network for real.
			cy.get('[data-cy="company-email-input"]').clear().type("contact@acme.org");
			cy.get('[data-cy="company-email-input"]').then(($input) => {
				expect(($input[0] as HTMLInputElement).validity.valid, "a real email validates").to.eq(
					true,
				);
			});
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.wait("@saveCompany", { timeout: 10000 }).then((interception) => {
				expect(interception.response?.statusCode, "email accepted once valid").to.be.oneOf([
					200, 201,
				]);
			});
		});
	});

	describe("Extended Address Fields", () => {
		it("updates company with addressLine2 and state", () => {
			cy.visit("/settings/company");
			cy.wait(3000);
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should(
				"be.visible",
			);

			cy.get('[data-cy="company-legalid-input"]', { timeout: 10000 }).should(
				"exist",
			);
			cy.get('[data-cy="company-legalid-input"]').scrollIntoView();
			cy.get('[data-cy="company-legalid-input"]')
				.clear({ force: true })
				.type("73282932000074", { force: true });

			cy.get('[data-cy="company-address-line2-input"]')
				.clear()
				.type("Building A, Floor 5");
			cy.get('[data-cy="company-state-input"]').clear().type("Île-de-France");

			cy.get('[data-cy="company-submit-btn"]').click();
			cy.wait(2000);

			cy.visit("/settings/company");
			cy.wait(3000);
			cy.get('[data-cy="company-address-line2-input"]', {
				timeout: 10000,
			}).should("have.value", "Building A, Floor 5");
			cy.get('[data-cy="company-state-input"]').should(
				"have.value",
				"Île-de-France",
			);
			// The screen's own re-render is not proof by itself — it reads from the same client-side
			// form state the save just populated, so a save that silently dropped the identifier
			// server-side would still show the typed value here. `company-legalid-input` is re-hydrated
			// from `partyIdentifiers` on load (see `company.settings.tsx`), so asserting its value AFTER
			// this fresh visit already leans on the API — this test additionally hits `/api/company/info`
			// directly for the exact regression this PR fixes: out-of-catalog identifiers wiped on save.
			cy.get('[data-cy="company-legalid-input"]').should(
				"have.value",
				"73282932000074",
			);
			// `deep.include` on an array requires an element deep-EQUAL to the given object — the real
			// `PartyIdentifier` row also carries `id`/`companyId`/`validationStatus`/timestamps, so that
			// assertion never matches whatever was actually saved (see `assertIdentifierOnFile` further
			// down this same file for the identical gotcha). A `.find()` on the two fields that matter
			// is what that helper — and `scenarios/full-lifecycle.cy.ts`'s own lookup — already use.
			cy.request({ url: `${api}/api/company/info` })
				.its("body.partyIdentifiers")
				.then((partyIdentifiers: { scheme: string; value: string }[]) => {
					const legalId = partyIdentifiers.find((pi) => pi.scheme === "LEGAL_ID");
					expect(legalId, "LEGAL_ID is present in partyIdentifiers").to.exist;
					expect(legalId!.value, "LEGAL_ID's own stored value").to.eq("73282932000074");
				});
		});

		it("updates company with US state abbreviation", () => {
			cy.visit("/settings/company");
			cy.wait(3000);
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should(
				"be.visible",
			);

			// Fill SIRET while country is still FR (before switching to US)
			cy.get('[data-cy="company-legalid-input"]', { timeout: 10000 }).should(
				"exist",
			);
			cy.get('[data-cy="company-legalid-input"]').scrollIntoView();
			cy.get('[data-cy="company-legalid-input"]')
				.clear({ force: true })
				.type("73282932000074", { force: true });

			cy.get('[data-cy="company-address-input"]')
				.clear()
				.type("1234 Tech Boulevard");
			cy.get('[data-cy="company-address-line2-input"]')
				.clear()
				.type("Suite 100");
			cy.get('[data-cy="company-city-input"]').clear().type("Austin");
			cy.get('[data-cy="company-state-input"]').clear().type("TX");
			cy.get('[data-cy="company-postalcode-input"]').clear().type("78701");
			cy.selectCountry("company-country-input", "France");

			cy.get('[data-cy="company-submit-btn"]').click();
			cy.wait(2000);

			cy.visit("/settings/company");
			cy.wait(3000);
			cy.get('[data-cy="company-address-line2-input"]', {
				timeout: 10000,
			}).should("have.value", "Suite 100");
			cy.get('[data-cy="company-state-input"]').should("have.value", "TX");
		});

		it("clears addressLine2 and state fields", () => {
			cy.visit("/settings/company");
			cy.wait(3000);
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should(
				"be.visible",
			);

			cy.get('[data-cy="company-legalid-input"]', { timeout: 10000 }).should(
				"exist",
			);
			cy.get('[data-cy="company-legalid-input"]').scrollIntoView();
			cy.get('[data-cy="company-legalid-input"]')
				.clear({ force: true })
				.type("73282932000074", { force: true });

			cy.get('[data-cy="company-address-line2-input"]').clear();
			cy.get('[data-cy="company-state-input"]').clear();

			cy.get('[data-cy="company-submit-btn"]').click();
			cy.wait(2000);

			cy.visit("/settings/company");
			cy.wait(3000);
			cy.get('[data-cy="company-address-line2-input"]', {
				timeout: 10000,
			}).should("have.value", "");
			cy.get('[data-cy="company-state-input"]').should("have.value", "");
		});
	});

	describe("4 - Edge Cases", () => {
		it("handles special characters in company name", () => {
			cy.visit("/settings/company");
			cy.get('[data-cy="company-name-input"]', { timeout: 10000 })
				.clear()
				.type("O'Reilly & Associates");
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.wait(1000);
			cy.get('[data-cy="company-name-input"]')
				.invoke("val")
				.should("contain", "O'Reilly");
		});

		it("handles unicode characters in company name", () => {
			cy.visit("/settings/company");
			cy.get('[data-cy="company-name-input"]', { timeout: 10000 })
				.clear()
				.type("Société Générale");
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.wait(1000);
			cy.get('[data-cy="company-name-input"]')
				.invoke("val")
				.should("contain", "Société");
		});

		it("shows error for description exceeding max length", () => {
			cy.visit("/settings/company");
			const tooLongDescription = "A".repeat(501);
			cy.get('[data-cy="company-description-input"]', { timeout: 10000 })
				.clear()
				.type(tooLongDescription, { delay: 0 });
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.contains(/max|length|500|characters|caractères/i);
		});

		// The test "validates starting numbers are positive" was REMOVED on 2026-09-13, not
		// weakened: the field it drove (`input[name="quoteStartingNumber"]`) no longer exists.
		// The three starting numbers were removed from the screen because no sequence
		// honored them — `numbering/sequence.ts` always starts a counter (company, type) at 1 — so
		// the "positive" constraint was validating a field whose value never reached a
		// document. The "start my numbering at 500" capability is therefore absent from the product,
		// tracked as a real feature to build rather than simulated by a decorative check.
		// The day it exists, it is an END-TO-END test that will need to be written: enter 500,
		// issue, and read the document's number — not a form-validation test.
	});

	describe("5 - A country-specific identifier survives a country change, until removed on purpose", () => {
		// The guard this proves: `company.settings.tsx`'s own "sync identifiers with the country
		// catalog" effect only ADDS a blank row for a newly-required scheme and PRUNES an EMPTY
		// placeholder row for a no-longer-required one — it must never touch a row that actually
		// carries a value, no matter whose scheme it is. Before this guard existed, switching country
		// silently deleted such a row on the very next save, with no warning. Italy's own
		// "IT_PA_CODE" (Codice Univoco Ufficio, `country-identifiers/data/it.json`) is used here
		// because it is the one scheme among FR/DE/IT/PL/PT no OTHER supported country offers — moving
		// away from Italy is guaranteed to orphan it, unlike LEGAL_ID/VAT, which every one of the five
		// countries offers under some form.
		const IT_PA_CODE_LABEL = "Codice Univoco Ufficio (IPA)";
		const IT_PA_CODE_VALUE = "ABC123";

		// `deep.include` on an array requires an element deep-EQUAL to the given object — the real
		// `PartyIdentifier` row also carries `id`/`companyId`/`validationStatus`/timestamps, so that
		// assertion would never match no matter what was actually saved. A `.find()` on the two fields
		// that matter is what `scenarios/full-lifecycle.cy.ts`'s own `ClientSearchResult` lookup
		// already does for the identical shape.
		function assertIdentifierOnFile(scheme: string, value: string) {
			return cy
				.request(`${api}/api/company/info`)
				.its("body.partyIdentifiers")
				.then((partyIdentifiers: { scheme: string; value: string }[]) => {
					const found = partyIdentifiers.find((pi) => pi.scheme === scheme);
					expect(found, `${scheme} is present in partyIdentifiers`).to.exist;
					expect(found!.value, `${scheme}'s own stored value`).to.eq(value);
				});
		}

		// `cy.selectCountry` (commands.ts) has no open-side retry of its own, unlike the newer
		// `openSelect`/`openSearchSelect`/`openDatePicker` — this test's own trigger sits right after
		// FIVE prior tests' worth of dialogs/toasts/saves, deep enough into the run that it hit the
		// exact "stale DismissableLayer pointerdown listener" race those three commands' own headers
		// document (verified: this same test passes every time in isolation, and only flakes at this
		// position in the full 16-test file — a timing race, not a logic defect). NOT implemented as a
		// `.then()` wrapped around a plain call to `cy.selectCountry`: that command's own two
		// `.should('exist')` checks are HARD Cypress assertions that abort the whole test the instant
		// either one times out, so a retry loop sitting AROUND such a call could only ever catch "the
		// wrong country ended up selected" — never "the popover (or the option inside it) never
		// appeared at all", which is the actual shape this race takes (confirmed against a real replay:
		// `commands.ts`'s own `${dataCy}-options` / `${dataCy}-option-...` assertions are what throws,
		// not this function's own post-click check). Reimplemented here with SOFT existence checks
		// (`$body.find(...).length`, never a `.should` that throws) at both the popover-open and the
		// option-appears steps, so either miss retries the ENTIRE open→type→pick sequence instead of
		// crashing the test outright. Bounded retry lives here rather than widening `selectCountry`
		// itself, which every OTHER caller (`05-clients.cy.ts`, `40-b2g-routing.cy.ts`,
		// `completeCompanyProfile` above) already relies on as-is.
		function selectCountryRetrying(dataCy: string, countryName: string, attempt = 1) {
			const slug = countryName.toLowerCase().replace(/\s+/g, "-");
			const optionSelector = `[data-cy="${dataCy}-option-${slug}"]`;
			const retryOrFail = (reason: string) => {
				if (attempt >= 3) {
					throw new Error(`selectCountryRetrying: "${dataCy}" -> "${countryName}": ${reason} (3 attempts)`);
				}
				// `{esc}` first: a half-open popover left over from the failed attempt would otherwise
				// swallow the next attempt's own trigger click.
				cy.get("body").type("{esc}", { force: true });
				selectCountryRetrying(dataCy, countryName, attempt + 1);
			};

			cy.get(`[data-cy="${dataCy}"] button`).first().click({ force: true });
			cy.wait(500);
			cy.get("body").then(($body) => {
				if ($body.find(`[data-cy="${dataCy}-options"]`).length === 0) {
					retryOrFail("popover never opened");
					return;
				}
				cy.get(`[data-cy="${dataCy}"] input`).clear({ force: true }).type(countryName, { force: true });
				cy.wait(300);
				cy.get("body").then(($body2) => {
					if ($body2.find(optionSelector).length === 0) {
						retryOrFail("option never appeared");
						return;
					}
					cy.get(optionSelector).click({ force: true });
					cy.get(`[data-cy="${dataCy}"] button`, { timeout: 4000 }).then(($button) => {
						if (!$button.text().includes(countryName)) {
							retryOrFail("selection did not stick");
						}
					});
				});
			});
		}

		it("typing it under Italy, then switching to France and saving, keeps it on file — until Remove is clicked", () => {
			cy.visit("/settings/company");
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("be.visible");

			selectCountryRetrying("company-country-input", "Italy");
			cy.get(`input[placeholder="${IT_PA_CODE_LABEL}"]`, { timeout: 10000 })
				.should("be.visible")
				.type(IT_PA_CODE_VALUE);

			cy.intercept("POST", `${api}/api/company/info`).as("saveCompany");
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.wait("@saveCompany", { timeout: 10000 }).then((interception) => {
				expect(interception.response?.statusCode, "saved under Italy").to.be.oneOf([200, 201]);
			});

			assertIdentifierOnFile("IT_PA_CODE", IT_PA_CODE_VALUE);

			// The regression itself: switch to a country that does NOT offer IT_PA_CODE at all, and
			// save WITHOUT touching the identifier — a reverted sync effect would silently drop it here.
			cy.visit("/settings/company");
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("be.visible");
			selectCountryRetrying("company-country-input", "France");
			cy.get('[data-cy="company-legalid-input"]', { timeout: 10000 })
				.scrollIntoView()
				.clear({ force: true })
				.type("73282932000074", { force: true });

			// Shown explicitly, not silently carried — the whole point of the "on file" section.
			cy.get('[data-cy="company-identifiers-on-file"]')
				.should("be.visible")
				.and("contain.text", "IT_PA_CODE")
				.and("contain.text", IT_PA_CODE_VALUE);

			cy.intercept("POST", `${api}/api/company/info`).as("saveUnderFrance");
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.wait("@saveUnderFrance", { timeout: 10000 }).then((interception) => {
				expect(interception.response?.statusCode, "saved under France").to.be.oneOf([200, 201]);
			});

			assertIdentifierOnFile("IT_PA_CODE", IT_PA_CODE_VALUE);

			// Only a DELIBERATE click removes it — proves the button works and leaves a clean
			// baseline (no stray identifier) for every test that runs after this one in the suite.
			cy.visit("/settings/company");
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should("be.visible");
			cy.get('[data-cy="company-identifier-remove-IT_PA_CODE"]', { timeout: 10000 }).click();

			cy.intercept("POST", `${api}/api/company/info`).as("saveAfterRemove");
			cy.get('[data-cy="company-submit-btn"]').click();
			cy.wait("@saveAfterRemove", { timeout: 10000 }).then((interception) => {
				expect(interception.response?.statusCode, "saved after a deliberate removal").to.be.oneOf([
					200, 201,
				]);
			});

			cy.request(`${api}/api/company/info`)
				.its("body.partyIdentifiers")
				.then((partyIdentifiers: { scheme: string; value: string }[]) => {
					expect(
						partyIdentifiers.some((pi) => pi.scheme === "IT_PA_CODE"),
						"IT_PA_CODE is gone once removed on purpose",
					).to.eq(false);
				});
		});
	});

	describe("6 - Restore Valid State (Must run last)", () => {
		it("restores valid company settings for other tests", () => {
			completeCompanyProfile();

			cy.visit("/settings/company");
			cy.wait(3000);
			cy.get('[data-cy="company-name-input"]', { timeout: 15000 }).should(
				"be.visible",
			);
			cy.get('[data-cy="company-name-input"]').should(
				"have.value",
				"Acme Corp",
			);
		});
	});
});
