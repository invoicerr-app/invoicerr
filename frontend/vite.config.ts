// `defineConfig` comes from vitest/config rather than vite so the `test` block below is typed.
// It is a superset of vite's own — `vite build` and `vite dev` behave exactly as before.
import { defineConfig } from "vitest/config"
import generouted from "@generouted/react-router/plugin"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    react(),
    generouted(),
    tailwindcss(),
    VitePWA({
      // autoUpdate (not "prompt"): a "new version available" banner depends on the user noticing
      // and clicking it, which can leave someone running stale app code indefinitely against a live
      // API that has moved on. autoUpdate installs the new service worker and reloads automatically
      // once it takes control, so nobody is silently stuck on an old build.
      registerType: "autoUpdate",
      // Manual registration (default is "auto", which injects an unconditional registerSW.js into
      // every page load with no way to opt out) — src/main.tsx registers the service worker itself
      // via `virtual:pwa-register`, gated on `!("Cypress" in window)`. See the comment there for why:
      // an unconditional service worker under Cypress broke 29-document-recurrence.cy.ts the moment
      // this PWA setup landed (b7a6581d).
      injectRegister: null,
      includeAssets: ["favicon.svg", "favicon-16.png", "favicon-32.png", "favicon.ico"],
      manifest: {
        // `id` pins the installed app's identity independently of `start_url`, so a future change to
        // start_url (e.g. adding a query param) doesn't register as a second, separate install for
        // people who already have this one — same value as start_url/scope, all "/", on purpose.
        id: "/",
        name: "Invoicerr",
        short_name: "Invoicerr",
        description:
          "Simple, open-source invoicing app for freelancers: quotes, invoices, clients, and payments.",
        lang: "en",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Both are "standalone" in practice today; listed as a fallback chain for a browser that
        // doesn't support standalone but does support minimal-ui, per the manifest spec's own intent.
        display_override: ["standalone", "minimal-ui"],
        // Free — the app has no fixed orientation requirement, unlike e.g. a game or a scanner tool.
        orientation: "any",
        categories: ["business", "finance", "productivity"],
        // Matches --background in src/index.css, light theme (identity "Lagune", decision
        // 2026-09-15: oklch(0.975 0.005 230) = #f3f7f9) — the manifest has no dark-mode variant, so
        // this stays the light background rather than inventing a separate splash color; the meta
        // tags in index.html carry the dark-mode equivalent for the browser chrome, which DOES vary.
        background_color: "#f3f7f9",
        theme_color: "#f3f7f9",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            // Full-bleed azure square, ink mark fit inside a centered 60% safe zone (20% margin
            // each side) — no baked corner radius, since the OS applies its own mask shape
            // (circle, squircle, rounded square…) for "maskable" and a second one baked in here
            // would double up or get cropped unpredictably. See icon-512.png (purpose "any")
            // above for the pre-rounded variant used everywhere the OS does NOT mask.
            src: "/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        // Two of the three link into /documents/invoice rather than a dedicated "create" URL: there
        // is no such route (see documents/[typeId].tsx's own header — one generic page per document
        // type, "+ New" just opens a dialog on it), so "New invoice" lands on the invoice list, the
        // closest existing route, where that dialog is one click away.
        shortcuts: [
          {
            name: "New invoice",
            short_name: "New invoice",
            url: "/documents/invoice",
            icons: [{ src: "/icon-96.png", sizes: "96x96", type: "image/png" }],
          },
          {
            name: "Clients",
            short_name: "Clients",
            url: "/clients",
            icons: [{ src: "/icon-96.png", sizes: "96x96", type: "image/png" }],
          },
          {
            name: "Dashboard",
            short_name: "Dashboard",
            url: "/dashboard",
            icons: [{ src: "/icon-96.png", sizes: "96x96", type: "image/png" }],
          },
        ],
        // form_factor "wide" (desktop) + "narrow" (mobile) is what PWABuilder's report card checks
        // for; both are real captures of the running app (see the scratchpad Playwright script used
        // to produce them), not placeholders.
        screenshots: [
          {
            src: "/screenshots/dashboard-wide.png",
            sizes: "1280x800",
            type: "image/png",
            form_factor: "wide",
            label: "Dashboard overview",
          },
          {
            src: "/screenshots/invoices-narrow.png",
            sizes: "780x1688",
            type: "image/png",
            form_factor: "narrow",
            label: "Invoice list",
          },
        ],
      },
      workbox: {
        // Precache the built app shell (JS/CSS/HTML/icons) only.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        // The main bundle is a single ~2.7 MB chunk (pre-existing — `vite build` already warns
        // "chunks larger than 500 kB", unrelated to the PWA setup) and workbox's default precache
        // limit is 2 MiB; without raising it the build fails outright rather than merely skip the
        // asset, so this only lifts the ceiling, it doesn't request splitting that chunk.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // The SPA fallback (serving cached index.html for unknown navigations, e.g. a deep link
        // opened while offline) must never catch an /api/* request.
        navigateFallbackDenylist: [/^\/api\//],
        // Never let workbox cache /api/* responses. Invoices, clients, and company data are
        // per-session and per-tenant (see @ActiveCompany() in the backend) — a cached response
        // replayed after logout or a session/company switch would leak the wrong tenant's data, and
        // the app's own multi-tenancy guarantees say nothing about what a browser cache does. Every
        // /api call must hit the network; NetworkOnly guarantees workbox stores nothing for it.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT) : 5173,
  },
  test: {
    // Component tests need a DOM. Everything else (pure zod schemas, helpers) is happy in it too,
    // so there is a single environment rather than per-file overrides.
    environment: "jsdom",
    // Enabled so @testing-library/react registers its automatic `cleanup()` between tests; the
    // specs themselves still import `describe`/`it`/`expect` explicitly, which keeps them
    // typechecking without widening the `types` array of tsconfig.app.json.
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Colocated `*.spec.ts(x)` next to the code they cover — the same convention as the backend.
    // Cypress owns `e2e/`, which is a separate npm project and never seen by this glob.
    include: ["src/**/*.spec.{ts,tsx}"],
  },
})
