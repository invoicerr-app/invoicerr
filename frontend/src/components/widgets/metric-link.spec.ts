import { describe, expect, it } from "vitest"

import { buildMetricLinkHref } from "./metric-link"

describe("buildMetricLinkHref", () => {
  it("builds a bare typeId URL when no filter is set", () => {
    expect(buildMetricLinkHref({ typeId: "invoice" })).toBe("/documents/invoice")
  })

  it("repeats status as separate query keys, never a comma-joined value", () => {
    expect(buildMetricLinkHref({ typeId: "invoice", status: ["draft", "sent"] })).toBe(
      "/documents/invoice?status=draft&status=sent",
    )
  })

  it("includes dateFrom/dateTo verbatim, YYYY-MM-DD", () => {
    expect(buildMetricLinkHref({ typeId: "expense", dateFrom: "2026-08-01", dateTo: "2026-08-31" })).toBe(
      "/documents/expense?dateFrom=2026-08-01&dateTo=2026-08-31",
    )
  })

  it("includes settlement when set", () => {
    expect(buildMetricLinkHref({ typeId: "invoice", status: ["sent"], settlement: "overdue" })).toBe(
      "/documents/invoice?status=sent&settlement=overdue",
    )
  })

  it("combines every filter together, in the order the URL builder writes them", () => {
    expect(
      buildMetricLinkHref({
        typeId: "invoice",
        status: ["sent"],
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
        settlement: "unsettled",
      }),
    ).toBe("/documents/invoice?status=sent&dateFrom=2026-08-01&dateTo=2026-08-31&settlement=unsettled")
  })
})
