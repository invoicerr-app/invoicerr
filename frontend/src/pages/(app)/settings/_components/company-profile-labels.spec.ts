import i18next from "i18next"
import { describe, expect, it } from "vitest"

import en from "@/locales/en/translation.json"
import fr from "@/locales/fr/translation.json"
import type { CompanyProfileAttribute } from "@/types"

import {
  profileAttributeHelp,
  profileAttributeLabel,
  profileAttributeValueLabel,
} from "./company-profile-labels"

async function translator(language: "en" | "fr") {
  const instance = i18next.createInstance()
  await instance.init({
    lng: language,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources: { en: { translation: en }, fr: { translation: fr } },
  })
  return instance.t
}

const vatGroupMember: CompanyProfileAttribute = {
  key: "vatGroupMember",
  label: "VAT group membership",
  labelKey: "settings.company.profile.attributes.vatGroupMember.label",
  help: "Whether this company is a member of an assujetti unique.",
  helpTextKey: "settings.company.profile.attributes.vatGroupMember.help",
  values: [
    {
      value: "MEMBER",
      label: "Member of an assujetti unique",
      labelKey: "settings.company.profile.attributes.vatGroupMember.options.MEMBER",
    },
    {
      value: "NOT_MEMBER",
      label: "Not a member",
      labelKey: "settings.company.profile.attributes.vatGroupMember.options.NOT_MEMBER",
    },
  ],
}

describe("company profile questions in French", () => {
  it("shows the VAT group question and both select options in French", async () => {
    const t = await translator("fr")

    expect(profileAttributeLabel(t, vatGroupMember)).toBe("Appartenance à un assujetti unique")
    expect(vatGroupMember.values.map((option) => profileAttributeValueLabel(t, option))).toEqual([
      "Membre d'un assujetti unique",
      "N'est pas membre",
    ])
    expect(profileAttributeHelp(t, vatGroupMember)).toContain("assujetti unique")
  })
})

describe("company profile questions without a translation key", () => {
  it("renders the raw label and help a third-party country file declared", () => {
    const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
    const raw: CompanyProfileAttribute = {
      key: "headcount",
      label: "Headcount",
      help: "How many people this company employs.",
      values: [{ value: "SMALL", label: "Small" }],
    }

    expect(profileAttributeLabel(t, raw)).toBe("Headcount")
    expect(profileAttributeHelp(t, raw)).toBe("How many people this company employs.")
    expect(profileAttributeValueLabel(t, raw.values[0])).toBe("Small")
  })
})
