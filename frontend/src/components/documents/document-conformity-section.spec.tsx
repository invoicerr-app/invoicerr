import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  ConformityBadge,
  ConformityTimeline,
  computeConformityVerdict,
  latestConformityReason,
} from "./document-conformity-section"
import type { DocumentAuthorityEvent } from "./types"

/**
 * The Cypress spec 31 fictional PDP channel only ever produces a `send_failed` (no real deposit — see
 * that spec's own header), so there is no e2e-reachable way to put real conformity events on screen.
 * This file is the fallback this task's own brief names explicitly ("le motif de descriptor-i18n.spec.ts")
 * — a genuine `@testing-library/react` RENDER of the presentational timeline/badge with HARDCODED
 * events, the first component-render test in this codebase (vite.config.ts's own jsdom environment
 * and `src/test/setup.ts` were already provisioned for exactly this, just never exercised before).
 */

function event(overrides: Partial<DocumentAuthorityEvent> = {}): DocumentAuthorityEvent {
  return {
    id: "evt-1",
    providerId: "pdp",
    statusCode: "fr:200",
    statusText: "Déposée (validée)",
    reason: null,
    observedAt: "2026-08-29T10:00:05.118541Z",
    ...overrides,
  }
}

describe("computeConformityVerdict — pure", () => {
  it("accepted once fr:202 is present, even alongside earlier intermediate codes", () => {
    const events = [event({ id: "1", statusCode: "fr:200" }), event({ id: "2", statusCode: "fr:202" })]
    expect(computeConformityVerdict(events)).toBe("accepted")
  })

  it("rejected once fr:213 is present", () => {
    const events = [event({ id: "1", statusCode: "fr:200" }), event({ id: "2", statusCode: "fr:213" })]
    expect(computeConformityVerdict(events)).toBe("rejected")
  })

  it("pending while only intermediate codes have been observed", () => {
    const events = [event({ id: "1", statusCode: "fr:200" }), event({ id: "2", statusCode: "fr:201" })]
    expect(computeConformityVerdict(events)).toBe("pending")
  })

  it("gaveUp once the synthetic poll:gave-up event is present", () => {
    const events = [event({ id: "1", statusCode: "fr:200" }), event({ id: "2", statusCode: "poll:gave-up" })]
    expect(computeConformityVerdict(events)).toBe("gaveUp")
  })

  it("a KSeF-shaped code (pl:200) is accepted, and (pl:415) is rejected", () => {
    expect(computeConformityVerdict([event({ statusCode: "pl:200" })])).toBe("accepted")
    expect(computeConformityVerdict([event({ statusCode: "pl:415" })])).toBe("rejected")
  })
})

describe("latestConformityReason — pure", () => {
  it("surfaces the rejection's own reason", () => {
    const events = [event({ id: "1", statusCode: "fr:213", reason: "BT-23 absent" })]
    expect(latestConformityReason(events)).toBe("BT-23 absent")
  })

  it("is undefined when nothing was rejected", () => {
    expect(latestConformityReason([event({ statusCode: "fr:202" })])).toBeUndefined()
  })
})

describe("<ConformityTimeline> — hardcoded events, REAL render", () => {
  it("renders every event's code, text, and date", () => {
    const events = [
      event({ id: "e1", statusCode: "fr:200", statusText: "Déposée (validée)" }),
      event({ id: "e2", statusCode: "fr:202", statusText: "Reçue par la plateforme" }),
    ]
    render(<ConformityTimeline events={events} />)

    expect(screen.getByTestId("document-conformity-event-e1")).toHaveTextContent("fr:200")
    expect(screen.getByTestId("document-conformity-event-e1")).toHaveTextContent("Déposée (validée)")
    expect(screen.getByTestId("document-conformity-event-e2")).toHaveTextContent("fr:202")
    expect(screen.getByTestId("document-conformity-event-e2")).toHaveTextContent("Reçue par la plateforme")
  })

  it("renders the REAL fr:213 reason captured live this session (2026-09-01)", () => {
    const reason =
      "Element 'ram:Content' must occur exactly 1 times. ... " +
      "BR-FR-05/BT-22 : La mention relative aux frais de recouvrement (code PMT) est absente. " +
      "Elle est obligatoire dans les notes (BG-1)."
    const events = [event({ id: "e1", statusCode: "fr:213", statusText: "Rejetée", reason })]
    render(<ConformityTimeline events={events} />)

    const row = screen.getByTestId("document-conformity-event-e1")
    expect(row).toHaveTextContent("fr:213")
    expect(screen.getByTestId("document-conformity-event-reason")).toHaveTextContent("BG-1")
  })

  it("never renders a reason line for an event that carries none", () => {
    render(<ConformityTimeline events={[event({ id: "e1", reason: null })]} />)
    expect(screen.queryByTestId("document-conformity-event-reason")).not.toBeInTheDocument()
  })
})

describe("<ConformityBadge> — hardcoded events, REAL render", () => {
  it("shows 'Validated by the platform' once accepted", () => {
    render(<ConformityBadge events={[event({ statusCode: "fr:202" })]} />)
    expect(screen.getByTestId("document-conformity-badge")).toHaveTextContent("Validated by the platform")
  })

  it("shows 'Rejected' once rejected", () => {
    render(<ConformityBadge events={[event({ statusCode: "fr:213" })]} />)
    expect(screen.getByTestId("document-conformity-badge")).toHaveTextContent("Rejected")
  })

  it("shows 'Awaiting verdict' while pending", () => {
    render(<ConformityBadge events={[event({ statusCode: "fr:200" })]} />)
    expect(screen.getByTestId("document-conformity-badge")).toHaveTextContent("Awaiting verdict")
  })

  it("shows 'Abandoned' once gave up", () => {
    render(<ConformityBadge events={[event({ statusCode: "poll:gave-up" })]} />)
    expect(screen.getByTestId("document-conformity-badge")).toHaveTextContent("Abandoned")
  })

  it("renders nothing at all for an empty event list", () => {
    render(<ConformityBadge events={[]} />)
    expect(screen.queryByTestId("document-conformity-badge")).not.toBeInTheDocument()
  })
})
