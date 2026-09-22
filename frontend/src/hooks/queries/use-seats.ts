import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { CompanyRole } from "@/types"

export interface SeatMemberView {
  userId: string
  email: string
  firstname: string
  lastname: string
  role: CompanyRole
  /** `null` only for a row the backend has not yet had a chance to backfill — never for a member
   *  actually returned in `members` (seated). */
  seatIndex: number | null
  joinedAt: string
}

export interface SeatsView {
  /** The bought quantity — read from Polar, never something this app writes back to it. */
  seats: number
  /** Seated members, ordered by desk number. */
  members: SeatMemberView[]
  /** Non-seated members (an over-capacity company), most-recently-arrived first. */
  waiting: SeatMemberView[]
}

/**
 * `GET /api/billing/seats` — the company's own generative office plan. Open to every company member,
 * not just OWNER/ADMIN: everyone can see who sits where, and a WAITING member needs this to even
 * render the waiting screen (`(app)/_layout.tsx`). `retry: false` for the same reason
 * `useBillingStatus` sets it — this route doesn't exist at all on a self-hosted instance (billing
 * disabled), so a 404 should surface immediately rather than retry a request that can never succeed.
 */
export function useSeats(enabled = true) {
  return useApiQuery<SeatsView>(queryKeys.billing.seats(), "/api/billing/seats", {
    enabled,
    retry: false,
    staleTime: 15_000,
  })
}

export interface MoveSeatVariables {
  userId: string
  seatIndex: number
}

/** `PATCH /api/billing/seats/:userId` — move a member to a different (free) desk. OWNER/ADMIN only.
 *  Purely visual: a desk number never grants or revokes access. */
export function useMoveSeat() {
  return useApiMutation<MoveSeatVariables, SeatsView>(
    "PATCH",
    (variables) => `/api/billing/seats/${variables.userId}`,
    { invalidateKeys: [queryKeys.billing.seats()] },
  )
}
