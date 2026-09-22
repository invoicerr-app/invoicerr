import { describe, expect, it } from "vitest"

import {
  type DescriptorTranslator,
  descriptorActionLabel,
  descriptorActionParamLabel,
  descriptorActionParamOptionLabel,
  descriptorFieldLabel,
  descriptorFieldOptionLabel,
  descriptorStatusLabel,
  descriptorTypeLabel,
  descriptorWidgetLabel,
  translateDocumentTypeDescriptor,
  translateDocumentTypeSummary,
  translateWidget,
} from "./descriptor-i18n"
import type { DocumentTypeDescriptor, DocumentTypeSummary } from "@/components/documents/types"
import type { MetricWidget } from "@/components/widgets/types"

/**
 * A small EN catalog, deliberately narrower than the real locales/en/translation.json — only
 * `documents.descriptors.invoice.*` is populated, so `quote`/a hypothetical plugin type both stay in
 * "no key exists" territory throughout this file, exactly as they would for a locale that hasn't
 * caught up yet (or for a type this catalog will never know about).
 */
const TRANSLATIONS: Record<string, string> = {
  "documents.descriptors.invoice.label": "Facture",
  "documents.descriptors.invoice.fields.notes.label": "Remarques",
  "documents.descriptors.invoice.fields.lines.fields.description.label": "Désignation",
  "documents.descriptors.invoice.actions.send.label": "Envoyer",
  "documents.descriptors.invoice.actions.record-payment.params.method.label": "Moyen",
  "documents.descriptors.invoice.actions.record-payment.params.method.options.card": "Carte",
  "documents.descriptors.invoice.statuses.sent": "Envoyée",
  "documents.descriptors.invoice.widgets.invoice:pending.label": "Factures en attente",
}

/**
 * Models i18next's own `t(key, { defaultValue })` contract precisely: the translation when `key` is
 * known, `defaultValue` verbatim otherwise — never the raw key itself (i18next only falls back to
 * the bare key when NEITHER a translation NOR a `defaultValue` exists, which none of the calls under
 * test ever do — every call site in descriptor-i18n.ts always passes one).
 */
function fakeT(key: string, options?: { defaultValue?: string }): string {
  return TRANSLATIONS[key] ?? options?.defaultValue ?? key
}

describe("descriptor-i18n", () => {
  describe("known key: translates", () => {
    it("descriptorTypeLabel", () => {
      expect(descriptorTypeLabel(fakeT, "invoice", "Invoice")).toBe("Facture")
    })

    it("descriptorFieldLabel — top-level field", () => {
      expect(descriptorFieldLabel(fakeT, "invoice", ["notes"], "Notes")).toBe("Remarques")
    })

    it("descriptorFieldLabel — nested 'array' row field", () => {
      expect(descriptorFieldLabel(fakeT, "invoice", ["lines", "description"], "Designation")).toBe(
        "Désignation",
      )
    })

    it("descriptorActionLabel", () => {
      expect(descriptorActionLabel(fakeT, "invoice", "send", "Send")).toBe("Envoyer")
    })

    it("descriptorActionParamLabel and descriptorActionParamOptionLabel", () => {
      expect(descriptorActionParamLabel(fakeT, "invoice", "record-payment", ["method"], "Method")).toBe(
        "Moyen",
      )
      expect(
        descriptorActionParamOptionLabel(fakeT, "invoice", "record-payment", ["method"], "card", "Card"),
      ).toBe("Carte")
    })

    it("descriptorStatusLabel", () => {
      expect(descriptorStatusLabel(fakeT, "invoice", "sent", "Sent")).toBe("Envoyée")
    })

    it("descriptorWidgetLabel — recovers the type id from the widget id's own prefix", () => {
      expect(descriptorWidgetLabel(fakeT, "invoice:pending", "Pending invoices")).toBe("Factures en attente")
    })
  })

  describe("the fallback contract — no matching key", () => {
    it("descriptorFieldOptionLabel falls back to the raw option label untouched", () => {
      // No "documents.descriptors.invoice.fields.currency.options.EUR" key was ever added (a currency
      // ISO code isn't naturally localized) — this is the routine case, not an edge case.
      expect(descriptorFieldOptionLabel(fakeT, "invoice", ["currency"], "EUR", "EUR")).toBe("EUR")
    })

    it("a whole plugin type with no key at all renders every raw label verbatim", () => {
      // The entire point of this mechanism (see this file's own header): a THIRD-PARTY type this EN
      // catalog has never heard of must display EXACTLY what its own descriptor says, in whatever
      // language it wrote it in — French here, deliberately, to prove nothing about this mechanism
      // assumes the fallback text is English.
      expect(descriptorTypeLabel(fakeT, "plugin-acme-widget", "Le Machin Acme")).toBe("Le Machin Acme")
      expect(descriptorFieldLabel(fakeT, "plugin-acme-widget", ["rating"], "Note sur 5")).toBe("Note sur 5")
      expect(descriptorActionLabel(fakeT, "plugin-acme-widget", "rate", "Noter")).toBe("Noter")
      expect(descriptorStatusLabel(fakeT, "plugin-acme-widget", "brouillon", "Brouillon")).toBe("Brouillon")
    })
  })

  describe("MUTATION: a fallback-less t() breaks the escape hatch", () => {
    // A translator that ignores `defaultValue` (the exact shape of the bug this mechanism must never
    // regress into: dropping `{ defaultValue }` from a call in descriptor-i18n.ts) — i18next's own
    // default behavior when no defaultValue and no translation exist is to hand back the bare KEY,
    // never the caller's raw label. This is the one test the task's own mutation should snap: if any
    // `descriptor*Label` helper stops passing `defaultValue` through, this starts failing instead of
    // silently degrading to raw keys on screen.
    const noFallbackT: DescriptorTranslator = (key) => TRANSLATIONS[key] ?? key

    it("an unknown type's label degrades to the raw KEY, not the descriptor's own label", () => {
      const result = descriptorTypeLabel(noFallbackT, "plugin-acme-widget", "Le Machin Acme")
      expect(result).not.toBe("Le Machin Acme")
      expect(result).toBe("documents.descriptors.plugin-acme-widget.label")
    })
  })

  describe("translateDocumentTypeDescriptor — the whole-tree walk", () => {
    const descriptor: DocumentTypeDescriptor = {
      id: "invoice",
      label: "Invoice",
      fields: [
        { key: "notes", kind: "longText", label: "Notes" },
        {
          key: "lines",
          kind: "array",
          label: "Lines",
          fields: [
            { key: "description", kind: "text", label: "Designation" },
            {
              key: "currency",
              kind: "select",
              label: "Currency",
              options: [{ value: "EUR", label: "EUR" }],
            },
          ],
        },
      ],
      actions: [
        {
          id: "record-payment",
          label: "Record payment",
          availableWhen: "always",
          params: [
            {
              key: "method",
              kind: "select",
              label: "Method",
              options: [
                { value: "card", label: "Card" },
                { value: "cash", label: "Cash" },
              ],
            },
          ],
        },
      ],
      statuses: [
        { id: "draft", label: "Draft" },
        { id: "sent", label: "Sent" },
      ],
    }

    const translated = translateDocumentTypeDescriptor(fakeT, descriptor)

    it("translates the type's own label", () => {
      expect(translated.label).toBe("Facture")
    })

    it("translates a top-level field and a nested row field, leaves key/kind untouched", () => {
      expect(translated.fields[0]).toMatchObject({ key: "notes", kind: "longText", label: "Remarques" })
      const lines = translated.fields[1]
      expect(lines.fields?.[0]).toMatchObject({ key: "description", label: "Désignation" })
    })

    it("falls back per-field when no key matches (currency's option here)", () => {
      const currencyField = translated.fields[1].fields?.[1]
      expect(currencyField?.label).toBe("Currency") // no key for this field itself either
      expect(currencyField?.options?.[0]).toEqual({ value: "EUR", label: "EUR" })
    })

    it("translates an action's own label and its params (label translated, cash falls back)", () => {
      const action = translated.actions[0]
      expect(action.label).toBe("Record payment") // no key added for the action's OWN label here
      expect(action.params?.[0].label).toBe("Moyen")
      expect(action.params?.[0].options).toEqual([
        { value: "card", label: "Carte" },
        { value: "cash", label: "Cash" }, // no matching key — untouched
      ])
    })

    it("translates statuses, one by one", () => {
      expect(translated.statuses).toEqual([
        { id: "draft", label: "Draft" }, // no key for "draft" in this fake catalog
        { id: "sent", label: "Envoyée" },
      ])
    })

    it("never mutates the original descriptor", () => {
      expect(descriptor.label).toBe("Invoice")
      expect(descriptor.fields[0].label).toBe("Notes")
      expect(descriptor.actions[0].label).toBe("Record payment")
    })
  })

  it("translateDocumentTypeSummary translates the flat { id, label } shape", () => {
    const summary: DocumentTypeSummary = { id: "invoice", label: "Invoice" }
    expect(translateDocumentTypeSummary(fakeT, summary)).toEqual({ id: "invoice", label: "Facture" })

    const unknownSummary: DocumentTypeSummary = { id: "expense", label: "Expense" }
    expect(translateDocumentTypeSummary(fakeT, unknownSummary)).toEqual({
      id: "expense",
      label: "Expense", // no key in this fake catalog — falls back
    })
  })

  it("translateWidget recovers the type id from the widget's own id prefix", () => {
    const widget: MetricWidget = {
      id: "invoice:pending",
      kind: "metric",
      label: "Pending invoices",
      value: 3,
    }
    expect(translateWidget(fakeT, widget)).toMatchObject({ label: "Factures en attente", value: 3 })

    const unmatched: MetricWidget = {
      id: "invoice:pending-total:USD",
      kind: "metric",
      label: "Pending invoices total (USD)",
      value: 10,
    }
    // No key for a per-currency widget id — the mechanism still applies, it just never matches.
    expect(translateWidget(fakeT, unmatched).label).toBe("Pending invoices total (USD)")
  })
})
