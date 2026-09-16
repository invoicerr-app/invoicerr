"use client"

import { Check } from "lucide-react"
import { useEffect, useState } from "react"
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Form } from "@/components/ui/form"
import { cn } from "@/lib/utils"

export interface SteppedDialogStep {
  id: string
  label: string
  /** Field names `react-hook-form`'s `trigger()` validates before "Continue" is allowed to leave
   *  this step — an empty array means the step has nothing of its own to block on (e.g. a
   *  read-only recap). Loosely typed (not `Path<TFieldValues>[]`): every caller here builds this
   *  list from a DYNAMIC descriptor (document-create-dialog.tsx), the same reason the rest of the
   *  documents module casts a field key `as never` rather than fighting react-hook-form's static
   *  key-path generics (see onboarding.tsx's own `form.setError(... as never, ...)`). */
  fields: string[]
  render: () => React.ReactNode
}

/**
 * ---- Pure navigation state -------------------------------------------------------------------
 * Kept free of React and the DOM on purpose: `stepped-dialog.spec.tsx` exercises the actual rules
 * (validation blocks forward movement, backward movement is always free, a step once reached stays
 * clickable) against these functions directly, with no dialog mounted at all.
 */
export interface StepperState {
  index: number
  /** The furthest step index this run has ever validated INTO. Everything up to and including it
   *  is "done" (or "current") and its header chip stays clickable even after stepping back — a
   *  step's own validated values don't become stale just because the user is looking at an earlier
   *  one; only stepping FORWARD past a step re-validates it. */
  maxReached: number
}

export function initStepper(): StepperState {
  return { index: 0, maxReached: 0 }
}

export function stepperAdvance(state: StepperState, totalSteps: number): StepperState {
  const next = Math.min(state.index + 1, Math.max(totalSteps - 1, 0))
  return { index: next, maxReached: Math.max(state.maxReached, next) }
}

/** Backward navigation is unconditional — "retour libre" (owner brief): never gated on validation,
 *  the values already on the earlier step are exactly what got the user past it the first time. */
export function stepperRetreat(state: StepperState): StepperState {
  return { ...state, index: Math.max(0, state.index - 1) }
}

/** Jumping via a header chip — only ever onto a step already reached (`target <= maxReached`); a
 *  step ahead of that has never been validated and clicking it must do nothing. */
export function stepperJumpTo(state: StepperState, target: number): StepperState {
  if (target < 0 || target > state.maxReached || target === state.index) return state
  return { ...state, index: target }
}

export function isLastStep(state: StepperState, totalSteps: number): boolean {
  return state.index >= totalSteps - 1
}

export type StepStatus = "done" | "current" | "upcoming"

export function stepStatus(state: StepperState, index: number): StepStatus {
  if (index === state.index) return "current"
  return index <= state.maxReached ? "done" : "upcoming"
}

export interface SteppedDialogProps {
  steps: SteppedDialogStep[]
  form: UseFormReturn<FieldValues>
  /** Fires when "Continue" is pressed on the LAST step and that step's own fields pass validation.
   *  Receives the form's current values as a convenience; most callers read `form.getValues()`
   *  themselves instead (e.g. to hand them to an action runner that revalidates the WHOLE form —
   *  see document-create-dialog.tsx's own comment on why per-step validation here is a screen
   *  convenience, never a substitute for that). */
  onSubmit: (values: FieldValues) => void | Promise<void>
  /** The final step's primary button label (e.g. "Save draft") — everywhere else it reads
   *  `common.next` ("Continue"). */
  submitLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  /** Shows a spinner on the primary button and disables both, while a submit is in flight. */
  submitting?: boolean
  dataCy?: string
  /** Overrides the LAST step's primary button `data-cy` (default: `${dataCy}-submit`) — lets a
   *  caller keep an existing, e2e-relied-upon id (e.g. `document-action-save-draft`, the exact
   *  attribute the previous flat form already carried) instead of adopting this component's own
   *  generic one. */
  submitDataCy?: string
  className?: string
}

/**
 * A multi-step modal, in the shape the owner asked every "big" dialog to move to (2026-09-16),
 * modeled on `onboarding.tsx`'s own wizard: one step visible at a time, a header of numbered chips
 * (done steps clickable, upcoming ones inert), a FIXED footer ("Back" / "Continue", the last step's
 * "Continue" replaced by the caller's own final action), full-screen below `sm` so a long step never
 * fights a phone viewport for room.
 *
 * Linear with validation: "Continue" runs `form.trigger(step.fields)` for the CURRENT step only —
 * never the whole form — and refuses to advance while it fails (react-hook-form already renders the
 * per-field errors this surfaces, via each step's own `render()`). This is deliberately narrower
 * than "the whole form is valid": a later step's fields aren't necessarily mounted yet (see
 * `document-create-dialog.tsx`'s own comment on why that's fine — react-hook-form keeps a field's
 * value once registered even while its input is unmounted, as long as nothing sets
 * `shouldUnregister`, which nothing here does).
 */
export function SteppedDialog({
  steps,
  form,
  onSubmit,
  submitLabel,
  open,
  onOpenChange,
  title,
  submitting = false,
  dataCy,
  submitDataCy,
  className,
}: SteppedDialogProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<StepperState>(initStepper)
  const [confirmingClose, setConfirmingClose] = useState(false)

  // A fresh run every time the dialog is (re)opened — never resumes wherever a PREVIOUS open of the
  // same dialog instance left off (a discarded then reopened create dialog starts at step 1 again).
  useEffect(() => {
    if (open) setState(initStepper())
  }, [open])

  const current = steps[state.index]

  // Focus the first field of whichever step just mounted — a CALLBACK ref rather than a
  // `useRef`+`useEffect(…, [state.index])` pair: the body div below is keyed by `current.id`, so
  // React already remounts it (and calls this) on every step change AND on the dialog's own first
  // open, with no dependency array of its own to keep in sync with the step index.
  function focusFirstField(el: HTMLDivElement | null) {
    const first = el?.querySelector<HTMLElement>(
      "input, textarea, select, button:not([disabled]), [role='combobox'], [tabindex]:not([tabindex='-1'])",
    )
    first?.focus({ preventScroll: true })
  }
  const last = isLastStep(state, steps.length)

  async function handleContinue() {
    const valid = current.fields.length === 0 ? true : await form.trigger(current.fields as never)
    if (!valid) return
    if (last) {
      await onSubmit(form.getValues())
      return
    }
    setState((s) => stepperAdvance(s, steps.length))
  }

  function handleBack() {
    setState((s) => stepperRetreat(s))
  }

  // Both the close (X) button, Escape, and an outside click all funnel through Radix's own
  // `onOpenChange` — intercepted here rather than duplicated across `onEscapeKeyDown`/
  // `onInteractOutside`: `open` stays under the CALLER's control (this component never calls
  // `onOpenChange(false)` itself while the form is dirty), so Radix's attempt to close is simply a
  // no-op until the confirm dialog resolves it one way or the other.
  function handleOpenChange(next: boolean) {
    if (next || !form.formState.isDirty) {
      onOpenChange(next)
      return
    }
    setConfirmingClose(true)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          data-cy={dataCy}
          className={cn(
            "flex flex-col gap-0 p-0",
            // Full-screen below `sm` (owner brief) — every positioning/sizing utility the base
            // DialogContent hardcodes with no breakpoint prefix is overridden here at the SAME
            // specificity (no prefix), then restored at `sm:` and up.
            "inset-0 top-0 left-0 h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 rounded-none border-0",
            "sm:inset-auto sm:top-[50%] sm:left-[50%] sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-2xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border",
            className,
          )}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>

          <div className="border-b px-4 py-3 sm:px-6 sm:py-4">
            <h2 className="hidden text-lg font-semibold sm:block">{title}</h2>

            {/* Compact "2/4 · Lines" — the only header a phone-width step gets room for. */}
            <p className="text-sm font-medium text-foreground sm:hidden" aria-live="polite">
              {t("documents.form.stepped.compactIndicator", "{{current}}/{{total}} · {{label}}", {
                current: state.index + 1,
                total: steps.length,
                label: current.label,
              })}
            </p>

            <nav
              aria-label={t("documents.form.stepped.stepsNav", "Steps")}
              className="mt-3 hidden items-center gap-1 sm:flex sm:flex-wrap"
              data-cy={dataCy && `${dataCy}-steps`}
            >
              {steps.map((step, i) => {
                const status = stepStatus(state, i)
                const clickable = status !== "upcoming"
                return (
                  <div key={step.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!clickable}
                      aria-current={status === "current" ? "step" : undefined}
                      onClick={() => setState((s) => stepperJumpTo(s, i))}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-colors disabled:cursor-default",
                        status === "current" && "bg-primary/10 text-primary",
                        status === "done" && "text-foreground hover:bg-accent",
                        status === "upcoming" && "text-muted-foreground",
                      )}
                      data-cy={dataCy && `${dataCy}-step-${step.id}`}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                          status === "done"
                            ? "border-primary bg-primary text-primary-foreground"
                            : status === "current"
                              ? "border-primary text-primary"
                              : "border-muted-foreground/30",
                        )}
                      >
                        {status === "done" ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      {step.label}
                    </button>
                    {i < steps.length - 1 && (
                      <div className="h-px w-3 shrink-0 bg-border" aria-hidden="true" />
                    )}
                  </div>
                )
              })}
            </nav>
          </div>

          <div
            ref={focusFirstField}
            key={current.id}
            className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150 min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5"
            data-cy={dataCy && `${dataCy}-step-body-${current.id}`}
          >
            {/* `useFormContext()` — every field renderer in the documents module reads it — needs a
                `FormProvider` ancestor; this is the one place that context is established, so a
                caller's `render()` never has to wrap itself. */}
            <Form {...form}>{current.render()}</Form>
          </div>

          <div className="flex items-center justify-between gap-2 border-t px-4 py-3 sm:px-6 sm:py-4">
            <Button
              type="button"
              variant="outline"
              disabled={state.index === 0 || submitting}
              onClick={handleBack}
              dataCy={dataCy && `${dataCy}-back`}
            >
              {t("common.back", "Back")}
            </Button>
            <Button
              type="button"
              variant="default"
              loading={submitting}
              onClick={handleContinue}
              dataCy={
                last ? (submitDataCy ?? (dataCy && `${dataCy}-submit`)) : dataCy && `${dataCy}-continue`
              }
            >
              {last ? submitLabel : t("common.next")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
