import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

/**
 * The frontend half of the signature flow — three PUBLIC, unauthenticated endpoints
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
 *  locked, already used, unknown token) answers the exact same message. */
export function useSignPublicSignature(token: string) {
  return useApiMutation<{ code: string }, { message: string }>(
    "POST",
    `/api/public/signatures/${encodeURIComponent(token)}/sign`,
  )
}
