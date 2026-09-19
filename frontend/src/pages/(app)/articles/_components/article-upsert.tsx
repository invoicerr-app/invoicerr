"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useRef } from "react"
import { type Control, type FieldValues, useForm, type UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"
import { useQueryClient } from "@tanstack/react-query"

import { BetterInput } from "@/components/better-input"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  type SteppedDialogHandle,
  type SteppedDialogStep,
  SteppedDialog,
  stepForField,
} from "@/components/ui/stepped-dialog"
import { Textarea } from "@/components/ui/textarea"
import { useCompany } from "@/hooks/queries"
import { usePatch, usePost } from "@/hooks/use-fetch"
import { currencies } from "@/lib/constants/currencies"
import { queryKeys } from "@/lib/query-keys"
import type { Article } from "@/types"

// Basic stock management ("gestion de stock basique") — `number | null` on BOTH sides (never
// `.optional()`, and no `z.preprocess`/`z.coerce`): the two inputs below convert an emptied box to
// `null` themselves (see their own `onChange`), so this schema's INPUT and OUTPUT types are
// identical, which is what keeps `useForm<ArticleForm>` a single, ordinary generic instead of
// needing react-hook-form's separate input/output type parameters. `null` (never `undefined`)
// matters at submit time too: unlike `undefined` (which JSON.stringify DROPS from the request body,
// read by the backend as "field omitted, leave whatever the article already had"), an explicit
// `null` is what EditArticleDto reads as "un-track stock" / "clear the alert threshold" — see
// articles.service.ts's `update` and its own `!== undefined` comment. So leaving either input blank
// on an EDIT is how a user turns stock tracking (or the alert) back off, not a no-op.
const nullableNonNegativeInt = z.number().int().min(0, { message: "Must be >= 0" }).nullable()

/** `unitPrice`/`vatRate` are, unlike stock's `quantity`/`lowStockThreshold` above, genuinely REQUIRED
 *  on the `Article` model (`unitPrice Float @default(0)`, `vatRate Float @default(0)` —
 *  backend/prisma/schema.prisma — neither column is nullable), so an emptied box here has to become a
 *  VALIDATION ERROR, never a stored value. `NaN`, not `undefined`, is the two inputs' own "the box is
 *  empty" sentinel below: `typeof NaN === "number"`, so it stays assignable through
 *  `Control<ArticleForm>`'s strictly-typed `onChange` without widening either field's inferred type to
 *  `number | undefined` (the generic document-field renderers can use `undefined` for exactly this
 *  reason instead — their `Control` is untyped `FieldValues`). `z.number()` treats `NaN` exactly like
 *  `undefined` (`received: "nan"`, the same `invalid_type` branch) — the reason this used to slip
 *  through was `z.coerce.number()`, which reads `Number("") === 0` as a perfectly valid price. */
const requiredAmount = (requiredMessage: string, rangeMessage: string) =>
  z.number({ required_error: requiredMessage, invalid_type_error: requiredMessage }).min(0, {
    message: rangeMessage,
  })

const articleSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  type: z.enum(["HOUR", "DAY", "DEPOSIT", "SERVICE", "PRODUCT"]),
  unitPrice: requiredAmount("Price is required", "Price must be >= 0"),
  vatRate: requiredAmount("VAT rate is required", "VAT must be >= 0"),
  quantity: nullableNonNegativeInt,
  lowStockThreshold: nullableNonNegativeInt,
})

type ArticleForm = z.infer<typeof articleSchema>

interface ArticleUpsertProps {
  article?: Article | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Step 1 — the article's identity: what a line item shows once picked from the catalog. The
 *  `Article` model (backend/prisma/schema.prisma) has no separate "reference" or "unit" field of its
 *  own — the pricing/supply TYPE (hour/day/deposit/service/product) already plays that role, which
 *  is why it groups with price+VAT below rather than here, matching this form's own pre-wizard
 *  layout (type sat in the same grid row as unitPrice/vatRate). `data-cy="article-form"` is the same
 *  attribute every screen-driven e2e spec already reaches for — repeated on all three steps below is
 *  not a collision, since `SteppedDialog` only ever mounts the current one. */
function IdentityStep({ control }: { control: Control<ArticleForm> }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4" data-cy="article-form">
      <FormField
        name="name"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("articles.fields.name.label")}</FormLabel>
            <FormControl>
              <Input {...field} placeholder={t("articles.fields.name.placeholder") as string} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="description"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("articles.fields.description.label")}</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                rows={3}
                placeholder={t("articles.fields.description.placeholder") as string}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

/** Step 2 — price, VAT and the pricing/supply type together, since the three jointly determine what
 *  a line ends up costing. */
function PricingStep({
  control,
  currencySymbol,
}: {
  control: Control<ArticleForm>
  currencySymbol?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-cy="article-form">
      <FormField
        name="type"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("articles.fields.type.label")}</FormLabel>
            <FormControl>
              <Select value={field.value} onValueChange={(val) => field.onChange(val as any)}>
                <SelectTrigger
                  className="w-full"
                  size="sm"
                  aria-label={t("articles.fields.type.label") as string}
                  dataCy="article-type-trigger"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dataCy="article-type-content">
                  <SelectItem value="HOUR">{t("articles.fields.type.hour")}</SelectItem>
                  <SelectItem value="DAY">{t("articles.fields.type.day")}</SelectItem>
                  <SelectItem value="DEPOSIT">{t("articles.fields.type.deposit")}</SelectItem>
                  <SelectItem value="SERVICE">{t("articles.fields.type.service")}</SelectItem>
                  <SelectItem value="PRODUCT">{t("articles.fields.type.product")}</SelectItem>
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="unitPrice"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("articles.fields.unitPrice.label")}</FormLabel>
            <FormControl>
              <BetterInput
                name={field.name}
                onBlur={field.onBlur}
                ref={field.ref}
                // Never a bare `{...field}` — see `requiredAmount`'s own comment on why an emptied
                // box turns into `NaN` here, not the raw string a `{...field}` binding would leave in
                // react-hook-form's state (which `z.coerce.number()` used to read as a silent 0).
                value={Number.isNaN(field.value) ? "" : field.value}
                onChange={(e) => field.onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
                type="number"
                step="0.01"
                min="0"
                postAdornment={currencySymbol}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="vatRate"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("articles.fields.vatRate.label")}</FormLabel>
            <FormControl>
              <BetterInput
                name={field.name}
                onBlur={field.onBlur}
                ref={field.ref}
                value={Number.isNaN(field.value) ? "" : field.value}
                onChange={(e) => field.onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
                type="number"
                step="0.01"
                min="0"
                postAdornment="%"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

/** Step 3 — basic stock management ("gestion de stock basique"), both fields optional and blank by
 *  default: an article starts "not stock-tracked", the same rule Article.quantity's own schema
 *  comment (backend) documents. No "category" field exists on the model — this step stays the two
 *  stock facts it already was pre-wizard. */
function StockStep({ control }: { control: Control<ArticleForm> }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-cy="article-form">
      <FormField
        name="quantity"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("articles.fields.quantity.label")}</FormLabel>
            <FormControl>
              <BetterInput
                name={field.name}
                onBlur={field.onBlur}
                ref={field.ref}
                value={field.value ?? ""}
                // Converts an emptied box to `null` right here — see `nullableNonNegativeInt`'s own
                // comment on why that keeps this schema's input/output types identical.
                onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                type="number"
                step="1"
                min="0"
                placeholder={t("articles.fields.quantity.placeholder") as string}
              />
            </FormControl>
            <FormDescription>{t("articles.fields.quantity.helpText")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="lowStockThreshold"
        control={control}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("articles.fields.lowStockThreshold.label")}</FormLabel>
            <FormControl>
              <BetterInput
                name={field.name}
                onBlur={field.onBlur}
                ref={field.ref}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                type="number"
                step="1"
                min="0"
                placeholder={t("articles.fields.lowStockThreshold.placeholder") as string}
              />
            </FormControl>
            <FormDescription>{t("articles.fields.lowStockThreshold.helpText")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

/**
 * A 3-step wizard (`components/ui/stepped-dialog.tsx`, owner decision 2026-09-16: every "big" dialog
 * moves to this shape) — Identity → Price & VAT → Stock, no separate recap step since the last one
 * (two optional fields) is already short. Create and edit share it; on edit every step opens already
 * clickable (`initialMaxReached`) since the record's own values are already valid — no reason to
 * force a re-walk through steps the user isn't touching.
 */
export function ArticleUpsert({ article, open, onOpenChange }: ArticleUpsertProps) {
  const { t } = useTranslation()
  const isEdit = !!article
  const queryClient = useQueryClient()
  const { data: company } = useCompany()
  const currencySymbol = company?.currency ? currencies[company.currency]?.symbol : undefined

  const { trigger: createTrigger, loading: creating } = usePost("/api/articles")
  const { trigger: updateTrigger, loading: updating } = usePatch(`/api/articles/${article?.id || ""}`)
  // Imperative handle onto `SteppedDialog` — see that component's own `SteppedDialogHandle` header:
  // used ONLY by `onSubmit`'s own `safeParse` fallback below, to jump to whichever step actually
  // shows the first field a stale, unrevalidated step let through.
  const dialogRef = useRef<SteppedDialogHandle>(null)

  const form = useForm<ArticleForm>({
    resolver: zodResolver(articleSchema),
    defaultValues: {
      name: "",
      description: "",
      type: "SERVICE",
      unitPrice: 0,
      vatRate: 0,
      // null, not 0 or undefined — see `optionalNonNegativeInt`'s own comment: an article starts
      // "not stock-tracked" (no alert), never "tracked with zero stock".
      quantity: null,
      lowStockThreshold: null,
    },
  })

  useEffect(() => {
    if (article) {
      form.reset({
        name: article.name || "",
        description: article.description || "",
        type: article.type || "SERVICE",
        unitPrice: article.unitPrice ?? 0,
        vatRate: article.vatRate ?? 0,
        quantity: article.quantity ?? null,
        lowStockThreshold: article.lowStockThreshold ?? null,
      })
    } else {
      form.reset({
        name: "",
        description: "",
        type: "SERVICE",
        unitPrice: 0,
        vatRate: 0,
        quantity: null,
        lowStockThreshold: null,
      })
    }
  }, [article, open, form])

  const steps: SteppedDialogStep[] = [
    {
      id: "identity",
      label: t("articles.upsert.steps.identity"),
      fields: ["name", "description"],
      render: () => <IdentityStep control={form.control} />,
    },
    {
      id: "pricing",
      label: t("articles.upsert.steps.pricing"),
      fields: ["type", "unitPrice", "vatRate"],
      render: () => <PricingStep control={form.control} currencySymbol={currencySymbol} />,
    },
    {
      id: "stock",
      label: t("articles.upsert.steps.stock"),
      fields: ["quantity", "lowStockThreshold"],
      render: () => <StockStep control={form.control} />,
    },
  ]

  const onSubmit = async (raw: ArticleForm) => {
    // `SteppedDialog` hands back `form.getValues()` (whatever's currently in the DOM inputs) and only
    // ever validates the CURRENT step's own fields before calling this — `stepperJumpTo` lets an edit
    // (every chip clickable from the start, `initialMaxReached`) land on any step already reached
    // WITHOUT revalidating it, so a field cleared on a step the user then jumps away from — never
    // revisiting it before hitting the final "Save" — reaches this handler unvalidated. Re-parsing
    // through the same schema here is the actual last line of defense before the request leaves.
    //
    // `articleSchema.parse()` used to sit OUTSIDE this try/catch: a `ZodError` thrown from an `async`
    // function invoked by `onClick` (`SteppedDialog.handleContinue`, never itself `await`ed by its
    // caller) became an unhandled promise rejection — no toast, no field error, the dialog just sat
    // there with the button back to normal, exactly as invisible as the mismatched-type 500
    // `parse()`'s coercion was originally added to catch. `safeParse` turns that failure into DATA
    // instead of a throw: every issue is attached to its own field via `form.setError` so
    // `FormMessage` renders it, and (below) the wizard jumps to whichever step actually shows the
    // first one, so that message is never left sitting behind a step the user isn't even looking at.
    const parsed = articleSchema.safeParse(raw)
    if (!parsed.success) {
      let firstErrorField: string | undefined
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key !== "string") continue
        form.setError(key as never, { type: "manual", message: issue.message })
        firstErrorField ??= key
      }
      // Attaching the error to the field alone isn't enough — the step currently on screen (Stock,
      // in the exact scenario this guards) may not be the one that RENDERS it, so `FormMessage`
      // would sit invisible until the user happened to click back. Jump to whichever step actually
      // declares the first invalid field instead, the same way clicking that step's own header chip
      // would.
      if (firstErrorField) {
        const stepIndex = stepForField(steps, firstErrorField)
        if (stepIndex !== undefined) dialogRef.current?.goToStep(stepIndex)
      }
      toast.error(
        t("articles.upsert.messages.validationError") || "Please fix the highlighted fields before saving",
      )
      return
    }
    const data = parsed.data
    try {
      // usePost/usePatch swallow request failures internally and resolve to
      // `null` instead of throwing, so the result must be checked explicitly
      // — awaiting alone does not tell us whether the request succeeded.
      if (isEdit) {
        const result = await updateTrigger({ ...data })
        if (!result) throw new Error("Update failed")
        toast.success(t("articles.upsert.messages.updateSuccess") || "Article updated")
      } else {
        const result = await createTrigger(data)
        if (!result) throw new Error("Create failed")
        toast.success(t("articles.upsert.messages.addSuccess") || "Article added")
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.articles.list() })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast.error(
        isEdit
          ? t("articles.upsert.messages.updateError") || "Failed to update article"
          : t("articles.upsert.messages.addError") || "Failed to add article",
      )
    }
  }

  return (
    <SteppedDialog
      ref={dialogRef}
      steps={steps}
      form={form as unknown as UseFormReturn<FieldValues>}
      onSubmit={(values) => onSubmit(values as ArticleForm)}
      submitLabel={isEdit ? t("articles.actions.save") : t("articles.actions.add")}
      open={open}
      onOpenChange={onOpenChange}
      title={t(`articles.upsert.title.${isEdit ? "edit" : "create"}`)}
      submitting={creating || updating}
      dataCy="article-dialog"
      submitDataCy="article-submit"
      initialMaxReached={isEdit ? steps.length - 1 : 0}
    />
  )
}

export default ArticleUpsert
