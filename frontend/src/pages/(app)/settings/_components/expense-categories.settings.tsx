"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Tags, Trash2 } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  type ExpenseCategory,
  useArchiveExpenseCategory,
  useCreateExpenseCategory,
  useExpenseCategories,
  useUpdateExpenseCategory,
} from "@/hooks/queries"

import {
  SettingsFormFooter,
  SettingsList,
  SettingsListRow,
  SettingsListSkeleton,
  SettingsPage,
  SettingsRowMenu,
  SettingsSection,
  useSavedFlash,
} from "./settings-section"

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
  const [saved, flash] = useSavedFlash()

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
      flash()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("settings.expenseCategories.messages.createError"),
      )
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} data-cy="expense-category-create-form">
        <SettingsSection
          title={t("settings.expenseCategories.create.title")}
          description={t("settings.expenseCategories.create.description")}
          dataCy="expense-category-create-card"
          contentClassName="grid gap-4 sm:grid-cols-2"
          footer={
            <SettingsFormFooter saved={saved}>
              <Button type="submit" loading={isPending} dataCy="expense-category-create-submit">
                {t("settings.expenseCategories.create.button")}
              </Button>
            </SettingsFormFooter>
          }
        >
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
        </SettingsSection>
      </form>
    </Form>
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
              <Button type="submit" loading={isPending} dataCy="expense-category-rename-submit">
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
    <SettingsListRow
      dataCy={`expense-category-row-${category.id}`}
      badge={
        <>
          <Badge variant="outline" className="font-mono text-[10px]">
            {category.key}
          </Badge>
          {isArchived && (
            <Badge variant="destructive" data-cy={`expense-category-row-archived-${category.id}`}>
              {t("settings.expenseCategories.list.archived")}
            </Badge>
          )}
        </>
      }
      title={<span data-cy={`expense-category-row-label-${category.id}`}>{category.label}</span>}
      primary={
        !isArchived && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRenameOpen(true)}
            dataCy={`expense-category-rename-button-${category.id}`}
          >
            {t("settings.expenseCategories.list.rename")}
          </Button>
        )
      }
      menu={
        !isArchived && (
          <SettingsRowMenu
            dataCy={`expense-category-menu-${category.id}`}
            items={[
              {
                label: t("settings.expenseCategories.list.archive"),
                icon: Trash2,
                destructive: true,
                disabled: archiving,
                dataCy: `expense-category-archive-button-${category.id}`,
                onSelect: handleArchive,
              },
            ]}
          />
        )
      }
    >
      {renameOpen && <RenameDialog category={category} open={renameOpen} onOpenChange={setRenameOpen} />}
    </SettingsListRow>
  )
}

/**
 * Settings -> Expense categories, part of the enriched expense notes ("notes de frais enrichies")
 * feature, product decision 2026-09-15 (see the backend's own `expense-categories/persistence.ts` header for the full
 * "why"). The expense FORM never imports anything from this file — it only ever consumes
 * `describeTypeForCompany`'s own resolved "category" field `options` (same "this screen is entirely
 * optional machinery" posture `custom-fields.settings.tsx`'s own header documents for its case), so a
 * company that never opens this screen still gets its default ten-plus-Other set on the expense form.
 */
export default function ExpenseCategoriesSettings() {
  const { t } = useTranslation()
  const { data: categories, isLoading } = useExpenseCategories()

  return (
    <SettingsPage
      title={t("settings.expenseCategories.title")}
      description={t("settings.expenseCategories.description")}
      dataCy="expense-categories-settings"
    >
      <SettingsSection title={t("settings.expenseCategories.list.title")} dataCy="expense-categories-list">
        {isLoading ? (
          <SettingsListSkeleton rows={3} />
        ) : (categories ?? []).length === 0 ? (
          <EmptyState
            icon={Tags}
            size="sm"
            title={t("settings.expenseCategories.list.empty")}
            data-cy="expense-categories-empty"
          />
        ) : (
          <SettingsList>
            {(categories ?? []).map((category) => (
              <CategoryRow key={category.id} category={category} />
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      <CreateForm />
    </SettingsPage>
  )
}
