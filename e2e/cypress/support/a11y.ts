import "cypress-axe"
import type { Result } from "axe-core"

const BLOCKING_IMPACTS = ["serious", "critical"]

function printViolations(violations: Result[]) {
    const lines = violations.flatMap((violation) =>
        violation.nodes.map(
            (node) =>
                `  [${violation.impact}] ${violation.id} on ${node.target.join(" ")}: ${violation.help}\n` +
                `    ${node.html.slice(0, 200)}\n    ${(node.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 300)}`,
        ),
    )
    cy.url({ log: false }).then((url) =>
        cy.task("logStep", `axe: ${violations.length} violation(s) on ${url}\n${lines.join("\n")}`, { log: false }),
    )
}

/**
 * An element fading in or out (menu, dialog, toast) is measured at partial opacity, which axe
 * reports as low contrast. Infinite animations (spinners, skeletons) never settle and are skipped.
 */
function expectPageAtRest(doc: Document) {
    const settling = doc
        .getAnimations()
        .filter((animation) => animation.playState === "running")
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    expect(settling.length, "running animations").to.eq(0)

    doc.querySelectorAll('[data-sonner-toast][data-visible="true"]').forEach((toast) => {
        expect(
            toast.ownerDocument.defaultView?.getComputedStyle(toast).opacity,
            "toast opacity",
        ).to.eq("1")
    })
}

// Long enough for a transition to have started, short enough not to slow the suite down.
const SETTLE_FRAME_MS = 100

Cypress.Commands.add("assertAccessible", (options: Cypress.AssertAccessibleOptions = {}) => {
    // Checked twice, one frame apart: an element mounted by the same render as the one the spec just
    // waited for only starts its enter transition on the next frame, so a single instantaneous check
    // sees a quiet page and axe then measures that element mid-fade. The second check waits that
    // transition out.
    cy.document({ log: false }).should(expectPageAtRest)
    cy.wait(SETTLE_FRAME_MS, { log: false })
    cy.document({ log: false }).should(expectPageAtRest)
    cy.injectAxe()
    cy.checkA11y(
        options.context,
        options.rules
            ? { runOnly: { type: "rule", values: options.rules } }
            : { includedImpacts: BLOCKING_IMPACTS },
        printViolations,
    )
})
