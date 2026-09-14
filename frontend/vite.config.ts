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
      includeAssets: ["favicon.svg", "favicon.png"],
      manifest: {
        name: "Invoicerr",
        short_name: "Invoicerr",
        description:
          "Simple, open-source invoicing app for freelancers: quotes, invoices, clients, and payments.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Matches --background / --foreground in src/index.css (light theme): the app itself is
        // monochrome (no distinct brand hue), so the install/splash chrome uses the same white the
        // page already paints rather than inventing a brand color.
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
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
