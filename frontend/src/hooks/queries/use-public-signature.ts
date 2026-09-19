import { useQuery } from "@tanstack/react-query"

import { authenticatedFetch } from "@/hooks/use-fetch"
import { ApiError, useApiMutation, useApiQuery } from "@/hooks/use-api-query"

/**
 * The frontend half of the signature flow — four PUBLIC, unauthenticated endpoints
 * (`backend/.../public/public-signatures.controller.ts`), driving the `/signature/:token` page. No
 * `useApiQuery`/`useApiMutation` call here is any different from an authenticated one (both hooks
 * only ever wrap `authenticatedFetch`, which sends the session cookie IF one exists but never
 * requires it) — the backend side is what actually enforces "no session needed" (`@Public()`),
 * exactly the same split `share-links`'s own public PDF route already has.
 */

export interface PublicSignatureView {
  typeId: string
  /** The document's own frozen display number, or null for the (never really exercised in practice)
   *  case where numbering somehow never took — see the backend's own `PublicSignatureView` header. */
  displayNumber: string | null
}

const publicSignatureKey = (token: string) => ["public-signature", token]

/** A generic 400 (unknown/locked/already-signed token) surfaces as a normal `ApiError` — the caller
 *  shows its message, the same way every OTHER screen in this codebase already handles one. */
export function usePublicSignature(token: string) {
  return useApiQuery<PublicSignatureView>(
    publicSignatureKey(token),
    `/api/public/signatures/${encodeURIComponent(token)}`,
    { retry: false },
  )
}

/**
 * The document this signature will seal — `GET .../document` (`SignaturesService.getPublicDocument`'s
 * own header: rendered once, frozen, byte-identical on every later fetch, which is what makes "the PDF
 * the Review step shows" and "the PDF the signature seals" the SAME artifact). A plain `useQuery`, not
 * `useApiQuery`: that hook always parses the response as JSON, which a PDF response is not — the
 * `queryFn` below calls `authenticatedFetch` directly and hands back a `Blob` for the page to turn into
 * an object URL. `staleTime: Infinity` because the backend's own artifact never changes once frozen —
 * refetching it on a window refocus or a remount would only re-download the identical bytes.
 */
export function usePublicSignatureDocument(token: string, enabled: boolean) {
  return useQuery<Blob, ApiError>({
    queryKey: ["public-signature-document", token],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/public/signatures/${encodeURIComponent(token)}/document`)
      if (!res.ok) {
        // Same shape `apiFetch` (use-api-query.ts) already gives every OTHER call in this app — a
        // Nest exception body carries `{ message }`, surfaced as-is rather than a generic fallback.
        const body = await res
          .clone()
          .json()
          .catch(() => undefined)
        const message = typeof body?.message === "string" ? body.message : `GET .../document failed`
        throw new ApiError(res.status, message, body)
      }
      return res.blob()
    },
    enabled: enabled && !!token,
    retry: false,
    staleTime: Infinity,
  })
}

/** Mints and emails a fresh OTP — capped at 3 mints per signature request, EVER (the backend's own
 *  `otp.ts#MAX_OTP_MINTS`); a 4th call answers a distinct, clear 400 rather than the generic one. */
export function useRequestPublicSignatureOtp(token: string) {
  return useApiMutation<void, { message: string }>(
    "POST",
    `/api/public/signatures/${encodeURIComponent(token)}/otp`,
  )
}

/** Verifies the submitted code and, on success, signs the document — see the backend's own
 *  `SignaturesService.verifyAndSign` header for why every failure reason (wrong code, expired,
 *  locked, already used, unknown token) answers the exact same message. `signedAt` is the persisted
 *  write's own timestamp (never the browser's clock) — the public page's own "signed on …" line. */
export function useSignPublicSignature(token: string) {
  return useApiMutation<{ code: string }, { message: string; signedAt: string }>(
    "POST",
    `/api/public/signatures/${encodeURIComponent(token)}/sign`,
  )
}
