import { describe, expect, it } from "vitest"
import { toCompanyLawForm, toCompanyLawPayload } from "./company-law"

describe("the company-law part of the company settings form", () => {
  it("reads what the company stored, ignoring a value of the wrong shape", () => {
    expect(
      toCompanyLawForm({
        legalForm: "FR_SAS",
        values: { registerCity: "Lyon", shareCapital: { amount: "1000", currency: "EUR" }, stray: 3 },
      }),
    ).toEqual({
      legalForm: "FR_SAS",
      values: { registerCity: "Lyon", shareCapital: { amount: "1000", currency: "EUR" } },
    })
  })

  it("starts empty for a company that never filled it in", () => {
    expect(toCompanyLawForm(null)).toEqual({ legalForm: "", values: {} })
  })

  it("leaves out a field that was shown but never typed in", () => {
    expect(toCompanyLawPayload({ legalForm: "IT_SAS", values: { registerOffice: undefined } })).toEqual({
      legalForm: "IT_SAS",
      values: {},
    })
  })

  it("sends an amount typed the French way as one the API accepts", () => {
    expect(
      toCompanyLawPayload({
        legalForm: "FR_SAS",
        values: { shareCapital: { amount: "1 000,50", currency: "EUR" } },
      }),
    ).toEqual({ legalForm: "FR_SAS", values: { shareCapital: { amount: "1000.50", currency: "EUR" } } })
  })
})
