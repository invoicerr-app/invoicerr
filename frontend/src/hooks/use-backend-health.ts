import { useEffect, useState } from "react"

export type BackendHealthStatus = "checking" | "ok" | "unavailable"

const getEnvVariable = (key: string): string | undefined => {
  return (window as any).__APP_CONFIG__?.[key] || import.meta.env[key]
}

/**
 * Pings the backend health endpoint (which checks DB connectivity).
 * Returns "unavailable" on a network error or any non-2xx response (e.g. 503
 * when the database is unreachable), so auth pages can warn the user instead of
 * silently degrading (e.g. wrongly requiring an invitation code).
 */
export function useBackendHealth(): BackendHealthStatus {
  const [status, setStatus] = useState<BackendHealthStatus>("checking")

  useEffect(() => {
    let cancelled = false
    const backendUrl = getEnvVariable("VITE_BACKEND_URL") || ""

    fetch(`${backendUrl}/api/health`)
      .then((response) => {
        if (!cancelled) setStatus(response.ok ? "ok" : "unavailable")
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable")
      })

    return () => {
      cancelled = true
    }
  }, [])

  return status
}
