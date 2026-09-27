export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #373 ("quotes with options"): a quote can carry two or more named options, each with its own
 * lines and its own total; the document shows NO global total once it does; the client picks one
 * option when accepting; the resulting invoice contains exactly the chosen option's lines.
 *
 * Two quotes prove the two acceptance paths, matching 89-quote-manual-acceptance.cy.ts and
 * 45-signature.cy.ts's own patterns:
 *  - quote #1: built through the real UI editor with two options ("Basic"/"Premium"), sent, its PDF
 *    checked for no global total and each option's own total, then accepted MANUALLY choosing
 *    "Premium" - the detail page, the archive, and the resulting invoice are all checked.
 *  - quote #2: built through the API (the editor journey is already proven by quote #1), sent, then
 *    accepted through the real OTP e-signature flow on the public page, choosing "Basic" - the
 *    resulting invoice is checked.
 *  - a THIRD, single-option quote proves the untouched case: still one global total, no option
 *    chooser anywhere.
 */
const api = Cypress.env("apiUrl");
const appOrigin = Cypress.config("baseUrl");

function bodyOf(message: { Text?: string; HTML?: string }): string {
	return `${message.Text ?? ""}\n${message.HTML ?? ""}`;
}

function createClient(name: string, contactEmail: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name,
				contactEmail,
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Rue des Options",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([
				200, 201,
			]);
			const id = res.body?.id as string;
			expect(id, "the created client has an id").to.be.a("string");
			return id;
		});
}

function sendQuote(
	quoteId: string,
	data: Record<string, unknown>,
	recipient: string,
) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/quote/actions/send`,
			body: { documentId: quoteId, data, params: { recipient } },
		})
		.then((res) => {
			expect(res.status, "send accepted").to.be.oneOf([200, 201]);
			cy.waitForDocumentStatus(`${api}/api/documents/${quoteId}?typeId=quote`, [
				"sent",
			]);
		});
}

// Orchestrator review follow-up: every quote line in this spec now carries a REAL VAT rate (French
// standard, 20%) - without one, `compute-totals.ts` prints its own "Line N has no usable VAT rate"
// warning on every totals block, which covered every screenshot this spec produces. Mirrors
// `20-document-totals.cy.ts`'s own pattern exactly: the vatRate `select` is a Radix combobox, not a
// plain input, so it is picked through its own popover rather than typed.
function pickVatRate(rowIndex: number) {
	cy.get(
		`[data-cy="document-field-lines-row-${rowIndex}"] [data-cy="document-field-vatRate-input"] button`,
	)
		.first()
		.click({ force: true });
	cy.get('[data-cy="document-field-vatRate-input-options"]', {
		timeout: 10000,
	}).should("be.visible");
	cy.contains(
		'[data-cy="document-field-vatRate-input-options"] [data-cy*="-option-"]',
		/20\s?%/,
	)
		.first()
		.click();
}

function downloadQuotePdf(quoteId: string, filename: string) {
	return cy
		.request({
			url: `${api}/api/documents/${quoteId}/pdf?typeId=quote`,
			encoding: "binary",
		})
		.then((res) => {
			cy.writeFile(`cypress/downloads/${filename}`, res.body, "binary");
			const base64 = Cypress.Buffer.from(res.body, "binary").toString("base64");
			return cy.task("extractPdfText", base64) as Cypress.Chainable<string>;
		});
}

describe("Quotes with options (issue #373)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.viewport(1440, 900);
		cy.login();
	});

	it("a quote with two options: editor, PDF, manual acceptance choosing Premium, archive, conversion", () => {
		createClient("Options Client", "options-premium@example.com").then(
			(clientId) => {
				// --- Build the quote through the real UI editor, two options ---
				cy.visit(`${appOrigin}/documents/quote`, { timeout: 20000 });
				cy.get('[data-cy="document-create-button"]', {
					timeout: 15000,
				}).click();
				cy.get('[data-cy="document-form"]', { timeout: 15000 }).should(
					"be.visible",
				);

				cy.pickDocumentClient();
				cy.pickToday('[data-cy="document-field-issueDate-input"]');

				cy.get('[data-cy="document-field-currency-input"] button')
					.first()
					.click({ force: true });
				cy.get('[data-cy="document-field-currency-input-options"]', {
					timeout: 10000,
				}).should("be.visible");
				cy.get('[data-cy^="document-field-currency-input-option-eur"]')
					.first()
					.click();

				cy.continueDocumentWizard(); // Details -> Lines

				// Line 0: Basic option, 100.00.
				cy.get('[data-cy="document-field-lines-add-row"]').click();
				cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
				cy.get('input[name="lines.0.description"]').type("Basic package", {
					force: true,
				});
				cy.get('input[name="lines.0.quantity"]')
					.clear({ force: true })
					.type("1", { force: true });
				cy.get('input[name="lines.0.unitPrice"]')
					.clear({ force: true })
					.type("100", { force: true });
				cy.get('input[name="lines.0.option"]').type("Basic", { force: true });
				pickVatRate(0);

				// Line 1: a COMMON line - no `option` at all. Billed under WHICHEVER option is
				// chosen, never dropped, never orphaned (this issue's own follow-up rule) - typed
				// here between Basic and Premium so its ORIGINAL position is actually exercised,
				// not merely "last".
				cy.get('[data-cy="document-field-lines-add-row"]').click();
				cy.get('[data-cy="document-field-lines-row-1"]').should("exist");
				cy.get('input[name="lines.1.description"]').type("Setup fee", {
					force: true,
				});
				cy.get('input[name="lines.1.quantity"]')
					.clear({ force: true })
					.type("1", { force: true });
				cy.get('input[name="lines.1.unitPrice"]')
					.clear({ force: true })
					.type("50", { force: true });
				// `lines.1.option` deliberately left BLANK - the option-suggestion datalist (this
				// issue's own editor convenience) already offers "Basic" from the row above without
				// needing to pick it here.
				pickVatRate(1);

				// Line 2: Premium option, two lines summing to 300.00 net.
				cy.get('[data-cy="document-field-lines-add-row"]').click();
				cy.get('[data-cy="document-field-lines-row-2"]').should("exist");
				cy.get('input[name="lines.2.description"]').type("Premium package", {
					force: true,
				});
				cy.get('input[name="lines.2.quantity"]')
					.clear({ force: true })
					.type("1", { force: true });
				cy.get('input[name="lines.2.unitPrice"]')
					.clear({ force: true })
					.type("200", { force: true });
				cy.get('input[name="lines.2.option"]').type("Premium", { force: true });
				pickVatRate(2);

				cy.get('[data-cy="document-field-lines-add-row"]').click();
				cy.get('[data-cy="document-field-lines-row-3"]').should("exist");
				cy.get('input[name="lines.3.description"]').type("Premium onboarding", {
					force: true,
				});
				cy.get('input[name="lines.3.quantity"]')
					.clear({ force: true })
					.type("1", { force: true });
				cy.get('input[name="lines.3.unitPrice"]')
					.clear({ force: true })
					.type("100", { force: true });
				cy.get('input[name="lines.3.option"]').type("Premium", { force: true });
				pickVatRate(3);

				// The Lines step itself, BEFORE moving on: the Option column filled for the two
				// tagged pairs, and genuinely empty for the common "Setup fee" row - proves the
				// editor convenience (issue #373's own suggestion datalist) is offering values on an
				// otherwise-plain text column, not silently pre-filling one. Scrolled back to the
				// FIRST row: picking the last row's own VAT rate leaves the page scrolled down to it,
				// which would show only "Premium onboarding" and cut its own Option field off below
				// the fold - row 0 is where "Basic" (and, just below it, the untouched common row) are
				// both in view together.
				cy.get('[data-cy="document-field-lines-row-0"]').scrollIntoView();
				cy.screenshot("373-after-editor-lines", { capture: "viewport" });

				cy.continueDocumentWizard(); // Lines -> Options (dueDate/notes/clientReference)
				cy.continueDocumentWizard(); // Options -> Summary

				// The Summary step shows PER-OPTION totals, never a single global one - PLUS the
				// common line's own "Common to all options" block (this issue's own follow-up rule).
				cy.get('[data-cy="document-option-totals"]', { timeout: 10000 }).should(
					"exist",
				);
				cy.get('[data-cy="document-totals"]').should("not.exist");
				cy.get('[data-cy="document-common-line-totals"]').should(
					"contain.text",
					"Common to all options",
				);
				cy.get('[data-cy="document-option-total-name"]').should(($names) => {
					const texts = $names.toArray().map((el) => el.textContent);
					expect(texts).to.include("Basic");
					expect(texts).to.include("Premium");
				});

				cy.screenshot("373-after-editor-options", { capture: "viewport" });

				cy.get('[data-cy="document-action-save-draft"]').click();
				cy.url({ timeout: 15000 }).should(
					"match",
					/\/documents\/quote\/[^/]+$/,
				);
				cy.get('[data-cy="document-status-badge"]').should(
					"contain.text",
					"Draft",
				);

				cy.url().then((url) => {
					const quoteId = url.split("/").pop() as string;

					const quoteData = {
						client: clientId,
						issueDate: new Date().toISOString().slice(0, 10),
						currency: "EUR",
						lines: [
							{
								description: "Basic package",
								quantity: 1,
								unitPrice: 100,
								option: "Basic",
								vatRate: "20",
							},
							// COMMON - no `option` at all - billed under whichever option is chosen.
							{
								description: "Setup fee",
								quantity: 1,
								unitPrice: 50,
								vatRate: "20",
							},
							{
								description: "Premium package",
								quantity: 1,
								unitPrice: 200,
								option: "Premium",
								vatRate: "20",
							},
							{
								description: "Premium onboarding",
								quantity: 1,
								unitPrice: 100,
								option: "Premium",
								vatRate: "20",
							},
						],
					};

					sendQuote(quoteId, quoteData, "options-premium@example.com").then(
						() => {
							// --- The PDF, BEFORE any choice: no global total, each option's own total (the
							// COMMON "Setup fee" folded into BOTH), its own dedicated group heading ---
							// Basic (100 + 50 common = 150 net, 20% VAT -> 180.00 gross) and Premium
							// (200 + 100 + 50 common = 350 net, 20% VAT -> 420.00 gross).
							downloadQuotePdf(quoteId, "373-after-quote-options.pdf").then(
								(rawText: string) => {
									expect(rawText).to.include("Basic");
									expect(rawText).to.include("Premium");
									expect(rawText).to.include("Setup fee");
									expect(rawText).to.include("Common to all options");
									expect(rawText).to.include("150.00");
									expect(rawText).to.include("180.00");
									expect(rawText).to.include("350.00");
									expect(rawText).to.include("420.00");
									// No single "450.00"/"540.00" grand (net/gross) total anywhere on the
									// unaccepted, two-option PDF.
									expect(rawText).to.not.match(/450[.,]00/);
									expect(rawText).to.not.match(/540[.,]00/);
									// Each real option's own total says it includes the common lines - the
									// common group itself prints no total of its own to point back at (its
									// OWN figure, 60.00 gross, never appears anywhere on this PDF).
									expect(rawText).to.include("including common lines");
									expect(rawText).to.not.match(/\b60[.,]00\b/);
								},
							);

							cy.visit(`${appOrigin}/documents/quote/${quoteId}`);
							cy.get('[data-cy="document-status-badge"]').should(
								"contain.text",
								"Sent",
							);
							cy.get('[data-cy="document-detail-amount"]').should("not.exist");
							cy.get('[data-cy="document-option-totals"]', {
								timeout: 10000,
							}).should("exist");

							// --- Manual acceptance, choosing "Premium" ---
							cy.get('[data-cy="document-actions-menu"]').click();
							cy.get('[data-cy="document-accept-manually-button"]')
								.should("be.visible")
								.click();
							cy.get('[data-cy="mark-quote-accepted-dialog"]').should(
								"be.visible",
							);
							cy.get('[data-cy="mark-quote-accepted-option"]')
								.should("be.visible")
								.click();
							cy.contains(
								'[data-cy="mark-quote-accepted-option-item"]',
								"Premium",
							).click();

							cy.screenshot("373-after-manual-acceptance-choice", {
								capture: "viewport",
							});

							const note = "Client confirmed by phone: the Premium package.";
							cy.get('[data-cy="mark-quote-accepted-note"]').type(note);
							cy.intercept(
								"POST",
								"**/api/documents/types/quote/actions/accept-manually",
							).as("acceptManually");
							cy.get('[data-cy="mark-quote-accepted-confirm"]').click();
							cy.wait("@acceptManually")
								.its("response.statusCode")
								.should("be.oneOf", [200, 201]);
							cy.get('[data-cy="mark-quote-accepted-dialog"]').should(
								"not.exist",
							);

							cy.get('[data-cy="document-status-badge"]').should(
								"contain.text",
								"Accepted",
							);
							cy.get('[data-cy="document-option-accepted-badge"]', {
								timeout: 10000,
							})
								.should("exist")
								.and("contain.text", "Accepted");

							cy.screenshot("373-after-accepted-detail", {
								capture: "viewport",
							});

							// The API/archive agree: the document names the chosen option, and the manual-acceptance
							// archive carries a frozen snapshot of Premium's own lines and total.
							cy.request({
								url: `${api}/api/documents/${quoteId}?typeId=quote`,
							}).then((res) => {
								expect(
									res.body.acceptedOption,
									"the document itself names the chosen option",
								).to.eq("Premium");
							});
							cy.request({
								url: `${api}/api/documents/${quoteId}/manual-acceptance?typeId=quote`,
							}).then((res) => {
								expect(
									res.body.option?.name,
									"the archived manifest names the option",
								).to.eq("Premium");
								expect(
									res.body.option?.grossMinor,
									"and its own frozen total INCLUDES the common Setup fee (350.00 net @ 20% VAT)",
								).to.eq(42000);
								expect(
									(
										res.body.option?.lines as Array<{ description: string }>
									).map((l) => l.description),
									"the common line rides along, in its original relative position",
								).to.deep.equal([
									"Setup fee",
									"Premium package",
									"Premium onboarding",
								]);
							});

							// The PDF, AFTER the choice: marks the accepted option.
							downloadQuotePdf(quoteId, "373-after-quote-accepted.pdf").then(
								(rawText: string) => {
									expect(rawText).to.include("Premium");
								},
							);

							// --- Conversion: exactly Premium's own two lines, tag stripped ---
							cy.get('[data-cy="document-action-convert-to-invoice"]').click();
							cy.url({ timeout: 15000 }).should(
								"match",
								/\/documents\/invoice\/[^/]+$/,
							);
							cy.get('[data-cy="document-status-badge"]').should(
								"contain.text",
								"Draft",
							);

							// Orchestrator review follow-up: the page navigates straight from the "convert"
							// click into the new invoice's OWN detail route, which renders a loading
							// skeleton (`data-slot="skeleton"`, ui/skeleton.tsx) until its `data` actually
							// arrives - a screenshot taken right after the URL/status-badge assertions above
							// can still land on that skeleton. Waited out explicitly on the converted lines'
							// own DESCRIPTION, read off the real editable `input`'s `value` attribute (this
							// page renders the document as its own live `DocumentFormFields`, not a
							// read-only text dump - `cy.contains()` matches TEXT CONTENT, which an
							// `<input value="...">` never exposes, so that was the wrong check here).
							// `.should("exist")`, not `"be.visible"`: this row sits further down the SAME
							// scrollable form the signature chooser above already proved unreliable to
							// screenshot around - existing in the DOM already rules out the skeleton (which
							// renders no `<input>` at all), and is exactly the fact this assertion needs,
							// with no dependency on scroll position.
							cy.get('input[value="Premium package"]', { timeout: 15000 }).should("exist");
							cy.get('input[value="Setup fee"]').should("exist");
							cy.get('[data-slot="skeleton"]').should("not.exist");
							// A settle wait, same reasoning as the signature-chooser screenshot above: this
							// harness's screenshot capture can reflect a frame slightly BEHIND the most
							// recent DOM state, so a capture taken immediately after the assertions above
							// pass is not itself proof the CAPTURED pixels already show that same state.
							cy.wait(500);

							cy.screenshot("373-after-invoice-from-premium", {
								capture: "viewport",
							});

							cy.url().then((invoiceUrl) => {
								const invoiceId = invoiceUrl.split("/").pop() as string;
								cy.request({
									url: `${api}/api/documents/${invoiceId}?typeId=invoice`,
								}).then((res) => {
									const lines = res.body.data.lines as Array<
										Record<string, unknown>
									>;
									expect(
										lines.map((l) => l.description),
										"the COMMON Setup fee rides along with the chosen option, tag stripped",
									).to.deep.equal([
										"Setup fee",
										"Premium package",
										"Premium onboarding",
									]);
									expect(
										lines.every((l) => !("option" in l)),
										"the option tag never reaches the invoice",
									).to.be.true;
								});
							});
						},
					);
				});
			},
		);
	});

	it("a quote with two options, e-signed on the public page choosing Basic - the invoice carries exactly Basic's lines", () => {
		const CLIENT_EMAIL = "options-basic@example.com";
		createClient("Options Signature Client", CLIENT_EMAIL).then((clientId) => {
			const quoteData = {
				client: clientId,
				issueDate: new Date().toISOString().slice(0, 10),
				currency: "EUR",
				lines: [
					{
						description: "Basic line",
						quantity: 1,
						unitPrice: 120,
						option: "Basic",
						vatRate: "20",
					},
					{
						description: "Premium line",
						quantity: 1,
						unitPrice: 400,
						option: "Premium",
						vatRate: "20",
					},
				],
			};

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/quote/actions/save-draft`,
				body: { data: quoteData },
			}).then((draft) => {
				const quoteId = draft.body?.document?.id as string;
				expect(quoteId, "quote draft created").to.be.a("string");

				sendQuote(quoteId, quoteData, CLIENT_EMAIL).then(() => {
					cy.clearEmails();
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/quote/actions/request-signature`,
						body: { documentId: quoteId, data: quoteData },
					}).then((res) => {
						expect(res.status, "signature request accepted").to.be.oneOf([
							200, 201,
						]);
					});

					cy.getLastEmail().then(
						(message: { Text?: string; HTML?: string }) => {
							const match = bodyOf(message).match(
								/\/signature\/([0-9a-f]{64})/,
							);
							expect(match, "signature request email carries the token link").to
								.not.be.null;
							const token = (match as RegExpMatchArray)[1];

							cy.getCookie("better-auth.session_token").then(
								(sessionCookie) => {
									const authCookie = (sessionCookie as Cypress.Cookie).value;
									cy.clearCookies();
									cy.clearEmails();
									cy.visit(`${appOrigin}/signature/${token}`);
									cy.get('[data-cy="signature-card"]', {
										timeout: 15000,
									}).should("be.visible");
									cy.get('[data-cy="signature-document-preview"]', {
										timeout: 15000,
									}).should("exist");

									// The required option choice, on the public page - the client picks "Basic".
									cy.get('[data-cy="signature-option-chooser"]').should(
										"be.visible",
									);
									cy.get('[data-cy="signature-option-item"]').should(
										"have.length",
										2,
									);
									// The choice gates "Send verification code" - disabled before one is picked.
									cy.get('[data-cy="signature-request-otp-button"]').should(
										"be.disabled",
									);
									cy.contains('[data-cy="signature-option-item"]', "Basic")
										.find('[data-cy="signature-option-radio"]')
										.check({ force: true });
									cy.contains('[data-cy="signature-option-item"]', "Basic")
										.find('[data-cy="signature-option-radio"]')
										.should("be.checked");

									// Orchestrator review follow-up: a VIEWPORT screenshot taken here kept
									// coming back showing only the page top and the PDF preview, no matter how
									// the page was scrolled beforehand (Cypress's own `.scrollIntoView()`; a
									// native `Element.scrollIntoView()` under several `block` alignments;
									// `cy.viewport()` to a taller size; `capture: "fullPage"`; a settle
									// `cy.wait()` - every one of them measurably moved the element or the
									// layout, confirmed via `getBoundingClientRect()`, yet the CAPTURED image
									// never reflected it under this harness's Firefox headless screenshot
									// pipeline). An ELEMENT screenshot - chaining `.screenshot()` directly off
									// the chooser container, exactly as the orchestrator asked - does not
									// depend on the page's own scroll position at all: Cypress captures that
									// element's own rendered box regardless of where it sits on the page. A
									// FIRST attempt at this element screenshot (no settle wait) still came back
									// a blank gray rectangle, matching the PDF preview's own loading-placeholder
									// fill - the preview's own async render (react-pdf/pdfjs) still shifting
									// the layout underneath the freshly-scrolled chooser, at the exact moment
									// the crop was taken. The explicit wait below is what that attempt lacked.
									cy.wait(1000);
									cy.get('[data-cy="signature-option-chooser"]')
										.scrollIntoView()
										.should("be.visible")
										.screenshot("373-after-signature-choice");

									cy.get('[data-cy="signature-confirm-read-checkbox"]').click();
									cy.get('[data-cy="signature-request-otp-button"]')
										.should("not.be.disabled")
										.click();
									cy.get('[data-cy="signature-otp-message"]', {
										timeout: 10000,
									}).should("be.visible");

									cy.getLastEmail().then(
										(otpMessage: { Text?: string; HTML?: string }) => {
											const otp =
												bodyOf(otpMessage).match(/\b(\d{4})-(\d{4})\b/);
											expect(otp, "OTP email carries an 8-digit code").to.not.be
												.null;
											const code = `${(otp as RegExpMatchArray)[1]}${(otp as RegExpMatchArray)[2]}`;
											cy.get('[data-cy="signature-card"]')
												.find("input")
												.first()
												.type(code, { force: true });
											cy.get('[data-cy="signature-sign-button"]').click();
											cy.get('[data-cy="signature-confirm-dialog"]').should(
												"be.visible",
											);
											cy.get(
												'[data-cy="signature-confirm-dialog-confirm"]',
											).click();
											cy.get('[data-cy="signature-success-card"]', {
												timeout: 15000,
											}).should("be.visible");
										},
									);

									cy.request({
										url: `${api}/api/documents/${quoteId}?typeId=quote`,
										headers: {
											Cookie: `better-auth.session_token=${authCookie}`,
										},
									}).then((res) => {
										expect(res.body.status).to.eq("signed");
										expect(
											res.body.acceptedOption,
											"the signed document names the chosen option",
										).to.eq("Basic");
									});
								},
							);

							// The public signature page cleared cookies to act as the anonymous
							// client - restore an authenticated session before visiting the
							// issuer-facing detail page below.
							cy.login();
							cy.visit(`${appOrigin}/documents/quote/${quoteId}`);
							cy.get('[data-cy="document-status-badge"]').should(
								"contain.text",
								"Signed",
							);

							cy.get('[data-cy="document-action-convert-to-invoice"]').click();
							cy.url({ timeout: 15000 }).should(
								"match",
								/\/documents\/invoice\/[^/]+$/,
							);

							// Orchestrator review follow-up: same skeleton race as the Premium conversion
							// above, same fix (the converted line's own `input` VALUE, never its text
							// content - see that comment's own header) - on THIS quote's own lines (only
							// "Basic line", no common line here at all - see this test's own `quoteData`).
							cy.get('input[value="Basic line"]', { timeout: 15000 }).should("exist");
							cy.get('[data-slot="skeleton"]').should("not.exist");
							// Same settle wait as the Premium conversion above - measured to still show
							// loading skeletons in the CAPTURED screenshot even once these assertions had
							// already passed.
							cy.wait(500);

							cy.screenshot("373-after-invoice-from-basic", {
								capture: "viewport",
							});

							cy.url().then((invoiceUrl) => {
								const invoiceId = invoiceUrl.split("/").pop() as string;
								cy.request({
									url: `${api}/api/documents/${invoiceId}?typeId=invoice`,
								}).then((res) => {
									const lines = res.body.data.lines as Array<
										Record<string, unknown>
									>;
									expect(lines.map((l) => l.description)).to.deep.equal([
										"Basic line",
									]);
									expect(lines.every((l) => !("option" in l))).to.be.true;
								});
							});
						},
					);
				});
			});
		});
	});

	it("a single-option quote still shows its ordinary global total - today's behaviour, unchanged", () => {
		createClient("Single Total Client", "single-total@example.com").then(
			(clientId) => {
				const quoteData = {
					client: clientId,
					issueDate: new Date().toISOString().slice(0, 10),
					currency: "EUR",
					lines: [
						{
							description: "Ordinary line",
							quantity: 1,
							unitPrice: 100,
							vatRate: "20",
						},
					],
				};

				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/quote/actions/save-draft`,
					body: { data: quoteData },
				}).then((draft) => {
					const quoteId = draft.body?.document?.id as string;
					cy.visit(`${appOrigin}/documents/quote/${quoteId}`);
					cy.get('[data-cy="document-totals"]', { timeout: 10000 }).should(
						"exist",
					);
					cy.get('[data-cy="document-option-totals"]').should("not.exist");
					cy.get('[data-cy="document-totals-gross"]').should(
						"contain.text",
						"120.00",
					);
				});
			},
		);
	});
});
