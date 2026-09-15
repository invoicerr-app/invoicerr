import { toast } from "sonner"

export type MutationResult<T> = {
  trigger: (body?: any, extraOptions?: RequestInit) => Promise<T | null>
  data: T | null
  loading: boolean
  error: Error | null
  /** Set by `use-fetch.ts#createMethodHook` — the freshest failure, readable synchronously right
   *  after `trigger` resolves (see that field's own comment for why `error` state cannot be, in the
   *  same tick). Optional so a hand-built `MutationResult` without one degrades to the generic
   *  `errorMessage` below, same as before this field existed. */
  lastError?: { current: (Error & { code?: string }) | null }
}

/** Mirrors `backend/src/modules/billing/write-gate.ts`'s own exported `COMPANY_BLOCKED` constant by
 *  name — the four projects in this repo (CLAUDE.md) share no package, so this is the one place the
 *  frontend has to name it by hand, same as any OTHER named backend error code a caller ever branches
 *  on (`TRIAL_SEND_BLOCKED`/`SUBSCRIPTION_SEND_BLOCKED` would need the same treatment if a caller ever
 *  needed to tell them apart from a generic failure). */
const COMPANY_BLOCKED_CODE = "COMPANY_BLOCKED"

/**
 * Wraps a `usePost`/`usePut`/`usePatch`/`useDelete` result so that failed
 * mutations surface a toast instead of being silently swallowed.
 *
 * The underlying `trigger` never rejects: it catches HTTP/network errors
 * internally and resolves with `null`. This wrapper therefore treats BOTH a
 * rejected promise and a `null` resolution as failure, shows `errorMessage`
 * as a toast, and resolves with `null` so callers only run their success
 * path on a non-null result:
 *
 *     const { trigger, loading } = useMutationWithToast(
 *         usePost("/api/things"),
 *         t("things.upsert.messages.saveError", "Failed to save"),
 *     )
 *     const created = await trigger(body)
 *     if (!created) return // error already toasted
 */
export function useMutationWithToast<T>(
  mutation: MutationResult<T>,
  errorMessage: string,
): MutationResult<T> {
  const trigger = async (body?: any, extraOptions?: RequestInit): Promise<T | null> => {
    let result: T | null = null
    try {
      result = await mutation.trigger(body, extraOptions)
    } catch {
      result = null
    }
    if (result === null) {
      // A company-blocked refusal gets the SERVER's own specific message (write-gate.ts) instead of
      // this call site's generic `errorMessage` — every other failure keeps the generic one, exactly
      // as before this field existed.
      const lastError = mutation.lastError?.current
      toast.error(lastError?.code === COMPANY_BLOCKED_CODE ? lastError.message : errorMessage)
    }
    return result
  }

  return { ...mutation, trigger }
}
