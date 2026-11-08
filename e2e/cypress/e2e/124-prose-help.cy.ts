export {}; // makes this spec a module, not a global script -- see tsconfig.json

const help = '[data-cy="declaration-fr-pa-source-help"]';
const trigger = '[data-cy="declaration-fr-pa-source-help-trigger"]';
const content = '[data-cy="declaration-fr-pa-source-help-content"]';

function openDeclarationNote() {
	cy.visit("/settings/channels");
	cy.get('[data-cy="channels-declarations"]', { timeout: 20000 }).scrollIntoView();
	cy.get(content).should("not.exist");
	cy.get(trigger).click();
	cy.get(content).should("be.visible");
}

describe("Explanatory prose behind a help button", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("describes the help button with the full text and passes axe with the popover open", () => {
		openDeclarationNote();
		cy.get(help)
			.should("have.attr", "id")
			.then((id) => {
				cy.get(trigger).should("have.attr", "aria-describedby", id);
			});
		cy.get(help)
			.invoke("text")
			.then((text) => {
				expect(text.trim(), "the note behind the button").to.have.length.greaterThan(100);
				cy.get(content).should("contain.text", text.trim().slice(0, 60));
			});
		cy.assertAccessible();
	});

	it("keeps a popover taller than a phone screen scrollable, by keyboard too", () => {
		cy.viewport(390, 500);
		openDeclarationNote();
		cy.get(content)
			.should("have.attr", "tabindex", "0")
			.and(($el) => {
				const el = $el[0];
				expect(el.scrollHeight, "the text is taller than the popover").to.be.greaterThan(el.clientHeight);
				expect(el.getBoundingClientRect().top, "the popover starts inside the screen").to.be.at.least(0);
			});
		cy.get(trigger).focus().type("{downarrow}{downarrow}");
		cy.get(content).should(($el) => {
			expect($el[0].scrollTop, "arrow keys on the button scroll the text").to.be.greaterThan(0);
		});
		cy.assertAccessible();
	});
});
