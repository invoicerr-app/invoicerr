import "./index.css"
import "./lib/i18n"

import { QueryClientProvider } from "@tanstack/react-query"
import { Routes } from "@generouted/react-router"
import { CauseDayFavicon } from "@/brand/cause-day-favicon"
import { ThemeProvider } from "./components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { createRoot } from "react-dom/client"
import { queryClient } from "./lib/query-client"
import { registerSW } from "virtual:pwa-register"

// Service worker registration, guarded against Cypress.
//
// b7a6581d added the PWA (vite-plugin-pwa, registerType: "autoUpdate") on the plugin's default
// `injectRegister: "auto"`, which injects an unconditional registerSW.js into every page load with
// no guard at all. The very next CI run broke 29-document-recurrence.cy.ts — green on the eight runs
// before it — with:
//   CypressError: cy.click() failed because the page updated as a result of this command, but you
//   tried to continue the command chain. The subject is no longer attached to the DOM...
// on the recurrence-schedule toggle click: a plain React Query mutation whose own code never
// navigates anywhere. That specific error is Cypress's diagnostic for a genuine document unload
// happening mid-command, and the service worker is the only thing that changed on that commit — but
// the CI log carries no browser-side trace naming the exact line that triggered it (Cypress's
// terminal output doesn't capture that), so treat the service worker as the correlated cause, not a
// proven one. Either way it has no legitimate role in a test that only ever drives the app through
// its own screens and the API, and Cypress does not unregister a service worker between visits or
// specs (see e2e/cypress/support/e2e.ts) — a stray registration from an earlier visit outlives it and
// is a documented hazard class regardless of the precise trigger. `injectRegister: null` in
// vite.config.ts hands registration to us for exactly this reason.
if (!("Cypress" in window)) {
  registerSW({ immediate: true })
}

async function loadRuntimeConfig() {
  try {
    const res = await fetch("/config.json", { cache: "no-store" })
    if (res.ok) {
      ;(window as any).__APP_CONFIG__ = await res.json()
      return
    }
  } catch (e) {
    // ignore, fallback to empty config
  }
  ;(window as any).__APP_CONFIG__ = {}
}

async function bootstrap() {
  await loadRuntimeConfig()

  createRoot(document.getElementById("root")!).render(
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        <CauseDayFavicon />
        <Routes />
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

bootstrap()
