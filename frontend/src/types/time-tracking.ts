// TODO_FEATURES.md rank 11 ("suivi du temps & facturation de projets"). Mirrors the backend's
// ProjectsService/TimeEntriesService response shapes — `hourlyRate` in MAJOR units on both, never the
// minor-unit column the backend keeps to itself (see ProjectsService's own `withRate` header).

export interface ProjectClientSummary {
  id: string
  name: string
}

export interface Project {
  id: string
  companyId: string
  clientId: string
  client: ProjectClientSummary
  name: string
  description?: string | null
  hourlyRate: number | null
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export interface TimeEntryProjectSummary {
  id: string
  name: string
  clientId: string
}

export interface TimeEntry {
  id: string
  companyId: string
  projectId: string
  project: TimeEntryProjectSummary
  date: string
  durationMinutes: number
  description?: string | null
  billable: boolean
  /** This entry's OWN rate override — null when it relies on the project's own default. Shown as-is
   *  on the edit form; NEVER used for an amount display, see `effectiveHourlyRate` for that. */
  hourlyRate: number | null
  /** What this entry will actually be billed at — its own override, falling back to the project's
   *  default (the exact same resolution `generate-invoice-lines.ts` applies at billing time). Use
   *  this for every displayed amount. */
  effectiveHourlyRate: number | null
  /** Which invoice this entry was billed into — null means unbilled/still available to select. */
  invoiceId?: string | null
  createdAt: string
  updatedAt: string
}

export interface GenerateInvoiceFromTimeEntriesResult {
  invoice: { id: string; typeId: string; status: string; displayNumber?: string | null }
  billedEntryIds: string[]
}
