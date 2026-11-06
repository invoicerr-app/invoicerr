import type { TFunction } from "i18next"
import i18n from "i18next"
import { describe, expect, it } from "vitest"

import { formatServerMessage, formatServerMessages } from "./server-message"

/** The app's REAL i18next instance (see `src/test/setup.ts`): a mock `t` would return the key and
 *  prove nothing about interpolation, which is the whole contract this module holds. */
const t = i18n.t.bind(i18n) as unknown as TFunction

describe("formatServerMessage", () => {
  it("renders the catalog sentence in the active language, with every param filled in", () => {
    expect(
      formatServerMessage(t, {
        key: "documents.messages.tax.ossStandardRate",
        params: { country: "DE", rate: 19 },
      }),
    ).toContain("DE's STANDARD VAT rate (19%)")
  })

  it("interpolates a numeric param as a number, not as a pre-formatted string", () => {
    expect(
      formatServerMessage(t, {
        key: "documents.messages.lineTotals.mismatchGross",
        params: {
          lines: 3,
          computed: "600.00 EUR",
          stated: "650.00 EUR",
          difference: "50.00 EUR",
          tolerance: "0.03 EUR",
        },
      }),
    ).toContain("the 3 line(s) sum to 600.00 EUR but the document states 650.00 EUR")
  })

  it("renders a message with no params at all, rather than waiting for values it does not need", () => {
    expect(formatServerMessage(t, { key: "documents.messages.totals.currencyMissing" })).toBe(
      "Document currency not found, using the default (2 decimals).",
    )
  })

  it("falls back to the key itself when the catalog does not hold it, never to an empty string", () => {
    // A key the backend invented but no locale carries yet: the reader sees the key, which is a
    // visible bug report, not a silently blank explanation.
    expect(formatServerMessage(t, { key: "documents.messages.not.a.real.key" })).toBe(
      "documents.messages.not.a.real.key",
    )
  })
})

describe("formatServerMessages", () => {
  it("keeps the order it was given, one rendered sentence per message", () => {
    expect(
      formatServerMessages(t, [
        { key: "documents.messages.totals.currencyMissing" },
        {
          key: "documents.messages.tax.ossStandardRate",
          params: { country: "IT", rate: 22 },
        },
      ]),
    ).toEqual([
      "Document currency not found, using the default (2 decimals).",
      expect.stringContaining("IT's STANDARD VAT rate (22%)"),
    ])
  })

  it("renders nothing for an empty list", () => {
    expect(formatServerMessages(t, [])).toEqual([])
  })
})
