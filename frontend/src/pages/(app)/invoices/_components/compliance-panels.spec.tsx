import type { AvailableActions } from "@/hooks/queries/use-available-actions"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ArchivalPanel, ObligationLayersPanel } from "./compliance-panels"

/**
 * These panels are pure projections of the `available-actions` payload the backend derives from a
 * country profile — that is the whole point of the file under test, which contains no country name.
 * So the fixtures below are payloads, not French or German ones, and the assertions are on
 * `data-cy` hooks and on interpolated numbers. Asserting on English sentences would make every
 * Weblate commit a failing build without telling us anything about the rendering.
 */
function makeActions(overrides: Partial<AvailableActions> = {}): AvailableActions {
  return {
    invoiceId: "invoice-1",
    status: "SENT",
    immutableAfter: "ISSUANCE",
    correctionModel: "CREDIT_NOTE",
    cancellation: {
      allowed: false,
      policy: {
        allowedByCountry: false,
        windowHours: null,
        expiresAt: null,
        requiresAuthorityAck: false,
        requiresBuyerConsent: false,
      },
      conditions: [],
    },
    archival: null,
    obligations: [],
    actions: {
      edit: false,
      issue: false,
      correct: false,
      cancel: false,
      cancelAndReplace: false,
      send: false,
      convertToInvoice: false,
      deposit: false,
    },
    correctionKinds: [],
    ...overrides,
  }
}

describe("ArchivalPanel", () => {
  it("renders nothing when no compliance plan has been resolved yet", () => {
    // `archival: null` is a fresh draft. The panel must not render an empty shell that suggests a
    // retention duty of zero.
    const { container } = render(<ArchivalPanel actions={makeActions({ archival: null })} />)

    expect(container).toBeEmptyDOMElement()
  })

  it("renders the retention period it was given", () => {
    render(
      <ArchivalPanel
        actions={makeActions({
          archival: {
            retentionYears: 10,
            residency: null,
            archivedForm: "PDF_A3",
            integrity: "NONE",
          },
        })}
      />,
    )

    // The number is what the user acts on, and it is interpolated — a component that dropped the
    // `{{years}}` placeholder would fail here even though the sentence around it still rendered.
    expect(screen.getByTestId("archival-retention")).toHaveTextContent("10")
    // Not sourced by the profile, so not asserted at the user.
    expect(screen.queryByTestId("archival-residency")).toBeNull()
    // `integrity: "NONE"` means there is nothing to claim about tamper-evidence.
    expect(screen.queryByTestId("archival-integrity")).toBeNull()
  })

  it("renders residency and integrity when the profile does say something about them", () => {
    render(
      <ArchivalPanel
        actions={makeActions({
          archival: {
            retentionYears: 6,
            residency: "EU",
            archivedForm: "PDF_A3",
            integrity: "HASH_CHAIN",
          },
        })}
      />,
    )

    expect(screen.getByTestId("archival-retention")).toHaveTextContent("6")
    expect(screen.getByTestId("archival-residency")).toHaveTextContent("EU")
    expect(screen.getByTestId("archival-integrity")).toBeInTheDocument()
  })
})

describe("ObligationLayersPanel", () => {
  it("renders nothing when the plan attaches no obligations", () => {
    const { container } = render(<ObligationLayersPanel actions={makeActions({ obligations: [] })} />)

    expect(container).toBeEmptyDOMElement()
  })

  it("renders one row per obligation, keyed by layer", () => {
    const { container } = render(
      <ObligationLayersPanel
        actions={makeActions({
          obligations: [
            {
              kind: "EREPORTING",
              layer: "ISSUANCE",
              model: "CLEARANCE",
              blocking: true,
              deadline: { value: 4, unit: "DAYS" },
              openQuestion: null,
            },
            {
              kind: "EREPORTING",
              layer: "RECEPTION",
              model: null,
              blocking: false,
              deadline: { value: 48, unit: "HOURS" },
              openQuestion: null,
            },
            {
              kind: "ARCHIVING",
              layer: "ARCHIVAL",
              model: null,
              blocking: false,
              deadline: { value: 10, unit: "YEARS" },
              openQuestion: null,
            },
          ],
        })}
      />,
    )

    // One `<li data-cy="obligation-…">` per obligation, no more and no fewer. The nested
    // "not sourced" / "blocking" markers are spans, so the `li[data-cy]` selector counts rows only.
    expect(container.querySelectorAll("li[data-cy]")).toHaveLength(3)
    expect(screen.getByTestId("obligation-ISSUANCE")).toHaveTextContent("4")
    expect(screen.getByTestId("obligation-RECEPTION")).toHaveTextContent("48")
    expect(screen.getByTestId("obligation-ARCHIVAL")).toHaveTextContent("10")
    // Blocking is a property of the obligation, not of the layer it sits in.
    expect(screen.getByTestId("obligation-blocking-ISSUANCE")).toBeInTheDocument()
    expect(screen.queryByTestId("obligation-blocking-RECEPTION")).toBeNull()
  })

  it("says so, visibly, when an obligation's deadline was never sourced", () => {
    render(
      <ObligationLayersPanel
        actions={makeActions({
          obligations: [
            {
              kind: "EREPORTING",
              layer: "ISSUANCE",
              model: null,
              blocking: false,
              deadline: { value: 4, unit: "DAYS" },
              openQuestion: null,
            },
            {
              kind: "EREPORTING",
              layer: "RECEPTION",
              model: null,
              blocking: false,
              // The duty is real; nobody sourced its timing. Omitting the row would let a reader
              // conclude there is no deadline, which is a different and wrong statement.
              deadline: null,
              openQuestion: "reception deadline not sourced",
            },
          ],
        })}
      />,
    )

    expect(screen.getByTestId("obligation-open-RECEPTION")).toBeInTheDocument()
    // The sourced one must NOT be marked open — otherwise the marker means nothing.
    expect(screen.queryByTestId("obligation-open-ISSUANCE")).toBeNull()
    // The row is still there, next to its unsourced sibling.
    expect(screen.getByTestId("obligation-RECEPTION")).toBeInTheDocument()
  })
})
