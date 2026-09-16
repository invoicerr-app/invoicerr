"use client"

import { Check } from "lucide-react"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react"
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

/** Which step (by index) declares `fieldName` among its own `fields` — `undefined` when none does
 *  (a computed field, a typo, or one every step left out). Pure and DOM-free like the stepper state
 *  functions above: a caller that re-validates the WHOLE form itself after `SteppedDialog`'s own
 *  per-step gate (e.g. a final `schema.safeParse()` before submit — see `article-upsert.tsx`'s own
 *  `onSubmit`) uses this to find which step actually shows a field an error landed on, so it can hand
 *  that index to `SteppedDialogHandle.goToStep` below instead of leaving the error attached to a
 *  field the current step never renders. */
export function stepForField(steps: SteppedDialogStep[], fieldName: string): number | undefined {
  const index = steps.findIndex((step) => step.fields.includes(fieldName))
  return index === -1 ? undefined : index
}

/** Imperative escape hatch — additive, no existing caller needs it — for a caller whose OWN
 *  validation (run outside this component's per-step `form.trigger`) finds an error on a step that
 *  isn't the one currently showing. Attaching the error to the field (`form.setError`) alone isn't
 *  enough: `FormMessage` only renders once that field's OWN step is mounted, and `SteppedDialog`
 *  never re-derives its current step from `form.formState.errors` on its own (doing so unconditionally
 *  would fight the user navigating normally). `goToStep` is deliberately the ONLY thing exposed —
 *  never a way to read or replace the whole stepper state — so a caller can jump to a step it already
 *  knows about without reaching into this component's internals. */
export interface SteppedDialogHandle {
  goToStep: (index: number) => void
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
  /** Disables the LAST step's primary button and, if given, shows `submitTooltip` on hover — for a
   *  caller whose final action isn't runnable at all right now (e.g. every action the country's
   *  policy allows is blocked). Never touched on any step but the last: an earlier step's own
   *  "Continue" always just advances. Without this, a caller with no runnable action left the button
   *  reading "Continue" and `onSubmit` doing nothing when pressed — a dead button with no
   *  explanation. */
  submitDisabled?: boolean
  submitTooltip?: string
  className?: string
  /** Seeds `maxReached` on open — lets a caller EDITING an already-valid record open every step's
   *  header chip clickable from the very first render, instead of gating step 2+ behind walking
   *  forward once first (owner brief: "en modification, toutes les étapes déjà faites"). A create
   *  flow has nothing validated yet, hence the default of 0 — unchanged behavior for every existing
   *  caller that doesn't pass this. Clamped to the last step index so an out-of-range value (e.g. a
   *  stale steps.length from a previous render) can never point past the end. */
  initialMaxReached?: number
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
export const SteppedDialog = forwardRef<SteppedDialogHandle, SteppedDialogProps>(function SteppedDialog(
  {
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
    submitDisabled = false,
    submitTooltip,
    className,
    initialMaxReached = 0,
  },
  ref,
) {
  const { t } = useTranslation()
  const [state, setState] = useState<StepperState>(initStepper)
  const [confirmingClose, setConfirmingClose] = useState(false)

  // See `SteppedDialogHandle`'s own header — `goToStep` bumps `maxReached` too (never just `index`),
  // so a step this jumps to ALSO becomes a clickable header chip, exactly as if the user had walked
  // there normally, rather than a `current` step whose own chip looks unreached.
  useImperativeHandle(
    ref,
    () => ({
      goToStep: (index: number) => {
        const clamped = Math.min(Math.max(index, 0), Math.max(steps.length - 1, 0))
        setState((s) => ({ index: clamped, maxReached: Math.max(s.maxReached, clamped) }))
      },
    }),
    [steps.length],
  )

  // `form.formState` is itself a lazy Proxy: react-hook-form only starts COMPUTING `isDirty` (its own
  // internal `useForm` effect, gated behind `_proxyFormState.isDirty`) once something reads it during
  // a RENDER — reading it only later, inside an event handler, is too late for that first read, which
  // is exactly what `handleOpenChange` below used to do. Proven live (2026-09-16): typing into a
  // single field then pressing Escape closed the dialog immediately, no confirm, on the VERY FIRST
  // close attempt of the dialog's life — every later attempt in the same session worked, because by
  // then something (this line) had already primed the proxy. Destructuring here, every render, is
  // what keeps it primed from the start; the value itself is also what `handleOpenChange` reads.
  const { isDirty } = form.formState

  // A fresh run every time the dialog is (re)opened — never resumes wherever a PREVIOUS open of the
  // same dialog instance left off (a discarded then reopened create dialog starts at step 1 again).
  // `maxReached` alone takes the caller's seed (an edit dialog's own steps start "done"); `index`
  // always starts at 0 regardless — the first step is still what the user sees first, only the
  // header chips past it become clickable immediately.
  //
  // Depends on `open` ALONE — not on `steps.length`/`initialMaxReached`. A caller's step count can
  // change WHILE the dialog stays open (document-create-dialog.tsx: picking a GOVERNMENT client
  // re-fetches B2G fields and can turn an empty field group non-empty, changing `steps.length`);
  // including it here would re-run this effect and snap the user back to step 1 mid-typing. Instead,
  // `lastStepIndex` below clamps `maxReached` at READ time, so a step count that changes mid-session
  // can only ever narrow what's clickable, never reset where the user already is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately open-only, see comment above.
  useEffect(() => {
    if (open) {
      setState({ index: 0, maxReached: Math.max(initialMaxReached, 0) })
    }
  }, [open])

  const lastStepIndex = Math.max(steps.length - 1, 0)
  const currentIndex = Math.min(state.index, lastStepIndex)
  const maxReached = Math.min(state.maxReached, lastStepIndex)
  const current = steps[currentIndex]

  // Focus the first field of whichever step just mounted — a CALLBACK ref rather than a
  // `useRef`+`useEffect(…, [state.index])` pair: the body div below is keyed by `current.id`, so
  // React already remounts it (and calls this) on every step change AND on the dialog's own first
  // open, with no dependency array of its own to keep in sync with the step index.
  //
  // `useCallback([])` is NOT an optimization here, it is correctness: an inline function passed as
  // a `ref` gets a NEW identity every render, and React treats a ref PROP identity change exactly
  // like a DOM node change — it calls the old ref with `null` then the new ref with the (SAME) node,
  // on every single re-render of this component, not just on the `key`-driven remount this comment
  // above assumed was the only trigger. `state.form.watch(...)`-based steps (client-upsert.tsx's own
  // Contact step, filling email then phone) re-render `SteppedDialog` on every keystroke of an
  // EARLIER field, which kept re-stealing focus back to the step's first input mid-typing — proven
  // live (2026-09-16): a `fill()` on the second text field landed in the first one instead, every
  // time. An empty dependency array keeps this callback's identity stable across re-renders, so React
  // only invokes it when the div's own DOM node actually changes (the `key={current.id}` remount).
  const focusFirstField = useCallback((el: HTMLDivElement | null) => {
    const first = el?.querySelector<HTMLElement>(
      "input, textarea, select, button:not([disabled]), [role='combobox'], [tabindex]:not([tabindex='-1'])",
    )
    first?.focus({ preventScroll: true })
  }, [])
  const last = isLastStep({ index: currentIndex, maxReached }, steps.length)

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
    if (next || !isDirty) {
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
                current: currentIndex + 1,
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
                const status = stepStatus({ index: currentIndex, maxReached }, i)
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
              disabled={currentIndex === 0 || submitting}
              onClick={handleBack}
              dataCy={dataCy && `${dataCy}-back`}
            >
              {t("common.back", "Back")}
            </Button>
            <Button
              type="button"
              variant="default"
              loading={submitting}
              disabled={last && submitDisabled}
              tooltip={last && submitDisabled ? submitTooltip : undefined}
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
})
SteppedDialog.displayName = "SteppedDialog"
