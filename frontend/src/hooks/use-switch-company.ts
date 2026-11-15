import { usePost } from "@/hooks/use-fetch"

/**
 * Switches the session's active company (`POST /api/companies/switch`), the one mechanism the sidebar's
 * company switcher and the "not enough seats" screen share. Resolves `false` when the switch was refused
 * (the caller stays on the current company), otherwise reloads the page.
 */
export function useSwitchCompany() {
  const { trigger, loading } = usePost<{ success: boolean }>("/api/companies/switch")

  const switchCompany = async (companyId: string): Promise<boolean> => {
    const result = await trigger({ companyId })
    if (!result) return false
    // Full reload: company-scoped data is fetched by two different
    // mechanisms across the app (TanStack Query hooks and the older
    // useGet/usePost hooks in use-fetch.ts, e.g. every settings page).
    // invalidateQueries() only refreshes the former, leaving the latter
    // showing the previous company's data; a reload guarantees every
    // page re-fetches under the newly active company.
    window.location.reload()
    return true
  }

  return { switchCompany, switching: loading }
}
