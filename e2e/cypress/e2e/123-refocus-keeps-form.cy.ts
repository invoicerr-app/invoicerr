export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Leaving the tab and coming back must not lose a half-filled document. Every query the app shell
 * holds refetches on focus once stale, and none of those refetches may unmount the screen, reset
 * the form, or navigate.
 *
 * Only `Date` is faked: advancing it is what makes the cached data stale, so a return after a long
 * absence is reproduced without waiting for it. Timers stay real, so the app keeps running.
 */
const api = Cypress.env("apiUrl");
const DESCRIPTION = "Half-filled before switching tabs";

function setVisibility(state: "hidden" | "visible") {
	cy.document().then((doc) => {
		Object.defineProperty(doc, "visibilityState", { configurable: true, get: () => state });
		Object.defineProperty(doc, "hidden", { configurable: true, get: () => state === "hidden" });
		doc.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
	});
}

describe("Switching tabs keeps a half-filled document", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("keeps the typed values, the open dialog and the page after a blur and refocus", () => {
		cy.clock(Date.now(), ["Date"]);
		cy.visit("/documents/invoice", { timeout: 20000 });
		cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");
		cy.pickDocumentClient();
		cy.pickToday('[data-cy="document-field-issueDate-input"]');
		cy.pickDate('[data-cy="document-field-dueDate-input"]', "2030-06-15");
		cy.pickDocumentFieldOption("currency", "eur");

		cy.get('[data-cy="document-field-lines-add-row"]').click();
		cy.get('input[name="lines.0.description"]').type(DESCRIPTION);
		cy.get('input[name="lines.0.quantity"]').clear().type("3");

		// A full reload drops the window marker, a remount replaces the dialog node.
		cy.window().then((win) => {
			(win as unknown as { __refocusMarker: boolean }).__refocusMarker = true;
		});
		cy.get('[data-cy="document-create-dialog"]').then(($dialog) => {
			($dialog[0] as unknown as { __refocusMarker: boolean }).__refocusMarker = true;
		});
		cy.location("pathname").as("pathBefore");

		cy.intercept("GET", `${api}/api/billing/seats`).as("seatsRefetch");
		cy.window().then((win) => win.dispatchEvent(new Event("blur")));
		setVisibility("hidden");
		cy.tick(10 * 60_000);
		setVisibility("visible");
		cy.window().then((win) => win.dispatchEvent(new Event("focus")));
		// The shell's own queries refetch on focus; waiting for one proves the refocus was seen.
		cy.wait("@seatsRefetch");

		cy.window().its("__refocusMarker").should("eq", true);
		cy.get("@pathBefore").then((pathBefore) => {
			cy.location("pathname").should("eq", pathBefore);
		});
		cy.get('[data-cy="document-create-dialog"]')
			.should("be.visible")
			.then(($dialog) => {
				expect(($dialog[0] as unknown as { __refocusMarker?: boolean }).__refocusMarker).to.eq(true);
			});
		cy.get('[data-cy="document-create-dialog-step-body-lines"]').should("be.visible");
		cy.get('input[name="lines.0.description"]').should("have.value", DESCRIPTION);
		cy.get('input[name="lines.0.quantity"]').should("have.value", "3");
	});
});
