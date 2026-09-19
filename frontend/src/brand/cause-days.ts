/**
 * The calendar days on which `BrandMark` swaps its two shapes' colours for a cause's own flag/symbol
 * instead of `currentColor` — see `brand/causes/<variant>.svg` for the actual artwork and each entry's
 * own comment there for the colour sourcing. This file is the other half: WHEN each one is active.
 * `label`/`description` live in `en/translation.json` under `brand.causeDays.<id>` (Weblate-managed
 * like everything else user-facing), not here — this catalog only carries what a translation can't:
 * the id, the date rule, which SVG file it points at, and the day's own source link.
 *
 * Scope, per the owner's own decision: six UN/EU-recognised observances, deliberately short of the
 * larger set first drafted (Trans Day of Visibility/Remembrance, IDAHOBIT, Juneteenth, Bi Visibility
 * Day, Non-Binary People's Day, Intersex Awareness Day, Ace Week, World AIDS Day, Human Rights Day) —
 * cut down to these six rather than expanded further.
 *
 * Every date below was checked against the day's own official or founding-organisation page on
 * 2026-09-19; none is a guess.
 */

/** Month is 1-12 (human convention), matching how every date is written in the comments below. */
export type CauseDayRule =
  | { kind: "fixed"; month: number; day: number }
  /** Inclusive month/day range, both ends in the same calendar year — no entry here wraps New Year's. */
  | { kind: "range"; startMonth: number; startDay: number; endMonth: number; endDay: number }

export interface CauseDay {
  /** Stable id — also the `brand.causeDays.<id>` translation key and the `/brand/causes/<id>.svg` file. */
  id: string
  rule: CauseDayRule
  /** Matches a file at `/brand/causes/<variant>.svg`, enforced by cause-days.spec.ts. */
  variant: string
  /** The day's official or founding-organisation page — what the tooltip link points to. */
  source: string
}

export const CAUSE_DAYS: readonly CauseDay[] = [
  {
    id: "zero-discrimination-day",
    rule: { kind: "fixed", month: 3, day: 1 },
    variant: "zero-discrimination-day",
    source: "https://www.un.org/en/observances/zero-discrimination-day",
  },
  {
    id: "international-womens-day",
    rule: { kind: "fixed", month: 3, day: 8 },
    variant: "international-womens-day",
    source: "https://www.un.org/en/observances/womens-day",
  },
  {
    id: "elimination-of-racial-discrimination-day",
    rule: { kind: "fixed", month: 3, day: 21 },
    variant: "elimination-of-racial-discrimination-day",
    source: "https://www.un.org/en/observances/end-racism-day",
  },
  {
    id: "earth-day",
    rule: { kind: "fixed", month: 4, day: 22 },
    variant: "earth-day",
    source: "https://www.earthday.org/",
  },
  {
    id: "pride-month",
    rule: { kind: "range", startMonth: 6, startDay: 1, endMonth: 6, endDay: 30 },
    variant: "pride-month",
    source: "https://en.wikipedia.org/wiki/Pride_Month",
  },
  {
    id: "international-day-of-persons-with-disabilities",
    rule: { kind: "fixed", month: 12, day: 3 },
    variant: "international-day-of-persons-with-disabilities",
    source: "https://www.un.org/en/observances/day-of-persons-with-disabilities",
  },
]

/**
 * Pure function of the caller's own local calendar date — never the server clock, same rule the
 * channel-policy mandate resolver follows for the same reason (`transports/channel-policy/mandate.ts`
 * on the backend side): every reader sees the same cause on the same local day, with no way for a
 * user preference to disagree, because there isn't one yet. Fixed dates are checked before ranges so
 * a single named day would win over a month-long range if one ever fell inside it — none of the six
 * entries above currently overlap, but a specific day is more specific than a range on principle.
 * First match wins otherwise.
 */
export function activeCauseDay(
  date: Date,
  causeDays: readonly CauseDay[] = CAUSE_DAYS,
): CauseDay | undefined {
  const month = date.getMonth() + 1
  const day = date.getDate()

  const fixedMatch = causeDays.find(
    (cause) => cause.rule.kind === "fixed" && month === cause.rule.month && day === cause.rule.day,
  )
  if (fixedMatch) return fixedMatch

  return causeDays.find((cause) => {
    if (cause.rule.kind !== "range") return false
    const current = month * 100 + day
    const start = cause.rule.startMonth * 100 + cause.rule.startDay
    const end = cause.rule.endMonth * 100 + cause.rule.endDay
    return current >= start && current <= end
  })
}
