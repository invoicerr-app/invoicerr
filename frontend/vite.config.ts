// `defineConfig` comes from vitest/config rather than vite so the `test` block below is typed.
// It is a superset of vite's own — `vite build` and `vite dev` behave exactly as before.
import { defineConfig } from "vitest/config"
import generouted from "@generouted/react-router/plugin"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), generouted(), tailwindcss()],
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
