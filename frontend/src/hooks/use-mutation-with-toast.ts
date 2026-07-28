import { toast } from "sonner"

export type MutationResult<T> = {
  trigger: (body?: any, extraOptions?: RequestInit) => Promise<T | null>
  data: T | null
  loading: boolean
  error: Error | null
}

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
      toast.error(errorMessage)
    }
    return result
  }

  return { ...mutation, trigger }
}
