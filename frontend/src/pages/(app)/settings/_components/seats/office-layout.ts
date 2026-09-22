import type { SeatMemberView } from "@/hooks/queries"

/**
 * Splits `deskCount` desks into pairs — "un siège = un bureau", desks always go two by two, face to
 * face (the product's own office-plan brief). Every entry is 2 except possibly the LAST, which is 1
 * for an odd desk count (a company on an odd number of bought seats — 1, the TRIAL default, is the
 * common case — simply has one desk with no partner to pair it with; it still gets its own spot on the
 * plan, alone). Deterministic — never random: the same desk count always draws the same floor plan,
 * which is what makes a screenshot/e2e assertion ("desk 3 is free") stable across runs.
 */
export function groupIntoIslands(deskCount: number): number[] {
  if (deskCount <= 0) return []

  const pairs = Math.floor(deskCount / 2)
  const islands = Array.from({ length: pairs }, () => 2)
  if (deskCount % 2 === 1) islands.push(1)
  return islands
}

export interface DeskSlot {
  /** 1-based desk number — matches `SeatMemberView.seatIndex`. */
  index: number
  occupant: SeatMemberView | null
}

export interface DeskIsland {
  islandIndex: number
  desks: DeskSlot[]
}

/**
 * The full floor plan: every desk from 1 to `seats`, grouped into face-to-face pairs, each carrying
 * its occupant (or `null` — a free desk) looked up by `seatIndex`. A seated member with no `seatIndex`
 * yet (should not normally happen, or one whose stored number no longer falls within the CURRENT
 * capacity — the backend backfills/repairs both on every `GET /api/billing/seats`,
 * `seats-view.ts#ensureSeatIndexesAssigned`) is simply absent from the plan rather than crashing it;
 * `unplaced` surfaces them separately so the page can still render something sensible.
 */
export interface OfficeLayout {
  islands: DeskIsland[]
  unplaced: SeatMemberView[]
}

export function buildOfficeLayout(seats: number, members: SeatMemberView[]): OfficeLayout {
  const byDesk = new Map<number, SeatMemberView>()
  const unplaced: SeatMemberView[] = []
  for (const member of members) {
    if (member.seatIndex !== null && member.seatIndex >= 1 && member.seatIndex <= seats) {
      byDesk.set(member.seatIndex, member)
    } else {
      unplaced.push(member)
    }
  }

  const islandSizes = groupIntoIslands(seats)
  let deskNumber = 1
  const islands: DeskIsland[] = islandSizes.map((size, islandIndex) => {
    const desks: DeskSlot[] = []
    for (let i = 0; i < size; i++) {
      desks.push({ index: deskNumber, occupant: byDesk.get(deskNumber) ?? null })
      deskNumber++
    }
    return { islandIndex, desks }
  })

  return { islands, unplaced }
}
