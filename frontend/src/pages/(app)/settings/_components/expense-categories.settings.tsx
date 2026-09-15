"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  type ExpenseCategory,
  useArchiveExpenseCategory,
  useCreateExpenseCategory,
  useExpenseCategories,
  useUpdateExpenseCategory,
} from "@/hooks/queries"

function buildLabelSchema(t: (key: string) => string) {
  return z.object({
    label: z.string().min(1, t("settings.expenseCategories.form.validation.labelRequired")),
  })
}

type LabelFormValues = z.infer<ReturnType<typeof buildLabelSchema>>

/** The create form — a fresh category every submit, deriving `key` server-side from `label` (see the
 *  backend's own `ExpenseCategory.key` header: immutable, never accepted from the caller). */
function CreateForm() {
  const { t } = useTranslation()
  const { mutateAsync: create, isPending } = useCreateExpenseCategory()

  const schema = buildLabelSchema(t)
  const form = useForm<LabelFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { label: "" },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create({ label: values.label })
      toast.success(t("settings.expenseCategories.messages.created"))
      form.reset({ label: "" })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("settings.expenseCategories.messages.createError"),
      )
    }
  })

  return (
    <Card data-cy="expense-category-create-card">
      <CardHeader>
        <CardTitle>{t("settings.expenseCategories.create.title")}</CardTitle>
        <CardDescription>{t("settings.expenseCategories.create.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={onSubmit} data-cy="expense-category-create-form">
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.expenseCategories.form.label")}</FormLabel>
                  <FormControl>
                    <Input {...field} data-cy="expense-category-label-input" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end">
              <Button type="submit" disabled={isPending} dataCy="expense-category-create-submit">
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("settings.expenseCategories.create.button")}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

interface RenameDialogProps {
  category: ExpenseCategory
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Renames a category — the ONLY mutable fact one has besides archival (see the backend's own
 *  `UpdateExpenseCategoryInput` header: `key` is frozen forever). */
function RenameDialog({ category, open, onOpenChange }: RenameDialogProps) {
  const { t } = useTranslation()
  const { mutateAsync: update, isPending } = useUpdateExpenseCategory()

  const schema = buildLabelSchema(t)
  const form = useForm<LabelFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { label: category.label },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update({ id: category.id, label: values.label })
      toast.success(t("settings.expenseCategories.messages.updated"))
      onOpenChange(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("settings.expenseCategories.messages.updateError"),
      )
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-cy="expense-category-rename-dialog">
        <DialogHeader>
          <DialogTitle>{t("settings.expenseCategories.rename.title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={onSubmit}>
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.expenseCategories.form.label")}</FormLabel>
                  <FormControl>
                    <Input {...field} data-cy="expense-category-rename-label-input" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={isPending} dataCy="expense-category-rename-submit">
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("settings.expenseCategories.rename.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

interface CategoryRowProps {
  category: ExpenseCategory
}

function CategoryRow({ category }: CategoryRowProps) {
  const { t } = useTranslation()
  const [renameOpen, setRenameOpen] = useState(false)
  const { mutateAsync: archive, isPending: archiving } = useArchiveExpenseCategory()
  const isArchived = !!category.archivedAt

  const handleArchive = async () => {
    try {
      await archive({ id: category.id })
      toast.success(t("settings.expenseCategories.messages.archived"))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("settings.expenseCategories.messages.archiveError"),
      )
    }
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0"
      data-cy={`expense-category-row-${category.id}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium" data-cy={`expense-category-row-label-${category.id}`}>
            {category.label}
          </span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {category.key}
          </Badge>
          {isArchived && (
            <Badge variant="destructive" data-cy={`expense-category-row-archived-${category.id}`}>
              {t("settings.expenseCategories.list.archived")}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!isArchived && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRenameOpen(true)}
              dataCy={`expense-category-rename-button-${category.id}`}
            >
              {t("settings.expenseCategories.list.rename")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={archiving}
              onClick={handleArchive}
              dataCy={`expense-category-archive-button-${category.id}`}
            >
              {t("settings.expenseCategories.list.archive")}
            </Button>
          </>
        )}
      </div>

      {renameOpen && <RenameDialog category={category} open={renameOpen} onOpenChange={setRenameOpen} />}
    </div>
  )
}

/**
 * TODO_FEATURES.md rank 13 ("notes de frais enrichies") — Settings -> Expense categories, product
 * decision 2026-09-15 (see the backend's own `expense-categories/persistence.ts` header for the full
 * "why"). The expense FORM never imports anything from this file — it only ever consumes
 * `describeTypeForCompany`'s own resolved "category" field `options` (same "this screen is entirely
 * optional machinery" posture `custom-fields.settings.tsx`'s own header documents for its case), so a
 * company that never opens this screen still gets its default ten-plus-Other set on the expense form.
 */
export default function ExpenseCategoriesSettings() {
  const { t } = useTranslation()
  const { data: categories, isLoading } = useExpenseCategories()

  return (
    <div className="space-y-6" data-cy="expense-categories-settings">
      <div>
        <h1 className="text-3xl font-bold">{t("settings.expenseCategories.title")}</h1>
        <p className="text-muted-foreground">{t("settings.expenseCategories.description")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card data-cy="expense-categories-list">
            <CardHeader>
              <CardTitle>{t("settings.expenseCategories.list.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.expenseCategories.list.loading")}
                </p>
              ) : (categories ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("settings.expenseCategories.list.empty")}</p>
              ) : (
                (categories ?? []).map((category) => <CategoryRow key={category.id} category={category} />)
              )}
            </CardContent>
          </Card>
        </div>

        <CreateForm />
      </div>
    </div>
  )
}
