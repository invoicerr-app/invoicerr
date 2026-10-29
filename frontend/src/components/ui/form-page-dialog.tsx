import { ChevronDown, X } from "lucide-react"
import { useImperativeHandle, useRef, useState } from "react"
import type React from "react"
import type { FieldValues, UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Form } from "@/components/ui/form"
import { cn } from "@/lib/utils"

export interface FormPageSection {
  id: string
  label: string
  /** The form field names this section holds: used to bring the first invalid one into view. */
  fields: string[]
  render: () => React.ReactNode
  /** For a section whose one field already carries the same label. */
  hideLabel?: boolean
  /** Folded behind its title on a phone until opened; always open on a wider screen. */
  foldOnPhone?: boolean
}

/** The section holding a given field name, for a caller mapping a server-side error back to it. */
export function sectionForField(sections: FormPageSection[], fieldName: string): string | undefined {
  return sections.find((section) => section.fields.includes(fieldName))?.id
}

export interface FormPageDialogHandle {
  goToSection: (id: string) => void
}

export interface FormPageDialogProps<T extends FieldValues = FieldValues> {
  sections: FormPageSection[]
  form: UseFormReturn<T>
  onSubmit: (values: T) => void | Promise<void>
  submitLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  submitting?: boolean
  dataCy?: string
  /** Overrides the primary button `data-cy` (default `${dataCy}-submit`). */
  submitDataCy?: string
  submitDisabled?: boolean
  submitTooltip?: string
  /** Runs before validation, so a pass that removes empty rows happens before they can block it. */
  onBeforeValidate?: () => void
  /** A live preview beside the form on a wide screen, behind an Edit / Preview switch on a phone. */
  preview?: React.ReactNode
  previewLabel?: string
  /** Quieter actions shown at the start of the footer. */
  footerStart?: React.ReactNode
  /** A running figure at the start of the footer on a phone, where the preview is out of sight. */
  footerSummary?: React.ReactNode
  /** Above the sections: a notice that concerns the whole form. */
  notice?: React.ReactNode
  /** `data-cy` of the block wrapping every section. */
  sectionsDataCy?: string
  className?: string
  /** "page" renders the same form as the content of a routed page instead of a modal; the page
   *  itself names it in its header. */
  presentation?: "dialog" | "page"
}

/**
 * Every field of a form on one page, in labelled sections, with the primary action in a footer that
 * stays in view. Closing a dirty form asks first. Submitting validates the whole form and, when a
 * field is invalid, scrolls its section into view and focuses it, so the error is never off screen.
 */
export function FormPageDialog<T extends FieldValues>({
  sections,
  form,
  onSubmit,
  submitLabel,
  open,
  onOpenChange,
  title,
  description,
  submitting = false,
  dataCy,
  submitDataCy,
  submitDisabled = false,
  submitTooltip,
  onBeforeValidate,
  preview,
  previewLabel,
  footerStart,
  footerSummary,
  notice,
  sectionsDataCy,
  className,
  presentation = "dialog",
  ref,
}: FormPageDialogProps<T> & { ref?: React.Ref<FormPageDialogHandle> }) {
  const { t } = useTranslation()
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit")
  const [openOnPhone, setOpenOnPhone] = useState<ReadonlySet<string>>(new Set())
  const bodyRef = useRef<HTMLDivElement>(null)
  // Read during render so react-hook-form starts tracking dirtiness before the first close attempt.
  const { isDirty } = form.formState

  const goToSection = (id: string) => {
    setMobileView("edit")
    setOpenOnPhone((current) => new Set(current).add(id))
    const section = bodyRef.current?.querySelector<HTMLElement>(`[data-section="${id}"]`)
    section?.scrollIntoView({ block: "start", behavior: "smooth" })
  }
  useImperativeHandle(ref, () => ({ goToSection }))

  async function handleSubmit() {
    onBeforeValidate?.()
    const valid = await form.trigger()
    if (!valid) {
      const invalid = sections
        .flatMap((section) => section.fields)
        .find((field) => form.getFieldState(field as never).invalid)
      const sectionId = invalid ? sectionForField(sections, invalid) : undefined
      if (sectionId) goToSection(sectionId)
      if (invalid) form.setFocus(invalid as never)
      return
    }
    await onSubmit(form.getValues())
  }

  function handleOpenChange(next: boolean) {
    if (next || !isDirty) {
      onOpenChange(next)
      return
    }
    setConfirmingClose(true)
  }

  const viewSwitch = preview ? (
    <div
      role="group"
      aria-label={previewLabel}
      className="inline-flex rounded-lg bg-muted p-[3px] lg:hidden"
      data-cy={dataCy && `${dataCy}-view-switch`}
    >
      {(["edit", "preview"] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={mobileView === view}
          onClick={() => setMobileView(view)}
          className={cn(
            "focus-ring h-8 rounded-md px-3 text-sm font-medium",
            mobileView === view ? "bg-card text-foreground shadow-control dark:bg-raised" : "text-ink-2",
          )}
        >
          {view === "edit" ? t("common.formPage.edit") : t("common.formPage.preview")}
        </button>
      ))}
    </div>
  ) : null

  const sectionList = (
    <div className="space-y-5" data-cy={sectionsDataCy}>
      {notice}
      {sections.map((section) => (
        <section
          key={section.id}
          data-section={section.id}
          aria-labelledby={`${dataCy ?? "form-page"}-${section.id}-title`}
          className="scroll-mt-4 rounded-xl border bg-card p-4 shadow-sheet sm:p-6"
          data-cy={dataCy && `${dataCy}-step-body-${section.id}`}
        >
          <h3
            id={`${dataCy ?? "form-page"}-${section.id}-title`}
            className={cn(
              "mb-4 text-[15px] font-semibold",
              section.hideLabel && "sr-only",
              section.foldOnPhone && !openOnPhone.has(section.id) && "max-sm:mb-0",
            )}
          >
            {section.foldOnPhone ? (
              <button
                type="button"
                className="focus-ring flex w-full items-center justify-between gap-2 rounded-sm text-start sm:pointer-events-none"
                aria-expanded={openOnPhone.has(section.id)}
                onClick={() =>
                  setOpenOnPhone((current) => {
                    const next = new Set(current)
                    if (next.has(section.id)) next.delete(section.id)
                    else next.add(section.id)
                    return next
                  })
                }
              >
                {section.label}
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground sm:hidden",
                    openOnPhone.has(section.id) && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>
            ) : (
              section.label
            )}
          </h3>
          <div className={cn(section.foldOnPhone && !openOnPhone.has(section.id) && "max-sm:hidden")}>
            {section.render()}
          </div>
        </section>
      ))}
    </div>
  )

  const footer = (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t bg-card px-4 py-3 sm:px-8",
        presentation === "page" &&
          "sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
      )}
    >
      {footerSummary && <div className="min-w-0 me-auto lg:hidden">{footerSummary}</div>}
      <div className={cn("flex min-w-0 flex-wrap items-center gap-2", footerSummary && "max-sm:hidden")}>
        {footerStart}
      </div>
      <div className="ms-auto flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={() => handleOpenChange(false)}
          dataCy={dataCy && `${dataCy}-cancel`}
          className={cn(footerSummary && "max-sm:hidden")}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          loading={submitting}
          disabled={submitDisabled}
          tooltip={submitDisabled ? submitTooltip : undefined}
          onClick={handleSubmit}
          dataCy={submitDataCy ?? (dataCy && `${dataCy}-submit`)}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )

  const body =
    presentation === "page" ? (
      <div data-cy={dataCy} className={cn("flex min-h-full flex-col", className)}>
        <Form {...form}>
          <div className="mx-auto w-full max-w-7xl flex-1 px-4 pt-1 pb-8 md:px-6">
            <div className="mb-5 flex items-center gap-3 lg:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("common.close")}
                onClick={() => handleOpenChange(false)}
                dataCy={dataCy && `${dataCy}-close`}
              >
                <X aria-hidden="true" />
              </Button>
              <div className="flex flex-1 justify-center pe-9">{viewSwitch}</div>
            </div>
            {description && <p className="-mt-1 mb-6 text-[15px] text-ink-2 max-lg:hidden">{description}</p>}
            <div
              className={cn(
                "grid items-start gap-8",
                preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]",
              )}
            >
              <div
                ref={bodyRef}
                className={cn("min-w-0", preview && mobileView === "preview" && "hidden lg:block")}
              >
                {sectionList}
              </div>
              {preview && (
                <aside
                  aria-label={previewLabel}
                  className={cn("min-w-0 lg:sticky lg:top-4", mobileView === "edit" && "hidden lg:block")}
                >
                  <p className="mb-3 text-[14px] font-semibold text-ink-2 max-lg:hidden">{previewLabel}</p>
                  {preview}
                </aside>
              )}
            </div>
          </div>
          {footer}
        </Form>
      </div>
    ) : (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          data-cy={dataCy}
          className={cn(
            "flex flex-col gap-0 overflow-hidden p-0",
            "inset-0 top-0 start-0 h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 rounded-none",
            "sm:inset-auto sm:top-[50%] sm:start-[50%] sm:h-[min(92vh,980px)] sm:w-[calc(100%-3rem)] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg",
            preview ? "sm:max-w-6xl" : "sm:max-w-3xl",
            className,
          )}
        >
          <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-5 pb-3 sm:px-8 sm:pt-7">
            <div className="min-w-0">
              <DialogTitle className="text-[26px] sm:text-[30px]">{title}</DialogTitle>
              {description ? (
                <DialogDescription className="mt-1 text-ink-2">{description}</DialogDescription>
              ) : (
                <DialogDescription className="sr-only">{title}</DialogDescription>
              )}
            </div>
            {viewSwitch}
          </div>

          <Form {...form}>
            <div
              className={cn("grid min-h-0 flex-1", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]")}
            >
              <div
                ref={bodyRef}
                className={cn(
                  "min-h-0 overflow-y-auto px-4 pb-6 sm:px-8",
                  preview && mobileView === "preview" && "hidden lg:block",
                )}
              >
                {sectionList}
              </div>
              {preview && (
                <aside
                  aria-label={previewLabel}
                  className={cn(
                    "min-h-0 overflow-y-auto bg-sunken px-4 py-6 sm:px-8 lg:border-s lg:px-6",
                    mobileView === "edit" && "hidden lg:block",
                  )}
                >
                  {preview}
                </aside>
              )}
            </div>
            {footer}
          </Form>
        </DialogContent>
      </Dialog>
    )

  return (
    <>
      {body}

      <AlertDialog open={confirmingClose} onOpenChange={setConfirmingClose}>
        <AlertDialogContent data-cy={dataCy && `${dataCy}-discard-confirm`}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("documents.form.stepped.discardTitle", "Discard changes?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "documents.form.stepped.discardDescription",
                "You have unsaved changes. Closing now will lose them.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-cy={dataCy && `${dataCy}-discard-cancel`}>
              {t("documents.form.stepped.keepEditing", "Keep editing")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingClose(false)
                onOpenChange(false)
              }}
              data-cy={dataCy && `${dataCy}-discard-confirm-btn`}
            >
              {t("documents.form.stepped.discardConfirm", "Discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
