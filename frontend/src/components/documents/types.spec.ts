import { describe, expect, it } from "vitest"

import { numberingDisplayState } from "./types"

/**
 * PR #473 review point 3 - this table of cases is pinned IDENTICALLY on the backend
 * (backend/src/modules/documents/numbering/display-state.spec.ts, against
 * `numbering/display-state.ts#numberingDisplayState`) - see this function's own header (types.ts) for
 * why the two formulas are mirrored rather than shared code, and what silently diverging between them
 * used to look like (a PDF and a screen disagreeing about the same unnumbered document).
 */
describe("numberingDisplayState", () => {
  it('is "numbered" whenever displayNumber is set, regardless of status', () => {
    expect(
      numberingDisplayState(
        { numbering: { onEnterStatus: "sending" }, initialStatus: "draft" },
        { displayNumber: "INV-2026-0001", status: "sending" },
      ),
    ).toBe("numbered")
  })

  it('is "awaiting" for a plain draft (status === initialStatus), no `onlyFrom` declared', () => {
    expect(
      numberingDisplayState(
        { numbering: { onEnterStatus: "sending" }, initialStatus: "draft" },
        { displayNumber: undefined, status: "draft" },
      ),
    ).toBe("awaiting")
  })

  // THE EXACT BUG this PR's review point 3 closes: a quote/invoice (no `numbering.onlyFrom`) stuck in
  // "sending" without a number (PR #473 review point 1's own race, now closed) must show
  // "issuedWithoutNumber" here too, matching the backend's PDF - never silently fall back to
  // "awaiting" just because there is no `onlyFrom` to narrow it.
  it('is "issuedWithoutNumber" for a numbered-type instance stuck in a NON-initial status with no number and no `onlyFrom` declared', () => {
    expect(
      numberingDisplayState(
        { numbering: { onEnterStatus: "sending" }, initialStatus: "draft" },
        { displayNumber: undefined, status: "sending" },
      ),
    ).toBe("issuedWithoutNumber")
  })

  it('is "awaiting" for a legacy credit note whose status is IN `numbering.onlyFrom`', () => {
    expect(
      numberingDisplayState(
        { numbering: { onEnterStatus: "sending", onlyFrom: ["draft"] }, initialStatus: "draft" },
        { displayNumber: undefined, status: "draft" },
      ),
    ).toBe("awaiting")
  })

  it('is "issuedWithoutNumber" for a legacy credit note whose status left `numbering.onlyFrom` (issued before #471, retried unnumbered)', () => {
    expect(
      numberingDisplayState(
        { numbering: { onEnterStatus: "sending", onlyFrom: ["draft"] }, initialStatus: "draft" },
        { displayNumber: undefined, status: "send_failed" },
      ),
    ).toBe("issuedWithoutNumber")
  })

  it('is "issuedWithoutNumber" for "sent" with no number and no `onlyFrom` - a document type numbered only after this record was issued', () => {
    expect(
      numberingDisplayState(
        { numbering: { onEnterStatus: "sending" }, initialStatus: "draft" },
        { displayNumber: undefined, status: "sent" },
      ),
    ).toBe("issuedWithoutNumber")
  })
})
