import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DocumentFieldValue } from "@/components/documents/field-value"
import type { DocumentFieldDescriptor } from "@/components/documents/types"

const moneyField: DocumentFieldDescriptor = {
  key: "amount",
  kind: "money",
  label: "Amount",
  currencyField: "currency",
}

function renderMoney(value: number, currency: string) {
  const { container } = render(<DocumentFieldValue field={moneyField} value={value} data={{ currency }} />)
  return container.textContent
}

/**
 * The 'money' kind used to format every amount with toFixed(2), whatever the currency: a yen amount
 * read "1500.00 JPY" and a dinar amount lost its third decimal. The stored value is a MAJOR-unit
 * amount (MoneyField saves the number as typed), so only the decimal count follows the currency.
 */
describe("DocumentFieldValue, money kind", () => {
  it.each([
    [1500, "JPY", "1500 JPY"],
    [12.5, "EUR", "12.50 EUR"],
    [1.234, "KWD", "1.234 KWD"],
  ])("formats %s %s as %s", (value, currency, expected) => {
    expect(renderMoney(value, currency)).toBe(expected)
  })
})
