import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"

export type OwnershipTransferStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELED"

export interface OwnershipTransferView {
  id: string
  companyId: string
  companyName: string
  status: OwnershipTransferStatus
  toEmail: string
  fromUserId: string
  fromName: string
  fromEmail: string
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  canceledAt: string | null
}

interface MessageResponse {
  message: string
}

/** `GET /api/companies/transfer` — OWNER-only, the active company's own current PENDING transfer (or
 *  `null`). Drives `settings/_components/transfer-company.section.tsx`. */
export function useCurrentCompanyTransfer() {
  return useApiQuery<OwnershipTransferView | null>(
    queryKeys.companyTransfer.current(),
    "/api/companies/transfer",
  )
}

/** `POST /api/danger/otp` — the SAME per-company challenge the danger zone mints (product decision
 *  2026-09-17: ownership transfer reuses it rather than minting a second OTP flow). */
export function useRequestTransferOtp() {
  return useApiMutation<void, MessageResponse>("POST", "/api/danger/otp")
}

export interface InitiateTransferInput {
  email: string
  otp: string
}

/** `POST /api/companies/transfer` — always resolves to the SAME generic message whether or not `email`
 *  has an account (anti-enumeration, backend's own `transfer.service.ts`). */
export function useInitiateTransfer() {
  return useApiMutation<InitiateTransferInput, MessageResponse>("POST", "/api/companies/transfer", {
    invalidateKeys: [queryKeys.companyTransfer.current()],
  })
}

/** `DELETE /api/companies/transfer/:id` — OWNER-only, no OTP. */
export function useCancelCompanyTransfer() {
  return useApiMutation<{ id: string }, { success: true }>(
    "DELETE",
    ({ id }) => `/api/companies/transfer/${id}`,
    { invalidateKeys: [queryKeys.companyTransfer.current()] },
  )
}

/** `GET /api/account/transfers` — every ownership transfer ever addressed to the caller's own
 *  account, newest first. Drives `pages/(app)/account/transfers.tsx`. */
export function useReceivedTransfers() {
  return useApiQuery<OwnershipTransferView[]>(queryKeys.companyTransfer.received(), "/api/account/transfers")
}

/** `POST /api/account/transfers/:id/accept` — makes the caller OWNER of the transfer's own company. In
 *  hosted-billing mode this can 403 with `LEGAL_ACCEPTANCE_REQUIRED` (the global
 *  `LegalAcceptanceGuard` refuses it before the handler ever runs) — the caller (`transfers.tsx`)
 *  branches on `error.code` for that case. */
export function useAcceptCompanyTransfer() {
  return useApiMutation<{ id: string }, { success: true }>(
    "POST",
    ({ id }) => `/api/account/transfers/${id}/accept`,
    { invalidateKeys: [queryKeys.companyTransfer.received()] },
  )
}
