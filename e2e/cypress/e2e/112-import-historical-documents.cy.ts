export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #340 - "Import past invoices from a previous tool".
 *
 * Covers the owner's own decision (issue comment, 2026-09-29):
 *  a) "declare your last number issued" (usable without importing anything) - the counter resumes at
 *     last + 1, with no gap, and the NEXT ordinary invoice prints the right number;
 *  b) importing an invoice lands it directly on "imported" - never "draft", never sent, an original
 *     number kept verbatim, no counter consumed;
 *  c) a document with no declared transmission evidence shows a VISIBLE, LASTING warning; one with
 *     evidence does not;
 *  d) "send" on an imported document is refused BY THE LIFECYCLE (409, naming the allowed statuses),
 *     not merely hidden from the screen - both are proven;
 *  e) a credit note can be issued against an imported invoice, using its own lines.
 *
 * Data creation goes through the real API (`cy.request`) - the same "UI only for the assertions/
 * screenshots being proven" discipline every other numbered spec in this suite already holds (see
 * e.g. 91-credit-note-numbering.cy.ts's own header). The UI is driven for: the "declare last number"
 * settings form (simple text/date inputs, no risk driving them), the import dialog's upload step (a
 * real file input), the CSV import's real preview, and every detail-page assertion/screenshot.
 */
const api = Cypress.env("apiUrl");
const appOrigin = Cypress.config("baseUrl");

// `selectFile` takes a path relative to the PROJECT root; `cy.fixture` takes one relative to
// `cypress/fixtures` already - two different roots for the same file, kept as two constants so
// neither call site has to remember which is which.
const ORIGINAL_PDF_SELECT_PATH = "cypress/fixtures/received-invoices/supplier-invoice-plain.pdf";
const ORIGINAL_PDF_FIXTURE = "received-invoices/supplier-invoice-plain.pdf";

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
				address: "1 Rue de l'Historique",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
			},
		})
		.then((res) => {
			expect(res.status, "client created through the API").to.be.oneOf([200, 201]);
			return res.body.id as string;
		});
}

// `cy.request()` runs outside the browser and does not send a real `multipart/form-data` body for a
// `FormData` value (it serializes it like a plain object, which the backend's `FileInterceptor` never
// sees as a file) - `cy.window()` gives the REAL browser `fetch`/`FormData`, the exact same
// mechanism `use-attachments.ts#useUploadAttachment` itself uses, with the session cookie already
// attached (`credentials: "include"`) since `cy.login()` has already signed in by the time any test
// body runs.
function uploadOriginal() {
	return cy.fixture(ORIGINAL_PDF_FIXTURE, "base64").then((base64) =>
		cy.window().then((win) => {
			const blob = Cypress.Blob.base64StringToBlob(base64, "application/pdf");
			const formData = new win.FormData();
			formData.append("file", blob, "historical-invoice.pdf");
			return cy
				.wrap(
					win
						.fetch(`${api}/api/documents/attachments/upload`, {
							method: "POST",
							credentials: "include",
							body: formData,
						})
						.then(async (res) => {
							expect(res.ok, "original file uploaded").to.eq(true);
							return res.json();
						}),
					{ timeout: 15000 },
				)
				.then((body) => body as { fileRef: string; fileName: string; mime: string });
		}),
	);
}

function importInvoice(clientId: string, options: {
	originalNumber: string;
	issueDate: string;
	transmissionEvidence?: Record<string, string>;
}) {
	return uploadOriginal().then((originalFile) =>
		cy
			.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/import`,
				body: {
					data: {
						client: clientId,
						issueDate: options.issueDate,
						dueDate: options.issueDate,
						currency: "EUR",
						lines: [
							{ description: "Historical consulting", quantity: 3, unit: "hour", unitPrice: 120, vatRate: "20" },
						],
					},
					originalNumber: options.originalNumber,
					transmissionEvidence: options.transmissionEvidence ?? {},
					originalFile,
				},
			})
			.then((res) => {
				expect(res.status, "invoice imported").to.be.oneOf([200, 201]);
				expect(res.body.status, "imported status").to.eq("imported");
				expect(res.body.displayNumber, "original number kept verbatim").to.eq(options.originalNumber);
				return res.body.id as string;
			}),
	);
}

describe("Issue #340 - import historical documents from a previous tool", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.viewport(1440, 900);
	});

	it("declares the last number issued through the settings screen, and the NEXT ordinary invoice resumes at last+1 with no gap", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		});

		cy.visit(`${appOrigin}/settings/company`);
		cy.get('[data-cy="declare-last-number-section"]', { timeout: 15000 })
			.scrollIntoView()
			.should("be.visible");

		cy.get('[data-cy="declare-last-number-type"]').should("contain.text", "Invoice");
		cy.get('[data-cy="declare-last-number-value"]').clear().type("FAC-2026-0099");
		cy.get('[data-cy="declare-last-number-date"]').clear().type("2026-06-01");
		cy.get('[data-cy="declare-last-number-infer"]').click();
		cy.get('[data-cy="declare-last-number-pattern"]', { timeout: 10000 }).should(
			"have.value",
			"FAC-{year}-{number:4}",
		);

		cy.screenshot("340-before-declare-last-number", { capture: "viewport" });

		cy.get('[data-cy="declare-last-number-submit"]').click();
		// Cypress's own default `scrollBehavior` ("top") scrolls the clicked button to the very top of
		// the viewport before the click, not just into view, which was harmless while the page was short
		// enough that the scroll clamped before reaching the top; that clamp is what kept this result box
		// (rendered just ABOVE the button, inside the same card) inside the viewport by accident. Issue
		// #548 made the Exchange rates card below this one taller, so the page is no longer short enough
		// to clamp that scroll: the button now reaches the true top and the result box lands above the
		// fold. A real click never does this (nothing auto-scrolls a button that's already visible), so
		// this is a Cypress-only artifact of page height elsewhere on the screen, and the fix belongs
		// here, not in the product: scroll the result element itself into view before asserting on it,
		// the same discipline `declare-last-number-section` above already uses at the top of this test.
		cy.get('[data-cy="declare-last-number-result"]', { timeout: 15000 }).scrollIntoView().should("be.visible");
		cy.get('[data-cy="declare-last-number-result"]').should("contain.text", "100");

		cy.screenshot("340-after-declare-last-number", { capture: "viewport" });

		// The real proof: an ORDINARY invoice, issued right after, prints the number the declaration
		// promised - "FAC-2026-0100", never "FAC-2026-0001" (a gap) and never "FAC-2026-0099" again (a
		// duplicate of what the previous tool already issued).
		createClient("Numbering Continuity Co", "numbering-continuity@example.com").then((clientId) => {
			const invoiceData = {
				client: clientId,
				// Before 2026-09-01 on purpose: from that date France's PDP mandate binds a domestic
				// invoice and "send" over plain email 501s (transports/channel-policy/mandate.ts) - the
				// same date 91-credit-note-numbering.cy.ts's own invoice fixture already picks for the
				// same reason.
				issueDate: "2026-08-25",
				dueDate: "2026-09-25",
				currency: "EUR",
				lines: [{ description: "Ongoing work", quantity: 1, unit: "unit", unitPrice: 800, vatRate: "20" }],
			};
			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: { data: invoiceData },
			}).then((saved) => {
				const invoiceId = saved.body.document.id as string;
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: { documentId: invoiceId, data: invoiceData },
				});
				cy.waitForDocumentStatus(`${api}/api/documents/${invoiceId}?typeId=invoice`, ["sent"]).then(() => {
					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body.displayNumber")
						.should("eq", "FAC-2026-0100");
				});
			});
		});
	});

	it("imports an invoice via the per-document form: lands on \"imported\", keeps the original number, no counter consumed, an untransmitted one warns", () => {
		createClient("Migrated Client SARL", "migrated-client@example.com").then((clientId) => {
			// Drives the REAL upload dialog and form dialog for the screenshot the owner asked for -
			// see this file's own header on why the actual import used for later assertions goes
			// through the API instead (the client/lines fields are a searchable combobox and a
			// dynamic row table, not simple inputs - the established house style is "UI only for the
			// assertions/screenshots being proven").
			cy.visit(`${appOrigin}/documents/invoice`);
			cy.get('[data-cy="import-document-button-invoice"]').click();
			cy.get('[data-cy="import-document-upload-dialog"]', { timeout: 10000 }).should("be.visible");
			cy.screenshot("340-before-import-form", { capture: "viewport" });

			cy.get('[data-cy="import-document-file-input"]').selectFile(ORIGINAL_PDF_SELECT_PATH, { force: true });
			cy.get('[data-cy="import-document-form-dialog"]', { timeout: 10000 }).should("be.visible");
			cy.get('[data-cy="import-document-original-number"]').type("OLD-2024-0142");
			cy.screenshot("340-after-import-form", { capture: "viewport" });
			cy.get('[data-cy="import-document-cancel"]').click();

			// The actual imported invoices this test asserts against, created through the API.
			importInvoice(clientId, { originalNumber: "OLD-2024-0142", issueDate: "2024-03-15" }).then(
				(untransmittedId) => {
					cy.request({ url: `${api}/api/documents/${untransmittedId}?typeId=invoice` })
						.its("body")
						.then((doc) => {
							expect(doc.status, "landed directly on imported").to.eq("imported");
							expect(doc.number, "never consumes the counter").to.be.null;
							expect(doc.displayNumber, "original number kept verbatim").to.eq("OLD-2024-0142");
						});

					cy.visit(`${appOrigin}/documents/invoice/${untransmittedId}`);
					cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should(
						"contain.text",
						"Imported",
					);
					cy.get('[data-cy="document-import-not-transmitted"]', { timeout: 15000 }).should(
						"be.visible",
					);
					cy.screenshot("340-after-imported-invoice-untransmitted", { capture: "viewport" });

					// "refused by the lifecycle, not only hidden": both proven on the SAME record.
					// (1) The UI never offers a "Send" action at all - no element carries the
					// action's own data-cy.
					cy.get('body').then(($body) => {
						expect($body.find('[data-cy="document-action-send"]').length, "no Send action rendered").to.eq(0);
					});
					// (2) A DIRECT API call is refused (409), naming the allowed statuses - never a
					// silent no-op and never a 200 that would quietly send an imported document.
					cy.request({
						method: "POST",
						url: `${api}/api/documents/types/invoice/actions/send`,
						body: { documentId: untransmittedId, data: {} },
						failOnStatusCode: false,
					}).then((res) => {
						expect(res.status, "send refused on an imported document").to.eq(409);
					});
				},
			);

			importInvoice(clientId, {
				originalNumber: "OLD-2024-0143",
				issueDate: "2024-03-20",
				transmissionEvidence: { sdiId: "IT-SDI-00112233" },
			}).then((transmittedId) => {
				cy.visit(`${appOrigin}/documents/invoice/${transmittedId}`);
				cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should("contain.text", "Imported");
				cy.get('[data-cy="document-import-not-transmitted"]').should("not.exist");
				cy.screenshot("340-after-imported-invoice-transmitted", { capture: "viewport" });
			});
		});
	});

	it("imports invoices in bulk from a CSV file, with a real preview", () => {
		createClient("Bulk Migration Co", "bulk-migration@example.com").then((clientId) => {
			cy.visit(`${appOrigin}/documents/invoice`);
			cy.get('[data-cy="import-document-csv-button-invoice"]').click();
			cy.get('[data-cy="import-document-csv-dialog"]', { timeout: 10000 }).should("be.visible");

			cy.get('[data-cy="import-document-csv-files-input"]').selectFile(ORIGINAL_PDF_SELECT_PATH, {
				force: true,
			});
			cy.wait(500); // the file upload round-trip before the CSV itself is parsed against it

			const csv =
				"originalNumber,originalFileName,clientId,issueDate,dueDate,currency,lineDescription,lineQuantity,lineUnit,lineUnitPrice,lineVatRate\n" +
				`OLD-BULK-0001,supplier-invoice-plain.pdf,${clientId},2024-01-10,2024-02-10,EUR,Consulting,2,hour,150,20\n` +
				"OLD-BULK-0002,supplier-invoice-plain.pdf,,2024-01-11,2024-02-11,EUR,Consulting,1,hour,150,20\n";

			cy.get('[data-cy="import-document-csv-file-input"]').selectFile(
				{ contents: Cypress.Buffer.from(csv), fileName: "invoices.csv" },
				{ force: true },
			);

			cy.get('[data-cy="import-document-csv-preview"]', { timeout: 15000 }).should("be.visible");
			cy.get('[data-cy="import-document-csv-summary-valid"]').should("contain.text", "1");
			cy.get('[data-cy="import-document-csv-summary-rejected"]').should("contain.text", "1");
			cy.screenshot("340-after-import-csv-preview", { capture: "viewport" });

			cy.get('[data-cy="import-document-csv-confirm-button"]').click();
			cy.get('[data-cy="import-document-csv-result"]', { timeout: 15000 }).should("be.visible");
			cy.get('[data-cy="import-document-csv-result-imported"]').should("contain.text", "1");
			cy.get('[data-cy="import-document-csv-result-rejected"]').should("contain.text", "1");
		});
	});

	it("issues a credit note against an imported invoice, priced from its own lines", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		});

		createClient("Credit Note Target Co", "credit-note-target@example.com").then((clientId) => {
			importInvoice(clientId, { originalNumber: "OLD-2024-0200", issueDate: "2024-05-01" }).then(
				(invoiceId) => {
					cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
						.its("body.data.lines")
						.then((lines: { $rowId: string }[]) => {
							const rowId = lines[0].$rowId;
							const creditNoteData = {
								invoice: invoiceId,
								correctedLines: [rowId],
								issueDate: "2024-05-15",
								currency: "EUR",
							};
							cy.request({
								method: "POST",
								url: `${api}/api/documents/types/credit-note/actions/save-draft`,
								body: { data: creditNoteData },
							}).then((saved) => {
								const creditNoteId = saved.body.document.id as string;
								cy.request({
									method: "POST",
									url: `${api}/api/documents/types/credit-note/actions/send`,
									body: { documentId: creditNoteId, data: creditNoteData },
								}).then((res) => {
									expect(res.status, "credit note against an imported invoice issued").to.be.oneOf([
										200, 201,
									]);
								});
								cy.waitForDocumentStatus(
									`${api}/api/documents/${creditNoteId}?typeId=credit-note`,
									["sent"],
								).then(() => {
									cy.visit(`${appOrigin}/documents/credit-note/${creditNoteId}`);
									cy.get('[data-cy="document-status-badge"]', { timeout: 15000 }).should(
										"contain.text",
										"Sent",
									);
									// Priced from the imported invoice's own lines (3 x 120 EUR + 20% VAT =
									// 432.00) - the owner's own decision: a linked credit note against an
									// imported invoice works exactly like against any other, when the
									// import carried its lines.
									cy.get('[data-cy="document-totals-gross"]', { timeout: 15000 }).should(
										"contain.text",
										"432",
									);
									cy.screenshot("340-after-credit-note-against-imported-invoice", {
										capture: "viewport",
									});
								});
							});
						});
				},
			);
		});
	});
});
