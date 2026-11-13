import { useQuery } from "@tanstack/react-query"

import { ApiError, apiFetch, useApiMutation } from "@/hooks/use-api-query"
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
  /** The bought quantity - read from the billing provider, never something this app writes back to it. */
  seats: number
  /** Seated members, ordered by desk number. */
  members: SeatMemberView[]
  /** Non-seated members (an over-capacity company), most-recently-arrived first. */
  waiting: SeatMemberView[]
}

/**
 * `GET /api/billing/seats`. Open to every company member: a WAITING member needs it to render the
 * waiting screen (`(app)/_layout.tsx`). Billing disabled answers 404, kept as `null`: a query that
 * holds no data goes back to `pending` on every focus refetch, which the shell's seat gate would read
 * as a first load and unmount the whole page.
 */
export function useSeats(enabled = true) {
  return useQuery<SeatsView | null>({
    queryKey: queryKeys.billing.seats(),
    queryFn: () =>
      apiFetch<SeatsView>("/api/billing/seats").catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }),
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
