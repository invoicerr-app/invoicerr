export interface CreateDocumentScheduleDto {
  typeId: string;
  sourceDocumentId: string;
  actionId: string;
  /** One of SCHEDULE_CADENCES (cadence.ts) — validated at the service, not here; this stays a plain
   *  string the same way RunActionDto's own fields stay untyped unions, checked once, in one place. */
  cadence: string;
  /** ISO date(-time) of the first occurrence — day-precision, UTC-normalized by the service (see
   *  cadence.ts's header on the timezone choice). May be in the past: a schedule created that way is
   *  simply due at the very next sweep pass, which is exactly what 29-document-recurrence.cy.ts
   *  exercises. */
  firstOccurrenceAt: string;
  /** Chains "send" onto the fresh duplicate the instant it exists — see duplicate-extension.ts.
   *  Ignored (never an error) for a type/action this wasn't wired for. */
  thenSend?: boolean;
}

export interface UpdateDocumentScheduleDto {
  enabled: boolean;
}
